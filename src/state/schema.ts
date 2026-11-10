/**
 * The database schema and its migration ladder.
 *
 * Rules:
 * - `PRAGMA user_version` is the only version marker; there is no migration
 *   table to fall out of sync with the file.
 * - A migration is a list of statements applied in one transaction, so a
 *   half-created schema is never left behind.
 * - Migrations are append-only. Editing a shipped one would silently skip it on
 *   every device that already ran it.
 *
 * This is a fresh database: v27's JSON files (`conversations.json`,
 * `providers.json`, `secrets.json`, `agents.json`, `draft.json`) are not
 * imported. On first launch after this build the app starts empty, which is the
 * agreed scope for P1.
 */
import type { SqlDriver } from "./sql.ts";

export const SCHEMA_VERSION = 2;

export interface Migration {
  version: number;
  statements: readonly string[];
}

/** Provider secrets live in their own table: listing services never reads keys. */
const V1 = [
  `CREATE TABLE provider (
     id TEXT PRIMARY KEY NOT NULL,
     name TEXT NOT NULL,
     base_url TEXT NOT NULL,
     model TEXT NOT NULL,
     stream INTEGER NOT NULL DEFAULT 1,
     created_at INTEGER NOT NULL,
     updated_at INTEGER NOT NULL
   )`,
  `CREATE TABLE provider_secret (
     provider_id TEXT PRIMARY KEY NOT NULL
       REFERENCES provider(id) ON DELETE CASCADE,
     api_key TEXT NOT NULL
   )`,
  `CREATE TABLE agent (
     id TEXT PRIMARY KEY NOT NULL,
     title TEXT NOT NULL,
     created_at INTEGER NOT NULL,
     updated_at INTEGER NOT NULL
   )`,
  `CREATE TABLE session (
     id TEXT PRIMARY KEY NOT NULL,
     title TEXT NOT NULL,
     created_at INTEGER NOT NULL,
     updated_at INTEGER NOT NULL,
     last_activity_at INTEGER NOT NULL
   )`,
  `CREATE TABLE message (
     id TEXT PRIMARY KEY NOT NULL,
     session_id TEXT NOT NULL
       REFERENCES session(id) ON DELETE CASCADE,
     role TEXT NOT NULL,
     content TEXT NOT NULL,
     status TEXT NOT NULL,
     error TEXT,
     seq INTEGER NOT NULL,
     created_at INTEGER NOT NULL,
     updated_at INTEGER NOT NULL
   )`,
  `CREATE INDEX message_session_seq ON message (session_id, seq)`,
  `CREATE TABLE app_state (
     key TEXT PRIMARY KEY NOT NULL,
     value TEXT NOT NULL
   )`,
] as const;

/**
 * v2: the model list each service reported (from `GET /models`), cached so the
 * form opens with the last known ids instead of an empty picker.
 */
const V2 = [
  `CREATE TABLE model (
     provider_id TEXT NOT NULL
       REFERENCES provider(id) ON DELETE CASCADE,
     model_id TEXT NOT NULL,
     created_at INTEGER NOT NULL,
     PRIMARY KEY (provider_id, model_id)
   )`,
] as const;

export const MIGRATIONS: readonly Migration[] = [
  { version: 1, statements: V1 },
  { version: 2, statements: V2 },
];

const ignore = (thrown: unknown): void => {
  void thrown;
};

/**
 * Brings the file to `SCHEMA_VERSION`. Safe to call on every launch: already
 * applied versions are skipped, and a failed migration rolls back.
 */
export async function migrate(driver: SqlDriver): Promise<number> {
  // Per connection in SQLite, so it must be set before any write.
  await driver.exec("PRAGMA foreign_keys = ON");
  // WAL keeps a reader (the UI) from blocking the writer. Not every build
  // supports it; a refusal is not fatal, it only means the default journal.
  await driver.first("PRAGMA journal_mode = WAL").catch(ignore);

  const row = await driver.first<{ user_version: number }>("PRAGMA user_version");
  let version = row?.user_version ?? 0;

  for (const migration of MIGRATIONS) {
    if (migration.version <= version) {
      continue;
    }
    await driver.transaction(async () => {
      for (const statement of migration.statements) {
        await driver.exec(statement);
      }
      // PRAGMA cannot take a bound parameter, and `version` is our own integer.
      await driver.exec(`PRAGMA user_version = ${migration.version}`);
    });
    version = migration.version;
  }

  return version;
}

/**
 * Full-text search is a capability, not a dependency: the search UI degrades to
 * `LIKE` when the engine was built without FTS5. The probe runs in the `temp`
 * schema so it leaves nothing behind when it succeeds.
 */
export async function detectFts5(driver: SqlDriver): Promise<boolean> {
  try {
    await driver.exec("CREATE VIRTUAL TABLE temp.fts5_probe USING fts5(x)");
    await driver.exec("DROP TABLE temp.fts5_probe");
    return true;
  } catch {
    return false;
  }
}

export async function readFlag(
  driver: SqlDriver,
  key: string,
): Promise<string | null> {
  const row = await driver.first<{ value: string }>(
    "SELECT value FROM app_state WHERE key = ?",
    [key],
  );
  return row?.value ?? null;
}

export async function writeFlag(
  driver: SqlDriver,
  key: string,
  value: string,
): Promise<void> {
  await driver.run(
    `INSERT INTO app_state (key, value) VALUES (?, ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
    [key, value],
  );
}