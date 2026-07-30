---
title: "plan: Surface 原生视频控件与 Spine2D/Live2D 模型控件"
type: plan
status: active
date: 2026-07-29
---

# plan: Surface 原生视频控件与 Spine2D/Live2D 模型控件

> 界面系统（UI editor / Surface）今天只有纯 DOM 控件。本卡给它加两个控件：
> **视频**（`nl.video`）与 **Spine2D / Live2D 模型**（`nl.puppet`），两者都折叠在 docker 的溢出菜单里。
>
> **这两个控件都不属于舞台。** 引擎的 `Video` 是 `Actionable`（没有位置、没有 transform、整屏播放），
> 引擎的 `Puppet` 是舞台 `Displayable`。Surface 控件是 Studio 自己渲染的 DOM 树，
> 两者都**不经过**引擎的元素模型。用户裁决（2026-07-29）。

---

## 0. 为什么这张卡比看起来小

勘验结论：**基建绝大部分已经在 develop 上了**，这张卡主要是把已有的机械接到 Surface 上。

| 需要的东西 | 状态 |
|---|---|
| 控件扩展点（`UIWidgetModule`：类型/图标/默认元素/检查器/docker/私有蓝图节点） | 已有，`widget-modules/types.ts:201` |
| 「折叠在 docker 中」 | 已有，`insertPalette.ts:5` 的 `placement: "primary" \| "overflow"`，`nl.slider`/`nl.list`/`nl.frame` 已在用 |
| 资产 URL 双宿主接缝 | 已有，`useAssetObjectUrl` 有 workspace 实现 + runtime shim（`src/runtime/renderer/shims/useAssetObjectUrl.ts:13`），`resolveGameRuntimeAssetUrl` 按 id 取、与资产类型无关 |
| `AssetType.Video` | 已有，`assetTypes.ts:4` |
| `AssetType.Model`（保留目录树的多文件资产） | 已有，`assetTypes.ts:19`；导入走目录选择器 `useAssetActions.ts:357` |
| 模型包入口嗅探（spine-binary / spine-json / live2d-cubism4/2） | 已有，`src/shared/utils/modelBundle.ts` |
| 挂载作者自备渲染器的原语 | 已有，`puppetModelSession.ts`：`{container, source, backend, src, options, size}` → `describe/apply/resize/dispose`，**不需要 Player、不需要 Story、不需要舞台** |
| 作者自备 runtime 的发现约定 | 已有，`runtimes/puppet/<name>/index.js`，`projectPuppetRuntimes.ts` |
| `describe()` 填下拉框 + 无头预览 | 已有，`PuppetDescriptionService`（token `"puppetDescription"`）+ `PuppetPreview.tsx` |
| 打包清单含 `video` / `model` | 已有，`gameRuntimeArtifactCompiler.ts:48`、`bundleAssembler.ts:214` |
| 通用 Displayable 蓝图节点族 | **已有**，见 §5.1——这改变了第二阶段的含义 |
| 音量通道读取节点 | 已有，`gameNodes.ts:173-247`：`Get Global/BGM/Sound/Voice Volume` |

**真正是新工程量的只有三块**：两个控件模块本身、puppet 的双宿主挂载接缝（§4.2）、
以及第二阶段那条「命令式请求 + 活读数」通道（§5.3）。

---

## 1. 用户裁决（2026-07-29）

1. **类型 id 渲染器无关，作者面点名两家。** 文档 schema 存 `nl.puppet`（一个控件，backend 从工程的
   `runtimes/puppet/` 下拉选，同时覆盖 Spine 与 Live2D），但作者看到的名字明确写
   **「Spine2D / Live2D 模型」**，属性面里也直说要自备 runtime。
   → schema 稳定（日后加 Live2D 不改 schema）、法务干净（Studio 不发任何渲染器）、作者知道它是干什么的。
2. **视频音量走蓝图引脚。** 控件不自己去读设置；它暴露一个 `volume` 输入引脚，
   作者自行把 `Get Global Volume` / `Get BGM Volume` / `Get Sound Volume` / `Get Voice Volume`
   连进去。这些 getter 节点**已经存在**，所以「跟随玩家音量」这件事零新增管线。
