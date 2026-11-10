/**
 * Chat-completions SSE line parsing, kept free of host imports so it can be
 * exercised outside Swipt.
 */
export interface SSEResult {
  delta: string;
  done: boolean;
}

export function readSSELine(rawLine: string): SSEResult | null {
  const line = rawLine.trim();
  if (line === "" || !line.startsWith("data:")) {
    return null;
  }
  const payload = line.slice(5).trim();
  if (payload === "[DONE]") {
    return { delta: "", done: true };
  }
  try {
    const chunk = JSON.parse(payload) as {
      choices?: { delta?: { content?: string | null } }[];
    };
    return { delta: chunk.choices?.[0]?.delta?.content ?? "", done: false };
  } catch {
    // A malformed or partial event is ignored; the next line may be complete.
    return { delta: "", done: false };
  }
}