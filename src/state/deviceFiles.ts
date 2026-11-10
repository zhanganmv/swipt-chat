import { dataDirectory } from "@swipt/api/file-system";

import type { Driver } from "./storage.ts";

/**
 * The Swipt data directory as a `Driver`.
 *
 * Every host call is wrapped: a missing or unreadable file is an empty value,
 * never a crash on launch. This is the only file that touches `file-system`.
 */
export const deviceFiles: Driver = {
  async read(name) {
    try {
      const handle = dataDirectory.file(name);
      return (await handle.stat()) === null ? null : await handle.text();
    } catch {
      return null;
    }
  },

  async write(name, text) {
    await dataDirectory.file(name).write(text);
  },

  async remove(name) {
    try {
      const handle = dataDirectory.file(name);
      if ((await handle.stat()) !== null) {
        await handle.delete();
      }
    } catch {
      // Deleting something already gone is not an error.
    }
  },
};