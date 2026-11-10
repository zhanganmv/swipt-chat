import type { Provider } from "./types.ts";

/**
 * A provider is only usable when we know where to send and which model to ask
 * for. Everything else has a defined default, so a half-filled form never
 * produces a request that fails at the network layer.
 */
export function normalizeProvider(value: unknown): Provider | null {
  if (typeof value !== "object" || value === null) {
    return null;
  }
  const record = value as Record<string, unknown>;
  const baseURL = typeof record.baseURL === "string" ? record.baseURL.trim() : "";
  const model = typeof record.model === "string" ? record.model.trim() : "";
  if (baseURL === "" || model === "") {
    return null;
  }
  const id = typeof record.id === "string" ? record.id.trim() : "";
  const name = typeof record.name === "string" ? record.name.trim() : "";
  return {
    id,
    name: name === "" ? model : name,
    baseURL,
    model,
    apiKey: typeof record.apiKey === "string" ? record.apiKey : "",
    stream: record.stream !== false,
  };
}

export const modelNameOf = (provider: Provider | null): string =>
  provider === null ? "本地 Mock" : provider.model;

/** Row title in 模型服务; a provider always has one after `normalizeProvider`. */
export const providerNameOf = (provider: Provider): string =>
  provider.name.trim() === "" ? provider.model : provider.name;

/** The provider a turn should use: the selected one, else the first, else mock. */
export function activeProvider(
  providers: readonly Provider[],
  id: string | null,
): Provider | null {
  return providers.find((item) => item.id === id) ?? providers[0] ?? null;
}

/** Conversation title from the first user message, trimmed to one line. */
export function titleOf(text: string, limit = 24): string {
  const flat = text.replace(/\s+/g, " ").trim();
  if (flat === "") {
    return "新对话";
  }
  return flat.length > limit ? `${flat.slice(0, limit)}…` : flat;
}