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
 *
 * v4 renames the model-service tables to the `model_provider*` vocabulary and
 * drops the v3 `instance*` rows instead of migrating them: the shape changed
 * (templates are rows now, headers lost their ordering column) and a provider is
 * re-created from a template in a few taps. `session` / `message` / `agent` /
 * `app_state` are untouched, so conversations survive.
 */
import type { SqlDriver } from "./sql.ts";
import { TEMPLATE_SEED_SQL } from "./seed.ts";

export const SCHEMA_VERSION = 4;

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

/**
 * v3: one service = a template-created *instance* plus the models configured
 * under it. v2 kept a single flat provider row with one model name, which cannot
 * express "OpenAI main account with three models".
 *
 * Existing v2 rows are carried over as 自定义 instances so an upgrade does not
 * silently drop a working API key. The shape is lossy on purpose — the old row
 * had no protocol and no per-model settings — and every copied model starts
 * with the defaults.
 */
const V3 = [
  `CREATE TABLE instance (
     id TEXT PRIMARY KEY NOT NULL,
     template_id TEXT NOT NULL,
     name TEXT NOT NULL,
     protocol TEXT NOT NULL,
     base_url TEXT NOT NULL,
     stream INTEGER NOT NULL DEFAULT 1,
     position INTEGER NOT NULL,
     created_at INTEGER NOT NULL,
     updated_at INTEGER NOT NULL
   )`,
  `CREATE TABLE instance_secret (
     instance_id TEXT PRIMARY KEY NOT NULL
       REFERENCES instance(id) ON DELETE CASCADE,
     api_key TEXT NOT NULL
   )`,
  `CREATE TABLE instance_header (
     instance_id TEXT NOT NULL
       REFERENCES instance(id) ON DELETE CASCADE,
     position INTEGER NOT NULL,
     name TEXT NOT NULL,
     value TEXT NOT NULL,
     PRIMARY KEY (instance_id, position)
   )`,
  `CREATE TABLE model_config (
     instance_id TEXT NOT NULL
       REFERENCES instance(id) ON DELETE CASCADE,
     id TEXT NOT NULL,
     display_name TEXT NOT NULL,
     note TEXT NOT NULL DEFAULT '',
     max_output_tokens INTEGER,
     context_window INTEGER,
     thinking INTEGER NOT NULL DEFAULT 0,
     effort TEXT,
     budget INTEGER,
     temperature REAL,
     top_p REAL,
     image INTEGER NOT NULL DEFAULT 0,
     position INTEGER NOT NULL,
     created_at INTEGER NOT NULL,
     updated_at INTEGER NOT NULL,
     PRIMARY KEY (instance_id, id)
   )`,
  `INSERT INTO instance
     (id, template_id, name, protocol, base_url, stream, position, created_at, updated_at)
   SELECT id, 'custom', name, 'openai-chat', base_url, stream, created_at, created_at, updated_at
   FROM provider`,
  `INSERT INTO instance_secret (instance_id, api_key)
   SELECT provider_id, api_key FROM provider_secret`,
  `INSERT INTO model_config
     (instance_id, id, display_name, note, max_output_tokens, context_window,
      thinking, effort, budget, temperature, top_p, image, position, created_at, updated_at)
   SELECT provider_id, model_id, model_id, '', NULL, NULL, 0, NULL, NULL,
          NULL, NULL, 0, 0, created_at, created_at
   FROM model`,
  `INSERT INTO app_state (key, value)
   SELECT 'active_instance_id', value FROM app_state WHERE key = 'active_provider'`,
  `INSERT INTO app_state (key, value)
   SELECT 'active_model_id', model_id FROM model
   WHERE provider_id = (SELECT value FROM app_state WHERE key = 'active_provider')
     AND EXISTS (SELECT 1 FROM model
                 WHERE provider_id = (SELECT value FROM app_state WHERE key = 'active_provider'))
   ORDER BY model_id
   LIMIT 1`,
  `DELETE FROM app_state WHERE key = 'active_provider'`,
  `DROP TABLE model`,
  `DROP TABLE provider_secret`,
  `DROP TABLE provider`,
] as const;

