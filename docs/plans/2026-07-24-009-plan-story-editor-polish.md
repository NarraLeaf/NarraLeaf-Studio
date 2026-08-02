---
title: "plan: Story 编辑器打磨 —— 密度对齐、指令文档、边栏减负、低配性能"
type: plan
status: draft
date: 2026-07-24
parent: 2026-07-22-001-feat-story-editor-overhaul.md
---

# plan: Story 编辑器打磨

大改版（`2026-07-22-001`）把能力铺开了，但每一层都停在"能用"。这张卡收**打磨**：对齐、密度、指令的可读性、边栏噪音、以及低配机器上的手感。

**本卡的每条结论都来自实机测量**，不是读代码推断的。方法见 §0；凡是我没测到的，文中都标了"未验证"。

分支建议：从 develop（`1aecb95`+）切 `feat/story-editor-polish`。
**共享检出铁律**（沿用 M5.1 卡）：逐文件 `git add <path>`；禁 `git add -A`；禁 `git stash`；每次提交前 `git branch --show-current`；**禁止 `git worktree remove`**。

---

## 0. 测量方法与环境

- 真机：`yarn dev` 起 Studio（CDP 9222），用 `project/app/cdp.js` 驱动。
- 样本工程：demo2 的副本，把 `The Forest` 场景灌成 **400 行纯对白**（真实长场景的下限规模；一章 800–1500 行很常见）。
- 计时：页面内 `PerformanceObserver({entryTypes:['longtask']})`，取每次交互产生的长任务时长。
- **重要限定**：`yarn dev` 跑的是 **React development build**（CPU profile 里 `jsxDEVImpl` / `validatePropertiesInDevelopment` / `logComponentRender` 合计约占忙时 30%）。所以下面的绝对值是**上界**，生产构建大约是它的 **65–70%**。结论不受影响的原因是：问题是**复杂度**（每次交互 O(全部行)），不是常数。
  → **执行时的第一件事**：在生产构建下复测同一组数字，把真实基线写进报告。

### 实测基线（400 行场景，dev build，M 系 Mac）

| 交互 | 长任务时长 | 说明 |
|---|---|---|
| 点一行（只改选中态） | **96–252 ms**（中位 ~100） | 最廉价的交互，仍然全表重渲染 |
| 插入行里敲一个字符 | **每键 ~100 ms**（96–185） | 约等于 10 fps 打字 |
| 滚动 | 0（无长任务） | 滚动是合成器路径，本来就没问题 |
| DOM 规模 | 编辑器子树 **12 099 节点** / 400 行 ≈ **30 节点/行** | 隐藏的 hover 按钮也全部在 DOM 里 |

### 一个已被证伪的猜想（省掉一条弯路）

给行加 `content-visibility: auto; contain-intrinsic-size` 之后**几乎没有变化**（100 ms → 95 ms）。
说明成本在 **React 协调**，不在布局/绘制。**别指望 CSS 能救**，必须动组件层。

---

## 1. S 组 —— 用户点名的四项

### S1 舒适密度：行内文本没有垂直居中 ★已定位到根因

**实测**（400 行场景，舒适密度）：行高 46 px，内容列高 35.2 px，`contentTop = 0`，**下方留白 10.8 px**。
更糟的是三列各走各的：拖拽把手列 `self-stretch items-center` 在 46 px 里**真居中**（偏移 0），内容列偏移 **−5.4 px**，行号列 `h-full items-start + pt-1` 也贴顶。于是舒适档下**把手和文字肉眼错位**。

根因是一条钝刀 CSS：

- `src/renderer/styles/styles.css:464-467` —— `[data-story-density="comfortable"] [data-story-row-block-id] { min-height: 46px }` 只把**行**撑高；
- `StorySceneEditorRows.tsx:192` 的行栅格是 `items-start`，三列全部贴顶，多出来的 10.8 px 全落在文字下面。

**改法（推荐）**：删掉这条 `min-height`，改成**密度感知的行内盒高**——把行号列（`:225`）、内容列（`:281`）、插入槽（`:1522/:1533`）共用的 `min-h-[27px]` 提成一个 CSS 变量（compact 27 / comfortable 38），三列同高同 `items-center`；把手列改成对齐这个盒子而不是整行。
**保留 `items-start` 是有意的**：换行的长台词必须首行与头像/行号对齐，不能整体居中。所以"居中"只能来自盒高，不能来自 `items-center` 加在行上。

