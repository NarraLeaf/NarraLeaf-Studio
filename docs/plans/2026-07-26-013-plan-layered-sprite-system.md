---
title: "feat: 分层立绘系统 — 角色外观模型重做 + PSD 导入"
type: feat
status: draft
date: 2026-07-26
branch: feat/layered-sprite-system
worktree: D:/Temp/nls-layered
---

# feat: 分层立绘系统

现状是「一个角色的一个差分 = 一张成品图」。目标是让 Studio 成为一个**分层立绘编辑器**：
作者定义层栈与差分轴，运行时按 tag 组合实时叠加；素材从 PSD 导入。

本卡的结论先行，三条，后面全部围绕它们展开：

1. **引擎有一个阻断级缺口。** NLR 0.17.1 的分层模型把「层」和「tag 组」绑死了——一个差分轴
   只能驱动一层。而分层立绘存在的理由正是「一个"生气"同时换眉、眼、嘴三层」。这条不补，
   Studio 做出来的分层立绘只能是"每层各选各的"，比现状还难用。**必须先落一张引擎卡（L0）。**
2. **层必须等画布，这是硬约束不是建议。** 引擎对每层独立做 autoFit 缩放，尺寸不一致的层
   不是"偏一点"，是被各自拉伸到舞台宽度。PSD 导入的第一职责就是保证这一点。
3. **现有角色外观模型不是"缺一档"，是坏的。** 多组差分时按「第一个有图的变体」取图，
   取不到就**随便挑一张**。所以本卡不是加一个 `kind`，是重做角色外观子系统。

---

## 1. 现场勘验

### 1.1 引擎能力（narraleaf-react 0.17.1，`dev_nomen` @ `1ea5846`）

分层立绘已经存在且可用，模型如下（`src/game/nlcore/elements/displayable/image.ts:96-125`）：

```ts
type LayerVariants = Record<string, string | null>;          // tag → src，null = 该 tag 下不画
type LayerResolver = (tags: ReadonlySet<string>) => string | null;
type LayerSlot     = string | null | LayerVariants | LayerResolver;   // 从下到上
type LayeredDefinition = { layers: LayerSlot[]; defaults: string[] };
```

| 能力 | 位置 | 说明 |
|---|---|---|
| 层栈解析 | `image.ts:285-308` | 数组顺序 = 叠放顺序；`null` 层不渲染 |
| 增量切换 | `image.ts:575-610` | `char(["sad"])` 只改"sad"所在的组，其余轴保持——**这是分层的核心语义** |
| 存档往返 | `layeredImage.test.ts:90-103` | 序列化的是 tag 不是 URL，改图不废存档 |
| 整栈过渡 | `Image.tsx:36-40`、`layeredStackStyle.test.ts` | 透明度/亮度写在栈的包裹层，**绝不落到单层**（否则层与层之间互相透） |
| 预加载 | `image.ts:315-333` | 各层变体之和，不是笛卡尔积——这是分层相对预合成的最大收益 |

### 1.2 引擎缺口（本卡要补的）

**G1 — 一个 tag 组只能驱动一层（阻断级）**

`normalizeSrcDefinition`（`image.ts:713-731`）把 tag 组直接定义成「每个 variants 层的键集」：

```ts
groups: src.layers.filter(Image.isLayerVariants).map(slot => Object.keys(slot)),
```

而构造校验（`image.ts:770-778`）要求 **tag 全局唯一**，重复即 `Tags in groups must be unique`
（`layeredImage.test.ts:77-87` 锁定了这条）。两条合起来：**眉毛层和嘴巴层不可能共用同一个
"生气"tag。**

唯一的绕法是让其中一层写成 `LayerResolver` 函数。但——

**G2 — resolver 层的图永远不进预加载**

`getAllLayerSrc`（`image.ts:315-333`）只收集常量层和 variants 层，注释明写
"Resolver slots are opaque and skipped"，引擎自己的测试把这个行为锁死了
（`layeredImage.test.ts:51-55`：resolver 产出的 `tears.png` **不在**预加载表里）。

