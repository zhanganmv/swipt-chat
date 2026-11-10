import { logLine } from "../log.ts";
import { runMock } from "../dev/mock.ts";
import type { Endpoint } from "../domain/service.ts";
import type { Message } from "../domain/types.ts";
import { ChatFailure } from "./errors.ts";
import { completionOf } from "./protocol.ts";
import { requestChat } from "./request.ts";
import { assertStreamNotEmpty, readDeltas } from "./stream.ts";

export interface TurnOptions {
  onDelta(delta: string): void;
  signal: AbortSignal;
}

/**
 * One assistant reply: pick mock or the configured endpoint, stream or wait.
 *
 * The only side effects are the `onDelta` calls and the log; the caller owns
 * state. Unknown failures pass through untouched and are classified by
 * `normalizeFailure` at the call site.
 */
export async function runTurn(
  endpoint: Endpoint | null,
  messages: readonly Message[],
  { onDelta, signal }: TurnOptions,
): Promise<void> {
  if (endpoint === null) {
    await runMock(messages, onDelta, signal);
    return;
  }

  const { instance, model } = endpoint;
  await logLine(
    `turn: ${instance.name}/${model.id} ${instance.protocol} stream=${instance.stream}`,
  );
  try {
    const response = await requestChat(
      endpoint,
      messages,
      instance.stream,
      signal,
    );
    if (instance.stream) {
      if (response.body === null) {
        throw new ChatFailure({ kind: "empty", detail: "响应没有 body" });
      }
      assertStreamNotEmpty(
        await readDeltas(response.body, onDelta, instance.protocol),
      );
    } else {
      onDelta(completionOf(await response.text(), instance.protocol));
    }
  } catch (thrown) {
    await logLine(
      `turn: failed ${thrown instanceof Error ? thrown.message : String(thrown)}`,
    );
    throw thrown;
  }
}