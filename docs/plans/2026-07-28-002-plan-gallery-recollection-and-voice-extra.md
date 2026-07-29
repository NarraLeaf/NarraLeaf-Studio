---
title: "plan: 画廊的第二、第三条腿 —— 回想与语音 EXTRA"
type: plan
status: superseded
superseded-by: 2026-07-29-001-plan-gallery-extra-suite.md
date: 2026-07-28
branch: feat/gallery-capability
---

> **已被取代（2026-07-29）**：详细版见 `2026-07-29-001-plan-gallery-extra-suite.md`，
> 新增音乐鉴赏一栏，且本文的两个"大阻塞"被新事实显著缩小——引擎已有
> `LiveGame.playSound`（0.20.0 在售），NLR 环境在生产宿主开机即挂（标题页有声）。

# plan: 回想（シーン回想）与语音 EXTRA

## Overview

CG 画廊这一轮已经做完（见本分支的 `src/builtin-plugins/gallery/`）：v3 catalog、
分组、剧透遮罩、整数组返回的节点签名、可视化编辑器。

EXTRA 画面在商业 VN 里从来不只有 CG 一栏，它是三栏：

| 栏目 | 内容 | 解锁时机 | 点开之后 |
|---|---|---|---|
| **CG 鉴赏** | 一张原画（可带差分） | 剧情里展示过 | 全屏看图、切差分 |
| **回想** | 一个场景 / 一段剧情 | 剧情里走到过 | **重新播放那一段** |
| **语音 EXTRA** | 一条角色语音 | 剧情里听到过 | **重新播放那条音频** |

三者共享同一套骨架——一个可解锁条目的集合、分组、遮罩、进度——
所以 catalog 已经预留了 `GalleryEntryKind`（当前只有 `"cg"`，保留 `"scene"` / `"voice"`），
**新增的两栏是加 kind，不是加第二个 catalog**。这份文档要回答的是剩下的那部分：
后两栏各自缺什么，缺的东西在谁家。

结论先写：**回想几乎已经能做，缺一个很小的宿主改动；语音 EXTRA 卡在一个平台级空洞
——整个蓝图宿主 API 里没有任何播放声音的能力。**

## 1. 已核实的事实

以下都是在 develop（`f76fe07b`）上读代码确认过的，不是推测。

1. **`Start Game` 节点只认 inspector 参数。**
   `gameNodes.ts` 的 `BLUEPRINT_NODE_TYPE_GAME_START_STORY` 从
   `ctx.params.storyId` / `ctx.params.sceneId` 取值，`pins` 只有一个 `execIn`。
   它最终调 `hostApi.game.startStory({storyId, sceneId})`。
2. **`sceneEnter` 事件对插件是开放的。**
   `RuntimePluginEventMap` 里有 `sceneEnter: { sceneId: string | null }`，
   由 `events` 运行时能力提供。文档已写明它是**渲染**事件，重挂载会再触发一次。
3. **插件够不着 `startStory`。** `RuntimePluginGame` 上没有任何一个能力域映射到它。
4. **蓝图宿主 API 里没有声音。**
   `BlueprintHostApi` 的族只有 `navigation / widget / state / persistence / frame / game / devtools`；
   `game` 族 30 个能力里没有一个和音频有关。全仓 blueprint-nodes 下也没有播放节点。
5. **语音表已经随包发布，但只发给引擎。**
   `GameVoiceBundle.tables[locale][unitId] = assetId`，单位 id 就是故事的 `textId`，
   同时也是翻译单元 id 和引擎的 `voiceId`——一个 key space。
   插件读不到它：`contributes.runtimeData` 只发布**插件自己的** store。
6. **"听过 / 读过"其实已经在记了。**
   `textReadTracker` 把读完的 message text UUID 持久化在
   `BLUEPRINT_TEXT_READ_PERSISTENCE_KEY` 下。它和 `voiceId` 是同一个 key space。
   但宿主只暴露了 `game.isCurrentTextRead()`（当前行）和 `game.clearTextRead()`，
   **没有"按 id 查"或"列出全部"**。
7. **插件 API 没有故事目录。**
   `PluginServices.story` 只有 `actions.register`。编辑器面板列不出 story / scene；
   只有**节点 inspector** 能用宿主的 `dynamicOptionsSource: "stories" / "storyScenes"`。

## 2. 回想（scene recollection）

### 2.1 形状

一条 `kind: "scene"` 的 catalog 条目，除 CG 条目已有的字段外多两个：
`storyId` / `sceneId`。封面沿用现有的 `variants[0].imageAssetId`（一张缩略图），
遮罩、hidden、分组、进度统统白拿。

