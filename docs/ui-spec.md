# Swipt Chat · UI 规范（照抄 Cherry Studio）

> 依据用户 2026-11-10 的决定：**界面与交互直接照抄 Cherry Studio**，可以换兼容的 RN 组件，但视觉与交互不简化。
> 参考实现：`~/GitHub/cherry-studio-app`（下文路径都相对它）。本文每条数值都能回到源码行，改动前先回读。

## 0. 两条底线

1. **视觉与交互照抄，代码我们自己写**。Cherry 的 UI 建立在 heroui-native + uniwind（Tailwind 编译期转换）+ reanimated + gesture-handler 上，这些原生模块在 Swipt 插件里一个都拿不到（见 `implementation-plan.md` §3），所以「照抄」只能是**按同样的刻度、间距、层级重画**，不是拷文件。好处是界面一致，也不存在把 AGPL 代码并进我们包里的问题。
2. **不偷懒的判据是截图对齐**：每屏做完，和 Cherry 同屏截图（iPhone 27.0.1，亮/暗两套）并排放，差在哪就改哪。数值允许因为 RN 渲染差异微调 ±1，但不允许「大概齐」。

## 当前基线（v27，以此为准）

这一节是唯一口径。**下面的 §2、§3 和 §9–§20 是变更记录**，写在当时的形态里，其中若干方案已被推翻——读它们是为了知道「为什么不是那个样子」，实现以本节为准。

**导航**
- 只有一个原生 `NavigationStack`，**Chat 是它的根**，设置是应用内 `path` 推入的 `NavigationDestination`（`value: "settings"`），设置二级页再往里推。
- 栈深直接决定滑动返回归属（宿主 `SwipletPresentation.swift:70` 的规则）：Chat（深 1）左缘滑动 → 宿主 dismiss 回 Swipt；设置根（深 2）→ 系统交互式拖回 Chat；设置二级（深 3）→ 逐级拖回。没有自绘手势条、没有 guard 视图、没有 `PageStack`。
- 根页没有标题也没有 toolbar 项，所以系统不画导航栏；顶栏是我们自己的 `GlassToolbar`。

**抽屉（四个）**
- 会话列表、智能体选择、模型服务表单、新建智能体，统一走 `SheetShell`：1×1 `Host` + `BottomSheet` + `presentationDetents` + `presentationDragIndicator("visible")` + `presentationCornerRadius(28)`。
- 关闭动画由 `useSheetLifecycle` 保证：组件在第一次 `true` 时挂载，只在原生 `onIsPresentedChange(false)` 之后卸载。父组件必须**常挂载**、只传 `visible`。
- 「正在编辑的记录」与「抽屉是否打开」是两个状态（v30 是 `createTemplate` / `createOpen`），关闭时不立刻清记录，否则表单会在滑出的 0.3 秒里闪成空白。

**控件**
- `src/shell/GlassControls.tsx`：40×40 玻璃圆钮、胶囊按钮、按钮组，**尺寸、`contentShape`、玻璃全部画在 label 上**；外层 `Button`/`Menu` 只留 `buttonStyle("plain")`、`disabled`、`accessibilityLabel`。图标 17pt。
- 按钮组 `GlassButtonGroup` 是一颗玻璃胶囊里并排两个图标（会话列表 / 更多），容器本身不是按钮。
- 智能体胶囊：图标 + 名称，`padding(horizontal 12)`、`frame(height 40)`、`lineLimit(1)`、`truncationMode("tail")`、`frame(maxWidth 150)`。

**顶栏与安全区**
- `GlassToolbar`：48pt 高、`HStack(spacing 10, alignment center)`、`background({type:"material",material:"regular"})`（原生模糊），浮在聊天列表之上。
- 安全区靠一层 `Rectangle(foregroundStyle(background) + ignoreSafeArea({regions:"container"}))` 涂色，不改内容布局。用 `background(...)` 涂 `Host`/`NavigationStack` 不生效——背景只画在视图边界内，安全区带子在边界之外。

**聊天区**
- 聊天正文与输入框仍是 RN（`RNHostView`）：富 Markdown、代码块、图片、虚拟化都靠 RN，原生只负责外壳、列表、设置、抽屉、顶栏。
- 输入区在正常流里，不是浮层；**键盘避让只由 SwiftUI 做**，RN 侧不再自己加 `paddingBottom`（两层叠加会把输入框顶到屏幕上沿）。
- 滚动：`FlatList` 是唯一滚动容器；跟底只在内容变长时触发且 `animated: false`；「回到底部」常挂载、用透明度切换；`MessageRow` 有 `memo`。

**没有画的（别在实现里凭空补）**：Cherry 参考图里的输入框展开箭头、思考档位、页脚「内容由 AI 生成，仅供参考」，都要等 P2 的输入框能力。

## 1. 设计令牌（已落地）

`src/theme/tokens.ts` 是 `packages/design-tokens/src/styles/native.css` + `tokens/colors/vercel.css` 的移植：oklch 已换算成 sRGB（RN 的颜色解析器不吃 `oklch()`）。

关键值（亮 / 暗）：

| 令牌 | 亮 | 暗 | 用途 |
|---|---|---|---|
| `background` | `#f5f5f5` | `#000000` | 页面底 |
| `card` | `#ffffff` | `#1a1a1a` | 卡片、输入框浮层 |
| `foreground` | `#171717` | `#ededed` | 主文字 |
| `muted-foreground` | `#4d4d4d` | `#a0a0a0` | 次要文字 |
| `border` | `rgba(0,0,0,.081)` | `rgba(255,255,255,.09)` | 发丝线 |
| `secondary` / `muted` / `accent` | `rgba(0,0,0,.05)` | `rgba(255,255,255,.07)` | 按压底、选中底 |
| `sidebar` | `#fafafa` | `#1a1a1a` | 侧边栏 |
| `chat-user` | `rgba(0,0,0,.05)` | `rgba(255,255,255,.07)` | 用户气泡底 |
| `primary` | `#107d32` | `#00ca50` | 主操作 |
| `brand` | `#ff5757` | `#ff5757` | 品牌红（logo 用） |

