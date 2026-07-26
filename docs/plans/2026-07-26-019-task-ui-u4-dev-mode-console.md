---
title: "task: U4 — Dev Mode 调试台：时间线说人话、执行上下文、场景图可读"
type: task
status: ready
date: 2026-07-26
plan: 2026-07-26-004-plan-ui-professionalization.md
handoff: 2026-07-26-010-handoff-ui-professionalization.md
milestone: U4
---

# U4 — Dev Mode 调试台

**执行者请从 §0 读到 §3 再动手。§4 判据由 orchestrator 所有，你不许改、不许写 assert、
不许自己定"通过"。** 你的报告不是验收；验收是 orchestrator 亲手拉实例、亲眼读图、跑他自己写的断言。

---

> **⚠ 基线提交与当前 develop 不同。** 基线是在 `49281e71` 上量的；量完之后别的 session
> 把两个分支合进了 develop，HEAD 变成 `3debbcaa`（84 文件）。逐条复核过：
> 落在 U4 territory 的只有两处，**都不影响本卡的任何读数与判据**——
> `storySceneBlockUtils.ts` 只被删掉一行（`plugin` action 的 describe 分支，属于
> `d7c10100` 那个 revert），`DevModeContent.tsx` 的 +136/−21 全是运行时插件浮层，
> 没碰调试面板的布局或挂载。**分支从 `3debbcaa`（或更新的 develop）开，不要从 `49281e71` 开。**

## 0. 出卡前重测基线（2026-07-26，orchestrator 亲测，develop @ `49281e71`）

**计划 `2026-07-26-004` §1.2 与交接文档 §7 对 U4 的描述已经过期，本节是唯一有效的基线。**
方法：`git archive HEAD` 到隔离树 `D:/Temp/nls-u4-base`（node_modules junction），
项目用 demo3 的副本 `D:/Temp/nls-u4-proj/demo3`，视口 1400×902 @dpr1.25，
`First Day`（12 行）为夹具，背景图开启（`ui.backgroundImage` 有值）。

### 0.1 计划里已经不成立的四条

| 计划里的说法 | 实测 | 处置 |
|---|---|---|
| U4-4 FAB 是产品 favicon / 快照选择器是原生 `<select>` | FAB 已是 bug 图标（`aria-label="Open preview debug tools menu"`），快照选择器已是项目 `Select`（显示 `Defaults`） | **U4-4 作废**，U0 已做 |
| Stack tab 恒空还杵在那儿显示一句话 | 面板只有 `Variables / Timeline / Scenes`，Stack 在栈空时**已经不渲染** | 该半条作废，U0 已做 |
| `Scenes` tab 「3 个 ~7px 节点浮在**未 fit** 的空画布上」 | `fitView` **确实跑了**：3 个节点全在 pane 内，viewport `matrix(0.600379,…)` | 「未 fit」不成立；**真缺陷是 zoom 0.60 把 11px 字号压成 6.6px 实际渲染** |
| 面板有空态句子 | 三个 tab 逐一读过，没有任何空态句子（`Variables` 只有一个作用域标题 `Var`） | 「任何 tab 不出现空态句子」**已满足**，不作为进攻性判据 |

### 0.2 计划里成立、但比它写的更深的一条（U4-1）

`First Day` 12 行，编辑器 vs 时间线逐行实测：

| # | 编辑器 | 时间线 | |
|---|---|---|---|
| 1 | It is the first day of summer. | It is the first day of summer. | 同 |
| **2** | **Enter Nattou** | **character enter · character** | **异** |
| 3 | Youk / Looks like everything is packed | Youk: Looks like everything is packed | 同 |
| 4–8 | （对白，含 U1 分组） | YouKi: … | 同 |
| **9** | **Narra / OK a** | **Narra: OK** | **异**（行内表达式 token 丢失） |
| 10–11 | （旁白） | 同 | 同 |
| **12** | **Set background outside_s.jpg d 5s** | **setBackground** | **异** |

**关键发现，交接文档 §7 那句「多半就是把 `describeBlock`/`getBlockBadgeInfo` 搬到 shared 层，不是重写」是错的：**
作者在编辑器里读到的那句话**不是** `describeBlock`。行内容的分发在
[StorySceneEditorRows.tsx:2650-2735](src/renderer/apps/workspace/modules/story/scene-editor/StorySceneEditorRows.tsx)：

