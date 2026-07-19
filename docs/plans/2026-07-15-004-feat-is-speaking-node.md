---
title: "feat: Is Speaking 节点 + NLR 当前说话者 API"
type: feat
status: draft
date: 2026-07-15
---

# feat: Is Speaking 节点 + NLR 当前说话者 API

## Overview

需求的表层是一个蓝图数据节点：**Is Speaking** —— 卡片上一个角色下拉框，输出「此人是否正在说话」。

但它落地需要的东西，绝大部分不在节点里，而在一条 Studio 今天**根本不存在**的链路上：**运行时没有任何办法知道「谁在说话」**。

现状是四层 hack 叠在一起，且**每一层都只产出显示名字符串**：

1. `LiveGame.lastDialog.speaker` —— NLR 未公开的私有属性，Studio 靠 `nlrDialogReaders.ts` 结构化 cast 走私（NLR 一改名就静默降级，无类型错误）
2. `currentDialogNametagRef` —— `onCharacterPrompt` 事件填充的 ref，边沿触发、会跨 session 走味
3. `BLUEPRINT_GAME_NAMETAG_STATE_KEY` —— `DialogStateBridge` 推进 blueprint scope 的镜像
4. `useDialog().isNarrator` —— 因为 `lastDialog.speaker` 分不清旁白与无名角色，narrator 判定得单独再问一次

四层之上没有 characterId，只有**本地化之后**的显示名（`GameApp.tsx:1564`）。所以「角色下拉框选 UUID → 和当前说话者比较」这条路今天**在任何一层都接不上**。

本计划打通这条链路：NLR 侧新增一个正统的公开 API，Studio 侧用**引用相等**把 NLR 的 Character 实例反查回 characterId，然后在其上实现 Is Speaking 节点。

## 1. 目标与非目标

### 目标

1. NLR 新增 `liveGame.getCurrentSpeaker(): Speaker | null` —— 统一 ADV/NVL，能区分「没人说 / 旁白 / 角色 X」三态。
2. Studio 编译器导出 `characterId → Character` 实例表，host 侧反转为 `WeakMap<Character, characterId>`。
3. Studio 新增 host API `game.getSpeakingCharacter()`，返回 `{ kind: "none" | "narrator" | "character", characterId? }`。
4. 新增 `Is Speaking` 蓝图节点（pure，category `Game`）+ `characters` 动态下拉源。
5. NLR CHANGELOG / version bump / NarraLeaf.com 文档。

### 非目标

- **不给 NLR 的 `Character` 加 id 或 metadata**。见 §3.1 —— 引用相等在这条链上恒真且免费，加 id 反而更贵。
- **不改 DevTools**。`DevTools.getCurrentDialog()` 是调试面，不承载生产逻辑；LiveGame 才是正统落点（已确认）。
- **不扩 `valueBindings` 支持 boolean / `layout.visible`**。见 §5.2 —— 这是本节点最可能的预期用法，但它是一个独立的、更大的缺口。
- **不修 `LiveGameEvent` 的 stripInternal 类型 bug**。见 §6 —— 真实缺陷，但新 API 不依赖 `onCharacterPrompt` 的类型，不该混进来。
- **不拆除现有四层 nametag hack**。新 API 让它们可以被收敛成一层，但那是独立的清理，不在本计划里。

## 2. 硬约束

