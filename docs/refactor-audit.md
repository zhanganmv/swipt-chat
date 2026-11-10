# Swipt Chat 代码与状态审计（重构前置）

> 审计时间：2026-11-10 · 代码基线：versionCode 15（`dist/swipt-chat.swiplet`，17,047 B）
> 审计方式：`src/` 全量 4,073 行逐个核对（App / chat / settings / sse / utf8 / log / PageStack / ChatScreen / SettingsScreen / SessionListSheet / ChatHeader / GlassControls / GlassToolbar / ComposerToolbar / extension / theme）+ `grep` 引用关系扫描 + `scripts/check.ts` 测试审查。
> 结论：**UI 已达标，底座不合格**。外壳是「一次性演示」的写法——状态、I/O、导航、渲染全压在 `App.tsx` 一个组件里，靠注释和 `useCallback` 手工维稳。继续往上叠 P1（provider 列表）、P2（pi 循环）、P3（工具）、P4（MCP）会把返工面放大数倍，所以应当**在 P1 开工前**先做结构重构。

## 1. 量化现状

| 文件 | 行数 | 判断 |
|---|---|---|
| `src/ui/Icon.tsx` | 479 | **死代码**（唯一活引用是未导出的 `ComposerToolbarRN`） |
| `src/screens/ChatScreen.tsx` | 425 | 键盘/滚动/渲染混在一起，422 行单组件 |
| `src/shell/ComposerToolbar.tsx` | 331 | 约 130 行是 RN 回退（`ComposerToolbarRN`），未 import |
| `src/screens/SettingsScreen.tsx` | 330 | 原生树 + 双写状态，行内 `NavigationDestination` × 7 |
| `src/shell/SessionListPanel.tsx` | 301 | **死代码**（v13 RN 面板，零引用） |
| `src/chat.ts` | 272 | 传输 + 领域 + mock + 探针混在一个文件 |
| `src/App.tsx` | 265 | 单一状态容器 + 全部 I/O + 路由渲染 |
| `src/shell/SessionListSheet.tsx` | 201 | 尚可，但回调每帧新引用 |
| `src/shell/PageStack.tsx` | 177 | 路由枚举与真实导航不一致 |
| `src/shell/ChatHeaderRN.tsx` | 133 | **死代码**（零引用） |
| `src/shell/DropdownMenu.tsx` | 114 | **死代码**（只被 ChatHeaderRN 引用） |
| `src/ui/Section.tsx` | 113 | **死代码**（零引用） |
| `src/ui/GlassButton.tsx` | 95 | **死代码**（只被 ChatHeaderRN 引用） |
| `src/ui/Sheet.tsx` | 69 | **死代码**（零引用） |
| `src/ui/IconButton.tsx` | 69 | **死代码**（只被 ScreenHeader 引用） |
| `src/shell/ScreenHeader.tsx` | 68 | **死代码**（零引用） |
| 其余（theme / sse / utf8 / log / settings / ChatHeader / GlassControls / GlassToolbar / extension） | 709 | 基本合格 |

**死代码 1,441 行 = 全量 35.4%**。零引用链：`ChatHeaderRN → {GlassButton, DropdownMenu}`、`ScreenHeader → IconButton`、`Section`、`Sheet`、`SessionListPanel`；`Icon.tsx` 只剩自身与死链引用。

**测试面**：`scripts/check.ts` 只有 7 条断言，全是 SSE 行解析与 UTF-8 解码；会话、流式状态机、设置读写、错误分支 **0 条**。

## 2. 问题清单

严重度：**S1 会让下一步功能做不下去 / 已有隐性 bug**；**S2 结构债，改一处要动多处**；**S3 卫生问题**。

### S1-1 状态、I/O、业务规则全在 `App.tsx` 一个组件里

