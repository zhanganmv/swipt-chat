/**
 * The built-in model catalog.
 *
 * Typing a service's base URL should get you a usable model id without a
 * network round-trip, and without memorising strings like
 * `deepseek-ai/DeepSeek-V3.2-Exp`. The catalog is only a suggestion list: ids
 * fetched from `GET /models` are merged on top of it, and any other id can be
 * typed by hand.
 *
 * Matching is by host substring, because users paste the full path
 * (`https://api.deepseek.com/v1`) as often as the bare host.
 */
export interface CatalogEntry {
  /** Substring of the base URL's host, e.g. `deepseek`. */
  host: string;
  name: string;
  baseURL: string;
  models: readonly string[];
}

export const CATALOG: readonly CatalogEntry[] = [
  {
    host: "api.deepseek.com",
    name: "DeepSeek",
    baseURL: "https://api.deepseek.com/v1",
    models: ["deepseek-chat", "deepseek-reasoner"],
  },
  {
    host: "api.moonshot.cn",
    name: "Moonshot",
    baseURL: "https://api.moonshot.cn/v1",
    models: ["kimi-k2-0905-preview", "moonshot-v1-32k", "moonshot-v1-8k"],
  },
  {
    host: "open.bigmodel.cn",
    name: "智谱",
    baseURL: "https://open.bigmodel.cn/api/paas/v4",
    models: ["glm-4.6", "glm-4.5-air"],
  },
  {
    host: "dashscope.aliyuncs.com",
    name: "百炼",
    baseURL: "https://dashscope.aliyuncs.com/compatible-mode/v1",
    models: ["qwen3-max", "qwen-plus", "qwen-turbo"],
  },
  {
    host: "api.siliconflow.cn",
    name: "硅基流动",
    baseURL: "https://api.siliconflow.cn/v1",
    models: ["deepseek-ai/DeepSeek-V3.2-Exp", "Qwen/Qwen3-235B-A22B-Instruct-2507"],
  },
  {
    host: "api.openai.com",
    name: "OpenAI",
    baseURL: "https://api.openai.com/v1",
    models: ["gpt-4o", "gpt-4o-mini", "o3-mini"],
  },
  // No model list on purpose: OpenRouter's catalogue changes weekly, so the
  // only honest suggestion is "fetch it".
  {
    host: "openrouter.ai",
    name: "OpenRouter",
    baseURL: "https://openrouter.ai/api/v1",
    models: [],
  },
];

export function catalogOf(baseURL: string): CatalogEntry | null {
  const url = baseURL.trim().toLowerCase();
  if (url === "") {
    return null;
  }
  return CATALOG.find((entry) => url.includes(entry.host)) ?? null;
}

/** Ids suggested for an endpoint; empty when it is not a known service. */
export function suggestedModels(baseURL: string): readonly string[] {
  return catalogOf(baseURL)?.models ?? [];
}

/** First occurrence wins, so a fetched id keeps its place ahead of a preset. */
export function uniqueModels(lists: readonly (readonly string[])[]): string[] {
  const seen = new Set<string>();
  const merged: string[] = [];
  for (const list of lists) {
    for (const id of list) {
      if (id !== "" && !seen.has(id)) {
        seen.add(id);
        merged.push(id);
      }
    }
  }
  return merged;
}