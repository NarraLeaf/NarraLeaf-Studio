---
title: "task: L3 PSD 一次性导入 — 解析、烘焙、混合模式拦截"
type: task
status: done
date: 2026-07-26
parent: 2026-07-26-013-plan-layered-sprite-system.md
branch: feat/layered-sprite-l3
worktree: D:/Temp/nls-layered
---

# L3 PSD 导入

母卡 `2026-07-26-013` §5「L3」。管线（§2–§4）与向导 UI（§5）都已落地并按母卡 §8 判据 5 验收，
见 §7。蒙版合成本来记在 §6「明确不做」，验收判据要求「蒙版已合成」，用户 2026-07-26 裁决一起做，
已实现，§6 相应改写。

## 1. 新依赖：ag-psd 31.0.2

母卡明确允许（「自写 PSD 解析器不现实」）。worktree 有自己独立的 node_modules 与 yarn 状态，
**不是指向主检出的 junction**，所以装它没有碰到别的会话。本仓 `yarn.lock` 是 gitignore 的，
所以改动只有 `package.json` 一行。

## 2. 管线

| 位置 | 做什么 |
|---|---|
| `src/main/buildWorker/psdWorker.ts` | utility process 入口。`read` 只回图层树（无像素），`bake` 才出图 |
| `psd/bakePsdLayers.ts` | `describePsd` / `indexLayers` / `rasterizeLayer` / `bakeLayers` |
| `psd/blendModes.ts` | 可分离混合模式的实现 + Porter-Duff over |
| `psd/initializePsdImageData.ts` | 见 §4 的坑 |
| `shared/utils/psdLayerPlan.ts` | 纯函数：拍平、默认映射、拦截判定、烘焙目标 |
| `shared/utils/pngOpaque.ts` | 新增 `encodeRgbaPng`（颜色类型 6）；原有的是类型 2 |
| `managers/psdImportManager.ts` + `handlers/psdImport.ts` | 起进程、原生选文件、临时目录授权 |

**几条设计**：

- **read 与 bake 是两条消息**，不是一次。作者必须先看到树、先决定混合模式怎么办，才轮到烘焙一个像素。
- **一次任务一个进程**。一次 read 把整张大图的每一层解压在内存里；让进程退出是把内存还回去最省事的办法。
  代价是 bake 要再解析一次文件。
- **回来的是文件路径不是字节**。六层立绘是上百 MB 的 PNG，而且走路径就能复用资产库自己的
  文件导入管线，不用长出第二套"造资产"的办法。主进程选临时目录并授权读，渲染层永远不报路径。
- **烘焙到全文档画布**：引擎在 `autoFit` 下对每层独立缩放，裁过的层会被单独放大到舞台。
  Photoshop 存的是裁过的层，这一步就是把它还原回文档坐标。
- **图层不透明度乘进 alpha**：引擎没有逐层不透明度，像素是它唯一能活下来的地方。
- **顶层组 = 轴，组内层 = tag，组外层 = 恒定层**。只有一个成员的组**不**建轴——单 tag 的轴驱动不了
  任何东西，引擎还会因为空组报错。
- **隐藏层直接丢**：Photoshop 用隐藏放草稿，导进来一个看不见的层跟 bug 没法区分。

## 3. 混合模式拦截

母卡：「非 normal 的图层必须在向导里显式处理——二选一：(a) 与其下方图层合并烘焙成一层，
(b) 跳过并告知。不允许静默按 normal 导入。」

- `merge` 是**真的合并**：用该层**自己的**混合模式合成到下面最近的一个保留层上。
- 只支持**可分离**模式（multiply / screen / overlay / softLight / difference …）。
  hue / saturation / color / luminosity 跨通道混合，做错了比不做更糟——这些只能 skip，
  `canMergeBlendMode` 就是给 UI 用来把 merge 这个选项关掉的。
- 底部没有可合并对象时，该层退化成自己一层，而不是消失。

## 4. 判据与结果（2026-07-26）

真机验收的是**管线**，用 ag-psd 现写了一份 fixture PSD（8×8，一个 Body、一个 Mood 组含
Happy/Angry、一个 multiply 的 Shade、一个隐藏的 Scratch），跑的是打包后的同一份模块：

| # | 判据 | 结果 |
|---|---|---|
| 1 | 读出树与元信息 | ✅ `Body` / `Mood/`（pass through）含 `Happy`+`Angry` / `Shade [multiply]` / `Scratch (hidden)` |
| 2 | 烘焙到全文档画布、位置正确 | ✅ 4×4 的 Happy/Angry 出来是 **8×8**、中心有色、四角 alpha=0 |
| 3 | merge 用的是该层自己的混合模式 | ✅ Body 200 灰 + multiply 128 → **100**。裸叠会是 128，不合并会是 200 |
| 4 | PNG 带 alpha | ✅ IHDR colourType 6 |
| 5 | 单测 | ✅ 24 条（bake 8 / blend 5 / plan 11），五个 tsconfig 全绿 |

