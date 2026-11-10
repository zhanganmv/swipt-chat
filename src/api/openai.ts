import { ChatFailure } from "./errors.ts";
import type { Message, Provider } from "../domain/types.ts";

/**
 * The OpenAI-compatible wire format: endpoint, headers, body, response parsing.
 *
 * Pure on purpose — the one `Client.fetch` call lives in `request.ts`, so these
 * rules are covered by `npm run check` outside the Swipt host.
 */

export const endpointOf = (provider: Provider): string =>
  `${provider.baseURL.replace(/\/+$/, "")}/chat/completions`;

export const headersOf = (provider: Provider): Record<string, string> => ({
  "content-type": "application/json",
  authorization: `Bearer ${provider.apiKey}`,
});

export function bodyOf(
  messages: readonly Message[],
  provider: Provider,
  stream: boolean,
): string {
  return JSON.stringify({
    model: provider.model,
    stream,
    messages: messages.map(({ role, content }) => ({ role, content })),
  });
}

/** Text of a non-streaming completion body. */
export function completionOf(text: string): string {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new ChatFailure({ kind: "parse", detail: text });
  }
  const choices = (parsed as { choices?: { message?: { content?: unknown } }[] })
    .choices;
  const content = choices?.[0]?.message?.content;
  if (typeof content !== "string" || content === "") {
    throw new ChatFailure({ kind: "empty", detail: text });
  }
  return content;
}