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
import type {
  Instance,
  ModelConfig,
  Protocol,
  TemplateId,
  ThinkingEffort,
} from "../domain/service.ts";
import { firstModelOf } from "../domain/service.ts";
import type {
  Agent,
  Conversation,
  Message,
  MessageStatus,
  Role,
} from "../domain/types.ts";
import type { SqlDriver } from "./sql.ts";

/** Keys in `app_state` that are not a user-facing record of their own. */
export type StateKey =
  | "current_session"
  | "active_instance"
  | "active_model"
  | "active_agent"
  | "draft";

export interface Snapshot {
  conversations: Conversation[];
  currentId: string | null;
  draft: string;
  /** Every configured connection, in home-page order. */
  instances: Instance[];
  instanceId: string | null;
  /** Models configured under each instance, in insertion order. */
  models: Record<string, ModelConfig[]>;
  modelId: string | null;
  agents: Agent[];
  agentId: string | null;
}

export const emptySnapshot = (): Snapshot => ({
  conversations: [],
  currentId: null,
  draft: "",
  instances: [],
  instanceId: null,
  models: {},
  modelId: null,
  agents: [],
  agentId: null,
});

export type StoreOp =
  | { kind: "session"; id: string; title: string; updatedAt: number }
  | { kind: "session.delete"; id: string }
  | { kind: "message"; sessionId: string; seq: number; message: Message }
  | { kind: "instance"; instance: Instance; position: number }
  | { kind: "instance.delete"; id: string }
  | {
      kind: "model";
      instanceId: string;
      model: ModelConfig;
      position: number;
    }
  | { kind: "model.delete"; instanceId: string; modelId: string }
  | { kind: "agent"; agent: Agent }
  | { kind: "agent.delete"; id: string }
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

interface InstanceRow {
  id: string;
  template_id: string;
  name: string;
  protocol: string;
  base_url: string;
  stream: number;
  api_key: string | null;
}

interface HeaderRow {
  instance_id: string;
  name: string;
  value: string;
}

interface ModelRow {
  instance_id: string;
  id: string;
  display_name: string;
  note: string;
  max_output_tokens: number | null;
  context_window: number | null;
  thinking: number;
  effort: string | null;
  budget: number | null;
  temperature: number | null;
  top_p: number | null;
  image: number;
}

interface AgentRow {
  id: string;
  title: string;
}

const ai = (value: number): boolean => value !== 0;

const PROTOCOLS: readonly Protocol[] = [
  "openai-chat",
  "openai-responses",
  "anthropic-messages",
];

const protocolOf = (value: string): Protocol =>
  PROTOCOLS.find((item) => item === value) ?? "openai-chat";

const TEMPLATE_IDS: readonly TemplateId[] = [
  "openai",
  "anthropic",
  "deepseek",
  "custom",
];

const templateIdOf = (value: string): TemplateId =>
  TEMPLATE_IDS.find((item) => item === value) ?? "custom";

const EFFORTS: readonly ThinkingEffort[] = [
  "minimal",
  "low",
  "medium",
  "high",
  "xhigh",
  "max",
];

const effortOf = (value: string | null): ThinkingEffort | null =>
  EFFORTS.find((item) => item === value) ?? null;

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