- 一般动作行 → `BlockOverview`（[storyQuickParams.tsx:145](src/renderer/apps/workspace/modules/story/scene-editor/storyQuickParams.tsx)），
  它是 `blockOverview()` 这个**纯**投影：`OverviewFragment[]` = `describeBlock` 的基句 + quick-param token
  （`d 5s` 就是 token，不是 describe 的一部分）；`describeBlock` 在这里已经**降级成 fallback**；
- `setBackground` 行 → `BackgroundBlockPreview`，它自己把 `assetId` 解析成**资产名**（`outside_s.jpg`）；
- `displayable/transform` 行 → `DisplayableTransformPreview`；`invalid` 行 → `DraftRowPreview`；
  文本行 → `RichTextView`（行内表达式 chip 就在这里，行 9 的 `a`）。

所以 U4-1 的正确形状是：**把「一行读起来是什么句子」这件事收敛成一个纯函数**，
编辑器和时间线都消费它——不是把两个函数换个目录。

**两个已知的耦合点（executor 必须处理，不许绕过）**：

1. `describeBlock` / `blockOverview` 吃 `Character[]`（workspace 的 `Character` 服务类，
   用到的只有 `profile.getId()/getName()/getColor()`）；dev-mode 侧只有
   `DevModeCharacterSummary { id, name, appearance }`。**必须把角色依赖降成结构化接口**
   （名字 + 可选强调色的查表），而不是把 `Character` 服务拖进 dev-mode。
2. 背景行的资产名：`DevModeBundle` **没有资产名表**。`describeBlockSubject` 已经确立了
   「解析器当参数传」的形状（[storySceneBlockUtils.ts:621](src/renderer/apps/workspace/modules/story/scene-editor/storySceneBlockUtils.ts)），
   照它做；bundle 侧补一张 `assetId → name` 表即可，磁盘上是现成的
   （`<project>/assets/assets.metadata.<type>.json` 是 `{id: {id, name, …}}` 平表，
   `bundleAssembler.ts` 已在主进程读同目录的东西）。

### 0.3 计划没写、但实测拦住 U4-2 的一条

**demo3 里一个容器块都没有。** 三个场景的块类型统计：

```
First Day     12  narration×3 dialogue×7 character/enter×1 setBackground×1
At the Station 2  image/show×1 jump×1
The Forest     8  declaration×1 setVariable×1 narration×4 dialogue×2
```

没有 choice / condition / repeat / parallel / nvl。所以**根栈在 demo3 上永远是空的，
Stack tab 在 demo3 上根本不可达**——在 demo3 上验「执行上下文」的任何断言都是恒真断言（§6.5）。

orchestrator 已经为此在**项目副本**里造了夹具场景 **`Nesting Lab`**
（脚本 `scratchpad/make-fixture.js`，16 块：`repeat ×3` / 两选项菜单（`Left` 里再套一层 `sequence`）/
`parallel all` 两支 / 首尾旁白）。**执行者自测请自己照同一形状造一个**，acceptance 用 orchestrator 那份。

---

## 1. 范围

三条。**U4-4 与「隐藏空 Stack tab」不在范围内（已完成）。**

### WI-1 一行一句话，编辑器与时间线共用（治 C8 + C5）

把「一个 block 渲染成一句话」提到一个**渲染层共享、React 无关、可单测**的模块，
编辑器与 Dev Mode 时间线都从它取文案。

- 删掉 `storyRuntimeDebugModel.describeStoryBlock` 这套弱实现（它是 M5 卡 WI-4 授权的临时投影，
  该授权作废）。`projectSceneTimeline` 可以留，但 `summary` 必须来自共享投影。
- 共享投影必须覆盖**编辑器真正显示的东西**，至少：
  - `blockOverview` 的基句 + quick-param 的**值**（`Wait 5s`、`Jump → The Forest`、`d 5s` 这类）；
  - `setBackground` 的资产名（见 §0.2 耦合点 2）；
  - 文本行的行内表达式 token（编辑器 chip 显示什么，时间线就显示什么的纯文本形态）。
- 角色依赖降成结构化接口（见 §0.2 耦合点 1）。**不许**把 workspace `Character` 服务引入 dev-mode。
- **时间线行要带类别色**：色源是 `getBlockBadgeInfo(block).iconColor`（来自
  `storyCommandCategories` 的 command GROUP），编辑器行左缘条用的就是它。同一个 block 两处必须同色。