字号阶梯（`global.css` 的「无障碍档位 0」快照）：xs 13/18、sm 14/20、base 16/24、lg 18/28、xl 20/26、2xl 24/32、3xl 32/40。
圆角：基准 `--radius: 8`，`rounded-xl`=12、`2xl`=16、`3xl`=24；用户气泡是写死的 **18**。

## 2. 外壳：页面栈 + 会话抽屉（历史：v7–v19，现状见「当前基线」）

**为什么去掉抽屉**：参考实现用的是 `expo-router/drawer` + gesture-handler，由原生驱动手势与视差。插件运行时的 RN 里没有 gesture-handler、没有 reanimated，用 `PanResponder` 重绘的抽屉「手感和 RN 差别太大」（用户 m01131 实测）。所以外壳改成两件事：

1. **页面栈**：所有二级页都从右侧整页推入（260ms，`useNativeDriver`），返回时向右滑出（220ms）。这正好对应原实现里「会话列表和设置右划进入整个页面」的行为，且不需要手势库。
2. **会话列表走底部抽屉**：列表类内容不占整页，参照官方 `simulate-location` 插件——`BottomSheet` + `presentationDetents(["medium","large"])`，顶部是 `.searchable(placement: navigationBarDrawer)` 的搜索框，结果在下面滚动，选中即收起。

| 项 | 值 |
|---|---|
| 推入 / 弹出时长 | 260ms / 220ms（ease-out） |
| 会话抽屉高度 | 屏高 68%（≈ medium detent），内容超出内部滚动 |
| 抽屉圆角 | 顶部 24 |
| 抽屉抓手 | 36×4，`border-strong` |
| 搜索框 | 高 38、圆角 12、`secondary` 底、左图标 16、`returnKeyType=search` |
| 会话行 | 高 ≈56（标题 base/单行 + 副行 xs muted），右侧 chevron |
| 长按会话 | 展开行内操作条：重命名 / 删除 / 取消（不做二级弹窗，避免 Modal 套 Modal） |

v9 起，抽屉里的**列表本体是原生 SwiftUI**（`Host` → `NavigationStack` → `List` + `searchable`）。

v13 曾把抽屉的出现方式放在 RN 侧自己实现（`Animated` 滑入 260/滑出 220ms + 34pt 抓手上挂 `PanResponder` + 面板只画 `glassEffect`）。**v14 推翻它，改用原生 `BottomSheet`**：「质感仍不对、不能下滑收起」两个症状都能对上——自己拼的玻璃没有系统材质，且 34pt 抓手压在 `NavigationStack` 导航栏上，触摸先被导航栏吃掉，`PanResponder` 收不到。现在根节点常驻一个 1×1 的 `Host`（不占位、不挡触摸），`BottomSheet` 挂在里面由系统 present：材质（`presentationBackground` 里的 `Rectangle` + `background({type:"material",material:"regular"})`）、圆角、detent、拖拽关闭与速度判定、背景遮罩全是系统行为。

为什么现在能用原生 `BottomSheet`：v13 的判断是「它只能从常驻挂载的 Host 里 present，而常驻全屏 Host 会吞触摸」。v14 用一个 1×1、只放 sheet 的 Host 绕过这一点——它不占布局，系统 sheet 在自己的窗口层级里接管手势，所以不再冲突。旧的 RN 版面板保留在 `src/shell/SessionListPanel.tsx` 作为回退。

## 3. 会话列表（历史：v9–v19，现状见「当前基线」）

- 呈现是系统 `BottomSheet`（v14），背景由 `presentationBackground` 里的 `Rectangle` + `background({type:"material",material:"regular"})` 提供——iOS 26 上 material 仍是半透明，这是 sheet 该有的材质；不再自己拼玻璃 + 半透明衬底。
- 里面是官方模拟位置插件的同款结构：`Host` → `NavigationStack` → `List`（`listStyle: plain`、`scrollContentBackground: hidden`）+ `searchable(query, { placement: "navigationBarDrawer", prompt: "搜索会话" })`，标题由 `navigationTitle("会话列表")` 交给系统。
- 搜索框是系统搜索栏，输入即过滤（本地标题包含匹配，不联网）；`useNativeState` 把输入镜像到 RN state 再用它过滤行。
- 每行是一个 `Button`（`buttonStyle("plain")` + `contentShape(rectangle)` 让整行可点）：标题 16（当前会话 `semibold`）+ 副行 13 muted；长按出原生 `ContextMenu`（重命名 `pencil` / 删除 `trash`，后者 `role="destructive"`），重命名走系统 `Alert.prompt`。
- 拖拽关闭、遮罩、圆角与速度判定都交给系统 sheet，不再有 RN 的 `PanResponder` 与自绘抓手（v13 那套留在 `src/shell/SessionListPanel.tsx` 作为回退）。
- 列表按 `updatedAt` 倒序；当前会话标题加粗。
- 行副标题：`N 条消息 · 刚刚 / X 分钟前 / X 小时前 / M月D日`。
- 空态：无会话「还没有会话」，无匹配「没有匹配的会话」。
- 选中行 → 收起抽屉 + 切到该会话；若正在流式生成，先 abort。
- 删除当前会话后回到空白新会话态（`currentId = null`）。

## 4. 聊天页

