import type { Protocol } from "./domain/service.ts";

/**
 * SSE line parsing for the three protocols, kept free of host imports so it can
 * be exercised outside Swipt.
 *
 * The protocols share the `data: {...}` envelope and little else: OpenAI Chat
 * nests the delta under `choices[0].delta.content`, Responses sends typed
 * events, and Anthropic sends `content_block_delta` blocks. The end of a stream
 * is a sentinel for Chat (`[DONE]`) and an event for the other two.
 */
export interface SSEResult {
  delta: string;
  done: boolean;
}

export function readSSELine(
  rawLine: string,
  protocol: Protocol = "openai-chat",
): SSEResult | null {
  const line = rawLine.trim();
  if (line === "" || !line.startsWith("data:")) {
    return null;
  }
  const payload = line.slice(5).trim();
  if (payload === "[DONE]") {
    return { delta: "", done: true };
  }

  let chunk: Record<string, unknown>;
  try {
    chunk = JSON.parse(payload) as Record<string, unknown>;
  } catch {
    // A malformed or partial event is ignored; the next line may be complete.
    return { delta: "", done: false };
  }

  switch (protocol) {
    case "openai-chat": {
      const choices = chunk.choices as
        | { delta?: { content?: string | null } }[]
        | undefined;
      return { delta: choices?.[0]?.delta?.content ?? "", done: false };
    }

    case "openai-responses": {
      const type = typeof chunk.type === "string" ? chunk.type : "";
      if (type === "response.completed" || type === "response.failed") {
        return { delta: "", done: true };
      }
      const delta = type === "response.output_text.delta" ? chunk.delta : "";
      return { delta: typeof delta === "string" ? delta : "", done: false };
    }

    case "anthropic-messages": {
      const type = typeof chunk.type === "string" ? chunk.type : "";
      if (type === "message_stop") {
        return { delta: "", done: true };
      }
      if (type !== "content_block_delta") {
        return { delta: "", done: false };
      }
      const delta = chunk.delta as { type?: unknown; text?: unknown } | undefined;
      return {
        delta:
          delta?.type === "text_delta" && typeof delta.text === "string"
            ? delta.text
            : "",
        done: false,
      };
    }
  }
}