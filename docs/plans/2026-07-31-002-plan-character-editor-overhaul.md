# 角色编辑器整修 —— 人物面、头像授权、人物主色与蓝图消费

- 日期：2026-07-31
- 分支：`feat/character-editor-overhaul`（工作树 `D:/Temp/nls-charedit`，基于 `develop` @ `88662f94`）
- 触发：用户报告「Character 管理器的人物部分还相当简陋，没办法配置自动头像或者对某张立绘使用头像覆盖，
  操作手感奇怪，空间分配也不合理。而且曾经被承诺过的人物主色也没有实现（以及用户在蓝图中消费此类数据的能力也没有）」

## 0. 审计结论（三份只读审计的合并，全部有 file:line 证据）

### 0.1 「人物部分简陋」是**结构性**的，不是打磨问题

`preset`（静态立绘）这条路径上，编辑器 tab 实际只有两样东西：一张**永远显示默认姿态**的大图，
和一列 360px 宽的「Poses」。

- **最大的那块面板对 preset 是死的**：`CharacterEditor.tsx:290-291` 把 `visibleLayers` 硬绑到
  `poses.find(p => p.id === getDefaultPoseId())`；姿态行（`:437-470`）**没有 `onClick`**，
  `focus` 的类型只有 `"layer" | "axis"`（`:59`）。有 8 个姿态的角色只能看到 1 张图；
  想看第 5 个姿态，必须去 Properties 面板改「Default pose」（一次**真实的数据修改**）、看一眼、再改回来。
- **工具条对非 layered 直接 `null`**（`:372`），于是 preset 编辑器 = 标题条 + 一张死图 + 一列窄行。
- 检查器宽度**写死 360px 且不可拖**（`:346` `grid-cols-[minmax(0,1fr)_360px]`），
  是 `modules/` 里唯一一个固定宽度的编辑器分栏（对比 `StorySceneEditorTab.tsx:2042-2047` 有
  `ResizableHandle` + 持久化宽度）。
- 分层词汇泄漏到 preset 头部：`LayerStackPreview.tsx:82` 对一张静态立绘也报「绘制 1 层」。

### 0.2 「操作手感奇怪」的具体来源

| # | 症状 | 证据 |
|---|---|---|
| 1 | 新建姿态一律叫「New pose」，不编号；改名要 铅笔→模态→输入→回车 | `CharacterEditor.tsx:433-434`、`CharacterAppearance.ts:342-352`（无去重/编号）、`:442-448` |
| 2 | 模块内**零键盘支持**（无 `onKeyDown`/`tabIndex`/`role`），组头还显式 `focusable={false}` | `CharacterPanel.tsx:680` |
| 3 | 编辑器内所有删除**即点即删**，无确认、无撤销；而列表侧删角色**有**确认 | `CharacterEditor.tsx:466,511,551,648,718` vs `CharacterPanel.tsx:341` |
| 4 | 主操作藏在 hover 里（行的 `⋮`、tag 的改名/默认/删除） | `CharacterPanel.tsx:560`、`CharacterEditor.tsx:533` |
| 5 | 改名有两套机制两种手感：列表是模态，Properties 是**只在 blur 提交**的输入框 | `CharacterPanel.tsx:331` vs `TextField.tsx:28-42` |
| 6 | 改名后**tab 标题不跟着变**（开 tab 时抓的快照） | `useCharacterFocus.tsx:36-43` |
| 7 | 列表任何一次刷新都会重读全部缩略图并整列表闪一下 | `CharacterPanel.tsx:97-99 → 126-166` |
| 8 | 冻结守卫只加在少数几处，其余全部写操作在冻结工程里照样能改 | 已守：`:78,581,601`；未守：所有删除、`:637`、`:544`、`:377`、`:497` |
| 9 | preset 角色**零诊断**——没图的姿态是静默的，问题条永远不出现 | `characterDiagnostics.ts:47-48` 直接 `if (kind !== "layered") return []` |

### 0.3 「没办法配置自动头像 / 对某张立绘使用头像覆盖」

数据模型比 UI 走得远得多。能力矩阵（节选，完整版见审计）：