3. **视频在画布上默认停在首帧**，选中时 docker 条上出现播放/暂停开关供预览。
   一屏多个视频控件时编辑器不会变成动图墙。

---

## 2. 硬约束（不可协商）

**C1. 仓库里永远没有渲染器代码。** 不 vendor Spine runtime、不 vendor Cubism Core、不代为下载。
Live2D 的 "excluded license" 条款与 MPL-2.0 正面冲突，Expandable Application 原则上不批免费产品；
Spine 允许但要求集成方持 Editor 授权。整套姿态见 `docs/plans/2026-07-27-002`，
`puppetBackendHost.ts:12` 的注释是这条的现行表述：*"Nothing here names a renderer, and nothing here is allowed to."*
→ `nl.puppet` 控件只加载作者放在 `runtimes/puppet/<name>/index.js` 的模块。

**C2. 两个注册表都要登记。** `UIWidgetModule.render` **不是画布的绘制路径**。
画布与运行时都构造 `new ElementRendererRegistry(BuiltinElementRenderers)`
（画布：`UIRuntimeBridgeService.tsx:20`；打包运行时：`GameRuntimeApp.tsx:291`），
数据来自 `runtime/builtin/index.ts` 里那个**硬编码数组**。
只登记 `BuiltinWidgetModules` 的后果是：能插入、能选中、能编辑属性、**画布和游戏里都画不出东西**
（落到 `unknownWidgetTypeUi.tsx`）。**今天没有任何测试守住这一条**（见 WI-0）。

**C3. 不重复已有的通用节点。** 见 §5.1。

**C4. 不许 `git worktree remove`。** 执行者把工作树留在原地，由 orchestrator 事后清理
（先 `cmd /c rmdir <wt>\node_modules` 断 junction 再 remove）。这条在本仓库已出过四次事故，
每次都清空了共享检出的 `node_modules`。**只读任务同样适用**——不要为了跑测试自建带 junction 的临时树。

---

## 3. 加一个控件要动哪些文件（勘验所得的完整清单）

**必做，漏了会静默失效：**

1. `src/shared/types/ui-editor/<name>.ts` —— `UI<Name>WidgetProps` + `default<Name>WidgetProps` + `normalize<Name>Props`（照 `slider.ts`）。
2. `src/renderer/lib/ui-editor/widget-modules/builtin/<name>.tsx` + `<name>/{renderer,inspector,helpers,dockerBar}.tsx` —— `UIWidgetModule`。
3. `widget-modules/builtin/index.ts` —— 加进 `BuiltinWidgetModules[]`（漏了 = 注册表根本看不见）。
4. `runtime/builtin/index.ts` —— 加进 `BuiltinElementRenderers[]`（**C2，漏了 = 什么都画不出来**）。
5. `widget-modules/insertPalette.ts` —— 加进 `DEFAULT_INSERT_PALETTE_CONFIG`，`placement: "overflow"`
   （漏了 = UI 上无法插入；若别处引用了未注册类型则直接抛 `Missing widget module for palette type`）。
6. `src/shared/i18n/catalog/en/widgets.ts` **与** `zh/widgets.ts` —— `widgets.defaults.<name>.name` +
   检查器文案。`parity.test.ts` 会拦下漏译，这是唯一不静默的一步。

**按需：**

7. `src/shared/types/ui-editor/document.ts:104-106,208` —— 若控件拥有结构性子元素或需要 flow-layout 豁免。
   两个控件**都不需要**（都是叶子）。
8. `src/shared/types/ui-editor/widgetLogic.ts` 的 `BUILTIN_WIDGET_LOGIC_APIS` —— 私有蓝图的事件/命令/可读状态/可写属性。
   缺了则 `getWidgetLogicApi()` 返回 undefined，私有蓝图事件头不生成。**两个控件都要。**
