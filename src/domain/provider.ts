/**
 * Model providers: templates, the connections the user creates, and the models
 * configured under each connection.
 *
 * Vocabulary matches the database (`src/state/schema.ts`):
 * - a **template** (`model_provider_template`) is a creation entry and the
 *   home-page group — OpenAI / Anthropic / DeepSeek / 自定义 — seeded from SQL,
 *   never created by the user;
 * - a **provider** (`model_provider`) is what the user creates and deletes;
 * - a **model** (`model_provider_model`) is one id under a provider, with its
 *   own parameters.
 *
 * Templates only decide defaults, the protocol and the group on the home page.
 * Everything else belongs to the provider.
 */

/** Wire protocol of a provider. */
export type Protocol = "openai-chat" | "openai-responses" | "anthropic-messages";

/** Every protocol, in the order the pickers list them. */
export const PROTOCOLS: readonly Protocol[] = [
  "openai-chat",
  "openai-responses",
  "anthropic-messages",
];

/** OpenAI reasoning intensity. */
export type ThinkingEffort = "minimal" | "low" | "medium" | "high" | "xhigh" | "max";

export interface RequestHeader {
  name: string;
  value: string;
}

export interface ModelProvider {
  id: string;
  /** `model_provider_template.id` the provider was created from. */
  templateId: string;
  /** User-facing name, e.g. "OpenAI 主号"; trimmed and non-empty. */
  name: string;
  protocol: Protocol;
  baseURL: string;
  apiKey: string;
  stream: boolean;
  /** Custom request headers; auto headers can be overridden by name. */
  headers: RequestHeader[];
}

export interface Thinking {
  enabled: boolean;
  /** OpenAI protocols: the `reasoning_effort` value. */
  effort: ThinkingEffort | null;
  /** Anthropic: `budget_tokens`. */
  budget: number | null;
}

export interface ProviderModel {
  /** Model id — immutable after creation; also the row key. */
  id: string;
  displayName: string;
  note: string;
  maxOutputTokens: number | null;
  contextWindow: number | null;
  thinking: Thinking;
  temperature: number | null;
  topP: number | null;
  /** Local capability flag: whether the chat shows an image affordance. */
  image: boolean;
}

/** The pair a turn is actually sent to: a connection and one of its models. */
export interface ChatEndpoint {
  provider: ModelProvider;
  model: ProviderModel;
}

/**
 * A creation entry and home-page group.
 *
 * Rows live in `model_provider_template` and are written by the seed SQL in
 * `src/state/seed.ts`; no vendor is hard-coded here. Adding a vendor is a seed
 * change, not a code change.
 */
export interface ModelProviderTemplate {
  id: string;
  /** Vendor name, e.g. "OpenAI"; the group header on the home page. */
  name: string;
  /** Pre-filled name for a new provider; empty when the user must type one. */
  defaultName: string;
  baseURL: string;
  /** Host of the official endpoint; a different host is worth showing. */
  host: string;
  /** Protocol a new provider starts with. */
  protocol: Protocol;
  /** Protocols the provider may switch to; a single entry means read-only. */
  protocols: readonly Protocol[];
  /** The 自定义 group: third-party compatible endpoints. */
  custom: boolean;
}

/** The template row for `id`, or `undefined` once the seed dropped it. */
export function templateOf(
  templates: readonly ModelProviderTemplate[],
  id: string,
): ModelProviderTemplate | undefined {
  return templates.find((item) => item.id === id);
}

export function protocolsOf(
  templates: readonly ModelProviderTemplate[],
  templateId: string,
): readonly Protocol[] {
  return templateOf(templates, templateId)?.protocols ?? PROTOCOLS;
}

/** `true` when the protocol picker should be interactive on the detail page. */
export function protocolEditable(
  templates: readonly ModelProviderTemplate[],
  provider: ModelProvider,
): boolean {
  // A provider whose template row is gone must not offer a protocol switch:
  // nothing knows what that family supports any more.
  const template = templateOf(templates, provider.templateId);
  return template !== undefined && template.protocols.length > 1;
}

export const PROTOCOL_LABEL: Record<Protocol, string> = {
  "openai-chat": "OpenAI 兼容（Chat Completions）",
  "openai-responses": "OpenAI Responses",
  "anthropic-messages": "Anthropic Messages",
};

/** What 自定义 shows under the protocol picker. */
export function protocolFooter(protocol: Protocol): string {
  switch (protocol) {
    case "openai-chat":
      return "将在此地址后拼接 /chat/completions 与 /models。";
    case "openai-responses":
      return "将在此地址后拼接 /responses 与 /models。";
    case "anthropic-messages":
      return "将在此地址后拼接 /v1/messages 与 /v1/models，并自动注入 anthropic-version 请求头。";
  }
}

export function protocolPlaceholder(protocol: Protocol): string {
  return protocol === "anthropic-messages"
    ? "https://api.example.com"
    : "https://api.example.com/v1";
}

