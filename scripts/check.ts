import { readSSELine } from "../src/sse.ts";
import { UTF8Decoder } from "../src/utf8.ts";
import {
  EMPTY_MESSAGES,
  initialState,
  providerOf,
  messagesOf,
  reduce,
  type ChatState,
} from "../src/domain/conversation.ts";
import { newId } from "../src/domain/ids.ts";
import { normalizeProvider, titleOf } from "../src/domain/provider.ts";
import type { Provider } from "../src/domain/types.ts";
import {
  ChatFailure,
  describeFailure,
  normalizeFailure,
} from "../src/api/errors.ts";
import {
  bodyOf,
  completionOf,
  endpointOf,
  headersOf,
} from "../src/api/openai.ts";
import {
  decodeAgents,
  decodeChat,
  decodeProviders,
  encodeChat,
  loadAgents,
  loadChat,
  loadDraft,
  loadProviders,
  saveAgents,
  saveChat,
  saveDraft,
  saveProviders,
  type Driver,
  type StoredChat,
} from "../src/state/storage.ts";

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

const created = begin(initialState(AGENTS), "  你好\n世界  ", true);
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

const failedTurn = reduce(begin(initialState(AGENTS), "hi", true), {
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

const stopped = reduce(begin(initialState(AGENTS), "hi", true), {
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
  reduce(begin(initialState(AGENTS), "hi", true), {
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
  begin(begin(initialState(AGENTS), "hi", true), "x", false).currentId,
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
  messagesOf(initialState(AGENTS)),
  EMPTY_MESSAGES,
);
check(
  "messagesOf: stable empty reference",
  messagesOf(initialState(AGENTS)) === EMPTY_MESSAGES,
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
// ------------------------------------------------------- provider/agent lists
const p1 = { id: "p1", name: "一", baseURL: "https://a/v1", model: "m1", apiKey: "", stream: true };
const p2 = { id: "p2", name: "二", baseURL: "https://b/v1", model: "m2", apiKey: "", stream: true };
const withProviders = reduce(initialState(AGENTS), { type: "providerAdd", provider: p1 });
check("providers: first add becomes active", withProviders.providerId, "p1");
check("providers: listed", withProviders.providers.length, 1);
const secondProvider = reduce(withProviders, { type: "providerAdd", provider: p2 });
check("providers: adding does not steal the active one", secondProvider.providerId, "p1");
check(
  "providers: select",
  reduce(secondProvider, { type: "providerSelect", id: "p2" }).providerId,
  "p2",
);
check(
  "providers: select unknown is a no-op",
  reduce(secondProvider, { type: "providerSelect", id: "nope" }) === secondProvider,
  true,
);
check(
  "providers: update replaces in place",
  reduce(secondProvider, {
    type: "providerUpdate",
    provider: { ...p1, name: "改" },
  }).providers[0]?.name,
  "改",
);
const afterRemove = reduce(
  reduce(secondProvider, { type: "providerSelect", id: "p2" }),
  { type: "providerRemove", id: "p2" },
);
check("providers: removing the active one falls back", afterRemove.providerId, "p1");
check("providers: removing leaves the rest", afterRemove.providers.length, 1);
check("providers: providerOf follows the selection", providerOf(secondProvider)?.id, "p1");
check("providers: none configured is the mock", providerOf(initialState(AGENTS)), null);

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

// ------------------------------------------------------------------ provider
check("provider: defaults", normalizeProvider({ baseURL: " https://a/v1 ", model: "m" }), {
  id: "",
  name: "m",
  baseURL: "https://a/v1",
  model: "m",
  apiKey: "",
  stream: true,
});
check(
  "provider: keeps id and name",
  normalizeProvider({ id: "p1", name: "DeepSeek", baseURL: "https://a/v1", model: "m" })
    ?.name,
  "DeepSeek",
);
check("provider: needs model", normalizeProvider({ baseURL: "https://a" }), null);
check("provider: needs baseURL", normalizeProvider({ model: "m" }), null);
check("provider: rejects junk", normalizeProvider("nope"), null);
check("title: trims newlines", titleOf("a\n\nb"), "a b");
check(
  "title: long is cut",
  titleOf("一二三四五六七八九十一二三四五六七八九十一二三四五六"),
  "一二三四五六七八九十一二三四五六七八九十一二三四…",
);
check("title: empty", titleOf("   "), "新对话");

// ----------------------------------------------------------------- wire format
const provider: Provider = {
  id: "p1",
  name: "示例服务",
  baseURL: "https://api.example.com/v1/",
  apiKey: "sk-1",
  model: "m",
  stream: true,
};
check(
  "openai: endpoint",
  endpointOf(provider),
  "https://api.example.com/v1/chat/completions",
);
check("openai: auth header", headersOf(provider).authorization, "Bearer sk-1");
check(
  "openai: body has only role and content",
  JSON.parse(
    bodyOf(
      [{ id: "u1", role: "user", content: "hi", status: "done" }],
      provider,
      true,
    ),
  ),
  { model: "m", stream: true, messages: [{ role: "user", content: "hi" }] },
);
check(
  "openai: completion",
  completionOf(JSON.stringify({ choices: [{ message: { content: "ok" } }] })),
  "ok",
);
throws("openai: bad json", () => completionOf("not json"), "parse");
throws("openai: empty completion", () => completionOf('{"choices":[]}'), "empty");
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

// ------------------------------------------------------------------- storage
const memory = (): Driver & { files: Map<string, string> } => {
  const files = new Map<string, string>();
  return {
    files,
    read: async (name) => files.get(name) ?? null,
    write: async (name, text) => {
      files.set(name, text);
    },
    remove: async (name) => {
      files.delete(name);
    },
  };
};

const chat: StoredChat = {
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
};
check("storage: round-trip", decodeChat(encodeChat(chat)), chat);
check("storage: junk is empty", decodeChat("{"), {
  conversations: [],
  currentId: null,
});
check("storage: null is empty", decodeChat(null), {
  conversations: [],
  currentId: null,
});
check(
  "storage: drops malformed records",
  decodeChat(
    JSON.stringify({
      conversations: [
        {
          id: "c1",
          title: "t",
          messages: [{ nope: true }, { id: "m", content: "x" }],
        },
        { title: "no id" },
        "junk",
      ],
      currentId: "missing",
    }),
  ),
  {
    conversations: [
      {
        id: "c1",
        title: "t",
        updatedAt: 0,
        messages: [{ id: "m", role: "user", content: "x", status: "done" }],
      },
    ],
    currentId: null,
  },
);
check(
  "storage: interrupted empty reply becomes an error",
  decodeChat(
    JSON.stringify({
      conversations: [
        {
          id: "c1",
          messages: [
            { id: "a1", role: "assistant", content: "", status: "streaming" },
          ],
        },
      ],
      currentId: "c1",
    }),
  ).conversations[0].messages[0],
  {
    id: "a1",
    role: "assistant",
    content: "",
    status: "error",
    error: "生成已中断",
  },
);
check(
  "storage: interrupted partial reply becomes done",
  decodeChat(
    JSON.stringify({
      conversations: [
        {
          id: "c1",
          messages: [
            { id: "a1", role: "assistant", content: "半", status: "streaming" },
          ],
        },
      ],
    }),
  ).conversations[0].messages[0].status,
  "done",
);

const files = memory();
await saveChat(files, chat);
check("storage: chat written", (await loadChat(files)).conversations.length, 1);
await saveProviders(files, { providers: [provider], activeId: "p1" });
check(
  "storage: api key kept out of providers.json",
  files.files.get("providers.json")?.includes("sk-1"),
  false,
);
check(
  "storage: api key stored separately",
  files.files.get("secrets.json")?.includes("sk-1"),
  true,
);
check(
  "storage: provider reloaded with its key",
  (await loadProviders(files)).providers[0]?.apiKey,
  "sk-1",
);
check(
  "storage: active provider restored",
  (await loadProviders(files)).activeId,
  "p1",
);
check(
  "storage: record without id is dropped",
  decodeProviders(
    JSON.stringify({ providers: [{ baseURL: "https://b/v1", model: "x" }] }),
    null,
  ).providers.length,
  0,
);
check(
  "storage: stale activeId falls back to the first service",
  decodeProviders(
    JSON.stringify({
      providers: [
        { id: "a", baseURL: "https://a/v1", model: "m" },
        { id: "b", baseURL: "https://b/v1", model: "m" },
      ],
      activeId: "gone",
    }),
    null,
  ).activeId,
  "a",
);
await saveAgents(files, {
  agents: [{ id: "a1", title: "助手" }],
  activeId: "a1",
});
check(
  "storage: agents round-trip",
  (await loadAgents(files)).agents[0]?.title,
  "助手",
);
check(
  "storage: malformed agent is dropped",
  decodeAgents(JSON.stringify({ agents: [{ title: "no id" }] })).agents.length,
  0,
);
await saveDraft(files, "草稿");
check("storage: draft round-trip", await loadDraft(files), "草稿");
check("storage: missing draft is empty", await loadDraft(memory()), "");

if (failed > 0) {
  process.exit(1);
}
console.log("checks passed");