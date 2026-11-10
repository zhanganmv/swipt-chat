/**
 * Row-level persistence for chat history and settings.
 *
 * The old layer rewrote four JSON files on every change (400ms apart), which
 * meant a streamed token copied the whole history, and a killed process lost
 * whatever was buffered. Here a flush is a list of `StoreOp`s that touch only
 * the rows that changed, applied in one transaction.
 *
 * The mapping — row to domain object and back — lives in this file and is
 * platform-free; `deviceSql.ts` supplies the `expo-sqlite` driver, and
 * `scripts/check.ts` runs these same functions against `node:sqlite`.
 */
import { normalizeProvider } from "../domain/provider.ts";
import type {
  Agent,
  Conversation,
  Message,
  MessageStatus,
  Provider,
  Role,
} from "../domain/types.ts";
import type { SqlDriver } from "./sql.ts";

/** Keys in `app_state` that are not a user-facing record of their own. */
export type StateKey =
  | "current_session"
  | "active_provider"
  | "active_agent"
  | "draft";

export interface Snapshot {
  conversations: Conversation[];
  currentId: string | null;
  draft: string;
  providers: Provider[];
  providerId: string | null;
  agents: Agent[];
  agentId: string | null;
  /** Model ids each service reported, keyed by provider id. */
  models: Record<string, string[]>;
}

export const emptySnapshot = (): Snapshot => ({
  conversations: [],
  currentId: null,
  draft: "",
  providers: [],
  providerId: null,
  agents: [],
  agentId: null,
  models: {},
});

export type StoreOp =
  | { kind: "session"; id: string; title: string; updatedAt: number }
  | { kind: "session.delete"; id: string }
  | { kind: "message"; sessionId: string; seq: number; message: Message }
  | { kind: "provider"; provider: Provider }
  | { kind: "provider.delete"; id: string }
  | { kind: "agent"; agent: Agent }
  | { kind: "agent.delete"; id: string }
  | { kind: "models"; providerId: string; models: readonly string[] }
  | { kind: "state"; key: StateKey; value: string | null };

interface SessionRow {
  id: string;
  title: string;
  last_activity_at: number;
}

interface MessageRow {
  id: string;
  session_id: string;
  role: string;
  content: string;
  status: string;
  error: string | null;
  seq: number;
}

interface ProviderRow {
  id: string;
  name: string;
  base_url: string;
  model: string;
  stream: number;
  api_key: string | null;
}

interface AgentRow {
  id: string;
  title: string;
}

const ai = (value: number): boolean => value !== 0;

/**
 * A reply interrupted by a process kill must not come back as "still
 * streaming": nothing is going to finish it. An empty one is a failure, a
 * partial one is simply done.
 */
function messageOf(row: MessageRow): Message {
  const role: Role = row.role === "assistant" ? "assistant" : "user";
  let status: MessageStatus;
  if (row.status === "error") {
    status = "error";
  } else if (row.status === "streaming" && role === "assistant" && row.content === "") {
    status = "error";
  } else {
    status = "done";
  }
  const message: Message = { id: row.id, role, content: row.content, status };
  if (status === "error") {
    message.error = row.error !== null && row.error !== "" ? row.error : "生成已中断";
  }
  return message;
}

export async function loadSnapshot(driver: SqlDriver): Promise<Snapshot> {
  const sessions = await driver.all<SessionRow>(
    "SELECT id, title, last_activity_at FROM session ORDER BY last_activity_at DESC, id",
  );
  const rows = await driver.all<MessageRow>(
    "SELECT id, session_id, role, content, status, error, seq FROM message ORDER BY session_id, seq",
  );

  const bySession = new Map<string, Message[]>();
  for (const row of rows) {
    const list = bySession.get(row.session_id);
    if (list === undefined) {
      bySession.set(row.session_id, [messageOf(row)]);
    } else {
      list.push(messageOf(row));
    }
  }

  const conversations: Conversation[] = sessions.map((row) => ({
    id: row.id,
    title: row.title,
    messages: bySession.get(row.id) ?? [],
    updatedAt: row.last_activity_at,
  }));

  const providerRows = await driver.all<ProviderRow>(
    `SELECT p.id, p.name, p.base_url, p.model, p.stream, s.api_key
     FROM provider p LEFT JOIN provider_secret s ON s.provider_id = p.id
     ORDER BY p.created_at, p.id`,
  );
  const providers: Provider[] = providerRows
    .map((row) =>
      normalizeProvider({
        id: row.id,
        name: row.name,
        baseURL: row.base_url,
        model: row.model,
        stream: ai(row.stream),
        apiKey: row.api_key ?? "",
      }),
    )
    .filter((item): item is Provider => item !== null && item.id !== "");

  const agentRows = await driver.all<AgentRow>(
    "SELECT id, title FROM agent ORDER BY created_at, id",
  );
  const agents: Agent[] = agentRows.map((row) => ({
    id: row.id,
    title: row.title,
  }));

  const models: Record<string, string[]> = {};
  for (const row of await driver.all<{ provider_id: string; model_id: string }>(
    "SELECT provider_id, model_id FROM model ORDER BY provider_id, model_id",
  )) {
    const list = models[row.provider_id];
    if (list === undefined) {
      models[row.provider_id] = [row.model_id];
    } else {
      list.push(row.model_id);
    }
  }

  const state = new Map<string, string>();
  for (const row of await driver.all<{ key: string; value: string }>(
    "SELECT key, value FROM app_state",
  )) {
    state.set(row.key, row.value);
  }

  const storedSession = state.get("current_session") ?? null;
  const currentId =
    storedSession !== null && conversations.some((item) => item.id === storedSession)
      ? storedSession
      : null;

  const storedProvider = state.get("active_provider") ?? null;
  const providerId =
    storedProvider !== null && providers.some((item) => item.id === storedProvider)
      ? storedProvider
      : (providers[0]?.id ?? null);

  const storedAgent = state.get("active_agent") ?? null;
  const agentId =
    storedAgent !== null && agents.some((item) => item.id === storedAgent)
      ? storedAgent
      : (agents[0]?.id ?? null);

  return {
    conversations,
    currentId,
    draft: state.get("draft") ?? "",
    providers,
    providerId,
    agents,
    agentId,
    models,
  };
}

