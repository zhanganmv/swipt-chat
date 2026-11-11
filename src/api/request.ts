import { Client } from "@swipt/api/http";

import type { ChatEndpoint, ModelProvider } from "../domain/provider.ts";
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

/**
 * One GET/POST, retried once when the connection dies with no response.
 *
 * `EOF` from the host means the server closed the socket before answering —
 * usually a flaky edge rather than a wrong request, and the retry is free
 * because nothing was written yet. Only idempotent calls are retried.
 */
async function attempt(
  client: Client,
  url: string,
  init: RequestInit,
): Promise<Response> {
  try {
    return await client.fetch(url, init);
  } catch (thrown) {
    const message = thrown instanceof Error ? thrown.message : String(thrown);
    if (init.method !== "GET" || !message.includes("EOF")) {
      throw thrown;
    }
    return client.fetch(url, init);
  }
}

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
  // Every step is named: the host's own failures arrive as bare TypeErrors, and
  // without the stage the message ("undefined is not a function") says nothing
  // about which call in the bridge is missing.
  let stage = "创建网络客户端";
  try {
    const client = new Client();
    if (typeof client.fetch !== "function") {
      throw new ChatFailure({
        kind: "network",
        detail: "当前 Swipt 版本不提供网络接口，请更新 Swipt 后重试",
      });
    }
    stage = "发送请求";
    const response = await Promise.race([
      attempt(client, url, init),
      deadline.expires,
    ]);
    stage = "读取响应";
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
    if (thrown instanceof ChatFailure) {
      throw thrown;
    }
    const message = thrown instanceof Error ? thrown.message : String(thrown);
    throw new ChatFailure({ kind: "network", detail: `${stage}失败：${message}` });
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
  endpoint: ChatEndpoint,
  messages: readonly Message[],
  stream: boolean,
  signal: AbortSignal | undefined,
): Promise<Response> {
  const deadline = new Deadline(REQUEST_TIMEOUT_MS, signal);
  return call(
    chatEndpointOf(endpoint.provider),
    {
      method: "POST",
      headers: headersOf(endpoint.provider),
      body: bodyOf(endpoint.provider, endpoint.model, messages, stream),
    },
    deadline,
  );
}

/**
 * List the models a provider exposes, which doubles as the connectivity probe:
 * a wrong address, key or protocol fails here, before the user has typed
 * anything into the chat.
 */
export async function requestModels(
  provider: ModelProvider,
  signal: AbortSignal | undefined,
): Promise<string[]> {
  const deadline = new Deadline(MODELS_TIMEOUT_MS, signal);
  const response = await call(
    modelsEndpointOf(provider),
    { method: "GET", headers: headersOf(provider) },
    deadline,
  );
  return modelIdsOf(await response.text());
}

/**
 * Reachability check for the diagnostics page.
 *
 * Deliberately independent of the user's provider: it answers "can this build
 * of Swipt send an HTTP request at all", which is a different question from
 * "is this Base URL right". Any HTTP status counts as reachable — 401 from the
 * endpoint still proves the round trip happened.
 */
const PROBE_URLS = [
  "https://api.openai.com/v1/models",
  "https://api.deepseek.com/v1/models",
  "https://api.moonshot.cn/v1/models",
] as const;

async function probeOne(url: string): Promise<string> {
  const deadline = new Deadline(15000, undefined);
  try {
    const response = await call(
      url,
      { method: "GET", headers: { authorization: "Bearer test" } },
      deadline,
    );
    return `网络可用（HTTP ${response.status}）`;
  } catch (thrown) {
    if (thrown instanceof ChatFailure) {
      if (thrown.info.kind === "http") {
        return `网络可用（HTTP ${thrown.info.status ?? "?"}）`;
      }
      return `失败（${thrown.info.detail}）`;
    }
    return `失败（${String(thrown)}）`;
  }
}

/**
 * Probes several hosts so a single tap shows whether the host network is
 * broken everywhere or only on the path to one provider.
 */
export async function networkSelfTest(): Promise<string> {
  const lines: string[] = [];
  for (const url of PROBE_URLS) {
    const host = url.replace(/^https:\/\//u, "").split("/")[0];
    lines.push(`${host}: ${await probeOne(url)}`);
  }
  return lines.join("\n");
}