顺带：`storyEditorTextStyle.tsx:44-53` 的舒适档只有 `1.15×` 字号 + `1.7` 行高两个常数，和 CSS 里的 46 px 是两处硬编码、互不知情——一起收进同一张密度表。

成本：S。风险：低（有视觉回归风险，建议顺手加一条 jsdom 断言：舒适档下内容列的中心偏移 = 0）。

### S2 Assets 边栏 header 的 "23 items"

`AssetsPanel.tsx:590`（窄边栏变体）。它在工具条那一行占横向空间，`hidden sm:inline` 是**视口断点**不是容器断点，所以边栏再窄它也不会让位。而且信息是冗余的——下面的树里每组都写着 `Images (22)` / `Character (5)`。

**改法**：删掉 `:590` 这一处。`:494`（宽 header 变体）可保留或一并删（建议一并删，理由同上）。真需要总数时它已经在 Asset Overview 页顶部（"23 items · 12.0 MB"）。
成本：XS。风险：无。

### S3 Asset Overview 去掉 Packaging 段

`AssetOverviewTab.tsx:192` + `:269-296` 的 `PackagingSection`，数据源 `assetOverviewModel.ts:57-70/147-155`。

它显示 `Actual 12.0 MB / If trimmed 10.5 MB / Difference 1.6 MB`。三个问题：
1. 它是**纯预测**，不改变任何构建行为（模型注释自己写了）；
2. `Actual` 和上面 Library 段的 `Total` 是同一个数，读起来像重复；
3. 面向工作室级用户，体积不是他们的决策变量。

**改法**：删 `PackagingSection` 与 `AssetOverviewPackaging` 类型/计算/i18n 键。`directoryBytes/directoryFileCount` 的采集链路（快照侧）一并评估能否停掉——它是一次目录遍历，去掉还能省掉打开总览页的一次 I/O。
**一个需要用户裁决的点**：`2026-07-22-001` §5.5 把"引用裁剪 v2"押在这段数据的实战审计上。删掉它等于**明确放弃打包裁剪路线**。我认为该放弃（漏引用的失败模式是玩家侧缺资产，收益又只有 1.6 MB）——但这是产品决定，不是重构。
成本：XS。风险：低（连带删 v2 路线，需确认）。

### S4 Actions 右边栏 → 指令文档

单列一节，见 §3。

---

## 2. P 组 —— 编辑器性能（低配友好）

问题的形状很干净：**每一次任何交互，400 行全部重渲染**。三个叠加因素：

1. `StorySceneEditorTab.tsx:1241` 是裸 `editor.visibleRows.map(...)`，**无虚拟化**（`2026-07-22-001` §9 已把它列为开放问题）；
2. `StoryBlockRow`（`StorySceneEditorRows.tsx:73`）**没有 `React.memo`**——全 renderer 只有 `properties/framework/**` 的字段组件和一个蓝图预览用了 memo，story 模块一个都没有；
3. 行的 props 里塞了 ~30 个**每次新建的箭头函数**，所以就算现在加 memo 也拦不住。

### P1 让行可 memo（最高性价比）★

- `StoryBlockRow` 包 `React.memo`。
- 把 30 个 per-row 闭包换成**稳定回调 + 行 id 参数**：`onSelect(event)` → `onSelect(blockId, event)`，回调在 controller 里 `useCallback` 一次；行内用 `useCallback` 绑自己的 id。
- controller 里凡是进 props 的对象（`commandContext`、`characters`、`tempSpeakers`）确认 `useMemo` 稳定。
- `useTranslation()` 每次返回新对象（`useTranslation.ts:34` 的 `{...translator, setLocale}`）——**不要**把 `t` 当 prop 传给 memo 组件，行内自己调（现状就是这样，保持）。

预期：选中/打字从 O(400) 降到 O(1~2)。**这条单独就能把 §0 表里的两行数字打掉一个量级**，且不动 DOM 结构、不碰 dnd-kit。
成本：M（机械但面广，约 30 个回调）。风险：中——memo 漏了某个依赖会变成"改了不刷新"，必须逐类行手测（对白/演出/容器/选项/lens 轨）。