**顶栏**（`src/shell/ChatHeader.tsx`，v27 现状）
- 48pt 高、`GlassToolbar` 承载，`HStack(spacing 10, alignment center)`，背景是原生 material 模糊（浮在消息列表之上，见「当前基线」）。
- 从左到右：**返回 Swipt**（玻璃圆钮 `chevron.left` 17pt）→ **智能体胶囊**（圆形头像 + 名称，点开底部抽屉选择）→（弹性空间）→ 右侧**一组胶囊**里并排 **新增会话** + **更多**（更多是原生 `Menu`：会话列表、设置）。
- 顶栏只放这四项；模型、智能体、工具、MCP、技能全部在设置页，不在顶栏堆图标。
**以下是顶栏的变更记录（v8–v18），实现以上面「v27 现状」为准。**

- **实现（v10）**：顶栏抽成共享组件 `src/shell/GlassToolbar.tsx`（高 48、左右 12、间距 10、`controlSize("large")`），聊天页和设置页都只用它，两边不会漂。
- **实现（v13）**：四个控件改由 `src/shell/GlassControls.tsx` 统一出：`GlassButton`（图标钮）/ `GlassMenu`（图标菜单）/ `GlassChipMenu`（带文字的胶囊）。**尺寸写死 40×40**，玻璃用 `glassEffect` 自己画，不再依赖 `buttonStyle("glass")` 按图标宽度撑出的胶囊——`ellipsis` 比 `chevron.left` 宽，这正是「更多」看起来比旁边大的原因。菜单一并改回原生 SwiftUI `Menu`，由系统弹出液态玻璃浮层；RN 的 `DropdownMenu` 只留给 `ChatHeaderRN.tsx` 这个回退版本。
- **实现（v14，修点击手感）**：三处一起改，解决「点一下没反应、要长按」：
  1. `glassEffect` 去掉 `interactive: true`——interactive 玻璃会在按钮之上装自己的按压手势，两者打架，动作要按住一会儿才触发；
  2. 每个控件加 `contentShape(shapes.circle())`，命中区等于整个 40pt 圆，而不是中间 17pt 的图标；
  3. `ChatHeader` 用 `memo` 包住，App 侧的回调改用 `useCallback` 固定引用。聊天页每收一个 token 就重渲染，之前 `Host` 的 SwiftUI 树会被重建几十次/秒，落在两次重建之间的点击会被取消——这才是「长按才有效」的主因。
- **实现（v8 起）**：顶栏这一条 44pt 用 `@expo/ui` 的 `Host` 包住 SwiftUI `HStack`，按钮用 `buttonStyle("glass")` + `labelStyle("iconOnly")`，两个下拉直接用原生 `Menu`——和官方插件同一条路（官方 `simulate-location/src/App.tsx:245` 用 `buttonStyle("glassProminent")`，整屏都是 SwiftUI）。聊天内容仍是 RN，只有这条顶栏是 SwiftUI。
- 图标：SF Symbols（`chevron.left` / `person.crop.circle.fill` / `square.and.pencil` / `ellipsis` / `list.bullet` / `gearshape` / `plus`）。
- 回退：如果 `Host` 在插件运行时里不渲染或高度异常，`src/shell/ChatHeaderRN.tsx` 保留着纯 RN 版（半透明填充 + 亮边 + 高光条的近似玻璃），把 `ChatScreen` 的 import 换回去即可。

**消息列表**（`Message/rows/*`、`list/messageListLayout.ts`）
- 顶部内边距 12。
- 用户消息：整行右对齐，内容宽 ≤ 88%，气泡 `chat-user` 底、**圆角 18**、内边距 **16×10**，纯文本渲染（不做 Markdown）。
- 助手消息：整行宽 100%，**无气泡无背景**，内部 `gap 8`，Markdown 全量渲染（标题/列表/表格/代码块/引用）。
- 两者之间垂直间距 16。
- 长按消息 → 操作条（复制、引用、重新生成、朗读）；用户消息长按另有编辑。
- 生成中：最后一助手消息尾部一个 6pt 呼吸点（`Animated.loop`），停止按钮在输入框位置替换发送键。
- 列表底部跟随（v26）：`onContentSizeChange` 且当时贴底 → `scrollToEnd({animated:false})`；**不在 `onScroll` 里跟底**，也不用动画，否则系统动画会和用户惯性抢位移（"到到底变慢、回弹"的根因）。「回到底部」圆钮常挂载、`hidden` 时只切 `opacity` + `pointerEvents`，距列表底 12pt（`JumpToBottom`，36×36 原生玻璃圆钮）。

**输入框**（`packages/ui/src/components/composer/utils/composer-layout.ts`，全部为实测值）
- 外框：`card` 底、**圆角 32**、内边距 **12**、iOS 阴影（`shadowOpacity .06 / radius 12 / y 4`）。
- 文本：base 16/24，`paddingVertical 4`，最大高度 **132**（到顶后内部滚动）。
- 工具行：左「+」32 圆钮（图标 24）、模型胶囊（左右 10、gap 6、高 24 文字 13）、右发送/停止 32 圆钮；工具行与输入文本间 gap 12，工具之间 gap 8。
- v15 起工具行整条由 SwiftUI 画（`src/shell/ComposerToolbar.tsx` 一个 `Host` + `HStack`）：图标是真 SF Symbols（`plus` / `chevron.down` / `arrow.up` / `stop.fill`），不再用 `src/ui/Icon.tsx` 的 View 拼形；按钮 `buttonStyle("plain")` + 固定 32 框 + `contentShape(circle())`，玻璃不挂 `interactive`；组件 `memo` 只吃值类型 props，避免打字/流式时重建 Host 取消点击（同 v14 顶栏那三处修法）。「回到底部」圆钮同样是原生 `Button` + `glassEffect`（`JumpToBottom`）。原生背景色传 hex：`rgba()` 的 token 先按卡片底合成（亮 `#f2f2f2`、暗 `#2a2a2a`）。
- 空态占位：「给 Swipt Chat 发消息」；有内容时发送键变 `primary` 实底白箭头。
- 键盘：**由 SwiftUI 导航栈自己避让**，RN 侧不做任何测量（v21–v23 的教训：SwiftUI 已经为栈内容避让，再在 RN 里补 `paddingBottom` 就是两层叠加，输入框会被顶到屏幕上沿）。输入区在正常流里，不是绝对定位浮层。