所以 G1 的绕法会导致：**表情一切换，眉毛和嘴巴现下载现解码 → 必闪**。G1 + G2 =
分层立绘在 Studio 里目前没有可用路径。

**G3 — 层必须与画布等尺寸**

两处叠加：

- 每层用 `position:absolute; top:50%; left:50%; transform:translate(-50%,-50%)` 居中
  （`Image.tsx:24-34`）——裁剪过的层会按各自中心对齐，而不是按文档坐标。
- `autoFit` 对**每一层独立**生效（`AspectScaleImage.tsx:119-121`）：

  ```ts
  const autoFitFactorWidth = autoFit ? (game.config.width / img.naturalWidth) : 1;
  ```

  Studio 编译器给角色立绘传的正是 `autoFit: true`（`storyCompiler.ts:1845/1852/1866`）。
  于是一个 200px 宽的帽子层会被**放大到整个舞台宽**。

结论：分层立绘的每一层必须是**同一画布尺寸、内容处在文档原位**的透明 PNG。
这不是可以靠"注意一点"规避的，是必须由导入管线保证、由编辑器诊断拦截的。

代价要认：8 层 1000×1800 全画布 ≈ 58MB 解码内存/角色，2000×3000 则 ≈192MB。
文件体积影响不大（大片透明区 PNG 压得很好），**内存与解码时间影响真实**，见 §4 的 E4。

**G4 — 层栈在构造后不可改**

`config` 是 `Readonly<ImageConfig>`（`image.ts:343`），`src` 在构造时归一化后固定。
所以「换一套层栈」= 换一个 `Image` 实例。这直接决定了 §3.2 里 form 的处置方式。

**G5 — 分层图没有单一 URL**

`Image.getSrcURL` 对分层图返回 `null`（`image.ts:257-258`）。Studio 里所有"拿角色的一张图"
的地方都要改成合成，见 §3.5。

### 1.3 Studio 现状

数据模型（`src/renderer/lib/workspace/services/character/types.ts:75-87`）：

```ts
CharacterForm { name; groups: [{ name, defaultVariant, variants: [{name}] }];
                variantAssets: Record<variantName, { data: Asset }>; portrait? }
```

**它表达不了组合。** `variantAssets` 用**单个变体名**索引一张成品图，所以两个组
（服装 × 表情）根本没有落点。实际解析规则（`src/shared/utils/characterVariant.ts:49-68`）：

```ts
for (const name of variantNames) { if (有图) return 它; }   // 第一个有图的变体胜出
for (const entry of Object.values(variantAssets)) { if (有图) return 它; }  // ← 随便挑一张
```

第二个 for 循环是本轮要治的最恶劣行为：**选不到就静默显示一张错图**，作者看到的是
"差分没生效"，而不是"这个差分不存在"。编译器（`storyCompiler.ts:3070-3072`）和
故事行头像（`StorySceneEditorRows.tsx:2492-2493`）共用这条规则，所以编辑器和运行时
一致地错。

其余勘验：

| 观察 | 位置 | 判定 |
|---|---|---|
| `__default__` 哨兵组 | `CharacterAppearancePicker.tsx:13-21,92-93` | 无组时凭空造一个组，再用 i18n 把名字换掉；模型漏进了 UI |
| 选择器"预览"列 | `CharacterAppearancePicker.tsx:208-216` | 显示的是**单个变体的图**，从不合成 |
| 角色预览面板 | `PreviewPanel.tsx:117-125` | 是个图片查看器（缩放/像素预览），不是立绘合成台 |
| 编译器建图 | `storyCompiler.ts:2291-2310` | `new Image({ src: <一个 URL 字符串> })`，无分层路径 |
| 差分切换 | `storyCompiler.ts:1877` | `image.char(url)` —— 每次换的是整张图 |
| 角色存档 | `CharacterService.ts:14-17` | `CharacterStore` **没有 schema 版本字段** |
| 头像裁剪 | `types.ts:49-54,83-86` | profile 一份 + 每 form 一份覆盖；分层下所有差分共画布，这份重复可以消掉 |
| 故事文档 | `document.ts:321-331,716` | `formName` + `variants: string[] \| Record<group,variant>`；schema v9 |