| 能力 | 模型 | UI 可写 | 备注 |
|---|---|---|---|
| 角色级默认头像 | ✅ `types.ts:60` | ✅ | Properties 面板 |
| 逐姿态覆盖（preset） | ✅ `types.ts:132-146` | ⚠ **只能设，不能清** | `AssetSelector` 单选没有页脚、点击即确认，`assets[0]?.id ?? null` 永远不为 null，`CharacterEditor.tsx:184` 的清除分支从 UI 到不了 |
| 逐组合覆盖（layered） | ✅ `types.ts:176-177` | ⚠ 藏在二级网格的 hover 里 | `CombinationGrid.tsx:49-58` |
| **裁剪框（角色级 `profile.portrait`）** | ✅ `types.ts:47-51`，setter `CharacterProfile.ts:149` | ❌ **零调用方** | i18n `characters.preview.setPortrait/resetPortrait/portraitTitle` 是**孤儿键**——被删掉的裁剪器留下的 |
| **裁剪框（逐姿态 `pose.portrait`）** | ✅ `types.ts:93`，setter `CharacterAppearance.ts:387` | ❌ **零调用方** | 却被烘焙器 `useCharacterAvatarBake.ts:92-94` 和故事行徽章 `StorySceneEditorRows.tsx:2617` **读取** |
| 手动重烘 | — | ❌ | `useCharacterAvatarBake` 返回的 `rebake` **零调用方**，`CharacterPanel.tsx:81` 直接丢弃 |
| 看一眼烘出来的头像 | — | ❌ | 授权 UI 里没有任何地方渲染 `character-avatar:*` |

**这就是「没办法配置自动头像」的字面成因**：自动头像 = `headCrop.ts` 的颈部启发式，
常数全部硬编码（`headCrop.ts:31-47`）；作者唯一的干预手段——裁剪框——**setter 在、读取方在、UI 被删了**。
启发式切歪了，作者除了逐姿态手绘一张覆盖图之外无路可走，而覆盖图选错了还**改不回来**。

另有一条真缺陷：**角色从未上过台时 `defaultAvatarAssetId` 到不了运行时**。
resolver 只由 `bindCharacterPortrait` 安装，而它只在上台操作里被调用
（`storyCompiler.ts:836,1039,2070,2078,2092,2120`）；puppet 走的却是无条件的
`setAvatar(url)`（`:2294-2310`）。两条路互相矛盾，而该字段自己的文档（`types.ts:52-56`）
承诺的正是「没有立绘时用它」。

### 0.4 「人物主色没实现」——一半属实，且比「没实现」更糟

字段**做了**，承诺的四个消费点**做了一个**，而**唯一能写它的 UI 是死代码**。

- 承诺出处：`docs/plans/2026-07-22-001-feat-story-editor-overhaul.md:40`（`| D1 | 角色颜色 | 采纳 |`）
  与 `:131-133` §5.1：「消费点：行名牌、组头、流程图、Dev Mode、（可选）下沉运行时对话框名牌色」。
- 现状：字段 ✅ `types.ts:45`；存取与序列化 ✅ `CharacterProfile.ts:136,140,200`；
  可读性守卫 ✅ `storySceneBlockUtils.ts:465-477`；
  **消费点仅剩故事行名牌** ✅ `StorySceneEditorRows.tsx:2416`。
- **写它的 UI 在 `CharacterPropertiesEditor.tsx:490-505`——整个文件 642 行、grep 只有自身定义、零调用方。**
  实际渲染 Properties 的是 `characterSchema.ts`，那里**没有颜色字段**。
  于是作者在故事编辑器里看得见彩色名牌，却没有任何地方能选那个颜色。
- Dev Mode 侧：`storyRowProjection.ts:56-60` 已经声明了 `color?: string` 这个槽，
  但 `DevModeCharacterSummary`（`shared/types/devMode.ts:76-83`）没有该字段，
  `StoryRuntimeDebugPanel.tsx:46-49` 只能填 `{ name }`——一个**已声明但填不满**的槽。
- 运行时侧：引擎**早就开了口**——`narraleaf-react` 的 `CharacterConfig = { color?, avatar?, portraits? }`。
  Studio 的编译器却构造 `new Character(displayName)` **不带任何 config**（`storyCompiler.ts:2710,2725`）。

### 0.5 「蓝图里消费此类数据的能力也没有」——确认为零

- 蓝图里**没有任何节点按引用读取某个角色的属性**。最接近的两个是
  `Get Nametag`（`gameNodes.ts:597-620`）与 `Get Speaker Avatar`（`:622-645`），
  都是「当前说话人」范围，不可寻址。
- `valueTypes.ts:6-14` 里**没有 character 引用类型**，`modules/blueprint-lite/` 里没有角色选择控件。
- 但**不需要新引脚类型**：节点参数支持 `dynamicOptionsSource`
  （`blueprint-nodes/types.ts:155`，既有用法 `"stories"` / `"storyScenes"` / `"surfaces"` / `"localizationKeys"`），
  一个 `"characters"` 动态源就能给出可寻址能力，代价低一个数量级。
- **必须记住的静默陷阱**：新的 data 输出引脚要在 `graphParamResolvers.ts` **两处**登记
  （白名单 `:2471-2482` + `resolveGameNodeOutput` 的 portId 分支 `:1381-1414`），
  漏一处就静默解析成 `undefined`。扫描测试 `graphParamResolvers.test.ts:97-110` 会兜住。
