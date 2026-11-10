import { useCallback, useEffect, useMemo, useReducer, useRef } from "react";
import { AppState } from "react-native";

import { describeFailure, normalizeFailure, technicalOf } from "../api/errors.ts";
import { requestModels } from "../api/request.ts";
import { runTurn } from "../api/turn.ts";
import {
  endpointOf,
  initialState,
  messagesOf,
  reduce,
  type ChatState,
} from "../domain/conversation.ts";
import { newId } from "../domain/ids.ts";
import { modelNameOf, type Instance, type ModelConfig } from "../domain/service.ts";
import { titleOf } from "../domain/title.ts";
import type { Agent, Message } from "../domain/types.ts";
import { logLine } from "../log.ts";
import { openDeviceStore } from "./deviceSql.ts";
import type { Snapshot, Store } from "./store.ts";
import { diffState } from "./sync.ts";

/** Seeded on first launch; after that the list lives in `agents.json`. */
const DEFAULT_AGENTS: Agent[] = [{ id: "default", title: "Swipt Chat" }];

/** Tokens are coalesced: one React update per window, not one per token. */
const FLUSH_MS = 50;
/**
 * Writes are batched: 300ms after the last change, and immediately when the app
 * leaves the foreground. The plan's floor is 300ms; a shorter window would put
 * a write inside every few streaming frames.
 */
const SAVE_MS = 300;

export interface ChatActions {
  send(): void;
  stop(): void;
  newChat(): void;
  openSession(id: string): void;
  renameSession(id: string, title: string): void;
  deleteSession(id: string): void;
  setDraft(text: string): void;
  setSheetOpen(open: boolean): void;
  selectAgent(id: string): void;
  addAgent(title: string): void;
  removeAgent(id: string): void;
  /** Creates a connection and returns its id so the caller can push its page. */
  addInstance(instance: Omit<Instance, "id">): string;
  updateInstance(instance: Instance): void;
  removeInstance(id: string): void;
  selectInstance(id: string): void;
  addModel(instanceId: string, model: ModelConfig): void;
  updateModel(instanceId: string, model: ModelConfig): void;
  removeModel(instanceId: string, modelId: string): void;
  selectModel(modelId: string): void;
  /**
   * Lists the instance's models. Doubles as the connectivity probe: it throws a
   * classified failure when the address, key or protocol is wrong. Nothing is
   * persisted — the caller decides which candidates the user adds.
   */
  fetchModels(instance: Instance): Promise<string[]>;
}

export interface UseChat {
  state: ChatState;
  messages: readonly Message[];
  streaming: boolean;
  modelLabel: string;
  /** The connection and model the next turn goes to; `null` = offline mock. */
  endpoint: ReturnType<typeof endpointOf>;
  actions: ChatActions;
}

/**
 * The single owner of chat state.
 *
 * - `reduce` decides every transition; this hook only wires effects.
 * - All returned actions are stable for the life of the component. That is not
 *   cosmetic: `ChatHeader`/`ComposerToolbar` are memoized precisely so their
 *   native `Host` trees survive a streaming turn (a rebuild cancels a tap).
 * - Deltas are buffered and flushed every 50ms, so a 60/s stream costs 20
 *   renders per second instead of 60 copies of the whole history.
 */
