---
title: "plan: Gallery EXTRA 套件 —— 回想、音乐鉴赏、语音 EXTRA"
type: plan
status: proposed
date: 2026-07-29
branch: (未开工)
supersedes: 2026-07-28-002-plan-gallery-recollection-and-voice-extra.md
---

# plan: Gallery EXTRA 套件

## Overview

CG 画廊已于 2026-07-28 做成真能力并入 develop（merge `e1fba735`）。本卡详细规划
Gallery 承载的其余 EXTRA 栏目：**回想（场景重播）、音乐鉴赏（BGM 播放器）、语音
EXTRA（角色语音重听）**。

三栏共享同一套骨架——可解锁条目集合、分组、剧透遮罩、进度统计——catalog v3 已为此
预留了 `GalleryEntryKind`。本文的核心主张：**三栏是往同一个 catalog 里加 kind，
外加两块宿主能力（Start Game 引脚、sound 能力族），不需要平行的新系统。**

## 0. 本轮核实的新事实（修正上一轮结论）

上一轮（2026-07-28-002）的三个"阻塞点"里，有两个比当时判断的**小得多**：

| # | 事实 | 出处 | 对计划的影响 |
|---|---|---|---|
| F1 | **`LiveGame.playSound(sound\|string\|URL): Promise<SoundToken>` 已存在于引擎**，且在 Studio 正在用的 `narraleaf-react@0.20.0` dist 里 | 引擎 `liveGame.ts:457-463`；`node_modules/narraleaf-react/dist/main.js` 有 3 处命中 | 上一轮把 sound 能力族标为 **L（引擎+宿主）**；引擎那半**已经做完了**，剩宿主接线，降为 **M** |
| F2 | **NLR 环境在生产宿主是开机即挂**（"Callers mount either from boot … or from a Start Game that could not fast-path"），标题页上 `liveGame` 已存在 | `GameApp.tsx:1215` 附近的挂载注释 | 标题页的音乐鉴赏/语音 EXTRA **可以直接走 `liveGame.playSound`**，不需要宿主自建 Web Audio 后端。此前担心的"无 gameState 就没声音"只影响编辑器预览（本来就该降级） |
| F3 | `SoundToken` 有完整运输面：`pause/resume/stop/setVolume/mute/isPlaying/isPaused` | `@narraleaf/sound/dist/sound/soundToken.d.ts` | 音乐播放器 UI（暂停/续播/切曲）不需要引擎新 API |
| F4 | 引擎按 `SoundType`（`voice/bgm/sound`）分通道管音量，四个音量偏好（voice/bgm/sound/global）**已经**是蓝图偏好节点 | 引擎 `sound.ts:12-16`、`AudioManager.ts`；Studio `gameNodes.ts:183-247` | 播放节点只要选对通道类型，玩家的音量/静音设置**自动生效**——上一轮最担心的"绕过设置的声音"陷阱，正解就是把 `type` 传对 |
| F5 | `LiveGame.onCurrentActionChange`（`event:action.current`）让宿主观察每个执行的动作，GameApp 已在订阅 | 引擎 `liveGame.ts:727`；`GameApp.tsx` `currentActionIdRef` | "听过这首 BGM"的**自动解锁**有干净的宿主级实现路径（见 §4.4），不需要引擎新事件 |
| F6 | 故事有 `action: "blueprint"`（Story Action Blueprint 的 On Call 图） | `document.ts:605` | 剧情流里解锁任何 gallery 条目的路径**已经存在**：故事行 → blueprint → Unlock Gallery 节点 |
| F7 | 编译后的 `/bgm`、`/sound` 动作 payload 携带 `assetId` | `storyCompiler.ts:2181-2199` | 自动"听过"追踪可以在编译期建 Sound 实例 ↔ assetId 映射，不用逆向解析 URL |
| F8 | **"读过"集合与语音单元是同一个 key space（已验证）**：`createReadKeyResolver` 把 actionId 映射到 `binding.textId`（`textReadTracker.ts:180-194`），读过集合按 textId 持久化；语音单元同样按 textId 键（voice.ts："it is simultaneously the translation unit id and the engine's voiceId"） | `textReadTracker.ts:180`、`storyCompiler.ts:285-290`、`voice.ts` 头注释 | "这条语音听过没有" = "这行读过没有"，语音 EXTRA 的解锁记录**已经在玩家的历史数据里积累着**。语义注意：read ≠ 语音实际播过（静音玩家也算），但这正是商业 VN 的通行口径（看过场景即解锁） |

