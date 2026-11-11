import type {
  ChatEndpoint,
  ModelProvider,
  ModelProviderTemplate,
  ProviderModel,
} from "./provider.ts";
import { sameProvider, sameModel } from "./provider.ts";
import { firstModelOf } from "./provider.ts";
import type { Agent, Conversation, Message, Turn } from "./types.ts";

/**
 * The chat state machine.
 *
 * Pure: no React, no host APIs, no timers. Everything the UI shows — the list of
 * conversations, which one is open, the draft, the reply in flight — is derived
 * from this reducer, so the rules can be exercised by `npm test` outside Swipt.
 *
 * The old version kept all of this in `App.tsx` `useState` plus refs, which is
 * why a streamed token ended up copying every conversation and why switching
 * sessions required hand-written "abort + clear five fields" sequences.
 */

/**
 * Shared empty list, so a screen with no conversation still gets a stable array
 * reference (a fresh `[]` on every render made memoized children rebuild).
 */
export const EMPTY_MESSAGES: readonly Message[] = Object.freeze([]);

export interface ChatState {
  hydrated: boolean;
  conversations: Conversation[];
  currentId: string | null;
  draft: string;
  /** Creation entries and home-page groups, in seed order; rows, not code. */
  templates: ModelProviderTemplate[];
  agents: Agent[];
  agentId: string;
  /** Every configured connection; the chat uses whichever `providerId` names. */
  providers: ModelProvider[];
  providerId: string | null;
  /** Models configured under each provider, keyed by provider id. */
  models: Record<string, ProviderModel[]>;
  /** The model the chat sends to; `null` falls back to the offline mock. */
  modelId: string | null;
  turn: Turn | null;
  sheetOpen: boolean;
}

export type ChatAction =
  | {
      type: "hydrate";
      conversations: Conversation[];
      currentId: string | null;
      draft: string;
      templates: ModelProviderTemplate[];
      providers: ModelProvider[];
      providerId: string | null;
      models?: Record<string, ProviderModel[]>;
      modelId: string | null;
      agents: Agent[];
      agentId: string | null;
    }
  | { type: "draft"; text: string }
  | { type: "select"; id: string }
  | { type: "newChat" }
  | { type: "rename"; id: string; title: string }
  | { type: "remove"; id: string }
  | { type: "sheet"; open: boolean }
  | { type: "agent"; id: string }
  | { type: "agentAdd"; agent: Agent }
  | { type: "agentRemove"; id: string }
  | { type: "providerAdd"; provider: ModelProvider }
  | { type: "providerUpdate"; provider: ModelProvider }
  | { type: "providerRemove"; id: string }
  | { type: "providerSelect"; id: string }
  | { type: "modelAdd"; providerId: string; model: ProviderModel }
  | { type: "modelUpdate"; providerId: string; model: ProviderModel }
  | { type: "modelRemove"; providerId: string; modelId: string }
  | { type: "modelSelect"; modelId: string }
  | {
      type: "begin";
      conversationId: string;
      /** `true` when the conversation does not exist yet and must be created. */
      create: boolean;
      title: string;
      userId: string;
      replyId: string;
      text: string;
      at: number;
    }
  | { type: "delta"; conversationId: string; messageId: string; text: string }
  | {
      type: "end";
      conversationId: string;
      messageId: string;
      status: "done" | "error";
      error?: string;
    }
  | { type: "stop"; conversationId: string; messageId: string };

export function initialState(
  templates: ModelProviderTemplate[],
  agents: Agent[],
  providers: ModelProvider[] = [],
  models: Record<string, ProviderModel[]> = {},
): ChatState {
  const first = providers[0] ?? null;
  return {
    hydrated: false,
    conversations: [],
    currentId: null,
    draft: "",
    templates,
    agents,
    agentId: agents[0]?.id ?? "default",
    providers,
    providerId: first?.id ?? null,
    models,
    modelId: first === null ? null : (firstModelOf(models[first.id] ?? [])?.id ?? null),
    turn: null,
    sheetOpen: false,
  };
}

export const providerOf = (
  state: ChatState,
  id: string | null,
): ModelProvider | null =>
  id === null ? null : (state.providers.find((item) => item.id === id) ?? null);

/**
 * The connection and model the open chat talks to.
 *
 * `null` means the offline mock: either nothing is configured yet, or the
 * selected provider has no models — in both cases a real request cannot be
 * formed, and the chat stays usable instead of failing on send.
 */
export function endpointOf(state: ChatState): ChatEndpoint | null {
  const provider = providerOf(state, state.providerId);
  if (provider === null) {
    return null;
  }
  const models = state.models[provider.id] ?? [];
  const model =
    models.find((item) => item.id === state.modelId) ??
    firstModelOf(models);
  return model === undefined ? null : { provider, model };
}