- **时间线行要带说话人**：对白行的说话人名字，与编辑器一致。
- 迁移不要顺手改编辑器的观感。编辑器行的 DOM 可以变，但**编辑器上每行的可见句子必须与改前逐字相同**
  （§4 的 A-6 就是量这个）。

### WI-2 Stack tab → 「执行上下文」（治 C3 + C7）

- tab 改名并**常驻**（不再是"栈空就整个消失"）。它要回答作者的问题，而不是打印引擎栈：
  1. **当前在哪个场景**（场景名，不是 id）。这一条在 demo3 上就成立且现在**完全缺失**：
     面板任何地方都没有场景名，而 `At the Station` 会 `jump` 到 `The Forest`，
     时间线内容会静默换掉。
  2. **当前行的容器链**：从当前 block 往上走 `parentId`，把每层容器用
     `getContainerHeaderInfo(block).pill` 的人话名字列出来（`Menu` / `Option` / `Repeat` / `Parallel` / `If`…）。
     根层就是空链，此时只显示场景。
  3. **循环第几轮**：`getStackSnapshot().root.loop` 有 `{type, counter, limit}`，显示成 `2/3` 这样。
  4. **并行里谁在跑**：`StackFrameSnapshot.branches` 是分支帧列表，每支显示它当前那行的句子（复用 WI-1）。
- **不许**再出现 `frame.actionType` 这种引擎词汇，也不许再打印
  `blockId.slice(0,8)…`（现有 `StackFrames` 两样都在打）。
- 无内容 ≠ 无话可说：根层时它说"当前场景 X"，这本身就是内容，所以**不再需要"空就隐藏"这套机械**。

### WI-3 Scenes tab 可读（治 C7）

- 打开时图必须**读得清**：节点标题的**实际渲染字号**（CSS 字号 × viewport zoom）不低于 **11px**。
  现状 6.6px。手段自选（提高 fitView 的 minZoom / 给 Dev Mode 嵌入用更紧的 padding /
  节点在小 zoom 下放大字号），但**不许**把 workspace 的 story-flow 画布改坏——
  workspace 里的 story-flow tab 是同一个组件，它的观感必须不变。
- 图必须仍然完整在 pane 内（三个节点全部可见，不许为了放大而截掉节点）。

---

## 2. 明确不做

- 不改故事 schema（`storydoc` 结构不动）。夹具场景是**项目数据**，不是 schema 变更。
- 不改编译器行为。
- 不动 workspace 的 story-flow tab 的观感（WI-3 只针对 Dev Mode 的嵌入形态）。
- 不新增第三方依赖。
- 不做 Variables tab（它只有一个变量是 demo3 的事实，不是缺陷；空面板问题留 U5）。
- 不碰时间线的**跳转**行为（U0 已根治，回归归 §4 的 A-9）。

---

## 3. 共享检出：隔离树审计（**必做**）

**这个检出现在非常热闹。** 出卡当天两次 `git status` 的差别：

开卡时（4 个未提交文件）：
```
 M docs/plans/2026-07-23-006-task-mobile-encryption-rollout.md
 M src/renderer/apps/launcher/tabs/PluginDetailsModal.tsx
 M src/renderer/apps/launcher/tabs/ProjectsTab.tsx
 M src/renderer/lib/components/elements/Modal.tsx
```

写完卡时（**84 个文件进了 index**，另有两个 merge 落到 develop 上）：别的 session 正在
同一个检出上做合并/revert，`storySceneBlockUtils.ts`、`storySceneProjection.ts`、
`storyCompiler.ts`、`DevModeContent.tsx` 都在其中。**你自己开工前必须重新 `git status`，
并且绝对不要 `git commit` 不带 pathspec**——那会把别人 index 里的 84 个文件一起提交掉。

`Modal.tsx` 是 `lib/components/elements` 下的共享组件——**你的 `yarn dev` 画面里有它的效果**。
U1 就是这么栽的：提交的代码适配了只存在于别人未提交改动里的符号，合进 develop 才坏，
而 lint、测试、执行者截图全绿。

**要求**：交报告前，把你的分支 `git archive` 到一棵隔离树（node_modules 用 junction，
`yarn.lock` 要手动拷进去——它被 gitignore 但 yarn 4 没它拒跑），在**不含任何未提交改动的树上**
跑 `yarn lint` + `yarn build:apps:dev`。**报告里要给审计过程，不只给结论。**

