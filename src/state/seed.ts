/**
 * Template seed.
 *
 * The vendor list behind the `+` menu and the home-page groups is a table, not
 * a TypeScript constant: `model_provider_template` is filled by this SQL on
 * every launch. Adding or renaming a vendor is therefore a data change here,
 * with no code path that knows "openai" or "deepseek" by name.
 *
 * The statement is idempotent and an upsert rather than an insert: an installed
 * app picks up a corrected default endpoint or group order without a schema
 * migration. Ids are the stable key providers point at, so they never change.
 */
export const TEMPLATE_SEED_SQL = `
INSERT INTO model_provider_template
  (id, name, default_name, protocol, protocols, base_url, host, custom, position)
VALUES
  ('openai',    'OpenAI',    'OpenAI',    'openai-chat',
   'openai-chat,openai-responses', 'https://api.openai.com/v1', 'api.openai.com', 0, 1),
  ('anthropic', 'Anthropic', 'Anthropic', 'anthropic-messages',
   'anthropic-messages', 'https://api.anthropic.com', 'api.anthropic.com', 0, 2),
  ('deepseek',  'DeepSeek',  'DeepSeek',  'openai-chat',
   'openai-chat', 'https://api.deepseek.com/v1', 'api.deepseek.com', 0, 3),
  ('custom',    '自定义',    '',          'openai-chat',
   'openai-chat,openai-responses,anthropic-messages', '', '', 1, 4)
ON CONFLICT(id) DO UPDATE SET
  name = excluded.name,
  default_name = excluded.default_name,
  protocol = excluded.protocol,
  protocols = excluded.protocols,
  base_url = excluded.base_url,
  host = excluded.host,
  custom = excluded.custom,
  position = excluded.position;
`;