---

## 2. 裁决（用户 2026-07-26）

| 问题 | 裁决 | 影响 |
|---|---|---|
| form 怎么落到层栈 | **现有立绘设计欠考虑，重做整个角色外观子系统** | 不在旧模型上打补丁；form 降级为普通差分轴（§3.2） |
| PSD 地位 | **一次性导入向导** | 不常驻 PSD、不做双向同步；只保留层路径指纹用于重导重连（§5） |
| tag-based（预合成组合矩阵） | **不做**——那是裸用 NLR 的能力，对 Studio 隐形 | 三选一变**二选一**：预合成差分集 / 分层立绘 |
| 编辑器野心 | **核心 + 诊断** | 含组合浏览器与诊断；不含自动眨眼/口型、不含构建期预烘焙 |
| 建好后能否改档 | **可以冷切换，两档之间不做转换** | `kind` 可改；改档即清空该角色的外观数据并重建，不提供 preset↔layered 的任何自动转换。改档必须二次确认并说明"现有差分会全部丢失"，且要先查引用（故事行引用的 pose/tags 会全部失效，须给出受影响行数） |

---

## 3. 目标模型

### 3.1 两档外观，创建角色时二选一

```ts
type CharacterAppearance =
  | { kind: "preset";  ... }    // 预合成差分集：N 张成品图（N=1 即"普通单图"）
  | { kind: "layered"; ... }    // 分层立绘
```

`kind` 在创建角色时确定并写死。改档只能走**显式的有损转换向导**（`preset → layered` 无法自动
反推层，只能新建；`layered → preset` 可以烘焙成品图）——见 §9 仍然开放。

**preset**（现状的诚实版）：

```ts
{ kind: "preset";
  poses: Array<{ id; name; folder?: string; assetId: string; portrait?: Crop }>;
  defaultPoseId: string; }
```

扁平命名列表，`folder` 只是 UI 归类**不参与解析**。这一档砍掉了 `groups`——预合成图之间没有
正交轴可言，假装有正交轴正是现状坏掉的根因。故事行引用 `poseId`，选不到就是诊断，不再"随便挑一张"。

**layered**：

```ts
{ kind: "layered";
  canvas: { width: number; height: number };          // 必填；所有层必须等于它
  axes:   Array<{ id; name; tags: string[]; defaultTag: string }>;
  layers: Array<{                                     // 数组顺序 = 从下到上
      id; name;
      kind: "constant" | "switch";
      assetId?: string;                               // constant
      axisId?: string;                                // switch：本层受哪个轴驱动
      options?: Array<{ tag: string; assetId: string | null }>;
      declares?: boolean;                             // 该轴的"声明层"，每轴恰好一个
  }>;
  snapshots?: Array<{ id; name; tags: Record<axisId, tag>; portrait?: Crop }>; }
```

### 3.2 核心：轴与层解耦

**这是本卡与引擎现状唯一的实质冲突，也是全部设计的支点。**

`axes` 是独立于 `layers` 的一等概念。一个轴（"表情"）可以驱动**任意多层**（眉/眼/嘴/腮红）。
作者切的是轴，不是层。

`form` 因此不再是一等概念——它就是一个普通的轴（默认名"服装"）。一个角色 = **一张层栈**。
好处直接对应 §1.2 的 G4：换装不需要重建 `Image`，可以交叉淡入，且换装时表情**自动保留**。
"只有私服有外套"这类形态专属层，表达为一个受服装轴驱动、在其他 tag 上取 `null` 的跟随层。

映射到引擎：每个轴选**一个层**作为声明层（`declares: true`），其余同轴层是**跟随层**。
引擎侧需要 L0 支持跟随层——这正是 §4。

### 3.3 硬约束：等画布（诊断拦截，不是提示）

- 所有层资产的像素尺寸必须 == `canvas`。不等 = **error 级诊断，阻止该角色进编译**。
  理由见 §1.2 G3：不等的后果不是轻微错位，是层被各自拉伸到舞台宽度。
- 画布尺寸在建角色/导 PSD 时确定；后续换图按它校验。
- 编辑器提供"以第一张图为准设定画布"的一键动作，以及不等时的差值读数（而不是一句"尺寸不符"）。