- `src/App.tsx:38-49`：`settings / sheetOpen / agentId / sessions / currentId / draft / streaming / error` 八个 `useState` + `abort / pending` 两个 `useRef`，是整个应用的全部状态。
- `src/App.tsx:72-135`：`send()` 在闭包里同时做——生成 id、造 user/assistant 两条消息、建/选会话、拼历史、清草稿、置 streaming、建 AbortController、调 `streamMock`/`chat`、把每个 delta 写回状态、收错、收尾。
- 后果：任何一条业务规则（例如「重试」「编辑后重发」「多智能体各自模型」）都得进这个 async 闭包；组件无法在测试里驱动这条规则；`send` 的依赖数组 `[currentId, draft, messages, patchSession, settings, streaming]`（`:135`）随每次击键、每个 token 变化。
- 修法：把「一轮对话」抽成 React 之外的 async 函数 `runTurn(input, emit, signal)`，状态变更走 reducer；组件只负责 `dispatch(start/send/stop)`。

### S1-2 每个 token 重建全部会话与全部消息

- `src/App.tsx:108-119`：`onDelta` 把 token 拼进 `pending.current`，然后 `patchSession` → `setSessions(list => list.map(...))`，再 `[...list]` 复制整个消息数组、替换最后一条。
- 60 token/s ⇒ 每秒 60 次「复制会话数组 + 复制消息数组 + FlatList data 全新引用」⇒ 全部可见行 re-render（React 19 没有编译器，靠引用比较）。
- 同一路径还在 `src/App.tsx:162-167` 每次渲染重建 `sessionRows`。
- 修法：token 先进可变的 per-message buffer，**50ms 批量 flush 一次**（或 `requestAnimationFrame`），flush 才进 reducer；列表按 `id` 取稳定对象。

### S1-3 「memo 靠手工维稳」已被再次打破（现存 bug）

v14 给 `ChatHeader` 加 `memo`、在 App 里把所有回调 `useCallback` 固定引用，才修掉「按钮要长按」。这套约定**没有结构保障**，v15 已经破了一次：

- `handleSend = useCallback(() => void send(), [send])`（`src/App.tsx:181-183`），`send` 依赖 `draft`/`messages`/`streaming`（`:135`）⇒ **每个 token、每次击键 `handleSend` 都是新引用** ⇒ `ComposerToolbar`（`memo`，`src/shell/ComposerToolbar.tsx:110`）在每个 token 失效 ⇒ 输入框那条 `Host` 每秒重建几十次 ⇒ v14 修掉的「点击被取消」在输入框**重新出现**。
- 同类：`SessionListSheet` 的 `onRename`/`onDelete`/`onClose` 是行内箭头（`src/App.tsx:245-257`），`SettingsScreen` 的 `onSaveSettings` 也是行内箭头（`:222-224`）；两张原生树都在流式期间无谓重建。
- 修法：回调由 store 暴露**稳定命令对象**（`useMemo` 一次的 `actions`），组件只吃 `actions.send`；并且加一条约定：`Host` 子树内只允许值类型 props + store 的稳定方法。这一条要写进 `ui-spec.md` §6。

### S1-4 会话零持久化，密钥明文落盘

- `sessions` 只在内存（`src/App.tsx:42`），插件被杀/切后台回收后**全部会话消失**；而 `docs/implementation-plan.md` 的 P1 验收第一条就是「会话持久化」。
- `src/settings.ts:30` 把 `apiKey` 与 baseURL 一起明文写进 `settings.json`；没有「密钥从哪来、能不能清空、是否回显」的定义。
- 修法：先定 `Storage` 端口（`read/write/list/delete`），一期用 JSON 实现、P1 换 SQLite 实现，**调用方不变**；密钥单独一个文件并明确「可在设置页清除」。

### S1-5 传输、领域、mock 混为一个模块

- `src/chat.ts`：`endpoint/payload/requestHeaders`（协议映射）、`streamChat/completeChat`（HTTP+SSE）、`probeNetwork`（诊断）、`streamMock`（演示态）四类东西同文件；`Settings`（端点配置）与设置页同名。
- 同一概念三套类型：`Session`（`src/App.tsx:12`）、`SessionRow`（`src/shell/SessionListSheet.tsx:34`）、`Message`/`Settings`（`src/chat.ts:9-21`），外加 `src/App.tsx:162-167` 一段手工映射。
- 修法：`domain/types.ts` 一份；`api/openai.ts` 只做「领域消息 ↔ 请求体」；`api/stream.ts` 只做字节流 → 事件；`dev/mock.ts` 单独一处；`errors.ts` 定义 `ChatError` 判别联合（超时 / HTTP / 解析 / 中止 / 网络）。

