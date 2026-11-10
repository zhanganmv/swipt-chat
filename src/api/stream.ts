import { readSSELine } from "../sse.ts";
import { UTF8Decoder } from "../utf8.ts";
import { ChatFailure } from "./errors.ts";

/**
 * SSE decoding for `/chat/completions`: raw bytes in, `delta` strings out.
 *
 * Split from the request module so the chunking/UTF-8 rules can be tested
 * without a network, which is what `scripts/check.ts` does.
 */
export async function readDeltas(
  body: ReadableStream<Uint8Array>,
  onDelta: (delta: string) => void,
): Promise<number> {
  const reader = body.getReader();
  const decoder = new UTF8Decoder();
  let buffer = "";
  let received = 0;

  try {
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) {
        break;
      }
      if (chunk.value === undefined) {
        continue;
      }
      buffer += decoder.decode(chunk.value);
      let newline = buffer.indexOf("\n");
      while (newline !== -1) {
        const line = buffer.slice(0, newline).trim();
        buffer = buffer.slice(newline + 1);
        newline = buffer.indexOf("\n");
        const event = readSSELine(line);
        if (event === null) {
          continue;
        }
        if (event.done) {
          return received;
        }
        if (event.delta !== "") {
          received += 1;
          onDelta(event.delta);
        }
      }
    }
    return received;
  } finally {
    await reader.cancel().catch(() => {});
  }
}

export function assertStreamNotEmpty(received: number): void {
  if (received === 0) {
    throw new ChatFailure({
      kind: "empty",
      detail: "流式响应里没有增量，可能不是 SSE 接口",
    });
  }
}