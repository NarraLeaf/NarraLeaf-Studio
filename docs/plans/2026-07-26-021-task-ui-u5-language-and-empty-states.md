---
title: "task: U5 — 语言与空态清扫：内部词汇、解释性空态、数字砖"
type: task
status: ready
date: 2026-07-26
plan: 2026-07-26-004-plan-ui-professionalization.md
handoff: 2026-07-26-010-handoff-ui-professionalization.md
milestone: U5
---

# U5 — 语言与空态清扫（本轮收尾）

**执行者读 §0–§3 再动手。§4 判据由 orchestrator 所有：不许改、不许写 assert、不许自己判"通过"。**
你的报告不是验收。

---

## 0. 出卡前重测基线（orchestrator 亲测，develop @ `2dbc4b36`）

隔离树 `D:/Temp/nls-u4-final`（`git archive develop`，node_modules junction），
项目用 demo3 副本，视口 1400×902 @dpr1.25，CDP 9228。**交接文档 §7 的 U5 清单已过期，本节替代它。**

### 0.1 空态文案：24 条，不是交接文档列的那些行号

`src/shared/i18n/catalog/en/` 重扫（`No … yet` / `Nothing on` / `No item selected`）：

```
characters.ts  49 noCanvas / 117 noThumbnail / 131 noTags / 149 empty / 189 noVariants / 190 groupNoVariants
console.ts     18 emptyChannel "No {label} output yet"
launcher.ts    15 empty "No recent projects yet."
motion.ts      58 emptyKind
properties.ts  123 noRecent / 150 empty / 154 empty
storyInspector.ts 3 noEditableFields
storySnapshot.ts  4 none
storyVars.ts   19 empty / 24 empty
uiEditor.ts    13 emptyPages / 14 emptyGameUi
workspace.ts   11 empty / 36 emptyUi / 81 empty / 208 empty
```

交接文档提到的 `properties.panel.noSelection` / `.noSelectionHint` 确实已被 U2 删除。
`dashboard.ts` / `blueprint.ts` / `widgetChrome.ts` / `story.ts:81` 在当前树上**已经没有**
这类文案——那几条作废。

**两条不要一刀切删掉的**（删了会让界面更难懂，不是更专业）：
- `launcher.ts:36 note` "Removing only updates this list. Nothing on disk is deleted." —— 这是
  破坏性操作的**后果说明**，不是空态解释，留着。
- `storyExpr.ts:56 unknownTarget` "Nothing on stage is named …" —— 这是**诊断信息**，留着。

### 0.2 内部词汇：确认还在的两处（其余已被前几卡清掉）

全 catalogue 只剩两处：

| 位置 | 现状 | 实测 |
|---|---|---|
| `storyInspector.ts:394 stageName` | `Stage name`，值是 `character` | ✅ 亲眼看到（截图 `u5-01-story-inspector`） |
| `storyInspector.ts:4 textId` | `Text ID`，值是**裸 uuid** | ✅ 亲眼看到 `9cd6afd8-7569-4add-b626-c36058e9deb0` |

`setBackground` / `character enter` / 8 位截断 id / `actionType` —— **U4 已经清掉**，
面板全 tab 扫过 0 命中。分片路径 `content/35/f4/…` 与裸 hash —— U3a 已治。

### 0.3 数字砖：12 块，两块标签被截断

Dashboard 首屏实测（截图 `u5-03-dashboard`）：

- **Scale 8 块**：Scenes 4 / Dialogue lines 9 / Words 67 / Characters 3 /
  Assets 22 / Blueprints 170（+357 nodes）/ **`Interface sur…`** 12 / Variables 11
- **Writing activity 4 块**：Words written 0 / Active time 1m / Edits 0 / **`No str…`**

每块约 130×105px 表达一个整数，共占满首屏。**两块的标签在自己的砖里放不下**
（`Interface surfaces` 截成 `Interface sur…`，`No streak` 截成 `No str…`）——
砖不是太小，是这个形态本身在浪费空间。

