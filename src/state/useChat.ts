import { useCallback, useEffect, useMemo, useReducer, useRef } from "react";

import { describeFailure, normalizeFailure } from "../api/errors.ts";
import { runTurn } from "../api/turn.ts";
import {
  initialState,
  messagesOf,
  providerOf,
  reduce,
  type ChatState,
} from "../domain/conversation.ts";
import { newId } from "../domain/ids.ts";
import { modelNameOf, titleOf } from "../domain/provider.ts";
import type { Agent, Message, Provider } from "../domain/types.ts";
import { logLine } from "../log.ts";
import { deviceFiles } from "./deviceFiles.ts";
import {
  loadAgents,
  loadChat,
  loadDraft,
  loadProviders,
  saveAgents,
  saveChat,
  saveDraft,
  saveProviders,
} from "./storage.ts";

/** Seeded on first launch; after that the list lives in `agents.json`. */
const DEFAULT_AGENTS: Agent[] = [{ id: "default", title: "Swipt Chat" }];

/** Tokens are coalesced: one React update per window, not one per token. */
const FLUSH_MS = 50;
/** History is written after the user stops typing/streaming, not per change. */
const SAVE_MS = 400;

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
  /** An empty `id` adds a new service, otherwise the matching one is replaced. */
  saveProvider(provider: Provider): void;
  removeProvider(id: string): void;
  selectProvider(id: string): void;
}

export interface UseChat {
  state: ChatState;
  messages: readonly Message[];
  streaming: boolean;
  modelLabel: string;
  provider: Provider | null;
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
      const [chat, providers, agents, draft] = await Promise.all([
        loadChat(deviceFiles),
        loadProviders(deviceFiles),
        loadAgents(deviceFiles),
        loadDraft(deviceFiles),
      ]);
      if (!alive) {
        return;
      }
      dispatch({
        type: "hydrate",
        conversations: chat.conversations,
        currentId: chat.currentId,
        draft,
        providers: providers.providers,
        providerId: providers.activeId,
        agents: agents.agents,
        agentId: agents.activeId,
      });
    })();
    return () => {
      alive = false;
    };
  }, []);

  useEffect(() => {
    if (!state.hydrated) {
      return;
    }
    const pending = setTimeout(() => {
      void saveChat(deviceFiles, {
        conversations: state.conversations,
        currentId: state.currentId,
      }).catch((thrown: unknown) => logLine(`persist: chat ${String(thrown)}`));
    }, SAVE_MS);
    return () => clearTimeout(pending);
  }, [state.conversations, state.currentId, state.hydrated]);

  useEffect(() => {
    if (!state.hydrated) {
      return;
    }
    const pending = setTimeout(() => {
      void saveDraft(deviceFiles, state.draft).catch((thrown: unknown) =>
        logLine(`persist: draft ${String(thrown)}`),
      );
    }, SAVE_MS);
    return () => clearTimeout(pending);
  }, [state.draft, state.hydrated]);

  useEffect(() => {
    if (!state.hydrated) {
      return;
    }
    const pending = setTimeout(() => {
      void saveProviders(deviceFiles, {
        providers: state.providers,
        activeId: state.providerId,
      }).catch((thrown: unknown) =>
        logLine(`persist: providers ${String(thrown)}`),
      );
    }, SAVE_MS);
    return () => clearTimeout(pending);
  }, [state.providers, state.providerId, state.hydrated]);

  useEffect(() => {
    if (!state.hydrated) {
      return;
    }
    const pending = setTimeout(() => {
      void saveAgents(deviceFiles, {
        agents: state.agents,
        activeId: state.agentId,
      }).catch((thrown: unknown) => logLine(`persist: agents ${String(thrown)}`));
    }, SAVE_MS);
    return () => clearTimeout(pending);
  }, [state.agents, state.agentId, state.hydrated]);

  useEffect(
    () => () => {
      controller.current?.abort();
      if (timer.current !== null) {
        clearTimeout(timer.current);
      }
    },
    [],
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
        await runTurn(providerOf(current), request, {
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

  const saveProvider = useCallback((next: Provider) => {
    if (next.id === "") {
      dispatch({ type: "providerAdd", provider: { ...next, id: newId("p") } });
      return;
    }
    dispatch({ type: "providerUpdate", provider: next });
  }, []);

  const removeProvider = useCallback((id: string) => {
    dispatch({ type: "providerRemove", id });
  }, []);

  const selectProvider = useCallback((id: string) => {
    dispatch({ type: "providerSelect", id });
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
      saveProvider,
      removeProvider,
      selectProvider,
    }),
    [
      addAgent,
      deleteSession,
      newChat,
      openSession,
      removeAgent,
      removeProvider,
      renameSession,
      saveProvider,
      selectAgent,
      selectProvider,
      send,
      setDraft,
      setSheetOpen,
      stop,
    ],
  );

  const messages = useMemo(() => messagesOf(state), [state]);
  const provider = useMemo(() => providerOf(state), [state]);

  return {
    state,
    messages,
    streaming: state.turn !== null,
    modelLabel: modelNameOf(provider),
    provider,
    actions,
  };
}