**空态**（`ChatEmptyState`）：垂直居中，品牌字样 2xl/600 + 一行 muted 说明 + 建议卡片（2×2 网格，`card` 底、圆角 16、内边距 16、标题 16/500 + 副标题 sm/muted）。

## 5. 返回 Swipt 按钮（本次新增）

- 位置：聊天页顶栏**最左**，紧邻智能体菜单（原侧边栏按钮已随抽屉一起移除）。
- 形态：`chevron.left` 17pt，`GlassButton` 40×40 玻璃圆钮（尺寸与命中区都在 label 上，见「当前基线」）；与顶栏其它控件同高。
- 行为：`exit()`（`@swipt/api/swiplet` 的 `exit(): void`）——直接退出插件回到 Swipt 的插件页，不是页面栈的 back。**只在 app runtime 有意义**，service 里没有 UI，不调用。
- 无障碍：`accessibilityLabel="返回 Swipt"`，`accessibilityRole="button"`。
- 一致性：只有聊天根页放返回 Swipt；设置页及设置二级页的左上角是**系统导航栏的返回箭头**（我们不放自绘返回，否则会出现两层玻璃 / 两个返回）。

## 6. 其它屏

| 屏 | 结构（按参考实现） |
|---|---|
| 智能体列表 `/agents` | 顶栏「智能体」+ 右侧「+」；分组 `Section`（我的智能体 / 内置）；每行：头像 40 圆 + 名称 16/500 + 描述 sm/muted + 右侧 chevron；空态一张引导卡 |
| 智能体编辑 | 上半：头像 + 名称输入（`Input` 圆角 12、`card` 底）；指令大文本域（最小高 160）；模型选择行；工具授权段（本期只读展示 auto）；保存按钮 `primary` 胶囊 |
| 技能 `/skills` | 顶栏「技能」+「导入」；列表行：技能名 16/500 + 描述 sm/muted 两行截断 + 来源标签（URL/内置/生成）；详情页含 SKILL.md 全文与「启用」开关 |
| 插件（MCP）`/plugins` | 顶栏「插件」；两段：已连接 / 可添加；行：服务名 + 状态点（绿/灰/红）+ 工具数；详情页：工具列表（每行名称 + 开关）、连接信息、删除 |
| 设置根（v27 现状） | 一个 `NavigationDestination value="settings"` 的系统页面：`Toolbar` 里只放 `List`（`insetGrouped`）+ `navigationTitle("设置")` + inline 标题；左上角返回箭头**由系统栈提供**（v20 起不再放自绘返回）。分组只有 **对话**（模型服务、智能体，右侧显示数量）与 **能力**（工具、MCP 服务、技能）；「通用」「关于」已按用户要求删除（v17）。每行是 `Label`（SF Symbol）+ 右侧值，chevron 由系统给 |
| 设置二级页（v30 现状） | 每个能力都是 `NavigationDestination` 推入的系统页面，自带导航栏、返回箭头。智能体页仍是本次列表（轻点切当前、长按删除、右上角 +）；工具 / MCP / 技能三页先给占位与批次说明 |
| 模型服务（v36） | 首页按模板行分组（OpenAI / Anthropic / DeepSeek / 自定义，空组隐藏），行=名称 + 代理域名小字 + 「N 个模型」；右上角 `+` 是模板菜单（条目由 `model_provider_template` 生成），左滑删除。点行推入连接详情，再点模型推入模型详情 |
| 连接详情（v36） | 四段：连接（名称、模板只读、协议条件可改、Base URL、API Key、恢复默认地址、流式开关、ID）；模型（空态给「获取模型」「手动添加模型」，有模型时列表可左滑删）；高级（自定义请求头键值对，Anthropic 的 `anthropic-version` 只读展示）；危险操作（删除此连接）。没有全局保存按钮，编辑即时落库 |
| 创建连接（v36） | 底部抽屉：内置模板名称预填默认名称、API Key 必填、协议锁定；自定义模板多一个协议 Picker，Key 可空。创建即落库并直接推入连接详情 |
| 候选模型面板（v30） | 底部抽屉：搜索、全选、每个候选一个 Toggle，已添加的不再出现；「添加所选」才写入，拉取结果本身不改配置 |
| 模型详情（v30） | 基础（ID 只读、显示名、备注）/ 容量（最大输出 token、上下文窗口）/ 思考（OpenAI 推理强度三档，Anthropic 预算 ≥1024 且小于最大输出 token）/ 采样（Temperature、Top P，Anthropic 上限 1）/ 输入模态（图像开关） |
| 会话列表 | 不占整页：底部抽屉，见 §3 |
| 会话搜索 | 顶栏搜索框（圆角 12、`card` 底）+ 结果按会话分组，关键词高亮 |

`Section` / `Section.Item` 的行高、内边距、分隔线缩进待逐屏取样后补进本文（见 §8）。

## 7. 交互细节清单（Cherry 参考 → 我们的取舍）

这张表来自 Cherry 参考实现，逐条标明我们采不采：**已采纳**的按它实现，**已放弃**的不要照着写。

