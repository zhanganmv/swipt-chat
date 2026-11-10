import { normalizeProvider } from "../domain/provider.ts";
import type {
  Agent,
  Conversation,
  Message,
  MessageStatus,
  Provider,
  Role,
} from "../domain/types.ts";

/**
 * Persistence for chat history and provider settings.
 *
 * The file layer is injected (`Driver`) so the encoding rules — versioning,
 * dropping malformed records, keeping the API key out of `provider.json` — are
 * covered by `npm test` without the Swipt host. `state/deviceFiles.ts` supplies
 * the real driver.
 */

export interface Driver {
  read(name: string): Promise<string | null>;
  write(name: string, text: string): Promise<void>;
  remove(name: string): Promise<void>;
}

const CHAT_FILE = "conversations.json";
const DRAFT_FILE = "draft.json";
const PROVIDER_FILE = "providers.json";
const SECRET_FILE = "secrets.json";
const AGENT_FILE = "agents.json";

export interface StoredChat {
  conversations: Conversation[];
  currentId: string | null;
}

export const emptyChat = (): StoredChat => ({
  conversations: [],
  currentId: null,
});

function parseJson(text: string | null): unknown {
  if (text === null) {
    return null;
  }
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function messageOf(value: unknown): Message | null {
  if (typeof value !== "object" || value === null) {
    return null;
  }
  const record = value as Record<string, unknown>;
  if (typeof record.id !== "string" || typeof record.content !== "string") {
    return null;
  }
  const role: Role = record.role === "assistant" ? "assistant" : "user";
  // A reply interrupted by a process kill must not come back as "still
  // streaming": nothing is going to finish it. An empty one is a failure,
  // a partial one is simply done.
  let status: MessageStatus;
  if (record.status === "error") {
    status = "error";
  } else if (record.status === "streaming" && role === "assistant" && record.content === "") {
    status = "error";
  } else {
    status = "done";
  }
  const message: Message = { id: record.id, role, content: record.content, status };
  if (status === "error") {
    message.error =
      typeof record.error === "string" ? record.error : "生成已中断";
  }
  return message;
}

function conversationOf(value: unknown): Conversation | null {
  if (typeof value !== "object" || value === null) {
    return null;
  }
  const record = value as Record<string, unknown>;
  if (typeof record.id !== "string") {
    return null;
  }
  const messages = Array.isArray(record.messages)
    ? record.messages.map(messageOf).filter((item): item is Message => item !== null)
    : [];
  return {
    id: record.id,
    title: typeof record.title === "string" ? record.title : "新对话",
    messages,
    updatedAt: typeof record.updatedAt === "number" ? record.updatedAt : 0,
  };
}

export function decodeChat(text: string | null): StoredChat {
  const parsed = parseJson(text);
  if (typeof parsed !== "object" || parsed === null) {
    return emptyChat();
  }
  const record = parsed as Record<string, unknown>;
  const conversations = Array.isArray(record.conversations)
    ? record.conversations
        .map(conversationOf)
        .filter((item): item is Conversation => item !== null)
    : [];
  const currentId =
    typeof record.currentId === "string" &&
    conversations.some((item) => item.id === record.currentId)
      ? record.currentId
      : null;
  return { conversations, currentId };
}

export const encodeChat = (chat: StoredChat): string =>
  JSON.stringify({ version: 1, ...chat });

export async function loadChat(driver: Driver): Promise<StoredChat> {
  return decodeChat(await driver.read(CHAT_FILE));
}

/** Timestamps are written per save so a restored list sorts like it did. */
export async function saveChat(driver: Driver, chat: StoredChat): Promise<void> {
  await driver.write(CHAT_FILE, encodeChat(chat));
}

/** The draft lives in its own file: a keystroke must not rewrite all history. */
export async function loadDraft(driver: Driver): Promise<string> {
  const parsed = parseJson(await driver.read(DRAFT_FILE));
  return typeof parsed === "object" && parsed !== null
    ? typeof (parsed as Record<string, unknown>).draft === "string"
      ? ((parsed as Record<string, unknown>).draft as string)
      : ""
    : "";
}

export async function saveDraft(driver: Driver, draft: string): Promise<void> {
  await driver.write(DRAFT_FILE, JSON.stringify({ draft }));
}

export interface StoredProviders {
  providers: Provider[];
  activeId: string | null;
}

export const emptyProviders = (): StoredProviders => ({
  providers: [],
  activeId: null,
});

function secretKeys(text: string | null): Record<string, unknown> {
  const parsed = parseJson(text);
  if (typeof parsed !== "object" || parsed === null) {
    return {};
  }
  const keys = (parsed as Record<string, unknown>).keys;
  return typeof keys === "object" && keys !== null
    ? (keys as Record<string, unknown>)
    : {};
}

export function decodeProviders(
  text: string | null,
  secrets: string | null,
): StoredProviders {
  const parsed = parseJson(text);
  const record =
    typeof parsed === "object" && parsed !== null
      ? (parsed as Record<string, unknown>)
      : {};
  const keys = secretKeys(secrets);
  const providers = (Array.isArray(record.providers) ? record.providers : [])
    .map(normalizeProvider)
    // A record without an id cannot be selected or edited, and its id is the
    // only thing tying it to the key in `secrets.json`.
    .filter((item): item is Provider => item !== null && item.id !== "")
    .map((item) => ({
      ...item,
      apiKey: typeof keys[item.id] === "string" ? (keys[item.id] as string) : "",
    }));
  const stored = typeof record.activeId === "string" ? record.activeId : null;
  const activeId =
    stored !== null && providers.some((item) => item.id === stored)
      ? stored
      : (providers[0]?.id ?? null);
  return { providers, activeId };
}

export function encodeProviders(stored: StoredProviders): string {
  return JSON.stringify(
    {
      version: 1,
      activeId: stored.activeId,
      // Keys are stripped here and live in `secrets.json` only: this is the file
      // people copy around when they report a bug.
      providers: stored.providers.map(({ apiKey: _apiKey, ...rest }) => rest),
    },
    null,
    2,
  );
}

export async function loadProviders(driver: Driver): Promise<StoredProviders> {
  return decodeProviders(
    await driver.read(PROVIDER_FILE),
    await driver.read(SECRET_FILE),
  );
}

export async function saveProviders(
  driver: Driver,
  stored: StoredProviders,
): Promise<void> {
  const keys: Record<string, string> = {};
  for (const provider of stored.providers) {
    if (provider.apiKey !== "") {
      keys[provider.id] = provider.apiKey;
    }
  }
  await driver.write(PROVIDER_FILE, encodeProviders(stored));
  await driver.write(SECRET_FILE, JSON.stringify({ version: 1, keys }, null, 2));
}

export interface StoredAgents {
  agents: Agent[];
  activeId: string | null;
}

export function decodeAgents(text: string | null): StoredAgents {
  const parsed = parseJson(text);
  const record =
    typeof parsed === "object" && parsed !== null
      ? (parsed as Record<string, unknown>)
      : {};
  const agents = (Array.isArray(record.agents) ? record.agents : [])
    .map((value): Agent | null => {
      if (typeof value !== "object" || value === null) {
        return null;
      }
      const item = value as Record<string, unknown>;
      if (typeof item.id !== "string" || item.id === "") {
        return null;
      }
      const title = typeof item.title === "string" ? item.title.trim() : "";
      return { id: item.id, title: title === "" ? "未命名智能体" : title };
    })
    .filter((item): item is Agent => item !== null);
  const stored = typeof record.activeId === "string" ? record.activeId : null;
  const activeId =
    stored !== null && agents.some((item) => item.id === stored)
      ? stored
      : (agents[0]?.id ?? null);
  return { agents, activeId };
}

export const encodeAgents = (stored: StoredAgents): string =>
  JSON.stringify({ version: 1, ...stored }, null, 2);

export async function loadAgents(driver: Driver): Promise<StoredAgents> {
  return decodeAgents(await driver.read(AGENT_FILE));
}

export async function saveAgents(
  driver: Driver,
  stored: StoredAgents,
): Promise<void> {
  await driver.write(AGENT_FILE, encodeAgents(stored));
}