1. **pure 节点的 `execute()` 从不被调用。** `executeGraph` 只跟 exec 边（`GraphExecutor.ts:55-180`），`isPure` 在 `behavior-graph/` 里零出现。pure 节点的值来自 `graphParamResolvers.ts` 的**硬编码 resolver 分支**。`Get Nametag` 的 `execute`（`gameNodes.ts:461-467`）是死代码 —— `frameNodes.ts:199-219` 干脆写成 `execute: () => ({})` 明示这一点。**漏了 resolver 分支，节点恒返回 `undefined` 且无任何报错。**
2. **`resolveGameNodeOutput` 当前不接收 params。** 签名在 `graphParamResolvers.ts:1361-1365`，按 **portId** 分派。必须扩签名把 `selfNode.params` 透进去，且输出引脚 id 必须唯一（用 `isSpeaking`，绝不复用 `nametag`）。
3. **不需要新的 invalidation bridge。** `refreshAll`（`BlueprintValueRuntimeStore.ts:330-339`）是 **key-agnostic** 的 —— 任意 `globalSet` 重算所有 value graph。而 `GameApp.tsx:1566` 已经在每次说话者变化时 `globalSet` nametag。镜像键是时钟，host API 是值源；蹭现成的时钟即可。
4. **Narrator 不能用身份比较。** `Narrator = new Character(null)`（`character.ts:281`），`state.name === ""`。引擎的规范判定是 duck-typed：`character === null || character.state.name === ""`（`useDialog.tsx:42-43`）。身份比较会在三处翻车：与引擎自身判定不一致、`new Character("")` 与 Narrator 不可分、模块重复加载时 Narrator 单例会分裂（Studio 有 esbuild aliasing 与 runtime i18n shim）。**判定必须在引擎内部用规范规则算，随 `type` 标签一起给出。**
5. **引用同一性只在单次编译内有效。** 重编译造全新 Character 实例。`compiled` 按 session 存（`GameApp.tsx:776`）、session 随重编译重建 —— 结构上自洽，但反向表必须经**当前 session 的** `compiled` 解析，绝不能捕获旧引用。用 `WeakMap` 让旧表随 session 自动 GC。
6. **UUID 绝不能进 UI。** 下拉框 `value` = characterId UUID，`label` = `profile.getName()`。这是既有硬规则（`displayableTarget.ts:48`：「a character with no stage name keys on its `characterId`, which is a UUID and must never reach the UI」）。
7. **NLR `src/` 是 CRLF，`CHANGELOG.md` 是 LF，且仓库无 `.gitattributes`。** 有专门的 normalize commit（`9ba7183`）为证。改错行尾会污染整个文件的 diff。
8. **production 与 Dev Mode 是同一条路径。** `compileStudioStoryToNlr` 全仓库唯一非测试调用点是 `GameApp.tsx:651`，而 `src/runtime/renderer/GameRuntimeApp.tsx:10` 直接复用 GameApp。打包的是 `StoryDocument` **JSON**，在 renderer 里实时编译 —— **序列化边界在编译之前，不在之后**。这是引用相等方案成立的前提。

## 3. 核心模型

### 3.1 为什么是引用相等，而不是把 UUID 塞进 NLR

最终比较的**确实是 UUID**。引用相等只是把 NLR 的 `Character` 实例反查回 UUID 的手段。

链条：

```
Studio 编译期                          NLR 运行期
─────────────                          ──────────
getCharacter(ctx, characterId)
  └─ ctx.characters.get(characterId)   ← 同一 id 永远返回同一实例（map 缓存）
  └─ new Character(displayName)
        │
        └─ character.say(...)
             └─ sentence.setCharacter(this)      character.ts:152
                   │
                   └─ sentence.config.character  ← 直接引用透传，无 clone、无 proxy
                         │
                         └─ gameState.ts:472 / characterAction.ts:95
                               emit { character }  ← 就是编译期那个裸实例
```

已双端核实：`emittedCharacter === ctx.characters.get(characterId)` **恒真**。

反向方案（`CharacterConfig.id`）更贵：`config` 标了 `@internal` 且 `tsconfig.json:43` 开了 `stripInternal`，**消费者读不到 `character.config.id`** —— 得额外加公开 getter，NLR 公开面反而变大；而 NLR 作为通用引擎并不需要知道 Studio 的 UUID 概念。

反讽：`GameApp.tsx:1563` **已经**拿到了活的 Character 实例，下一行就 `readNlrCharacterName(character)` 把它降解成本地化字符串扔掉。对象 identity 当场可得、当场被丢弃。

### 3.2 三态与下拉框

NLR 侧返回 discriminated union，narration **不**用 `null` 表示（否则与「没人说话」不可分）：

```ts
type Speaker =
    | { type: "narrator"; character: Character }
    | { type: "character"; character: Character; name: string };

liveGame.getCurrentSpeaker(): Speaker | null;   // null = 当前没有对话
```

`name` 从 `character.state.name` 提到外层，因为 `state` 是 `@internal` —— 公开 API 不该逼消费者去够内部字段。

下拉框（`value` → 判定）：

| 选项 | value | 判定 |
|---|---|---|
| `-`（默认） | `""` | `speaker !== null` —— 任何对话在显示，含旁白 |
| `Any Character` | `"@any"` | `speaker?.type === "character"` |
| `Narrator` | `"@narrator"` | `speaker?.type === "narrator"` |
| 具体角色 | `<uuid>` | `speaker?.type === "character" && idOf(speaker.character) === uuid` |

`@` 前缀是哨兵，UUID 不会与之碰撞。

