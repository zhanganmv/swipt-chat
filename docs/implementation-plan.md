# swipt-chat 分阶段实现方案

- 日期：2026-11-10
- 参照：`~/GitHub/cherry-studio-app`（Expo App，RN 0.88.1 / React 19.3 / Expo 58，5221 文件 / 42.6 万行 TS）
- 宿主：Swipt（插件 = `.swiplet`，纯 JS，RN 0.88.1 运行时）
- Agent 内核：`@earendil-works/pi-ai` + `@earendil-works/pi-durable` 1.5.0（Cherry 同源）
- 阶段一约束：不改 Swipt 源码；只做插件。宿主 bug（`web.go:39` nil map）已由补丁版 Swipt（build 999）绕开，上游 PR #21 已提。

---

## 0. 当前实现状态（2026-11-10，v27）

> 引用规则：**UI 口径**以 `ui-spec.md` 的「当前基线」为准，**架构现状**以 `architecture.md` 为准；本文 §4 的「service + SQLite + pi」是目标形态，不是现状。

已可用（真机验证过的形态）：

- **外壳与呈现**：一个原生 `NavigationStack`（Chat 作根），设置是它的 `NavigationDestination`；会话列表 / 智能体选择 / 模型服务表单 / 新建智能体四个底部抽屉；顶栏原生模糊 + 液态玻璃控件。
- **模型服务**：多个 OpenAI 兼容服务可增删改，列表 + 抽屉表单 + 当前项切换；API Key 单独存 `secrets.json`。
- **智能体**：列表 + 新建 + 切换（`agents.json`）。
- **会话**：新建/切换/重命名/删除，草稿独立落盘，杀进程可恢复（`conversations.json` / `draft.json`）。
- **对话链路**：`src/api/turn.ts` 直接调 `/chat/completions`，流式（SSE）与非流式都通；没有 provider 时走 `src/dev/mock.ts` 本地 Mock。错误按 kind 分类并内联到消息。
- **质量基线**：`tsc` 干净、`npm test` 88 条断言、`npm run build` 通过；bundle 依赖固定 7 项，全在运行时白名单内。

还没做（本文的重点，按 P1 起排）：SQLite、`pi` 循环、extension service 常驻、内置工具 / MCP / Skills 的真实数据层、会话搜索（FTS5）、模型目录与连通性探测。

---

## 1. 目标与 MVP 范围

把 Cherry Studio 的「聊天 + Agent」能力搬进一个 Swiplet，宿主能力经 Swipt 暴露。

MVP 六项（用户定）：

| # | 能力 | 说明 |
|---|---|---|
| 1 | 智能体 | 指令、模型、工具/Skill 绑定、启用状态 |
| 2 | MCP | 远程 MCP Server（Streamable HTTP）接入、工具发现与调用、审批策略 |
| 3 | 内置工具 | 通过 Swipt extension 调设备能力（点击、输入、截图、启动 App、剪贴板等） |
| 4 | Skills | SKILL.md 库，按需加载进上下文 |
| 5 | 会话管理 | 会话列表、重命名、删除、分页历史、搜索 |
| 6 | 模型服务 | Provider / Model 配置（预置 + 自定义 OpenAI 兼容端点）、密钥、可用性探测 |

非目标（二期以后再谈）：多答案并排与全屏层、编辑回复、Fork、回收站、远程/桌面同步、绘画/画板、语音、文件库、Office 工具、MCP Apps（需 WebView）、MCP OAuth、内嵌网页容器。

---

## 2. Cherry Studio 交互拆解

### 2.1 导航骨架

`src/app/(drawer)/(main)/` 六个一级入口：

- `(chat)`：会话列表 + 聊天页（默认页）
- `agents`：智能体列表 / 新建 / 编辑
- `skills`：技能库（含市场、候选、详情）
- `plugins`：已安装插件 / MCP Server 列表与详情（含 OAuth 回调页）
- `library`、`paintings`、`drawings`：文件库与绘画（本期不做）
- `settings`：provider（模型服务）、model、appearance、data、privacy、permissions、feedback 等
- 另有 `trash`（回收站）

对我们的启示：**一级导航只有 5 个**（聊天、智能体、技能、MCP、设置）。插件里没有 expo-router，这 5 个页面 + 2 个详情页用一个自写的极简栈（`Screen[]` + `push/pop`）就能覆盖，不需要引导航库。

### 2.2 聊天页结构（自上而下）

1. **Header**：会话名（可点改名）、Agent 头像、更多菜单（重命名/删除/导出）。
2. **Transcript**：虚拟化列表（Cherry 用 FlashList，纯 JS，可留）；按消息渲染。
3. **消息体**：用户气泡 / 助手消息卡片。助手消息内是**结构化块序列**：正文、思考（折叠）、工具调用卡片、工具结果、图片、引用。
4. **工具调用卡片**：标题（工具名/参数摘要）、状态（等待确认/运行中/成功/失败）、展开看参数与结果、可折叠。
5. **审批（Approvals）**：`ToolApprovalSheet`，对 `approval=ask` 的工具在调用前弹层，允许「本次/始终/拒绝」。
6. **提问（Question）**：`ConversationQuestionSheet` + `UserQuestionSheet`，处理模型发起的 `ask_user_question`，单选/多选/自由文本，不可下滑关闭。
7. **Composer**：输入框、发送/停止、附件、模型/工具开关、MCP prompt 入口。
8. **多答案层**：一次提问多个回答用等高卡片横滑，点开全屏层（本期不做）。

### 2.3 消息数据（`agent_session_message`）

