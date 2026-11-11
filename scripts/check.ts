import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { readSSELine } from "../src/sse.ts";
import { UTF8Decoder } from "../src/utf8.ts";
import {
  EMPTY_MESSAGES,
  endpointOf,
  initialState,
  providerOf,
  messagesOf,
  reduce,
  type ChatState,
} from "../src/domain/conversation.ts";
import { newId } from "../src/domain/ids.ts";
import { titleOf } from "../src/domain/title.ts";
import {
  PROTOCOL_LABEL,
  baseURLError,
  duplicateHeader,
  hostOf,
  modelCountLabel,
  newProvider,
  newModel,
  newThinking,
  protocolEditable,
  protocolFooter,
  proxyHostOf,
  templateOf,
  thinkingError,
  type ChatEndpoint,
  type ModelProvider,
  type ModelProviderTemplate,
  type ProviderModel,
  type Protocol,
} from "../src/domain/provider.ts";
import {
  ChatFailure,
  describeFailure,
  normalizeFailure,
} from "../src/api/errors.ts";
import {
  bodyOf,
  chatEndpointOf,
  completionOf,
  headersOf,
  modelIdsOf,
  modelsEndpointOf,
} from "../src/api/protocol.ts";
import {
  SCHEMA_VERSION,
  detectFts5,
  migrate,
} from "../src/state/schema.ts";
import type { SqlDriver } from "../src/state/sql.ts";
import {
  applyOps,
  emptySnapshot,
  loadSnapshot,
  type Snapshot,
  type StoreOp,
} from "../src/state/store.ts";
import { diffState } from "../src/state/sync.ts";

let failed = 0;

// JSON.stringify depends on key order, so compare canonical forms instead.
const canon = (value: unknown): string => {
  if (Array.isArray(value)) return `[${value.map(canon).join(",")}]`;
  if (value && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
      .map(([k, v]) => `${JSON.stringify(k)}:${canon(v)}`);
    return `{${entries.join(",")}}`;
  }
  return JSON.stringify(value) ?? String(value);
};

const check = (name: string, actual: unknown, expected: unknown) => {
  const a = canon(actual);
  const e = canon(expected);
  if (a === e) {
    console.log(`ok   ${name}`);
  } else {
    failed += 1;
    console.log(`FAIL ${name}: ${a} !== ${e}`);
  }
};
const throws = (name: string, run: () => unknown, expected: string) => {
  try {
    run();
    failed += 1;
    console.log(`FAIL ${name}: did not throw`);
  } catch (thrown) {
    if (thrown instanceof ChatFailure) {
      check(name, thrown.info.kind, expected);
    } else {
      failed += 1;
      console.log(`FAIL ${name}: wrong error ${String(thrown)}`);
    }
  }
};

/**
 * What the seed SQL is expected to produce, in group order. The database test
 * below compares the seeded rows against this, so a change to one without the
 * other fails here rather than on the phone.
 */
const TEMPLATE_FIXTURE: ModelProviderTemplate[] = [
  {
    id: "openai",
    name: "OpenAI",
    defaultName: "OpenAI",
    baseURL: "https://api.openai.com/v1",
    host: "api.openai.com",
    protocol: "openai-chat",
    protocols: ["openai-chat", "openai-responses"],
    custom: false,
  },
  {
    id: "anthropic",
    name: "Anthropic",
    defaultName: "Anthropic",
    baseURL: "https://api.anthropic.com",
    host: "api.anthropic.com",
    protocol: "anthropic-messages",
    protocols: ["anthropic-messages"],
    custom: false,
  },
  {
    id: "deepseek",
    name: "DeepSeek",
    defaultName: "DeepSeek",
    baseURL: "https://api.deepseek.com/v1",
    host: "api.deepseek.com",
    protocol: "openai-chat",
    protocols: ["openai-chat"],
    custom: false,
  },
  {
    id: "custom",
    name: "自定义",
    defaultName: "",
    baseURL: "",
    host: "",
    protocol: "openai-chat",
    protocols: ["openai-chat", "openai-responses", "anthropic-messages"],
    custom: true,
  },
];

// ---------------------------------------------------------------- SSE / UTF-8
check(
  "delta",
  readSSELine('data: {"choices":[{"delta":{"content":"你好"}}]}'),
  { delta: "你好", done: false },
);
check("done", readSSELine("data: [DONE]"), { delta: "", done: true });
check("keepalive", readSSELine(": keep-alive"), null);
check("blank", readSSELine("  "), null);
check("malformed", readSSELine("data: {oops"), { delta: "", done: false });

