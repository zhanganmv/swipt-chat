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
  ModelProvider,
  ModelProviderTemplate,
  Protocol,
  ProviderModel,
  ThinkingEffort,
} from "../domain/provider.ts";
import { PROTOCOLS, firstModelOf } from "../domain/provider.ts";
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
  | "active_provider"
  | "active_model"
  | "active_agent"
  | "draft";

export interface Snapshot {
  conversations: Conversation[];
  currentId: string | null;
  draft: string;
  /** Provider templates, in home-page group order. */
  templates: ModelProviderTemplate[];
  /** Every configured provider, in creation order. */
  providers: ModelProvider[];
  providerId: string | null;
  /** Models configured under each provider, in insertion order. */
  models: Record<string, ProviderModel[]>;
  modelId: string | null;
  agents: Agent[];
  agentId: string | null;
}

export const emptySnapshot = (): Snapshot => ({
  conversations: [],
  currentId: null,
  draft: "",
  templates: [],
  providers: [],
  providerId: null,
  models: {},
  modelId: null,
  agents: [],
  agentId: null,
});

export type StoreOp =
  | { kind: "session"; id: string; title: string; updatedAt: number }
  | { kind: "session.delete"; id: string }
  | { kind: "message"; sessionId: string; seq: number; message: Message }
  | { kind: "provider"; provider: ModelProvider }
  | { kind: "provider.delete"; id: string }
  | {
      kind: "model";
      providerId: string;
      model: ProviderModel;
      position: number;
    }
  | { kind: "model.delete"; providerId: string; modelId: string }
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

interface TemplateRow {
  id: string;
  name: string;
  default_name: string;
  protocol: string;
  protocols: string;
  base_url: string;
  host: string;
  custom: number;
  position: number;
}

interface ModelProviderRow {
  id: string;
  template_id: string;
  name: string;
  protocol: string;
  base_url: string;
  stream: number;
  api_key: string | null;
}

interface RequestHeaderRow {
  provider_id: string;
  name: string;
  value: string;
}

