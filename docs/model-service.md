# 模型服务：模板 → 连接 → 模型

- 版本：v36（2026-11-11）
- 依据：用户给的《模型服务 · 完整交互文档》
- 代码：`src/domain/provider.ts`（类型与规则）、`src/state/seed.ts`（模板种子 SQL）、`src/api/protocol.ts`（协议适配）、`src/screens/{ProviderListPage,ProviderPage,ModelPage}.tsx`、`src/shell/{ProviderSheet,CandidateSheet,ModelSheet}.tsx`

## 1. 三层的职责

| 层 | 是什么 | 可变性 | 存在哪 |
|---|---|---|---|
| 模板 | 创建入口：名称、默认名称、官方 Base URL、可用协议、首页分组顺序 | 数据，由种子 SQL 维护 | `model_provider_template` 一张表 |
| 连接 | 用户创建的一条连接（provider） | `templateId` 只读；其余可改 | `model_provider` + `model_provider_secret` + `model_provider_header` |
| 模型 | 连接下的一条模型配置 | `id` 只读；显示名与参数可改 | `model_provider_model` |

模板**不是常量**：`src/state/seed.ts` 的 `TEMPLATE_SEED_SQL` 在每次启动的迁移里执行，`INSERT … ON CONFLICT(id) DO UPDATE`，因此改厂商名、默认地址、分组顺序都只是改种子，没有代码路径认识 `openai` 或 `deepseek` 这些字符串。连接的 `templateId` 只用于分组、恢复默认地址与协议白名单，不参与请求。

## 2. 页面与导航

```
设置（Chat 导航栈里的 NavigationDestination）
 └─ 模型服务（首页，large title）
     ├─ 连接详情
     │    └─ 模型详情
     └─ 创建抽屉（sheet）
```

- 三页都是 `NavigationDestination`，滑动返回仍由栈深决定（`docs/architecture.md` §6）。
- 首页分组顺序 = `model_provider_template.position`，**空组不渲染**；组 footer 写各组的用途（内置组只服务官方 Key，第三方端点进自定义组）。模板行缺失的连接落到末尾「其他」组，不会凭空消失。
- 行：名称 + 代理域名副标题（仅当 host 与模板官方域名不同）+「N 个模型 / 未添加模型」。左滑删除，二次确认写明连带删除多少个模型。
- 右上角 `+` 是原生 `Menu`，条目由模板行生成：`custom = 0` 的用模板名，`custom = 1` 的显示「名称…」。
- 全空时显示空态：提示 + 「从模板创建」菜单，与 `+` 等价。

## 3. 创建

| 模板 id | 名称 | 默认名称 | 默认 Base URL | 可用协议（首个为默认） |
|---|---|---|---|---|
| `openai` | OpenAI | OpenAI | `https://api.openai.com/v1` | `openai-chat`、`openai-responses` |
| `anthropic` | Anthropic | Anthropic | `https://api.anthropic.com` | `anthropic-messages` |
| `deepseek` | DeepSeek | DeepSeek | `https://api.deepseek.com/v1` | `openai-chat` |
| `custom` | 自定义 | 空 | 空 | 三种全给 |

- 内置模板（`custom = 0`）：名称预填默认名称、API Key 必填、协议锁定；自定义模板（`custom = 1`）：Key 可空（为空时「获取模型」禁用），协议 Picker 只在 `protocols.length > 1` 时出现。
- 校验：名称 trim 非空；Base URL 必须能解析 scheme + host（`isValidURL`），不合法时内联「请输入有效的 URL」并禁用「创建」。
- 创建即落库，关闭抽屉后直接推入连接详情；取消不产生任何数据。

## 4. 连接详情

四段，没有全局保存按钮——每次编辑进 reducer，300ms 防抖后 diff 落库。

1. **连接**：名称、模板（只读）、协议（模板给了多个协议才可改；已有模型时切换先确认）、Base URL（URL 键盘、不自动大写、不纠错）、API Key（`SecureField`，已保存时占位提示，输入即替换）、恢复默认地址（仅内置模板）、流式输出、`ID: …`。
2. **模型**：空态「未添加模型」+「获取模型」（非自定义）+「手动添加模型」；有模型时每行显示名 + id，左滑删除并确认。
3. **高级**：自定义请求头键值对（名 / 值 / 删除按钮），底部一行「Header 名 + 值 + 添加」。Anthropic 额外以只读灰字展示自动注入的 `anthropic-version: 2023-06-01`。
4. **危险操作**：删除此连接，确认后级联删除模型、密钥与请求头。

