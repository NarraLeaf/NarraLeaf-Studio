# 配音模块（Voice）完成度评估与商业 VN 引擎差距分析

分支 `feat/voice-depth`，从 `origin/develop`（`29b03444`）切出。本文只做**评估**，
不含实现；结论按「已成立的事实 / 六个真实缺陷 / 与商业 VN 的功能差距 / 建议顺序」四段组织。
每条断言都给了代码位置，能实测的都实测过（本文出现的两处 `实测` 是真跑出来的输出）。

## 0. 一句话结论

**骨架是对的，管线是通的，但它只在「单语配音 + 拉丁字母命名 + 小体量」这三个条件同时成立时才真正工作。**
三者任何一个不成立——日文/中文的场景名与角色名、两条以上配音语言、上万条语音——
模块要么静默失效，要么产出一个作者永远不会发现自己没在用的功能。

已经货真价实的部分：一条身份贯穿正文/翻译/语音（`textId` = `unitId` = `voiceId`）、
四态派生（missing/linked/approved/stale）而 stale 永不落盘、
每条 take 按说话人路由到角色自己的音频总线、三条 lint 规则、冻结（VCS）时只读而非禁用、
故事行上的试听与跳转。这些是引擎级的设计质量，不是玩具。

缺的不是「再加几个按钮」，缺的是**配音作为一条生产线的后半段**：
回内容（导回、重录、增益）、多语言真正可播、以及规模。

## 1. 现状全景

| 层 | 位置 | 状态 |
| --- | --- | --- |
| 数据模型 | `src/shared/types/voice.ts` | `app.voice = {voicedLocales, namingPattern, cast}`；`editor/voice/<locale>.json` = `{units: {[unitId]: {assetId, sourceHash, status, duration?, note?}}}` |
| 文档规格 | `src/shared/documents/specs/voice.ts` | 已并入 document 模型（原子写、损坏隔离、autosave） |
| 服务 | `src/renderer/lib/workspace/services/voice/` | `VoiceService` + 纯函数 `voiceModel` / `voiceScript`，39 个单测全绿 |
| 侧栏 | `modules/voice/VoicePanel.tsx` | 语言增删、覆盖率、导出录音本/补录本、批量导入音频 |
| 编辑器 tab | `modules/voice/VoiceEditorTab.tsx` + `VoiceRows.tsx` | 场景轴/角色轴、assign/audition 双模式、筛选、CV 名 |
| 故事编辑器 | `scene-editor/{StoryVoiceIndicator,useStoryVoiceState,voiceAudition}` | 有 take 的行显示试听 + 跳转，只读 |
| 角色编辑器 | `properties/fields/CharacterVoiceTrackField.tsx` | 角色语音落在 `voice` 子树的哪条总线 |
| lint | `lib/lint/rules/voice.ts` | `voice/missing`、`voice/stale`、`voice/orphan` |
| 编译 | `runtime/game/storyCompiler.ts:267-346` | `buildSceneVoiceMap` + `buildSceneVoices`（按说话人包 `Sound.voice({type: bus})`） |
| 打包 | `devMode/pipeline/bundleAssembler.ts:463-498` | `loadGameVoice` 把**全部**语言的 unitId→assetId 表塞进 bundle |
| 引擎 | narraleaf-react 0.23.1 | `Sentence.config.voiceId` + `Scene.config.voices`、`voiceVolume`/`voiceEndMode`/`voiceFadeDuration`、`useVoiceState` 钩子 |

## 2. 六个真实缺陷

### D1｜CJK 命名下批量导入匹配 **0 个文件**（最严重）

反向匹配靠 `matchKeyForFilename`，它把文件名压成
`withoutExt.toLowerCase().replace(/[^a-z0-9]+/g, "")`
（`src/shared/utils/voiceNaming.ts`）——**没有 unicode 意识，非 ASCII 字符全部被删掉**。
默认命名模式是 `{scene}_{index}_{character}`，于是一个日文工程：

```
实测（vitest，本轮跑过）：
  序章_001_優希    -> key "001"
  第一章_001_優希  -> key "001"
```