### P2 打字与列表解耦

插入行的草稿值 `editorMode.value` 存在 controller 的 `useState` 里（`useStorySceneEditorController.ts:188`），所以**每敲一个键整棵编辑器树重渲染**。
**改法**：草稿文本降到 `InsertRow` 内部 state，只在提交/需要联想时上抛。P1 做完后这条的收益会小很多，但它是"打字必须永远流畅"的兜底，建议一起做。
成本：S/M。风险：中（`/` 联想菜单、ghost hint、确认回执都读这个值，得理清哪些必须实时上抛）。

### P3 虚拟化（长场景的天花板）

P1+P2 解决"每次交互的增量成本"，但**打开一个 1500 行场景仍要一次性挂 45 000 个 DOM 节点**。虚拟化是唯一解。

- 仓里**没有**虚拟化依赖。两条路：
  - `@tanstack/react-virtual`（~3 kB，支持动态测量，行高不定必须要它）——新增一个依赖；
  - 手写窗口化——省依赖，但行高不定 + 拖拽 + 键盘跨行导航 + 滚动位置恢复，四件事全都要自己对，我不建议。
- **硬约束**：dnd-kit 的 `SortableContext` 需要看到 items 列表；跨窗口拖拽（把第 3 行拖到第 900 行）在虚拟化下必须靠自动滚动 + `measuring` 策略，这是本条最大的未知。
- **交互契约必须不变**：`Home/End`、跨行框选、`Mod+F`（若做）、行级"从此处播放"的滚动定位、以及 `StorySceneEditorTab.tsx:1420` 那块"底部留一屏"的技巧。

成本：L。风险：高。**建议单独一张卡**，且排在 P1 之后——P1 做完可能就够用到 1000 行，虚拟化的紧迫性会重新评估。

### P4 背景行美术：两笔冤枉钱 ★便宜

`BackgroundRowArtwork`（`StorySceneEditorRows.tsx:2510-2542`）给每个 `/bg` 行铺一张**原图** `<img>`（1920×1080 解到 ~1300×35），再叠一层 `backdrop-blur-[3px]` 的遮罩（`:2528`）。

- `backdrop-filter` 是 Chromium 最贵的合成操作之一，**每个这样的行一个独立合成层**。低端 GPU 上这是滚动杀手。
- 原图解码没有缩略图缓存（`storyBadgeImageCache.ts` 已经为徽章做了这件事，背景没有走）。

**改法**：遮罩改成纯 `linear-gradient` 渐隐（视觉上几乎无损，`backdrop-blur` 去掉）；图走缩略图缓存；顺带把满幅美术收成**右侧定宽条**（见 X1，视觉理由）。
成本：S。风险：低。

### P5 隐藏的 hover 按钮不进 DOM

每行都渲染了 `RowActions`（`:647`）+ `RowPlayAction`（`:784`）+ 拖拽把手，靠 `opacity-0 group-hover:opacity-100` 藏着——**30 节点/行里有相当一部分是这个**。
**改法**：hover 态才挂载（`onMouseEnter` 置位 + 单一"当前 hover 行"状态），或整层提到行外用一个跟随定位的浮层。
注意：`RowActions` 的两个按钮是 `tabIndex={-1}`，摘掉不影响键盘；但**拖拽把手是 `tabIndex={0}` 且有 `focus-visible:opacity-100`**（`:249-252`），它必须留在 DOM 里可 Tab 到，别一刀切。
成本：S/M。风险：中（拖拽把手的键盘可达性）。

### P6 低配开关：让 `ui.reduceMotion` 真的管事

`nl-reduce-motion` 类已经存在（`styles.css:193`、`lib/appearance/index.ts:36`），但故事编辑器没有为它做任何降级。
**改法**：`reduceMotion` 开启时——dnd-kit 的 `transition` 关掉、背景行美术降为纯色条、`backdrop-blur` 全关、行 hover 过渡关掉。这是"低配友好"最诚实的形态：**给用户一个开关，而不是猜他的机器**。
顺带一个死设置：`ui.compactMode` 在 `globalState.ts:27/142` 声明了，**全仓零消费者**，设置面板也没暴露。要么接到编辑器密度上，要么删掉。
成本：S。风险：无。

