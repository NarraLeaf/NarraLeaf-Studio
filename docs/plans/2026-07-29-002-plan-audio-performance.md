---
title: "plan: 音频表演 —— 场景 BGM、入点/出点、循环/Fade/Seek，以及 Surface 级 sound 能力族"
type: plan
status: done
date: 2026-07-29
branch: feat/story-audio-performance
worktree: D:/Temp/nls-audio
related:
  - 2026-07-29-001-plan-gallery-extra-suite.md  (§3 sound 能力族 = 本卡 M4，本卡取代该节)
---

# plan: 音频表演

## 0. 问题陈述（用户口径）

1. **场景配不了背景音乐**——BGM 只能靠剧情行 `/bgm` 起，场景本身没有"这一场的曲子"这个属性。
2. **资源管理器里标的入点/出点没人读**——`AssetExtras.audioLoop` 只有音频预览器自己写自己读，
   下游（编译器、运行时、蓝图）一处都不消费。
3. **循环 / Fade / Seek 这些 VN 常规需求没真跑过**——命令面有 `fade=`/`loop`，但 `/seek` 只认
   video；场景级 BGM 从来没存在过所以更没验过。
4. **应用界面（Surface）里完全放不出声音**——蓝图宿主 API 八个族里没有一个音频能力。

## 1. 本轮核实的事实（都读过源码，别按旧结论行动）

| # | 事实 | 出处 |
|---|---|---|
| F1 | **引擎 `ISceneUserConfig` 早就有 `backgroundMusic: Sound \| null` + `backgroundMusicFade`**，`SceneAction.initBackgroundMusic` 在场景 init 时播它 | `scene.ts:13-40`、`sceneAction.ts:58-66` |
| F2 | 编译器建 Scene 时只填 `background` / `voices` 两个 key，**BGM 那两个从来没填过** | `storyCompiler.ts:1237-1247` |
| F3 | **`@narraleaf/sound` 的 `PlayOptions` 原生支持 loop region**：`startTime`/`endTime`，且 `loop && endTime !== undefined` 时直接设 `AudioBufferSourceNode.loopStart/loopEnd`——无缝硬件级循环 | `@narraleaf/sound/dist/sound/types.d.ts`、`dist/index.js`（`a.loop=g,g&&p!==void 0&&(a.loopStart=u,a.loopEnd=p)`） |
| F4 | **引擎把 `endTime` 丢了**：`AudioManager` 三处 `channel.play` 只传 `startTime: sound.config.seek`，没有 `endTime` | `AudioManager.ts` `play` / `playSoundToken` / `soundFromData` |
| F5 | `ISoundUserConfig.seek`（"Initial position in seconds"）**就是入点**，已经通到 `startTime`——入点今天就能用，出点不能 | 同上 |
| F6 | **`rate` 在播放时被硬编码成 1**：`channel.play({... rate: 1})`，`Sound.sound({rate: 2})` 静默无效（`setRate` 事后调用才生效） | `AudioManager.ts` 三处 |
| F7 | **`SoundToken.seek(time)` 存在**（07-29-001 的 F3 说"没有 seek"是错的），但引擎没有对应的 action，剧情里够不着 | `soundToken.d.ts`；`actionTypes.ts` 无 `sound:seek` |
| F8 | **`AudioManager.play` 在不循环时会 await 到曲子播完**，而播放器的 `setBackgroundMusic` await 它——所以**场景 config 里放一首不循环的 BGM 会把场景 init 卡到曲子结束**。`/bgm` 逃过一劫只因为 `SceneAction` 那条没 await | `AudioManager.ts:110-117`、`Scene.tsx:54-72`、`sceneAction.ts:242` |
| F9 | `LiveGame.playSound()` 走 `playSoundToken`，**绕开** `Sound.play()` 对 bgm 型的拦截 → 07-29-001 的 R-2 在源码层面成立（仍需真机冒烟） | `liveGame.ts:458-463` |
| F10 | bundleAssembler 已经在读 `assets/assets.metadata.audio.json`（`loadAssetNames`），而且**同一个 assembler 同时服务 Dev Mode 与打包运行时** | `bundleAssembler.ts:224-245`、`gameRuntimeArtifactCompiler.ts:239` |
| F11 | 蓝图 inspector 参数种类有 `imageAsset`，**没有** `audioAsset`；pin 值类型有 `ImageAsset`，没有音频版 | `blueprint-nodes/types.ts:110-127` |