获取模型：走 `requestModels`，成功打开候选面板；失败按 `timeout` / 401 / 403 / 404 映射成中文提示，不阻断其它操作。

候选面板：搜索、全选 / 取消全选、每个候选一个 Toggle；**已添加的模型不显示**（等价于「已添加且不可再勾选」）。只有「添加所选」会写入。

## 5. 模型详情

| 段 | 字段 | 规则 |
|---|---|---|
| 基础 | 模型 ID（只读）、显示名、备注 | ID 创建后不可变，换 ID 只能删了重建 |
| 容量 | 最大输出 token、上下文窗口 | 正整数或空；空 = 用提供商默认 |
| 思考 | OpenAI：开关 + 推理强度 low/medium/high；Anthropic：开关 + budget_tokens | Anthropic：预算 ≥ 1024 且 < 最大输出 token，未设上限时提示先设上限 |
| 采样 | Temperature、Top P | 空 = 不发送；Anthropic 上限 1；思考开启时 Top P 禁用 |
| 输入模态 | 文本（固定）、图像 | 本地能力声明，不参与请求 |

## 6. 协议映射（`src/api/protocol.ts`）

| 协议 | 对话端点 | 模型目录 | 鉴权头 | 请求体要点 |
|---|---|---|---|---|
| `openai-chat` | `POST {base}/chat/completions` | `GET {base}/models` | `Authorization: Bearer` | `messages`、`max_tokens`、`temperature`、`top_p`、`reasoning_effort` |
| `openai-responses` | `POST {base}/responses` | `GET {base}/models` | `Authorization: Bearer` | `input`、`max_output_tokens`、`reasoning: {effort}` |
| `anthropic-messages` | `POST {base}/v1/messages` | `GET {base}/v1/models` | `x-api-key` + `anthropic-version: 2023-06-01` | `messages`、`max_tokens`（缺省 4096）、`thinking: {budget_tokens}`；开启思考时不发 temperature / top_p |

- 自定义请求头按名字大小写不敏感地覆盖自动注入的头。
- SSE 解析按协议分派（`src/sse.ts`）：Chat 读 `choices[0].delta.content` 与 `[DONE]`；Responses 读 `response.output_text.delta`、`response.completed`；Anthropic 读 `content_block_delta.text_delta`、`message_stop`。
- 非流式响应的取文本逻辑同样按协议分派（`completionOf`）。

## 7. 与原交互文档的差异

- **Anthropic 分页未做**：文档要求按 `has_more` / `last_id` 遍历；当前只取第一页（单次 GET）。
- **候选面板不显示 display_name**：只解析 `data[].id`，因为三种协议的返回结构差异大，`name` 字段并不统一；列表里显示 id。
- **能力声明未建模**：文档里「按模型能力声明显隐参数」需要一份模型能力库，本期没有做。
- **连接重名提示未做**：允许同组重名（以 id 区分），但没有非阻断提示。
- **候选面板隐藏已添加模型**，而不是「显示但禁用」——两者文档都允许，隐藏更干净。

## 8. 落库与恢复

表结构（schema v4）：

| 表 | 结构 |
|---|---|
| `model_provider_template` | `{id, name, default_name, protocol, protocols, base_url, host, custom, position}`；`protocols` 是逗号分隔的可用协议；由种子 SQL upsert |
| `model_provider` | `{id, template_id, name, protocol, base_url, stream, created_at, updated_at}`，**没有 api_key、没有 position**；列表按 `created_at, id` 排 |
| `model_provider_secret` | `{provider_id, api_key}`，主键即外键，删连接级联 |
| `model_provider_header` | `{provider_id, name, value}`，主键 `(provider_id, name)`，读时按名字排序 |
| `model_provider_model` | `{provider_id, id, display_name, note, max_output_tokens, context_window, thinking, effort, budget, temperature, top_p, image, position, …}`，主键 `(provider_id, id)`，按 `position` 排，删连接级联 |
| `app_state` | `current_session` / `active_provider` / `active_model` / `active_agent` / `draft` / `fts5` |

- 空 Key → 删 `model_provider_secret` 行；请求头每次整组替换（先 DELETE 再按数组插入），名字即身份，因此不存在顺序列。
- 读回时 `active_provider` / `active_model` 若指向已删除的行，回落到第一个可用者（`conversation.ts` 的 `hydrate`）。
- 迁移：v4 直接 DROP v3 的 `instance*`、`model_config` 与更早的 `provider*` / `model` 表，重建上表后灌种子——按用户要求不考虑兼容数据，升级后是空库，但模板即时可用。