| 参考行为 | 我们的处理 |
|---|---|
| 左缘 20pt 横滑打开侧栏、右侧留 64pt 暗条 | **放弃**（v7）：没有 gesture-handler，`PanResponder` 重绘手感差；改为「设置页 + 抽屉」 |
| 目的地覆盖 push、目的地之间 replace | **不适用**：只有一个 `NavigationStack`，Chat 作根，设置是它的 `NavigationDestination` |
| 会话行左滑/长按进多选，底部浮层「取消 / 删除 N 条」 | **未做**：当前是行内 `ContextMenu`（重命名 / 删除）。多选留到 P6 会话管理 |
| 发送时键盘不收起；生成中发送键变停止 | **采纳**：`ComposerToolbar` 的发送/停止同一位，键盘不主动收 |
| 长按消息出操作条（复制、引用、重新生成、朗读） | **未做**（P2/P7），当前只有文本选择 |
| 所有 sheet 圆角 24、顶部抓手 36×4、背景 `card`、scrim 40% | **改为系统 sheet**（v14 起）：圆角 28、系统抓手、`presentationBackground` 材质、系统遮罩与拖拽关闭；关闭动画由 `useSheetLifecycle` 保证 |
| 触觉反馈（`expo-haptics`） | **放弃**：白名单里没有，退化为无触觉，不阻塞 |

## 8. 验收方法

1. 每屏先对照参考实现在模拟器/真机上截一张「同状态」的图（亮/暗各一），放 `docs/evidence/ui/`。
2. 用 `measure` 方式校对关键间距：顶栏控件 40×40 与图标 17、气泡内边距 16×10 与圆角 18、输入框圆角 32 与内边距 12、消息间距 16 —— 这四处是「看起来像不像」的决定项。
3. 交互逐条过 §7 清单，打字/发送/滚动/返回各录一段屏。
4. 差异登记在 `docs/evidence/ui/diff.md`：允许 ±1pt 渲染差，不允许结构性差异。
## 9. 重构后的行为变化（v16）

- **错误内联到消息**：不再有全局错误条。失败的回复停在原地，`status: "error"` 的消息下面追加一行错误文案（`接口返回 HTTP 401：…` / `接口没有返回任何内容` / `已停止生成`），颜色 `colors.error`。理由：错误属于那一回合，切走会话再回来还能看到。
- **设置页重进重新种子**：模型配置页每次进入都用当前已保存的 provider 重新挂载表单（`key={formKey}`），不再靠 `useEffect` 回灌；取消后再次进入不会残留上次未保存的输入。
- **流式渲染 20 次/秒**：token 增量在 `useChat` 里按 50ms 合并，聊天气泡的追加肉眼无差；顶栏与输入框的 `Host` 在整个生成期间不重建。
- **会话与草稿落盘**：会话列表、当前会话、草稿在 300ms 防抖后写入 SQLite；杀进程重启后恢复。生成中被杀的那条回复，重启后显示为「生成已中断」而不是永远转圈。

## 10. v17：点击命中区、抽屉质感、设置按「列表 + 抽屉表单」重排

改这四条的依据都是代码，不是手感猜测。

**按钮点不动（更多 / 新建会话 / 智能体）**
- 根因：`frame(40×40)` 与 `contentShape(circle())` 原来挂在 `Button`/`Menu` 外层，而 SwiftUI 的手势挂在 **label** 上 —— 只有中间的 17pt 图标可点，玻璃圆其余部分全不响应，于是表现为「轻点没反应、按住一会儿才生效」。
- 修法：尺寸、`contentShape`、圆形/胶囊底一律放进 label（`Image` 或 `HStack` 的 modifiers）。`GlassButton`/`GlassMenu`/`GlassChipMenu` 与输入框那一行（`ComposerToolbar`、`JumpToBottom`）统一按这个规则重写。
- 智能体胶囊：`padding({horizontal:12})` + 名称 `lineLimit(1)`/`truncationMode("tail")`/`frame({maxWidth:150})`，胶囊宽度随内容自适应，长名字不再顶到边缘或被硬截。

**会话列表抽屉**
- 标题：`navigationBarTitleDisplayMode("inline")`，不再出大标题。
- 抓手与下滑：给抽屉内容加 `presentationDetents([{fraction:0.72}, "large"])` + `presentationDragIndicator("visible")`。原生 `BottomSheet` 只有带 detent 时才给系统抓手，之前既没抓手也不能下拉收起。
- 背景：`presentationBackground` 的材质由 `regular` 改 `thin`；`regular` 在暗色聊天上读起来就是一块灰板。

**设置**
- 根页只留两组：对话（模型服务 / 智能体）与能力（工具 / MCP 服务 / 技能）；通用与关于删除。
- 模型服务：列表页（名称 + 模型名，当前项打勾），导航栏右上角「添加」→ 底部抽屉表单（名称 / 接口地址 / 模型名 / API Key / 流式开关，取消 / 保存）。长按行可「设为当前」「删除」。抽屉与表单共用 `src/shell/SheetShell.tsx`。
- 智能体：同样的列表 + 右上角「添加」+ 抽屉表单（名称），轻点切换当前智能体，长按删除。数据落 `agents.json`。
- 工具 / MCP / 技能：结构与上面一致（列表 + 右上角「添加」），数据层未到，空态与点击提示写明对应批次（P3 / P4 / P5），不放一个点了没反应的按钮。

## 11. v18：工具栏分组、抽屉白色玻璃、与 Cherry 参考图对齐

- **右上两个图标并进一个胶囊**：`GlassButtonGroup`（`src/shell/GlassControls.tsx`）画一颗 capsule 玻璃，内部两个 36×40 的图标按钮（新增会话 / 更多）各自保留命中区。胶囊本身不是按钮，因此不装手势；形状参照 Cherry（`IMG_6170`：右侧一颗胶囊里放会话与新建两个图标）。
- **所有控件由 label 决定尺寸**：玻璃、`frame`、`contentShape` 一律在 label 上（v17 的做法沿用），这样「画出来的形状 = 布局尺寸 = 命中区」。智能体胶囊也是 label 自带 40 高 + capsule 玻璃，与 40 圆钮共用一条中线；工具栏 `HStack` 显式 `alignment="center"`。附加 `padding(horizontal:12)`、名称 `maxWidth 150` 尾截断，图标 13pt 放在 20×20 的框里。
- **会话抽屉背景**：根因是 `Rectangle()` 默认以前景色填充 —— 浅色模式就是黑色，材质被垫在它后面看不见，所以读起来是「黑灰色」。现在 `foregroundStyle("#FFFFFF66")` 叠在 `ultraThin` 材质上，得到白色半透明液态玻璃。
- **设置返回**：去掉「返回」文字，只留 `chevron.left`，图标 17pt 与聊天顶栏一致；按钮仍 `buttonStyle("plain")`，玻璃只由导航栏提供一层。