## 2. 引擎改动（narraleaf-react，M1）

四条，都很小，三条是缺陷修复：

- **E1 出点 / loop region**：`ISoundUserConfig` 加 `endTime?: number`（秒），并入内部
  `SoundConfig`（必须是 config 不是 state——state 不参与 `channel.play`）。三处
  `channel.play` 传 `endTime`。语义写进 doc：`seek` = 入点，`endTime` = 出点，
  `loop: true` 时两者构成循环区间（F3）。
- **E2 `Sound.seek(seconds)`**：新 action `sound:seek` → `AudioManager.seek` → `token.seek`。
  撤销记录当前 position 并恢复。
- **E3 `rate` 缺陷**：`channel.play({rate: sound.state.rate})`（F6）。
- **E4 场景 BGM 卡死缺陷**：播放器 `setBackgroundMusic` 改用 `playSoundToken`，不再 await
  整首曲子（F8）。淡出上一首仍然 await。

CHANGELOG 必写（memory `engine-changelog-rule`）。新公开 API → minor 版本。
**`npm publish` 与"把 dist 拷进共享检出的 node_modules"都要先问用户**——后者会影响
并行会话（node_modules 是 junction）。

## 3. Studio：入点/出点的传输通道（M2）

- `shared/types/audio.ts`：`AudioClipRegion = { inMs?: number; outMs?: number }` +
  `normalizeAudioClipRegion()`（含旧 `cuePoints` 兜底——今天这段逻辑只活在
  `loopHistory.fromAssetExtras` 里，抽到 shared 让编辑器与 assembler 共用一份）。
- `DevModeBundle.audio?: GameAudioBundle = { clips: Record<assetId, AudioClipRegion> }`，
  照 `voice` / `localization` 的先例。
- `bundleAssembler.loadGameAudio()` 读音频 shard 的 `extras.audioLoop`（F10 → Dev Mode
  与打包运行时同时受益）。只收非空区间，缺/坏文件静默降级。
- 编辑器预览路径（`compileStagePreviewToNlr`）在渲染层，直接从 `AssetsService` 取 extras。

## 4. Studio：故事内音频（M3）

- **S3-a 场景级 BGM**：`StoryScene.bgm?: StorySceneBgm = { assetId, volume?, loop?, fadeMs? }`
  （加法式，不动 schemaVersion——`camera`/`vfx` 同款先例）。
  - 编译器 `resolveSceneBackgroundMusic` → `config.backgroundMusic = Sound.bgm({...})` +
    `config.backgroundMusicFade`；**`loop` 缺省 true**（与 `/bgm` 一致，也避开 F8 的坑）。
  - `StorySceneUpdate` 加 `bgm`；`storyModel` normalizer、`StoryService.updateScene`、
    scene-editor controller 一路带上。
  - UI：右栏 `storySceneSchema.tsx` 加一块（音频选择 + 音量 + 循环 + 淡入毫秒），
    与 `defaultBackground` 同构。
  - `referenceModel`：`scene.bgm.assetId` 进引用表（"谁在用这个资产"、删资产告警）。
- **S3-b 编译器应用入点/出点**：`/bgm`、`/sound`、场景 BGM 三处都用同一个
  `applyClipRegion(assetId)` 折出 `{seek, endTime}`。
- **S3-c `/seek` 通到音频**：`seek` 命令的 `targetParam(["video"])` → `["video","audio"]` +
  `fallbackKind: "audio"`；新 audio operation `seekSound`（`timeMs`）→ `sound.seek(ms/1000)`。
  目标仍不可省（`/seek 3` 含义太模糊）。