### S2-1 两套导航系统互不知情

- `src/shell/PageStack.tsx:12-23` 声明 11 个 `RouteName`，实际只有 `chat`、`settings` 会被 push（`src/App.tsx:169-174`、`renderRoute` 的 `switch` 只有两个 case，`default: null`）。
- 会话列表走 SwiftUI `BottomSheet`（不占路由），设置内部又有一套 `NavigationStack path`（`src/screens/SettingsScreen.tsx:74/108`）。
- 后果：深链/返回语义/「从设置直接跳到某个会话」都做不了；`RouteName` 里的 `sessions/providers/agents/tools/mcp/skills/general/about` 是死的。
- 修法：路由只保留 `chat` / `settings` 两个名字，会话列表改为 `chat` 内的 `overlay` 状态；设置内部导航交给 SwiftUI，JS 只保留「当前根」。

### S2-2 页面栈每帧全量重渲染

- `StackView`（`src/shell/PageStack.tsx:144-160`）对每个 route 调 `render(route, isTop)`，`render` 是 `Shell` 内联函数，`StackView` 没有 `memo`。
- 后果：流式期间，被设置页盖住的 `ChatScreen` 与 `SettingsScreen` 的 `Host` 树一起重建；`renderRoute` 里 `back = () => stack.pop()` 每次都是新函数。
- 修法：路由内容 `memo` 化，`render` 提到模块级或 `useMemo`；只把 `isTop` 相关的最小数据传下去。

### S2-3 设置页双写状态，靠 `useEffect` 回灌

- `SettingsScreen`：`draft`（JS）+ `baseURLText/modelText/apiKeyText`（`useNativeState`，原生）两份真相（`:75-80`）；进入 `providerEdit` 时 `useEffect` 把 JS 值灌回原生（`:84-95`，附 `eslint-disable-next-line react-hooks/exhaustive-deps`，而本仓库根本没有 eslint）。
- 后果：保存后若原生 field 的值落后半拍，就会出现「保存的跟看到的不一样」；撤回/多入口编辑无解。
- 修法：表单只在打开时读一次 store，提交时用**提交瞬间的值**（原生 `onTextChange` 已镜像到 `draft`），保存后关页；不再在 `useEffect` 里回灌。

### S2-4 死代码 1,441 行（35.4%）

见 §1 表。这些文件里 `Icon.tsx` 甚至带着「P0 临时判断」的注释，仍在被 `ComposerToolbarRN` 引用，导致读者难以判断哪些是活路径。

### S2-5 错误处理只有一条字符串通道

- `completeChat` 的 `JSON.parse(text)`（`src/chat.ts:207`）无 try：一个坏的 200 响应把 `SyntaxError` 原文抛给 UI。
- `streamChat` 把 `HTTP ${status} ${detail}`、超时中文串、网络原串混着 `throw new Error`（`:99-102`、`:134`），UI 只能原样显示（`src/screens/ChatScreen.tsx:160-166`）。
- 无「重试」语义：`send` 失败后 assistant 占位消息留在会话里（`:79/95`），用户看到一条空回复，且无法从 UI 恢复。
- 修法：`ChatError` 判别联合 + 消息级 `status: 'pending' | 'streaming' | 'done' | 'error'`，错误挂在消息上（而不是全局 `error`），UI 给出「重试」入口。

### S2-6 流控制是三个全局量 + 三处手工重置

- `abort` / `pending` / `streaming`（`src/App.tsx:45-49`）是全局的；`stop`（`:137-141`）、`newChat`（`:143-151`）、`openSession`（`:153-160`）各自重复 6 行「abort + 清 streaming + 清 error + 清 draft」。
- 漏一处 = 切会话后旧流继续往新会话里写（目前靠 `target` 闭包兜住，但这是巧合不是设计）。
- 修法：一轮生成 = 一个 `Turn` 对象（`id / conversationId / abortController / status`），放 reducer 里；切会话时 `cancelTurn(prev)` 是 reducer 的一个 action。

### S3 卫生问题

