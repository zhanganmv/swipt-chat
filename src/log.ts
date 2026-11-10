import { dataDirectory } from "@swipt/api/file-system";

const MAX_LINES = 80;
const file = () => dataDirectory.file("debug.log");

let tail: Promise<void> = Promise.resolve();

const timestamp = () => {
  const now = new Date();
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}`;
};

async function append(text: string): Promise<void> {
  try {
    const handle = file();
    const stat = await handle.stat();
    const lines =
      stat === null
        ? []
        : (await handle.text()).split("\n").filter((line) => line !== "");
    lines.push(`${timestamp()} ${text}`);
    await handle.write(`${lines.slice(-MAX_LINES).join("\n")}\n`);
  } catch {
    // Logging must never break a send.
  }
}

/** Append one line to the debug log; writes are serialized and trimmed to 80 lines. */
export function logLine(text: string): Promise<void> {
  tail = tail.then(() => append(text));
  return tail;
}