9. `diagnostics/rules/resourceDiagnostics.ts:34-60` —— 「资产缺失」诊断是**按类型手列的**，
   新的带资产控件不加分支就没有诊断。**两个控件都要。**
10. `blueprint-nodes/built-in/<name>Nodes.ts` + `built-in/index.ts` 的 `allBuiltinBlueprintNodes`（第二阶段）。
11. `blueprint-runtime/BlueprintHostApiBridge.ts` —— 运行时读写活控件状态（第二阶段）。

**不用管（按命名约定自动生效）**：`surfaceResourcePreload.ts` 与 `referenceModel.ts` 是按字面属性名
`assetId` / `fontAssetId` / `imageFill` 做的递归遍历——**只要属性就叫 `assetId`，预加载与「被谁引用」索引自动覆盖**。
这条决定了两个控件的资产属性名必须叫 `assetId`，不要发明 `videoAssetId` / `modelAssetId`。

**`UI_DOCUMENT_SCHEMA_VERSION`（今天 11）不需要动** —— 只加新类型不需要迁移，
只有改既有元素的数据形状才要 bump + 写 `migrateFromV11Document`。

---

## 4. 第一阶段：画布视觉与属性编辑

### WI-0 守卫先行（必须第一个落，且必须先红）

`BuiltinWidgetModules` 与 `BuiltinElementRenderers` 是两个手维护的数组，没有任何测试对齐它们。
加一个测试：遍历 `widgetModuleRegistry.list()`（或 `BuiltinWidgetModules`），
断言除内部类型外每个 `type` 都能在 `BuiltinElementRenderers` 里取到 renderer。

**标定要求**：先临时从 `runtime/builtin/index.ts` 摘掉 `nl.slider` 一行，确认测试**红**，再放回。
不能证明它会红的守卫等于没有守卫。

### WI-1 `nl.video`

**Schema**（`src/shared/types/ui-editor/video.ts`）：
- `assetId: string | null`（**名字必须是 `assetId`**，见 §3）
- `objectFit: "contain" | "cover" | "fill" | "none"`
- `loop: boolean`、`muted: boolean`、`autoplay: boolean`
- `volume: number`（0–1，默认 1；第二阶段的 `volume` 引脚写的就是这个）
- `playbackRate: number`（默认 1）
- `posterAssetId: string | null`（可选封面；同样叫 `...AssetId` 走通用引用索引——**确认 `referenceModel.ts` 是否只认字面 `assetId`；若只认字面名，改叫 `poster: {assetId}` 或直接在 `referenceModel.ts` 补一条**）
- `controls: boolean`（是否显示浏览器原生控件条；默认 false）
- `preload: "none" | "metadata" | "auto"`

**渲染**：外层复用 `RectangleChromeRenderer`（它接 `children`，第 587 行渲染），
`<video>` 作为 children 放进 chrome 盒子里 → 圆角、描边、填充、透明度、appearance 变体**全部免费继承**，
两个新控件在视觉语言上和其余 Surface 控件一致。这是本卡的核心复用点，不要另起一套盒子。

**画布行为（裁决 3）**：`preload="metadata"`，不 autoplay，停在首帧/poster；
docker 条上给播放/暂停 + 回到首帧的开关，只影响画布预览，**不写进文档**（是 editor state，不是文档数据）。
运行时按 `autoplay`/`loop` 属性正常播放。
判据：画布上放 3 个视频控件，`document.querySelectorAll("video")` 全部 `paused === true`。

**检查器**：`createPropertyEditorSchema` 声明式字段。资产选择器筛到 `AssetType.Video`
（照 `AssetSelector` 既有用法；注意 memory 记着「AssetSelector 多选从来没工作过」，只用单选）。

**docker 条**：资产选择 + fit 下拉 + 预览播放开关。

### WI-2 `nl.puppet` 的双宿主挂载接缝

这是第一阶段唯一真正的架构工作。`puppetModelSession.ts` 已经能把作者的 backend 挂进一个裸 `<div>`，
但**编辑器画布经 workspace services 拿到它，运行时没有 workspace services**。