const bytes = new TextEncoder().encode("你好世界");
const decoder = new UTF8Decoder();
check(
  "utf8 split",
  decoder.decode(bytes.slice(0, 4)) + decoder.decode(bytes.slice(4)),
  "你好世界",
);
check(
  "utf8 invalid",
  new UTF8Decoder().decode(Uint8Array.from([0x41, 0xff, 0x42])),
  "AB",
);

// -------------------------------------------------------------------- reducer
const AGENTS = [{ id: "default", title: "Swipt Chat" }];
const begin = (state: ChatState, text: string, create: boolean): ChatState =>
  reduce(state, {
    type: "begin",
    conversationId: "c1",
    create,
    title: titleOf(text),
    userId: "u1",
    replyId: "a1",
    text,
    at: 1000,
  });

const created = begin(initialState([], AGENTS), "  你好\n世界  ", true);
check("begin: one conversation", created.conversations.length, 1);
check("begin: selected", created.currentId, "c1");
check("begin: two messages", created.conversations[0].messages.length, 2);
check(
  "begin: reply streaming",
  created.conversations[0].messages[1].status,
  "streaming",
);
check("begin: title", created.conversations[0].title, "你好 世界");
check("begin: draft cleared", created.draft, "");
check("begin: turn set", created.turn, {
  conversationId: "c1",
  messageId: "a1",
});

const streamed = reduce(created, {
  type: "delta",
  conversationId: "c1",
  messageId: "a1",
  text: "收到",
});
check("delta: appended", streamed.conversations[0].messages[1].content, "收到");
check(
  "delta: unknown message is ignored",
  reduce(streamed, {
    type: "delta",
    conversationId: "c1",
    messageId: "nope",
    text: "x",
  }).conversations[0].messages[1].content,
  "收到",
);
check(
  "delta: unknown conversation is ignored",
  reduce(streamed, {
    type: "delta",
    conversationId: "nope",
    messageId: "a1",
    text: "x",
  }).conversations.length,
  1,
);

const ended = reduce(streamed, {
  type: "end",
  conversationId: "c1",
  messageId: "a1",
  status: "done",
});
check("end: message done", ended.conversations[0].messages[1].status, "done");
check("end: turn cleared", ended.turn, null);

const failedTurn = reduce(begin(initialState([], AGENTS), "hi", true), {
  type: "end",
  conversationId: "c1",
  messageId: "a1",
  status: "error",
  error: "接口返回 HTTP 401",
});
check("error: status", failedTurn.conversations[0].messages[1].status, "error");
check(
  "error: message kept",
  failedTurn.conversations[0].messages[1].error,
  "接口返回 HTTP 401",
);
check("error: turn cleared", failedTurn.turn, null);

const stopped = reduce(begin(initialState([], AGENTS), "hi", true), {
  type: "stop",
  conversationId: "c1",
  messageId: "a1",
});
check(
  "stop: empty reply is an error",
  stopped.conversations[0].messages[1].status,
  "error",
);
check("stop: reason", stopped.conversations[0].messages[1].error, "已停止生成");
check("stop: turn cleared", stopped.turn, null);

const partial = reduce(
  reduce(begin(initialState([], AGENTS), "hi", true), {
    type: "delta",
    conversationId: "c1",
    messageId: "a1",
    text: "半句",
  }),
  { type: "stop", conversationId: "c1", messageId: "a1" },
);
check(
  "stop: partial keeps content",
  partial.conversations[0].messages[1].content,
  "半句",
);
check("stop: partial is done", partial.conversations[0].messages[1].status, "done");

const continued = begin(created, "again", false);
check("begin: appends", continued.conversations.length, 1);
check("begin: appended count", continued.conversations[0].messages.length, 4);
check(
  "begin: unknown conversation is a no-op",
  begin(begin(initialState([], AGENTS), "hi", true), "x", false).currentId,
  "c1",
);

const selected = reduce(
  { ...created, currentId: null, draft: "discard me" },
  { type: "select", id: "c1" },
);
check("select: clears draft", selected.draft, "");
check(
  "select: same id is a no-op",
  reduce(selected, { type: "select", id: "c1" }),
  selected,
);
check("newChat: clears", reduce(selected, { type: "newChat" }), {
  ...selected,
  currentId: null,
  draft: "",
  turn: null,
});
check(
  "rename",
  reduce(selected, { type: "rename", id: "c1", title: "改名" })
    .conversations[0].title,
  "改名",
);
const removed = reduce(selected, { type: "remove", id: "c1" });
check("remove: conversation gone", removed.conversations.length, 0);
check("remove: selection cleared", removed.currentId, null);
check(
  "remove: unknown id is a no-op",
  reduce(selected, { type: "remove", id: "x" }),
  selected,
);