### 3.4 故事侧的选择语义：增量

分层立绘的 `char([tags])` 天然是**增量**的（`image.ts:575-610`：只改传入 tag 所属的轴）。
故事文档因此这样定：

- `/show`（enter）：编译器补齐**全部**轴的默认值后下发——入场是绝对的。
- `/face`（expression）与行内表情 token：只下发作者**实际动过**的轴——是增量的。
  作者在第 10 行把表情改成"生气"，第 20 行把服装改成"私服"，第 20 行之后仍然是生气。
- 这是行为变更（现状每行都解析成一张绝对的成品图），要在迁移说明里明写。
- preset 档没有这个问题：`poseId` 永远是绝对的。

故事文档 schema **v9 → v10**：`character` 动作的 `formName`/`variants` 换成
`pose?: string`（preset）与 `tags?: Record<axisId, tag>`（layered）；`StoryInlineEvent.expression`
同步。迁移规则见 §8。

### 3.5 「一个 URL」的所有消费点 → 合成服务

G5 决定了这一步跑不掉。新增 `SpriteCompositor`（renderer 层服务）：

- 输入 `(characterId, tags | poseId, 可选 portrait 裁剪)`，输出一张合成位图的 object URL。
- OffscreenCanvas 逐层绘制；按 `characterId + 解析后的 tag 串` 缓存；层资产变更即失效。
- 缩略尺寸单独一档（行徽章 24–40px 不需要合成 2000px 原图，按需降采样后再合成）。

改造点（全部当前直接吃单个 assetId）：故事行徽章 `StorySceneEditorRows.tsx:2492`、
`CharacterAppearancePicker`、角色面板 `HeadThumbnail`/`PreviewPanel`、Dev Mode 快照、
story-motion 选择器、资产总览的角色分组卡。

`portrait` 裁剪同时从「profile 一份 + 每 form 一份」收敛为「每角色一份（画布归一化坐标）
+ 可选每 snapshot 覆盖」——分层下所有差分共画布，那份 per-form 覆盖失去存在理由。

---

## 4. L0 引擎卡 —— **已完成，待发布**

仓库 `../narraleaf-react`，分支 `feat/layered-shared-axis` 已合入 `dev_nomen`
（`96c4b2a` 代码 + `843210d` publish 提交）。**0.18.0 尚未上 npm**，见 §4.3。

### 4.1 实际改动（比原计划小得多）

原方案要给 `LayerSlot` 加一个 `{ variants, declares?: boolean }` 对象形态。落地时发现
**不需要任何新概念**：把「组」的身份从*层*改成*tag 集合*就够了。

```ts
// normalizeSrcDefinition 里的一行
groups: src.layers.filter(Image.isLayerVariants).map(slot => Object.keys(slot)),
// ↓ 改成按 tag 集合去重
groups: Image.collectLayerGroups(src.layers),
```

于是「提供同一组 tag 的层，由同一个组驱动」：

```ts
layers: [
    {uniform: "u_body.png", casual: "c_body.png"},
    {uniform: null,         casual: "jacket.png"},   // 仅私服有外套
    {happy: "brows_happy.png", angry: "brows_angry.png"},
    {happy: "mouth_happy.png", angry: "mouth_angry.png"},
    {happy: null,              angry: "vein.png"},
],
defaults: ["uniform", "happy"],   // 每个"组"一个默认值，不是每层
```

`char(["angry"])` 一次带动下面三层，服装不动。**跟随层就是普通的 variants 层**，所以
`getAllLayerSrc` 原封不动就已经覆盖它们——G2 的预加载缺口对 Studio 自动消失，一行没改。

- E1 ✅ 组按 tag 集合去重（`collectLayerGroups`）
- E2 ✅ 作用域层 = 跟随层里把不该画的 tag 写成 `null`，无新语法（示例中的外套层）
- E3 ✅ 预加载天然覆盖；`LayerResolver` 的不可枚举性写进了它的 JSDoc（保留为逃生舱的已知限制）
- E4 ⬜ 层偏移，**未做**（用户裁决：纯性能问题不要引入新概念），留 0.19 性能卡
- 顺带 ✅ `DevTools.getLayerSrcs(image, tags?)`——分层图没有单一 src（G5），编辑器宿主原本
  无处可读。走 `DevTools` 静态类，不扩公开面。

