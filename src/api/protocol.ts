import { ChatFailure } from "./errors.ts";
import type { Instance, ModelConfig, Protocol } from "../domain/service.ts";
import type { Message } from "../domain/types.ts";

/**
 * The wire format of the three protocols an instance can speak.
 *
 * Pure on purpose: the one `Client.fetch` call lives in `request.ts`, so these
 * rules stay testable outside the Swipt host.
 */

const trimURL = (value: string): string => value.replace(/\/+$/, "");

/** Where a reply is posted. */
export function chatEndpointOf(instance: Instance): string {
  switch (instance.protocol) {
    case "openai-chat":
      return `${trimURL(instance.baseURL)}/chat/completions`;
    case "openai-responses":
      return `${trimURL(instance.baseURL)}/responses`;
    case "anthropic-messages":
      return `${trimURL(instance.baseURL)}/v1/messages`;
  }
}

/** Where the model catalogue lives; also the connectivity probe. */
export function modelsEndpointOf(instance: Instance): string {
  return instance.protocol === "anthropic-messages"
    ? `${trimURL(instance.baseURL)}/v1/models`
    : `${trimURL(instance.baseURL)}/models`;
}

/** Headers the protocol injects on its own. */
export function autoHeadersOf(instance: Instance): Record<string, string> {
  if (instance.protocol === "anthropic-messages") {
    return {
      "content-type": "application/json",
      "x-api-key": instance.apiKey,
      "anthropic-version": "2023-06-01",
    };
  }
  return {
    "content-type": "application/json",
    authorization: `Bearer ${instance.apiKey}`,
  };
}

/**
 * Auto headers plus the instance's own. A user header overrides an auto one
 * with the same name regardless of case — that is the documented escape hatch
 * for a proxy that needs a different `anthropic-version`.
 */
export function headersOf(instance: Instance): Record<string, string> {
  const headers = autoHeadersOf(instance);
  for (const header of instance.headers) {
    const name = header.name.trim();
    if (name === "") {
      continue;
    }
    for (const existing of Object.keys(headers)) {
      if (existing.toLowerCase() === name.toLowerCase()) {
        delete headers[existing];
      }
    }
    headers[name] = header.value;
  }
  return headers;
}

function samplingOf(model: ModelConfig): Record<string, number> {
  const body: Record<string, number> = {};
  if (model.temperature !== null) {
    body.temperature = model.temperature;
  }
  if (model.topP !== null) {
    body.top_p = model.topP;
  }
  return body;
}

/** Request body of one turn. */
export function bodyOf(
  instance: Instance,
  model: ModelConfig,
  messages: readonly Message[],
  stream: boolean,
): string {
  const turns = messages.map(({ role, content }) => ({ role, content }));

  switch (instance.protocol) {
    case "openai-chat": {
      const body: Record<string, unknown> = {
        model: model.id,
        stream,
        messages: turns,
      };
      if (model.maxOutputTokens !== null) {
        body.max_tokens = model.maxOutputTokens;
      }
      if (model.thinking.enabled && model.thinking.effort !== null) {
        body.reasoning_effort = model.thinking.effort;
      }
      return JSON.stringify({ ...body, ...samplingOf(model) });
    }

    case "openai-responses": {
      const body: Record<string, unknown> = {
        model: model.id,
        stream,
        input: turns,
      };
      if (model.maxOutputTokens !== null) {
        body.max_output_tokens = model.maxOutputTokens;
      }
      if (model.thinking.enabled && model.thinking.effort !== null) {
        body.reasoning = { effort: model.thinking.effort };
      }
      return JSON.stringify({ ...body, ...samplingOf(model) });
    }

    case "anthropic-messages": {
      // `max_tokens` is mandatory on the Messages API; 4096 is a conservative
      // default when the model entry leaves it unset.
      const body: Record<string, unknown> = {
        model: model.id,
        stream,
        max_tokens: model.maxOutputTokens ?? 4096,
        messages: turns,
      };
      if (model.thinking.enabled) {
        body.thinking = {
          type: "enabled",
          budget_tokens: model.thinking.budget ?? 1024,
        };
        // Extended thinking pins temperature to 1 and ignores top_p; sending
        // either conflicts with the thinking block.
        return JSON.stringify(body);
      }
      return JSON.stringify({ ...body, ...samplingOf(model) });
    }
  }
}

/** Text of a non-streaming reply. */
export function completionOf(text: string, protocol: Protocol): string {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new ChatFailure({ kind: "parse", detail: text });
  }

  if (protocol === "openai-chat") {
    const choices = (parsed as { choices?: { message?: { content?: unknown } }[] })
      .choices;
    const content = choices?.[0]?.message?.content;
    if (typeof content !== "string" || content === "") {
      throw new ChatFailure({ kind: "empty", detail: text });
    }
    return content;
  }

  if (protocol === "openai-responses") {
    const outputText = (parsed as { output_text?: unknown }).output_text;
    if (typeof outputText === "string" && outputText !== "") {
      return outputText;
    }
    const output = (parsed as { output?: unknown }).output;
    if (Array.isArray(output)) {
      const parts: string[] = [];
      for (const item of output) {
        const content = (item as { content?: unknown } | null)?.content;
        if (!Array.isArray(content)) {
          continue;
        }
        for (const block of content) {
          const part = block as { type?: unknown; text?: unknown } | null;
          if (part?.type === "output_text" && typeof part.text === "string") {
            parts.push(part.text);
          }
        }
      }
      if (parts.length > 0 && parts.join("") !== "") {
        return parts.join("");
      }
    }
    throw new ChatFailure({ kind: "empty", detail: text });
  }

  const content = (parsed as { content?: unknown }).content;
  if (Array.isArray(content)) {
    const parts: string[] = [];
    for (const block of content) {
      const part = block as { type?: unknown; text?: unknown } | null;
      if (part?.type === "text" && typeof part.text === "string") {
        parts.push(part.text);
      }
    }
    const joined = parts.join("");
    if (joined !== "") {
      return joined;
    }
  }
  throw new ChatFailure({ kind: "empty", detail: text });
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