check(
  "messagesOf: empty conversation",
  messagesOf(initialState([], AGENTS)),
  EMPTY_MESSAGES,
);
check(
  "messagesOf: stable empty reference",
  messagesOf(initialState([], AGENTS)) === EMPTY_MESSAGES,
  true,
);
check("messagesOf: current messages", messagesOf(selected).length, 2);
check(
  "agent: stable on same id",
  reduce(selected, { type: "agent", id: selected.agentId }) === selected,
  true,
);
check(
  "draft: stable on same text",
  reduce(selected, { type: "draft", text: selected.draft }) === selected,
  true,
);
// ------------------------------------------------------- provider/model lists
const inst1: ModelProvider = {
  id: "p1",
  templateId: "custom",
  name: "一",
  protocol: "openai-chat",
  baseURL: "https://a/v1",
  apiKey: "",
  stream: true,
  headers: [],
};
const inst2: ModelProvider = { ...inst1, id: "p2", name: "二", baseURL: "https://b/v1" };
const modelA = newModel("mA");
const modelB = newModel("mB");

const withInstances = reduce(initialState([], AGENTS), {
  type: "providerAdd",
  provider: inst1,
});
check("providers: first add becomes active", withInstances.providerId, "p1");
const secondInstance = reduce(withInstances, { type: "providerAdd", provider: inst2 });
check(
  "providers: adding does not steal the active one",
  secondInstance.providerId,
  "p1",
);
check(
  "providers: select",
  reduce(secondInstance, { type: "providerSelect", id: "p2" }).providerId,
  "p2",
);
check(
  "providers: select unknown is a no-op",
  reduce(secondInstance, { type: "providerSelect", id: "nope" }) === secondInstance,
  true,
);
check(
  "providers: update replaces in place",
  reduce(secondInstance, {
    type: "providerUpdate",
    provider: { ...inst1, name: "改" },
  }).providers[0]?.name,
  "改",
);

const withModel = reduce(secondInstance, {
  type: "modelAdd",
  providerId: "p1",
  model: modelA,
});
check("models: added under its provider", withModel.models.p1?.length, 1);
check("models: first model becomes the active model", withModel.modelId, "mA");
check("models: endpoint pairs provider and model", endpointOf(withModel), {
  provider: inst1,
  model: modelA,
});
check(
  "models: providerOf follows the selection",
  providerOf(withModel, "p1")?.name,
  "一",
);
check(
  "providers: removing the active one falls back",
  reduce(secondInstance, { type: "providerRemove", id: "p2" }).providerId,
  "p1",
);
check(
  "providers: removing drops its models",
  reduce(
    reduce(withModel, { type: "modelAdd", providerId: "p2", model: modelB }),
    { type: "providerRemove", id: "p2" },
  ).models,
  { p1: [modelA] },
);
check(
  "models: unknown model selection is a no-op",
  reduce(withModel, { type: "modelSelect", modelId: "nope" }) === withModel,
  true,
);
check("providers: none configured is the mock", endpointOf(initialState([], AGENTS)), null);

const withAgent = reduce(selected, {
  type: "agentAdd",
  agent: { id: "a2", title: "二号" },
});
check("agents: added", withAgent.agents.length, 2);
check(
  "agents: removing the active one falls back",
  reduce(
    reduce(withAgent, { type: "agent", id: "a2" }),
    { type: "agentRemove", id: "a2" },
  ).agentId,
  withAgent.agents[0]?.id,
);

check("ids: unique", newId("c") === newId("c"), false);

// --------------------------------------------------------------- templates
check(
  "template: seed order is the home-page group order",
  TEMPLATE_FIXTURE.map((item) => item.id),
  ["openai", "anthropic", "deepseek", "custom"],
);
check(
  "template: lookup by row id",
  templateOf(TEMPLATE_FIXTURE, "openai")?.name,
  "OpenAI",
);
check("template: an unknown id has no row", templateOf(TEMPLATE_FIXTURE, "gone"), undefined);
check(
  "template: deepseek default base url",
  templateOf(TEMPLATE_FIXTURE, "deepseek")?.baseURL,
  "https://api.deepseek.com/v1",
);
check(
  "template: anthropic is messages-only",
  templateOf(TEMPLATE_FIXTURE, "anthropic")?.protocols,
  ["anthropic-messages"],
);
check(
  "template: custom offers every protocol",
  templateOf(TEMPLATE_FIXTURE, "custom")?.protocols.length,
  3,
);
check(
  "template: only multi-protocol families allow a switch",
  [
    protocolEditable(TEMPLATE_FIXTURE, { ...inst1, templateId: "openai" }),
    protocolEditable(TEMPLATE_FIXTURE, { ...inst1, templateId: "deepseek" }),
    protocolEditable(TEMPLATE_FIXTURE, { ...inst1, templateId: "custom" }),
    protocolEditable(TEMPLATE_FIXTURE, { ...inst1, templateId: "gone" }),
  ],
  [true, false, true, false],
);