其余铁律：逐文件 `git add`（**禁 `git add -A`**）、**禁 `git stash`**、
**禁止执行 `git worktree remove`**、提交前先 `git branch --show-current`。

分支名：`feat/ui-u4-dev-mode-console`，从当时的 develop 开（写卡时是 `3debbcaa`）。

---

## 4. 判据（orchestrator 所有；执行者不得修改）

驱动路径：隔离树实例 → 启动器点 `Demo` → 左栏 `Story` → `First Day` → 标题栏 `Run Dev Mode` →
游戏菜单 `New Game` → 左下 FAB（`aria-label="Open preview debug tools menu"`）→ `Story Runtime`。
控件一律按可访问名找，不按坐标；每个断言前先跑 setup guard 证明被测对象**可达**
（rect 正常 + `document.elementFromPoint` 反查命中在目标内）；验收在**新起的实例**上做。

断言脚本 `scratchpad/u4-assert.js`，**改前已在 develop @ `49281e71` 上标定**（见 §5）。

| # | 断言 | 判定 | 改前 |
|---|---|---|---|
| **A-1a** | `First Day` 的**非对白行**（1/2/10/11/12）：时间线句子 == 编辑器句子，**逐字** | 5/5 | 🔴 3/5（行 2、12 异） |
| **A-1b** | **对白行**（3–9）：时间线句子 == `"<说话人>: <编辑器正文>"` | 7/7 | 🔴 6/7（行 9 异） |
| **A-2** | 行 2 的时间线文案不含 `character enter`、不含 `· character` | 真 | 🔴 `character enter · character` |
| **A-3** | 行 12 的时间线文案含资产名 `outside_s.jpg`，不含裸 `setBackground` | 真 | 🔴 `setBackground` |
| **A-3b** | 行 9 保留行内变量引用（`OK` 后面的 `a`） | 真 | 🔴 `Narra: OK` |
| **A-4** | **凡编辑器画了类别色条的行**，时间线画同一个颜色 | 2/2 | 🔴 0/2 |
| **A-5** | 时间线对白行显示说话人名（行 3–9） | 7/7 | 🟢 7/7（已成立，回归护栏） |
| **A-6** | 编辑器 12 行的可见句子与改前基线**逐字相同**（回归护栏） | 12/12 | 基线已录 |
| **A-7a** | 执行上下文 tab 常驻（栈空也在） | 真 | 🔴 只有 Variables/Timeline/Scenes |
| **A-7** | 该 tab 在 `First Day` 根层显示场景名 `First Day` | 真 | 🔴 tab 不存在 |
| **A-8** | 夹具：`parallel > sequence` 体内时上下文列出这条容器链（人话 pill） | 真 | 🔴 tab 不存在 |
| **A-9** | 夹具：`repeat ×3` 体内时上下文显示轮次（形如 `n/3`） | 真 | 🔴 tab 不存在 |
| **A-10** | 面板任何 tab 的文案里不出现 `actionType`、8 位截断 id、`setBackground`、`character enter` | 0 命中 | 🔴 2 命中 |
| **A-11** | Scenes tab：节点标题**实际渲染字号**（CSS px × viewport zoom）≥ 11px | 真 | 🔴 **7.2px**（CSS 12 × zoom 0.600） |
| **A-12** | Scenes tab：全部节点完整落在 pane 矩形内 | 全部 | 🟢 4/4（回归护栏） |
| **A-13** | 回归：时间线点第 N 行后播放头落在第 N 行（**阻塞行**：10/5/11/3/9） | 5/5 | 🟢 5/5（回归护栏） |
| **A-14** | 回归：workspace story-flow tab 的节点 CSS 字号与改前相同 | `[16,16,16,16]` | 基线已录 |

**A-1 为什么拆成两条（这条不要改回去）**：一刀切要求 12 行逐字相同是**错的判据**，标定当场证明了：
编辑器**故意**把说话人名字单独成行、并在同说话人的后续行**省略**它（U1 WI-3 / 计划 §3 裁决 4），
而 380px 的时间线没有分组、每行重复 `Name:` 才对。要求一个字符串等价，等于逼时间线抄编辑器的两行布局。
所以：非对白行逐字相同（真正的分歧都在这儿），对白行只要求 `"说话人: 编辑器正文"`。