**兼容性**：去重只合并 tag 集合**完全相同**的层，而这种层在旧规则下一律抛错，
所以没有任何"曾经能跑"的配置被重新解释——只是原先抛错的现在能加载。

**新的易犯错误**：跟随层只写半组 tag（`{angry: "vein.png"}`）会声明出一个新组并与原组撞 tag。
错误文案现在会点名该 tag 并说明"提供同一 tag 集合的层共享一个组"。

### 4.2 验证

- 全量 `vitest`：**347/347 通过**（32 个文件）。新增 5 条测试锁定共享组、跟随层预加载、
  每组一个默认值、以及"不同 tag 集合共享 tag 仍然报错"。
- `eslint` 全 `src/` 干净；`prepublishOnly`（lint + 生产构建 + 声明）通过，
  `getLayerSrcs` 已进 `dist/game/nlcore/elements/built-in/DevTools.d.ts` 与 `dist/main.js`。
- 改动量：3 个文件，+129 / −8。

### 4.3 发布卡在 npm 令牌上（需要用户处理）

`npm publish` 被拒：

```
403 Two-factor authentication is required to publish this package
    but an automation token was specified
```

`NPM_TOKEN`（User 作用域，40 字符 `npm_` 开头）本身有效——注入后 401 变 403——但它
**没有勾选 Bypass 2FA**。铸新令牌与改 2FA 设置属于凭据操作，须由用户本人完成。
registry 上仍是 0.17.1，0.18.0 未发布，本地 `dev_nomen` 已就绪。

---

## 5. 里程碑

| # | 里程碑 | 规模 | 依赖 |
|---|---|---|---|
| **L0** | 引擎：轴/层解耦 + 预加载（0.18.0） | S/M | 无 |
| **L1** | 角色外观模型重做 + 服务层重写 + 迁移 | L | L0（类型对齐） |
| **L2** | 分层立绘编辑器：层栈 / 轴 / 实时合成 / 诊断 | L | L1 |
| **L3** | PSD 一次性导入向导 | M/L | L1（L2 完成后体验更好） |
| **L4** | 编译器与故事侧：schema v10、选择器、合成缩略图 | M/L | L1 |
| **L5** | 组合浏览器与诊断总览 | M | L2 L4 |

排期：L0 单卡先行。L1 落地后 L2 与 L4 可并行（不同文件区）。L3 跟在 L1 后、建议排在 L2 后。L5 收尾。

### L1 模型重做

- 新 `CharacterAppearance` 联合类型（§3.1）；`CharacterVariant`/`CharacterVariantGroup`/
  `CharacterForm`/`VariantData` 全部删除。
- `CharacterStore` 补 `version` 字段（现状没有，见 §1.3），写迁移入口。
- `characterVariant.ts` 的两条 fallback 规则**删除**，换成"解析不到 = 诊断"。
- `CharacterAppearance.ts` 重写：轴的增删改、层的增删改与重排、声明层的自动维护
  （每轴恰好一个声明层，删除声明层时自动改选同轴的另一层）、tag 全局唯一性校验与改名联动。
- 资产锁：`CharacterService.ts:266-300` 的锁/解锁要覆盖层资产（数量级从 N 个差分变成
  N×M 个层图）。
- **保留不动**：`CharacterProfile` 的姓名/昵称/描述/属性/标签/分组/accent color/关系图。
  本卡重做的是**外观**，不是整个角色服务。

### L2 编辑器

主编辑面 = **实时合成的立绘预览**（不是图片查看器），左侧层栈，右侧轴与差分：

- 层栈：拖拽重排（顺序 = 叠放序）、显隐（编辑期开关，不入数据）、锁定、常量层/开关层切换、
  重命名、删除。层项显示该层当前 tag 的缩略。