> **开放决策 D1：`-` 的语义。** 上表取「任何对话在显示（含旁白）」，理由是这样三档互不重叠且各自有用，`-` 不是无意义的「未配置」态。但 `-` 在其余节点里一律表示未选（`emptyOptionLabel` 默认值）。若倾向「未配置」语义，则 `-` 应恒返回 `false` 并在编辑器加校验警告 —— 注意 pure 节点走 resolver 路径，**不能 throw**，`localizationNodes.ts:139` 那种 `BlueprintGraphExecutionError` 在这里用不了。

### 3.3 为什么 NLR 必须扩展

`onCharacterPrompt` 已经带真 Character 对象（payload `{ character, sentence, text }`，`liveGame.ts:28-41`），ADV/NVL 都覆盖。但它**边沿触发、无配对结束事件、undo/读档不重发**（`characterAction.ts:178-182` 只静默还原 `lastDialog`）。靠它维护「当前」状态在回滚下必然残留脏值。

而状态侧今天是缺的一半：ADV 的 `getAdvDialogState()` **不带 character**，NVL 的 `NvlDialogEntry` 反而带（`gameState.ts:41-47`）。所以缺口只在 ADV。

**好消息：三态可能无需新 bookkeeping。** `gameState.state.texts`（`gameState.ts:76`）是 `Clickable<TextElement>[]`，push 在 `:489`、完成时 splice 在 `:483-486` —— 最后一个 entry 的 `.character` 即「当前谁在说」，空数组即「没人说」。NVL 模式因为保留已完成的行，需改用 `nvlState.activeDialogId`。

> **实现期必须复核 D2：** `state.texts` 与 `getAdvDialogState()` 是两套不同的状态。动手前先确认 `texts` 在 undo/读档/skip 下的行为是否真的正确 —— 若不成立，退回到「给 `AdvDialogState` 加 `character` 字段 + `beginAdvDialog` 传参」的方案（4 文件增量，`characterAction.ts:145` 作用域内 `sentence` / `this.callee` 全都现成）。

## 4. 实现计划

### Phase 1 — NLR（`/Users/nomen/Documents/dev/org/NarraLeaf-react`）

1. `src/game/nlcore/game/liveGame.ts` —— 新增 `getCurrentSpeaker(): Speaker | null`，narrator 判定复用引擎规范规则（见硬约束 4），使其与 `useDialog` 不可能分歧。
2. 导出 `Speaker` 类型（`common/game.ts`）。**不加 `@internal`** —— `LiveGameEvent` 就是因此在 d.ts 里变成 dangling ref（§6）。
3. `CHANGELOG.md` —— 追加 `## [0.14.0]` / `### _Feature_`，散文风格 + ts 示例（对齐现有条目）。**LF 行尾。**
4. `package.json` 0.13.0 → 0.14.0。

改动是**纯增量**，无 breaking change。

### Phase 2 — Studio 编译器 + host API

5. `storyCompiler.ts` —— `CompiledNlrStory`（`:171-181`）加 `characters: Map<string, Character>`；`compileStudioStoryToNlr` 的 `characters` 变量在 `:299` 声明、`:360` return 处仍在作用域内，**加一行**即可。`compileStagePreviewToNlr` 同理（`:432` / `:565`）。先例同构：`CompiledSceneElements`（`:164-169`）已经是「name → 活 NLR 实例」查找表。
6. `gameUiSlots.tsx` —— `createLiveGameUiCallbacks` 加 `getSpeakingCharacter`，内部持 `WeakMap<Character, string>`（由 `compiled.characters` 反转而来），调 `liveGame.getCurrentSpeaker()` 后反查。
7. `StageSlotSurfaceShell.tsx` / `GameApp.tsx` / `useStoryPreviewGameUi.ts` —— 按既有 `on*` 回调形状穿线。`compiled` 正好在 `slotHostOptions` 构造作用域内（`GameApp.tsx:688-746`）。
8. `BlueprintHostApiBridge.ts` —— `game.getSpeakingCharacter()` 三处（runtime 类型 ~253、options ~299、impl ~1315）。
9. `hostApi.ts` —— capability 描述符 + contract version 24 → 25（`:2`，纯文档性，无人比较）。

### Phase 3 — 节点与下拉框

10. `@shared/types/blueprint/graph.ts` —— `BLUEPRINT_NODE_TYPE_GAME_IS_SPEAKING`。
11. `gameNodes.ts` —— 节点定义：`isPure: true`、`isLatent: false`、`category: "Game"`、`graphKinds: ["event","function","macro"]`、单 bool 输出引脚 `isSpeaking`、`inspectorParams: [{ key: "characterId", kind: "select", dynamicOptionsSource: "characters" }]`。
    - ⚠ **`isPure: true` + `dynamicOptionsSource` 无先例**（现有 dynamic 下拉全是 latent/非 pure）。两者类型上正交、无规则耦合，但这是第一例，需实测下拉框在 pure 节点卡片上正常渲染。
