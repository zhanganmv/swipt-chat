import { activeProvider } from "./provider.ts";
import type { Agent, Conversation, Message, Provider, Turn } from "./types.ts";

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
  agents: Agent[];
  agentId: string;
  /** Every configured service; the chat uses whichever `providerId` names. */
  providers: Provider[];
  providerId: string | null;
  /** Model ids the services reported, keyed by provider id. */
  models: Record<string, string[]>;
  turn: Turn | null;
  sheetOpen: boolean;
}

export type ChatAction =
  | {
      type: "hydrate";
      conversations: Conversation[];
      currentId: string | null;
      draft: string;
      providers: Provider[];
      providerId: string | null;
      agents: Agent[];
      agentId: string | null;
      models?: Record<string, string[]>;
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
  | { type: "providerAdd"; provider: Provider }
  | { type: "providerUpdate"; provider: Provider }
  | { type: "providerRemove"; id: string }
  | { type: "providerSelect"; id: string }
  | { type: "models"; providerId: string; models: string[] }
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
  agents: Agent[],
  providers: Provider[] = [],
): ChatState {
  return {
    hydrated: false,
    conversations: [],
    currentId: null,
    draft: "",
    agents,
    agentId: agents[0]?.id ?? "default",
    providers,
    providerId: providers[0]?.id ?? null,
    models: {},
    turn: null,
    sheetOpen: false,
  };
}

/** The provider the open chat talks to; `null` means the offline mock. */
export const providerOf = (state: ChatState): Provider | null =>
  activeProvider(state.providers, state.providerId);

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

export function reduce(state: ChatState, action: ChatAction): ChatState {
  switch (action.type) {
    case "hydrate":
      return {
        ...state,
        hydrated: true,
        conversations: action.conversations,
        currentId: action.currentId,
        draft: action.draft,
        providers: action.providers,
        providerId: action.providerId,
        agents: action.agents.length === 0 ? state.agents : action.agents,
        agentId: action.agentId ?? state.agentId,
        models: action.models ?? {},
      };

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

    case "providerAdd":
      return {
        ...state,
        providers: [...state.providers, action.provider],
        // The first service added becomes the active one: a freshly configured
        // chat should use it without a second tap.
        providerId: state.providerId ?? action.provider.id,
      };

    case "providerUpdate": {
      const index = state.providers.findIndex((item) => item.id === action.provider.id);
      if (index === -1) {
        return state.providers.some((item) => item.id === action.provider.id)
          ? state
          : { ...state, providers: [...state.providers, action.provider], providerId: state.providerId ?? action.provider.id };
      }
      const providers = [...state.providers];
      providers[index] = action.provider;
      return { ...state, providers };
    }

    case "providerRemove": {
      const providers = state.providers.filter((item) => item.id !== action.id);
      if (providers.length === state.providers.length) {
        return state;
      }
      const models = { ...state.models };
      delete models[action.id];
      return {
        ...state,
        providers,
        models,
        providerId:
          state.providerId === action.id ? (providers[0]?.id ?? null) : state.providerId,
      };
    }

    case "models": {
      const previous = state.models[action.providerId];
      if (
        previous !== undefined &&
        previous.length === action.models.length &&
        previous.every((id, index) => id === action.models[index])
      ) {
        return state;
      }
      return {
        ...state,
        models: { ...state.models, [action.providerId]: action.models },
      };
    }

    case "providerSelect":
      return action.id === state.providerId || !state.providers.some((item) => item.id === action.id)
        ? state
        : { ...state, providerId: action.id };

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