---

## 3. D 组 —— Actions 边栏改造成指令文档

### 现状（实机截图确认）

- **Actions 边栏**（`StoryActionCreatorPanel.tsx`）：搜索框 + 类别 chip 条 + 分组列表。每行只有 `图标 + 标题 + 一句话`。
  - 类别 chip 条横向溢出，最后一个 chip 被切一半。
  - **同一条命令在多个主题下重复出现，且描述一字不差**：`/show` 在 CHARACTER 和 IMAGE 两段都是 "Show a character or a stage object"。这是 A1 的"按 `accepts` 归档到每个主题"的正确后果，但在浏览视图里读起来就是复读。
- **Command reference**（`StoryCommandManual.tsx`，头部 📖 按钮）：**模态**、单列、40+ 条平铺、无导航。有签名和别名，但**没有任何参数说明**——`[t=]` `[d=]` 读者无从知道是 transition 和秒数。
  - 致命的一点：它是模态的，**你必须关掉它才能去写那条命令**。

两个面板同源（`storyCommandSearch.ts`）却各说各的：一个能插入不能读，一个能读不能插入。

### D1 合并为"指令手册"边栏（主体工作）

一个右侧面板，**列表 + 详情两栏**（窄边栏则列表→详情钻取）：

- **列表**：按主题分组，保留搜索（token / 别名 / 本地化名 / 拼音，`storyCommandManualModel.ts:69` 已有）。
  - **去重**：一条命令只出现在它的**主分类**下一次；"也接受图片/音频/视频"改成详情里的一行"适用对象"徽章。这解决复读，同时不丢 A1 的归档信息。
- **详情**：
  - 大号签名（`signatureOf` 已有）+ 别名 + 主分类色；
  - **参数表**——这是现在完全缺失的一层，而且**可以零新文案地生成**：`storyCommandGrammar.ts` 的 `StoryCommandParamType` 已经带了全部事实（枚举选项及其别名、数值 `min/max/integer`、资产类型、`dependsOn`、`core`/可选、`greedy`、`skippable`）。渲染成"名字 / 类型 / 必填 / 说明"四列，类型一栏由 kind 派生（`enum → left | center | right`、`number(min 0) → 秒数，≥0`、`asset:image → 图片资源`）。**只有少数确实需要散文的参数才补 `story.command.<id>.param.<name>` 键**，不要一上来就为 ~120 个参数 × 2 语言写文案。
  - **示例**：给 spec 加一个可选 `examples?: readonly string[]`（命令行本身是英文关键字，不进 i18n）。
    **这是本节最好的一笔**：`commands/specs/specs.test.ts` 已经有 `parse → resolve → build` 的完整夹具，可以**断言每条示例都能解析、解析、成块**。文档因此不可能撒谎，也不可能过期。
  - 底部：`插入到当前行` 按钮（复用 `dispatchStoryActionCreateRequest`）+ ⭐收藏（现有）。
- **入口收敛**：头部 📖 按钮改成"打开指令手册边栏并聚焦搜索"，模态 `StoryCommandManual.tsx` 退役。
- **联动（可选但很值）**：`/` 行的 ghost hint 和无效行的报错，都能深链到手册里对应命令的详情（"按 F1 查看 /show"）。

成本：M/L。风险：低（纯新增渲染层，数据全是现成的）。
**这条最好拆两批**：D1a = 列表+详情+参数表（无新文案）；D1b = 示例 + 测试 + 深链。

### D2 类别 chip 条

溢出切一半 → 改成两行 wrap，或首行放 5 个常用 + "更多"。
成本：XS。

---

## 4. X 组 —— 发散：其余打磨项

按"我有多确定"排序。前四条是我在实机上直接看到的；后面是判断。