`buildVoiceNameKeyMap`（`voiceScript.ts:71-99`）对撞 key 的处置是**两条都丢**
（"a silently ambiguous match is worse than an unmatched file"，这个决定本身是对的），
`index` 又是**每场重新计数**的，所以只要工程有两场以上戏，
**每一个 key 都会撞，keyMap 变成空表，`VoicePanel.tsx:351` 的 `keyMap.get(...)` 全部落空**。

作者看到的是：导出录音本 → 交给录音棚 → 收回一批 `序章_001_優希.wav` → 批量导入 →
提示 "linked 0, unmatched 87"。而**日文/中文正是配音 VN 的主战场**。
只有单场戏的 demo 工程会「碰巧」成功，这也是它至今没被发现的原因。

### D2｜配音只认**源语言**文本，多语配音在结构上是错的

`extractVoiceableRows` 复用了本地化的行提取器，拿到的 `sourceText` 是
**故事的源语言正文**（`localizationModel.ts:40,110`）。配音模块从不与翻译表联结。后果：

- 配音表和录音本 CSV 的 `line` 列，对 `ja` 配音显示的是**英文（源语言）原句**，
  哪怕工程里已经有完整的日文翻译。录音棚拿到的稿子是错的语言。
- 过期判定 `deriveVoiceUnitState(unit, row.sourceText)` 比对的也是源文本：
  **改日文翻译不会让日文 take 变 stale**；改英文源句会让**所有**语言的 take 一起 stale，
  即使对应翻译一个字没动。

配音语言与字幕语言"故意解耦"这个设计前提没问题，但解耦不等于无关——
一条 `ja` 配音的**台本文本**应当取自 `ja` 本地化表（缺则回落源语言），
过期判定同样应当按那条文本算。现在这层联结完全不存在。

### D3｜多条配音语言事实上**播不出来**

- 编译期烘焙：`buildSceneVoiceMap`（`storyCompiler.ts:273`）一次性读
  `getVoiceLocale()` 并只解析那一门语言的表。注释写得很清楚"switching voice language is a recompile"。
- 运行期读取：`GameApp.tsx:1236-1248` 从持久化键 `nls.voiceLocale` 读，非法值回落 `voicedLocales[0]`。
- **没有任何东西写这个键**。全仓 grep 只有这一处读。文本语言有
  `localization.setLocale` 蓝图节点（`BlueprintHostApiBridge.ts:2641-2654`），配音**没有对应物**。
- 即便手工写进去，也不会重编译——`GameApp` 只在会话挂载时编译一次。

所以：**配了两门配音语言，第二门是死数据**——它的音频照样进包（`loadGameVoice` 无条件塞全部语言的表），
体积照付，玩家永远听不到。整个 `voicedLocales` 是复数结构，可播的只有 `[0]`。

### D4｜三个「实现了一半」的字段，三条都是死路

| 东西 | 写了什么 | 谁在用 |
| --- | --- | --- |
| `parseVoiceCsv`（`shared/utils/voiceCsv.ts:40`） | 完整 RFC4180 解析 + 必需列校验 + 8 个单测，文件头注释说它是给"re-importing status/notes"用的 | **只有自己的测试**。UI 里没有任何导入 CSV 的入口 |
| `VoiceUnit.note` | 模型有、CSV 有 `note` 列、`VoiceUnitPatch.note` 有 | **没有任何调用方传 note**（全仓 `updateUnit` 调用点 5 处，无一带 note）。导演批注只能从项目外走 |
| `VoiceUnit.duration` | 模型有、patch 有 | **从没被写入过**。没有音频解码，时长永远 undefined |

所以 CSV 是**单向**的：出得去，回不来。录音棚在表里填的备注、状态、重录标记，
没有任何通路能回到工程。这是配音生产线上最常走的一条路，现在断了。

### D5｜命名模式不可编辑，且 token 名与类型不符

- `namingPattern` 存在 `.nlproj`，**没有任何 UI 能改它**（全仓只有 `VoicePanel` 两处读取）。
  想换成不会踩 D1 的 `{unit}`，只能手改工程文件。