照 `useAssetObjectUrl` 的既有接缝形状办：
- 新增一个宿主无关的 hook（例如 `useSurfacePuppetSession`），控件渲染器只调它；
- **workspace 实现**：走 `Services.PuppetDescription` 的 `openSession(request, container, {size})`；
- **runtime shim**（`src/runtime/renderer/shims/`）：走 game-runtime bridge 取 backend 模块 URL 与模型包入口 URL，
  再用 `loadPuppetBackends` + `puppetModelSession` 自己挂。
  `GameRuntimeApp.tsx:354-363` 已经为模型包接了 `bridge.assetUrl`。

**执行者必须先确认再实现**：runtime shim 是怎么被换进去的（构建期 alias？）——
照 `useAssetObjectUrl` 那对文件反查构建配置，把机制写进报告，不要猜。

### WI-3 `nl.puppet` 控件

**Schema**（`src/shared/types/ui-editor/puppet.ts`）：
- `assetId: string | null`（模型包资产，`AssetType.Model`）
- `backend: string`（作者工程 `runtimes/puppet/` 下的名字）
- `options: Record<string, unknown>`（原样转交 backend）
- `motion / expression / skin: string | null`、`params: Record<string, number>`、`slots: Record<string, string | null>`
  —— 刻意与引擎 `PuppetState` 逐字段同形，这样 `session.apply()` 收到的就是完整状态，
  语义与舞台 puppet、与存档一致。
- 盒子尺寸用 `UILayout` 的 width/height（不要另开一个 size 属性）。

**检查器**：
- 模型包资产选择器（筛 `AssetType.Model`）；
- backend 下拉（来源 `projectPuppetRuntimes.ts`，不是自由文本）；
- motion / expression / skin 下拉，**选项来自 `PuppetDescriptionService` 的 `describe()`**，
  拿不到时回落自由文本（引擎契约明说 `describe` 可以不实现、可以 reject，宿主要回落）；
- `options` 用 JSON 编辑；
- 一段说明：Studio 不提供渲染器，需要作者自备（法务告知，C1）。

**渲染**：chrome 盒子 + 挂载 `<div>`。照 `PuppetPreview.tsx:52-59` 的做法——
**每次挂载新建一个子 div**，因为 dispose 会清空容器且挂载是异步的，
两次重叠的挂载（React 开发期 double-invoke、加载中改属性）会让后到者把先到者的画布擦掉，
留下一个空盒子且没有任何错误说明为什么。

**必须处理的资源问题**：每个 puppet 控件是一个 WebGL 上下文，浏览器上限约 16 个。
一屏放十几个模型控件会静默丢上下文。要求：**未选中/离屏的控件延迟挂载**，
并对同时挂载数设上限 + 超限出一条诊断（`resourceDiagnostics.ts`），
**不许静默截断**（截断而不报 = 看起来覆盖了其实没有）。

**状态推送**：属性变化时调 `session.apply()` 送**完整**状态，
不做「只改变的字段」——引擎契约明写 `null` 是「清除」而不是「保持原样」，
半量 apply 会让读档/撤销复现不出记录的样子。

### 第一阶段验收判据（我会亲手复验，用户做最终视觉确认）

1. docker 溢出菜单（`...`）里出现两个新条目，主行没有变化。
2. 插入视频控件 → 画布上出现带首帧的盒子，`video.paused === true`；docker 播放开关能让它动、再点停。
3. 插入模型控件 → 未配置时是一个说明「需要自备 runtime」的空盒子，**不白屏、不抛错**
   （对齐引擎 `missing-backend` 的降级语义）。
4. 配好模型包 + backend → 画布上模型出现并在动。
   **动没动的判据**：`Page.captureScreenshot` 整帧比对，**绝对不许用 `canvas.toDataURL()`**——
   这些 WebGL 上下文 `preserveDrawingBuffer=false`，在绘制回调外取到的是空缓冲，
   哈希稳定得很好看但什么都没测到（判别法：`dataURL.length` 与同尺寸空白 canvas 完全相等）。
   这个错误在本仓库已经导致过一次被撤回的结论。
