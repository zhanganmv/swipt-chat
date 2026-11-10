/**
 * The SQL surface the storage layer needs.
 *
 * `deviceSql.ts` implements it over `expo-sqlite` on device, and
 * `scripts/check.ts` implements the same interface over `node:sqlite` — so each
 * migration and query in `schema.ts` / `store.ts` is exercised against a real
 * SQLite engine outside Swipt. Anything that cannot be expressed here (PRAGMA
 * quirks, FTS5 availability) is a runtime concern and is kept in the device
 * driver or probed explicitly.
 */
export type SqlValue = string | number | boolean | null;

export interface SqlDriver {
  /** Runs one or more statements; used for DDL and PRAGMAs. */
  exec(sql: string): Promise<void>;
  /** Runs one statement, discarding rows. */
  run(sql: string, params?: readonly SqlValue[]): Promise<void>;
  all<T>(sql: string, params?: readonly SqlValue[]): Promise<T[]>;
  first<T>(sql: string, params?: readonly SqlValue[]): Promise<T | null>;
  /** Everything inside the task commits together or not at all. */
  transaction(task: () => Promise<void>): Promise<void>;
}