- `VoiceNameTokens` 的字段叫 `unitId`，但 `formatVoiceFilename` 的替换表键是 `unit`
  （`voiceNaming.ts`）。**实测**：`{unitId}` 原样输出字符串 `"{unitId}"`，`{unit}` 才展开成 `t-1`。
  文档注释里写的是 "Stable translation-unit id (story textId)"，指向的正是那个不生效的拼法。

### D6｜规模：配音表不虚拟化，侧栏覆盖率全量重算

- `VoiceEditorTab.tsx:517` 是 `groups.map(...)` 直接铺 DOM。仓库里已经有
  `@tanstack/react-virtual`（故事编辑器、lint 报告、测试报告都在用），配音表没接。
  商业 VN 一门语言 1–3 万条语音，这个表会直接卡死。（本地化表同样没接，属同类债。）
- `VoicePanel.tsx:129-158`：`onDocumentChanged` 一触发就**重新加载全部故事、重新抽取全部可配音行**。
  作者在故事编辑器里敲字时，每次文档变更都会跑一遍全工程扫描。
- 覆盖率 effect 又依赖 `rows`，于是上一条的结果会连锁触发**每门语言**重算一次。

## 3. 与商业 VN 引擎的差距

分档标准：**必须有** = 商业配音 VN 出货前绕不过去；**应该有** = 缺了会显著拖慢制作；
**加分** = 有会显得专业。已具备的一并列出，避免把已有的当缺口。

### 3.1 玩家侧（运行时）

| 能力 | 状态 | 依据 |
| --- | --- | --- |
| 语音音量滑条（含**每角色**分轨） | ✅ 已有 | 音频总线树 + `CharacterVoiceTrackField`；引擎 0.23.1 起 `voiceVolume` **就是** `voice` 总线 |
| 换行时结束语音（stop/fade/none 可选） | ✅ 已有 | `characterAction.ts:35-42` `endVoiceWithPreference` |
| 撤销/回退时停语音 | ✅ 已有 | `characterAction.ts:167-173` |
| **自动模式等语音播完** | ❌ **必须有** | `UIDialog.tsx:203-210` 只用固定 `autoForwardDelay`。引擎导出了 `useVoiceState().done`，但内建对话框**没有消费它**——自动播放会在语音说到一半时翻页 |
| **回想录（backlog）重播语音** | ❌ **必须有** | 回想条目**带** `voice` 字段（URL），但 `Play Sound` 节点要的是 `assetId`（`soundNodes.ts:278`，宿主 `createSound({assetId})` 去解析 URL）。两半接不上，作者拼不出重播按钮 |
| **重播当前行语音**（对话框上的小喇叭 / R 键） | ❌ **必须有** | 引擎有 `useVoiceState().playVoice`，Studio 的 widget/蓝图两侧都没有暴露口 |
| **游戏内切换配音语言** | ❌ 见 D3 | — |
| 选项（menu）语音 | ❌ 应该有 | 引擎 menu 无语音槽；`extractVoiceableRows` 也只收 narration + dialogue |
| 「已听过的语音」标记 / 只跳已读 | ⚠️ 一半 | Studio 有 `textReadTracker`（键就是 `textId`，与 voiceId 同一空间），但引擎没有 skip-read-only 模式，也没有按语音的已听态 |
| 语音字幕同步（逐字/逐句时间码） | ❌ 加分 | 无时长信息（D4），谈不上 |
| 口型同步（Live2D/Spine 嘴部） | ❌ 加分 | 全仓无 lipsync 任何痕迹；puppet 接缝已在，但没有振幅→参数的通路 |

### 3.2 制作侧（编辑器）

