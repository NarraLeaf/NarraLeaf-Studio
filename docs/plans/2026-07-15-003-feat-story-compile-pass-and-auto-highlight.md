---
title: "feat: Story Compile Pass 扩展点 + AutoHighlight 插件"
type: feat
status: draft
date: 2026-07-15
---

# feat: Story Compile Pass 扩展点 + AutoHighlight 插件

## Overview

需求的表层是一个插件：**AutoHighlight** —— 说话人恢复正常亮度，其余角色立绘 darken。但它落地需要的东西，绝大部分不在插件里，而在 Studio 缺失的一个扩展点上：**插件目前没有任何办法介入故事的编译**。

插件今天能贡献的只有蓝图节点、widget，以及一个"生成 block"的调色板命令（`story.actions.register`）。这三者都无法表达"在每一句 `Character.say` 之前，给场上其他角色发 darken"——因为这是一个**横切整个场景的、从说话人派生出来的**行为，不属于用户创作内容。

本计划把"编译期 transform pass"提升为一等扩展点，并以 AutoHighlight 作为第一个真实消费者验证它。同时补齐三个被这条链路暴露出的既有缺口：`{action:"plugin"}` block payload（`ProjectDependencyService` 等它等了很久）、插件项目配置到运行时的通道、以及 `Select` 那个已发布但坏掉的 `multiple` prop。

## 1. 目标与非目标

### 目标

1. 新增 runtime 侧插件扩展点 `app.game.story.registerCompilePass()`，允许插件在故事编译期观察 block 并注入 NLR statements。
2. 新增 `{action:"plugin"}` story block payload —— 插件拥有的、可被文档引用的标记块，带声明式参数 schema 与行内编辑 UI。
3. 新增插件项目级配置到运行时的烘焙通道（项目级默认 + 块级覆盖）。
4. 补齐 `storyAction` 依赖扫描（`ProjectDependencyService.ts:152` 的 TODO）。
5. 修复 `Select` 的 `multiple` stub，并在其上实现多选下拉框。
6. 交付 AutoHighlight 插件本体。

### 非目标

- **不改 NLR**。`Image.darken` 已存在，Studio 的 `DISPLAYABLE_EFFECT_OPS` 已含 `darken` 且对 character 目标可用（`storyCompiler.ts:1610`）。所需原语全部就位。
- **不做编辑器操作 hook**（见 §3.1）。
- **不追踪角色进出场**（见 §3.2）。这是产品决策，不是技术妥协。
- **不与用户自己的 darken 共存**。插件独占 darkness 通道（§3.2 硬控约定）。
- **不做非角色 displayable 的自动高亮**。首轮只处理 `kind === "character"` 的立绘。
- **不做跨 scene 的高亮传递**。`enabled` 随 `Scene.local` 进场重置。

## 2. 硬约束

1. **文档不被污染**。darken 只在编译期生成，从不写回 `StoryDocument`。禁用插件 = 那些 statements 不生成，文档字节不变。用户手写的只有标记块。
2. **不读 NLR 内部状态**。已核实（0.13.0 源码）：`Image.state` 只有 `{currentSrc, darkness}`，opacity 在 `transformState` 里，**两者都挂 `@internal` 且 `tsconfig` 开了 `stripInternal`** —— 编译产物的 `.d.ts` 里 grep 零命中。`Actionable` 的 `.d.ts` 只声明了 `constructor()`。这些是运行时存在但无兼容承诺的走私接口。
   - 既有例外：`storyActionBlueprint.ts:303-305` 已经在读 `scene.local.getNamespaceName()`。本计划不扩大它。
3. **改 `enabled` 的 Script 必须返回 `ScriptCleaner`**。`scriptAction.ts:13-26` 的 `if (cleaner)` 为假时**连 `actionHistory` 条目都不 push** —— 不返回 cleaner 就完全不参与 undo。而 `Condition.If` 的条件是**每次执行流经过时重新求值**的（构建期只存 Lambda：`condition.ts:238`；执行期才 evaluate：`conditionAction.ts:15-18` → `condition.ts:44-51`），undo 回卷后执行流重新流经 `ConditionAction` ⇒ 条件会拿着没回滚的 `enabled` 走到**不同分支**。NLR 不做任何自动快照，补偿逻辑必须手写（`execute` 里存旧值，cleaner 里写回）—— `DisplayableAction.applyTransform`（`displayableAction.ts:61,68-79`）是现成的正确样板。项目里有 Backlog/undo 蓝图节点，这是真实风险。
4. **pass 必须在 runtime target 注册**。`storyCompiler.ts` 跑在 `src/renderer/lib/ui-editor/runtime/`，生产构建只加载 `entries.runtime`。在 `entries.studio` 注册 pass 是错的，Dev Mode 能跑但打包必失效。
5. **`contributes` 声明式白名单不可绕过**。`pluginManifest.ts:114` 强制每个 type 以 plugin id 为前缀，且 pack 编译信任 contributes 来决定哪些插件的 runtime 代码要打包。新增的 `storyActions` 键必须遵守同一套规则。
6. **配置必须随项目走**。`app.services.storage` 已经是项目级的，但 **runtime 侧读不到它** —— 生产构建里没有项目目录。配置必须在打包时烘焙。
7. **插件独占 darkness**。见 §3.2 的"硬控"约定：不记忆、不还原用户自己施加的 darken。