12. `graphParamResolvers.ts` —— 类型闸门（`:2341-2347` 邻域）+ `resolveGameNodeOutput` 分支（`:1361-1380`）+ **扩签名透传 params**（硬约束 2）。
13. `BlueprintEntryTab.tsx:1407-1418` —— `characters` 动态源，由 `characterService.listCharacter()` 构造。**响应性**：`:1352` 的 `useMemo` 依赖不含角色，需接 `CharacterService.subscribe`（`CharacterService.ts:222`）+ revision counter（样板：`useStorySceneEditorController.ts:156`）。
14. i18n —— `en/blueprint.ts:512` + `zh/blueprint.ts` 的 `node:` 块，**以及 `blueprintNodeI18n.ts:20` 的 `NODE_TITLE_KEYS`**（按英文 displayName 字符串索引；**无测试覆盖，漏了会静默 fallback 成英文**）。
15. `builtinBlueprintNodes.test.ts` —— **三处** game mock 都要补（`:319`、`:436`、`createGameSaveHostAdapter` `:540`），否则 typecheck 挂。

### Phase 4 — 文档（`/Users/nomen/Documents/dev/org/NarraLeaf.com`）

16. `content/docs/narraleaf-react/core/game/live-game.en.mdx` + `.zh.mdx` —— `## Public Methods` 下加 `### getCurrentSpeaker`，套 `<Steps><Step>` house style。
17. 若 `Speaker` 需独立类型页：`core/types/Speaker.{en,zh}.mdx` + **两个** `meta.json`（`.json` 和 `.zh.json` 都要，否则该语种导航缺失）。
18. ⚠ 注意 BOM：`live-game.en.mdx` 等文件带 UTF-8 BOM，**须保留**。
19. `info/incompatible-changes.*.mdx` —— **不动**，本次纯增量无 breaking change。

> 文档站现状：pin 的是 `narraleaf-react` 0.9.0，`incompatible-changes` 最新条目也是 0.9.0，而 Studio 已在 ^0.12.3 —— **0.10~0.12 全未文档化**。新页会落在一片过时的邻居中间。这是既有欠账，不在本计划范围，但写的时候会看到。
>
> 另：`/Users/nomen/Documents/dev/org/react.narraleaf.com` 已废弃（HEAD 就是 deprecation banner），**不要改**。

## 5. 已知限制

### 5.1 编译器的 character map 是惰性的

`getCharacter()` 只在 block 引用到某 characterId 时才建实例。对「X 是否在说话」无害（没说过话就不可能是说话者，miss 即 `false`）。但若将来有节点想**枚举全部角色**，这张表不完整。另有 `__unknown_character__` 兜底（`:1369`）。

`compileStagePreviewToNlr` 只编单个 scene，其表仅含该 scene 的角色 —— 预览里选别的 scene 的角色恒 `false`。可接受。

### 5.2 ⚠ 最可能的预期用法今天不可达

**widget 的 `visible` 无法绑定到 blueprint value graph。** 两套绑定系统都堵死：

- `bindings`/widgetProp 能管 `layout.visible`（`BindingEvaluator.ts:35-40`），但 source **必须**是 `kind:"field"`（`:82`），`valueSource` 只有 surfaceState/globalState/listItem/listIndex/listCount —— **没有 graph**。
- `valueBindings` 能跑真 graph，但 `SUPPORTED_VALUE_TARGETS`（`BlueprintValueRuntimeStore.ts:152-175`）只有 `nl.text.text` / `nl.button.label` / `frame.params` / `nl.slider.value`，且 `UIElementValueBindingValueType` 只有 `"string"|"json"|"float"` —— **没有 boolean，没有 `layout.visible`**。

现实消费路径：widget-main 蓝图里 `On Flush` → `Is Speaking` → `Set Visible`。但 flush-on-speaker-change **只到 dialog slot**（`DialogStateBridge.tsx:25` → `flushSlotElements` → 仅该 slot 的 `collectSurfaceFlushElementIds`）—— **其他 slot 的 widget 不会重 flush**。

> **开放决策 D3：** 如果你要的就是「立绘/UI 跟着说话者亮灭」，那么 Is Speaking 节点本身**不足以交付这个用户价值**，还需要扩 `valueBindings` 支持 boolean + `layout.visible`（独立的、更大的改动）。请确认预期消费形态 —— 这决定本计划是否要长出 Phase 5。