### 2.2 播放：缺一个小改动（**必须做**）

作者要的图是：回想列表 → 点某一行 → 重播那一段。
行是运行时数据，被点的是哪一条只有运行时知道，
而 `Start Game` 只能在作者时从下拉里选死一个场景（事实 1）。**这条链现在断在这里。**

**WI-R1｜给 `Start Game` 加可选数据输入引脚**（宿主，`gameNodes.ts`）
- 加 `storyId` / `sceneId` 两个 `optional: true` 的 string 输入引脚。
- 沿用仓里通行的"**接线优先于选择器**"模式（gallery 的 `resolveArtworkId` 即是）：
  `resolveDataPinValue(...) || ctx.params.storyId`。
- 向后兼容：老图没有接线，走 params，行为不变。
- 代价：一个节点定义 + 一个解析函数 + 测试。**这是回想唯一的硬阻塞。**

做完之后**插件不需要任何新能力**：插件出数据（`Get Gallery` 返回带
`storyId`/`sceneId` 的行），宿主出动作（`Start Game`）。职责边界干净，
不用往 `RuntimePluginGame` 上开 `story.start` 这种大口子——
这点尤其重要，因为运行时插件能力面正在被**收编**而不是扩张（见 memory
`runtime-plugin-api-leak`，卡 2026-07-26-017）。

### 2.3 解锁：不用改宿主

`sceneEnter` 已经给插件了（事实 2）。runtime entry 声明 `events` 能力，
订阅 `sceneEnter`，把 `sceneId` 匹配到 `kind: "scene"` 的条目上，写解锁记录。
重挂载重复触发无所谓——解锁是幂等的 set add。

这意味着**回想是三栏里唯一能做到"自动解锁"的**。CG 做不到（没有"这张图被展示了"
的事件），语音也做不到（同上）。值得在文档里对作者讲清楚，否则会被期望不一致坑到。

### 2.4 作者时：怎么选场景（**待裁决**）

画廊编辑器要让作者给一条回想选 story + scene，但插件面板列不出故事（事实 7）。三条路：

- **R-a** 给 `PluginServices.story` 加只读目录：`listStories()` / `listScenes(storyId)`。
  最直接，也对别的插件有用（成就、章节选择）。是新增插件 API 面，要过一遍能力评审。
- **R-b** 不在面板里选，改成在**节点 inspector** 里选：回想条目只存一个 id，
  `storyId`/`sceneId` 由作者在 `Start Game` 节点上用宿主自带的 `stories` /
  `storyScenes` 下拉选。零新 API，但把一份数据劈成两处，作者体验差。
- **R-c** 画廊节点自己声明 `dynamicOptionsSource: "stories"`——
  插件节点的 inspector 参数就是宿主渲染的，这条**大概率能通**（`dynamicOptionsSource`
  只是个字符串，宿主按 id 查上下文数据）。**没实测过，动工前先验证**。
  若通，等于 R-b 的体验但数据存在一处。

倾向 **R-a**；R-c 值 30 分钟去证伪。

## 3. 语音 EXTRA

### 3.1 卡点是平台级的

前两个问题都有解法，第三个没有：

| 需要 | 现状 | 解法 |
|---|---|---|
| 知道有哪些语音条目 | 语音表只发给引擎（事实 5） | 需要宿主暴露 |
| 知道哪些听过 | **已经在记**（事实 6），但查不了 | 需要宿主暴露 |
| **播放一条音频** | **整个宿主 API 没有声音**（事实 4） | **需要新建一个能力族** |

第三行才是这一栏的真正成本。它也**不只是语音 EXTRA 的问题**：
今天任何一个作者做的 UI 画面——标题界面、设置界面、存档界面——
都**放不出一个按钮音效**。这是个比画廊大得多的窟窿。

### 3.2 因此：先立"声音"这张卡，语音 EXTRA 是它的消费者

**WI-V1｜蓝图宿主的 `sound` 能力族**（宿主 + 引擎，独立成卡）
- `sound.play(assetId, { channel, volume, loop })` / `sound.stop(token)` /
  `sound.isPlaying(token)`，外加 `Play Sound` / `Stop Sound` 节点。
- **必须走引擎的 Sound API**，不能自己 `new Audio()`：玩家的音量、静音、
  分轨（BGM / SE / Voice）设置都在引擎那边，绕过去等于做了个不受设置控制的声音。
- 需要一个 `AnimationToken` 式的句柄类型（仓里已有 `BLUEPRINT_VALUE_TYPE_TIMER` /
  `ANIMATION_TOKEN` 两个先例可抄）。