export function useChat(): UseChat {
  const [state, dispatch] = useReducer(reduce, DEFAULT_AGENTS, initialState);
  const stateRef = useRef(state);
  stateRef.current = state;

  const buffered = useRef<string>("");
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const turn = useRef<{ conversationId: string; messageId: string } | null>(null);
  const controller = useRef<AbortController | null>(null);

  /** Opened once at launch; `null` when SQLite is unavailable (in-memory run). */
  const store = useRef<Store | null>(null);
  /** The state the store knows about: the diff base for the next flush. */
  const persisted = useRef<ChatState | null>(null);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  /** Flushes are strictly ordered; a failed one retries from the same base. */
  const writes = useRef<Promise<void>>(Promise.resolve());

  const flush = useCallback(() => {
    if (timer.current !== null) {
      clearTimeout(timer.current);
      timer.current = null;
    }
    const target = turn.current;
    const text = buffered.current;
    buffered.current = "";
    if (target !== null && text !== "") {
      dispatch({
        type: "delta",
        conversationId: target.conversationId,
        messageId: target.messageId,
        text,
      });
    }
  }, []);

  const enqueue = useCallback(
    (delta: string) => {
      if (turn.current === null) {
        return;
      }
      buffered.current += delta;
      if (timer.current === null) {
        timer.current = setTimeout(() => {
          timer.current = null;
          flush();
        }, FLUSH_MS);
      }
    },
    [flush],
  );

  useEffect(() => {
    let alive = true;
    void (async () => {
      let opened: Store | null = null;
      let snapshot: Snapshot | null = null;
      try {
        opened = await openDeviceStore();
        snapshot = await opened.load();
      } catch (thrown: unknown) {
        // The chat still works for this run; only history is lost.
        void logLine(`storage: ${String(thrown)}`);
      }
      if (!alive) {
        void opened?.close();
        return;
      }
      store.current = opened;
      dispatch({
        type: "hydrate",
        conversations: snapshot?.conversations ?? [],
        currentId: snapshot?.currentId ?? null,
        draft: snapshot?.draft ?? "",
        instances: snapshot?.instances ?? [],
        instanceId: snapshot?.instanceId ?? null,
        models: snapshot?.models ?? {},
        modelId: snapshot?.modelId ?? null,
        agents: snapshot?.agents ?? [],
        agentId: snapshot?.agentId ?? null,
      });
    })();
    return () => {
      alive = false;
    };
  }, []);

  const flushNow = useCallback(() => {
    if (saveTimer.current !== null) {
      clearTimeout(saveTimer.current);
      saveTimer.current = null;
    }
    const target = store.current;
    const base = persisted.current;
    const next = stateRef.current;
    if (target === null || base === null || !next.hydrated) {
      return;
    }
    const ops = diffState(base, next);
    if (ops.length === 0) {
      return;
    }
    persisted.current = next;
    writes.current = writes.current
      .then(() => target.apply(ops))
      .catch((thrown: unknown) => {
        // Keep the old base: the next flush retries the same ops. Every op is
        // an idempotent upsert or delete, so a retry cannot duplicate rows.
        persisted.current = base;
        return logLine(`persist: ${String(thrown)}`);
      });
  }, []);

  useEffect(() => {
    if (!state.hydrated) {
      return;
    }
    if (persisted.current === null) {
      persisted.current = state;
      return;
    }
    if (saveTimer.current !== null) {
      clearTimeout(saveTimer.current);
    }
    saveTimer.current = setTimeout(flushNow, SAVE_MS);
    return () => {
      if (saveTimer.current !== null) {
        clearTimeout(saveTimer.current);
        saveTimer.current = null;
      }
    };
  }, [state, flushNow]);

  // Backgrounding is the last moment a write is guaranteed to run: the process
  // may be killed while suspended, and the debounce timer would never fire.
  useEffect(() => {
    const subscription = AppState.addEventListener("change", (status) => {
      if (status !== "active") {
        flushNow();
      }
    });
    return () => subscription.remove();
  }, [flushNow]);

  useEffect(
    () => () => {
      controller.current?.abort();
      if (timer.current !== null) {
        clearTimeout(timer.current);
      }
      flushNow();
    },
    [flushNow],
  );

  const send = useCallback(() => {
    const current = stateRef.current;
    const text = current.draft.trim();
    if (text === "" || current.turn !== null) {
      return;
    }

    const conversationId = current.currentId ?? newId("c");
    const create = current.currentId === null;
    const userId = newId("m");
    const replyId = newId("m");
    const request: Message[] = [
      ...messagesOf(current),
      { id: userId, role: "user", content: text, status: "done" },
    ];

    dispatch({
      type: "begin",
      conversationId,
      create,
      title: titleOf(text),
      userId,
      replyId,
      text,
      at: Date.now(),
    });

    turn.current = { conversationId, messageId: replyId };
    buffered.current = "";
    const abort = new AbortController();
    controller.current = abort;

    void (async () => {
      try {
        await runTurn(endpointOf(current), request, {
          signal: abort.signal,
          onDelta: enqueue,
        });
        flush();
        dispatch({
          type: "end",
          conversationId,
          messageId: replyId,
          status: "done",
        });
      } catch (thrown) {
        flush();
        if (abort.signal.aborted) {
          dispatch({ type: "stop", conversationId, messageId: replyId });
        } else {
          const info = normalizeFailure(thrown);
          void logLine(`turn: ${info.kind} ${info.detail}`);
          dispatch({
            type: "end",
            conversationId,
            messageId: replyId,
            status: "error",
            error: describeFailure(info),
          });
        }
      } finally {
        if (controller.current === abort) {
          controller.current = null;
        }
        turn.current = null;
      }
    })();
  }, [enqueue, flush]);

  const stop = useCallback(() => {
    controller.current?.abort();
  }, []);

  const newChat = useCallback(() => {
    controller.current?.abort();
    dispatch({ type: "newChat" });
  }, []);

  const openSession = useCallback((id: string) => {
    controller.current?.abort();
    dispatch({ type: "select", id });
    dispatch({ type: "sheet", open: false });
  }, []);

  const renameSession = useCallback((id: string, title: string) => {
    const next = title.trim();
    dispatch({ type: "rename", id, title: next === "" ? "新对话" : next });
  }, []);

  const deleteSession = useCallback((id: string) => {
    dispatch({ type: "remove", id });
  }, []);

  const setDraft = useCallback((text: string) => {
    dispatch({ type: "draft", text });
  }, []);

  const setSheetOpen = useCallback((open: boolean) => {
    dispatch({ type: "sheet", open });
  }, []);

  const selectAgent = useCallback((id: string) => {
    dispatch({ type: "agent", id });
  }, []);

  const addAgent = useCallback((title: string) => {
    const next = title.trim();
    dispatch({
      type: "agentAdd",
      agent: { id: newId("a"), title: next === "" ? "新智能体" : next },
    });
  }, []);

  const removeAgent = useCallback((id: string) => {
    dispatch({ type: "agentRemove", id });
  }, []);

  const addInstance = useCallback((next: Omit<Instance, "id">): string => {
    const id = newId("i");
    dispatch({ type: "instanceAdd", instance: { ...next, id } });
    return id;
  }, []);

  const updateInstance = useCallback((instance: Instance) => {
    dispatch({ type: "instanceUpdate", instance });
  }, []);

  const removeInstance = useCallback((id: string) => {
    dispatch({ type: "instanceRemove", id });
  }, []);

  const selectInstance = useCallback((id: string) => {
    dispatch({ type: "instanceSelect", id });
  }, []);

  const addModel = useCallback((instanceId: string, model: ModelConfig) => {
    dispatch({ type: "modelAdd", instanceId, model });
  }, []);

  const updateModel = useCallback((instanceId: string, model: ModelConfig) => {
    dispatch({ type: "modelUpdate", instanceId, model });
  }, []);

  const removeModel = useCallback((instanceId: string, modelId: string) => {
    dispatch({ type: "modelRemove", instanceId, modelId });
  }, []);

  const selectModel = useCallback((modelId: string) => {
    dispatch({ type: "modelSelect", modelId });
  }, []);

  const fetchModels = useCallback(async (instance: Instance): Promise<string[]> => {
    try {
      const ids = await requestModels(instance, undefined);
      void logLine(`models: ${instance.baseURL} ${ids.length}`);
      return ids;
    } catch (error) {
      void logLine(`models: failed ${technicalOf(error)}`);
      throw error;
    }
  }, []);

  const actions = useMemo<ChatActions>(
    () => ({
      send,
      stop,
      newChat,
      openSession,
      renameSession,
      deleteSession,
      setDraft,
      setSheetOpen,
      selectAgent,
      addAgent,
      removeAgent,
      addInstance,
      updateInstance,
      removeInstance,
      selectInstance,
      addModel,
      updateModel,
      removeModel,
      selectModel,
      fetchModels,
    }),
    [
      addAgent,
      addInstance,
      addModel,
      deleteSession,
      fetchModels,
      newChat,
      openSession,
      removeAgent,
      removeInstance,
      removeModel,
      renameSession,
      selectAgent,
      selectInstance,
      selectModel,
      send,
      setDraft,
      setSheetOpen,
      updateInstance,
      updateModel,
      stop,
    ],
  );

  const messages = useMemo(() => messagesOf(state), [state]);
  const endpoint = useMemo(() => endpointOf(state), [state]);

  return {
    state,
    messages,
    streaming: state.turn !== null,
    modelLabel: modelNameOf(endpoint?.model ?? null),
    endpoint,
    actions,
  };
}