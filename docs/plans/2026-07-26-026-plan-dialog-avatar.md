---
title: "plan: 对话框头像 —— 当前说话人当前差分的一张图"
type: plan
status: in-progress
date: 2026-07-26
branch: feat/dialog-avatar
---

> **进度（2026-07-27）**：**WI-1～WI-5 全部完成**，本卡收尾。
> 运行时链路 + 离线烘焙 + 合成 id 三条解析臂 + 打包 + 触发都已落并有测试覆盖。
> 引擎侧顺带发了 `narraleaf-react@0.19.2`（`<Avatar>` 绕过自己的 image cache、
> 头像从未进过预加载器——两半都修了）。
> **下一卡（M2）**：作者 UI —— 逐差分指定覆盖头像、头像轴选择、裁剪框编辑、重烘按钮、
> 组合数诊断，以及 `defaultAvatarAssetId` 的入口。

# plan: 对话框头像

## Overview

表层需求是一个蓝图节点：**Get Speaker Avatar**，Game 类、pure、输出 `ImageAsset | null`，
让作者能在 dialog slot 的界面里摆一个 Image 组件显示当前说话人的头像。

真正的问题有两个，用户已经点破：**怎么知道角色现在是哪个差分**，以及**换头像不能有加载延迟**。

第一个问题的答案是一个发现：**引擎侧已经把它解决了，Studio 一直没接。**
`narraleaf-react@0.19.1`（能力在引擎 0.9.1 落地，commit `00cd5cf`，2026-05-11）已有完整的
dialog avatar API，而 Studio 全仓对 `addPortrait` / `setAvatar` / `useAvatar` 的引用数为 0。

第二个问题的答案也是确定的，而且引擎自己在文档里写明了病因（见 §2 硬约束 3）。

## 1. 目标与非目标

### 目标

1. 编译期把角色的立绘 Image 绑成 NLR portrait，并给角色装一个头像 resolver。
2. 离线烘焙：把每个差分的头像烘成 derived PNG，作为工程内容随包发布。
3. host API `game.getSpeakerAvatar()` + `Get Speaker Avatar` 节点（pure，输出 `ImageAsset|null`）。
4. 零延迟：预加载 + 同步 assetId→url 注册表，三个宿主一致。

### 非目标

- **不做作者 UI**（用户裁决：作者 UI 下一卡）。本卡把覆盖字段建出来并让运行时认它，
  但"逐姿态指定头像"的界面、头像裁剪框编辑器、重烘按钮都在 M2。
- **不做逐行头像覆盖**（`Sentence.avatar`）。引擎支持，但那要一条新的故事命令（`/avatar`），自成一卡。
- **不扩 value binding 让 Image 组件直接绑图**。消费路径走事件图（§5.1），扩绑定是独立的更大改动。
- **不动引擎**。这一卡全部在 Studio 侧，引擎能力是现成的。

## 2. 硬约束

1. **pure 节点的 `execute()` 是死代码。** `executeGraph` 只跟 exec 边，pure 节点的值来自
   `graphParamResolvers.ts` 的硬编码 resolver 分支（`resolveGameNodeOutput`，`:1363`）。
   **漏了分支，节点恒返回 `undefined` 且不报任何错。**（`Get Nametag` 的 `execute` 就是死代码。）

2. **引擎的 `isTagSrc` 不是"是不是分层"的判据。** 它是 `!!image.config.src`，而 `config.src`
   只在 tag/layered 定义时才被填；静态 src 的图走 `userConfig.src`。已核对
   `Avatar.tsx:32-34` 的 `[...portrait.state.currentSrc as string[]]`：对 preset 角色
   `isTagSrc` 为 false，不会把 URL 字符串摊成字符数组。**这条依赖引擎内部的实现细节，
   引擎一改 `config.src` 的填充时机就会静默变成一串单字符 tag。** 反查表必须对
   "tag 不在任何轴里"这种输入返回 null，而不是崩或者猜。