- 另注：`docs/plans/2026-07-15-004-feat-is-speaking-node.md` 的 `Is Speaking` 节点**也从未实现**，
  这是第二个「角色数据进蓝图」的烂尾承诺。

## 1. 不做什么（明确划界）

- **不做角色编辑历史/撤销服务**（`UIEditorHistoryService` 那种规模），本轮改为「删除前确认」。
- **不做全量键盘导航**，只做改名（F2/Enter/Escape）与删除确认这两处最扎手的。
- **不做列表侧的拖拽分组、手动排序、复制角色**——用户抱怨的是「人物编辑器」，列表侧另开卡。
- **不新增 blueprint character 引脚类型**，用 `dynamicOptionsSource` 参数达成可寻址。
- **不做「关闭自动头像」开关**（G7）与烘焙尺寸/配方的暴露——默认值是对的，先给出裁剪与预览。

## 2. 工作项

### 主题 E — 人物工作台（`modules/characters/**`）

- **E1 姿态驱动预览**：姿态行可选中，点击即在大图里预览该姿态；`focus` 增加 `"pose"` 臂。
  **预览选中 ≠ 改默认姿态**，默认姿态仍由行内既有的 "Default" 显式设置。
- **E2 姿态胶片条**：preset 预览下方给出全部姿态的缩略图条（当前预览高亮、默认姿态带标记），
  点击切换预览。这是填掉那块死空间的主要手段，也让「有几个姿态、哪个缺图」一眼可见。
- **E3 行内改名**：姿态/轴/标签/层的改名改为双击或 F2 进入行内编辑（Enter 提交、Escape 还原），
  取消模态；新建姿态自动编号（`Pose 1`、`Pose 2`…），不再全叫「New pose」。
- **E4 可拖宽检查器**：`360px` 固定列换成 `ResizableHandle` + 经 `PanelStateService` 持久化宽度，
  与 `StorySceneEditorTab` 同构。
- **E5 preset 诊断**：`characterDiagnostics` 覆盖 preset —— 姿态缺图、无任何姿态、默认姿态失效、
  重名姿态；问题条与既有的「点击跳转到出问题的对象」机械复用。
- **E6 措辞**：`LayerStackPreview` 的「绘制 N 层」只对 layered/stack 使用；preset 显示姿态名。
- **E7 冻结守卫补全**：编辑器内所有写操作（全部删除、`setLayerAxis`、`setAxisDefaultTag`、
  `setCanvasFromLargest`、`createTag`）一律过守卫。
- **E8 tab 标题跟随改名**。
- **E9 破坏性操作确认**：删除姿态/轴/标签/层/快照前确认（复用列表侧删角色的确认机械）。
- **E10 删除死文件** `editors/CharacterPropertiesEditor.tsx`（642 行）——它的颜色字段由主题 C 移植进 schema。
- **E11 主色可见**：角色列表行与编辑器头部显示主色（经 `isReadableAccentColor` 守卫）。

### 主题 A — 头像授权（同样落在 `modules/characters/**`）

- **A1 头像分区**：右栏一个正经的「对话头像」分区，按当前预览的姿态/组合显示**解析后**的头像
  （256px 预览 + 来源徽章：覆盖 / 烘焙 / 角色默认 / 无）。这是「看得见」的前提。
- **A2 裁剪框编辑器**（本轮的核心缺口）：在预览上拖一个方形裁剪框，写 `pose.portrait`
  （以及角色级 `profile.portrait` 作为缺省）；「自动」按钮清空回启发式。
  孤儿 i18n 键 `characters.preview.setPortrait/resetPortrait/portraitTitle` 复活。
  **不得逐帧重烘**：拖动中只改本地态，提交时才写模型（烘焙指纹见 `avatarBake.ts:75-89`）。
- **A3 覆盖可清除**：修 G1，覆盖能被移除；选择器显示当前值、标题不再叫「选择变体图片」。
- **A4 可发现性**：姿态行的头像按钮加 `title`；组合格的头像按钮在**已有覆盖时常显**。
- **A5 手动重烘 + 烘焙回执**：接上死的 `rebake`；把 `AvatarBakeReport` 的
  `unresolved/written/removed` 显示出来（「这个姿态没有可画的art，已回落到默认」不再是静默的）。

### 主题 C — 人物主色端到端（模型/schema/编译器/DevMode）

- **C1 授权 UI**：`characterSchema.ts` 增 `colorPicker` 字段（框架已支持 `type:"colorPicker"`），
  复用 `ColorPickerTrigger` 与 `RecentColorsService`；i18n 键**已存在于两个语言包**，
  但路径是 `characters.**properties**.color`（`en/characters.ts:230` 在 `properties:` 块里），
  不是本文初稿写的 `characters.editor.color`——初稿有误，以此处为准。