维持不变的结论：`Start Game` 仍只认 inspector 参数（无数据引脚）；蓝图宿主 API
仍没有任何 sound 能力族；插件面板仍列不出 story/scene 目录。

## 1. 共享骨架：kind 化的 catalog

### 1.1 数据模型（catalog v4）

维持 artwork→variants 两层不变，让三种新内容**复用**这个形状，而不是各建一套：

```
kind: "cg"     条目=一张原画       variants=差分          （现状，不动）
kind: "scene"  条目=一段回想       variants=1 个（封面）   +payload{storyId,sceneId,startBlockId?}
kind: "music"  条目=一首曲/一张碟   variants=曲目           variant +audioAssetId,+durationSec?
kind: "voice"  条目=一个角色/一类   variants=挑选的语音行    variant +voiceUnitId
```

这个复用是有实质回报的，不是形式对称：

- **解锁记录零改动**。unlock set 是 variant-id 集合，专辑解锁一首曲 = artwork 解锁
  一个差分，`isArtworkUnlocked` / `countUnlockedVariants` / 进度统计原样工作。
- **分组零改动**。章节分组回想、按角色分组语音、按碟分组音乐，都是现有 `groupId`。
- **遮罩零改动**。锁定的音乐条目照样吃 `lockedNameMask` 和占位图；`hidden` 的
  秘密曲目照样不进分母。
- **编辑器 tab 复用壳**。组侧栏/网格/检查器的骨架不变，检查器按 kind 换字段区。

具体 schema 改动（v3→v4，逐条目迁移，v3 条目缺 `kind` 时按 `"cg"` 读——v3 的
normalizer 已经这么写了，所以**v4 读 v3 是零迁移**）：

- `GalleryVariant` 增加可选 `audioAssetId` / `audioAssetName` / `durationSec` /
  `voiceUnitId`。图像字段继续存在：曲目可以有自己的封面差分图。
- `GalleryArtwork` 增加可选 `payload`（仅 `scene` kind 用：`storyId` / `sceneId`，
  可选 `startBlockId` 精确到行——Scene Snapshot 那轮已有行级 launch 的先例）。
- 投影层（`projectGalleryEntries` / `projectGalleryVariants`）把新字段带上行：
  `audioAssetId`（锁定时置空，同图像纪律）、`durationSec`、`voiceUnitId`、
  `storyId`/`sceneId`（锁定时置空——回想的场景坐标也是剧透）。

### 1.2 节点签名：不加新的读取节点

`Get Gallery` 已有 Group Id 过滤；加一个可选的 **Kind** inspector 参数（select:
all/cg/scene/music/voice）就够了。行上多出来的字段由投影层带，item template 用
现有 `Get JSON Field` 读。**三栏的画面全部用现有的 List 管线搭**，这是上一轮
数组签名设计的直接兑现。

写侧同理：Unlock/Lock/isUnlocked 对 kind 无感知，variant-id 就是 variant-id。

## 2. 回想（scene recollection）

### 2.1 玩家侧形状

回想列表（缩略图 + 标题，锁定项显示占位）→ 点击 → 重播那一段 → 播完回到 EXTRA 画面。

### 2.2 工作项

**WI-R1｜`Start Game` 加可选数据输入引脚**（宿主，`gameNodes.ts`）——回想唯一的硬阻塞