- `role`：`user | assistant | system`（CHECK 约束）
- `status`：`pending | streaming | success | error | cancelled | interrupted`
- `data`：结构化内容（JSON，块数组）
- `turn_id`、`usage`、`stats`、`error`、`context_checkpoint`（压缩点）、`model_id`、`searchable_text` + `fts_rowid`（全文检索）

要点：**状态机比结构更重要**。流式期间同一条消息反复更新 `data`，落库要节流（Cherry 是提交粒度 + 投影），否则 SQLite 写放大。

### 2.4 智能体（`agent`）

12 列：`id, name, instructions, avatar, model(FK user_model), tool_approval_mode(default), disabled_capabilities, order_key, created_at, updated_at, deleted_at`，加上后加的两列：`mode`（默认 `standard`）、skills 关联。

交互：列表（拖序/长按菜单）→ 编辑页（名称、头像、指令、模型选择、工具开关、技能开关）→ 新建。

### 2.5 工具绑定与审批（`agent_tool_binding`）

`souce='mcp', mcp_server_id, raw_tool_name, enabled, approval(auto|ask|deny), display_name_snapshot`；
唯一键：一台 MCP Server 的默认绑定（`raw_tool_name IS NULL`）+ 单工具绑定各一条。
审批优先级：`deny` > `ask` > `auto`，Agent 级 `tool_approval_mode` 做默认值。

### 2.6 Skills

- 目录模型：每个技能一个文件夹，必备 `SKILL.md`（YAML frontmatter + 正文），其余文件是资源。
- 库表：`agent_global_skill(id, name, description, folder_name, source, source_url, author, version, tags, content_hash, is_enabled, manifest, profile, invocation{modelInvocable,userInvocable})`；`agent_skill(agent_id, skill_id, is_enabled)` 做绑定。
- **渐进式加载**：系统上下文只放「名字 + 描述 + 路径」，模型需要时调 `read_skill` 读全文；工具回执给资源路径，不回传全文。
- 技能生成/改写：`skill_create`、`skill_adapt`（改之前必须过提问页确认）。

对我们的启示：这套「索引进上下文 + 工具取全文」正好适配 Swipt（文件系统只给 `dataDirectory`），不用引入向量库。

### 2.7 MCP

- 表：`mcp_server(id, name, base_url, origin(remote|builtin), builtin_id, authorization_id, headers, is_active, disabled_tools)`。
- 传输入口：`StreamableHTTPClientTransport`（`mcpProtocolClient.ts:194`），`connect(transport, {signal, timeout: 15_000})`，**刻意不传 authProvider**（避免 401 时重放写请求）。
- 工具目录：连接后 `tools/list` 拉全量，按 `disabled_tools` 过滤，再进 Agent 绑定表。
- 内置 MCP（`services/builtInMcp`）是本地 in-process server；我们对应的是「内置工具」，不需要 MCP 协议。

### 2.8 模型服务（`user_provider` / `user_model`）

- Provider：`provider_id, preset_provider_id, name, logo_key, endpoint_configs, default_chat_endpoint, api_keys, auth_config, api_features, provider_settings, is_enabled, order_key`。
- Model：`id, provider_id, model_id, name, capabilities, input/output_modalities, endpoint_types, context_window, max_input_tokens, max_output_tokens, supports_streaming, reasoning, parameters, pricing, is_enabled, is_hidden, is_deprecated`。
- 两种来源：预置目录（preset）与自定义（自定义必须填 name/capabilities/supports_streaming）。

对我们的启示：MVP 只做**自定义 OpenAI 兼容 Provider**（DeepSeek、OpenAI、Kimi、OpenRouter 都能填 baseURL+key+model）加几个预置模板，不做 OAuth、不做模型目录自动拉取。Cherry 的 28 列模型表先裁到 10 列。

### 2.9 会话管理（`agent_session`）

`id, agent_id, name, is_name_manually_edited, execution_target, last_activity_at, forked_from_session_id, fork_boundary_message_id`。
能力：列表排序（`last_activity_at`）、自动命名、手动改名、删除、Fork、消息分页加载、全文搜索（FTS5）。

### 2.10 照搬 / 简化 / 放弃

| Cherry 做法 | 我们的做法 |
|---|---|
| expo-router 文件路由 + drawer | 自写 Screen 栈 + 自绘侧栏（无导航库） |
| FlashList | RN `FlatList`（够用，流式期只重渲染最后一条） |
| reanimated / skia / svg / gesture-handler | RN `Animated` + `Pressable`；图标用 PNG 资源 |
| Markdown：enriched-markdown（原生） | `react-native-markdown-display`（纯 JS）+ 代码块等宽 Text |
| MCP Apps（WebView） | 不做，仅文本/图片结果 |
| MCP OAuth | 不做（无 WebView 回调），只支持 Header/Token |
| 多答案卡片、编辑回复、Fork、回收站 | 二期 |
| FTS5 全文检索 | 先 `LIKE`，验证 sqlite 桥支持后再上 FTS |
| 后台回复 / 桌面连接 | 不做 |

---

## 3. Swipt 运行时边界（决定架构）