| 能力 | 状态 |
| --- | --- |
| 台本导出（含 unitId、场景、说话人、状态） | ✅ 已有，CSV |
| 补录本（只导 stale） | ✅ 已有 |
| 批量导入按文件名回连 | ⚠️ 有，但 CJK 下匹配率 0（D1） |
| 拖拽/选择器逐条指派、试听、批准/打回 | ✅ 已有 |
| 场景轴 / 角色轴双视图 + CV 名 | ✅ 已有 |
| 缺失/过期/孤儿 lint | ✅ 已有 |
| **导演批注回流**（CSV 导回） | ❌ 必须有，D4 |
| **重录版本 / 多 take 管理** | ❌ 必须有——一个 unit 只能挂一个 assetId，没有 take 历史、没有 A/B 对比 |
| **逐条增益微调** | ❌ 必须有——各条 take 电平不齐是常态。引擎支持 `Sound.voice({volume})`，模型里**没有** volume 字段 |
| **时长 / 总时长 / 字数-时长比** | ❌ 应该有，D4 |
| 波形显示、区间试听、静音裁切 | ❌ 应该有 |
| 响度（LUFS）归一化与 QC 报告 | ❌ 加分 |
| 批量操作（全选、批量批准、批量解链） | ❌ 应该有——现在只能逐行 hover |
| 命名模式可配置 | ❌ D5 |
| 语义 diff（VCS 里看懂一次配音变更） | ❌ 只有 `charactersDiff` / `storyDiff` 两个语义规格，voice 走结构化 JSON diff，展示为 `units.<hash>.assetId` |

### 3.3 工程侧（构建/发行）

| 能力 | 状态 |
| --- | --- |
| 语音资产随包发行 | ✅（走通用资产管线，含加密） |
| **按语言拆分语音包 / 按需下载** | ❌ 应该有——`loadGameVoice` 无条件带上全部语言。一个双语配音 VN 会把两套音频都装进每个安装包 |
| 构建期转码/压缩（wav→opus 等） | ❌ 应该有——`src/main` 全仓无转码，作者导入什么就发什么 |
| 未使用语音剔除 | ❌ 加分 |

## 4. 建议顺序

**P0（正确性，不做等于功能是假的）**

1. **D1**：`matchKeyForFilename` 改成 unicode 感知（`\p{L}\p{N}` + `u` 标志，配 NFKC 归一化），
   并在压出空 key 时回落到 `{unit}`。附一个 CJK 回归测试。
2. **D2**：录音本与配音表的 `line` 取该配音语言的本地化译文（缺则回落源文），
   `sourceHash` 同步改按那条文本算。**这会让存量 hash 全部失效**——需要一次迁移或一条
   「按新口径重新盖章」的显式动作，不能静默。
3. **D3**：`voice.setLocale` 蓝图节点 + 换语言后重新编译并重挂 NLR 会话
   （文本语言是运行期解析所以不用重编，配音必须重编，这个不对称要在节点文档里写明）。
   在此之前，侧栏应当明确提示第二门起的语言"当前不可播放"。

**P1（生产线闭环）**

4. **D4**：CSV 导回（状态 + 备注 + 重录标记）；配音表加备注列；导入时解码取时长。
5. 逐条增益（`VoiceUnit.volume` → `Sound.voice({volume})`，编译期已有包 `Sound` 的通路）。
6. **自动模式等语音**（引擎侧：`UIDialog.scheduleAutoForward` 消费 `useVoiceState().done`）
   与**回想录重播**（把 backlog 条目的 `voice` 换成 `unitId`/`assetId`，或给 `Play Sound` 加 URL 入口）。
   两条都要动 narraleaf-react，走 CHANGELOG + 发版。

**P2（规模与打磨）**

7. **D6**：配音表接 `@tanstack/react-virtual`；侧栏覆盖率改增量（按 storyId 缓存行集）。
8. **D5**：命名模式做成设置项，并修 `{unitId}` token。
9. 多 take / 重录历史、波形、响度 QC、按语言拆包与转码。

## 5. 本轮做过的验证

- 只读研究，未改动任何产品代码（临时的 scratch 测试已删除）。
- 配音相关 39 个单测全绿：`voiceCsv` 8、`types/voice` 5、`voiceScript` 4、`voiceModel` 7、`lint/rules/voice` 15。
- D1、D5 的两处 `实测` 是在本工作树跑 vitest 打印出来的真实输出，不是推演。