export function conversationOf(
  state: ChatState,
  id: string | null,
): Conversation | null {
  if (id === null) {
    return null;
  }
  return state.conversations.find((item) => item.id === id) ?? null;
}

/** Messages of the open conversation; a stable empty array when there is none. */
export function messagesOf(state: ChatState): readonly Message[] {
  return conversationOf(state, state.currentId)?.messages ?? EMPTY_MESSAGES;
}

function patchConversation(
  state: ChatState,
  id: string,
  update: (conversation: Conversation) => Conversation,
): ChatState {
  const index = state.conversations.findIndex((item) => item.id === id);
  if (index === -1) {
    return state;
  }
  const conversations = [...state.conversations];
  conversations[index] = update(conversations[index]);
  return { ...state, conversations };
}

function patchMessage(
  conversation: Conversation,
  messageId: string,
  update: (message: Message) => Message,
): Conversation {
  const index = conversation.messages.findIndex((item) => item.id === messageId);
  if (index === -1) {
    return conversation;
  }
  const messages = [...conversation.messages];
  messages[index] = update(messages[index]);
  return { ...conversation, messages, updatedAt: Date.now() };
}

function patchModels(
  state: ChatState,
  providerId: string,
  models: ProviderModel[],
): ChatState {
  return { ...state, models: { ...state.models, [providerId]: models } };
}

function modelIdAfter(state: ChatState, providerId: string): string | null {
  return firstModelOf(state.models[providerId] ?? [])?.id ?? null;
}