| 能力 | 现状 | 影响 |
|---|---|---|
| UI | RN 核心全量；无 webview / reanimated / gesture / svg / screens | 全部自绘，动画用 Animated |
| 导航 | 无路由库 | 自写栈，页面状态与聊天状态分离 |
| SQLite | `expo-sqlite` 与 `expo-sqlite/kv-store` 经宿主桥暴露（`app/index.tsx:366`） | 会话/消息/配置都落库；事务与 PRAGMA 需验证 |
| 文件 | app 与 extension 都有 `@swipt/api/file-system`（data / cache / assets） | Skills、附件、日志落 `dataDirectory` |
| 网络 | `@swipt/api/http` 的 `Client.fetch`，`Response.body` 是真 ReadableStream | SSE/流式可用；**宿主 build ≤71 有 nil map 崩溃，必须用补丁版** |
| app 可见 API | `@swipt/api`、`swiplet`、`file-system`、`app-intents`、`localization`、`http`、`maps`、`expo-sqlite` | app 侧**没有** device/input/accessibility |
| extension 可见 API | `device`、`input`、`accessibility`、`screen`、`image`、`file-system`、`http`、`swiplet` | 设备工具只能写在 extension |
| app → extension | `@swipt/api/swiplet` 的 `actions` 代理 → `host.call` → Go `Host.Call`；caller=app 时**不受 expose 限制** | 工具调用通路成立 |
| 确认弹窗 | `ActionContext` 只有 `{ signal, caller }` | 审批必须在 app UI 里做完再调 action |
| extension 生命周期 | 每次 action 调用都重新 `execute`（重新加载 extension.js） | 无内存态；状态写库/写文件 |
| 后台 | **有专门机制**：manifest `"service": true` + `defineExtension({ run })`，Go 侧独立 supervise 并自动重启；Swipt 后台保活（无声音频 / 定位）保持进程存活 | 长任务必须跑在 service 里，不能放在 app UI runtime（详见 §3.2） |

### 3.1 模型层评估：pi-ai 可用（已验证）

结论：**可以用，且不需要 polyfill**。证据（2026-11-10 本地实测）：

1. **沙箱自带全部 Web API**。`installGlobalScope`（`extension/scope.ts:108`）在删除 RN 原生 `fetch` 之后，会重新安装 `fetch / Headers / Request / Response / ReadableStream / TextEncoder / TextDecoder / structuredClone / AbortSignal / crypto / atob / btoa / queueMicrotask`。所以 pi-ai 依赖的 `structuredClone`、`TextDecoder`、`AbortSignal.any` 都有宿主实现。
2. **pi-ai 能打进 swiplet**。用 CLI 同款 esbuild 配置（`platform: browser`、`target: es2020`、`external: appModules`）打包：pi-ai + pi-durable + MemoryStorage = 1.61 MB，**零 `node:` 导入**、零动态 `require`；`process` 访问都在 `typeof process === "undefined"` 或 `globalThis.process?.env` 守卫里；`Buffer` 只在 base64 分支且带 `typeof Buffer !== "undefined"` 判断。
3. **流式与工具调用跑通**。本地 mock OpenAI 兼容服务实测：
   - 事件序列 `start → text_start → text_delta → toolcall_start → toolcall_delta → text_end → toolcall_end → done`
   - 工具调用解析为 `{ type: "toolCall", id: "call_1", name: "get_time", arguments: { tz: "Asia/Shanghai" } }`
   - 回填 `toolResult` 后第二轮请求正确发出 `messages = [user, assistant, tool]`
   - usage 拿到 `{ input, output, totalTokens, cost }`
4. **支持注入自定义 fetch**。`streamSimple(model, ctx, { apiKey, fetch })` 的 `fetch` 收到 `(string, init{signal})`，与 `@swipt/api/http` 的 `Client.fetch` 签名一致，需要走插件级代理/证书/ Cookie 时可以直接注入。

**代价**：包体积。仅 pi 内核 1.61 MB；加 3 个预置 provider 目录（deepseek 2 个模型、moonshotai-cn 6 个、zai-coding-cn 4 个）→ 1.69 MB；把 openrouter（388 个模型）也带上 → 2.67 MB。所以预置只带目录小的，其余走自定义。

**规范列表（provider / model registry）**：以 pi-ai 内置目录为唯一真相，不手抄参数。

- 预置 Provider（目录小、纯 `openai-completions`）：`deepseek`、`moonshotai-cn`（Kimi）、`zai-coding-cn`（GLM）、`groq`、`cerebras`，各带 `baseUrl` 与该 provider 的 chat 模型（`id / name / contextWindow / maxTokens / reasoning / input / cost`）。
- 自定义 Provider：用户填 `baseUrl + apiKey + modelId + contextWindow (+ maxTokens)`，固定用 `openai-completions` API；`baseUrl` 末尾不带 `/v1` 时自动补。
- 过滤规则：只保留 `model.api === "openai-completions"` 的 chat 模型；`openai`（44 个全是 `openai-responses`）、`minimax`（`anthropic-messages`）、`mistral`（自有协议）一期不进预置，需要就填自定义。
- 模型元数据落 `model` 表，`capabilities` 存 `["stream","tools","reasoning","vision"]` 子集；`supports_streaming` 默认 1。

### 3.2 后台长时运行：靠 service，不靠 UI

**结论：Swipt 本来就为「后台一直跑」设计的，插件只要把长任务放进 service，不需要任何 extra 配置。** 依据：