- 给 `BLUEPRINT_NODE_TYPE_GAME_START_STORY` 加三个 `optional: true` 引脚：
  `storyId` / `sceneId`（string），以及 `startBlockId`（string，见下）。
- 解析规则沿用仓里通行的"接线优先于选择器"（gallery `resolveArtworkId` 同款）：
  `resolveDataPinValue(...) || ctx.params.storyId`。
- 老图无接线 → 走 params → 行为不变。加 `builtinBlueprintNodes.test.ts` 断言。
- `startBlockId`：宿主的 launch 编译已支持行级起点（Dev Mode "play from here"，
  见 memory `scene-snapshot-and-row-launch`）。回想条目若授权了 `startBlockId`，
  重播从那一行起——一段回想不必从场景头开始。**先查 `game.startStory` 的宿主实现
  是否已接受 startBlockId；若 Dev-Mode-only，就把这条引脚推迟到 M2，场景级起点
  先行。** 规模：XS（不含 startBlockId 打通）。

**WI-R2｜回想模式：播放边界与返回语义**（宿主 + 插件协作）——上一轮遗留的产品问题，这轮给出设计

问题：`startStory` 替换当前 playthrough；从 EXTRA 进的回想播完后不能把玩家扔在
正篇里，也不该污染他的存档状态。

设计：给 `game.startStory` 的宿主实现加一个可选 `mode: "recollection"`：

1. **挂起而非替换**。进入回想前，宿主对当前 playthrough 做一次内存快照（引擎的
   序列化就是现成的 SavedGame 机制；不写盘，只留在 GameApp 的 ref 里）。
2. **静默副作用**：
   - 自动存档调度器暂停（`autoSaveScheduler` 已是宿主对象，加一个 gate）；
   - `textReadTracker` 暂停写入（回想里"读过"不该二次累积——它已经读过了；
     但**不暂停也无害**，幂等 set add。低优先级）；
   - 插件事件照发（`sceneEnter` 在回想里再触发解锁是幂等的，无害）。
3. **结束返回**：故事栈走空（现有 `gameEnd` 事件点）或玩家主动退出（Quit Game 节点）
   时，宿主恢复快照、导航回进入时的 Surface。进入时的 Surface id 随 mode 一起传。
4. 存档 UI 在回想模式里应当由作者自己隐藏——给蓝图加一个 `Is Recollection Mode`
   读取节点（boolean，随 WI-R2 一起），作者用它 gate 存档按钮。

规模：M。这是回想里唯一需要真设计评审的一块，建议单独 PR。

**WI-R3｜作者时选场景**（插件 or 插件 API）

三案维持上一轮结论，这轮补充了验证结果的位置：

- **R-c（先验证，30 分钟）**：gallery 节点的 inspector 参数直接声明
  `dynamicOptionsSource: "stories"` / `"storyScenes"`。宿主渲染插件节点的
  inspector 时按 source id 查上下文数据，字符串是同一个命名空间，**大概率直接通**。
  若通：编辑器里"回想条目挑场景"就做在**条目检查器**里（插件 UI 拿不到 story 目录,
  但可以放一个只读提示 + 让作者在蓝图侧配），或者——更好——顺手做 R-a。
- **R-a（建议）**：`PluginServices.story` 加只读目录 `listStories()` /
  `listScenes(storyId)`。检查器里直接下拉选。对成就/章节选择类插件同样有用。
  规模 S,走一遍插件 API 评审（注意 memory `runtime-plugin-api-leak`：这是
  **studio 侧** PluginServices,不是 runtime 能力面,不撞收编方向）。
- R-b（不选场景、全靠蓝图接线）：仅当 R-a 被否时的退路。

**WI-R4｜自动解锁**（纯插件）

runtime entry 声明 `events` 能力，订阅 `sceneEnter`，`sceneId` 匹配到
`kind:"scene"` 条目 → unlock set add。重挂载重复触发无害（幂等）。
**三栏里只有回想能自动解锁**——CG 和音乐没有"展示过"事件（音乐见 §4.4 的例外），
这个预期差写进作者文档。规模 XS。