- `src/App.tsx:17-24`：`counter` / `nextSessionId` / `nextMessageId` / `titleOf` 藏在组件文件里；`nextMessageId` 用「时间戳 + 进程内计数器」，会话一旦持久化，重启后计数器归零 + 同毫秒可撞 id。
- 文案散落：`"给 Swipt Chat 发消息"`、`"新对话"`、`"本地 Mock"` 等硬编码在 6 个文件里，无 strings 模块。
- `tsconfig.json` 开了 `strict` 但没开 `noUncheckedIndexedAccess`；`src/App.tsx:113` 的 `copy[copy.length - 1]`、`src/chat.ts:210` 的 `choices?.[0]` 都是这类热点。
- 无 lint、无 CI；`npm run check` 只在本地手动跑。
- `scripts/check.ts:9-10` 用 `JSON.stringify` 做断言比较，对象键序一变就假失败。

## 3. 目标结构

```
src/
  domain/
    types.ts          Conversation / Message / Agent / ProviderSettings（唯一真相）
    conversation.ts   纯 reducer + 选择器（可单测，无 React、无宿主 API）
    ids.ts            id 生成（持久化安全：时间前缀 + 随机后缀）
  api/
    openai.ts         领域消息 ↔ /chat/completions 请求体
    stream.ts         Response body → 事件（SSE 行解析留在 sse.ts）
    errors.ts         ChatError 判别联合 + 归一化
    probe.ts          网络自检
  dev/mock.ts         离线回显（不进生产路径分支）
  state/
    store.ts          reducer + actions（稳定引用，useMemo 一次）
    useChatStore.ts   批量 flush（50ms）+ 订阅
    storage.ts        Storage 端口（json 实现；P1 换 SQLite，调用方不变）
  features/
    chat/             聊天页（transcript + composer）
    sessions/         会话列表 sheet
    settings/         设置（原生导航）
  ui/                 原生基元：GlassToolbar / GlassControls / Host 包装
  theme/              令牌（保持现状）
```

**三条硬规则（写进 `docs/ui-spec.md` §6 与 `CONTRIBUTING`-等价的 `docs/architecture.md`）**

1. 组件里不做 I/O：`@swipt/api/http` 只允许出现在 `api/`。
2. `Host` 子树只吃「值类型 props + store 的稳定方法」；任何会导致 `Host` 每帧重建的 prop 一律视为 bug。
3. 领域规则只写在 `domain/`，且必须有 `scripts/check.ts` 断言；UI 改动不新增裸 `useState` 业务状态。

## 4. 重构分期

| 步 | 内容 | 验收 | Agent 小时 |
|---|---|---|---|
| R0 | 删死代码（1,441 行）+ 建立 `docs/architecture.md` 三条规则 | `wc -l` 降到 ≈2.6k；`tsc`、构建、真机装包正常 | 2 |
| R1 | `domain/` + `ids.ts` + reducer + 单测（会话增删改、流式状态机、错误态） | `npm test` ≥ 20 条且覆盖 error/abort 分支 | 6 |
| R2 | 拆 `api/`（openai / stream / errors / probe）+ `dev/mock.ts` | `chat.ts` 消失；坏 JSON、超时、中止各有判别分支测试 | 4 |
| R3 | `state/store.ts` 接进 UI，替换 App 的 8 个 `useState`；delta 批量 flush | 流式 60 token/s 时每 50ms 一次渲染（可在 log 里打点计数）；顶部与输入框 Host 零重建 | 6 |
| R4 | 导航收敛（只留 chat/settings）+ `StackView` memo 化 | 设置打开时流式不再重建设置树；返回语义单一路径 | 3 |
| R5 | 设置页改为单一真相（去掉回灌 effect） | 保存后立刻重进表单值一致；`eslint-disable` 注释消失 | 3 |
| R6 | `Storage` 端口 + 会话落盘（JSON）+ 密钥独立文件 | 杀进程重启后会话与草稿恢复；`API Key` 可在设置里清除 | 5 |
| 合计 | | | **29** |

顺序理由：R0/R1/R2 无 UI 风险（纯结构 + 测试），先做；R3 是唯一的「手感回归风险点」，单独一步、留真机验证；R4/R5 是 UI 结构收尾；R6 与 P1 的 SQLite 迁移天然合并。