1. **service 是宿主的常驻入口**。manifest 写 `"service": true` + `src/extension.js` 导出 `defineExtension({ run })`；Go 侧 `Host.Start()` 会给每个 enabled 的 service 起一个独立 runner（`internal/automation/host.go:125-146`），`runService` 加载 extension.js、调 `run(ctx)` 并等它结束（`internal/automation/service.go:200`），期间状态 `starting → running`。
2. **崩了会自动重启**。`supervise` 里指数退避（5s → 最长 5min），`stableService` 1 分钟后失败计数清零（`service.go:41-44`）。所以 `run()` 里要写「外层 while + 内部 try/catch」的常驻循环。
3. **enabled 状态会持久化并在每次启动时恢复**。开关是 swiplet 目录下的一个 marker 文件（`host.go:135`），app 侧通过 `useService().setEnabled(true)` 打开（`@swipt/api/swiplet`），之后每次 Swipt 启动自动拉起。
4. **进程存活靠 Swipt 的后台保活**。设置里 `Background Service`（key `serverRunsInBackground`，**默认开**）+ 模式 `Location / Audio`（**默认 audio，即无声音频**）：`Swipt/Platform/BackgroundAudio.swift` 用 `AVAudioEngine` 循环播一段静音 PCM，`BackgroundLocation.swift` 用 `pausesLocationUpdatesAutomatically = false` 的三公里精度定位。`Platform.observeActivity()` 里 `isActive = developer.isPublishing || calls > 0 || hasEnabledServices`——**只要我们的 service 是 enabled，`isActive` 就为真，保活自动生效**，插件不用做任何事。
5. **后台时 UI 与弹窗基本不可用**。`ScriptDialogs` 监听 `UIScene.didEnterBackgroundNotification` 会收起遮罩（`Swipt/Platform/ScriptDialogs.swift:39`），所以 `appIntents.requestValue/requestConfirmation` 这类前置弹窗在后台不可靠——这也是「审批一期全 auto」的硬理由。

**因此架构改成 service-first**：

- **agent 循环、MCP 连接、工具执行全部在 extension 的 `run()` 里**，常驻；app 只做 UI + 写意图。
- app ↔ service 的唯一通道是**共享 SQLite**（两边 `dataDirectory` 指向同一目录）+ `addDatabaseChangeListener` 变更通知；app 发消息 = 写 `message(pending)` 行 + 调一个 `wake` action（best-effort），service 主循环除监听外每 500ms 轮询一次兜底。
- 附带好处：工具（device/input/accessibility）本来就只有 extension 能用，循环搬过去后「工具调用」不再跨 runtime 转发；前台/后台一条路径。
- 代价：service 不能有 React 状态，所有进度必须落库；一次工具执行超时要自己管（`run(ctx)` 的 `signal` 在 service 停止时触发）。

**要真机验证的（写进 P2 验收）**：

1. 锁屏 + 切到别的 App 后 5/15/30 分钟，service 仍在 `running`，且一次完整 agent 回合能跑完；
2. 通话/微信语音打断音频后，`AVAudioSession` 中断结束能自动恢复（`BackgroundAudio` 已监听 interruption，但要确认期间 service 是否被挂起、恢复后循环能继续）；
3. 后台执行 `device.screenshot` / `input.tap` 等设备操作是否可用（前台可用不等于后台可用）；
4. 常驻 30 分钟的额外内存与耗电（无声音频保活本身有代价，用户会在状态栏看到音频占用）。

---

## 4. 目标架构

```
┌────────────────────── Swiplet「swipt-chat」（同一进程，两个 runtime） ──────────────────────┐
│  app runtime (src/app.tsx)                    extension service (src/extension.ts)       │
│ ┌───────────────────────────┐   SQLite       ┌───────────────────────────────────────┐  │
│ │ 纯展示 + 下拉刷新          │  ◄──────────►  │ defineExtension({ run }) 常驻循环      │  │
│ │  Chat / Sessions /        │  (共享 DB)      │  ├ 取任务（pending 行 / wake action）  │  │
│ │  Agents / Skills / MCP /  │                │  ├ pi-durable Harness + pi-ai Models   │  │
│ │  Settings                 │  wake action   │  ├ 工具：内置(device/input/a11y)      │  │
│ │                           │ ─────────────► │  │       MCP(JSON-RPC over fetch)      │  │
│ │  useService().setEnabled  │                │  │       read_skill                   │  │
│ └───────────────────────────┘                │  └ 事件逐条写库（token/工具/状态）     │  │
│  前台才活；关掉不影响任务                      │                                       │  │
│                                              │ 由 Swipt 保活：无声音频 / 定位          │  │
│                                              └───────────────────────────────────────┘  │
└──────────────────────────────────────────────────────────────────────────────────────────┘
        ▲ 写用户消息 / 读消息流                     │ @swipt/api/http
        │                                          ▼
   RN 界面                                 模型服务（OpenAI 兼容 / DeepSeek …）
                                            MCP Server（Streamable HTTP）
```

数据流：用户发消息 → app 写 `message(pending)` + 调 `wake` → service 主循环取活 → pi 流式 → 每 50–100ms 批量把增量写库并 bump `session.rev` → app 的 `addDatabaseChangeListener` 收到变更重读该条消息 → 渲染。**后台时 app 可能被挂起，但 service 不受影响；下次打开 app 从库里读出完整结果。**

模块划分（`src/`）：