## 5. Studio：Surface 级 sound 能力族（M4）

- 宿主 API 第八族 `sound`（contract 27 → 28）：
  `play` / `stop` / `pause` / `resume` / `setVolume` / `seek` / `isPlaying`。
- 新值类型 `SoundHandle`（`{kind:"soundHandle", id}`），照 `Timer` / `AnimationToken` 的
  token 先例；宿主持 `SoundToken` 注册表。
- 新 pin 值类型 `AudioAsset` + 新 inspector 参数种类 `audioAsset`（F11），
  节点卡上一个音频选择器（复用 `AssetSelector`，无缩略图，显示名字/时长）。
- 节点（`soundNodes.ts`，Game 类目）：`Play Sound` / `Stop Sound` / `Pause Sound` /
  `Resume Sound` / `Set Sound Volume` / `Seek Sound` / `Is Sound Playing`。
  `Play Sound` 的 channel 参数映射 `SoundType`，所以玩家的分轨音量/静音自动生效。
- 运行时实现在 GameApp：`liveGame.playSound(new Sound({src, type, loop, volume, seek, endTime}))`，
  URL 走 `host.resolveStoryAssetUrl(assetId, "audio")`，区间走 M2 的 bundle 表。
  编辑器预览无 liveGame → no-op + 空 handle + 一条 console 警告。
- **页面退出不自动停声**（沿用 07-29-001 §3.1 的结论）：`Stop Sound` 省略 handle = 停掉本族
  经手的全部，作者在 Page 退出事件里自己停。观察真实用法后再决定要不要 per-surface 作用域。

## 6. 验收口径

- 单测：编译器（区间折算、场景 BGM config、`/seek` audio 分支）、bundle 装载、
  节点注册扫描、host bridge。四工程 typecheck。
- **真 app（orchestrator 亲眼，memory `orchestrator-visual-acceptance`）**：
  1. 给一个音频资产标入点/出点 → 场景配上它 → 进游戏：从入点起播，到出点无缝回到入点；
  2. `/vol 0.2 fade=2` 听得出渐变；`/stop fade=1` 渐出；
  3. `/seek music 30` 跳位；
  4. 标题页 Surface 上一个按钮 `Play Sound (bgm, loop)` → 出声、BGM 音量滑条实时生效、
     `Stop Sound` 停得住。

## 7. 真机验收结果（orchestrator 亲眼，2026-07-29）

工程：`D:/Temp/nls-audio-proj`（NLDemo 副本 + 一段刻意分三段的 10s WAV：
0–2s 440Hz / 2–6s 880Hz / 6–10s 220Hz），标记入点 2s、出点 6s。

**探针手法**（值得复用）：音频没法"看"，所以在 Dev Mode 窗口里包 `AudioContext.
createBufferSource` 与 `AudioBufferSourceNode.prototype.start`，事后直接读节点上的
`loop/loopStart/loopEnd`。**注意 `SoundToken` 构造函数里就 `start()` 了，`a.loop=g`
是构造之后才赋的**——所以在 `start()` 时刻抓的快照永远是 `loop:false`，必须事后读节点，
否则会误判成"出点没生效"（我第一轮就误判了一次）。

通过：
1. 资源管理器标入/出点 → `extras.audioLoop {inMs:1997, outMs:6003}` 落盘；
2. 右栏「场景音乐」选中 theme.wav，提示读出 **"Loops 2.0s – 6.0s"**；音量/循环/淡入三项持久化；
3. 真游戏进场景：BGM 自动起播，**`offset:1.997`（入点）**，节点上
   **`loop:true, loopStart:1.997, loopEnd:6.003`**（buffer 10s），AudioContext `running`
   且时钟推进 → 入点/出点真正到了音频硬件。

**没能亲眼跑到的**（诚实记录）：
- `/vol` `/seek` `/stop` 的运行时效果：NLDemo 这个工程的对话框在本次构建里报
  `Unsupported type: nl.dialog.nametag`，点击/键盘都推不动剧情，够不到那几行。
  编译层与引擎层各有单测覆盖。