### 0.4 前几卡留下、我逐条复验过的尾巴

1. **`Text ID` 打印裸 uuid**（U2 只治了标题行）—— 还在，见 §0.2。
2. **`Stage name`** —— 还在，见 §0.2。
3. **Dashboard tab 打开时右栏 Properties 全空且完全透明**：工作区背景照片一路透到面板里。
   U2 的 `.nl-editor-surface` 只挂在故事内容那块（整窗只有 **1** 个 `.nl-editor-surface` 元素）。
4. **资产面板里有 1 个没有可访问名的按钮**：24×24，CSS 位置 `(356,149)`，
   `class="p-1 rounded-md hover:bg-fill"`。全窗 164 个按钮里就这 1 个。
5. **U4 带来的新一条**：空文本行会把编辑器的占位符 `Double-click to enter narration`
   原样搬到 Dev Mode 时间线上——占位符是**给编辑器的操作提示**，在只读时间线上就是解释性文字。

### 0.5 一条产品事实（不是本卡范围，但影响判据怎么写）

**没有任何手势能取消行选中**（Escape / ctrl-click / 点空白都不行）。所以"无选中时右栏显示什么"
只在**还没点过任何行的场景**里可达——写判据时不要假设能从已选中状态退回。

---

## 1. 范围

### WI-1 空态：把解释句换成可操作的东西

对 §0.1 的 24 条逐条处理。规则不是"全删"，是**三选一**：

- **能给动作的**：换成一个动作（`No pages yet.` → 一个 `+ 新建页面` 的按钮，面板本来就有）；
- **该收起的**：内容为空且没有动作可给时，**面板/分区整个不渲染**，而不是渲染一句话
  （U4 的 Context tab 是反例的正例：根层它说"当前场景 X"，那是内容不是解释）；
- **确实要说话的**：只有 §0.1 里点名的两条（破坏性操作后果、诊断信息）留着。

不要把一句解释换成另一句更短的解释。

### WI-2 两处内部词汇

- `Stage name` → 作者语言。它是「这个角色在舞台上的对象名」，用于 `/displayable` 之类按名字找对象；
  措辞自定，但不许再出现 "Stage"/"name" 这种引擎侧说法，且值为默认值时不该看起来像用户输入的内容。
- `Text ID` → 裸 uuid 不再直接示人。可折叠 / 可复制 / 只在需要时展开（U3a 的分片路径就是这么处理的，照它做）。

### WI-3 数字砖压缩

- Scale 的 8 块 + Writing activity 的 4 块，压到**不再是每个整数一块砖**。
- 硬性：**没有任何标签被截断**（现在有两处）。
- 首屏要能看到项目本身的东西，而不只是 12 个整数。

### WI-4 检查器表面不透明（补 U2 的缺口）

- 资产 / 角色 / UI 元素 / Dashboard 的右栏 Properties 也要挂上 `.nl-editor-surface`
  ——现在整窗只有 1 个，故事内容那块。
- **验收在背景图开启态下量**（`ui.backgroundImage` 有值，这是 U0-3 的裁决）。

### WI-5 那个没有可访问名的按钮

给 §0.4 第 4 条那个 24×24 按钮加 `aria-label`。顺手扫一遍：**全 app 不应再有可见但无可访问名的按钮**。

### WI-6 时间线不搬编辑器的占位符

空文本行在 Dev Mode 时间线上不显示 `Double-click to enter narration`。

---

## 2. 明确不做

- 不改 schema、不改编译器。
- 不重做 Dashboard 的信息架构（只压缩数字砖，不重新设计这个页面）。
- 不动 `launcher.ts:36` 与 `storyExpr.ts:56`（见 §0.1）。
- 不碰 U4 的共享投影的**语义**（WI-6 只是不要在只读表面渲染编辑器占位符）。
- i18n en/zh key 集合一致性测试必须保持绿——删 key 要两边一起删。