const setState = async (
  driver: SqlDriver,
  key: StateKey,
  value: string | null,
): Promise<void> => {
  if (value === null) {
    await driver.run("DELETE FROM app_state WHERE key = ?", [key]);
    return;
  }
  await driver.run(
    `INSERT INTO app_state (key, value) VALUES (?, ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
    [key, value],
  );
};

const applyOp = async (driver: SqlDriver, op: StoreOp): Promise<void> => {
  switch (op.kind) {
    case "session":
      await driver.run(
        `INSERT INTO session (id, title, created_at, updated_at, last_activity_at)
         VALUES (?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET
           title = excluded.title,
           updated_at = excluded.updated_at,
           last_activity_at = excluded.last_activity_at`,
        [op.id, op.title, op.updatedAt, op.updatedAt, op.updatedAt],
      );
      return;

    case "session.delete":
      // Messages go with it: `message.session_id` is ON DELETE CASCADE.
      await driver.run("DELETE FROM session WHERE id = ?", [op.id]);
      return;

    case "message":
      await driver.run(
        `INSERT INTO message
           (id, session_id, role, content, status, error, seq, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET
           content = excluded.content,
           status = excluded.status,
           error = excluded.error,
           seq = excluded.seq,
           updated_at = excluded.updated_at`,
        [
          op.message.id,
          op.sessionId,
          op.message.role,
          op.message.content,
          op.message.status,
          op.message.error ?? null,
          op.seq,
          Date.now(),
          Date.now(),
        ],
      );
      return;

    case "provider":
      await driver.run(
        `INSERT INTO provider
           (id, name, base_url, model, stream, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET
           name = excluded.name,
           base_url = excluded.base_url,
           model = excluded.model,
           stream = excluded.stream,
           updated_at = excluded.updated_at`,
        [
          op.provider.id,
          op.provider.name,
          op.provider.baseURL,
          op.provider.model,
          op.provider.stream ? 1 : 0,
          Date.now(),
          Date.now(),
        ],
      );
      if (op.provider.apiKey === "") {
        await driver.run("DELETE FROM provider_secret WHERE provider_id = ?", [
          op.provider.id,
        ]);
      } else {
        await driver.run(
          `INSERT INTO provider_secret (provider_id, api_key) VALUES (?, ?)
           ON CONFLICT(provider_id) DO UPDATE SET api_key = excluded.api_key`,
          [op.provider.id, op.provider.apiKey],
        );
      }
      return;

    case "provider.delete":
      await driver.run("DELETE FROM provider WHERE id = ?", [op.id]);
      return;

    case "agent":
      await driver.run(
        `INSERT INTO agent (id, title, created_at, updated_at)
         VALUES (?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET
           title = excluded.title,
           updated_at = excluded.updated_at`,
        [op.agent.id, op.agent.title, Date.now(), Date.now()],
      );
      return;

    case "agent.delete":
      await driver.run("DELETE FROM agent WHERE id = ?", [op.id]);
      return;

    case "models":
      // Replace, not merge: a model the service stopped offering must go away,
      // otherwise the picker keeps proposing it forever.
      await driver.run("DELETE FROM model WHERE provider_id = ?", [op.providerId]);
      for (const id of op.models) {
        await driver.run(
          `INSERT INTO model (provider_id, model_id, created_at) VALUES (?, ?, ?)
           ON CONFLICT(provider_id, model_id) DO NOTHING`,
          [op.providerId, id, Date.now()],
        );
      }
      return;

    case "state":
      await setState(driver, op.key, op.value);
      return;
  }
};

/** One flush = one transaction; a failure leaves the previous rows intact. */
export async function applyOps(
  driver: SqlDriver,
  ops: readonly StoreOp[],
): Promise<void> {
  if (ops.length === 0) {
    return;
  }
  await driver.transaction(async () => {
    for (const op of ops) {
      await applyOp(driver, op);
    }
  });
}

export interface Store {
  load(): Promise<Snapshot>;
  apply(ops: readonly StoreOp[]): Promise<void>;
  close(): Promise<void>;
}