| # | 项 | 现象 / 理由 | 成本 |
|---|---|---|---|
| **X1** | 背景行满幅美术太吵 | 连续 6 个 `/bg` 行时，整个编辑区变成一面图墙，文字被压住（截图可证）。收成**右侧定宽缩略条**（96–160 px）+ 左侧不再需要 scrim，读感和性能一起解决（与 P4 同一处代码） | S |
| **X2** | 行 hover 动作是**文字按钮** | `Insert` / `Delete` / ▷ 三个文字挤在行右，和全 App 的图标语言不一致，也比图标宽得多。改图标 + tooltip | XS |
| **X3** | 密度只有两档，且不是"设置" | 现在是头部一个二态图标按钮。改成**三档**（紧凑 / 标准 / 舒适）的下拉，和 `editor.fontSize` 并列；顺手把 §S1 的密度表接上 | S |
| **X4** | Asset Overview 数字重复 | 删了 Packaging 之后，Library 段的 `Total 23 / 12.0 MB` 就是唯一的总量口径，页头的 "23 items · 12.0 MB" 可去其一 | XS |
| **X5** | 长场景没有"我在哪" | 滚动时**说话人分组头 / 容器头不吸顶**。粘性组头（`position: sticky`）对长对白场景的读感提升很大 | M |
| **X6** | 场景内没有查找替换 | 只有全局搜索。`Mod+F` 在编辑器内查找 + 替换（尤其批量改称呼）是写作者的刚需。**注意与交互模型的键位冲突要先查** | M |
| **X7** | 诊断没有落点 | `2026-07-22-001` §9 的开放问题（"说话未入场"、资产缺失、不可达行、语音未绑定）。**建议先只做行内 gutter 标记 + tooltip**，不建面板——面板形态还没想清楚 | M |
| **X8** | 空场景的第一印象 | 新场景只有一行灰字 `Click or type to add a row...`。给一个轻量引导（三条最常用命令 + "按 / 打开指令"）——这是新用户唯一会读的地方 | S |
| **X9** | 行号列宽度固定 36 px | 1000 行以上四位数会挤。按位数自适应 | XS |

---

## 5. 建议的执行批次

每批独立可发布、可单独验收。

- **批 A（半天，全是删和对齐）**：S1 密度对齐 + S2 去 items + S3 去 Packaging + X2 图标化 + X4 去重复数字。
  → 立刻可见，风险最低，建议先做。
- **批 B（性能第一刀）**：P1 memo + 稳定回调 + P2 打字解耦。**做完必须在生产构建下复测 §0 那张表**，把前后数字写进报告。
- **批 C（低配与视觉一起）**：P4 背景行 + X1 缩略条 + P5 hover 按钮 + P6 reduceMotion 降级。
- **批 D（指令文档）**：D1a → D1b → D2。
- **批 E（各自独立，随时插）**：X3 三档密度、X5 粘性组头、X8 空场景引导、X9 行号宽度。
- **单独立卡**：P3 虚拟化、X6 查找替换、X7 诊断。这三条都会改交互契约，不该混在打磨卡里。

---

## 6. 不做 / 存疑

- **不用 CSS 救性能**：`content-visibility` 已实测无效（§0），不要再试 `will-change` / `transform: translateZ(0)` 这类偏方。
- **不在打磨卡里动文档模型**：一行一义、块结构、schema 一律不碰。
- **不为参数文档一次性写 120×2 条 i18n**：先派生，缺什么补什么（D1）。
- **存疑，需要用户裁决**：
  1. S3 删 Packaging = 放弃"打包引用裁剪 v2"路线，确认？
  2. P3 是否接受新增 `@tanstack/react-virtual` 依赖？
  3. X6 `Mod+F` 与既有键位契约是否冲突（我没查交互模型文档的键位表）。

---

## 7. 验收口径

- `yarn lint` 全绿；vitest 新失败 0（win32 基线 `src/shared/utils/path.test.ts` 3 条）。
- **S1** 加一条 jsdom 断言：舒适密度下，行内容盒中心与行中心偏移为 0。
- **D1b** 加断言：每条 spec 的每个 `examples` 都能 `parse → resolve → build`。
- **批 B** 的报告必须带**生产构建**下 400 行场景的前后长任务数字，dev 数字只作参考。
- 真机验收：对白 / 演出 / 容器 / 选项 / lens 轨五类行，在紧凑与舒适两档下各走一遍选中、编辑、拖拽、撤销。