- 轴面板：轴的增删改、tag 的增删改、默认 tag、"该轴驱动哪些层"的双向可见（点轴高亮层，点层高亮轴）。
- 差分切换器：每轴一行分段控件，切换即时反映到预览；预览支持缩放/像素级查看
  （复用 `ImagePixelPreview`）与洋葱皮对比。
- 诊断（本档的一半价值）：
  - 画布尺寸不符（error，含差值读数）
  - 层缺图 / 轴缺默认值（error）
  - tag 重名（error，给改名建议）
  - 某轴无声明层（内部一致性 error）
  - 完全被上层覆盖的层（warning，靠 alpha 求交）
  - 层资产未被任何 tag 引用（warning）
- 头像裁剪：在合成结果上框选，写 `portrait`（画布归一化坐标）。

### L3 PSD 导入向导

- **依赖**：`ag-psd`（MIT，Node/浏览器双跑，PSD+PSB，图层树/组/蒙版/混合模式/不透明度）。
  这**新增一个第三方依赖**——UI 专业化那一轮的"不新增依赖"约束属于那一轮，本卡明确突破：
  自写 PSD 解析器不现实。
- **位置**：主进程 **utility process**，沿用 `compileGameRuntimeArtifactInWorker` 的离主线程
  模式（解析 + N 张全画布 PNG 编码会冻 UI）。
- 流程：
  1. 选 PSD → 解析图层树（组/层/可见性/不透明度/混合模式/图层蒙版/剪贴蒙版）。
  2. **映射界面**：左 PSD 树、右 Studio 层栈。默认规则——顶层组 = 一个轴，组内图层 = 该轴的 tag；
     组外图层 = 常量层。作者可全部改写：合并组、把两个组指到同一个轴、把某层标成跟随层。
  3. **烘焙**：每个入选图层单独渲染成**文档画布尺寸**的 PNG（用图层 left/top 补齐到原位——
     §3.3 的硬约束就在这一步兑现）。图层蒙版与剪贴蒙版按 PS 语义先合成进该图层；
     图层不透明度烘焙进 alpha。
  4. **混合模式拦截**：引擎只做普通堆叠。非 `normal` 的图层必须在向导里显式处理——
     二选一：(a) 与其下方图层合并烘焙成一层，(b) 跳过并告知。**不允许静默按 normal 导入。**
  5. 产出 N 个 image asset 进资产库（命名 `<角色>_<层>_<tag>`），自动建好 axes/layers/defaults，
     画布尺寸取自 PSD 文档尺寸。
  6. **不保留 PSD**（裁决）。只记录指纹 `{ fileName, docSize, layerPaths[], importedAt }`，
     重新导入同一份 PSD 时按 `layerPath` 自动重连映射并只更新变化的层——**保留映射记忆，不保留文件**。
- 规模守卫：图层数、单层像素、总体积的预估与上限提示（一份 60 层的 PSD 全量导入会造出 60 个资产）。

### L4 编译器与故事侧

- `getImage`（`storyCompiler.ts:2291-2310`）支持分层：首次触碰某角色时用其
  `LayeredDefinition` 构造 `Image`，而不是拿第一行解析出的 URL。
- `resolveCharacterImageUrl`（`storyCompiler.ts:3052-3073`）拆成两条：preset 返回 URL，
  layered 返回 tag 数组 + 已解析的层 URL 表。
- `char()` 调用点（`1871`/`1877`/`1943`）按档分流；`/show` 补默认、`/face` 走增量（§3.4）。
- 故事文档 schema **v9 → v10** + 迁移；`CharacterAppearancePicker` 重做为
  「每轴一列分段选择 + 合成预览」，`__default__` 哨兵一并删除。
- 行内表情 token（`StoryInlineEvent.expression`）同步；`TextEvent.expression` 目前吃单个 src
  （`storyCompiler.ts:1538`），分层下要确认引擎侧 `_setAppearanceSync` 的 tag 路径
  （`image.ts:623-637` 已支持 tag 数组）——**这条要在 L0 阶段就验一遍**。
- Dev Mode 角色摘要（`characterSummaries.ts`）随模型改。

### L5 组合浏览器与诊断总览