## 3. 核心模型

### 3.1 为什么是 compile pass，不是编辑器 hook

原始设想是"hook 编辑器里的任何操作"，让插件在检测到 `Character.say` 时往文档里插 darken 块。这个形态要同时背上：撤销/重做必须正确、diff 全是机器生成的噪音、插件禁用后要能干净移除、每次编辑都要幂等重算。而这些块本来就不是用户创作的内容 —— 它们是**从说话人派生出来的**。

把派生物存进真源，是把派生关系反过来做。compile pass 让真源只保留用户的意图（标记块 + 说话人），派生物在编译期现场生成。

### 3.2 语义：一次性，只在 say 时触发

**AutoHighlight 只在编译到一个 dialogue block 时动作，此外什么都不做。角色进场、退场一概不管。**

这是产品决策。它的直接后果是设计塌缩到近乎平凡：

- 不需要知道"场上有谁"。darken 一个不在场的角色，视觉上什么都不会发生（`darkness` 与 `opacity` 完全正交 —— 分属 `state` 与 `transformState` 两个字段，渲染时打在不同 DOM 节点上：darkness 是内层 `<img>` 的 `filter: brightness(1-darkness)`，transform 的 filter 在外层包装节点）。
  - **且不会抛错**（已验证）：`Scene.action()` 会遍历所有 action 引用到的元素，把每个 image 的 `_init` **前置**到 userActions 之前（`scene.ts:495-544`），而 `autoInit` 默认 `true`（`image.ts:161`）且 Studio 从不覆盖。所以场景一开始**所有** image 就已挂载、`exposedState` 已就绪，只是 opacity=0。`setDarkness` 里的 `getExposedStateForce`（`imageAction.ts:183`）不会因"角色还没入场"而抛。
- 不需要在 show 边界插桩。一个角色如果在别人说话期间进场，它会以自己当前的亮度进来 —— **接受这个结果**。下一句对话会把它纠正过来。
- 不需要任何运行时状态（见 §3.4）。

> **已知的可见后果，明确接受**：角色 A 在 B 说话时入场，A 会是亮的（因为没人给它发过 darken），直到下一句对话。如果这在实际使用中扎眼，补救办法是在入场块后手动放一个 `Darken All` —— 而不是让插件去追踪进出场。

**硬控约定**：插件**独占** darkness 这个通道。用了 AutoHighlight 的项目，作者就不该再自己控制角色的 darken —— 插件不记忆、不还原用户施加的 darken，`Disable` 直接把全体拍回 `darken(0)`。这是插件与用户之间的约定，不是插件要去解决的问题。它换来的是：不需要"原值"的概念，不需要在 Enable 时快照、Disable 时还原，`darken(0)` 就是唯一的清除语义。

### 3.3 静态全集是可靠的

pass 需要枚举"本场景有哪些角色立绘"，以及每个立绘对应哪个 `characterId`。这一步**词法封闭、可靠**：只有 `{action:"character"}` 块能引入角色立绘，且它的舞台名只能来自字面量（`objectName` 或 `characterId`），不存在从变量算出的名字。扫一遍 `scene.blocks` 即可建出 `Map<stageObjectName, characterId>`。

> ⚠️ **必须用 `getCharacterStageObjectName()`（`storyTransformProps.ts:297`），不要用 `displayableSourceIdentity()`（`displayableTarget.ts:21`）。** 两者对 fallback 的规则不一致：前者是 `objectName → characterId → "character"`，后者是 `objectName || "Character"`（**无视 characterId**）。编译器 key `ctx.images` 用的是前者，所以只有前者算得出正确的舞台名。
>
> 这个不一致本身**看起来是一个既有 bug**（静态追踪，未实跑）：默认创建流程的 `characterEnter` 不带 `objectName`（`storyActionCommands.ts:308`），于是任何 `displayable` action 打到角色立绘上都会解析成 `"Character"` 而查不到对象、静默失效。已单独开任务，与本计划无依赖。