**A-13 为什么只打阻塞行**：标定时点第 2 行（`character enter`）落在第 3 行。
冷跳是"进入该行并向前播"，而非阻塞动作不会停住播放头，所以它**合理地**停在下一个等待输入的行上。
在动作行上要求"精确落点"量的是引擎语义，不是 U0 的跳转。

**A-8 的边界（诚实记录）**：**用 CDP 合成点击选不中菜单选项**——点击落在选项元素上、
`elementFromPoint` 反查也确认命中，菜单就是不响应（与"HTML5 拖拽必须真鼠标"同一族）。
所以夹具把 `parallel` 排在菜单**之前**，A-8 走 `parallel > sequence`，不依赖选中选项。
菜单仍留在夹具里供人工看，但**"菜单/选项容器链"这一情形没有人自动验过**。

**目视复核（orchestrator 亲自读图，断言全绿也要看）**：
时间线截图上一眼能看出行的类别（不是一片等宽灰字）；执行上下文在夹具的三种情形下各一张；
Scenes tab 一张；编辑器一张（确认 WI-1 没把编辑器改坏）。

**收尾指纹校验**：验收开始前记录 `D:/Temp/nls-u4-proj/demo3` 全树 mtime，
结束后重跑，**新增/变更文件必须只在 `dist/` 与 `editor/services/`（视图状态）之内**——
`editor/story/` 有任何改动即判验收脚本弄脏了夹具（§6.7）。用 mtime，**不要用 `find | xargs md5sum`**
（被锁住的文件会被静默跳过，§6.10）。

---

## 5. 改前标定（orchestrator，develop @ `49281e71`）

在隔离树上跑过，**13 红 / 3 绿**（见 §4 表最后一列）。3 条绿的是回归护栏（A-5 / A-12 / A-13），
它们本来就该在改前绿——存在的意义是"改完还得绿"。
标定过程中改写了**四**条断言（A-1 拆分、A-4 从 12/12 改成"编辑器画了色条的行"、A-13 只打阻塞行、
A-8/A-9 先推进再找 tab），全部是断言错、实现没错，理由写在上面。

夹具上那三条红的实况读数（这就是 WI-2 要替换掉的东西）：

```
在 repeat 体内： Root  control:all · u4f1x7e0… · all   branch 1
在 parallel 内： Root  menu:action · all   branch 1  branch 2
```

——8 位截断 block id 直接示人、`control:all` / `menu:action` 是引擎枚举、
分支只有编号没有内容、**轮次一个字都没有**。同时它也证明了引擎侧数据是够的：
`repeat` 与 `parallel` 都真的推了帧上来，`StackSnapshot.loop` 与 `branches` 是可用的。

### 5.1 标定时顺手确认的实现事实（executor 可以直接用）

- Dev Mode 面板根节点是 `text-2xs`，Scenes 画布**继承**了它：同一个 `SceneFlowCanvas`
  在 workspace 里节点字号是 CSS **16px**、在 Dev Mode 里是 **12px**。A-11 的一半可能就在这条上。
- 编辑器行的类别色条是 **3px 宽 / opacity .85**；U1 的说话人归属导轨是 **2px / opacity 1**，
  两者别混（断言脚本按这个区分）。
- `First Day` 里只有行 2（`rgb(64,168,196)` character 组）和行 12（`rgb(143,169,199)` scene 组）
  有类别色条——旁白与对白行**按设计没有**。
- 夹具场景的时间线现在打印 `repeat` / `sequence` / `parallel` 三个**裸控制枚举**，
  编辑器那边是 `getContainerHeaderInfo().pill` 的人话。这也是 WI-1 要收的。
- 启动器的项目卡片按钮只有 `title="Open Demo"`、**没有 `aria-label`**（与 U5 已记的
  "资产导入按钮没有 aria-label" 同族，booked 给 U5；注意 `ProjectsTab.tsx` 现在有别人的未提交改动）。

---

## 6. 交付

- 分支 `feat/ui-u4-dev-mode-console`，不要自己合并。
- 报告写到 `docs/plans/reports/2026-07-26-U4-report.md`：改了哪些文件、共享投影的接口长什么样、
  角色依赖与资产名两个耦合点各怎么解的、隔离树审计过程、`yarn lint` 与 vitest 结果
  （win32 基线 8–9 个失败不是回归）。
- **报告里不要写"验收通过"。** 那是 orchestrator 的事。