## 12. v19：滑动返回的归属

宿主自己在全屏呈现上装了一个左边缘 `UIScreenEdgePanGestureRecognizer`（`Swipt/Automation/SwipletPresentation.swift:51`），但它的 `gestureRecognizerShouldBegin` 有一条规则（同文件 `:70`）：**视图树里只要有一个 `UINavigationBar` 属于 `viewControllers.count > 1` 的 `UINavigationController`，宿主就让位**，把滑动留给插件自己的原生栈。这条规则正是我们需要的开关。

- **聊天页**（栈根，深度 1）：不做任何拦截，左滑仍由宿主把插件收回 Swipt。
- **设置根页**：挂一个不可见的 1×1 `SwipeGuard`（`src/shell/SwipeGuard.tsx`），里面是一个 `path = ["guard"]` 的 `NavigationStack`，深度为 2。宿主检查失败 → 不再收回插件；左滑交给 `EdgeBackGesture`（`src/shell/EdgeBackGesture.tsx`），从屏幕左缘拖过 60pt 就 `pop()` 回聊天。
- **设置二级页**（模型服务列表、编辑表单以外的页面）：`SwipeGuard` 也在，滑动由 SwiftUI `NavigationStack` 自带的交互式返回处理，回到设置根页。JS 侧通过 `path.length === 0` 判断是否在根页，只有根页才挂那条手势条。

验证方式：本机写了模拟器探针（`/tmp/navprobe`，SwiftUI 页面 + 1×1 clipped `NavigationStack` 深度 2），运行输出 `bar[0] delegate=SwiftUI.UIKitNavigationController vcCount=2`、`hostSwipeWouldBegin=false`，与该判定条一致。手势条只有 24pt 宽，且从 `top:104` 开始，避开导航栏的返回按钮；设置列表是 insetGrouped，行内容起点在 36pt 之外，不会被这条手势条盖住。

## 13. v20（分支 `feature/unified-navigation-stack`）：一个导航栈，Chat 作根

v19 用「隐形 guard + 自绘手势条」补平了宿主的判定规则，但手势是过阈值才播动画，不跟手，且设置根页多了一个和系统不一致的返回手势。这一版换成结构上正确的做法：**整个插件只有一个 `NavigationStack`，根页是聊天**。

- `src/App.tsx`：`<Host><NavigationStack path={path} onPathChange={setPath}><RNHostView><ChatScreen/></RNHostView><SettingsPages/></NavigationStack></Host>`。聊天仍由 RN 渲染，只是被 `RNHostView` 放进原生栈的根位置。
- `src/screens/SettingsScreen.tsx`：不再持有自己的 `Host`/`NavigationStack`，改为导出 `SettingsPages`——一组 `NavigationDestination`（`settings` / `providers` / `agents` / `tools` / `mcp` / `skills`），由 `App.tsx` 的栈挂载。
- 栈深即行为：聊天 = 1 → 宿主收回插件（滑回 Swipt）；设置 = 2 → 宿主让位，系统交互式返回拖回聊天；设置二级 = 3 → 逐级拖回。
- 设置根页的返回按钮改由系统提供（原来那颗自绘 `NavBackButton` 已删），避免出现两个返回。
- 删除 `src/shell/PageStack.tsx`、`SwipeGuard.tsx`、`EdgeBackGesture.tsx`：单一原生栈后，JS 侧不再需要页面栈、遮罩守卫或手势条。
- 待真机确认：聊天根页没有标题与 toolbar 项，SwiftUI 是否因此不显示导航栏；`RNHostView` 里聊天输入框的键盘避让与 SwiftUI 的避让是否叠加。

## 14. v21：安全区配色、按钮按压缩放、键盘只由聊天避让

- **安全区颜色**：`NavigationStack` 与 `Host` 都加 `background(colors.background)`。之前只有 RN 根视图涂了主题色，SwiftUI 的导航栈在状态栏与 home indicator 两条带子里用的是系统背景色（浅色偏白/深色纯黑），和聊天区的 `background` token 不是同一个值，于是顶部与底部各出现一条分界。
- **液态按压**：`glassEffect` 恢复 `interactive: true`。v14 关掉它是因为当时玻璃挂在 Button 外层、还带自装手势；v17/v18 把玻璃、`frame`、`contentShape` 全部移进 label 之后，interactive 玻璃与按钮手势在同一视图上合并，按下有液态形变，动作仍在抬手时触发。
- **键盘**：`RNHostView` 加 `ignoreSafeArea({ regions: "keyboard" })`。SwiftUI 自己会为导航栈内容做键盘避让，而聊天本来就用 `measureInWindow` 算重叠再抬输入框，两层叠加把输入框顶到了屏幕上方。现在只留聊天这一层。

## 15. v22：输入区贴键盘，不再测量输入框自身