**一个只有真跑才会露出来的坑**：`readPsd(..., { useImageData: true })` **不够**——ag-psd 仍然
调它的 canvas 工厂去**构造** ImageData，解第一层时就抛 "Canvas not initialized"。
只喂 `initializeCanvas` 的第二个参数（createImageData）就够了，canvas 那一半故意留成抛异常：
这个 worker 不该走到需要 canvas 的路径上，悄悄给个空 canvas 只会把错误变成一张空图。
这样也省掉了 node-canvas —— 为了读一个文件格式在三个平台上编译原生模块不值得。

另一个：ag-psd 把组的默认混合模式拼成 `"pass through"`（带空格），不是 `"passThrough"`。
`isUnsupportedBlend` 两种拼法都认。

## 5. 向导 UI

`PsdImportWizard.tsx`（角色编辑器 `components/` 下），入口是分层立绘工具条的第四个按钮
（Crop / Layers / Grid3x3 之后）。

**拦截就是那道闸。** 模态先读树、只显示映射，`Import` 一直是 disabled，直到**每一个**引擎无法
还原的混合模式都被作者点过 merge 或 skip 为止。不给默认值是有意的：给了默认值，「不允许静默按
normal 导入」就退化成「默认帮你选了，你没看见」。不可分离的模式（hue/saturation/color/
luminosity）的 merge 按钮直接 disabled，只能 skip。

**全程只增不删。** 认得出的 PSD 只刷新它上次建的那些槽，作者的改名、重排、换轴一律不动；
认不出的才新建。所以向导没有「会覆盖现有内容」这条路径，也就不需要二次确认。
页脚在烘焙前就报「新建 N 层，更新 M 层」。

**落地时补的三件事**（都不在原计划里，但判据要求或被判据暴露）：

- **图层蒙版**乘进 alpha（`rasterizeLayer`），含 `disabled`、`defaultColor`、
  `positionRelativeToLayer` 三种情况。ag-psd 把蒙版值抄在每个颜色通道上，读红通道。
- **剪贴蒙版**：剪贴层不单独成层、也不成 tag，而是按底层**自己的** alpha 裁剪后合并进底层
  （`PsdMergeSource.clip`）。底层 alpha 在任何 merge 之前快照——PS 的剪贴是对着那一层，
  不是对着累积画布。底层没被导入的剪贴层按 PS 语义丢弃，理由 `clip-base-dropped` 显示在
  「未导入」里，而不是悄悄摊平成一张全画布的图。
- **`toBakeTargets` 从 plan 读**而不是重读作者的决定，`planImport` 顺带修了一个真 bug：
  旧代码把「被合并掉的层」也算成该组的一个 tag，于是轴上会多出一个永远没有图的 tag。

**指纹**：`PsdFingerprint.layerPaths: string[][]` 改成
`slots: {path, layerId, tagId?}[]`——只有路径清单是重连不了的，得知道每层去了哪个槽。
写它的是 §3 的 `applyPsdPlan`，读它的是 `CharacterAppearance.findPsdSlot`（会校验 layer/tag
还在，作者删掉的读作 miss 而不是崩）。

**顺带修的 dev 环境缺陷**：`project/build/build-main.js` 有 psdWorker 的打包步骤，
`project/app/dev-electron.js` **没有**——`yarn dev` 下 `dist/main/psdWorker.js` 从来不存在，
任何一次导入都直接 "PSD worker exited before answering"。也就是说 PSD 导入在 dev 模式下
从第一天起就是死的，管线那轮验收走的是打包产物所以没照出来。已补上（和 compileWorker 那段
注释记的是同一个坑）。

## 6. 明确不做

- 常驻 PSD、双向同步、增量回流——母卡已裁决不做。
- 规模守卫（图层数/单层像素/总体积上限提示）：仍未做，登记在 §8。
- 合并落点跨组：`toBakeTargets` 把 merge 挂到下方最近的一个**叶子**上，而组会塌成多个叶子
  （一个 tag 一个），所以一个压在组上方的 multiply 只会并进最上面那个 tag。见 §8。

## 7. 向导验收（2026-07-26，orchestrator 亲手驱动 + 亲自读图）

判据与断言脚本在**看到实现之前**写好（母卡 §8 判据 5 展开成 A–F 共 24 条）。真机：worktree
dev 实例（`NLS_DEV_RELOAD_PORT=9230`），工程副本 `D:/Temp/nls-l3-verify/demo`，新建一个空的
分层角色 `PSD Import`。原生文件对话框走 Win32（`WM_SETTEXT` 到 id 1148 + `BM_CLICK` 到 IDOK）。

fixture 用 `ag-psd` 的 `writePsdBuffer` 现造，64×64，`children` 自下而上：
`Body`(32×32@16,16 灰200) → `Blush`(全画布纯红, **clipping**) → `Shade`(32×32 灰128,
**multiply**) → `Mood/`{`Happy`(黄, **带左半遮住的图层蒙版**), `Angry`(蓝)} →
`Glow`(**hue**) → `Scratch`(**hidden**)。

