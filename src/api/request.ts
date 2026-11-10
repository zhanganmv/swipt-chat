import { Client } from "@swipt/api/http";

import type { Endpoint, Instance } from "../domain/service.ts";
import type { Message } from "../domain/types.ts";
import { ChatFailure } from "./errors.ts";
import {
  bodyOf,
  chatEndpointOf,
  headersOf,
  modelIdsOf,
  modelsEndpointOf,
} from "./protocol.ts";

/**
 * The one place a request is actually sent.
 *
 * Kept apart from the wire format so the format stays testable: everything here
 * needs the Swipt host, nothing in `protocol.ts` does.
 */
const REQUEST_TIMEOUT_MS = 30000;
/** Listing models is a health check as much as a query: fail fast. */
const MODELS_TIMEOUT_MS = 45000;

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

async function failureOf(
  response: Response,
  guard: Guard,
  timeout: number,
): Promise<never> {
  if (guard.timedOut()) {
    throw new ChatFailure({
      kind: "timeout",
      detail: `${timeout / 1000}s 内没有响应`,
    });
  }
  const detail = await response.text().catch(() => "");
  throw new ChatFailure({
    kind: "http",
    status: response.status,
    detail: detail.trim(),
  });
}

/**
 * POST one turn and hand back the raw response.
 *
 * Failures are classified here so callers never inspect a status code: a
 * timeout and a 4xx/5xx both arrive as `ChatFailure`.
 */
export async function requestChat(
  endpoint: Endpoint,
  messages: readonly Message[],
  stream: boolean,
  signal: AbortSignal | undefined,
): Promise<Response> {
  const client = new Client();
  const guard = guardOf(signal, REQUEST_TIMEOUT_MS);
  try {
    const response = await client.fetch(chatEndpointOf(endpoint.instance), {
      method: "POST",
      headers: headersOf(endpoint.instance),
      body: bodyOf(endpoint.instance, endpoint.model, messages, stream),
      signal: guard.signal,
    });
    if (!response.ok) {
      await failureOf(response, guard, REQUEST_TIMEOUT_MS);
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
 * List the models an instance exposes, which doubles as the connectivity probe:
 * a wrong address, key or protocol fails here, before the user has typed
 * anything into the chat.
 */
export async function requestModels(
  instance: Instance,
  signal: AbortSignal | undefined,
): Promise<string[]> {
  const client = new Client();
  const guard = guardOf(signal, MODELS_TIMEOUT_MS);
  try {
    const response = await client.fetch(modelsEndpointOf(instance), {
      method: "GET",
      headers: headersOf(instance),
      signal: guard.signal,
    });
    if (!response.ok) {
      await failureOf(response, guard, MODELS_TIMEOUT_MS);
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