- **C2 Dev Mode 消费点**（承诺过、被丢掉的）：`DevModeCharacterSummary` 增 `color?: string`，
  `characterSummaries.ts` 带上，`StoryRuntimeDebugPanel.tsx:46-49` 填满那个已声明的槽。
- **C3 运行时名牌下沉**：`storyCompiler.ts:2695-2728` 把 `{ color }` 传进 `new Character(displayName, config)`。
  引擎侧无需改动——`CharacterConfig.color` 已经在那儿。
- **C4 对比度守卫**：任何新的着色面一律过 `isReadableAccentColor`。

### 主题 F — 头像回落缺陷（与 C 同属编译器侧）

- **F1**：角色从未上台时也要拿到 `defaultAvatarAssetId`。让 preset/layered 与 puppet 的两条路一致
  （puppet 已经是无条件 `setAvatar`）。

### 主题 B — 蓝图消费

- **B1 `Get Speaker Color`**：说话人范围，完全对照 `Get Nametag`；输出 `RGBAColor`。
  含 host-api 桥、`DialogStateBridge` 镜像（与 nametag/avatar 同一拍）、
  `graphParamResolvers` **两处**登记、预览侧对等。
- **B2 `Get Character`（可寻址）**：节点参数 `characterId` 走新的 `"characters"` `dynamicOptionsSource`；
  输出 `Name`(string) / `Color`(RGBAColor) / `Avatar`(ImageAsset|null)。
  角色表已随 Dev Mode bundle 发出（`bundleAssembler.ts:314-319`），本地查表即可，无需引擎参与。
- **B3 hex ↔ RGBAColor 必须在引脚边界转换**——两个子系统不共享表示
  （`valueTypes.ts:27-32` 与 profile 上的 hex 字符串）。照抄 `BlueprintColorValueControl.tsx` 的桥接。

## 3. 文件归属（并行执行的防撞约定）

| 代理 | 独占文件 |
|---|---|
| **E**（工作台 + 头像授权） | `src/renderer/apps/workspace/modules/characters/**`、`services/character/characterDiagnostics.ts`、`src/shared/i18n/catalog/{en,zh}/characters.ts` |
| **C**（主色 + 编译器 + DevMode） | `modules/properties/schemas/characterSchema.ts`、`modules/properties/fields/CharacterAvatarField.tsx`、`shared/types/devMode.ts`、`shared/utils/characterSummaries.ts`(+test)、`apps/dev-mode/**`、`lib/story/storyRowProjection.ts`、`lib/ui-editor/runtime/game/storyCompiler.ts` |
| **B**（蓝图） | `shared/types/blueprint/**`、`lib/ui-editor/blueprint-nodes/**`、`lib/ui-editor/blueprint-runtime/**`、`lib/ui-editor/runtime/app/DialogStateBridge.tsx`、`GameApp.tsx`、`useStoryPreviewGameUi.ts`、`modules/blueprint-lite/**`、`catalog/{en,zh}/blueprint.ts` |

`services/character/types.ts`、`CharacterProfile.ts`、`CharacterAppearance.ts` 已有本轮所需的全部字段与 setter
（`color`、`portrait`、`setPosePortrait`、`avatars`），**三个代理都不需要改它们**；确需改动时先报告。

## 4. 验收（orchestrator 亲自做，截图为证）

在 `D:/Temp/nls-charedit` 起实例（`--cdp-port=9377`、`NLS_DEV_RELOAD_PORT=5601`、
`--disable-features=CalculateNativeWinOcclusion`），工程副本 `D:/Temp/nls-charedit-proj`
（含 preset / layered / stack / puppet 四种角色）。逐条看：

1. preset 角色点第 5 个姿态 → 大图跟着换，且 `defaultPoseId` **没有**被改写（读 `character.json` 对账）。
2. 胶片条出现且缺图姿态有标记；检查器可拖宽并在重开 tab 后保持。
3. 姿态双击改名进入行内编辑；新建两个姿态名字不重复。
4. 裁剪框拖动 → 提交 → 头像分区里 256px 预览随之变化；「自动」能还原。
5. 覆盖能设也能清；清掉之后回落到烘焙结果。
6. 主色选择器出现在 Properties；改色后故事行名牌、角色列表、Dev Mode 控制台三处同步。
7. 蓝图里放 `Get Speaker Color` 与 `Get Character`，连到一个 widget 的颜色属性上，跑 Dev Mode 看真上色。
8. 冻结工程里编辑器的删除按钮全部禁用。
9. `npx tsc --project src/{shared,main,renderer,runtime,builtin-plugins}/tsconfig.json --noEmit` 全绿；`vitest run` 无新增失败。
