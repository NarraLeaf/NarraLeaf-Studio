---
title: "feat: Story 编辑器大改版 — 阅读层、检查器、指令可发现性、Dev Mode 纵深与资源总览"
type: feat
status: draft
date: 2026-07-22
---

# feat: Story 编辑器大改版

对标对象是 LetsGal 编辑器与既有用户反馈。两者的基因差异先说清楚，后面所有裁决都从这里推导：

- **LetsGal**：卡片流 + 粗词表（约 9 个一等指令）+ 检查器优先 + 强调试预览。为一般创作者的"读"优化。
- **Studio**：文本行块 + 细粒度指令（bible 刚立法，`2026-07-19-001`）+ VSCode 式交互契约（`docs/story-editor-interaction-model.md`）。为创作者的"写"与引擎能力的完整表达优化。

本方案的立场：**不改基因，补读感**。Studio 的弱项几乎全部在渲染层与空间布局层，而不是文档模型层——模型层反而是刚完成立法、不该再动的部分。

## 0. 三条原则

- **P1 单一编辑表面，按行类分层渲染。** 不做 Card/Line 双模式。提交行本来就是块而非命令串（bible B11），缺的是视觉分层，不是第二个模式。双模式 = 双渲染路径 + 双交互契约 + 永恒的功能奇偶性问题。
- **P2 行内高频，右栏全量。** bible B10（"命令行承载高频子集，inspector 承载全量"）的空间化落地。行内展开式检查器退役，右栏检查器接管；高频微参数以 chip 形式留在行上。
- **P3 UI 可以声明式，文档永远命令式。** 一行一义不动摇。"设置站位""设置表情"类声明式控件通过**改写或插入邻近命令行**实现，从不引入复合行、从不落隐式状态。禁用隐式 auto-enter，用 lint 提示替代（"角色说话但未入场 → 点击插入 /show"）。

## 1. 裁决总表

| # | 原始想法 | 裁决 | 一句话理由 |
|---|---|---|---|
| A1 | 同说话人合并分组 | **采纳**（渲染期派生） | 纯投影，不落组实体；§2.1 |
| A2 | 组内换表情才显示头像 | **修正** | 头像目前不随差分，先做差分头像；组内用表情 chip 行；§2.1/2.2 |
| A3 | 头像裁剪一等公民 + 编译预烘焙 | **修正** | 选区入模型 ✔；烘焙 ✘ 先不做，CSS 取景（`headCrop.ts` 已有）够用；§2.2 |
| A4 | Card / Line 双模式切换 | **否决** | P1；密度设置 + "只看对白"过滤器替代；§2.5 |
| A5 | 一行 = 进入+表情+说话 | **否决** | P3；分组读感 + 组头声明式控件 + M4 行内表情 token 覆盖同一需求 |
| A6 | 属性全部迁右边栏 | **修正** | "全量迁右栏" ✔，"全部" ✘——高频参数留行内 chip（LetsGal 自己的等待卡也是行内 preset）；§2.4 |
| B1 | 四种行内元素 | **修正** | 变量、等待已落地（v5 interpolation / pause run）；缺换行（小）与文中变表情（引擎特性）；§3.1 |
| B2 | 等待行快编 | **采纳** | quickParams chip 的特例；§2.4 |
| B3 | Tab 菜单 vs 指令输入 | **否决二选一** | Tab 已被缩进占用（交互模型规则 3）；`/` 空态改分类浏览 + 别名/本地化/拼音搜索；§3.2 |
| C1 | 指令词表太细、难读难输 | **修正** | 不向粗词表收敛；bible 泛型动词已是正确形态，读靠渲染、输靠 palette；§4.1 |
| C3 | 站位预设 | **采纳** | `at=` 已立法（CommonPosition 引擎已有）；补组头声明式下拉；§4.2 |
| C4 | 场景为单元导致章节内容少/跨场数据难 | **修正认知** | NLR Scene ≠ 地点，`/bg` 即 LetsGal 的"场景卡"；三作用域变量已解决数据供应；不改编译模型；§4.3 |
| C6 | 任意位置插入时间线演出 | **修正** | v1 做 parallel/race 容器的"演出透镜"渲染，不建新时间轴系统；§4.4 |
| D1 | 角色颜色 | **采纳** | §5.1 |
| D2 | 卡片语音试听 | **采纳** | 复用 voice 模块 audition；§5.2 |
| D3 | 视频能力 | **延后** | 独立硬化 track，不入本更新 |
| D4 | 行右键菜单 | **采纳+扩展** | 含 disabled 一等字段（schema v7）；§5.3 |
| D5 | 资源总览页 | **采纳+修正** | 数据层基本现成（ReferenceService）；打包"预测"与"裁剪"拆两步，裁剪 opt-in；§5.5 |
| D6 | 流程图 If/Choice 分支 | **采纳** | 边 label + 分支分边；§5.4 |
| D7 | Dev Mode 扩展 | **采纳** | 变量/执行上下文/快照切换；§5.6 |
| D8 | 两层时间线 | **修正** | L1 不新建、复用场景流程图投影；状态机械大半已存在，工程量重估；§5.7 |

