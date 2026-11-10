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
 *
 * The host's `Client.fetch` only accepts *its own* `AbortSignal`, and a swiplet
 * cannot construct one — passing ours makes the call fail before it is sent
 * (`argument 2's signal is not an AbortSignal`). So cancellation is expressed
 * locally: a deadline and the caller's signal race the response, and the
 * response body is dropped when the caller stops. The request itself cannot be
 * taken back once it left, which is fine: the reply is simply ignored.
 */
const REQUEST_TIMEOUT_MS = 30000;
/** Listing models is a health check as much as a query: fail live. */
const MODELS_TIMEOUT_MS = 45000;

interface RequestInit {
  method: string;
  headers: Record<string, string>;
  body?: string;
}

/** Rejects with a classified failure on the deadline or when the caller stops. */
class Deadline {
  readonly expires: Promise<never>;
  private readonly timer: ReturnType<typeof setTimeout>;
  private readonly signal: AbortSignal | undefined;
  private readonly stop: (() => void) | undefined;

  constructor(timeout: number, signal: AbortSignal | undefined) {
    let fail: (failure: ChatFailure) => void = () => {};
    this.expires = new Promise<never>((_resolve, reject) => {
      fail = reject;
    });
    this.timer = setTimeout(() => {
      fail(
        new ChatFailure({
          kind: "timeout",
          detail: `${timeout / 1000}s 内没有响应`,
        }),
      );
    }, timeout);
    if (signal === undefined) {
      this.signal = undefined;
      this.stop = undefined;
      return;
    }
    const stop = () => {
      fail(new ChatFailure({ kind: "aborted", detail: "已停止生成" }));
    };
    this.signal = signal;
    this.stop = stop;
    if (signal.aborted) {
      stop();
    } else {
      signal.addEventListener("abort", stop);
    }
  }

  release(): void {
    clearTimeout(this.timer);
    if (this.signal !== undefined && this.stop !== undefined) {
      this.signal.removeEventListener("abort", this.stop);
    }
  }
}

type Response = Awaited<ReturnType<Client["fetch"]>>;

async function call(
  url: string,
  init: RequestInit,
  deadline: Deadline,
): Promise<Response> {
  if (typeof Client !== "function") {
    throw new ChatFailure({
      kind: "network",
      detail: "当前 Swipt 版本不提供网络接口，请更新 Swipt 后重试",
    });
  }
  const client = new Client();
  if (typeof client.fetch !== "function") {
    throw new ChatFailure({
      kind: "network",
      detail: "当前 Swipt 版本不提供网络接口，请更新 Swipt 后重试",
    });
  }
  try {
    const response = await Promise.race([
      client.fetch(url, init),
      deadline.expires,
    ]);
    if (!response.ok) {
      const detail = await response.text().catch(() => "");
      throw new ChatFailure({
        kind: "http",
        status: response.status,
        detail: detail.trim(),
      });
    }
    return response;
  } finally {
    deadline.release();
  }
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
  const deadline = new Deadline(REQUEST_TIMEOUT_MS, signal);
  return call(
    chatEndpointOf(endpoint.instance),
    {
      method: "POST",
      headers: headersOf(endpoint.instance),
      body: bodyOf(endpoint.instance, endpoint.model, messages, stream),
    },
    deadline,
  );
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
  const deadline = new Deadline(MODELS_TIMEOUT_MS, signal);
  const response = await call(
    modelsEndpointOf(instance),
    { method: "GET", headers: headersOf(instance) },
    deadline,
  );
  return modelIdsOf(await response.text());
}