check(
  "url: host ignores userinfo, port and case",
  hostOf("https://user:pw@Proxy.Example.com:8443/v1"),
  "proxy.example.com",
);
check("url: host of junk", hostOf("nope"), "");
check(
  "url: a proxy shows its host as the row subtitle",
  proxyHostOf(TEMPLATE_FIXTURE, {
    ...inst1,
    templateId: "openai",
    baseURL: "https://proxy.example.com/v1",
  }),
  "proxy.example.com",
);
check(
  "url: the official host is not a subtitle",
  proxyHostOf(TEMPLATE_FIXTURE, {
    ...inst1,
    templateId: "openai",
    baseURL: "https://api.openai.com/v1",
  }),
  "",
);
check("url: invalid is rejected", baseURLError("api.openai.com"), "请输入有效的 URL");
check("url: valid passes", baseURLError("https://api.openai.com/v1"), null);
check("name: empty is rejected", newProvider({ templateId: "custom", name: "  ", protocol: "openai-chat", baseURL: "https://a/v1", apiKey: "" }).name, "");
check("count: none", modelCountLabel(0), "未添加模型");
check("count: some", modelCountLabel(3), "3 个模型");
check(
  "headers: duplicates are caught case-insensitively",
  duplicateHeader(
    [
      { name: "X-Test", value: "1" },
      { name: "x-test", value: "2" },
    ],
    "X-Test",
  ),
  true,
);
check(
  "headers: one occurrence is fine",
  duplicateHeader([{ name: "X-Test", value: "1" }], "x-test"),
  false,
);
check(
  "thinking: anthropic without an output cap cannot be checked",
  thinkingError(
    "anthropic-messages",
    { enabled: true, effort: null, budget: 2048 },
    null,
  ),
  "请先设置最大输出 token",
);
check(
  "thinking: budget below 1024",
  thinkingError(
    "anthropic-messages",
    { enabled: true, effort: null, budget: 512 },
    4096,
  ),
  "思考预算至少 1024",
);
check(
  "thinking: budget must stay below the cap",
  thinkingError(
    "anthropic-messages",
    { enabled: true, effort: null, budget: 4096 },
    4096,
  ),
  "思考预算必须小于最大输出 token",
);
check(
  "thinking: a valid anthropic budget",
  thinkingError(
    "anthropic-messages",
    { enabled: true, effort: null, budget: 2048 },
    4096,
  ),
  null,
);
check(
  "thinking: other protocols have no budget rule",
  thinkingError("openai-chat", { enabled: true, effort: "high", budget: 1 }, null),
  null,
);
check(
  "protocol: labels are user facing",
  PROTOCOL_LABEL["anthropic-messages"],
  "Anthropic Messages",
);
check(
  "protocol: custom footer names the paths",
  protocolFooter("openai-responses"),
  "将在此地址后拼接 /responses 与 /models。",
);

// ----------------------------------------------------------------- wire format
const inst: ModelProvider = {
  id: "i1",
  templateId: "custom",
  name: "示例服务",
  protocol: "openai-chat",
  baseURL: "https://api.example.com/v1/",
  apiKey: "sk-1",
  stream: true,
  headers: [{ name: "X-Test", value: "1" }],
};
const mdl = newModel("m");
const ep: ChatEndpoint = { provider: inst, model: mdl };
const anthropic: ModelProvider = {
  ...inst,
  protocol: "anthropic-messages",
  baseURL: "https://api.anthropic.com",
  headers: [],
};