function modelOf(row: ModelRow): ModelConfig {
  return {
    id: row.id,
    displayName: row.display_name,
    note: row.note,
    maxOutputTokens: row.max_output_tokens,
    contextWindow: row.context_window,
    thinking: {
      enabled: ai(row.thinking),
      effort: effortOf(row.effort),
      budget: row.budget,
    },
    temperature: row.temperature,
    topP: row.top_p,
    image: ai(row.image),
  };
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

  const instanceRows = await driver.all<InstanceRow>(
    `SELECT i.id, i.template_id, i.name, i.protocol, i.base_url, i.stream, s.api_key
     FROM instance i LEFT JOIN instance_secret s ON s.instance_id = i.id
     ORDER BY i.position, i.id`,
  );
  const headerRows = await driver.all<HeaderRow>(
    "SELECT instance_id, name, value FROM instance_header ORDER BY instance_id, position",
  );
  const headersByInstance = new Map<string, { name: string; value: string }[]>();
  for (const row of headerRows) {
    const list = headersByInstance.get(row.instance_id);
    const header = { name: row.name, value: row.value };
    if (list === undefined) {
      headersByInstance.set(row.instance_id, [header]);
    } else {
      list.push(header);
    }
  }

  const instances: Instance[] = instanceRows.map((row) => ({
    id: row.id,
    templateId: templateIdOf(row.template_id),
    name: row.name,
    protocol: protocolOf(row.protocol),
    baseURL: row.base_url,
    apiKey: row.api_key ?? "",
    stream: ai(row.stream),
    headers: headersByInstance.get(row.id) ?? [],
  }));

  const modelRows = await driver.all<ModelRow>(
    `SELECT instance_id, id, display_name, note, max_output_tokens, context_window,
            thinking, effort, budget, temperature, top_p, image
     FROM model_config ORDER BY instance_id, position, created_at, id`,
  );
  const models: Record<string, ModelConfig[]> = {};
  for (const row of modelRows) {
    const model = modelOf(row);
    const list = models[row.instance_id];
    if (list === undefined) {
      models[row.instance_id] = [model];
    } else {
      list.push(model);
    }
  }

  const agentRows = await driver.all<AgentRow>(
    "SELECT id, title FROM agent ORDER BY created_at, id",
  );
  const agents: Agent[] = agentRows.map((row) => ({
    id: row.id,
    title: row.title,
  }));

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

  const storedInstance = state.get("active_instance") ?? null;
  const instance =
    storedInstance !== null
      ? instances.find((item) => item.id === storedInstance)
      : undefined;
  const activeInstance = instance ?? instances[0] ?? null;

  const storedModel = state.get("active_model") ?? null;
  const instanceModels = activeInstance === null ? [] : (models[activeInstance.id] ?? []);
  const modelId =
    storedModel !== null && instanceModels.some((item) => item.id === storedModel)
      ? storedModel
      : (firstModelOf(instanceModels)?.id ?? null);

  const storedAgent = state.get("active_agent") ?? null;
  const agentId =
    storedAgent !== null && agents.some((item) => item.id === storedAgent)
      ? storedAgent
      : (agents[0]?.id ?? null);

  return {
    conversations,
    currentId,
    draft: state.get("draft") ?? "",
    instances,
    instanceId: activeInstance?.id ?? null,
    models,
    modelId,
    agents,
    agentId,
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

    case "instance": {
      const { instance } = op;
      await driver.run(
        `INSERT INTO instance
           (id, template_id, name, protocol, base_url, stream, position, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET
           template_id = excluded.template_id,
           name = excluded.name,
           protocol = excluded.protocol,
           base_url = excluded.base_url,
           stream = excluded.stream,
           position = excluded.position,
           updated_at = excluded.updated_at`,
        [
          instance.id,
          instance.templateId,
          instance.name,
          instance.protocol,
          instance.baseURL,
          instance.stream ? 1 : 0,
          op.position,
          Date.now(),
          Date.now(),
        ],
      );
      if (instance.apiKey === "") {
        await driver.run("DELETE FROM instance_secret WHERE instance_id = ?", [
          instance.id,
        ]);
      } else {
        await driver.run(
          `INSERT INTO instance_secret (instance_id, api_key) VALUES (?, ?)
           ON CONFLICT(instance_id) DO UPDATE SET api_key = excluded.api_key`,
          [instance.id, instance.apiKey],
        );
      }
      // Headers are a short ordered list; replacing them wholesale is cheaper
      // to reason about than diffing positions row by row.
      await driver.run("DELETE FROM instance_header WHERE instance_id = ?", [
        instance.id,
      ]);
      for (let index = 0; index < instance.headers.length; index += 1) {
        const header = instance.headers[index];
        await driver.run(
          "INSERT INTO instance_header (instance_id, position, name, value) VALUES (?, ?, ?, ?)",
          [instance.id, index, header.name, header.value],
        );
      }
      return;
    }

    case "instance.delete":
      // Models, secret and headers go with it: every child row cascades.
      await driver.run("DELETE FROM instance WHERE id = ?", [op.id]);
      return;

    case "model": {
      const { model } = op;
      await driver.run(
        `INSERT INTO model_config
           (instance_id, id, display_name, note, max_output_tokens, context_window,
            thinking, effort, budget, temperature, top_p, image, position,
            created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(instance_id, id) DO UPDATE SET
           display_name = excluded.display_name,
           note = excluded.note,
           max_output_tokens = excluded.max_output_tokens,
           context_window = excluded.context_window,
           thinking = excluded.thinking,
           effort = excluded.effort,
           budget = excluded.budget,
           temperature = excluded.temperature,
           top_p = excluded.top_p,
           image = excluded.image,
           position = excluded.position,
           updated_at = excluded.updated_at`,
        [
          op.instanceId,
          model.id,
          model.displayName,
          model.note,
          model.maxOutputTokens,
          model.contextWindow,
          model.thinking.enabled ? 1 : 0,
          model.thinking.effort,
          model.thinking.budget,
          model.temperature,
          model.topP,
          model.image ? 1 : 0,
          op.position,
          Date.now(),
          Date.now(),
        ],
      );
      return;
    }

    case "model.delete":
      await driver.run(
        "DELETE FROM model_config WHERE instance_id = ? AND id = ?",
        [op.instanceId, op.modelId],
      );
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