| # | 判据 | 结果 |
|---|---|---|
| A1 | 工具条第四个按钮，可见、22×22 | ✅ 顺序 `Set canvas / Onion skin / Combinations / Import PSD`，可见实例恰好 1 个 |
| A2 | 点击弹出模态 | ✅ 标题 `Import PSD`，面板 664×304 |
| B1 | 文档尺寸 | ✅ `64 × 64` |
| B2 | 组→轴映射 | ✅ 唯一一个轴 `Mood`，tag 恰好 `Happy` `Angry` |
| B3 | 恒定层 | ✅ 决定完混合模式后恰好 `["Body"]`；`Blush`/`Shade`/`Glow`/`Scratch` 都不在 |
| B4 | 丢弃项与理由 | ✅ `Scratch: hidden in Photoshop`、`Glow: skipped` |
| B5 | 拦截行 | ✅ 恰好两行：`Shade[multiply]`、`Glow[hue]` |
| B6 | 不可分离模式禁用 merge | ✅ `Shade.merge.disabled=false`，`Glow.merge.disabled=**true**` |
| B7 | 未决时 Import 禁用 | ✅ `disabled=true`，页脚「Decide what to do with 2 more」 |
| B8 | 决定后可导入 | ✅ `disabled=false`，页脚「3 to add, 0 to refresh」 |
| C1 | 画布取自文档 | ✅ `{width:64,height:64}` |
| C2 | 轴与 tag | ✅ 1 个轴、2 个 tag、默认 tag = 第一个 |
| C3 | 层与不变式 1 | ✅ 2 层：`Body`(常量,有图) + `Mood`(绑轴, options 两个键**全部非空**)；options 的键集 == 该轴 tag id 集 |
| D1 | 剪贴生效 | ✅ Body(0,0) α=**0**（Blush 是全画布的，没裁就会是不透明红） |
| D2 | 蒙版+混合都进了像素 | ✅ Body(32,32) = **(128,0,0,255)**：红 ⇒ Blush 合成进来了；128 ⇒ multiply 生效（裸叠是 255，不合并也是 255） |
| D3 | 图层蒙版生效 | ✅ Happy(20,32) α=**0**（被蒙版遮住的左半） |
| D4 | 蒙版另一侧完好 | ✅ Happy(40,32) = (255,255,0,255) |
| D5 | 等画布硬约束 | ✅ 两张资产都是 64×64（位图与资产元数据一致） |
| E1–E4 | 指纹 | ✅ `fixture.psd` / 64×64 / 三条 slot：`Body`→层`Body`(无 tag)、`Mood/Happy`→层`Mood`+tag`Happy`、`Mood/Angry`→同层+`Angry` |
| F1 | 重导不再建第二个轴 | ✅ 仍是 1 个轴，名字仍是作者改过的 `表情` |
| F2 | 作者的改名幸存 | ✅ 仍是 2 层，`layers[0].name` 仍是 `躯干` |
| F3 | art 就地刷新 | ✅ 三个 assetId 全部变成新的（tag id 不变，options 键集不变） |
| F4 | 指纹更新 | ✅ `importedAt` 1785104233209 → 1785104386828；重导前页脚就已经报「0 to add, **3 to refresh**」 |

资产命名也按母卡走：`000-PSD-Import_Body.png` / `001-PSD-Import_Mood_Happy.png`。

![向导的映射与拦截](reports/assets/l3-psd-wizard-review.png)

决定完之后：`Mood` 是轴、`Body` 下挂着「+ Blush clipped in」「+ Shade (multiply) merged in」，
`Glow`/`Scratch` 落到「Not imported」。

![导入结果](reports/assets/l3-psd-wizard-imported.png)

导完的合成预览就是判据 D 的肉眼版：深红的躯干（灰200 → 剪贴的红 → multiply 压成 128）
+ 右半边的黄（Happy 的左半被蒙版吃掉，露出下面的躯干）。

![重导后作者的改名与层序都还在](reports/assets/l3-psd-wizard-reconnected.png)

**方法说明**：F 的前置（把轴改名 `表情`、把层改名 `躯干`）走服务层，因为改名不是本卡要验的东西；
被验的重导本身全程走 UI（工具条 → 模态 → 原生选择器 → 两个拦截行 → Import）。

**基线**：五个 tsconfig 全绿；vitest 2433 通过 / 8 失败，8 条仍是 win32 既有基线（未新增失败）。
PSD 相关单测从 24 条增到 **38** 条（plan 20 / bake 13 / blend 5），另加 builder 11 条。

## 8. 留下的口子

- **规模守卫**：一份 60 层的 PSD 会造 60 个资产、每个都是全画布 PNG，向导现在一句提示都没有。
- **合并落点跨组**（§6 第三条）：压在一个组上方的 multiply 只会并进该组最上面那个 tag，
  别的 tag 得不到这层阴影。fixture 特意把 `Shade` 放在组下方绕开了这一点，所以本轮**没有验**它。
  正确做法多半是「并进该组每一个 tag」，但那是改 `toBakeTargets` 的语义，单独一卡。
- **非可分离模式只能 skip**：hue/saturation/color/luminosity 的层现在只能丢，不能保留。