## 2. A 类：整体视图

### 2.1 对话分组（渲染期派生）

- 分组规则：`visibleRows` 中**连续的 dialogue 行、同 `characterId`**（或相等的 `speakerName`）成组；任何其他 kind 打断（v1 从简；note 是否穿透见 §9）。
- 分组是 `useStorySceneEditorController.ts` 投影层的派生字段，**无组实体、不进文档**。行的既有语义全部不变：行号、选择、拖拽、`Enter` 继承说话人、跨行拖选。
- 组头：裁剪头像 + 角色色名字（§5.1）+（M3）站位下拉（§4.2）。组内行：左侧导轨线 + 缩进，不再逐行渲染头像与名牌。
- **`/face`（`character/expression`）行夹在同角色对话中间时，渲染为组内"表情 chip 行"**（差分名 + 小头像），不打断分组。这就是 LetsGal `(害羞)` 标注的读感，且文档语义 1:1——用户"遇到切换表情时显示头像"的诉求由此实现，而不是靠对话行自身带表情。
- 实施点：`StorySceneEditorRows.tsx` 的行 chrome 分支 + 控制器投影。列表无虚拟化（`StorySceneEditorTab.tsx:997` 是裸 map），分组投影必须 memo；虚拟化时机单列 §9。

### 2.2 头像 = 裁剪选区一等公民

- `CharacterEditorProfile` 新增 `portrait`：相对坐标裁剪 rect，可按 form / variant-group 覆盖（差分通常同画布对齐，一个 rect 走天下，个别覆盖）。
- **渲染优先 CSS 取景**，复用 `src/renderer/lib/utils/headCrop.ts` 的思路（角色编辑器 `HeadThumbnail.tsx` 已在用）——**不做位图预烘焙**。选区入模型 ≠ 必须烘焙；烘焙只在两个未到来的条件下才值得：游戏运行时要消费（in-game backlog 头像）、或 CSS 取景出现实际性能问题。
- `BlockBadge`（`StorySceneEditorRows.tsx:1725`）改 variant-aware：当前它只取 `profile.getThumbnail()` 单图。改为按行上生效差分解析资产——复用编译器已有的 `selectCharacterVariantNames` / `resolveCharacterImageUrl`（`storyCompiler.ts:2609` 起）的选择逻辑，抽到共享层。对象 URL 层已有 `useServiceAssetObjectUrl` 缓存。

### 2.3 行类视觉系统（"很难判断动作类型"的正解）

- `ACTION_COMMAND_CATEGORIES`（`storyActionCommands.ts:192`）已经有每类 icon + iconColor——**贯穿到底**：badge 底色、行左缘 2px 类别色条、palette 分组、检查器头部，同一来源。
- 动作行摘要升级为"人话 label + 关键参数"（spec 驱动），draft/invalid 保持等宽告警样式。narration 保持零 chrome——旁白的读感优先级最高。
- 这一节替代"卡片模式"：LetsGal 卡片可扫读的本质是**类别色 + 人话标签**，不是卡片外形。

### 2.4 右栏检查器

- 新增第 4 个故事编辑器动态右栏面板 `story-inspector`（`StorySceneEditorTab.tsx:488` 起已有 Action Creator / Variables / Snapshots 三个先例，基建零新增）。
- `ActionInspector`（~2100 行，`StorySceneActionInspector.tsx`）**先整体搬迁、后逐步框架化**（`modules/properties/framework/` 的 PropertyEditor 体系）。行内展开路径删除——这就是"滚动偏移与手部割裂"的病根。
- 交互契约不变式：`Enter` on action row → 打开检查器（位置从行内变右栏）；Escape 阶梯保留"关闭检查器"一档；card-less 行（条件容器等）语义照旧。
- 行内保留高频 chip（`quickParams`，spec 上声明）：wait 的时长 + preset（200/500/1000/2000/3000）、transition 的 `t=`/`d=`、audio 的 `vol=`/`loop`、jump 的目标。chip 点击 = 原位小 popover（`PausePopover` 等已有范式）。
- 检查器新增语音区：当前 take 状态/试听/跳转 voice 表。绑定继续走 `textId` + VoiceService 模型，不复活 `dialogue.voiceAssetId`（编译器里它只是遗留 fallback，`storyCompiler.ts:1231`）。