要记清的分界线：**全集静态可枚举**（词法问题，可靠）≠ **某一行的可见子集静态可判定**（可达性问题，不可靠 —— 见 §3.9）。本设计只依赖前者。

### 3.4 状态：一个运行时布尔

`Enable`/`Disable` 的语义本来就是有状态的，所以需要一个运行时标志。这是插件持有的**全部**状态：

- `enabled: boolean`，存在 **`Scene.local`**（`storyActionBlueprint.ts:6` 的既有 Scene 变量映射）。
- **默认 `false`**。`Scene.local` 每次进场清空（`DynamicPersistent.init` 硬重置，`persistent.ts:263-267` —— 设计如此），因此 `jump` 进入场景中段、越过 Enable 块时 auto 是关的。这是接受的行为（§8-Q1 已定）。
- 高亮集合**不需要状态**：每个 dialogue block 的说话人是 payload 上的 `characterId`，编译期已知；手动 action 的目标也是编译期已知。所以每一处的 darken 值都是**静态**的。

### 3.5 说话段（run）与收尾 darken

"说话人一直亮到下一个人开口"是不够的 —— 那样"变暗"是由**下一句 say 顺带完成**的，于是说完接旁白、接非对话块、或就是场景最后一句时，说话人会一直亮着。正确的触发点是**这个人说完了**。

所以每一**段**（同一说话人的连续对话，长度 1 或 N 都一样）的末尾要补一条收尾 darken，把全体拍暗。间隙画面是**全暗**：X 说完 → 全暗 → Y 亮起。

**为什么必须按"段"而不是按"句"**：`say` 是阻塞的（等玩家点击），所以收尾 darken 发在 say 之后。若每句都补，X 连说三句就会 亮→说→暗→亮→说→暗 地**闪**。段检测就是为了消掉这个闪。

**段的边界由配置决定**（`narrationBreaksRun`，编译期落实）：

- `true`：旁白算"没人在说话" → 打断段 → 旁白前全暗。
- `false`：旁白不打断，X 说话→旁白→X 继续，X 全程保持亮。

换背景/等待这类**非对话块一律不打断段**（它们不表达"谁在说话"）。

**已知边界情况**：分支会打断段。X 的最后一句后面跟一个 `if` 而分支里还有 X 的台词 → 段在分支处判定结束 → 补 darken(X) → 分支里的 say(X) 又点亮 → 闪一下。源码序 ≠ 执行序的固有问题，编译期无法消除。发生条件窄（同一角色台词跨分支边界连续），接受。

### 3.6 各类 block 的产物

| block | 产物 |
| --- | --- |
| dialogue（有说话人，段内） | `Condition.If(() => enabled, allAsync([ 对每个 C: C.darken(C是说话人 ? 0 : amount, dur, easing) ]))` |
| dialogue（段末，追加在 say 之后） | `Condition.If(() => enabled, allAsync([ 对每个 C: C.darken(amount, dur, easing) ]))` |
| dialogue（narration） | 不发；是否打断段由 `narrationBreaksRun` 决定（§3.5） |
| `Enable` | `Script(enabled = true, cleaner 还原旧值)` |
| `Disable` | `Script(enabled = false, cleaner 还原旧值)` + 无条件 `allAsync([ 对每个 C: C.darken(0, dur, easing) ])` |
| `Highlight Characters [S]` | 无条件 `allAsync([ 对每个 C: C.darken(S 含 C ? 0 : amount, dur, easing) ])` |
| `Highlight All` | 无条件 `allAsync([ 对每个 C: C.darken(0, dur, easing) ])` |
| `Darken All` | 无条件 `allAsync([ 对每个 C: C.darken(amount, dur, easing) ])` |

- **只有 `enabled` 是运行时的**，`Condition.If` 的分支内容完全静态（说话人编译期已知）。所以是"1 个 condition + N 个 darken"每句，不是每个角色一个 condition。
- **手动 action 无条件生效**，不看 `enabled` —— 它们就是"覆盖"，且**会被下一句 say 冲掉**。这意味着手动 action 主要在 `Disable` 之后有用。

### 3.7 注入形态：`Control.allAsync` + 显式 easing（三条都是硬性的）

**① 必须 `allAsync`，不能 `doAsync`。** 两者都"立即放行"，但 `doAsync` 内部是**串行**的 —— 它走 `construct` 把 N 个 action 串成一条链塞进**一个** stackModel（`control.ts:239-245`、`controlAction.ts:21-24`），第 2 个 darken 要等第 1 个动画播完才开始。`allAsync` 走 `pushUnchained`（`control.ts:249-261`），N 个各自独立 stackModel 并发（`controlAction.ts:103-113`）。