3. **resolver 返回的 src 对预加载器不可见。** 引擎在 `LayerResolver` 的文档注释里明写：
   resolver 是不透明的，它能返回的 src 预加载器看不见，**首次使用时才现取**。
   头像 URL 只活在闭包里，从不出现在任何 action 中，所以 NLR 的预测扫不到。
   必须显式 `scene.preloadImage(avatarUrl)` —— 这正是"会闪一下"的根因。

4. **Dev Mode 的资产解析是两跳 IPC + 一次性授权。**
   `devModeAction.ts:123` 的 `resolveDevModeAssetUrl`：dev-mode 窗口 → main → workspace 窗口，
   拿一个 `app://fs/{hash}` 的一次性读授权再 promote。首次换图必然可见地闪。
   packaged runtime 走 `nlgame://` 同步查表（`gameRuntimeBridge.ts:10`），workspace 预览走
   blob。**三个宿主三条路，必须有一层同步注册表把它们抹平**（先例：`devModeSavePreviewAssets.ts`）。

5. **`findCurrentPortraitForCharacter` 要求立绘在台上且可见。** `gameState.ts:446-475` 从最上层
   往下找第一个可见的、已注册为 portrait 的 displayable。角色没上台 / 已 `/exit` → 返回 null，
   `ctx.portrait` 与 `currentSrc` / `tags` 全是 null。resolver 必须能在这种输入下回落到角色级默认头像。

6. **旁白没有头像。** `resolveDialogAvatar` 在 `!character.state.name` 时直接返回空
   —— 与引擎 `useDialog().isNarrator` 同一条规范规则。节点对旁白输出 `null`，这是对的，不要绕过。

7. **UUID 绝不能进 UI。** 头像的合成键、烘焙文件名都含 characterId（UUID），
   它们是文件系统与运行时的标识，**不得出现在任何作者可见的字符串里**（既有硬规则）。

8. **编译器的 character map 是惰性的。** `getCharacter()` 只在某 block 引用到该 characterId 时建实例。
   对头像无害（没说过话的角色不可能是说话人），但意味着 portrait 绑定必须挂在
   **建角色立绘 Image 的那一刻**，而不是遍历角色表。

## 3. 核心模型

### 3.1 差分 → 头像：引擎已经把"当前差分"算好了

```
Studio 编译期                                  NLR 运行期（dialog 渲染的同一帧）
────────────                                  ──────────────────────────────
getImage(ctx, name, {src})                     useAvatar()
  └─ character.addPortrait(image)      ───►      └─ gameState.findCurrentPortraitForCharacter(character)
  └─ character.setAvatar(resolver)                     └─ 台上最上层可见的那张 portrait
                                                 └─ currentSrc = Image.getSrcURL(portrait)   ← preset 的当前 pose URL
                                                 └─ tags      = portrait.state.currentSrc    ← layered 的当前 tag 组合
                                                 └─ resolver({ currentSrc, tags, ... }) ─► 头像 URL
```

**为什么这条链是对的**：它读的是**活的 Image 状态**，不是事件日志。所以撤销、读档、skip、
row-precise 启动全部天然正确 —— 而 Studio 自己维护镜像（`onCharacterPrompt` 那种边沿触发的
ref）在回滚下必然残留脏值，这一点 `2026-07-15-004` 已经论证过一次。

**tag id 是 Studio 自己的 id**：`storyCompiler.ts:1876` 传给引擎的就是 `Object.values(selection)`，
即 `CharacterNamed.id`。反查零成本，不需要任何字符串约定。

### 3.2 头像来源：离线烘焙 + 姿态覆盖（用户裁决 2026-07-26）

角色模型今天没有"头像"这个概念：preset 只有每个 pose 一张立绘，layered 连单图都没有
（`Image.getSrcURL` 对分层返回 null，这正是 L4 造 `SpriteCompositor` 的原因）。