### 2.5 密度与阅读辅助（替代双模式）

- 一个**密度设置**（紧凑/舒适）：舒适档放大行距字号、突出旁白与对话。
- 一个**过滤器**："只看叙事"（隐藏演出指令行，保留对话/旁白/选项/注释）。这是给写作者的图 3 读感，成本只有一个投影开关，而不是一个模式。

## 3. B 类：行内操作

### 3.1 行内 token：现状与缺口

| LetsGal 元素 | Studio 现状 | 缺口 |
|---|---|---|
| 变量 | ✔ v5 interpolation run（`{gold}`/表达式），`InterpolationPopover` | 无 |
| 等待 | ✔ `{pause}` run + `PausePopover`；对话级 `pauseAfter` | 曝光度（工具栏入口统一） |
| 换行 | ✘ 行是行模型，框内换行无表达 | 新 rich run `{break}`；编译到 NLR 的语义需引擎验证（§6.2） |
| 变表情（文中） | ✘ 引擎无副作用 token（`WordConfig` 无 action 位，Pause 是唯一控制 token） | 引擎 text-event token（§6.1）+ Studio run UI |

结论：LetsGal 的四件套里两件已经有了。真正的新工程只有文中变表情，且它是引擎特性，节拍归 M4。

### 3.2 palette 与可发现性（"只能猜指令头"的正解）

- Tab 在 Studio 已被缩进占用（交互模型规则 3），`/` 保持唯一触发。**"Tab 菜单 vs 指令输入"是伪二选一**——两者共享同一个 palette，差的是空态。
- `/` 空态从"空列表"改为**分类浏览网格**：类别色 + 图标 + 每类高频指令，输入即过滤。
- 搜索域扩为：canonical token + aliases（spec 已有）+ **本地化 label（`localizedTokenMap` 已落地，`/背景`→`bg`——这个能力今天就存在，缺的是曝光）** + 拼音（依赖选型见 §9）。
- ghost 提示补 B2 顺序约束说明；右栏 `StoryActionCreatorPanel` 与 `/` 已同源（`storyCommandSearch.ts`），保留双入口。
- 指令参考面板：spec registry 已含 label/detail/签名，自动生成可搜索的"指令手册"挂到帮助入口，bible 的文档义务顺手兑现。

## 4. C 类：指令系统

### 4.1 词表：不收敛、不发明第三层

LetsGal 的 9 个粗动词是它的天花板；Studio 的细指令是引擎能力的诚实投影。bible 已经用**泛型动词**（`/show` `/hide` `/swap` `/play` 按目标分派）+ 别名把"要记的词"压到了正确的规模——这就是"少词表"的正确形态，同时不丢能力。**先完成 bible M3–M5，不再叠加宏词表**。读的困难交给 §2.3，输的困难交给 §3.2。

### 4.2 站位

- `at=` left/center/right 已立法（引擎 `CommonPosition` 就位）。
- 组头站位下拉 = P3 的样板实现：改写最近前置 `/show`/`/move` 的 `at=`，没有就插入一行 `/move`。UI 声明式，文档命令式，undo/diff 全部自然。

### 4.3 场景哲学（C4 的认知修正）

- **NLR Scene 是演出/快照/启动单元，不是"地点"**。换地点用 `/bg`——LetsGal 卡片流里的"场景卡"对应的就是 Studio 的 `/bg`，不是拆一个新 Scene 文档。把这句话写进模板与新手引导，是 C4 焦虑的一半解药。
- 跨场数据不是真问题：v6 三作用域（Local/Var/Persis）已统一，saved/persistent 天然跨场。
- 不改编译模型（不做"章节文档编译期拆多 Scene"——它会连坐流程图、快照、行级启动的全部语义）。补三件便宜的：拆场指南文案；场景末行的"接下一场"affordance（显示/快建 jump）；流程图分支可读性（§5.4）。
- 远期选项（记录、不承诺）：章节级只读串读视图。

### 4.4 演出编排（C6）

