import { logLine } from "../log.ts";
import { runMock } from "../dev/mock.ts";
import type { Message, Provider } from "../domain/types.ts";
import { ChatFailure } from "./errors.ts";
import { completionOf } from "./openai.ts";
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
  provider: Provider | null,
  messages: readonly Message[],
  { onDelta, signal }: TurnOptions,
): Promise<void> {
  if (provider === null) {
    await runMock(messages, onDelta, signal);
    return;
  }

  await logLine(`turn: ${provider.model} stream=${provider.stream}`);
  try {
    const response = await requestChat(provider, messages, provider.stream, signal);
    if (provider.stream) {
      if (response.body === null) {
        throw new ChatFailure({ kind: "empty", detail: "响应没有 body" });
      }
      assertStreamNotEmpty(await readDeltas(response.body, onDelta));
    } else {
      onDelta(completionOf(await response.text()));
    }
  } catch (thrown) {
    await logLine(
      `turn: failed ${thrown instanceof Error ? thrown.message : String(thrown)}`,
    );
    throw thrown;
  }
}