- 目标行为：输入区始终贴在屏幕底部，键盘弹出时贴到键盘上沿。
- 做法：`App.tsx` 的 `RNHostView` 继续 `ignoreSafeArea({ regions: "keyboard" })`（SwiftUI 不参与避让），避让只在聊天内部算一次：`paddingBottom = 根视图底边 - keyboard.screenY`。
- 锚点从「输入框自身」换成「ChatScreen 根视图」：根视图的 frame 不随键盘变（`paddingBottom` 只改内部布局），所以只需在 `onLayout` 时测一次；输入框会随 inset 自己移动，用它当锚点会把移动量算进第二次计算。
- 两条坐标必须同一空间：键盘帧是屏幕坐标，因此用 `measureInWindow` 的根视图 y + height 作为底边；中途 `onLayout` 还没测到时退回 `endCoordinates.height`。

## 16. v23：键盘只由 SwiftUI 避让，聊天不再自己算

前两版的教训：只要聊天自己用「根视图底边 − 键盘上沿」再抬一次，而 SwiftUI 已经在为导航栈内的内容做键盘避让，两层叠加就会把输入区顶到屏幕上方（v20 就是叠加的结果，v22 换了锚点仍然是叠加，只是数值来源不同）。

- `App.tsx`：`RNHostView` 恢复为普通写法，不再 `ignoreSafeArea(.keyboard)` —— 让 SwiftUI 正常避让。
- `ChatScreen.tsx`：删掉 `keyboard` 状态、`Keyboard` 监听、根视图测量与 `paddingBottom`。输入区只是列表下方的一个普通子视图，宿主视图被键盘压矮后它自然落在新的底边——也就是键盘上沿。
- 代价：输入区位置完全交给 SwiftUI，我们不再控制它抬多高。如果真机上证明宿主视图在键盘弹出时**不**变矮，才需要回到自己算的形式，那时要用「先看宿主是否变矮、没变矮才补 padding」的写法，而不是无条件补。

## 17. v24：整屏滚动、顶栏模糊、智能体抽屉、安全区同色

这一版把聊天的版面从「上下分区」改成「整屏滚动 + 浮层」：

- **整屏作为滚动区域**：聊天页现在忽略容器的安全区（`RNHostView` + `ignoreSafeArea({ regions: "container" })`），`FlatList` 铺满整屏，用 `contentContainerStyle` 的上下 `padding` 给顶栏与输入区让位（`paddingTop = insets.top + 48 + 8`，`paddingBottom = composerHeight + bottomInset + 12`）。消息因此可以滚到状态栏与 home indicator 下面，而不是被夹在两条安全区带宽之间。
- **安全区同色**：上一条的直接结果。以前 RN 视图只在安全区以内，两条带子由 SwiftUI 的导航栈涂系统背景色，和聊天的 `background` 差一点点；现在带子也由 RN 涂，是同一个 token。
- **inset 自己量**：`src/shell/SafeArea.tsx` 用 `SafeAreaView` 当探针，把「表面」与「探针」两块矩形都做 `measureInWindow` 再相减，得到 `top`/`bottom`。不假设表面与窗口对齐，所以宿主若哪天不再全屏，数字仍然对。（`SafeAreaView` 在 RN 0.88 已标 deprecated，仍可用；换成别的方案只需要改这一个文件。）
- **键盘**：继续由 SwiftUI 避让（§16）。宿主变矮时把 `bottomInset` 归零（`surfaceHeight < windowHeight - 40` 判定），否则输入区会在键盘上方再抬一个 home indicator 的高度。
- **顶栏原生模糊**：`GlassToolbar` 的容器不再涂色，材料改成 SwiftUI 的 `background({ type: "material", material: "regular" })`，消息从下面滚过时透出柔和着色。顶栏仍是浮层（`position: absolute` + `paddingTop: insets.top`），高度 48。
- **智能体改底部抽屉**：`GlassChipMenu`（下拉菜单）换成 `GlassChipButton`（普通按钮）+ `AgentPickerSheet`（`BottomSheet` + 原生 `List`，点条目即选中并收起）。去掉「新建智能体」——智能体在 设置 → 智能体 里管，聊天顶栏只负责选择。胶囊宽度自适应内容，`AGENT_CHIP_MAX_WIDTH = 150` 之后省略号。
- **键盘不跟去设置**：`openSettings` / `openSessions` / `openAgents` 先 `Keyboard.dismiss()`。输入框属于正要离开的那一页，键盘不该被下一层继承（原来的现象：键盘还亮着，聊天里的输入区已经落回底部）。

## 18. v25：输入区回到正常流，安全区由一层背景矩形涂色

v24 把输入区做成浮层，再用它测出来的高度去补列表的 `paddingBottom`。两个问题：输入框长高时那个数字要跟着变（一旦测量没跟上，最后几条消息就被输入区盖住）；安全区两条带子仍然不是我们的颜色。

- **输入区不再浮层**：`ChatScreen` 的结构回到「列表在上、输入区在下」的兄弟布局。列表被布局压矮，而不是被一个 padding 数字让开，所以**不需要**动态管理底部 padding：草稿变多、输入框长高，`FlatList` 自己缩，最后一条消息永远在输入区上方。唯一还浮着的是顶栏，它占位是固定值 `HEADER_HEIGHT + 8 = 56`（顶栏高度不随内容变）。
- **不再全屏出血**：撤掉 `RNHostView` 的 `ignoreSafeArea`，聊天页回到安全区以内，输入区天然落在 home indicator 之上，`SafeArea.tsx` 的测量探针也一起删掉——不需要 insets，就不该留着测 insets 的代码。
- **安全区同色**：聊天根页改成 `ZStack`，第一层是 `Rectangle` + `foregroundStyle(colors.background)` + `ignoreSafeArea({ regions: "container" })`，它只会往安全区里渗，不改变内容的布局。状态栏与 home indicator 两条带子因此由我们的颜色涂，和列表主体是同一个 token。
- 采过的弯路记一笔：曾经用 `background(...)` 涂 `Host`/`NavigationStack`，两条带子仍然是系统色——背景修饰符只画在视图自己的边界内，而带子在边界之外。

## 19. v26：滚动到底部的顿感与回弹（三条一起改）