check(
  "chat: endpoint",
  chatEndpointOf(inst),
  "https://api.example.com/v1/chat/completions",
);
check(
  "models: endpoint sits beside the chat endpoint",
  modelsEndpointOf(inst),
  "https://api.example.com/v1/models",
);
check(
  "responses: endpoint",
  chatEndpointOf({ ...inst, protocol: "openai-responses" }),
  "https://api.example.com/v1/responses",
);
check("anthropic: endpoint", chatEndpointOf(anthropic), "https://api.anthropic.com/v1/messages");
check("anthropic: models endpoint", modelsEndpointOf(anthropic), "https://api.anthropic.com/v1/models");
check(
  "model ids: come from the data array",
  modelIdsOf('{"data":[{"id":"a"},{"id":"b"}]}'),
  ["a", "b"],
);
check(
  "model ids: duplicates and unusable entries are dropped",
  modelIdsOf('{"data":[{"id":"a"},{"id":"a"},{"id":""},{"name":"x"},null]}'),
  ["a"],
);
const parseFailure = (text: string): string => {
  try {
    modelIdsOf(text);
    return "no failure";
  } catch (thrown) {
    return normalizeFailure(thrown).kind;
  }
};
check("model ids: malformed json is a parse failure", parseFailure("not json"), "parse");
check(
  "model ids: a body without a data array is a parse failure",
  parseFailure('{"models":[]}'),
  "parse",
);
check("headers: bearer plus custom", headersOf(inst), {
  "content-type": "application/json",
  authorization: "Bearer sk-1",
  "X-Test": "1",
});
check(
  "headers: anthropic uses x-api-key and injects the version",
  headersOf(anthropic),
  {
    "content-type": "application/json",
    "x-api-key": "sk-1",
    "anthropic-version": "2023-06-01",
  },
);
check(
  "headers: a custom header overrides the derived one",
  headersOf({ ...inst, headers: [{ name: "Authorization", value: "Bearer own" }] })
    ["Authorization"],
  "Bearer own",
);
check(
  "body: chat keeps role and content and nothing else",
  JSON.parse(
    bodyOf(inst, mdl, [{ id: "u1", role: "user", content: "hi", status: "done" }], true),
  ),
  { model: "m", stream: true, messages: [{ role: "user", content: "hi" }] },
);
check(
  "body: responses wraps the conversation as input",
  JSON.parse(
    bodyOf(
      { ...inst, protocol: "openai-responses" },
      mdl,
      [{ id: "u1", role: "user", content: "hi", status: "done" }],
      false,
    ),
  ),
  { model: "m", stream: false, input: [{ role: "user", content: "hi" }] },
);
check(
  "body: anthropic always carries max_tokens",
  JSON.parse(
    bodyOf(anthropic, mdl, [{ id: "u1", role: "user", content: "hi", status: "done" }], true),
  ),
  {
    model: "m",
    stream: true,
    max_tokens: 4096,
    messages: [{ role: "user", content: "hi" }],
  },
);
const thinkingModel: ProviderModel = {
  ...mdl,
  maxOutputTokens: 4096,
  thinking: { enabled: true, effort: null, budget: 2048 },
};
check(
  "body: anthropic thinking budget and suppressed sampling",
  JSON.parse(
    bodyOf(anthropic, { ...thinkingModel, temperature: 0.5 }, [], false),
  ),
  {
    model: "m",
    stream: false,
    max_tokens: 4096,
    thinking: { type: "enabled", budget_tokens: 2048 },
    messages: [],
  },
);
check(
  "body: openai reasoning effort",
  JSON.parse(
    bodyOf(
      inst,
      { ...mdl, thinking: { enabled: true, effort: "high", budget: null } },
      [],
      true,
    ),
  ),
  { model: "m", stream: true, reasoning_effort: "high", messages: [] },
);
check(
  "completion: chat",
  completionOf(JSON.stringify({ choices: [{ message: { content: "ok" } }] }), "openai-chat"),
  "ok",
);
check(
  "completion: responses",
  completionOf(
    JSON.stringify({
      output: [{ content: [{ type: "output_text", text: "ok" }] }],
    }),
    "openai-responses",
  ),
  "ok",
);
check(
  "completion: anthropic",
  completionOf(
    JSON.stringify({ content: [{ type: "text", text: "ok" }] }),
    "anthropic-messages",
  ),
  "ok",
);
throws("completion: bad json", () => completionOf("not json", "openai-chat"), "parse");
throws(
  "completion: empty",
  () => completionOf('{"choices":[]}', "openai-chat"),
  "empty",
);
check(
  "sse: anthropic text delta",
  readSSELine('data: {"type":"content_block_delta","delta":{"type":"text_delta","text":"hi"}}', "anthropic-messages"),
  { delta: "hi", done: false },
);
check(
  "sse: anthropic stop",
  readSSELine('data: {"type":"message_stop"}', "anthropic-messages"),
  { delta: "", done: true },
);
check(
  "sse: responses delta",
  readSSELine('data: {"type":"response.output_text.delta","delta":"hi"}', "openai-responses"),
  { delta: "hi", done: false },
);
check(
  "title: trims newlines",
  titleOf("a\n\nb"),
  "a b",
);
check(
  "title: long is cut",
  titleOf("一二三四五六七八九十一二三四五六七八九十一二三四五六"),
  "一二三四五六七八九十一二三四五六七八九十一二三四…",
);
check("title: empty", titleOf("   "), "新对话");

