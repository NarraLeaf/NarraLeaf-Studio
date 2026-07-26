---
title: "task: L3 PSD 一次性导入 — 解析、烘焙、混合模式拦截"
type: task
status: in-progress
date: 2026-07-26
parent: 2026-07-26-013-plan-layered-sprite-system.md
branch: feat/layered-sprite-l3
worktree: D:/Temp/nls-layered
---

# L3 PSD 导入

母卡 `2026-07-26-013` §5「L3」。**本卡只完成了管线，向导 UI 未做**——见 §5，别把它当成 L3 收工。

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

## 5. 未做：向导 UI

**这是 L3 剩下的全部，也是本卡 status 仍是 in-progress 的原因。** 管线已经能用且验过，
UI 是一张独立的、边界清楚的活：

1. 分层角色编辑器工具条加一个入口 → 模态。
2. 开局调 `openPsd()`（原生选择器 + 读树），显示：文档尺寸、默认映射（哪些组成轴、哪些是恒定层）、
   被丢弃的隐藏层、以及**每个非 normal 图层一行 merge/skip**（不可分离的模式要禁用 merge）。
3. 确认 → `toBakeTargets` → `bakePsd` → `importFromPaths(AssetType.Image, 路径)` →
   用返回的资产 id 建 axes/tags/layers/options、`setCanvas(文档尺寸)`、写指纹。
4. 判据要包含：**导一份含组、非 normal 图层、隐藏层的 PSD，组→轴映射正确、multiply 层被显式
   拦截而不是静默导入**（母卡 §8 判据 5）。

指纹类型 `PsdFingerprint` 已经定义好但**还没有人写它**——重导重连是向导那一步的事。

## 6. 明确不做

- 剪贴蒙版 / 图层蒙版按 PS 语义预合成：ag-psd 能读出蒙版，但把它们正确合进图层是另一份工作量，
  且和混合模式一样需要作者可见的取舍。母卡列在 L3，本卡没做，得在向导卡里一起处理或再拆一张。
- 常驻 PSD、双向同步、增量回流——母卡已裁决不做。
- 规模守卫（图层数/单层像素/总体积上限提示）：向导那一步的事。