所以头像是**烘焙产物**：合成 → 按头部框裁剪 → 缩放 → PNG，作者时写进工程，随包发布。
照抄 `iconBake.ts` 的形状（作者时烘焙、指纹门控、字节稳定、derived 是工程内容不是缓存）。

**烘焙键**（`characterAvatarKey`）：

| 档 | 键 | 数量 |
|---|---|---|
| preset | `poseId` | pose 数 |
| layered | **头像轴**集合的笛卡尔积，tag id 排序后拼接 | ∏ 各头像轴的 tag 数 |

`avatarAxisIds` 缺省为**全部轴**（诚实），作者可以缩到只有表情轴来控制数量；
超过阈值出诊断而不是静默烘 200 张。排序入键沿用 `spriteCompositeKey` 的既有约定：
一个 tag map 的插入顺序是"哪一行先写的"的偶然结果，两行摆出同一个姿势必须命中同一个键。

**覆盖**：每个键可以带一个 `overrideAssetId` 指向作者自己画的头像，优先于烘焙产物。
本卡建字段并让 resolver 认它；设置它的界面在 M2。

### 3.3 头像资产的身份：合成 id，不进资产库

烘焙产物**不注册成项目资产** —— 一个角色可能烘出几十张，把它们塞进作者的资产库是污染。
走合成 assetId（先例：`devModeSavePreviewAssetId` / `parseDevModeSavePreviewAssetId`）：

```
avatar:<characterId>:<key>   ←→   resources/characters/avatars/<characterId>/<key>.png
```

三个宿主各接一条解析臂：
- packaged：打包时把 derived 目录扫进 `assetManifest`（`gameRuntimeArtifactCompiler.ts:459`
  的 `copyProjectAssets` 之后加一趟），于是 `assetUrl(合成id)` 零改动就能用。
- Dev Mode / workspace：`useAssetObjectUrl` 前置查同步注册表（§4 WI-5）。

## 4. 实现计划

| WI | 内容 | 主要落点 |
|---|---|---|
| **WI-1** | 模型与身份：`CharacterAvatarEntry`（baked + override）、`avatarAxisIds`、`characterAvatarKey()`、合成 id 的构造/解析 | `services/character/types.ts`、`shared/types/devMode.ts`、`shared/utils/characterAvatar.ts`（新） |
| **WI-2** | 烘焙：合成（复用 `SpriteCompositor.composite`）→ 裁剪（`portrait` 显式框优先，否则 `headCrop`）→ 256px PNG → 指纹门控写盘 | `modules/characters/avatarBake.ts`（新）、`ProjectService` 的写盘 IO |
| **WI-3** | 编译期绑定：summary 带头像表；建角色立绘时 `addPortrait`；`setAvatar(resolver)`；全量 `preloadImage` | `characterSummaries.ts`、`storyCompiler.ts` |
| **WI-4** | 宿主与节点：`useAvatar()` 镜像进 blueprint 全局 state → host API → 节点 + **resolver 分支** + i18n | `DialogStateBridge.tsx`、`BlueprintHostApiBridge.ts`、`gameNodes.ts`、`graphParamResolvers.ts` |
| **WI-5** | 零延迟：同步 assetId→url 注册表、打包 manifest 加 derived 条目、decode 预热 | `characterAvatarAssets.ts`（新）、三处 `useAssetObjectUrl`、`gameRuntimeArtifactCompiler.ts` |

WI-4 的三个既有陷阱（照 `2026-07-15-004` 踩过的坑）：
- `hostApi.ts` contract version 25 → 26。
- i18n 要改**三处**：`en/blueprint.ts`、`zh/blueprint.ts`、以及 `blueprintNodeI18n.ts` 的
  `NODE_TITLE_KEYS`（按英文 displayName 索引，**无测试覆盖，漏了静默 fallback 成英文**）。
- `builtinBlueprintNodes.test.ts` 的**三处** game mock 都要补，否则 typecheck 挂。