**WI-R5｜编辑器 tab 的 scene 区**（纯插件）

检查器按 kind 分支：scene 条目显示 story/scene 选择器（R-a/R-c 的产物）+
封面图挑选。网格卡片加 kind 角标。规模 S。

### 2.3 验收口径

真 app：EXTRA 页列出两条回想（一锁一开）→ 点开的那条 → 重播 → 栈走空 → 回到
EXTRA 页 → 原 playthrough 完好（对话行、变量、存档列表均未变）。锁定那条不可点。

## 3. sound 能力族（音乐、语音的共享依赖）

### 3.1 设计

宿主蓝图 API 新增 `sound` 族（`hostApi.ts` 第八个族），四个能力 + 一个值类型：

```
sound.play    { assetId | url, channel: "bgm"|"sound"|"voice", loop?, volume? } -> SoundHandle
sound.stop    { handle?, fadeMs? }        // 省略 handle = 停掉本族经手的全部
sound.pause   { handle }   sound.resume { handle }
sound.isPlaying { handle } -> boolean
```

- **实现走 `liveGame.playSound(Sound)`**（F1），构造 `new Sound({src, type, loop,
  volume})` 把 channel 映射到 `SoundType`——玩家的分轨音量/静音因此自动生效（F4）。
  引擎的 `Sound.play()` 对 bgm 型有拦截，但那是元素动作链的限制；
  `audioManager.playSoundToken` 按 `config.type` 找通道，不拦。**动工首日先写一个
  真 app 冒烟测试证实 bgm 型 token 播得出来**，这是本设计唯一的引擎行为假设。
- **`SoundHandle` 是新蓝图值类型**，照抄 `Timer`/`AnimationToken` 的 token 模式
  （`valueTypes.ts` 两个现成先例）：宿主持 SoundToken 注册表，蓝图里流转
  `{kind:"soundHandle", id}` 信封。
- **节点**：`Play Sound` / `Stop Sound` / `Pause Sound` / `Resume Sound` /
  `Is Sound Playing`，Game 类目。`Play Sound` 的 asset 参数用现有的
  `imageAsset` param kind 的音频版——**查一下 inspector 有没有 audioAsset picker；
  没有就得加**（工作量计入本 WI）。
- **降级矩阵**：编辑器预览无 liveGame → `Play Sound` no-op + 返回空 handle +
  console warning（与 gallery store 缺席同款纪律）；生产标题页有 liveGame（F2）→ 正常。
- **页面退出不自动停**。显式记这个坑：作者从音乐页导航走，音乐会继续放——这有时
  是特性（试听着回主菜单）有时是 bug。M1 先给 `Stop Sound`（无 handle = 全停）让
  作者在 Page 退出事件里手动停；观察真实用法后再决定要不要 per-surface 自动作用域。

### 3.2 插件够不够得着？

**这族只做宿主内建节点，不进 runtime 插件能力面。** 音乐/语音 EXTRA 的画面是
UI 蓝图搭的,用的是宿主节点,插件只负责供数据（catalog 行）。这样既不撞
`runtime-plugin-api-leak` 的收编方向,也让"作者在任何画面放个按钮音效"这个
远超画廊的需求同轮受益。规模：M（引擎零改动）。

## 4. 音乐鉴赏

### 4.1 数据模型

`kind:"music"`。单曲 = 单 variant 条目（与单图 CG 同构，UI 同样藏层级）；
专辑 = 多 variant。variant 的 `audioAssetId` 指向音频资产库,`imageAssetId`
仍可放每曲封面。条目 `description` 放作曲/编曲/授权说明（锁定时照常吞掉）。

### 4.2 画面（作者用现有管线搭,插件出模板文档）