- 文档模型已有 `/parallel` `/race` `/sequence` 容器（`StoryControlPayload`，映射 `Control.all/any/do`）。**v1 做"演出透镜"**：parallel/race 容器的替代渲染——横向条视图，每个子块一条（目标 + op + delay/duration 条形），点条 = 选中子行 + 右栏检查器。1:1 文档语义、零新数据结构，即插即得"编排舞台上所有元素"。
- 关键帧/曲线级的时间轴（与 Story Motion 并轨）是 v2 远期，不在本轮。
- **硬前置：NLR `Control.all/any/allAsync` 硬化测试轮**（skip、save/load 中断、undo 交互——AutoHighlight 计划 §硬约束 3 已经踩出 ScriptCleaner/Condition 重评估的雷区）。没硬化前不鼓励重度使用。

## 5. D 类：实用功能

### 5.1 角色颜色

`CharacterEditorProfile` 增 `color`（现无任何颜色字段）。消费点：行名牌、组头、流程图、Dev Mode、（可选）下沉运行时对话框名牌色（§9）。

### 5.2 语音试听

行 hover 播放键（有 take 时出现，hover-reveal 符合现有 UI 约束），复用 `VoiceRows.tsx` 的 audition 播放逻辑；`StoryVoiceIndicator` 的状态色（stale=warning）保留。

### 5.3 右键菜单 + 行禁用

- `ContextMenu` 原语现成（`StoryPanel` 已用于场景树）。条目：上/下插入、复制、**禁用/启用**、从此行播放、打开检查器、删除。
- **`disabled` 成为一等字段**（`StoryBlockBase`，schema v7 迁移）：编译跳过、渲染置灰、构建**不**拒绝。与 invalid（错误、构建拒绝）、note（注释、无 payload）三分语义，各司其职。

### 5.4 流程图分支（D6）

- 现状：边只来自 `jump` 块，`isUnderControlFlow` 只把"处于任何 control 下"标成虚线（连 sequence 也算，过宽）。
- 改：收集 jump 的祖先链——`choiceOption` → 边 label 用选项文本；`conditionBranch` → label 用表达式 `source`/else；sequence 纯顺序不再算 conditional。同一 target 多分支聚合 label。
- 边界（v1 明说）：不跳场景的场内分支不进场景图——场景图是场景间的图，场内结构属于时间线/编辑器层。

### 5.5 资源总览（D5，图 4 对标）

- 新 **EditorModule 全页 tab**（`builtInEditors` 挂载，Welcome/预览页同模式）。入口：assets 侧栏 header 按钮、全局 action/Quick Open、构建对话框链接。左边栏保持"快速拖入"定位不动。
- 数据层基本现成：**`ReferenceService`**（6 slices 反查索引、增量重建、已是删除守卫的权威）+ `AssetsService` 尺寸 + 类型聚合。页面 = 总量/引用/游离、类型分布与健康度、TOP 大户、单资产详情（被引用列表用现成 `SearchJumpTarget` 跳转）。
- **打包"预测"与"裁剪"拆两步**（对图 4 的修正，不直接照搬）：
  - v1 只读：预测 = 可达集 × 尺寸，游离报告，不改打包行为（当前构建打整个 assets 目录，`GameBuildManager.ts:612` 的 directorySize 是现成锚点）。
  - v2 opt-in：引用裁剪 + 每资产 `auto/force/exclude` override（新项目数据），构建报告必须列出被排除清单。
  - 理由：漏引用的失败模式是**玩家侧缺资产**。ReferenceService 必须先经过总览页的实战审计，再被授权决定打包内容。

### 5.6 Dev Mode 纵深（D7）

- **故事变量面板**：三作用域实时读写（蓝图 scope 面板 `BlueprintRuntimeDebugPanel` 的 scope tab 是现成先例；GameApp 补一个 storable 桥）。
- **执行上下文**：编译产物已有 `actionIdBindings`（action ↔ block 映射）——引擎补"当前 action"事件流（§6.4）后，播放头可以同步高亮：Dev Mode 时间线定位 + 工作区编辑器行高亮。调用栈 v1 = 当前块祖先链（纯 Studio 侧）；v2 = 引擎 StackModel 只读检查。
- **快照切换 + 定点重启**：Dev Mode 内切 snapshot = 相同 entry（`startBlockId` 保持）relaunch；chokidar 热重载已带 revision 重挂载，补"保持 entry 重进"即可。

### 5.7 时间线（D8，两层）