check(
  "errors: http line",
  describeFailure({ kind: "http", status: 401, detail: "bad key" }),
  "接口返回 HTTP 401：bad key",
);
check(
  "errors: abort passes through",
  normalizeFailure(Object.assign(new Error("aborted"), { name: "AbortError" }))
    .kind,
  "aborted",
);

// ------------------------------------------------------------------ database
// The storage layer is exercised against a real SQLite engine (`node:sqlite`,
// same SQL dialect as the device bridge) instead of a JSON fake, so migrations,
// joins and cascades are tested as written.
const sqlite = async (): Promise<SqlDriver> => {
  const { DatabaseSync } = await import("node:sqlite");
  const db = new DatabaseSync(":memory:");
  db.exec("PRAGMA foreign_keys = ON");
  return {
    exec: async (sql) => {
      db.exec(sql);
    },
    run: async (sql, params = []) => {
      db.prepare(sql).run(...(params as never[]));
    },
    all: async <T>(sql: string, params: readonly unknown[] = []) =>
      db.prepare(sql).all(...(params as never[])) as T[],
    first: async <T>(sql: string, params: readonly unknown[] = []) =>
      (db.prepare(sql).get(...(params as never[])) ?? null) as T | null,
    transaction: async (task) => {
      db.exec("BEGIN");
      try {
        await task();
        db.exec("COMMIT");
      } catch (thrown) {
        db.exec("ROLLBACK");
        throw thrown;
      }
    },
  };
};

const db = await sqlite();
check("db: migration lands the schema version", await migrate(db), SCHEMA_VERSION);
check("db: migration is idempotent", await migrate(db), SCHEMA_VERSION);
check(
  "db: a fresh database has the templates and nothing else",
  await loadSnapshot(db),
  { ...emptySnapshot(), templates: TEMPLATE_FIXTURE } satisfies Snapshot,
);
check(
  "db: the seed is what the fixture says it is",
  (await loadSnapshot(db)).templates,
  TEMPLATE_FIXTURE,
);
check(
  "db: the seed is an upsert, not a second copy",
  (await db.first<{ n: number }>("SELECT count(*) AS n FROM model_provider_template"))
    ?.n,
  4,
);
check(
  "db: a provider has no position column",
  (await db.all<{ name: string }>("PRAGMA table_info(model_provider)")).map(
    (column) => column.name,
  ),
  ["id", "template_id", "name", "protocol", "base_url", "stream", "created_at", "updated_at"],
);
check(
  "db: a header is keyed by name, not by position",
  (await db.all<{ name: string }>("PRAGMA table_info(model_provider_header)")).map(
    (column) => column.name,
  ),
  ["provider_id", "name", "value"],
);
check(
  "db: v3 tables are gone",
  (await db.all<{ name: string }>(
    `SELECT name FROM sqlite_master
     WHERE type = 'table' AND name IN ('instance', 'instance_secret', 'instance_header',
                                       'model_config', 'provider', 'provider_secret')`,
  )).map((row) => row.name),
  [],
);
check(
  "db: models are ordered by position",
  (await db.all<{ name: string }>(
    "SELECT name FROM sqlite_master WHERE type = 'index' AND name = 'model_provider_model_order'",
  )).map((row) => row.name),
  ["model_provider_model_order"],
);
check("db: fts5 probe answers", typeof (await detectFts5(db)), "boolean");
check(
  "db: fts5 probe leaves no table behind",
  (await db.first<{ n: number }>(
    "SELECT count(*) AS n FROM sqlite_master WHERE name = 'fts5_probe'",
  ))?.n,
  0,
);

const chat: ChatState = {
  hydrated: true,
  conversations: [
    {
      id: "c1",
      title: "对话",
      updatedAt: 5,
      messages: [
        { id: "u1", role: "user", content: "hi", status: "done" },
        { id: "a1", role: "assistant", content: "hello", status: "done" },
      ],
    },
  ],
  currentId: "c1",
  draft: "草稿",
  templates: TEMPLATE_FIXTURE,
  providers: [inst],
  providerId: "i1",
  models: { i1: [mdl] },
  modelId: "m",
  agents: [{ id: "default", title: "Swipt Chat" }],
  agentId: "default",
  turn: null,
  sheetOpen: false,
};

