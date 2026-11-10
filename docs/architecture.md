# Swipt Chat 架构

本文是重构（R0–R6）之后的事实记录。改动代码前先读这三条硬规则，再往下看目录职责。

## 1. 三条硬规则

1. **组件不做 I/O**。`@swipt/api/http` 只允许出现在 `src/api/`，`@swipt/api/file-system` 只允许出现在 `src/state/deviceFiles.ts`，`@swipt/api/swiplet`（`exit`、`useService` 等宿主能力）只在 `src/shell/` 或 `src/screens/` 的边界层用。组件想读数据就调 store 的方法，想发请求就调 `useChat().actions.send`。
2. **`Host` 子树只吃值类型 props 和稳定方法引用**。传进 `@expo/ui` 原生树的 props 必须是 string/number/boolean/`null` 或 `useCallback`/`useMemo` 固定的引用；不允许在渲染期新建箭头函数、数组、对象。稳定性由 `memo` 的屏幕组件 + store 的固定 `actions` 共同保证——这是 v14「按钮要长按才生效」的根因，别再退化。
3. **领域规则只写在 `src/domain/`，且必须有断言**。消息状态机、标题生成、provider 归一化、id 生成都属领域；`scripts/check.ts` 必须覆盖它们的每条分支（含 error / abort）。UI 里不新增裸 `useState` 承载业务状态。

## 2. 目录职责

| 路径 | 职责 | 允许依赖 |
|---|---|---|
| `src/domain/` | 类型、reducer、id、provider 归一化、标题 | 无 host API，纯函数 |
| `src/api/` | OpenAI 兼容协议：URL/头/体、SSE 解析、错误分类、单回合编排 | `@swipt/api/http`（仅 `request.ts`） |
| `src/dev/` | 本地 Mock 流（无 provider 时使用） | 无 |
| `src/state/` | `useChat` 状态钩子、JSON 持久化、设备文件驱动 | `domain`、`api`、`@swipt/api/file-system`（仅 `deviceFiles.ts`） |
| `src/screens/` | 聊天页（RN 正文）、设置页 `SettingsPages`（一组 `NavigationDestination`） | `state`、`shell`、`theme` |
| `src/shell/` | 顶栏、玻璃控件、四个抽屉（会话列表 / 智能体选择 / 模型服务 / 新建智能体）、抽屉生命周期 | `@expo/ui`、`@swipt/api/swiplet` |
| `src/App.tsx` | 装配：一个 `NavigationStack`（Chat 作根）+ 常挂载的抽屉 + 宿主主题 | 以上全部 |
| `src/theme/` | 设计令牌（来自 Cherry 的 oklch 换算） | 无 |
| `scripts/check.ts` | 断言集合（`npm test`） | 只 import 纯模块 |

## 3. 数据流

```
用户输入
  └─ ChatScreen.onSend ──► useChat.actions.send()
                            ├─ dispatch begin      （user done + assistant streaming 一次插入）
                            ├─ runTurn(provider, messages)
                            │    ├─ api/request.ts → 宿主 fetch
                            │    ├─ api/stream.ts  → readDeltas → onDelta（进 buffer）
                            │    └─ api/openai.ts  → 非流式 completionOf
                            ├─ flush()             （每 50ms 把 buffer 合进一次 delta）
                            └─ dispatch end/stop   （done 或 error，turn 置空）
```

- **渲染节奏**：`FLUSH_MS = 50` 把 token 增量合并成一次 `dispatch`，60 token/s 的实际渲染是 20 次/s，而不是 60 次/s（旧的实现每个 token 复制整份会话数组）。
- **引用稳定性**：`useChat` 里 `stateRef` 持有最新 state，`send` 的依赖数组为空，所以 `actions.send` 的引用在组件生命周期内不变；`actions` 由 `useMemo` 固定。流式期间 `ChatScreen`/`ComposerToolbar`/`ChatHeader` 的 `Host` 不重建。
- **中止**：`stop()` 只 `controller.abort()`，收尾由 `send` 的 catch 分支 `dispatch stop`，或正常返回后的 `dispatch end` 完成；按 `messageId` 定位，所以切走会话/新建会话后旧流也能正确收尾。

## 4. 消息状态机