- Surface 蓝图 sound 族在调色板里的样子：右键没能唤出节点面板（时间盒到此），
  覆盖靠 `builtinBlueprintNodes.test.ts` 的 Play Sound → Stop Sound 全链路图执行 + 注册扫描。

## 8. 真机跑出来的两个缺陷（都已修）

- **右栏不因音乐改动而重发布**：`StorySceneEditorTab` 的 `sceneMeta` 签名只含
  name/description/background，不含 `bgm`。后果不只是显示过期——音乐控件按字段增量
  patch（`{...bgm, ...next}`），所以**改音量会把刚设的淡入写回旧值抹掉**。
  签名补上 `scene.bgm`，并在注释里写死"每个进右栏的场景字段都必须进这个签名"。
- **`/vol` `/seek bgm` 够不到场景配的 BGM**：控制族默认目标是保留名 `bgm`，而它只由
  `/bgm` 行注册。场景配了音乐的场景反而收到"没有背景音乐"告警。现在编译期把场景的
  `Sound` 预登记进该场景的 registry。

## 9. 已知取舍

- 出点循环只在解码路径（`AudioBufferSourceNode`）成立；`HTMLAudioElement` 流式播放只有
  朴素 `loop`。引擎 `AudioManager` 总是先 `sound.load()` 解码再播，所以现状恒走解码路径——
  但如果哪天引擎开了 streaming，区间会静默退化成整曲循环。记录在案。
- 存档恢复的 loop 锚点问题**已在引擎侧解决**：`soundFromData` 对带区间的循环曲从入点起播
  再 `token.seek(position)`（该 seek 会重建 source 并保留 loopStart/loopEnd）。
- 页面退出不自动停声（M1 观察期）；`Stop Sound` 省略 handle = 全停。

## 10. 引擎发布

`narraleaf-react` **0.21.0**（出点/loop region、`Sound.seek`、rate 缺陷、场景 BGM 卡死）
与 **0.21.1**（存档遇到本故事没有的 sound 时不再整档加载失败）已发 npm 并推上
`dev_nomen`；Studio 依赖已提到 `^0.21.1`。该仓不用 tag。

## 11. 与 develop 上并行实现的 sound 族的合并（2026-07-29）

收尾时发现 develop 已经并入了另一条会话做的 `sound` 能力族
（`36a62145` Merge feat/gallery-extra-suite）。设计几乎完全撞车——同样的 handle 信封、
同样的"接线优先于选择器"、同样"走引擎 mixer 而不是 `<audio>`"的理由——但它是 **5 个节点**，
且 gallery EXTRA 的运行时已经依赖它的确切形状（`BLUEPRINT_SOUND_PARAM_ASSET`、
`normalizeBlueprintSoundChannel`、`soundTransport.ts`）。

**取舍：以它为基底，把我这边多出来的东西叠上去**，不覆盖别人的工作：

- 保留它的模块、命名、`BlueprintSoundPlayInput`、`soundTransport.ts`；
- 补 `Set Sound Volume`（音量+淡变一个节点，所以它同时就是 fade 节点）与 `Seek Sound`，
  连带 `sound.setVolume` / `sound.seek` 两个能力（contract 28 → 29）；
- **补入点/出点**：`createSound` 的注入点加 `assetId`，GameApp 折进 bundle 的区间表，
  于是音乐页和剧情行循环同一段 body；
- **修一个静默缺陷**：它的 `stop` 传 `{fade}`，而 `StopOptions` 的键是 `fadeDuration`
  —— 淡出一直是空操作。已改。
- 音频选择器加"in/out"角标：区间是在别处（资源管理器）决定的，节点得说出它有没有。

`graph.ts` / `index.ts` / `graphParamResolvers.ts` 三处 git **无冲突地合出了重复声明**
（两边加了同名常量/同名 import 行，位置不同）——**这类撞车不会报冲突，只会 typecheck 报
duplicate identifier，合并后必须跑一遍五工程 tsc**。