5. motion/expression/skin 下拉里是**模型真实的名字**（来自 `describe()`），不是自由文本框。
6. 两个控件的属性改动都进撤销栈，撤销一步复原。
7. Dev Mode 里同一个 Surface 渲染出与画布一致的结果（证明 C2 两个注册表都登记了）。
8. `resourceDiagnostics` 在资产缺失时报警。
9. `npx tsc` 四工程干净 + vitest 无新增失败 + `parity.test.ts` 绿。

---

## 5. 第二阶段：私有节点与通用 Displayable 节点

### 5.1 勘验改变了这一阶段的含义

**通用 Displayable 节点族已经存在**（`blueprint-nodes/built-in/elementNodes.ts`，category `"Displayable"`）：
Get/Set Display、Get/Set Property（position/size/bounds/x/y/offsetX/offsetY/width/height/rotation/opacity/visible）、
Get/Set Variant、Animate Property（opacity/offsetX/offsetY/x/y/scale/rotation）+ Stop Animation、
Continue/Stop Event Bubble，每个都有 self（作用于自己）与 element（作用于引用）两种形态。
成员名单在 `elementNodes.ts:96` 的 `DISPLAYABLE_WIDGET_TYPES`（今天 7 个类型），
另有 `widgetPropertyNodes.ts` 的 `WIDGET_TARGETS` 提供 per-type 的 Visible/Enabled/Variant。

→ **所以这一阶段的「通用 Displayable 节点」= 让两个新控件加入这个既有家族，而不是另建一套。**
具体是把 `nl.video` / `nl.puppet` 加进 `DISPLAYABLE_WIDGET_TYPES`、`WIDGET_TARGETS`
（以及 `APPEARANCE_VARIANT_WIDGET_TYPES`，如果它们支持 appearance 变体——WI-1/WI-3 复用了
`RectangleChromeRenderer` 所以大概支持，要实测确认）。**重复造一套是明确禁止的（C3）。**

### 5.2 私有节点

照 `sliderNodes.ts` / `textInputNodes.ts` 的模板，每个控件一对
`*_SCOPE`（`{ownerKinds:["widgetMain"], widgetElementTypes:["nl.video"]}`，把节点关进该控件自己的蓝图）
+ `*_MAGIC_TARGET`（`{inputPinId, elementTypes}`，驱动作用于引用的孪生节点）。

**视频**：Play / Pause / Stop / Seek / Set Volume（带 `volume` 引脚，裁决 2）/ Set Muted / Set Loop /
Set Playback Rate / Set Source(asset) ；纯读：Current Time / Duration / Is Playing / Is Ended /
Is Muted / Volume ；事件槽：`ended` / `play` / `pause`（进 `BUILTIN_WIDGET_LOGIC_APIS`）。

**模型**：Set Motion / Set Expression / Set Skin / Set Param / Set Slot / Send Command（`await` 可选）；
纯读：Status / Current Motion / Current Expression / Current Skin ；事件槽：`ready` / `error`。
`command` 对齐引擎语义：**默认不阻塞，`await:true` 才等**。

### 5.3 唯一真正的新机械：命令式请求 + 活读数

既有宿主 API 是**声明式**的：`BlueprintHostApiBridge` 写 `WidgetRuntimeStateStore` 的覆盖值，
再 `scheduleElementFlush(elementId)` 让活控件重渲染。这套对 `volume`/`muted`/`loop`/`motion`/`skin`
完全够用（它们本来就是状态）。但有两类东西它装不下：

- **命令式一次性动作**：`play()` / `seek(t)` / `command(name, payload)`。
  建议编码：往覆盖存储里放 `{kind, payload, generation}`，renderer 的 effect 按 generation 变化施加到
  DOM 节点 / `session`。generation 计数器是必需的——否则「连续 seek 到同一时间点两次」第二次会丢。
  `await:true` 的 command 还要一条完成回传（latent 节点要能 settle）。
