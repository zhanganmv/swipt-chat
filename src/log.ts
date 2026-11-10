import { dataDirectory } from "@swipt/api/file-system";

import { technicalOf } from "./api/errors.ts";

const MAX_LINES = 80;
const MAX_BUFFER = 200;
const file = () => dataDirectory.file("debug.log");

let tail: Promise<void> = Promise.resolve();

/** Kept in memory as well: the file bridge is the first thing a broken build loses. */
const buffer: string[] = [];

const timestamp = () => {
  const now = new Date();
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}`;
};

async function append(line: string): Promise<void> {
  try {
    const handle = file();
    const stat = await handle.stat();
    const lines =
      stat === null
        ? []
        : (await handle.text()).split("\n").filter((line) => line !== "");
    lines.push(line);
    await handle.write(`${lines.slice(-MAX_LINES).join("\n")}\n`);
  } catch {
    // Logging must never break a send.
  }
}

/** Append one line to the debug log; writes are serialized and trimmed to 80 lines. */
export function logLine(text: string): Promise<void> {
  const line = `${timestamp()} ${text}`;
  buffer.push(line);
  if (buffer.length > MAX_BUFFER) {
    buffer.shift();
  }
  tail = tail.then(() => append(line));
  return tail;
}

/** The in-memory tail, for the diagnostics page. */
export function logLines(): readonly string[] {
  return [...buffer];
}

/**
 * Record uncaught errors in the same buffer.
 *
 * Without this the failure the user reports ("undefined is not a function") is
 * only ever shown by the host's own overlay, and the file bridge may be exactly
 * what is broken.
 */
export function installErrorCapture(): void {
  const scope = globalThis as {
    ErrorUtils?: {
      getGlobalHandler?: () => (error: unknown, isFatal: boolean) => void;
      setGlobalHandler: (
        handler: (error: unknown, isFatal: boolean) => void,
      ) => void;
    };
  };
  const utils = scope.ErrorUtils;
  if (utils === undefined) {
    return;
  }
  const previous = utils.getGlobalHandler?.();
  utils.setGlobalHandler((error, isFatal) => {
    void logLine(`uncaught(${isFatal ? "fatal" : "warn"}): ${technicalOf(error)}`);
    if (previous !== undefined) {
      previous(error, isFatal);
    }
  });
}
