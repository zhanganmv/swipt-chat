/**
 * The on-device side of persistence: one SQLite file in the swiplet's data
 * directory, plus the driver that bridges `expo-sqlite` to `SqlDriver`.
 *
 * Everything SQL-shaped that can be shared with tests lives in `schema.ts` and
 * `store.ts`; this file only owns the connection.
 */
import { openDatabaseAsync, type SQLiteDatabase } from "expo-sqlite";
import { detectFts5, migrate, readFlag, writeFlag } from "./schema.ts";
import type { SqlDriver, SqlValue } from "./sql.ts";
import { applyOps, loadSnapshot, type Store } from "./store.ts";

const DB_NAME = "swipt-chat.db";

function driverOf(database: SQLiteDatabase): SqlDriver {
  return {
    exec: (sql) => database.execAsync(sql),
    run: async (sql, params = []) => {
      await database.runAsync(sql, params as SqlValue[]);
    },
    all: (sql, params = []) =>
      database.getAllAsync(sql, params as SqlValue[]),
    first: (sql, params = []) =>
      database.getFirstAsync(sql, params as SqlValue[]),
    transaction: (task) => database.withTransactionAsync(task),
  };
}

/**
 * A fresh database: v27's JSON files are deliberately not imported (P1 scope).
 * If the file cannot be opened the caller falls back to an in-memory session,
 * which is logged rather than shown — the chat still works for that run.
 */
export async function openDeviceStore(): Promise<Store> {
  const database = await openDatabaseAsync(DB_NAME);
  const driver = driverOf(database);
  await migrate(driver);

  // FTS5 is a device property, not a schema one; P6's search reads this flag to
  // choose the FTS5 path or the LIKE fallback. Writing it only when it changed
  // keeps the launch path read-only.
  const flag = (await detectFts5(driver)) ? "1" : "0";
  if ((await readFlag(driver, "fts5")) !== flag) {
    await writeFlag(driver, "fts5", flag);
  }

  return {
    load: () => loadSnapshot(driver),
    apply: (ops) => applyOps(driver, ops),
    close: () => database.closeAsync(),
  };
}