## 5. 不做的事（本轮明确排除）

- 不把聊天正文/输入框迁原生（`RNHostView` 那条路等性能 spike）。
- 不引入状态库（`zustand`/`jotai` 都不进包）——reducer + 稳定 actions 足够，且少一个白名单风险。
- 不做 i18n 化（只把文案集中到 `src/strings.ts`，不引框架）。
- 不动 `~/GitHub/swipt`，不动 UI 视觉与尺寸（重构图的是数据流，不是外观）。

## 6. 已知未验 / 疑似有坑

- **已知未验**：`BottomSheet` 从 1×1 Host present、输入框原生行、`Menu` 浮层——都只在真机；本次重构不改变这些结构，R3 完成后需要**重新装包验一次**（尤其是 Host 不再重建之后，点击是否更顺）。
- **疑似有坑**：`useNativeState` 的文本镜像在 R5 改法下仍依赖原生 `onTextChange` 的时序；中文输入法组合态（拼音未上屏）是否触发 `onTextChange` 未验，若触发会把拼音写进保存值——R5 需要真机试中文输入。
- **疑似有坑**：会话落盘后 `nextMessageId` 的时间戳+计数器方案必须换成 `ids.ts`，否则同毫秒重启会撞 id（R1 一并解决）。
- **风险**：R3 批处理若用 `setTimeout(50)` 在后台被节流，流式看起来会一顿一顿；更稳的是 `requestAnimationFrame`（前台）回落 `setTimeout`，真机确认。

## 7. 执行状态（2026-11-10，R0–R6 已完成）

| 步 | 状态 | 落地 |
|---|---|---|
| R0 | 完成 | 删 9 个死文件（1,441 行）；`src/ui/` 目录清空删除；`ComposerToolbarRN` 回退一并删；新建 `docs/architecture.md` |
| R1 | 完成 | `src/domain/{types,ids,provider,conversation}.ts`，`reduce` 覆盖 begin/delta/end/stop/hydrate/select/newChat/rename/remove/sheet/agent/provider |
| R2 | 完成 | `src/api/{errors,openai,request,stream,turn}.ts` + `src/dev/mock.ts`；`src/chat.ts`、`src/settings.ts` 删除 |
| R3 | 完成（真机待验） | `src/state/useChat.ts`：`FLUSH_MS=50` 批量 flush、`SAVE_MS=400` 防抖落盘、`stateRef` 让 `send` 零依赖、`actions` `useMemo` 固定 |
| R4 | 完成 | `PageStack` 收敛为 `"chat" \| "settings"`；`StackView` 去掉内联 render 的隐式重建，`render(route)` 少一个参数 |
| R5 | 完成 | `SettingsScreen` 单一真相：`ProviderEditForm` 用 `key={formKey}` 重新挂载取种子值，回灌 `useEffect` 与无效 eslint-disable 删除 |
| R6 | 完成（真机待验） | `src/state/{storage,deviceFiles}.ts`：`conversations.json` / `draft.json` / `provider.json` / `secrets.json` 四文件，`streaming` 残局恢复 |
| 测试 | 远超口径 | `scripts/check.ts` 70 条断言（目标 ≥20）；`canon()` 规范化比较替掉 `JSON.stringify` |

行数：`src/` 4,073 → **3,328**（净删死代码 1,441，同时新增 domain/api/state 约 1,100 行）。因为 R6 与 P1 提前合并（JSON 落盘而非 SQLite），P1 里的 SQLite 迁移按原计划在 P1 做。

> **本文是重构那一刻的审计记录**。之后的口径变化（v17–v27）：`PageStack` 已在 v20 删除（改成一个 `NavigationStack`、Chat 作根）；`provider.json` 拆成 `providers.json` + `secrets.json`，并新增 `agents.json`；断言 70 → 88 条；`src/` 当前 4,065 行。现状一律以 `architecture.md` 与 `ui-spec.md` 为准。

**剩余**：真机装 v16 验四件事——流式期间顶栏/输入框点击是否即时、会话与草稿杀进程重启是否恢复、中文输入法在原生表单的行为、会话列表 sheet 手势。SQLite/FTS5 与 provider 列表页仍按 P1 计划。