---

## 3. 共享检出

这个检出同时有多个 session 在动，出卡当天 develop 动了 4 次、一次 84 文件的 revert。
**开工前 `git status`；`git commit` 一律带 pathspec**；逐文件 `git add`（禁 `-A`）、
禁 `git stash`、禁执行 `git worktree remove`；提交前 `git branch --show-current`。

交报告前必须做隔离树审计：`git archive <branch>` → 拷 `yarn.lock` → junction node_modules →
`yarn lint` + `yarn build:apps:dev`。**报告里给命令与输出，不只给结论。**

分支 `feat/ui-u5-language-and-empty-states`，从当时的 develop 开。

---

## 4. 判据（orchestrator 所有）

驱动路径与 U4 同（隔离树新实例 → Demo 副本 → 各面板）。控件按可访问名找；每个断言前先跑
setup guard 证明被测面板**在屏幕上且可达**；量透明度必须在背景图开启态。

| # | 断言 | 判定 |
|---|---|---|
| **B-1** | en catalogue 里 `/No .* yet/` 与 `/^Nothing on /` 的命中数 ≤ 2，且剩下的正好是 §0.1 点名的那两条 | 真 |
| **B-2** | en/zh key 集合一致性测试绿 | 真 |
| **B-3** | 故事内容行的检查器里不出现 `Stage name` 字样 | 真 |
| **B-4** | 检查器里不出现裸 uuid（`/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/` 0 命中，展开态除外） | 真 |
| **B-5** | Dashboard 首屏「一个整数一块砖」的砖数 ≤ 6（现状 12） | 真 |
| **B-6** | Dashboard 首屏没有任何被截断的标签（元素 `scrollWidth > clientWidth` 的文本节点数 == 0） | 真 |
| **B-7** | 资产 / 角色 / Dashboard 三处右栏，正文文字最近的不透明祖先 alpha == 1（背景图开启态） | 3/3 |
| **B-8** | 全 app 可见按钮中无可访问名者 == 0（现状：资产面板 1 个） | 0 |
| **B-9** | Dev Mode 时间线上不出现 `Double-click to enter` | 真 |
| **B-10** | 回归：U4 的 A-1a/A-1b/A-7/A-8/A-11 仍绿（复用 `u4-assert.js`） | 全绿 |
| **B-11** | 回归：Dashboard 的数字本身没变（Scenes 4 / Assets 22 / Variables 11 …），只是呈现变了 | 相等 |

改前标定与 U4 同法：判据先在当时的 develop 上跑一遍，**必须见红**；任何本该红却绿的断言，
orchestrator 重写它。

---

## 5. 交付

- 分支 `feat/ui-u5-language-and-empty-states`，不要自己合并。
- 报告 `docs/plans/reports/2026-07-26-U5-report.md`：逐条列 §0.1 的 24 个 key 各怎么处理
  （换动作 / 收起 / 保留），隔离树审计过程，lint 与 vitest 结果。
- **报告里不要写"验收通过"。**

---

## 6. 改前标定（orchestrator，develop @ `7ce8790d`）

**10 红 / 1 绿**（绿的是 B-2 i18n 一致性，本来就该改前绿——它是回归护栏）。
标定过程中**三条判据被改写、一条夹具被补**，全部是判据/工具的错，不是实现的错：