```
(无) ──begin──► streaming ──end(done)──────────► done
                    │
                    ├──end(error, msg)─────────► error（保留 error 文案）
                    └──stop（content 为空）─────► error（error = "已停止生成"）
                       stop（已收到部分内容）───► done（保留部分内容）
```

持久化读到 `status === "streaming"`（说明进程在生成中被回收）时按同一语义修复：空内容 → `error` + `已停止生成` 的等价文案 `生成已中断`；有内容 → `done`。

## 5. 持久化

四个文件，都在插件 data 目录（`dataDirectory.file(name)`）：

| 文件 | 内容 | 写入时机 |
|---|---|---|
| `conversations.json` | `{version:1, conversations:[{id,title,updatedAt,messages}], currentId}` | 会话/当前选中变化后 400ms 防抖 |
| `draft.json` | 当前草稿字符串 | 草稿变化后 400ms 防抖（独立文件，避免每按键重写全部历史） |
| `providers.json` | `{version:1, activeId, providers:[{id,name,baseURL,model,stream}]}`（**不含 apiKey**） | 服务列表或当前项变化后 400ms 防抖 |
| `secrets.json` | `{version:1, keys:{<providerId>: apiKey}}` | 同上（与 `providers.json` 分开，便于单独清除 / 报 bug 时只发前者） |
| `agents.json` | `{version:1, activeId, agents:[{id,title}]}` | 智能体列表或当前项变化后 400ms 防抖 |

解码是宽容的：坏 JSON、非对象、缺 id 的记录逐条丢弃，不因为一条脏数据让整个历史打不开。

## 6. 导航与呈现（v20–v27 定稿，实现在 `src/App.tsx`）

- **一个原生 `NavigationStack`，Chat 是根**，设置是 `path` 里的 `NavigationDestination value="settings"`。栈深决定宿主是否接管左缘滑动（`~/GitHub/swipt/Swipt/Automation/SwipletPresentation.swift:70`）：Chat 深 1 → 滑出回 Swipt；设置深 2/3 → 系统交互式返回。没有自绘手势条、没有 guard、没有 `PageStack`。
- **抽屉不在导航栈里**：四个抽屉由 `App` 常挂载，只传 `visible`；组件内部用 `useSheetLifecycle` 保持挂载到原生关闭动画结束，否则关闭会「直接消失」。`SheetShell` 是唯一的抽屉壳（1×1 `Host` + `BottomSheet` + detent + 系统抓手）。
- **安全区**：`ZStack { Rectangle(foregroundStyle(background) + ignoreSafeArea(container)); RNHostView(Chat) }`。`background(...)` 涂不到安全区带子，因为背景只画在视图边界内。
- **键盘**：只由 SwiftUI 导航栈避让，RN 侧不测量、不加 `paddingBottom`（叠加会把输入框顶到屏幕上沿）。离开聊天页时 `Keyboard.dismiss()`，键盘不跟到设置/抽屉。
- **流式渲染**：`useChat` 50ms 合并增量；`ChatScreen`/`ChatHeader`/`ComposerToolbar` 都是 `memo` + 稳定回调，`renderItem` 用 `useCallback`、`MessageRow` 是 `memo`；跟底只在内容变长时无动画触发。

## 7. 测试口径

- `npm test` 跑 `node --experimental-strip-types scripts/check.ts`，当前 **88 条断言**，覆盖 reducer 全分支、SSE/UTF-8、错误分类、storage 编解码与恢复（含 providers/agents 两个列表、密钥拆分、activeId 失效回落）。
- 断言用 `canon()` 规范化比较（键排序），不用裸 `JSON.stringify`——键序不该让测试变红。
- 为了让 node 直接加载 ESM，`src/**` 的相对 import 一律写显式扩展名（`./x.ts` / `./x.tsx`），`tsconfig.json` 打开 `allowImportingTsExtensions`（配合 `noEmit`）。新增文件请沿用，否则 `npm test` 会报 `ERR_MODULE_NOT_FOUND`。
- 纯模块才进测试；`useChat` 依赖 React，不在本机跑，真机验。

## 8. 现状与目标的差距

本文描述的是**当前 app-only 形态**：会话与配置存 JSON（§5）、agent 循环还没接（`src/api/turn.ts` 直接请求 OpenAI 兼容接口，没有 provider 时走 `src/dev/mock.ts`）。`docs/implementation-plan.md` §4 的「service + SQLite + pi」是目标架构，尚未开工；两者不要混着引用。