**② `doAsync` 会撕裂 undo —— 这是不能用它的真正原因。** `undoUntil` 是**纯下标回卷、不按 stackModel 过滤**（`actionHistory.ts:77-84`）。`doAsync` 串行执行 ⇒ 只有第 1 个 darken 同步 push 在 `say` 之前，其余要等动画播完才 push，**落在 `say` 之后**。history 变成 `[dA_L1, say_L1, dB_L1, dC_L1, dD_L1, ...]`，undo 到 `say_L1` 时 `dA_L1` 因下标 < index 被跳过 → **角色 A 停在旧暗度、B/C/D 回滚 → 状态撕裂**，分界点还取决于动画时长与玩家点击速度。

`allAsync` 则相反：N 个 stackModel 在 `ControlAction.executeAction` 内**全部同步跑到各自第一个 await**，N 条 history 全部早于 `say`。undo 到上一句时保留本句的前置 darken、回滚下一句的 darken —— 恰好正确。

> ⚠️ **这是隐式契约，不是设计出来的保证**。它依赖"fork 后同步执行到第一个 await"这一实现性质，NLR 侧没有任何注释或测试锁定它。**验收标准 5 必须覆盖它**（§7），否则 NLR 一次重构就会静默破坏。

**③ 必须显式传 easing。** `imageAction.ts:185` 的分支条件是 `if (duration && easing)` —— **只传 duration 不传 easing 会静默退化成瞬时**，duration 被完全丢弃。这是全仓**唯一**这么判的地方（`Text.setFontSize` 只判 `duration`；`Darkness` transition 的 easing 本身是 optional、duration 才是 required；motion 对 `ease: undefined` 有默认缓动）—— **判定为 NLR bug**，见 §8-Q3。在它修好之前，pass 必须保证 easing 有值（配置项给默认值，不能留空）。

**已知遗留（不影响画面，影响存档卫生）**：darken 动画播到一半时 undo → `Awaitable.abort()` 不触发 `then`（`data.ts:469-483`，且 `setDarkness` 的 awaitable 没注册 `skipController`）→ 该 async stackModel 的 `roll()` 永久挂在 await 上 → 不会从 `asyncStackModels` 里移除 → 被 `liveGame.serialize()` 写进存档（`liveGame.ts:150`）→ **读档时重新执行一遍**（`liveGame.ts:242-246`）。画面回滚是对的（undo 回调已恢复状态），只是脏。见 §8-Q5。

节点数 ≈ 角色数 × (say 数 + 段数)，全是轻对象。4 角色 100 句的场景约 400–800 个 ImageAction + 100–200 个 Condition。

### 3.8 pass 需要 NLR —— 一个必须先定的决策

pass 要构造 `image.darken(...)`，就得拿到 host 的 NLR。插件不能自带一份（会拿到与 host 不同的类实例）。两条路：

**A. 把 `narraleaf-react` 加进 runtime import map，作为 host 提供的 external**（推荐）
- 与 studio 侧 React 的处理方式同构（`app://plugin-api/react.js` 那套 shim）。runtime 层内部本来就是这么 import 的（`storyActionBlueprint.ts:13`），路已经通了，只是没对插件开放。
- 代价：NLR 的 API 就此成为公开插件契约，NLR 升级会波及插件。缓解：插件依赖表已有 semver major 检查，可扩展出 NLR API 版本声明（§8-Q4）。

**B. 声明式 pass API** —— 插件返回 `{op:"darken", target, amount}` 之类的描述，Studio 翻译成 NLR。保住 NLR 不外泄，但要把 NLR 能力重新建模一遍，且每加一个 op 都要改 Studio。对"让插件能 hook 编译"这个目标是自我否定。

推荐 A。

### 3.9 记录：为什么没有"谁在场"这个能力（供未来参考）

§3.2 把这个需求消掉了，但如果未来有 pass 真的需要它，先读这段，别重走弯路：

- **编译期不可知**：`SceneCompileContext.images` 是单调只增的 NLR 对象注册表，不是舞台状态 —— `exit` 分支照样调 `getImage()` 再 push 一个 hide chain（`storyCompiler.ts:1089`），注册表纹丝不动。
- **`SnapshotWalker` 只是近似**（`storyStageSnapshot.ts`，为预览而写）：前置 choice 不在路径上时假设零分支执行（`:252`）、expression/blueprint 条件一律当 `false`（`:283`）、`jump` 完全忽略（`:232`）。偏差全是漏报。
- **运行时也查不到**（已对源码验证）：`getSceneElements()` 返回的 `layers: Map<Layer, DisplayableElements[]>` 表达的是"init 过没有"。数组增删只发生在 `createDisplayable()`/`disposeDisplayable()`（`gameState.ts:950-987`），唯一调用点是 `displayableAction.ts` 的 `initDisplayable` —— 是生命周期，与 show/hide 无关。`Image` **不 override** show/hide，基类两者除 opacity 数值（1/0）外完全相同，都只是 `applyTransform`。真相源 `isDisplayableVisible()`（`gameState.ts:1371`）在 `.d.ts` 里是 `private`；NLR 自己就得靠它（`findCurrentPortraitForCharacter` 先遍历 layers 再逐个判 opacity）。
- 另外 `TransformState` 的 opacity 默认为 **0**，所以"未 init"／"init 了但 opacity=0"／"从未 show"三态在 opacity 上不可区分。

