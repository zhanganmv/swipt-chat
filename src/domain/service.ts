/**
 * Model services: templates, connections (instances) and their model entries.
 *
 * Vocabulary follows `docs/model-service.md`:
 * - a **template** is a creation entry (OpenAI / Anthropic / DeepSeek / 自定义),
 *   never a managed row;
 * - an **instance** is what the user creates, groups and deletes;
 * - a **model** is one id under an instance, with its own parameters.
 *
 * Templates only decide defaults, the protocol and the group on the home page.
 * Everything else is the instance's own.
 */

/** Wire protocol of an instance. */
export type Protocol = "openai-chat" | "openai-responses" | "anthropic-messages";

/** Creation entry; also the home-page group. */
export type TemplateId = "openai" | "anthropic" | "deepseek" | "custom";

/** OpenAI reasoning intensity. */
export type ThinkingEffort = "minimal" | "low" | "medium" | "high" | "xhigh" | "max";

export interface Header {
  name: string;
  value: string;
}

export interface Instance {
  id: string;
  templateId: TemplateId;
  /** User-facing name, e.g. "OpenAI 主号"; trimmed and non-empty. */
  name: string;
  protocol: Protocol;
  baseURL: string;
  apiKey: string;
  stream: boolean;
  /** Custom request headers; auto headers can be overridden by name. */
  headers: Header[];
}

export interface Thinking {
  enabled: boolean;
  /** OpenAI protocols: the `reasoning_effort` value. */
  effort: ThinkingEffort | null;
  /** Anthropic: `budget_tokens`. */
  budget: number | null;
}

export interface ModelConfig {
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
export interface Endpoint {
  instance: Instance;
  model: ModelConfig;
}

export interface Template {
  id: TemplateId;
  vendor: string;
  /** Pre-filled name for a new instance. */
  defaultName: string;
  defaultBaseURL: string;
  /** Host of the official endpoint; a different host is worth showing. */
  officialHost: string;
  /** Protocol a new instance starts with. */
  protocol: Protocol;
  /** Protocols the instance may switch to; a single entry means read-only. */
  protocols: readonly Protocol[];
}

const OPENAI = "https://api.openai.com/v1";
const ANTHROPIC = "https://api.anthropic.com";
const DEEPSEEK = "https://api.deepseek.com/v1";

export const TEMPLATES: readonly Template[] = [
  {
    id: "openai",
    vendor: "OpenAI",
    defaultName: "OpenAI",
    defaultBaseURL: OPENAI,
    officialHost: "api.openai.com",
    protocol: "openai-chat",
    protocols: ["openai-chat", "openai-responses"],
  },
  {
    id: "anthropic",
    vendor: "Anthropic",
    defaultName: "Anthropic",
    defaultBaseURL: ANTHROPIC,
    officialHost: "api.anthropic.com",
    protocol: "anthropic-messages",
    protocols: ["anthropic-messages"],
  },
  {
    id: "deepseek",
    vendor: "DeepSeek",
    defaultName: "DeepSeek",
    defaultBaseURL: DEEPSEEK,
    officialHost: "api.deepseek.com",
    protocol: "openai-chat",
    protocols: ["openai-chat"],
  },
  {
    id: "custom",
    vendor: "自定义",
    defaultName: "",
    defaultBaseURL: "",
    officialHost: "",
    protocol: "openai-chat",
    protocols: ["openai-chat", "openai-responses", "anthropic-messages"],
  },
];

/** Home-page group order; empty groups are hidden. */
export const GROUP_ORDER: readonly TemplateId[] = [
  "openai",
  "anthropic",
  "deepseek",
  "custom",
];

export function templateOf(id: string): Template {
  return TEMPLATES.find((item) => item.id === id) ?? TEMPLATES[TEMPLATES.length - 1];
}

export function protocolsOf(templateId: TemplateId): readonly Protocol[] {
  return templateOf(templateId).protocols;
}

/** `true` when the protocol picker should be interactive on the detail page. */
export function protocolEditable(instance: Instance): boolean {
  return protocolsOf(instance.templateId).length > 1;
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

/** The link a row's title should be; the instance name is already mandatory. */
export const nameOf = (instance: Instance): string =>
  instance.name.trim() === "" ? templateOf(instance.templateId).defaultName : instance.name;

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
 * Subtitle of an instance row: the proxy host when it differs from the
 * template's official domain, nothing otherwise. Custom instances always show
 * their host.
 */
export function proxyHostOf(instance: Instance): string {
  const host = hostOf(instance.baseURL);
  return host === "" || host === templateOf(instance.templateId).officialHost
    ? ""
    : host;
}

/** "3 个模型" / "未添加模型" */
export const modelCountLabel = (count: number): string =>
  count === 0 ? "未添加模型" : `${count} 个模型`;

export function modelNameOf(model: ModelConfig | null): string {
  return model === null ? "本地 Mock" : model.displayName.trim() === "" ? model.id : model.displayName;
}

export function firstModelOf(models: readonly ModelConfig[]): ModelConfig | undefined {
  return models[0];
}

export const newThinking = (): Thinking => ({
  enabled: false,
  effort: null,
  budget: null,
});

export function newModel(id: string): ModelConfig {
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

export function newInstance(input: {
  templateId: TemplateId;
  name: string;
  protocol: Protocol;
  baseURL: string;
  apiKey: string;
}): Instance {
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

export function instanceNameError(name: string): string | null {
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
export function duplicateHeader(headers: readonly Header[], name: string): boolean {
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
export function sameInstance(left: Instance, right: Instance): boolean {
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

export function sameModelConfig(left: ModelConfig, right: ModelConfig): boolean {
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
