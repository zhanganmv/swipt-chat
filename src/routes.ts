/**
 * The values the settings stack is addressed by.
 *
 * A `NavigationLink` and the `NavigationDestination` that answers it must carry
 * the exact same string. The native destination view resolves its value against
 * the registered slots and renders *nothing* when no slot matches, so a typo or
 * a renamed route does not disable the link — it pushes an empty page. Every
 * route is therefore built here once and imported by both sides, and
 * `scripts/check.ts` asserts that no link target lacks a destination.
 */
export const SETTINGS_ROUTE = "settings";
export const PROVIDERS_ROUTE = "providers";
export const AGENTS_ROUTE = "agents";
export const TOOLS_ROUTE = "tools";
export const MCP_ROUTE = "mcp";
export const SKILLS_ROUTE = "skills";
export const DIAGNOSTICS_ROUTE = "diagnostics";

export const providerRoute = (providerId: string): string =>
  `${PROVIDERS_ROUTE}/${providerId}`;

export const providerModelRoute = (
  providerId: string,
  modelId: string,
): string => `${providerRoute(providerId)}/models/${modelId}`;

export const settingsPath = (...segments: readonly string[]): string[] => [
  SETTINGS_ROUTE,
  ...segments,
];