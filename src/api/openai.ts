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

/** `GET /models` lives beside `POST /chat/completions` on every compatible API. */
export const modelsEndpointOf = (provider: Provider): string =>
  `${provider.baseURL.replace(/\/+$/, "")}/models`;

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
/**
 * Model ids of a `GET /models` body.
 *
 * Services disagree on the envelope (some add `object`, some paginate), but all
 * of them put `{ id }` in a `data` array. Entries without a usable id are
 * skipped rather than failing the whole list — one odd row must not hide the
 * other thirty.
 */
export function modelIdsOf(text: string): string[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new ChatFailure({ kind: "parse", detail: text });
  }
  const data = (parsed as { data?: unknown }).data;
  if (!Array.isArray(data)) {
    throw new ChatFailure({ kind: "parse", detail: text.slice(0, 200) });
  }
  const ids: string[] = [];
  const seen = new Set<string>();
  for (const item of data) {
    const id = (item as { id?: unknown } | null)?.id;
    if (typeof id !== "string" || id === "" || seen.has(id)) {
      continue;
    }
    seen.add(id);
    ids.push(id);
    if (ids.length >= 500) {
      break;
    }
  }
  return ids;
}