/** The row title: the name the user typed, or the endpoint host as a last resort. */
export const nameOf = (provider: ModelProvider): string => {
  const name = provider.name.trim();
  return name === "" ? hostOf(provider.baseURL) : name;
};

/** Host part of a URL, or `""` when it cannot be read. */
export function hostOf(value: string): string {
  const match = /^[a-zA-Z][a-zA-Z0-9+.-]*:\/\/([^/?#]+)/.exec(value.trim());
  if (match === null) {
    return "";
  }
  return match[1].replace(/^[^@]*@/, "").replace(/:\d+$/, "").toLowerCase();
}

export function isValidURL(value: string): boolean {
  const match = /^(https?):\/\/([^/?#\s]+)/i.exec(value.trim());
  return match !== null && match[2].length > 0;
}

/**
 * Subtitle of the provider row: the proxy host when it differs from the
 * template's official domain, nothing otherwise. Custom providers always show
 * their host.
 */
export function proxyHostOf(
  templates: readonly ModelProviderTemplate[],
  provider: ModelProvider,
): string {
  const host = hostOf(provider.baseURL);
  const official = templateOf(templates, provider.templateId)?.host ?? "";
  return host === "" || host === official ? "" : host;
}

/** "3 个模型" / "未添加模型" */
export const modelCountLabel = (count: number): string =>
  count === 0 ? "未添加模型" : `${count} 个模型`;

export function modelNameOf(model: ProviderModel | null): string {
  return model === null ? "本地 Mock" : model.displayName.trim() === "" ? model.id : model.displayName;
}

export function firstModelOf(models: readonly ProviderModel[]): ProviderModel | undefined {
  return models[0];
}

export const newThinking = (): Thinking => ({
  enabled: false,
  effort: null,
  budget: null,
});

export function newModel(id: string): ProviderModel {
  return {
    id,
    displayName: id,
    note: "",
    maxOutputTokens: null,
    contextWindow: null,
    thinking: newThinking(),
    temperature: null,
    topP: null,
    image: false,
  };
}

export function newProvider(input: {
  /** Row id of a `model_provider_template`; the name is the provider's. */
  templateId: string;
  name: string;
  protocol: Protocol;
  baseURL: string;
  apiKey: string;
}): ModelProvider {
  return {
    id: "",
    templateId: input.templateId,
    name: input.name.trim(),
    protocol: input.protocol,
    baseURL: input.baseURL.trim(),
    apiKey: input.apiKey.trim(),
    stream: true,
    headers: [],
  };
}

export function providerNameError(name: string): string | null {
  return name.trim() === "" ? "请输入连接名称" : null;
}

export function baseURLError(value: string): string | null {
  return isValidURL(value) ? null : "请输入有效的 URL";
}

/**
 * Anthropic extended thinking requires a budget of at least 1024 tokens and
 * strictly less than the output cap; without a cap the rule cannot be checked.
 */
export function thinkingError(
  protocol: Protocol,
  thinking: Thinking,
  maxOutputTokens: number | null,
): string | null {
  if (protocol !== "anthropic-messages" || !thinking.enabled) {
    return null;
  }
  if (maxOutputTokens === null) {
    return "请先设置最大输出 token";
  }
  const budget = thinking.budget;
  if (budget === null || !Number.isInteger(budget) || budget < 1024) {
    return "思考预算至少 1024";
  }
  if (budget >= maxOutputTokens) {
    return "思考预算必须小于最大输出 token";
  }
  return null;
}

/** A header name is present at most once, compared case-insensitively. */
export function duplicateHeader(headers: readonly RequestHeader[], name: string): boolean {
  const target = name.trim().toLowerCase();
  let seen = 0;
  for (const header of headers) {
    if (header.name.trim().toLowerCase() === target) {
      seen += 1;
    }
  }
  return seen > 1;
}

/** Field-wise equality, used to keep no-op edits from producing new state. */
export function sameProvider(left: ModelProvider, right: ModelProvider): boolean {
  return (
    left.templateId === right.templateId &&
    left.name === right.name &&
    left.protocol === right.protocol &&
    left.baseURL === right.baseURL &&
    left.stream === right.stream &&
    left.apiKey === right.apiKey &&
    left.headers.length === right.headers.length &&
    left.headers.every(
      (header, index) =>
        header.name === right.headers[index].name &&
        header.value === right.headers[index].value,
    )
  );
}

export function sameModel(left: ProviderModel, right: ProviderModel): boolean {
  return (
    left.id === right.id &&
    left.displayName === right.displayName &&
    left.note === right.note &&
    left.maxOutputTokens === right.maxOutputTokens &&
    left.contextWindow === right.contextWindow &&
    left.thinking.enabled === right.thinking.enabled &&
    left.thinking.effort === right.thinking.effort &&
    left.thinking.budget === right.thinking.budget &&
    left.temperature === right.temperature &&
    left.topP === right.topP &&
    left.image === right.image
  );
}
