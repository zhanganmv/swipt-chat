/**
 * Domain vocabulary for Swipt Chat.
 *
 * One definition per concept, imported everywhere. Transport shapes (request
 * bodies, storage records) live in `api/` and `state/` and are mapped to these
 * types at the boundary — nothing else may redeclare a message or a conversation.
 */

export type Role = "user" | "assistant";

/**
 * Lifecycle of a single assistant reply. The reducer owns the transitions:
 * `streaming` while tokens arrive, then `done`, or `error` with a reason.
 * A user message is always `done`.
 */
export type MessageStatus = "streaming" | "done" | "error";

export interface Message {
  id: string;
  role: Role;
  content: string;
  status: MessageStatus;
  /** Set only when `status === "error"`; already user-facing Chinese text. */
  error?: string;
}

export interface Conversation {
  id: string;
  title: string;
  messages: Message[];
  updatedAt: number;
}

export interface Agent {
  id: string;
  title: string;
}

/** The reply currently being generated. At most one exists at a time. */
export interface Turn {
  conversationId: string;
  messageId: string;
}