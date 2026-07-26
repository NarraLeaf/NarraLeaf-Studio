---
title: "task: L1 角色外观模型重做 — 两档外观、双迁移、消费面改造"
type: task
status: in-progress
date: 2026-07-26
parent: 2026-07-26-013-plan-layered-sprite-system.md
branch: feat/layered-sprite-system
worktree: D:/Temp/nls-layered
---

# L1 角色外观模型重做

母卡 `2026-07-26-013` §5「L1」。前置 L0 已完成并发布（**narraleaf-react 0.18.0**，
`origin/dev_nomen` @ `843210d`）；worktree 已装 0.18.0，**升级前基线 `yarn lint` 全绿**——
引擎升级对 Studio 是无痛的，本卡不需要为它做任何适配。

## 0. 与母卡的一处边界修正

母卡把故事文档 schema v9→v10 排在 L4。**改到 L1**：角色一旦从 `form/variant` 换成
`pose/tags`，故事行里的 `formName`/`variants` 就指向不存在的东西。两个迁移必须**原子发生**，
否则任何在 L1 之后、L4 之前打开的项目都是半迁移状态。

留在 L4 的是：选择器 UI 重做、编译器分层路径的打磨与诊断。

## 1. 两个设计决定（本卡内定，不上报）

**D1 —— 引擎按 tag 集合识别组，所以 Studio 不需要「声明层」概念。**
0.18.0 里「提供同一组 tag 的层由同一个组驱动」。Studio 的「轴」就是一组 tag；服务层只需保证
**同轴的每一层都列出该轴的全部 tag**（不画的写 `null`）。给轴加 tag 时自动给该轴所有层补
`null` 条目，删 tag 同理。这条不变式由服务层维护，UI 不需要知道。

**D2 —— 故事行引用稳定 id，不引用显示名。**
`pose`、`axis`、`tag` 都是 `{ id, name }`：`id` 稳定且直接用作引擎 tag 字符串，`name` 只是
显示标签。于是改名零代价、零引用重写；引擎要求的「tag 全局唯一」由 id 天然满足。
（现状是用名字当键，`renameVariant` 要手工搬 `variantAssets` 并修 `defaultVariant`——
那套搬运代码整个消失。）

## 2. 目标模型

```ts
export type CharacterAppearance =
    | { kind: "preset"; poses: CharacterPose[]; defaultPoseId: string | null }
    | { kind: "layered"; canvas: { width; height } | null;
        axes: CharacterAxis[]; layers: CharacterLayer[] };

type CharacterPose  = { id; name; folder?: string; assetId: string | null; portrait?: PortraitCrop };
type CharacterAxis  = { id; name; tags: { id; name }[]; defaultTagId: string | null };
type CharacterLayer = { id; name; axisId: string | null;   // null = 恒定层
                        assetId?: string | null;           // 恒定层的图
                        options?: Record<tagId, string | null> };  // 开关层：全轴 tag 齐备
// layers 数组顺序 = 从下到上
```

删除：`CharacterForm`、`CharacterVariantGroup`、`CharacterVariant`、`VariantData`、
`ICharacterAppearance`、`CharacterEditorProfile.defaultForm`、`CharacterForm.portrait`。

## 3. 工作项（按序，每项完成即 commit）

- **WI-1 模型与服务重写** —— `character/types.ts` 换成 §2；`CharacterAppearance.ts` 按两档重写
  （preset：pose CRUD / 排序 / 默认；layered：轴与 tag CRUD、层 CRUD 与重排、D1 不变式、
  `resolve(partialTags)` 补默认、`toLayeredDefinition(resolveUrl)` 产出引擎配置）。
  `CharacterProfile` 只删 `defaultForm`，其余不动。
- **WI-2 角色存储版本与迁移** —— `CharacterStore` 加 `version`（缺失 = v0）。
  v0→v1：每个「(form, variant) 且有资产」→ 一个 pose，`name` = 单 form 时用 variant 名、
  多 form 时 `form·variant`，`folder` = form 名；`defaultForm` + 组默认 → `defaultPoseId`；
  profile/form 的 portrait 落到对应 pose。**多组 form 的角色记入迁移报告**（旧模型下就是坏的）。
- **WI-3 故事文档 v9→v10** —— `character` 动作与 `StoryInlineEvent.expression` 的
  `formName`/`variants` → `pose?: string`（preset）/ `tags?: Record<axisId, tagId>`（layered）。
  迁移用 WI-2 的同一张映射表把 `(formName, variants)` 解析成 `poseId`；**解析不到留 error 诊断，
  不静默取图**，并给出"共 N 行无法解析"的汇总。