### 3.10 pass API 形状（草案）

```ts
app.game.story.registerCompilePass({
    id: string,
    /** 每个 scene 编译前调用一次。可预扫 blocks、建立 pass 私有状态。 */
    scene?(ctx: StoryCompileSceneCtx): void,
    /** 每个 block 调用。返回的 statements 会被插入该 block 编译产物的前/后。 */
    block?(ctx: StoryCompileBlockCtx): { before?: Statements; after?: Statements } | void,
});
```

`StoryCompileBlockCtx` 至少提供：只读 `block` / `scene`；`resolveDisplayable(ref)`；`config`（§4.3 烘焙来的插件配置）。

多 pass 的顺序与合并语义见 §8-Q2。

## 4. 需要新建的基础设施

### 4.1 `{action:"plugin"}` block payload（story schema v3 → v4）

```ts
| {
      action: "plugin";
      pluginId: string;
      actionId: string;      // 完整 id，含 plugin 前缀
      params: Record<string, JsonValue>;
  }
```

这正是 `ProjectDependencyService.ts:152` 那句 TODO 等的东西 —— *"Story-action usage is added once plugin story actions become a real, referenceable extension point (registration + story-doc reference model)"*。`DependencyKind` 里 `"storyAction"` 的位子（`pluginDependencies.ts:15`）早就留好了。

**迁移**：`storyModel.ts:192` 对非 v3 直接抛 `"Story document migration is not implemented"` —— 全仓**一个迁移器都没有**。加新 union 变体对读 v3 是后向兼容的，但新 Studio 写出的 v3 文档可能含旧 Studio 读不懂的块。结论：bump 到 v4 + 写第一个（恒等）迁移器，顺带把迁移框架建起来。这是本计划里波及面最广的一处改动。

### 4.2 `contributes.storyActions` + 声明式参数 schema

- `pluginManifest.ts:78` 的 `CONTRIBUTES_KEYS` 加 `"storyActions"`，沿用同一套 plugin-id 前缀校验。注意 `pluginManifest.test.ts:139-155` 现在**断言该键被拒绝**，要一并更新。
- `StoryPluginActionRegistration`（`services.ts:663`）从"block 生成器"升级为"带参数 schema 的声明"：`params: ParamSchema[]`，Studio 据此渲染行内编辑 UI 并生成 `{action:"plugin"}` 块。
- 顺带清理：`registration.group` 字段声明了但全仓无人读取（死字段）。

### 4.3 插件配置烘焙通道 —— ⚠️ 已存在，不用新建（2026-07-23 对账）

**这块基础设施已经落地。** Studio 现在有 `contributes.runtimeData: string[]`（声明命名空间）+ runtime 侧只读 API `app.game.data.readJson(namespace)`（`runtimePluginApi.ts:62`）—— 注释原文："the data travels with the pack, so there is nothing to await … Callers must degrade gracefully"，与本节当初的设想完全一致。

所以配置链路变成：Studio 侧 `app.services.storage` 写项目级配置（声明为 `runtimeData` 命名空间）→ 打包时烘焙进 pack → compile pass 通过 `app.game.data.readJson()` 只读读取。**无需再建通道**，只需让 AutoHighlight 声明一个 `runtimeData` 命名空间、pass 从 `app.game.data` 读。

配置 UI 仍由插件自绘 —— Studio 没有声明式配置 UI，内置 gallery 插件（`src/builtin-plugins/gallery/main.tsx:375`）是现成样板。

> **对账小结（2026-07-23）**：插件 `contributes` 现在是 `blueprintNodes / widgets / runtimeData / locales`（早期调研时只有前两个）。四块基础设施里 **§4.3 已由 `runtimeData` 覆盖**；`registerCompilePass`、`{action:"plugin"}` block、storyAction 依赖扫描（§4.4）**仍不存在**，是本计划的净新增。另注意：`story.actions.register`（早期存在的"生成 block"调色板命令）在当前分支已 grep 不到，若 §4.2 要复用它需先确认它是否被移除。

