import { Client } from "@swipt/api/http";

import type { Message, Provider } from "../domain/types.ts";
import { ChatFailure } from "./errors.ts";
import {
  bodyOf,
  endpointOf,
  headersOf,
  modelIdsOf,
  modelsEndpointOf,
} from "./openai.ts";

/**
 * The one place a request is actually sent.
 *
 * Kept apart from the wire format so the format stays testable: everything here
 * needs the Swipt host, nothing in `openai.ts` does.
 */
const REQUEST_TIMEOUT_MS = 30000;
/** Listing models is a health check as much as a query: fail fast. */
const MODELS_TIMEOUT_MS = 15000;

interface Guard {
  signal: AbortSignal;
  timedOut(): boolean;
  release(): void;
}

/** Aborts on the deadline, or when the caller's signal fires. */
function guardOf(signal: AbortSignal | undefined, timeout: number): Guard {
  const controller = new AbortController();
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, timeout);
  const forward = () => controller.abort();
  if (signal !== undefined) {
    if (signal.aborted) {
      controller.abort();
    } else {
      signal.addEventListener("abort", forward);
    }
  }
  return {
    signal: controller.signal,
    timedOut: () => timedOut,
    release() {
      clearTimeout(timer);
      signal?.removeEventListener("abort", forward);
    },
  };
}

type Response = Awaited<ReturnType<Client["fetch"]>>;

/**
 * POST a chat completion and hand back the raw response.
 *
 * Failures are classified here so callers never inspect a status code: a
 * timeout and a 4xx/5xx both arrive as `ChatFailure`.
 */
export async function requestChat(
  provider: Provider,
  messages: readonly Message[],
  stream: boolean,
  signal: AbortSignal | undefined,
): Promise<Response> {
  const client = new Client();
  const guard = guardOf(signal, REQUEST_TIMEOUT_MS);
  try {
    const response = await client.fetch(endpointOf(provider), {
      method: "POST",
      headers: headersOf(provider),
      body: bodyOf(messages, provider, stream),
      signal: guard.signal,
    });
    if (!response.ok) {
      const detail = await response.text().catch(() => "");
      throw new ChatFailure({
        kind: "http",
        status: response.status,
        detail: detail.trim(),
      });
    }
    return response;
  } catch (thrown) {
    if (guard.timedOut()) {
      throw new ChatFailure({
        kind: "timeout",
        detail: `${REQUEST_TIMEOUT_MS / 1000}s 内没有响应`,
      });
    }
    throw thrown;
  } finally {
    guard.release();
  }
}

/**
 * List the models a service exposes, which doubles as the connectivity probe:
 * a wrong address, key or a service that cannot speak OpenAI all fail here,
 * before the user has typed anything into the chat.
 */
export async function requestModels(
  provider: Provider,
  signal: AbortSignal | undefined,
): Promise<string[]> {
  const client = new Client();
  const guard = guardOf(signal, MODELS_TIMEOUT_MS);
  try {
    const response = await client.fetch(modelsEndpointOf(provider), {
      method: "GET",
      headers: headersOf(provider),
      signal: guard.signal,
    });
    if (!response.ok) {
      const detail = await response.text().catch(() => "");
      throw new ChatFailure({
        kind: "http",
        status: response.status,
        detail: detail.trim(),
      });
    }
    return modelIdsOf(await response.text());
  } catch (thrown) {
    if (guard.timedOut()) {
      throw new ChatFailure({
        kind: "timeout",
        detail: `${MODELS_TIMEOUT_MS / 1000}s 内没有响应`,
      });
    }
    throw thrown;
  } finally {
    guard.release();
  }
}