/**
 * v4: the model-service tables, under their final names.
 *
 * - `model_provider_template` is data (see `seed.ts`), not code: the vendor
 *   list, the default protocol and the home-page group order are rows.
 * - `model_provider` is one connection; its models, secret and headers hang off
 *   it with ON DELETE CASCADE.
 * - Headers are keyed by name (`PRIMARY KEY (provider_id, name)`) instead of a
 *   position column: a header is unique by name and has no user-visible order.
 * - Providers lost their `position` column; they are listed by `created_at`.
 *
 * Every v3 (and older) model-service table is dropped first: the shape changed
 * and a provider is re-created from a template in a few taps.
 */
const V4 = [
  `DROP TABLE IF EXISTS model_config`,
  `DROP TABLE IF EXISTS instance_header`,
  `DROP TABLE IF EXISTS instance_secret`,
  `DROP TABLE IF EXISTS instance`,
  `DROP TABLE IF EXISTS model`,
  `DROP TABLE IF EXISTS provider_secret`,
  `DROP TABLE IF EXISTS provider`,
  `CREATE TABLE model_provider_template (
     id TEXT PRIMARY KEY NOT NULL,
     name TEXT NOT NULL,
     default_name TEXT NOT NULL DEFAULT '',
     protocol TEXT NOT NULL,
     protocols TEXT NOT NULL,
     base_url TEXT NOT NULL DEFAULT '',
     host TEXT NOT NULL DEFAULT '',
     custom INTEGER NOT NULL DEFAULT 0,
     position INTEGER NOT NULL
   )`,
  `CREATE TABLE model_provider (
     id TEXT PRIMARY KEY NOT NULL,
     template_id TEXT NOT NULL
       REFERENCES model_provider_template(id),
     name TEXT NOT NULL,
     protocol TEXT NOT NULL,
     base_url TEXT NOT NULL,
     stream INTEGER NOT NULL DEFAULT 1,
     created_at INTEGER NOT NULL,
     updated_at INTEGER NOT NULL
   )`,
  `CREATE TABLE model_provider_secret (
     provider_id TEXT PRIMARY KEY NOT NULL
       REFERENCES model_provider(id) ON DELETE CASCADE,
     api_key TEXT NOT NULL
   )`,
  `CREATE TABLE model_provider_header (
     provider_id TEXT NOT NULL
       REFERENCES model_provider(id) ON DELETE CASCADE,
     name TEXT NOT NULL,
     value TEXT NOT NULL,
     PRIMARY KEY (provider_id, name)
   )`,
  `CREATE TABLE model_provider_model (
     provider_id TEXT NOT NULL
       REFERENCES model_provider(id) ON DELETE CASCADE,
     id TEXT NOT NULL,
     display_name TEXT NOT NULL,
     note TEXT NOT NULL DEFAULT '',
     max_output_tokens INTEGER,
     context_window INTEGER,
     thinking INTEGER NOT NULL DEFAULT 0,
     effort TEXT,
     budget INTEGER,
     temperature REAL,
     top_p REAL,
     image INTEGER NOT NULL DEFAULT 0,
     position INTEGER NOT NULL,
     created_at INTEGER NOT NULL,
     updated_at INTEGER NOT NULL,
     PRIMARY KEY (provider_id, id)
   )`,
  `CREATE INDEX model_provider_model_order
     ON model_provider_model (provider_id, position)`,
] as const;

export const MIGRATIONS: readonly Migration[] = [
  { version: 1, statements: V1 },
  { version: 2, statements: V2 },
  { version: 3, statements: V3 },
  { version: 4, statements: V4 },
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

  // Templates are data, not code. The seed is an idempotent upsert, so it runs
  // on every launch: a corrected default endpoint or group order reaches an
  // installed app without a migration.
  await driver.transaction(async () => {
    await driver.exec(TEMPLATE_SEED_SQL);
  });

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