现象：滑到底部时速度像被拉慢、有一次不自然的回弹；怀疑「双滚动条」。排查后确认只有 `FlatList` 一个滚动容器（宿主 `RNHostView.swift` 不套滚动视图），问题是三件事撞在"到底"那一帧：

1. **自动跟底曾经对手势生效**。旧写法 `useEffect(..., [atBottom, messages])` 里 `scrollToEnd(animated: true)`：① 流式输出每 50ms 推一次消息，就重启一次动画；② 手指滑到底把 `atBottom` 置真时也触发，让系统动画和手上惯性抢同一段位移。现在只有 `onContentSizeChange`（内容真的变长）才跟底，且 `animated: false` —— 它是跳到最新一行，不是一个能抢惯性的手势。
2. **"回到底部"按钮在到底那一帧被卸载**。它是 `Host` + 原生 SwiftUI 按钮，拆装原生视图树的成本落在滚动帧里就是停顿。现在常挂载，只切 `opacity` 与 `pointerEvents`。
3. **整列表跟着流式重渲染**。`renderItem` 每次都是新闭包、`MessageRow` 没有 `memo`，于是每个 token 批都会重渲染所有可见行。现在 `renderItem` 用 `useCallback`、`keyExtractor` 提到模块级、`MessageRow` 包 `memo`。

顺带：`onScroll` 不再每次都 `setAtBottom`，而是先用 ref 比较、只有跨越阈值才更新状态，滚动过程中零重渲染。

## 20. v27：抽屉关闭要有动画

现象：选中一项或点「取消」时抽屉直接消失。原因不在 SwiftUI（`BottomSheet` 自己会播 dismissing 动画），而在我们这边：`<Sheet visible={open} />` 被条件挂在父组件里，关闭时父组件在同一个 commit 里把整棵子树卸载了，系统已经没有视图可以动画。

改法：新增 `src/shell/useSheetLifecycle.ts` 的 `useSheetLifecycle(visible)` → `{mounted, finish}`。组件在第一次 `true` 时挂载，只在原生 `onIsPresentedChange(false)`（关闭动画结束）后由 `finish()` 卸载。四个抽屉（会话列表、智能体选择、模型服务、智能体新建）全部改用它，并且在 `App` 里改成常挂载、只传 `visible`。

同时把「正在编辑的记录」与「抽屉是否打开」拆成两个状态（v30 是 `createTemplate` / `createOpen`）。原来关闭时立刻把记录清成 `null`，抽屉还在滑出的那 0.3 秒里表单已被重新 key 成空表单，字段会先闪成空白——现在关闭只关可见性，记录留到下一次打开时替换。

## 21. v30 → v36：模型服务重构为 模板 → 连接 → 模型

按用户给的交互文档整体重做，旧的一层「Provider + 模型 id 字符串」结构全部替换：

- **模板是数据**（v36 起）：`model_provider_template` 的行由 `src/state/seed.ts` 的种子 SQL 灌入，决定创建时的默认名称、默认 Base URL、可用协议与首页分组顺序；代码里不写厂商常量，新增厂商只改种子。连接（`ModelProvider`）才是管理对象，带不可变 `id` 与 `templateId`。
- **三层页面**：模型服务首页按 `templateId` 分组（空组隐藏，模板行缺失的连接落「其他」组）→ 连接详情（连接 / 模型 / 高级 / 危险操作）→ 模型详情（基础 / 容量 / 思考 / 采样 / 输入模态）。三页都是设置栈里的 `NavigationDestination`，滑动返回仍由栈深决定。
- **协议影响行为**：`openai-chat` / `openai-responses` / `anthropic-messages` 决定端点拼接、请求头注入、请求体字段、SSE 解析、模型参数显隐与校验；Anthropic 的 `budget_tokens ≥ 1024 且 < max_tokens`、temperature 上限 1 都只在对应协议下出现。
- **校验与不可变项**：名称 trim 非空、Base URL 必须能解析；模型 ID 创建后只读；连接 ID 不在 UI 暴露；协议切换不删模型只提示。
- **创建即落库、模型添加即落库**：模型参数每次编辑都进 reducer，仍由 300ms 防抖 + diff 写 SQLite；`modelUpdate` 与 `providerUpdate` 对相同值返回原 state，避免无变化的编辑触发落库与重渲染。
- **删除**：连接删除级联 `model_provider_model` / `model_provider_secret` / `model_provider_header`；删除前弹确认，并写明会连带删除多少模型。
- **路由值统一生成**（v37）：链接与目的地都用 `src/routes.ts` 的 `providerRoute()` / `providerModelRoute()`。原生目的地按值找 slot，找不到就渲染空页——链接仍可点，表现为「推入一整页空白」而不是报错；静态链接与目的地的一致性由 `scripts/check.ts` 的两条源码扫描兜底。
- **候选面板冻结**（v37）：抽屉打开时把「可勾选的行」定住，添加模型不会在关闭动画期间把面板清空（否则下半屏会先变空白再收起）。

## 22. v33：诊断日志页

设置 → 能力 → 诊断日志。临时排查页，不是产品功能：

- **网络自检**：直接向 `api.openai.com/v1/models` 发一个不带有效 Key 的 GET。拿到任何 HTTP 状态码都算「网络可用」；失败会显示失败阶段与宿主原文。它与用户的连接无关，用来区分「整个网络通道不通」和「Base URL / Key 不对」。
- **最近日志**：`src/log.ts` 除了写 `debug.log`，还在内存里保留最近 200 行；这一页只读内存，文件桥坏了也能看。`installErrorCapture()` 在 `App.tsx` 模块加载时接管 RN 的全局错误处理器（并转交原来的处理器），未捕获异常也会进这个缓冲。
- 日志行里的时间只到秒，不写 API Key，只写长度。