- **L1 不新建**：`buildSceneFlowGraph` 是纯投影，直接嵌入 Dev Mode（只读、当前场景高亮、双击 = launch 该场景）。造第二个节点图是本方案明确否决项。
- **L2 v1 = 冷跳**：Dev Mode 侧当前场景行列表面板（bundle 已含 story doc），点击行 = relaunch `{startBlockId: 行, snapshotId: 当前}`——机制就是 play-from-row 同款，不出 Dev Mode 窗口、零新编译特性。播放头 = §5.6 执行上下文。
- **L2 v2 = 热跳**：前向 `fastForward` 需要引擎扩展 `until: actionId`（现只有 `"menu" | "end"`）；后向 `restoreToHistory(token)` **已存在且已在用**（backlog restore）。"整场快照预计算" = 后台 session 跑 fastForward 收集 `getHistory()`，缓存 key = (docHash, snapshotId)，编辑即失效。
- **工程量重估**（对"最大工程"的修正）：`fastForward({until})`、`restoreToHistory`、每条目自包含快照、行级 launch、`computeStoryStageSnapshot` 全部已落地。剩下的是 UI 组合 + 缓存失效策略，不是 greenfield。真正的新点只有 `until: actionId` 与快照预计算的资源管理。

## 6. 引擎工作清单（NarraLeaf-React，跨仓）

| # | 项 | 规模 |
|---|---|---|
| 6.1 | text-event token：文中触发受限副作用（表情 `Image.char` / SE），skip = 落终态，重放 = 随 say 天然重放 | M |
| 6.2 | 对话内换行（`\n` 或 break token）语义验证/支持 | S |
| 6.3 | `fastForward({until: actionId})` | S/M |
| 6.4 | "当前 action"事件流 + StackModel 只读检查 API | M |
| 6.5 | `Control.all/any/allAsync` 硬化测试轮（skip / save-load / undo 交互） | M |
| — | 视频播放能力评估与硬化 | 独立 track，不入本更新 |

流程约定：引擎 dist 构建后拷入 Studio node_modules（既有跨仓约定）。

## 7. 里程碑

| 里程碑 | 内容 | 规模 | 依赖 |
|---|---|---|---|
| **M1 阅读层** | §2.1 分组 + §2.2 差分头像/裁剪 + §2.3 行类视觉 + §5.1 颜色 + §2.5 密度/过滤器 | M | 无（纯渲染 + profile 两字段） |
| **M2 操作层** | §2.4 检查器迁移 + quickParams chip + §5.2 试听 + §5.3 右键/禁用（schema v7） | M/L | M1 可并行启动 |
| **M3 指令层** | bible M3–M5 收尾 + §3.2 palette + §4.2 站位（含组头下拉） | M | bible 既有计划 |
| **M4 引擎批** | §6.1–6.5 + §3.1 的 Studio 侧 run UI（换行/文中表情） | M | 可与 M2/M3 并行（另一节拍） |
| **M5 Dev Mode** | §5.6 全部 + §5.7 L1 嵌入 + L2 v1 冷跳；L2 v2 视 6.3/6.4 落地 | L | M4 的 6.3/6.4 |
| **M6 全局工具** | §5.5 资源总览 v1（→v2 opt-in 裁剪）+ §5.4 流程图分支 | M/L | 独立，适合交给贡献者 |
| **M7 演出** | §4.4 演出透镜 v1 | M | 6.5 硬化 |

主线 M1→M2→M3；M4 引擎节拍并行；M6 全程可并行。每个里程碑独立可发布。

## 8. 不做清单（本轮明确否决）

- Card/Line 全局双模式切换（→ P1：分层渲染 + 密度 + 过滤器）
- 复合行（一行 = 进入+表情+说话）与隐式 auto-enter（→ P3 + lint 提示）
- 词表向粗动词收敛 / 第三层宏词表（→ bible + palette）
- 章节文档编译期拆多 Scene（→ §4.3；记录为远期选项）
- 为 Dev Mode 新建第二个故事节点图（→ 复用场景流程投影）
- 头像位图预烘焙（→ CSS 取景先行，条件触发再议）
- 打包引用裁剪默认开启（→ v1 只读预测，v2 opt-in）
- 视频能力硬化（→ 独立 track）

## 9. 开放问题

- 长文档虚拟化时机与 dnd-kit 的兼容评估（分组投影 memo 之外的下一步）。
- 拼音搜索的依赖选型（pinyin-pro vs 静态生成表）。
- note 行是否穿透对话分组（v1 打断，观察反馈）。
- 角色色是否下沉运行时对话框名牌。
- 整场快照预计算的资源上限与取消策略（后台 session 的内存/时长预算）。
- lint/问题面板的形态（"说话未入场"、资产缺失、不可达行、语音未绑定——compile diagnostics + ReferenceService 都已能供数，挂在哪个视图）。