### 4.4 storyAction 依赖扫描

在 `ProjectDependencyService` 补 `collectStoryActionUsage()`，扫 `{action:"plugin"}` 块，按 `pluginId` 归属，`hard: true`（插件缺席则块无法编译 → 文档损坏）。

### 4.5 Select 多选

`multiple?: boolean` 已在 `SelectProps`（`Select.tsx:32`）声明**且已通过 `src/renderer/plugin/index.ts:76` 导出为公共插件 API**，但实现是空壳 —— `Select.tsx:214` 的多选分支是句注释，勾选判定用单值相等（`:266`），插件作者传 `multiple` 会静默降级成单选。**这是已发布的 API bug，不是新功能。**

全仓库零调用点传 `multiple`（`<Combobox>` / `<SelectGroup>` 也是 0 使用），契约可自由改。改造走判别联合，64 处单选调用点零改动：

```ts
type SelectProps = SingleSelectProps | MultiSelectProps;   // multiple?: false | multiple: true
```

已选项显示用 `Badge`（`elements/Badge.tsx` 已存在且语义正是 chip，但**没从 barrel 导出、全仓零使用** —— 与 design-system Phase 4/5 监督式迁移未做一致）。窄容器（properties 面板/inspector）默认折叠成"已选 N 项"。

**必须一并做**：Select 目前**没有任何键盘交互**（无 `onKeyDown` / `role` / `aria-*` / Escape / 方向键），是设计系统里 a11y 最弱的组件。多选没有 Space 切换基本不可用。

**已知坑**：`useLayoutEffect` 定位依赖数组含 `value`（`:137` / `:210`），多选后 `value` 是数组，每次渲染新引用会让 portal 菜单每帧重定位抖动 —— 需改为稳定派生（如 join key）。

**顺带**：`Select.tsx:52-55` 用了已禁的 `focus:border-primary`，`:259` / `:481` 用 `text-white` 应为 `text-fg`。改完跑 `yarn style:ratchet`。

## 5. AutoHighlight 插件规格

### Story actions

| Action | 参数 | 语义 |
| --- | --- | --- |
| Enable Auto-Highlight | darken 强度 / 时长 / 缓动（均可选，缺省用项目配置） | `enabled := true`。其后的每句对话按说话人自动高亮 |
| Disable Auto-Highlight | — | `enabled := false` **并清除全部高亮**（全体 `darken(0)`） |
| Highlight Characters | 角色多选（§4.5） | 覆盖：选中项恢复正常亮度，其余 darken |
| Highlight All | — | 覆盖：全体恢复正常亮度 |
| Darken All | — | 覆盖：全体 darken |

三个手动 action 是**即时覆盖**：无条件生效，不改变 `enabled`，且**会被下一句 say 冲掉**（auto 仍开着时每句都按说话人重算）。因此它们主要用在 `Disable` 之后的手动区段。

`Highlight All` 的效果与 `Disable` 的清除部分相同，差别只在 `Disable` 同时关掉了 auto。

### 项目配置（自绘面板）

| 配置项 | 说明 |
| --- | --- |
| darken 强度 | 0–1，`storyCompiler.ts:1615` 会 clamp |
| 过渡时长 | 传给 `darken(d, duration, easing)` |
| 缓动 | **不能留空**，否则 duration 静默失效（§3.7-③ / §8-N1）。UI 上不提供"无"选项 |
| `narrationBreaksRun` | 旁白是否打断说话段（§3.5）。编译期落实 |
| 排除名单 | 永不被自动 darken 的角色 |

配置在编译期读取并落实进产物，所以改配置需要重新编译（Dev Mode 重启 / Preview 重开 / 重新打包）—— 不是运行时可调的。

### 两个 entry

- `entries.studio`：注册 5 个 story action + 配置面板。
- `entries.runtime`：注册 compile pass。

## 6. 分期

| 期 | 内容 | 可独立验证 |
| --- | --- | --- |
| 1 | story schema v3→v4 + 迁移框架 + `{action:"plugin"}` payload | 旧项目能开、能存、往返无损 |
| 2 | `contributes.storyActions` + 参数 schema + 行内编辑 UI + 依赖扫描 | 一个 stub 插件的标记块能插入/编辑/存读，依赖表正确 |
| 3 | Select 多选 + 键盘 + a11y + Badge 接 barrel | 组件层面可单独验收 |
| 4 | runtime compile-pass API + NLR external（§3.8-A） | 一个 stub pass 能注入可观察的 statement |
| 5 | 插件配置烘焙通道 | 配置在 Dev Mode / Preview / 生产构建三处都读得到 |
| 6 | AutoHighlight 本体 | 见 §7 |

