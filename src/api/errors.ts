/**
 * Failures are classified at the boundary so the UI never has to parse prose.
 *
 * Before this, every failure was `new Error("HTTP 500 <body>")` and the screen
 * printed it verbatim; a malformed 200 response surfaced a raw `SyntaxError`.
 */
export type ChatErrorKind =
  | "timeout"
  | "http"
  | "parse"
  | "empty"
  | "network"
  | "aborted";

export interface ChatError {
  kind: ChatErrorKind;
  /** Technical detail for the log; may be English. */
  detail: string;
  status?: number;
}

export class ChatFailure extends Error {
  readonly info: ChatError;

  constructor(info: ChatError) {
    super(info.detail);
    this.name = "ChatFailure";
    this.info = info;
  }
}

/** Map anything thrown by the transport onto a classified failure. */
export function normalizeFailure(thrown: unknown): ChatError {
  if (thrown instanceof ChatFailure) {
    return thrown.info;
  }
  if (thrown instanceof Error) {
    if (thrown.name === "AbortError") {
      return { kind: "aborted", detail: thrown.message };
    }
    return { kind: "network", detail: thrown.message };
  }
  return { kind: "network", detail: String(thrown) };
}

/** One line the user can act on. */
export function describeFailure(error: ChatError): string {
  switch (error.kind) {
    case "timeout":
      return `${error.detail}，请检查网络或接口地址`;
    case "http":
      return `接口返回 HTTP ${error.status ?? ""}：${truncate(error.detail)}`;
    case "parse":
      return "接口返回的内容无法解析，请确认地址是 OpenAI 兼容接口";
    case "empty":
      return "接口没有返回任何内容";
    case "aborted":
      return "已停止生成";
    case "network":
      return `请求失败：${truncate(error.detail)}`;
  }
}

function truncate(text: string, limit = 160): string {
  const flat = text.replace(/\s+/g, " ").trim();
  return flat.length > limit ? `${flat.slice(0, limit)}…` : flat;
}