```
src/
  app.tsx                 入口：App 组件 + Screen 栈（无业务逻辑）
  extension.ts            入口：defineExtension({ run, actions }) —— 常驻 agent 循环
  agent/
    loop.ts               service 主循环：取任务 → 开 harness → 跑 → 落库
    harness.ts            pi-durable Harness 打开/恢复（每次回合一个新 root）
    models.ts             pi-ai Models + provider 注册（规范列表）
    prompt.ts             系统提示词组装（指令 + 技能索引 + 工具说明）
    tools/
      builtin.ts          内置工具（直接调 @swipt/api/device|input|accessibility）
      mcp.ts              MCP 工具适配（同样的 Tool 形状）
      skill.ts            read_skill / list_skills
      registry.ts         按 agent 配置汇总工具
    projection.ts         事件 → 消息块（落库形态）
  transport/
    queue.ts              service ↔ app 的库协议：任务认领、token 批量写、cancel
  ui/                     screens + components（只读库、只写意图）
  data/
    db.ts                 openDatabase/migrations（app 与 service 共用同一文件）
    repo/{sessions,messages,agents,providers,mcp,skills,jobs}.ts
  net/
    sse.ts                SSE 解析（已在 swipt-chat v1–v5 验证）
    mcpClient.ts          JSON-RPC over Streamable HTTP
  settings/               密钥、调试日志
```

关键点：**Agent 循环跑在 extension service，不在 app**。UI 关掉、App 进后台都不影响任务；反过来，service 没有 React、没有界面，所有状态必须落库。工具调用也不再跨 runtime 转发（device/input/a11y 本来就只在 extension 侧可用）。

---

## 5. 数据模型（MVP 裁剪版）

沿用 Cherry 的字段语义，砍掉一期用不到的列。

```sql
-- 模型服务
CREATE TABLE provider (
  id TEXT PRIMARY KEY, name TEXT NOT NULL, base_url TEXT NOT NULL,
  api_key TEXT, headers TEXT, is_enabled INTEGER NOT NULL DEFAULT 1,
  order_key TEXT NOT NULL, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
);
CREATE TABLE model (
  id TEXT PRIMARY KEY, provider_id TEXT NOT NULL, model_id TEXT NOT NULL,
  name TEXT, capabilities TEXT, context_window INTEGER, max_output_tokens INTEGER,
  supports_streaming INTEGER NOT NULL DEFAULT 1, reasoning TEXT,
  parameters TEXT, is_enabled INTEGER NOT NULL DEFAULT 1,
  order_key TEXT NOT NULL, FOREIGN KEY(provider_id) REFERENCES provider(id) ON DELETE CASCADE
);

-- 智能体
CREATE TABLE agent (
  id TEXT PRIMARY KEY, name TEXT NOT NULL, instructions TEXT NOT NULL DEFAULT '',
  avatar TEXT, model_id TEXT, tool_approval_mode TEXT NOT NULL DEFAULT 'default',
  disabled_capabilities TEXT NOT NULL DEFAULT '[]',
  order_key TEXT NOT NULL, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
);

-- 会话 / 消息
CREATE TABLE session (
  id TEXT PRIMARY KEY, agent_id TEXT NOT NULL, name TEXT NOT NULL DEFAULT '',
  is_name_manually_edited INTEGER NOT NULL DEFAULT 0,
  last_activity_at INTEGER NOT NULL, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL,
  FOREIGN KEY(agent_id) REFERENCES agent(id) ON DELETE RESTRICT
);
CREATE TABLE message (
  id TEXT PRIMARY KEY, session_id TEXT NOT NULL, turn_id TEXT,
  role TEXT NOT NULL CHECK(role IN ('user','assistant','system')),
  data TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'pending'
    CHECK(status IN ('pending','streaming','success','error','cancelled','interrupted')),
  usage TEXT, error TEXT, model_id TEXT, searchable_text TEXT NOT NULL DEFAULT '',
  created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL,
  FOREIGN KEY(session_id) REFERENCES session(id) ON DELETE CASCADE
);
CREATE INDEX message_session_idx ON message(session_id, created_at);

-- MCP
CREATE TABLE mcp_server (
  id TEXT PRIMARY KEY, name TEXT NOT NULL, base_url TEXT NOT NULL,
  headers TEXT, is_active INTEGER NOT NULL DEFAULT 0,
  disabled_tools TEXT NOT NULL DEFAULT '[]',
  created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
);
CREATE TABLE agent_tool (
  id TEXT PRIMARY KEY, agent_id TEXT NOT NULL, kind TEXT NOT NULL,  -- builtin | mcp
  server_id TEXT, tool_name TEXT, enabled INTEGER NOT NULL DEFAULT 1,
  approval TEXT NOT NULL DEFAULT 'ask' CHECK(approval IN ('auto','ask','deny')),
  UNIQUE(agent_id, kind, server_id, tool_name)
);

-- Skills
CREATE TABLE skill (
  id TEXT PRIMARY KEY, name TEXT NOT NULL, description TEXT,
  folder TEXT NOT NULL UNIQUE, source TEXT NOT NULL, source_url TEXT,
  content_hash TEXT NOT NULL, invocation TEXT NOT NULL DEFAULT '{}',
  is_enabled INTEGER NOT NULL DEFAULT 0, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
);
CREATE TABLE agent_skill (
  agent_id TEXT NOT NULL, skill_id TEXT NOT NULL, is_enabled INTEGER NOT NULL DEFAULT 1,
  PRIMARY KEY(agent_id, skill_id)
);

CREATE TABLE app_state (key TEXT PRIMARY KEY, value TEXT NOT NULL);
```

迁移：`PRAGMA user_version` + 顺序脚本数组，与 Cherry 的 drizzle 迁移同思路但手写（没有 drizzle）。

---

## 6. 分阶段计划

> UI 的视觉与交互规范单独成文：[`ui-spec.md`](./ui-spec.md)。所有页面按它实现，不临时发挥；令牌已在 `src/theme/tokens.ts` 落地。

### P0 UI 外壳照抄（已完成，v6–v27）