3 与 1/2/4/5 无依赖，可并行。

## 7. 验收标准

1. Enable 后，说话人亮、其余暗，说话人切换时正确交接。
2. **Disable 清除高亮**：Disable 后全体回到正常亮度，且其后的对话不再改变亮度。
3. **控制流无关性**：角色在 `if` / choice 分支内入场、条件分支里的对话 —— 高亮都正确。这是"每句 say 无条件重算全集"的直接结果，应当天然成立；测试是为了防止未来有人"优化"成增量更新而破坏它。
4. **`jump` 进入场景中段**（越过 Enable）→ auto 关闭、亮度不被改动（§3.4 的 Scene.local 进场重置语义）。
5. **undo**（本计划最容易出错的一块，三条都要覆盖）：
   - 连说三句（A→B→A）后逐句 undo，高亮逐句正确回退（依赖 `imageAction.ts` 的原生 `handleUndo`）。
   - **跨 `Enable`/`Disable` 块 undo**，`enabled` 正确回滚，且回滚后的对话行为与首次执行一致。硬约束 3 的回归测试 —— cleaner 写漏时此用例必挂。
   - **darken 动画播到一半时 undo**，全体亮度一致回滚、无角色停在中间值。这是 §3.7-② 那个隐式契约的回归测试 —— 若哪天 `allAsync` 变成串行（或有人改成 `doAsync`），此用例会暴露"部分角色不回滚"的撕裂。**必须在动画时长内触发 undo 才有效**，测试要控制时序。
6. **不阻塞**：说话人切换时台词立即出现，不等 darken 动画播完（§3.7-①）。4 角色 × 300ms 若变成串行，此处会有 ~1.2s 延迟。
7. narration 块不改变任何亮度；`narrationBreaksRun` 两种取值下的画面都符合 §3.5。
8. **说完就暗**：一段（1 句或 N 句）说完后说话人变暗；同一说话人连说多句时**中间不闪**（§3.5 的段检测回归测试）。
9. 手动 action 即时覆盖生效；auto 开启时其后的第一句 say 会把它冲掉（§3.6 的既定语义，非 bug）。
10. 禁用插件后，文档字节不变，编译产物里无任何 darken。
11. 生产构建（非仅 Dev Mode）中行为一致 —— 硬约束 4 的回归测试。
12. 插件未安装时，含 `{action:"plugin"}` 块的项目给出明确的 hard-dependency 报错，而非静默损坏。
13. **明确不测**：角色在他人说话期间入场时的亮度（§3.2 已声明接受）。

## 8. 开放问题

### 已定

- ~~**Q1**：Enable/Disable 编译期还是运行时？~~ **运行时标志**（语义本就有状态）。Disable 需清除已施加的效果。进场默认 `false`，必须显式 Enable。见 §3.4。
- ~~**Q2**：手动高亮会不会被下一句 say 冲掉？~~ **会冲掉**（手动 = 即时覆盖，下句 say 重算）。见 §3.6。
- ~~**Q0**：`gameState` 能否判可见性？~~ **不能**，已对源码验证，见 §3.9。该路线出局。

### 待定

- **Q3**：`{action:"character", operation:"expression"}` 换 src 时会不会重置 darkness？若会，同一角色换表情后会突然变亮，需要 pass 补一条。**待实测**（成本很低，与第 0 期一起做）。
- **Q4**：多个 pass 想插桩同一 block 时的顺序与合并语义？首轮是否直接限制"同一时刻只允许一个 pass"以回避？
- **Q5**：NLR 成为公开插件契约后的版本治理（§3.8-A 的代价）—— 首轮是否只需在插件依赖表里加一个 NLR major 声明？

### 顺带发现的 NLR 问题

- ~~**N1：`darken` 传了 duration 不传 easing 会静默变瞬时。**~~ **已修**（0.13.0，见 §10）。`if (duration && easing)` → `if (duration)`。pass 仍建议显式传 easing（配置项给默认值），但不再是硬性要求。
- ~~**N2：动画中途 undo 会泄漏 async stackModel 进存档。**~~ **已修**（0.13.0，见 §10）。注意最初的诊断（"`setDarkness` 没注册 skipController"）**是错的** —— 真正的根因在 `stackModel.roll()`，且与 skipController 无关。
- ~~**N3：`allAsync` 的 undo 正确性是隐式契约。**~~ **已加回归测试**（2026-07-23，NLR `controlAsyncUndoOrdering.test.ts`，3 用例）。真实驱动 `Control.allAsync`/`doAsync`，只 stub 叶子 `executeAction`（= history push 的位置）：钉住"allAsync 同步跑完全部 fork（2 次）、doAsync 只跑链头（1 次）"的对照，外加 `undoUntil` 纯下标回卷。做过变异验证（把 allAsync 退化成只 fork 首支 → 测试 1 挂）。这条契约现在 NLR 侧有测试锁定，Studio 侧验收标准 5 仍是第二道防线。