- **活读数**：`currentTime` / `duration` / `ended` / puppet `status` 在 DOM/backend 里自己变，
  存储不可能知道。**已确认 `signals` 装不下这个**——它只有 `hovered/active/focused/disabled`
  （`WidgetRuntimeStateContext.tsx:72`，`SystemInteractionSignals`），是 appearance 变体的条件通道。
  建议：加一条**非响应式的 per-element 活状态旁路**，renderer 只写、宿主 API 只读，
  与响应式覆盖存储分开——这样 `timeupdate` 每秒四次的写入不会引发重渲染风暴。

**执行者必须先把这条机械写成一页设计并等我拍板，再动手实现。** 这是本卡唯一会长成新架构的地方，
不许边写边定。

### 5.4 第二阶段的三个静默陷阱

1. **`export` ≠ `register`**：新的 `<name>Nodes.ts` 数组必须 spread 进 `built-in/index.ts` 的
   `allBuiltinBlueprintNodes`。漏了则节点在调色板和运行时都不存在，
   已存的图执行时才抛 `Behavior node definition missing`。`builtinNodeRegistration.test.ts` 守着这条。
2. **exec 节点的数据输出引脚要在 `graphParamResolvers.ts` 登记**：写侧是通用的
   （`GraphExecutor.ts:156` 把 `outputValues` 一律写进 `blueprintLocals`），
   **读侧 `resolveSelfOutput()` 是一条巨大的按类型分支链**。不加分支则下游静默读到 undefined。
   `graphParamResolvers.test.ts` 的 `listUnreadableDataOutputPins` 会全量扫出来并点名，是好守卫。
3. **蓝图 schema 版本（今天 10）不用 bump**，只加新节点类型不需要迁移；
   只有改**既有已发布节点**的 param/pin id 才要写迁移 + bump。

---

## 6. 执行编排

工作树：`D:/Temp/nls-surface`，分支 `feat/surface-video-and-spine`，从 develop `7c77eafd` 切出，
`node_modules` 已 junction，`yarn.lock` 已拷（yarn 4 没它拒跑）。

**`yarn lint` / `yarn build:dev` 在工作树里跑不起来**（yarn 会重新解析依赖，`.yarn` 状态被 gitignore）。
改用：
```bash
npx tsc --project src/shared/tsconfig.json --noEmit
```
四个工程（shared/main/renderer/runtime，另有 builtin-plugins）逐个跑；
构建用 `node project/build/build-{runtime,main,apps,builtin-plugins}.js --dev`。

顺序：WI-0（守卫，先红）→ WI-1（视频，顺带把 §3 那六个共享文件的改法立成模板）
→ WI-2（puppet 接缝，与 WI-1 并行，文件不重叠）→ WI-3（模型控件，接在 WI-1/WI-2 之后）
→ 第一阶段验收 → 第二阶段（§5.3 设计先拍板）。

**WI-1 与 WI-3 不并行**：它们都要改 `builtin/index.ts`、`runtime/builtin/index.ts`、
`insertPalette.ts`、两份 i18n 目录、`widgetLogic.ts`、`resourceDiagnostics.ts` ——
六个共享文件，并行只会互相盖写。WI-3 接在 WI-1 之后还能照抄一份已经跑通的模板。

---

## 7. 待办与已知风险

1. `posterAssetId` 是否被 `referenceModel.ts` / `surfaceResourcePreload.ts` 的通用遍历认出——
   它们特判了字面 `assetId` / `fontAssetId` / `imageFill`；`posterAssetId` 可能落空。WI-1 要实测。
2. runtime shim 的替换机制（构建期 alias？）没有勘验到底，WI-2 要写进报告。
3. `resolveGameRuntimeAssetUrl` 服务 `video` 资产要**实测**，不能因为 `video` 在
   `ASSET_TYPES` 里就假定通。
4. WebGL 上下文预算（§4 WI-3）——上限值定多少要实测，不要拍脑袋。
5. 第二阶段 §5.3 的设计未定，是本卡最大的不确定性。