- **WI-4 解析与摘要** —— `characterVariant.ts` 删掉两条 fallback（尤其
  `Object.values()` 那条"随便挑一张"），换成显式 `null`；`characterSummaries.ts` 与
  `devMode.ts` 的 summary 换新形状。
- **WI-5 编译器** —— preset：`poseId` → URL，行为等价于今天；layered：用
  `toLayeredDefinition` 构造 `Image`（`getImage` 支持分层 src），`/show` 补全默认下发全量 tag、
  `/face` 只下发动过的轴（母卡 §3.4 的增量语义）。
- **WI-6 其余消费面** —— `ReferenceService`/`referenceModel`（层资产也要进引用图）、
  `characterSchema`、`storyCommandContext`、`StorySceneEditorRows` 行头像、
  `CharacterAppearancePicker`、角色编辑器面板、i18n 词条。
  **preset 档体验不退化；layered 档本卡只做最小可用**（能建、能存、能编译），
  完整层栈编辑器是 L2。

## 3.5 进度（2026-07-26）

**已落地**（`cb738f3b`，**树尚未编译通过**）：WI-1、WI-2、WI-3、WI-4、WI-5。
即模型、服务、角色存储版本与迁移、故事文档 v9→v10 与迁移、共享解析、摘要、编译器双档路径。

- 行内表情 token 无需特殊处理：引擎的 `TextEventAppearance = ImageSrc | Color | string[]`
  已经接受 tag 数组，分层角色直接传 tag。
- 编译器分层路径：`getImage` 的 `src` 放宽为「url/颜色 或 分层定义」——Image 的 src 形状在
  构造时固定，所以整栈必须在第一次触碰该角色时就位；之后的行只改 tag。

**WI-6 已完成的部分**（`711df7b8` + `a0cb4fc0`）：引用图（层资产按「层 × tag」建键，
否则同层多 tag 会塌成一条，少报引用）、舞台快照（跨行**累积** tag，否则在后面的行预演会丢掉
先前的轴改动）、命令面（存 id 不存名字，改名后旧行仍可解析）、属性面板、
`CharacterAppearancePicker` 重写（两档两套控件；分层档按轴分行、只存作者动过的轴，
未动的轴标「不改动」而不是「默认」——那是两个不同的断言）、行摘要族、i18n 词条。

`__default__` 哨兵组随 form 一起消失。

**已知债**：`characterForm` 这个语法 token 已经不再指 form（只有载荷改了）。改名要动十几个文件
加两份 i18n 目录，单独一张微卡处理。

**未做**（130 个错误）：

| 文件 | 错误数 | 性质 |
|---|---|---|
| `CharacterEditor.tsx` + `VariantsPanel` + `CharacterPropertiesEditor` + `FormsPanel` + `PreviewPanel` | 88 | 角色编辑器，需按两档重写（**最大一块**） |
| `storyCompiler.integration.test.ts` | 19 | 夹具用旧 summary 形状 |
| `StorySceneEditorRows.tsx` | 15 | 行徽章（分层角色暂显最底层，见 §5） |
| `storySceneBlockUtils.test` / `storyRuntimeDebugModel.test` / 其他夹具 | 8 | 夹具 |

**下一步**：`StorySceneEditorRows`（15，独立）→ 测试夹具（27，机械）→ 角色编辑器重写（88）。

## 4. 判据

1. `yarn lint`（tsc）全绿；`yarn test` 相对本机既有 8–9 条 win32 失败**无新增**。
2. 打开一个既有 demo 项目：角色全部变成 preset，故事行全部可解析或有明确诊断，
   **不出现静默错图**；迁移报告给出受影响行数。
3. 新建一个 layered 角色，手工填两个轴（服装 / 表情）与四层，能存盘、重载、编译成
   `LayeredDefinition`；`/face` 只改表情轴，服装保持。
4. 改一个 pose / tag 的显示名，故事行引用不失效（D2）。
5. 删掉一个轴的 tag，该轴所有层的 `options` 同步收缩（D1 不变式）。

## 4.5 验收结果（2026-07-26，orchestrator 亲手驱动 + 亲自读图）

补做上一轮欠下的那笔账。实例：worktree `D:/Temp/nls-layered` @ `feat/layered-sprite-l2`（develop
`b695f1ed`），`NLS_DEV_RELOAD_PORT=5601` + CDP 9401。工程用的是 `D:/Dev/test/nlstudio/demo3`
的**副本**（`D:/Temp/nls-l1-verify/demo3`，去掉 `dist/`），真工程一个字节没动。

上一轮说"新建/打开项目走原生对话框，CDP 驱不动"——那条是错的：
`app.addRecentProject(name, path)` 与 `workspace.launch({projectPath})` 两个桥都在，
worktree 实例的空项目列表可以直接播种。**占用窗口（`visibilityState === "hidden"`）
不影响 `Page.captureScreenshot`**，只影响虚拟列表的首次测量——重截一次即可。