> **状态：已完成**。最终形态见 `ui-spec.md`「当前基线」；下面是最初的拆解，其中「页面栈 + 会话抽屉」「设置页含通用/关于」等几处后来被推翻（v7 去左侧抽屉、v20 收敛为一个导航栈、v17 删通用与关于、v17 模型服务改抽屉表单）。

**做什么**
- 外壳（v2，2026-11-10 按用户反馈重做）：**去掉左侧抽屉**，改页面栈（二级页从右整页推入/滑出）+ **会话列表底部抽屉**（搜索在抽屉顶部，参照官方 `simulate-location` 的 BottomSheet + searchable）。
- 自定义顶栏（含「返回 Swipt」）：左 返回 + 智能体菜单；右 新增会话 + 更多（会话列表、设置）。
- 设置页改为**功能分组入口**：模型服务 / 智能体 / 工具 / MCP 服务 / 技能 / 通用 / 关于，各自进详情页；长按出编辑/删除。
- 聊天页骨架：消息列表、气泡、输入框（圆角 32、内边距 12、动作 32）、空态、回到底部。
- `src/theme/` 主题 Provider（亮/暗跟随系统）。

**验收**
- 与 Cherry 同屏对照，四处决定项（会话行高、气泡内边距、输入框圆角与内边距、消息间距）误差 ≤ 1pt。
- 返回按钮：任意页面点左上角都能回到 Swipt 插件页。

**风险**：没有 reanimated/gesture-handler —— 抽屉方案已因此废弃（用户实测手感差），页面栈与抽屉用 `Animated` + `Modal` 重写。**液态玻璃**只能在 `@expo/ui` 的 `Host` 里由 SwiftUI 实现（官方插件整屏 SwiftUI），当前 RN 顶栏是近似效果，是否把顶栏换成 Host 待设备验证后再定。

### P1 基座与模型服务（3 人日 ≈ 24 Agent 小时）

**做什么**
- SQLite 打开 + 迁移框架 + 6 张表（provider/model/agent/session/message/app_state）。
- 设置页 Provider 列表（新增/编辑/删除/启用）**已在 P0 阶段用 JSON 落地**（v17–v27），P1 只把存储换成 SQLite；剩下的是**模型目录**（预置目录自动带出，自定义手填 model id 或从 `/v1/models` 拉）与 API Key 的处理（不做加密，但不明文回显）。
- 连通性探测（复用现有「网络自检」），结果落日志。
- 会话写库用**流式节流**（≥300ms 或 chunk 边界），退出/切后台强制 flush。

**验收**
- `npm run check` + `npm test` 绿；真机：新建 DeepSeek Provider → 拉模型列表 → 选模型 → 发一条消息流式出字；杀进程重开，数据仍在。

**风险**：sqlite 桥是否支持 `PRAGMA journal_mode=WAL`、事务回滚 —— 需真机验证，不支持就降级单写队列。

### P2 pi Agent 循环（service 常驻，6 人日 ≈ 48 Agent 小时）

**做什么**
- manifest 开 `"service": true`；`defineExtension({ run })` 里起常驻循环，「认领任务 → 跑回合 → 落库 → 睡 200ms」。
- 任务协议（同库）：app 写 `message(pending)` 行；service 认领为 `streaming` 并 `claim_owner/claim_at`，避免重复执行。
- 引入 `@earendil-works/pi-ai` + `@earendil-works/pi-durable`；`Harness.open` + 自写 Storage（先 `MemoryStorage`，commit 后写穿 `message` 表，冷启动回放）。
- 模型层：`createModels()` + 规范列表（预置 deepseek/moonshotai-cn/zai-coding-cn/groq/cerebras + 自定义 OpenAI 兼容）。
- 流式：pi 事件 → 消息块（text / reasoning / toolCall / toolResult）→ 每 50–100ms 批量 UPDATE + bump `session.rev`；`addDatabaseChangeListener` 让 UI 跟随。
- 中断：app 写 `cancel_requested=1`（或调 `cancel` action），service 在主循环检查后 abort；异常 → `error`；冷启动发现 `streaming` 但 owner 已死 → `interrupted`。
- app 侧：`useService()` 显示 running/stopped，提供「开启后台运行」开关（`setEnabled(true)`）。

**验收**（真机）
- `service` 状态：开启后杀进程重开 Swipt → 自动回到 `running`。
- 单轮问答、多轮上下文、工具调用往返（先接假 echo 工具）；流式 60s 不断。
- **后台**：发一条长任务 → 立刻锁屏 / 切到别的 App → 5 分钟后回来，消息已完整生成且 token 拼接正确。
- 飞行模式 → `error` 且可重试；任务中途强杀 Swipt → 重开显示 `interrupted`，不重复扣上下文。

**风险（最大）**：pi 包是 ESM，Hermes 可能缺 `structuredClone` / `TextEncoder` / `crypto.randomUUID` / `AbortSignal.timeout`——打包与 mock 已验证，剩 Hermes 实跑；另外「后台被挂起时 sqlite 写入」要确认不会丢。

### P3 内置工具（Swipt extension）（4 人日 ≈ 32 Agent 小时）

**做什么**：9 个工具直接写在 service 里，包成 pi 的 `Tool`（同一 runtime，不再跨 action 转发）。

| 工具 | 底层 | 说明 |
|---|---|---|
| `device_info` | `device.info()` | 型号/系统/前台 App |
| `screenshot` | `device.screenshot()` 或 `screen.open()` | 结果压到 ≤ 1MB |
| `tap` / `swipe` | `input.tap/swipe` | 参数为屏幕坐标 |
| `type_text` | `accessibility.setText` 或 `input.pressKey` | 优先无障碍 |
| `launch_app` | `device.launchApplication` | bundleId |
| `pasteboard` | `device.pasteboard/setPasteboard` | 读/写 |
| `a11y_snapshot` | `accessibility.snapshot` | 截断到 200 节点 |
| `open_url` | `device.launchApplication({url})` | 跳 Safari |