时钟不用新建：`refreshAll` 是 key-agnostic 的，任意 `globalSet` 重算所有 value graph，
而 `DialogStateBridge` 每次对话变化都已经在 `globalSet` nametag —— 头像镜像挂同一个 effect 即可。

## 5. 已知限制

### 5.1 消费路径是事件图，不是值绑定

`SUPPORTED_VALUE_TARGETS`（`BlueprintValueRuntimeStore.ts:155`）只有
`nl.text.text` / `nl.button.label` / `frame.params` / `nl.slider.value`，
**Image 组件的图源不能绑 value graph**。所以作者的消费形态是：

> dialog slot 的 surface-main 蓝图：`On Flush` → `Get Speaker Avatar` → `Set Image Properties`

这条今天就通（`DialogStateBridge` 每次对话变化调 `flushSlotElements`）。扩 value binding
支持 `ImageAsset` 是更好的形态，但那是独立的更大改动，不在本卡。

### 5.2 角色不在台上就没有当前差分

见硬约束 5。这时头像回落到角色级默认。**这不是 bug 是语义**：画外音角色说话时没有"当前差分"
可言，与其猜一个不如给一个稳定的默认头像。

### 5.3 烘焙的组合数是作者的责任

`avatarAxisIds` 缺省全轴，三条轴各 4 个 tag 就是 64 张头像。诊断会报，但不会替作者裁决。
M2 的 UI 应该把这个数字直接摆在作者眼前。

### 5.4 两个 pose 共用同一张立绘

preset 的反查是 `currentSrc`(URL) → assetId → poseId。两个 pose 指同一张立绘时反查有歧义，
取第一个。可接受：它们的立绘本来就一模一样。

## 7. WI-2 落地记录（烘焙及其尾巴）

1. **烘焙**：`avatarBake.ts`（编排，注入渲染器所以能在 node 里单测）+ `avatarRenderer.ts`（canvas 那半）。
   与 `iconBake.ts` 同形：作者时烘、指纹门控、字节不变不写盘。
   - 裁剪优先级：pose 级 `portrait` > profile 级 `portrait` > `findHeadCrop()`（纯函数，跑在**合成结果**上
     ——角色的头未必由最大的那层画）
   - 裁剪不是方的就**留白而不是拉伸**：把脸压扁比透明边更糟
   - 指纹**不读源字节**：`Asset.hash` 已在资产元数据里。指纹 = hash(recipe + 边长 + 裁剪框 + 有序层 hash)。
     **层 id 不入指纹**——重命名层或调轴序不改变画面，为此重烘只会无谓地搅动版本库
   - 作者给了覆盖的差分**不烘**，并把该键下的旧烘焙删掉
2. **合成 id 三条臂**：packaged 走打包时多扫一趟 derived 目录进 `assetManifest`；
   workspace 与 Dev Mode 走 `resolveWorkspaceAssetUrl` 的两个 resolver（授权版与 blob 版都加了臂）。
   `writeProjectIconBake` 抽成了按 relativePath 建父目录的 `writeProjectDerivedFile`，图标那个改成委托。
3. **触发**：`useCharacterAvatarBake` 在角色面板打开时对账（照 `bakeProjectIcons` 的
   「safe to call on every panel open」）。**不挂在每次编辑上**——作者拖裁剪框时编辑是连续的，
   对每一下都渲染几十张 PNG 是纯浪费。

## 6. 待决

- **D1** —— `avatarAxisIds` 的缺省：全轴（诚实但可能爆炸）还是空集（只用角色级默认，作者显式开）？
  本计划取全轴 + 阈值诊断，M2 的 UI 落地时可以推翻。
- **D2** —— 烘焙的触发时机：角色编辑器打开时对账（照 `bakeProjectIcons` 的"safe to call on every
  panel open"），还是显式按钮？本计划取前者 + M2 补手动重烘。