| # | 判据 | 结果 | 证据 |
|---|---|---|---|
| 1 | lint / test 无新增失败 | ✅ 见 §3.5 基线 | — |
| 2 | 既有项目迁移：角色变 preset、故事行可解析、无静默错图 | ⚠️ 见 F6 | 角色库 `version: 1`，三个角色全部变 pose 列表；故事 `schemaVersion` 9→10 落盘；Dev Mode 实跑到第 3 行，Nattou 立绘正确 |
| 3 | 新建 layered 角色、两轴四层、存盘重载、`/face` 增量 | ✅ 数据/行为通过，**建档路径缺失见 F2** | 切 Expression 一次：`Brows`+`Mouth` 两层的 `img.src` 同时变（1524×344→815×332 / 82×43 两张不同 blob），`Body` 与常量层 `Badge` 的 src 逐字节不变；切 Clothing 只有 `Body` 变，表情保持 Angry；全量重启后层栈完整复原 |
| 4 | 改 pose 显示名，故事行引用不失效 | ✅ 行为通过，**改名 UI 缺失见 F3** | 行里存 `pose: "pirx6y3"`，把 pose 名从 `Nattou` 改成 `Summer Uniform` 后行摘要与徽章照常，落盘 id 不变 |
| 5 | 删轴的 tag，该轴所有层 `options` 同步收缩 | ✅ 行为通过，**删 tag UI 缺失见 F3** | 删 `Casual` 后 `Body.options` 由 2 项收缩为 1 项，Expression 两层不受影响 |

迁移报告的"多组 form"告警确实会弹（见 F5 的形态）：`demo3` 本身没有多组 form，
临时造了一份 `demo3b` 副本给 Nattou 的 `Normal` 加了第二个组，通知中心里出现
"…please check the result: Nattou › Normal"。

`legacyPoseId` 两侧一致（实测 `p` + fnv1a(`form`+NUL+`variant`) == 落盘 id），
所以两个迁移确实解耦。

### 发现的缺陷

| # | 缺陷 | 位置 | 归属 |
|---|---|---|---|
| **F1** | 三条新 i18n 词条用 `{{name}}`，而本仓的插值语法是 `{name}`，于是预览头部字面显示 `{4} drawn` / `Off-canvas: {…}` | `catalog/{en,zh}/characters.ts` 的 `editor.layerCount`、`editor.canvasMismatch` | 微卡（同类旧债：`story.emptyHint` 的 `{{trigger}}`，来自 `83fea6f1`，一并修） |
| **F2** | **没有任何入口能建 layered 角色**：`CharacterService.createCharacter(name, kind)` 支持，`CharacterPanel.tsx:294` 永远只传 name → 一律 preset；`setKind` 也无 UI 调用方 | `CharacterPanel.tsx` | L2 |
| **F3** | pose / 轴 / tag / 层**全都不能改名**，tag 也不能删：`CharacterAppearance.rename`/`removeTag` 在 UI 里没有调用方，编辑器建出来的东西永远叫 "New axis"/"New layer" | `CharacterEditor.tsx` | L2 |
| **F4** | 属性面板对 layered 角色仍渲染 preset 专属的「默认姿态」下拉（显示"Follow first pose"） | `CharacterPropertiesEditor.tsx:96,533` | L2 |
| **F5** | 迁移告警是**硬编码英文**且走 `showError`（红色错误），卡里说的是"标黄" | `CharacterService.ts:199-202` | 微卡 |
| **F6** | v9→v10 只在 `formName` **和** variant 都在时才写 `pose`。老行大量是「只有 variants、没有 formName」（`demo3` 唯一那行就是），于是选择被**整个丢掉**、静默回落到默认 pose——正是本卡要消灭的"静默错图" | `storyModel.ts:406-415` | 需裁决，见下 |

**F6 裁决（用户 2026-07-26）：放弃兼容，不为现有测试工程的形状定方向。**
迁移保持独立——不读角色库、不补 `defaultForm`、不写哨兵。老行少写了 `formName` 就是少写了，
迁移后回落默认 pose，作者自己重指。这条不再是待办。

## 5. 明确不做（留给后续卡）

- 层栈编辑器、实时合成预览、诊断面板（L2）
- PSD 导入（L3）
- 选择器 UI 重做、组合浏览器（L4 / L5）
- `SpriteCompositor` 合成服务——本卡行头像对 layered 角色**暂时显示最底层**并标记待办，
  不假装已经合成（母卡 §3.5 是 L4 的活）