const seed: StoreOp[] = [
  { kind: "session", id: "c1", title: "对话", updatedAt: 5 },
  { kind: "message", sessionId: "c1", seq: 0, message: chat.conversations[0].messages[0] },
  { kind: "message", sessionId: "c1", seq: 1, message: chat.conversations[0].messages[1] },
  { kind: "provider", provider: inst },
  { kind: "model", providerId: "i1", model: mdl, position: 0 },
  { kind: "agent", agent: { id: "default", title: "Swipt Chat" } },
  { kind: "state", key: "current_session", value: "c1" },
  { kind: "state", key: "active_provider", value: "i1" },
  { kind: "state", key: "active_model", value: "m" },
  { kind: "state", key: "active_agent", value: "default" },
  { kind: "state", key: "draft", value: "草稿" },
];
await applyOps(db, seed);
check("db: round-trip through rows", await loadSnapshot(db), {
  conversations: chat.conversations,
  currentId: "c1",
  draft: "草稿",
  templates: TEMPLATE_FIXTURE,
  providers: [inst],
  providerId: "i1",
  models: { i1: [mdl] },
  modelId: "m",
  agents: chat.agents,
  agentId: "default",
} satisfies Snapshot);

check(
  "db: api key is not a column of provider",
  (await db.all<{ name: string }>("PRAGMA table_info(model_provider)")).some(
    (column) => column.name === "api_key",
  ),
  false,
);
check(
  "db: api key lives in its own table",
  (await db.first<{ api_key: string }>(
    "SELECT api_key FROM model_provider_secret WHERE provider_id = ?",
    ["i1"],
  ))?.api_key,
  "sk-1",
);
check(
  "db: custom headers are read back by name",
  (await db.first<{ name: string; value: string }>(
    "SELECT name, value FROM model_provider_header WHERE provider_id = ?",
    ["i1"],
  )),
  { name: "X-Test", value: "1" },
);

// The whole point of the rewrite: a streamed token changes exactly one row.
const streamedChat: ChatState = {
  ...chat,
  conversations: [
    {
      ...chat.conversations[0],
      updatedAt: 6,
      messages: [
        chat.conversations[0].messages[0],
        { id: "a1", role: "assistant", content: "hello there", status: "streaming" },
      ],
    },
  ],
};
const tokenOps = diffState(chat, streamedChat);
check(
  "sync: one token touches one message and one session row",
  tokenOps.map((op) => op.kind),
  ["session", "message"],
);
check("sync: unchanged state produces no writes", diffState(chat, chat), []);
check(
  "sync: delete is expressed as a delete",
  diffState(chat, { ...chat, conversations: [] }).map((op) => op.kind),
  ["session.delete"],
);
await applyOps(db, tokenOps);
check(
  "db: streamed content replaces the row instead of appending",
  (await loadSnapshot(db)).conversations[0].messages[1].content,
  "hello there",
);
check(
  "db: a part-streamed reply reloads as done",
  (await loadSnapshot(db)).conversations[0].messages[1].status,
  "done",
);

await applyOps(db, [
  {
    kind: "message",
    sessionId: "c1",
    seq: 2,
    message: {
      id: "a2",
      role: "assistant",
      content: "",
      status: "streaming",
    },
  },
]);
check(
  "db: an empty interrupted reply becomes an error",
  (await loadSnapshot(db)).conversations[0].messages[2],
  {
    id: "a2",
    role: "assistant",
    content: "",
    status: "error",
    error: "生成已中断",
  },
);

check(
  "db: stale current session is dropped",
  await applyOps(db, [{ kind: "state", key: "current_session", value: "gone" }]),
  undefined,
);
check("db: stale current session falls back", (await loadSnapshot(db)).currentId, null);

check(
  "db: stale active provider falls back to the first connection",
  (await applyOps(db, [
    { kind: "state", key: "active_provider", value: "gone" },
  ])),
  undefined,
);
check("db: active provider fallback", (await loadSnapshot(db)).providerId, "i1");
check(
  "db: stale active model falls back to the provider's first model",
  (await applyOps(db, [{ kind: "state", key: "active_model", value: "gone" }])),
  undefined,
);
check("db: active model fallback", (await loadSnapshot(db)).modelId, "m");

await applyOps(db, [{ kind: "session.delete", id: "c1" }]);
check(
  "db: deleting a session drops its messages",
  (await db.first<{ n: number }>("SELECT count(*) AS n FROM message"))?.n,
  0,
);
check(
  "db: draft is not history",
  (await loadSnapshot(db)).draft,
  "草稿",
);