- 审批：一期默认 `auto`（后台无法弹窗）；`ask` 的落库字段与 UI 保留，等二期接 `appIntents.requestConfirmation`，并注明仅前台有效。
- 结果截断与错误映射（超时、设备锁定、权限缺失）。
- 调试日志：每次工具调用写 `logs/tools.log`（保留 200 行）。

**验收**
- 真机：让模型「截个屏并告诉我屏幕上是哪个 App」「点一下搜索框输入 hello」两条链路走通。
- **后台**：锁屏状态下跑一次「截屏 + 描述」，确认设备操作在后台仍然可用（这是 §3.2 待验第 3 条）。

**风险**：后台执行设备操作可能被系统限制（AX 调用是否要求 App 在前台），若不行就把设备工具限定为前台执行、后台只跑纯对话与 MCP。

### P4 MCP 客户端（4 人日 ≈ 32 Agent 小时）

**做什么**
- `mcpClient.ts`：JSON-RPC 2.0 over `@swipt/api/http`，实现 `initialize`（协议版本协商）、`tools/list`、`tools/call`、`notifications/initialized`；SSE 响应解析（复用 `sse.ts`）。
- MCP 页：添加/编辑 Server（URL + Header）、连接测试、工具清单（可禁用）、错误展示。
- 工具注册：MCP 工具名加 `serverName__` 前缀防重名；Schema 透传；结果转文本/图片块。
- 审批沿用 P3，绑定表 `agent_tool(kind='mcp')`。
- 不支持：OAuth、MCP prompts/resources、sampling、MCP Apps。

**验收**
- 接一个公共 MCP Server（如 fetch/web-search 类），让模型调用成功；断网/401/超时都有明确错误；同名工具不冲突。

**风险**：Streamable HTTP 要求 `Accept: application/json, text/event-stream` 与 `Mcp-Session-Id` 回传，宿主 fetch 对 204/无 body 的处理要单独验（已知无 body 不触发宿主 bug）。

### P5 Skills（3 人日 ≈ 24 Agent 小时）

**做什么**
- 目录：`dataDirectory/skills/<folder>/SKILL.md` + 资源文件。
- 导入（三条路，**都没有文件选择器**）：
  1. **URL 导入**：支持 http(s) 直链的 zip 或单个 `SKILL.md`；zip 在 `dataDirectory/tmp/` 解压后校验路径不逃逸，再把 `SKILL.md` 所在的顶层目录搬进 `skills/<folder>/`。
  2. **粘贴 / 剪贴板**：粘贴 SKILL.md 全文；或从系统剪贴板读（extension `device.pasteboard`）。
  3. **Agent 生成**：模型用 `skill_create` 直接写。
- **不能做「选择本地文件夹」**：Swipt 没有向插件暴露 `UIDocumentPicker`（`@swipt/api/file-system` 只有 `data / cache / assets` 三个句柄，dataDirectory 在 Application Support 下，不在「文件」App 可见范围）。要做这个只能给 Swipt 加一个 picker 模块，属于宿主改造，一期不做。若用户确实需要，退路是「把 zip 放到能通过 URL 访问的地方」或「剪贴板粘贴文本」。
- 运行期：解析 frontmatter（name/description/invocation）→ 只把索引进系统提示 → `read_skill(id|name)` 返回全文 + 资源清单；`list_skills` 供模型检索。
- 绑定：Agent 编辑页勾选技能；`invocation.modelInvocable=false` 的技能不进索引。
- 一期不做市场与版本更新。

**验收**
- 导入 2 个技能，系统提示里只出现名字+描述；模型在处理匹配任务时主动 `read_skill` 并按其步骤执行；未绑定的技能不可见。

**风险**：SKILL.md 可能很长（吃上下文）——加 8KB 上限与超长警告。

### P6 会话管理与检索（3 人日 ≈ 24 Agent 小时）

- 会话列表（按 `last_activity_at`）、改名、删除、清空全部；消息分页（每页 30 条向上加载）。
- 搜索：先 `LIKE`；sqlite 桥支持 FTS5 则建虚表，`searchable_text` 写入。
- 导出：Markdown 文件到 `dataDirectory/exports/`，经 `present`/分享（Swipt 分享受限，先只落盘+复制路径）。

**验收**：100 个会话 / 5000 条消息下列表与分页不卡；搜索命中定位到消息。

### P7 体验打磨（3 人日 ≈ 24 Agent 小时）

- Markdown 渲染（`react-native-markdown-display`）+ 代码块（等宽、横向滚动、复制）。
- 思考折叠、工具卡片折叠、耗时与 token 用量（pi-ai `usage`）。
- 错误分类（网络/鉴权/限流/上下文超限）与重试；限流退避。
- 键盘/安全区回归（已有一版，随新布局复测）。

---

## 7. 关键设计决策