`Get Gallery (kind=music)` → `Set List Content` → 行模板：封面小图 + 曲名 +
时长 + 锁定态。行点击 → `Get List Item Props` 拿 `audioAssetId` →
`Play Sound (channel=bgm)`。Now-playing 区：`Pause/Resume/Stop` + 手柄存局部变量。
**不做 seek**：SoundToken 没有公开 seek（F3 列表里无 seek——`startOffset` 是构造
参数），M1 范围明确排除,免得 UI 承诺了引擎没有的东西。

### 4.3 解锁

- 手动：故事里 `action:"blueprint"` → Unlock Gallery（F6，已通）。
- 进度：`Get Gallery Progress (kind=music)` 现成。

### 4.4 WI-M1｜自动"听过"追踪（宿主，可选增强,建议 M2）

textReadTracker 的同款模式,对象换成 BGM：

1. 编译期：`storyCompiler` 在 `getSound`/bgm 构造处已经拿着 `assetId`（F7）,
   把 `Sound 实例 → assetId` 记进 compiled 产物的一张 Map；
2. 运行期：宿主经 `onCurrentActionChange`（F5）观察到 SoundAction 执行时,查表
   得 assetId,写进持久化的 `nls.heardAudio` 集合（textRead 同款 debounce 落盘）；
3. 插件侧：gallery runtime 读该集合（需要一个小宿主暴露,或直接由作者用
   `Is Text Read` 的音频版节点 gate）——**具体暴露面等 WI-V2 一起定**,两者是同构
   需求（"给我一个已发生集合的成员测试"）。

规模：S~M。不阻塞音乐鉴赏 M1（手动解锁先行）。

### 4.5 验收口径

真 app 标题页（**不开始游戏**）：音乐页两曲一锁一开 → 播放开曲 → BGM 音量滑条
（现有偏好节点）实时影响音量 → 暂停/续播 → 换曲（前曲自动停,作者图里实现）→
锁定曲不可播。回主菜单音乐不断（记录在案的已知行为）。

## 5. 语音 EXTRA

### 5.1 数据模型与策展

`kind:"voice"`。条目 = 角色（或"名场面"类目）,variants = **作者挑选**的语音行,
每个 variant 的 `voiceUnitId` 指向语音单元 id。**不做全量自动生成**：语音表上万条
是常态,EXTRA 是策展面不是数据库 dump（上一轮已倾向,这轮定案,除非用户推翻）。

### 5.2 工作项

**WI-V2｜语音单元对编辑器可选**（插件 API 或复用 R-a 的模式）

编辑器里给 voice variant 挑 unit：需要读 voice document（`editor/voice/<locale>.json`）。
两条路,与 R-a 同构：
- `PluginServices.voice.listUnits(localeCode)`（只读目录,附行文本预览和时长）;
- 或 R-c 若验证通过,用 dynamicOptionsSource 由宿主供选项。
挑中后把 unitId + 当时的行文本快照（作字幕用）写进 variant。规模 S~M。

**WI-V3｜运行时解析 unitId → 可播 URL**（宿主暴露,很小）

语音 bundle（`GameVoiceBundle.tables[locale][unitId] = assetId`）已随包发布并被
宿主消费；蓝图侧只缺一个 `Resolve Voice Asset` 节点（in: unitId; out:
assetId/url + found:boolean），内部读当前语音语言（`nls.voiceLocale`,已有
持久化键）选表。播放则是现成的 `Play Sound (channel=voice)`。规模 S。

**WI-V4｜"听过"即解锁（F8 已验证,直接接线）**

Key space 一致已确认（F8）。加 `Is Text Read By Id` 宿主节点（in: id; out:
boolean）,读 `BLUEPRINT_TEXT_READ_PERSISTENCE_KEY` 下已有的持久化集合——语音
EXTRA 的锁定态直接问它,**不需要 gallery unlock set 参与**,玩家历史数据里的
已读记录立即生效,这是三栏里唯一"追溯既往"的解锁。
（画廊行的 locked 字段照常工作:投影时不知道 text-read,所以 voice kind 的行
由作者用该节点逐行 gate,或投影层接受一个宿主注入的成员测试——实现时二选一,
倾向后者:遮罩纪律应该留在投影层,别散进作者的图。）规模 S。