- **组合浏览器**：以矩阵/网格列出该角色能演出的全部差分组合（轴的笛卡尔积），
  每格显示合成缩略、标注缺图格。作者第一次能回答"这套层到底能演多少种差分"。
- 命名快照（snapshots）：把常用组合起名（"生气·抱臂"），编辑器内一键预览。
  是否允许故事行直接引用快照名 → §9 仍然开放。
- 诊断汇总进资产总览/问题面板，与 `ReferenceService` 打通（层资产被谁引用、删除拦截）。

---

## 6. 明确不做

- **tag-based 预合成组合矩阵**——裁决：Studio 不暴露。
- **自动眨眼 / 口型 / 语音驱动层**——本轮不做（编辑器档位裁决为"核心 + 诊断"）。
- **构建期把常用组合预烘焙成单图**——同上，登记为后续性能卡。
- **常驻 PSD / 双向同步 / 增量回流**——裁决为一次性导入。
- **层偏移与混合模式**（引擎 E4）——本轮以等画布兜住。
- **Live2D / Spine 等骨骼动画**——不在本卡射程。
- 不动蓝图编辑器、UI 编辑器、角色关系图。

---

## 7. 迁移

**角色外观**：现有 `forms/groups/variantAssets` → `preset`

- 每个「(form, variant) 且有资产」→ 一个 pose；名字 `form·variant`（单 form 时用 variant 名），
  `folder` 取 form 名。
- `defaultForm` + 各组 `defaultVariant` → `defaultPoseId`。
- `portrait`：profile 级 + form 级覆盖 → 落到对应 pose 上。
- **不自动升级到 layered**：成品图反推不出层。提供显式的"新建为分层角色"路径。
- 老数据里**某 form 有 ≥2 个组**的角色标黄：这份差分在旧模型里就已经是坏的
  （§1.3），迁移结果需要作者确认。

**故事文档 v9 → v10**

- `formName`/`variants` → 按同一规则解析成 `pose`。
- **解析不到的行留 error 级诊断，不静默取图**——这是对 `characterVariant.ts:63-68`
  那条"随便挑一张"的正面纠正，迁移后作者会第一次看到真实的破损数量，
  这是**预期的**，不是回归。
- 迁移报告要给出"共 N 行无法解析"的汇总，而不是逐行淹没。

---

## 8. 验收协议

沿用现行铁令：**执行者的报告与截图不构成验收，orchestrator 亲手拉起实例、驱动到指定状态、
亲自读图**。每张子卡自带进攻性判据。全局判据：

1. 一个 6 层 3 轴的角色，切"表情"轴一次，**眉/眼/嘴三层同时变**，其余层不动（截图 + 层 URL 断言）。
2. 切"服装"轴，表情**保持不变**（增量语义，§3.4）。
3. 首次切换任意轴，**不出现闪白**（预加载覆盖，L0 E3）。
4. 故意放一张尺寸不符的层图，编辑器给 error 且**阻止编译**，不是画面错位（§3.3）。
5. 导一份含图层组、剪贴蒙版、一个 `multiply` 图层的 PSD：组→轴映射正确、蒙版已合成、
   `multiply` 层被显式拦截而非静默导入。
6. 迁移一个现存 demo 项目：角色变 preset、故事行全部可解析或有明确诊断，无静默错图。
7. 分层角色在故事行徽章、选择器、Dev Mode 快照三处**都显示合成后的差分**，不是某一层。

---

## 9. 仍然开放

- 角色创建后**能否改档**：提供有损转换向导，还是禁止（只能新建 + 重指引用）？
- 命名快照能否被故事行直接引用（`/show 角色 生气抱臂`），还是只是编辑器便利？
  引用了就要进故事 schema 并处理快照改名/删除的引用完整性。
- preset 档的 `folder` 是否值得做，还是扁平列表 + 搜索就够。
- 引擎 0.18.0 的发布与 Studio 采纳时机（L0 落地后是立即 publish，还是攒到 L4 一起）。
- 层数上限与内存策略：是否需要在角色层面给出"该角色在舞台上约占 XX MB"的读数，
  以便作者在 E4 落地前自我约束。