export function reduce(state: ChatState, action: ChatAction): ChatState {
  switch (action.type) {
    case "hydrate": {
      const models = action.models ?? {};
      const provider =
        action.providerId === null
          ? (action.providers[0] ?? null)
          : (action.providers.find((item) => item.id === action.providerId) ??
            action.providers[0] ??
            null);
      const modelId =
        action.modelId !== null &&
        (models[provider?.id ?? ""] ?? []).some((item) => item.id === action.modelId)
          ? action.modelId
          : provider === null
            ? null
            : (firstModelOf(models[provider.id] ?? [])?.id ?? null);
      return {
        ...state,
        hydrated: true,
        conversations: action.conversations,
        currentId: action.currentId,
        draft: action.draft,
        templates: action.templates,
        providers: action.providers,
        providerId: provider?.id ?? null,
        models,
        modelId,
        agents: action.agents.length === 0 ? state.agents : action.agents,
        agentId: action.agentId ?? state.agentId,
      };
    }

    case "draft":
      return state.draft === action.text ? state : { ...state, draft: action.text };

    case "select":
      return action.id === state.currentId
        ? state
        : { ...state, currentId: action.id, draft: "" };

    case "newChat":
      return { ...state, currentId: null, draft: "", turn: null };

    case "rename":
      return patchConversation(state, action.id, (conversation) => ({
        ...conversation,
        title: action.title,
      }));

    case "remove": {
      const conversations = state.conversations.filter(
        (item) => item.id !== action.id,
      );
      if (conversations.length === state.conversations.length) {
        return state;
      }
      return {
        ...state,
        conversations,
        currentId: state.currentId === action.id ? null : state.currentId,
        turn: state.turn?.conversationId === action.id ? null : state.turn,
      };
    }

    case "sheet":
      return { ...state, sheetOpen: action.open };

    case "agent":
      return action.id === state.agentId ? state : { ...state, agentId: action.id };

    case "agentAdd":
      return { ...state, agents: [...state.agents, action.agent] };

    case "agentRemove": {
      const agents = state.agents.filter((item) => item.id !== action.id);
      if (agents.length === state.agents.length) {
        return state;
      }
      return {
        ...state,
        agents,
        agentId: state.agentId === action.id ? (agents[0]?.id ?? state.agentId) : state.agentId,
      };
    }

    case "providerAdd": {
      const providers = [...state.providers, action.provider];
      // The first connection added becomes the active one: a freshly configured
      // chat should use it without a second tap.
      const active = state.providerId === null;
      return {
        ...state,
        providers,
        providerId: active ? action.provider.id : state.providerId,
        modelId: active ? modelIdAfter(state, action.provider.id) : state.modelId,
      };
    }

    case "providerUpdate": {
      const index = state.providers.findIndex((item) => item.id === action.provider.id);
      if (index === -1) {
        const providers = [...state.providers, action.provider];
        return {
          ...state,
          providers,
          providerId: state.providerId ?? action.provider.id,
        };
      }
      const providers = [...state.providers];
      providers[index] = action.provider;
      // A protocol or address change keeps the models: the spec only asks for a
      // warning, never a delete. The selected model stays selected.
      return { ...state, providers };
    }

    case "providerRemove": {
      const providers = state.providers.filter((item) => item.id !== action.id);
      if (providers.length === state.providers.length) {
        return state;
      }
      const models = { ...state.models };
      delete models[action.id];
      const nextId =
        state.providerId === action.id
          ? (providers[0]?.id ?? null)
          : state.providerId;
      const keepModel =
        state.providerId !== action.id &&
        (models[state.providerId ?? ""] ?? []).some((item) => item.id === state.modelId);
      return {
        ...state,
        providers,
        models,
        providerId: nextId,
        modelId: keepModel
          ? state.modelId
          : nextId === null
            ? null
            : modelIdAfter({ ...state, models }, nextId),
      };
    }

    case "providerSelect":
      if (
        action.id === state.providerId ||
        !state.providers.some((item) => item.id === action.id)
      ) {
        return state;
      }
      return {
        ...state,
        providerId: action.id,
        modelId: modelIdAfter(state, action.id),
      };

    case "modelAdd": {
      const current = state.models[action.providerId] ?? [];
      if (current.some((item) => item.id === action.model.id)) {
        return state;
      }
      const models = patchModels(state, action.providerId, [
        ...current,
        action.model,
      ]);
      // Adding the first model to the active provider makes it the chat's model.
      return state.modelId === null && state.providerId === action.providerId
        ? { ...models, modelId: action.model.id }
        : models;
    }

    case "modelUpdate": {
      const current = state.models[action.providerId] ?? [];
      const index = current.findIndex((item) => item.id === action.model.id);
      if (index === -1) {
        return state;
      }
      if (sameModel(current[index], action.model)) {
        return state;
      }
      const next = [...current];
      next[index] = action.model;
      return patchModels(state, action.providerId, next);
    }

    case "modelRemove": {
      const current = state.models[action.providerId] ?? [];
      const next = current.filter((item) => item.id !== action.modelId);
      if (next.length === current.length) {
        return state;
      }
      return {
        ...state,
        models: { ...state.models, [action.providerId]: next },
        modelId:
          state.modelId === action.modelId
            ? state.providerId === action.providerId
              ? (firstModelOf(next)?.id ?? null)
              : state.modelId
            : state.modelId,
      };
    }

    case "modelSelect": {
      const current = state.models[state.providerId ?? ""] ?? [];
      if (
        action.modelId === state.modelId ||
        !current.some((item) => item.id === action.modelId)
      ) {
        return state;
      }
      return { ...state, modelId: action.modelId };
    }

    case "begin": {
      const user: Message = {
        id: action.userId,
        role: "user",
        content: action.text,
        status: "done",
      };
      const reply: Message = {
        id: action.replyId,
        role: "assistant",
        content: "",
        status: "streaming",
      };
      const turn: Turn = {
        conversationId: action.conversationId,
        messageId: action.replyId,
      };

      if (action.create) {
        const conversation: Conversation = {
          id: action.conversationId,
          title: action.title,
          messages: [user, reply],
          updatedAt: action.at,
        };
        return {
          ...state,
          conversations: [conversation, ...state.conversations],
          currentId: conversation.id,
          draft: "",
          turn,
        };
      }

      const patched = patchConversation(state, action.conversationId, (conversation) => ({
        ...conversation,
        messages: [...conversation.messages, user, reply],
        updatedAt: action.at,
      }));
      if (patched === state) {
        return state;
      }
      return { ...patched, currentId: action.conversationId, draft: "", turn };
    }

    case "delta":
      return patchConversation(state, action.conversationId, (conversation) =>
        patchMessage(conversation, action.messageId, (message) => ({
          ...message,
          content: message.content + action.text,
        })),
      );

    case "end": {
      const patched = patchConversation(state, action.conversationId, (conversation) =>
        patchMessage(conversation, action.messageId, (message) => ({
          ...message,
          status: action.status,
          error: action.error,
        })),
      );
      // Clearing the in-flight pointer belongs to the transition, not the caller:
      // leaving it set is what used to make a finished turn keep accepting tokens.
      return patched.turn?.messageId === action.messageId
        ? { ...patched, turn: null }
        : patched;
    }

    case "stop": {
      // Addressed by id rather than by `state.turn`: the user may have started a
      // new chat (or switched) before the aborted promise settles, and the old
      // reply must still stop showing a typing indicator.
      const patched = patchConversation(state, action.conversationId, (conversation) =>
        patchMessage(conversation, action.messageId, (message) =>
          message.content === ""
            ? { ...message, status: "error", error: "已停止生成" }
            : { ...message, status: "done", error: undefined },
        ),
      );
      return patched.turn?.messageId === action.messageId
        ? { ...patched, turn: null }
        : patched;
    }
  }
}