**WI-V5｜编辑器 voice 区 + 字幕**

检查器 voice 分支:unit 挑选器、行文本快照展示、试听按钮（编辑器里直接
`assets.createObjectUrl` 播,不走游戏通道——作者侧无音量偏好问题）。规模 S。

### 5.3 验收口径

真 app:语音页按角色分组 → 已读过的行可播且显示行文本,未读过的行按遮罩规则
显示 → 播放走 voice 通道（voice 音量滑条生效）→ 切语音语言(若配了多语)后
同一行播对应语言的音频。

## 6. 里程碑与排序

| M | 内容 | 工作项 | 依赖 | 规模 |
|---|---|---|---|---|
| **M1-a** | Start Game 引脚 | WI-R1 | — | XS |
| **M1-b** | sound 能力族 + 5 节点 + bgm-token 冒烟 | §3 | — | M |
| **M1-c** | catalog v4(kind 化)+ 投影扩展 + Kind 过滤参数 | §1 | — | S |
| **M2-a** | 回想全链:回想模式、自动解锁、编辑器 scene 区 | WI-R2..R5 | M1-a, M1-c, R-c 验证 | M |
| **M2-b** | 音乐鉴赏:编辑器 music 区 + 模板文档 | §4 | M1-b, M1-c | S |
| **M3-a** | 语音 EXTRA:unit 选择、解析节点、听过接线、编辑器区 | WI-V2..V5 | M1-b, M1-c, R-1 验证 | M |
| **M3-b** | 自动"听过"音乐追踪 | WI-M1 | M2-b | S~M |
| 随行 | 作者文档:三栏各一页"怎么搭"(含现成图模板) | — | 各栏落地 | S |

关键路径:M1 三件事互不依赖,可并行/可分单开工。**建议第一刀切 M1-b**——sound 族
是两栏的共享依赖,也是独立于画廊就有价值的平台能力。

## 7. 决策点(建议已给,待用户拍板)

1. **架构**:三栏继续留在 Gallery 插件,宿主只加中性能力(sound 族、目录只读、
   成员测试)。上一轮的 A/B 分叉按 A 收束——本轮的事实(F1/F2/F6)进一步降低了
   B(提升为一等公民)的必要性。**默认按 A 走。**
2. **语音条目来源**:作者策展,不自动全量。**默认按此走。**
3. **回想返回语义**:按 WI-R2 的"挂起-恢复"设计(内存快照,不写盘)。这是唯一
   建议**动工前过一眼**的设计——它触碰存档语义,错了最疼。
4. **seek 不做**(M1);**页面退出不自动停声**(M1 观察期)。异议请提。

## 8. 风险与开放问题

- ~~**R-1**:read key 与 voiceId 是否同一 id space~~ **已验证一致**（见 F8），
  WI-V4 走快臂。
- **R-2**(动工首日,M1-b 内):`audioManager.playSoundToken` 对 `type: Bgm` 的
  Sound 是否真的照播(设计假设,引擎源码读起来是通的,但没跑过)。若被拦,退路是
  播 `type: Sound` + 手动跟随 bgmVolume 偏好,丑但可行。
- **R-3**(30 分钟,M2-a 前):插件节点 inspector 参数用宿主 `stories` /
  `storyScenes` dynamicOptionsSource 是否直接工作(R-c)。影响 WI-R3 选型。
- **R-4**:回想模式下玩家存档(如果作者没藏掉存档按钮)会存下回想中的状态。
  WI-R2 的 `Is Recollection Mode` 节点是给作者的工具,但宿主要不要硬拦
  (回想模式禁 `game.writeSave`)——建议硬拦并在节点文档写明,实现时确认。
- **R-5**:`startBlockId` 行级回想起点依赖行级 launch 是否在生产 startStory 路径
  可用(现在只确认了 Dev Mode)。不通则 M1-a 只做场景级,行级挪 M2。