> ⚠ **明确记下这条歧路**：插件靠 `assets` 运行时能力拿到 `assets.url(assetId)`，
> 再 `new Audio(url).play()` —— **今天就能跑**。
> 但它绕开玩家的音量与静音设置，**不能发货**。只允许用来做原型验证。

**WI-V2｜语音表对宿主可读**
- 语音 bundle 已经在包里；给蓝图宿主加 `game.listVoiceUnits()` 或让画廊
  以 `kind: "voice"` 条目引用 `unitId`，由宿主解析成 assetId。
- 附带决定：语音 EXTRA 的条目**要不要作者手工建**。
  语音表可能有上万条，全量铺进 EXTRA 画面是灾难。
  倾向：作者挑选（"这些是要进 EXTRA 的"），而不是自动全收。**待裁决**。

**WI-V3｜"听过"集合可查**
- `game.isTextRead(id)` / `game.listReadText()`，读的就是 `textReadTracker`
  已经在写的那份记录（事实 6）。改动很小，收益不止画廊
  ——"已读跳过"之类的功能也要它。

### 3.3 这一栏牵出的架构分叉（**需要用户裁决**）

CG 画廊留在插件里是合适的：它自成一体，数据是自己的，能力用 `store` 就够。
**语音 EXTRA 不是**——它要读 Studio 的一等公民文档（voice document，
`editor/voice/<locale>.json`，有自己的 service、编辑器 tab、CSV 导入导出）。
插件想读它，就得给插件 API 开一个通往另一个一等公民模块的口子。

两条路：

- **A｜留在插件**，按 WI-V1/V2/V3 补三个宿主能力，插件只做"组合层"。
  好处：边界清楚，画廊仍然是可卸载的可选功能（不是每个游戏都有 EXTRA）。
  坏处：插件 API 面持续变宽，和"收编运行时能力面"的方向相左。
- **B｜把 Gallery 提升为一等公民模块**（像 voice / localization 那样：
  自己的 document、自己的 service、内建蓝图节点）。
  好处：直接够到 voice document 和完整宿主 API，语音 EXTRA 顺理成章。
  坏处：改动量大得多；已有工程的插件 store 要迁移；
  且和用户这轮的措辞（"Studio 内建的这个 Gallery **插件**…将其完整实现"）不符。

**建议：先 A，且把 A 的三个 WI 都写成"对所有插件/作者都有用的宿主能力"
而不是"为画廊开的后门"**——`sound` 族、`listReadText`、`Start Game` 引脚
三者单独看都站得住。若将来 EXTRA 继续长（比如要读 achievements、读 localization），
再按 B 提升，届时数据迁移的成本也没有变大（catalog 是纯 JSON）。

## 4. 建议的落地顺序

| # | 工作项 | 归属 | 依赖 | 规模 |
|---|---|---|---|---|
| 1 | **WI-R1** `Start Game` 加 storyId/sceneId 引脚 | 宿主 | — | XS |
| 2 | 验证 R-c（插件节点能否用宿主的 `stories` 下拉） | 调研 | — | XS |
| 3 | R-a 或 R-b：作者时选场景 | 插件 API 或插件 | 2 | S |
| 4 | 回想：`kind:"scene"` 条目 + `sceneEnter` 自动解锁 + 编辑器一栏 | 插件 | 1,3 | M |
| 5 | **WI-V1** `sound` 能力族 + Play/Stop 节点 | 宿主 + 引擎 | — | **L（独立成卡）** |
| 6 | **WI-V3** `listReadText` / `isTextRead` | 宿主 | — | S |
| 7 | **WI-V2** 语音表可读 + 条目挑选 UI | 宿主 + 插件 | 5,6 | M |
| 8 | 语音 EXTRA 一栏 | 插件 | 5,6,7 | M |

**1–4 是一张卡，可以马上开工**（回想）。
**5 单独成卡**，它是平台缺口，价值远超画廊。
6–8 排在 5 之后。

## 5. 待裁决清单

1. **架构分叉**：A（留在插件 + 补三个宿主能力）还是 B（提升为一等公民）？
   建议 A。
2. **语音 EXTRA 的条目来源**：作者挑选，还是从语音表全量生成？
   建议作者挑选（万条量级不可能全铺）。
3. **回想的作者时选场景**：R-a（加插件 story 目录 API）/ R-b / R-c。
   建议先验 R-c，否则 R-a。
4. **回想重播的返回语义**：播完那一段之后回到哪里？
   `Start Game` 会替换掉当前 playthrough——从 EXTRA 画面进去的回想，
   播完应该回 EXTRA 而不是继续正篇。这需要一个"回想模式"的概念
   （播放边界 + 返回目标），**是本文档里唯一还没想清楚的产品问题**，
   动工前要单独讨论。