| 问题 | 现象 | 改法 |
|---|---|---|
| B-3 一开始"绿" | `PANEL_TEXT` 从 `Properties` 标题往上爬**固定 6 层**，爬到了整个窗口——于是"没找到 Stage name"是因为读了整个 app，不是因为它不在 | 改成按**形状**找右栏（宽 220–760、高 > 40% 视口、x 在右半边） |
| B-7 一开始"没得测" | 锚在面板正文文字上，而 Dashboard / 未选中的资产面板**右栏是空的**——"没内容可测" 被当成了失败 | 改成量**面板容器自己**的漆 |
| B-7 第二版又"绿" | 往上找"最近的不透明祖先"，找到的是面板自己的**标题条**（`rgb(11,13,18)`），标题条不透明而它标着的正文透明 | 只量容器自身：它 class 上写着 `bg-surface`、计算值却是 `rgba(0,0,0,0)`——**这个落差就是 WI-4 的全部** |
| B-9 恒真 | demo3 与夹具里**没有空文本行**，"时间线不许出现 `Double-click to enter`" 在任何场景上都成立 | 夹具补一行空旁白；补完立刻转红 |

标定还纠正了 §0.3 的两个读数：数字砖是 **13 块**不是 12（首屏还有 `Outline 2` / `Branches 2`），
被截断的标签是 `Interface surfaces` 与 `No streak`，都被夹到 78px。
B-8 也比交接文档记的多：资产面板 2 个无名按钮，其中一个 `(820,987) 36×20` 在**每个**面板里都在。

夹具（`Nesting Lab`）现在 17 块 / 6 根，比 U4 时多一行空旁白。

---

## 7. 验收记录（orchestrator 亲手，2026-07-26）

**结果：11/11 全绿 + U4 回归 19 绿 1 红（那 1 红是引擎卡 `2026-07-26-020`，与本卡无关）。
已合并 develop 并推送（merge `003224ab`）。**

方法：先把上游 9 个提交（L4/L5 分层立绘）并进 develop，再并 U5 分支（干净合并），
`yarn lint` 绿，然后 `git archive develop` 出隔离树 `D:/Temp/nls-u5-acc`、**新起实例**（CDP 9228）
跑全部判据 + 亲自读图。夹具指纹按内容比对：三个原场景逐块未变，共享 demo3 没被碰。

### 7.1 三条"红"是我的探针错，不是实现错

| 断言 | 我看到的 | 真相 |
|---|---|---|
| B-7 ×3 | 右栏容器 `bg-surface` 仍算出 `rgba(0,0,0,0)` | 面板**里面**已经长出了 `.nl-editor-surface`（x891 w460 h789，`rgb(11,13,18)`，`elementFromPoint` 打在它身上）。我量的是外层壳子，**低了一层**——和之前量到标题条那次是同一族错误（一次高一层、一次低一层） |
| B-8 | 每个面板都剩 1 个"无名按钮" | 它是 `role="switch"`、包在自己的 `<label>` 里、旁边就写着 "Show this dashboard every time the workspace opens"。**这是正确的可访问性写法**，不是本判据要抓的"图标按钮没有名字" |

改完三处后 11/11 绿。B-9 也确认**不是恒真**：夹具第 16 行是空旁白，时间线上它渲染成一行空行，
没有 `Double-click to enter narration`。

### 7.2 目视复核

Dashboard：14 块数字砖 → 两张 `标签 → 数值` 行卡，**`Interface surfaces` 与 `No streak` 都写全了**，
数字一个没变。右栏是实心深色面，背景照片不再透过来。
检查器：`Refer to as` / `Localization key`（uuid 收进折叠）。

### 7.3 执行者自报、我复核后的分歧

- **Dashboard 的 tab 正文仍然透明**（卡片下面还是壁纸）。WI-4 只点了右栏，所以这**不算没做到**；
  但按"数值不该和照片抢对比度"同一条理由它也该是阅读面。**留给下一轮，一行的事。**
- **本地化表变成两种行为**：`emptyUi` 删了、同族的 `emptyStory` 因为不在 §0.1 的正则里留下了。
  这是我按**正则**而不是按**界面**划范围造成的，记在这里。
- 执行者对 13 条选择了"不渲染"而不是"给动作"，理由是动作按钮就在 ~40px 内、再放一个就是同一个按钮两遍。
  复核同意：卡里写的是三选一，不是"每个空区都要有按钮"。
- 三个 key 根本没有调用点（死 key），顺手删了。