## 6. 顺带发现的既有缺陷（不在本计划范围）

按严重度排序，**除 1 外均未修复，仅记录**：

1. ~~**`storyCompiler.ts:1374` 的 `??` bug。**~~ **已修复（2026-07-15）**，但**原诊断有误**，实际缺陷更严重且是另一个：

   - **`""` 走不到 `1374`。** 唯一的生产 producer `mapCharacterStoreEntriesToSummaries`（`@shared/utils/characterSummaries.ts:30`）当时写的是 `raw.name.trim() ? raw.name.trim() : id` —— 空名**已经在上游被归一化了，但归一化成了 `id`**。所以 `summary.name` 恒非空，`??` 分支恒不触发，`new Character("")` 在生产链路上**不可达**。两个非测试 call site（Dev Mode bundle `bundleAssembler.ts:202`、preview `useStoryPreviewGameUi.ts:107`）都过这个 mapper。
   - **真实缺陷：UUID 进了 nametag。** 空名角色 → `summary.name = id` → `new Character(<UUID>)` → **玩家看到的名牌就是一个 UUID**，直接违反 §2 硬约束 6 / `displayableTarget.ts:48`。`1374` 自己的 `?? normalizedId` 兜底是同一个 UUID 泄漏的第二个入口。
   - **空名可达。** `CharacterPanel` 的创建/重命名对话框有 `required: true` 挡着，但 `CharacterPropertiesEditor.tsx:137` 的 `handleNameBlur` 和 `characterSchema.ts:48` 的 `setValue` **都不校验** —— 清空名字输入框失焦即写入 `""`。
   - **修法（两端各归其位）：** mapper 不再拿 `id` 冒充名字（空名就留 `""`）；`getCharacter` 用 `||` + `.trim()` 兜到中性 label `"Unknown"`，**永不回落到 `normalizedId`**。身份仍键在 `characterId` 上，displayName 纯装饰，故两个无名角色都显示 "Unknown" 不影响引用相等。
   - **blast radius 已核：** `summary.name` 全仓只有两个读取点 —— `1374` 与 `GameApp.tsx:199`（按名字反查做本地化）。后者对无名角色本就是死路（`extractCharacterTranslationRows` 吃的是 `profile.getName()` 原始值并 `filter` 掉空名，故 `char:<id>` 压根没有翻译单元），改动前后同为「原样返回」。
   - 回归测试：`storyCompiler.integration.test.ts`（`character nametag fallbacks`）+ 新增 `characterSummaries.test.ts`。

   **对本计划的影响：** §2 硬约束 4 仍然成立且**更重要了** —— Narrator 判定必须在引擎内用规范规则算。但「`new Character("")` 与 Narrator 不可分」这条现在只是**理论风险**（编译器已保证 displayName 非空），不再是本计划会继承的现实 collision。
2. **`LiveGameEvent` 的 dangling type。** `liveGame.ts:26` 标了 `@internal` 但 `events`/`onCharacterPrompt`/`onMenuChoose` 仍引用它 → emitted d.ts 引用**未声明也未 import** 的类型。消费者 `skipLibCheck:false` 直接报错，`true` 则退化成 `any`。`character.d.ts` 的 `CharacterStateData` 同病。
3. **两处 `onCharacterPrompt` 已经漂移。** Dev Mode（`GameApp.tsx:1563-1567`）跑 `translateCharacterName`，preview（`useStoryPreviewGameUi.ts:243-247`）**不翻译** —— 同一个 `Get Nametag` 节点在两个 host 返回不同的值。
4. **`wireNametagPrompt` 已不存在**，逻辑早被内联进上述两个 call site，只剩 `gameUiSlots.tsx:111` 一句失效的 doc-comment 引用。
5. **`CompiledSceneElements` 尚无生产消费者** —— 只有 `storyCompiler.preview.test.ts:88` 在用。作为先例它是「类型与形状上确立的」，还没被真实 host 用起来。

## 7. 待决

- **D1** —— `-` 的语义：「任何对话（含旁白）」还是「未配置」？（§3.2）
- **D2** —— NLR 三态的实现来源：`state.texts` 是否在 undo/读档/skip 下可靠？否则退回 `AdvDialogState` 加字段。（§3.3）
- **D3** —— 预期消费形态：若是绑 widget 可见性，需要 Phase 5 扩 `valueBindings`。（§5.2）