## 10. 已完成的前置项：NLR `darken` 与 async undo（已修）

调研本计划时发现并已修复，落在 NLR 0.13.0（未发布），见该仓库 CHANGELOG 的 `[0.13.0] > Fixed`。两处共 `2 files, +24/-2`，新增 `imageAction.darken.test.ts`（3 用例）与 `stackModel.abort.test.ts`（4 用例），两个测试都验证过"改回旧代码即挂"。

**N1**：`imageAction.ts:185` 的 `if (duration && easing)` → `if (duration)`。`darken(0.5, 300)` 这个最自然的写法此前会静默丢弃 duration 直接瞬跳。easing 从来就不是必需的 —— `Darkness` transition 的 easing 是 optional、duration 才 required，底层 `animate` 对 `ease: undefined` 有默认缓动，所有其他带时长的方法（`setFontSize` / `transform` / `pos`）本来就依赖这一点。

**N2**：`stackModel.ts` 的 `roll()` 把裸 `await result` 换成"等 settle + abort 则停止"。

> ⚠️ **最初的诊断是错的，值得记录**：调研 agent 认为根因是"`setDarkness` 的 awaitable 没注册 `skipController`"。但读 `Awaitable` 源码可知 `abort()` 的**两条路（有无 skipController）都只调 `notifySettled()`，都不触发 `listeners`**，而 `then` 的回调正挂在 `listeners` 上 —— 所以注册 skipController 根本不解决挂起，且 `abort()` 的 "won't trigger the `then` callbacks" 是**写进文档的故意行为**，不能改 `Awaitable`。真正的根因是消费端：`roll()` 用裸 `await` 等一个可被 abort 的 awaitable。
>
> 顺带排除的一个诱人错误：照抄同文件 `setAppearance`（`imageAction.ts:106,148`）的 skipController 写法。它的 abortHandler 是 `() => super.executeAction(...)`，即"abort 时执行下一个 action" —— 在 undo（回卷）路径上这是**前进**，方向反了。`setDarkness` 不注册 skipController 反而是对的。

影响面：`roll()` 服务于 `Control.all` / `any` / `doAsync` / `allAsync` 与读档的 async 栈恢复；root stack 走 `next()` → `rollNext()` 拉模式，不受影响。

## 11. 已完成的前置项：NLR 存档往返 bug（已修）

调研本计划时发现并已修复，落在 NLR 0.13.0（未发布），见该仓库 CHANGELOG 的 `[0.13.0] > Fixed`。

`Namespace.toData()` → `serialize()` 把每个值 wrap 成 `{type, data}`，但两条读取路径都不 unwrap：`Storable.load()`（存档主链路，`liveGame.ts:217`）与 `sceneAction.ts:93`（快照/undo 链路）。会 unwrap 的 `Namespace.deserialize()` 没有任何调用者 —— 正确的路没人走。公开类型 `SavedGame.store` 又把 wrap 过的数据声明成 `StorableData`，`Storable.toData()` 里一个 `as` 强转把类型洗白，所以 TS 从未报错。

**症状**：存档里的 `false` 读回来是 `{type:"any", data:false}` —— 对象恒为真，剧情标志静默翻转。影响所有 `Persistent`、Scene 变量与 undo 路径。

**修复**（`5 files, +58/-18`，新增 `storable.test.ts` 8 个用例）：
1. 两条读取路径都 unwrap（`load` = unwrap + 替换，`deserialize` = unwrap + 叠加）。
2. `liveGame.deserialize` 先 `initNamespaces()` 再 `load()`，让作者默认值在读档后存活 —— 此前 `clear()` 会把 `defaultContent` 一并抹掉，导致 `reset()` 还原出存档内容、新版本新增的键读回 `undefined`。
3. 类型摆正：`WrappedStorableData` / `SerializedNamespaceData` 转为公开（它们是存档格式的一部分），删掉那个 `as` 强转。

**未修复**：受影响版本上"读档后再存档"产生的存档，值在磁盘上被 wrap 了两次，而第二层 wrap 与用户合法存入的同形状对象无法区分，故不做启发式修复。**若线上已有真实玩家存档，需要你判断是否值得加迁移。**

**相关**：`/Users/nomen/Documents/dev/org/NarraLeaf-react` 无任何 tag，`git log --all` 中无 0.12.3 的 publish commit（最近为 `5c56f8f publish: 0.12.2`）—— 已发布版本无法从源码复现，建议补 tag 流程。
