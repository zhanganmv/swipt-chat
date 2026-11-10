import { logLine } from "../log.ts";
import type { Message } from "../domain/types.ts";

/**
 * Offline echo, used until an endpoint is configured.
 *
 * Lives beside the real transport so the "no provider" path exercises the exact
 * same callback surface as a live model: same `onDelta` cadence, same abort.
 */
export async function runMock(
  messages: readonly Message[],
  onDelta: (delta: string) => void,
  signal: AbortSignal | undefined,
): Promise<void> {
  const last = [...messages].reverse().find((item) => item.role === "user");
  const reply = `（本地 Mock）收到：${last?.content ?? ""}。配置接口后即可连接真实模型。`;
  await logLine(`mock: reply ${reply.length} chars`);
  for (const char of reply) {
    if (signal?.aborted) {
      return;
    }
    onDelta(char);
    await new Promise((resolve) => setTimeout(resolve, 18));
  }
}