// ------------------------------------------------------------ model configs
await applyOps(db, [
  { kind: "model", providerId: "i1", model: { ...mdl, displayName: "改名" }, position: 0 },
]);
check(
  "db: editing a model upserts instead of duplicating",
  (await db.first<{ n: number }>("SELECT count(*) AS n FROM model_provider_model"))?.n,
  1,
);
check(
  "db: a renamed model keeps its id",
  (await loadSnapshot(db)).models.i1[0],
  { ...mdl, displayName: "改名" },
);
check(
  "sync: a changed model is one op",
  diffState(chat, {
    ...chat,
    models: { i1: [{ ...mdl, displayName: "改名" }] },
  }).map((op) => op.kind),
  ["model"],
);
check(
  "sync: an unchanged model writes nothing",
  diffState(
    { ...chat, models: { i1: [mdl] } },
    { ...chat, models: { i1: [mdl] } },
  ),
  [],
);

const withRenamed = reduce(chat, {
  type: "modelUpdate",
  providerId: "i1",
  model: { ...mdl, displayName: "改名" },
});
check("state: a model is edited in place", withRenamed.models.i1[0].displayName, "改名");
check(
  "state: the same model twice is not a new state",
  reduce(withRenamed, {
    type: "modelUpdate",
    providerId: "i1",
    model: { ...mdl, displayName: "改名" },
  }) === withRenamed,
  true,
);
check(
  "state: removing a connection drops its models",
  reduce(withRenamed, { type: "providerRemove", id: "i1" }).models,
  {},
);

await applyOps(db, [{ kind: "provider.delete", id: "i1" }]);
check(
  "db: deleting a connection drops its models",
  (await db.first<{ n: number }>("SELECT count(*) AS n FROM model_provider_model"))?.n,
  0,
);
check(
  "db: deleting a connection drops its key",
  (await db.first<{ n: number }>(
    "SELECT count(*) AS n FROM model_provider_secret",
  ))?.n,
  0,
);
check(
  "db: deleting a connection drops its headers",
  (await db.first<{ n: number }>(
    "SELECT count(*) AS n FROM model_provider_header",
  ))?.n,
  0,
);

// `useNativeState` hands back a native shared object with exactly `value`,
// `get`, `set` and `onChange`. It has no `clear()` and no `setText()`, and
// calling either throws "undefined is not a function" from the mount effect of
// the sheet that holds the field. The host then tears the whole screen down,
// which reads like a network failure and is not one.
const sourceRoot = fileURLToPath(new URL("../src", import.meta.url));
const sourceFiles = readdirSync(sourceRoot, { recursive: true })
  .map((entry) => String(entry))
  .filter((entry) => entry.endsWith(".ts") || entry.endsWith(".tsx"));
const forbiddenCalls = sourceFiles.flatMap((relative) =>
  readFileSync(`${sourceRoot}/${relative}`, "utf8")
    .split("\n")
    .flatMap((line, index) =>
      /\.(clear|setText)\(/.test(line) ? [`${relative}:${index + 1}`] : [],
    ),
);
check(
  "ui: native states are only reached through get/set",
  forbiddenCalls,
  [],
);

// A `NavigationLink` whose value has no matching `NavigationDestination` does
// not fail loudly: the native destination resolves the value against the
// registered slots and renders nothing, so the link pushes a blank page
// (v36 shipped `provider/<id>` against a `providers/<id>` destination).
// Routes are built in `src/routes.ts`; this scan keeps every static link paired
// with a destination and keeps hand-written route strings out of the screens.
const tsxSources = sourceFiles
  .filter((entry) => entry.endsWith(".tsx"))
  .map((entry) => ({
    path: entry,
    text: readFileSync(`${sourceRoot}/${entry}`, "utf8"),
  }));
const collect = (pattern: RegExp): { path: string; value: string }[] =>
  tsxSources.flatMap(({ path, text }) =>
    Array.from(text.matchAll(pattern), (match) => ({ path, value: match[1] })),
  );
const destinations = new Set(
  collect(/<NavigationDestination\b[^>]*value="([^"]*)"/g).map((hit) => hit.value),
);
const unmatchedLinks = [
  ...collect(/<NavigationLink\b[^>]*value="([^"]*)"/g),
  ...collect(/<Row\b[^>]*value="([^"]*)"/g),
]
  .filter((hit) => !destinations.has(hit.value))
  .map((hit) => `${hit.path}: ${hit.value}`);
check("ui: every static navigation link has a destination", unmatchedLinks, []);

const dynamicRoutes = tsxSources
  .flatMap(({ path, text }) =>
    Array.from(
      text.matchAll(/<NavigationLink\b[^>]*value=\{`/g),
      () => path,
    ),
  );
check(
  "ui: route strings are built by src/routes.ts, not in a link",
  dynamicRoutes,
  [],
);

if (failed > 0) {
  process.exit(1);
}
console.log("checks passed");