1. **循环在 extension service，不在 app**（2026-11-10 改）：后台长跑是硬需求，而 Swipt 的 service（`"service": true` + `defineExtension({ run })`）由宿主 supervise + 自动重启，配合无声音频保活可以一直跑；app runtime 只在前台活着，关掉不影响任务。代价是 service 没有 React，状态全落库。
2. **工具直接写在 service**：device/input/accessibility 本来就只在 extension 侧存在，循环搬过去后工具调用是同一 runtime 内的函数调用，不再跨 action 转发，也少一次 200–800ms 的冷启动。
3. **审批只能前台做，一期全 auto**：插件无法自绘系统弹窗，`appIntents` 的前置确认在后台会被 `ScriptDialogs` 收起；`ask` 的字段与 UI 留到二期，且注明仅前台有效。
4. **pi-durable 而不是自己写循环**：任务图、提交粒度、压缩、Fork、工具 task 都是现成的；代价是 Beta API 会变，需要锁版本（1.5.0）。
5. **持久化写穿而不是换 Storage**：pi-durable 的 sqlite 适配器面向 node/cloudflare，插件里没有 `node:sqlite`；先 `MemoryStorage` + commit 钩子写穿到自己的表，重开回放。spike 若发现 `storage/sqlite` 接受通用 driver，再替换。
6. **不引 UI 库**：所有候选 chat UI 库都依赖原生模块（reanimated / keyboard-controller），插件拿不到；手写列表 + 气泡换来完全可控（已在 v1–v5 验证）。
7. **MCP 手写 JSON-RPC**：官方 TS SDK 依赖 `fetch` 之外的 Node 能力（`events`、`AbortSignal.timeout`、可能的 `node:crypto`），打包与 Hermes 风险高；协议本身只有四个方法，手写更稳。

---

## 8. Spike 清单（P2 之前必须做，2 人日 ≈ 16 Agent 小时）

| # | 验证 | 失败则 |
|---|---|---|
| S1 | `pi-durable` 的 `Harness.open + submit + wait` 在 Hermes 下跑通最小问答（打包已验：零 `node:` 导入、1.61 MB、沙箱自带全部 Web API） | 退回「pi-ai 直连 + 自写 30 行循环」 |
| S2 | expo-sqlite 桥支持事务、`PRAGMA user_version`、并发读 | 单写队列 + 简单迁移 |
| S3 | 宿主 fetch 支持 POST + SSE 长连接 60s，abort 不崩 | 缩短连接、重连 |
| S4 | extension action 冷启动耗时与截图体积 | 工具结果改落文件+路径 |
| S5 | `screenshot` 返回结构（路径还是 base64）与模型图片输入上限 | 截图只给缩略图/尺寸信息 |
| S6 | 后台切前台后 pi 提交状态是否一致 | 强制中断重建 |

---

## 9. 排期（Agent 小时）

| 阶段 | 工时 | 依赖 |
|---|---|---|
| Spike | 16 | 补丁版 Swipt 已可装（build 999） |
| P0 UI 外壳照抄 | 16 | — |
| P1 基座与模型 | 24 | P0 |
| P2 pi 循环（service 常驻） | 48 | P1、S1 |
| P3 内置工具 | 32 | P2、S4/S5 |
| P4 MCP | 32 | P2 |
| P5 Skills | 24 | P2 |
| P6 会话管理 | 24 | P1 |
| P7 打磨 | 24 | 以上 |
| 合计 | **240 Agent 小时 ≈ 30 人日** | |

P0 已完成（v6–v27）。Provider 与智能体的**列表 UI 已随 P0 顺带做完**，P1 的存储替换（JSON → SQLite）与模型目录仍是 P1 范围。

建议顺序：~~P0~~ → Spike/P1 → P2（此时已可和 DeepSeek 对话）→ P3 + P6 并行 → P4 → P5 → P7。

---

## 10. 已拍板的决策（2026-11-10）

1. **模型层用 pi-ai**，由它封装各家的调用协议；我们在其上做「规范列表」（provider / model registry，见 §3.1）。一期只启用 OpenAI 兼容协议（`openai-completions`），预置目录 + 自定义 baseUrl 两条路。
2. **工具审批默认全 `auto`**，先把闭环跑通；`ask` 的 UI 与数据模型（`agent_tool_binding.approval`）保留，后续按工具粒度打开。
3. **Skills 导入要 URL 导入 + 本地文件夹**。URL 导入照做（zip / 单文件 SKILL.md）；**本地文件夹一期做不到**——Swipt 没给插件任何文件/目录选择器（`@swipt/api/file-system` 只有 `data / cache / assets` 三个句柄，dataDirectory 在 Application Support 下，不在「文件」App 可见范围）。替代：URL 导入、粘贴 SKILL.md、读系统剪贴板、Agent 用 `skill_create` 生成。要真支持「选文件夹」得给 Swipt 加一个 picker 模块（宿主改造，一期不改）。
4. **会话搜索用 FTS5**：建 `agent_session_message_fts` 外部内容表 + 触发器同步 `searchable_text`；GRDB 走的是系统 SQLite，FTS5 预期可用，但迁移时必须先探测 `CREATE VIRTUAL TABLE t USING fts5(x)`，失败自动降级 LIKE（并在设置页提示）。
5. **后台长跑是硬需求**（2026-11-10 追加）：agent 循环放 extension service（manifest `"service": true` + `run()`），靠 Swipt 自带的 Background Service（默认开、默认无声音频）保活；插件侧只需在 UI 里 `setEnabled(true)` 一次。详见 §3.2。副作用：后台弹不出审批，故一期全 `auto`。

6. **UI 照抄 Cherry Studio**（2026-11-10）：界面与交互按 `ui-spec.md` 1:1 重做，不引 heroui/uniwind/reanimated（插件拿不到原生模块），用 RN core 按同样的刻度重画；聊天页左上角加「返回 Swipt」（`exit()`），位于侧边栏按钮左侧。