interface ModelRow {
  provider_id: string;
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

const protocolOf = (value: string): Protocol =>
  PROTOCOLS.find((item) => item === value) ?? "openai-chat";

/** The seed stores the protocols a template may use as a comma-separated list. */
const protocolsOfRow = (value: string): readonly Protocol[] => {
  const list = value
    .split(",")
    .map((item) => item.trim())
    .filter((item): item is Protocol =>
      PROTOCOLS.some((protocol) => protocol === item),
    );
  return list.length === 0 ? ["openai-chat"] : list;
};

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

const templateOfRow = (row: TemplateRow): ModelProviderTemplate => ({
  id: row.id,
  name: row.name,
  defaultName: row.default_name,
  baseURL: row.base_url,
  host: row.host,
  protocol: protocolOf(row.protocol),
  protocols: protocolsOfRow(row.protocols),
  custom: ai(row.custom),
});

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

function modelOf(row: ModelRow): ProviderModel {
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

  const templates: ModelProviderTemplate[] = (
    await driver.all<TemplateRow>(
      `SELECT id, name, default_name, protocol, protocols, base_url, host, custom, position
       FROM model_provider_template ORDER BY position, id`,
    )
  ).map(templateOfRow);

  const providerRows = await driver.all<ModelProviderRow>(
    `SELECT p.id, p.template_id, p.name, p.protocol, p.base_url, p.stream, s.api_key
     FROM model_provider p LEFT JOIN model_provider_secret s ON s.provider_id = p.id
     ORDER BY p.created_at, p.id`,
  );
  const headerRows = await driver.all<RequestHeaderRow>(
    "SELECT provider_id, name, value FROM model_provider_header ORDER BY provider_id, name",
  );
  const headersByProvider = new Map<string, { name: string; value: string }[]>();
  for (const row of headerRows) {
    const list = headersByProvider.get(row.provider_id);
    const header = { name: row.name, value: row.value };
    if (list === undefined) {
      headersByProvider.set(row.provider_id, [header]);
    } else {
      list.push(header);
    }
  }

  const providers: ModelProvider[] = providerRows.map((row) => ({
    id: row.id,
    templateId: row.template_id,
    name: row.name,
    protocol: protocolOf(row.protocol),
    baseURL: row.base_url,
    apiKey: row.api_key ?? "",
    stream: ai(row.stream),
    headers: headersByProvider.get(row.id) ?? [],
  }));

  const modelRows = await driver.all<ModelRow>(
    `SELECT provider_id, id, display_name, note, max_output_tokens, context_window,
            thinking, effort, budget, temperature, top_p, image
     FROM model_provider_model ORDER BY provider_id, position, created_at, id`,
  );
  const models: Record<string, ProviderModel[]> = {};
  for (const row of modelRows) {
    const model = modelOf(row);
    const list = models[row.provider_id];
    if (list === undefined) {
      models[row.provider_id] = [model];
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

  const storedProvider = state.get("active_provider") ?? null;
  const provider =
    storedProvider !== null
      ? providers.find((item) => item.id === storedProvider)
      : undefined;
  const activeProvider = provider ?? providers[0] ?? null;

  const storedModel = state.get("active_model") ?? null;
  const providerModels =
    activeProvider === null ? [] : (models[activeProvider.id] ?? []);
  const modelId =
    storedModel !== null && providerModels.some((item) => item.id === storedModel)
      ? storedModel
      : (firstModelOf(providerModels)?.id ?? null);

  const storedAgent = state.get("active_agent") ?? null;
  const agentId =
    storedAgent !== null && agents.some((item) => item.id === storedAgent)
      ? storedAgent
      : (agents[0]?.id ?? null);

  return {
    conversations,
    currentId,
    draft: state.get("draft") ?? "",
    templates,
    providers,
    providerId: activeProvider?.id ?? null,
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

    case "provider": {
      const { provider } = op;
      await driver.run(
        `INSERT INTO model_provider
           (id, template_id, name, protocol, base_url, stream, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET
           template_id = excluded.template_id,
           name = excluded.name,
           protocol = excluded.protocol,
           base_url = excluded.base_url,
           stream = excluded.stream,
           updated_at = excluded.updated_at`,
        [
          provider.id,
          provider.templateId,
          provider.name,
          provider.protocol,
          provider.baseURL,
          provider.stream ? 1 : 0,
          Date.now(),
          Date.now(),
        ],
      );
      if (provider.apiKey === "") {
        await driver.run("DELETE FROM model_provider_secret WHERE provider_id = ?", [
          provider.id,
        ]);
      } else {
        await driver.run(
          `INSERT INTO model_provider_secret (provider_id, api_key) VALUES (?, ?)
           ON CONFLICT(provider_id) DO UPDATE SET api_key = excluded.api_key`,
          [provider.id, provider.apiKey],
        );
      }
      // Headers are a short set keyed by name; replacing them wholesale is
      // cheaper to reason about than diffing row by row.
      await driver.run("DELETE FROM model_provider_header WHERE provider_id = ?", [
        provider.id,
      ]);
      for (const header of provider.headers) {
        await driver.run(
          "INSERT INTO model_provider_header (provider_id, name, value) VALUES (?, ?, ?)",
          [provider.id, header.name, header.value],
        );
      }
      return;
    }

    case "provider.delete":
      // Models, secret and headers go with it: every child row cascades.
      await driver.run("DELETE FROM model_provider WHERE id = ?", [op.id]);
      return;

    case "model": {
      const { model } = op;
      await driver.run(
        `INSERT INTO model_provider_model
           (provider_id, id, display_name, note, max_output_tokens, context_window,
            thinking, effort, budget, temperature, top_p, image, position,
            created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(provider_id, id) DO UPDATE SET
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
          op.providerId,
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
        "DELETE FROM model_provider_model WHERE provider_id = ? AND id = ?",
        [op.providerId, op.modelId],
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