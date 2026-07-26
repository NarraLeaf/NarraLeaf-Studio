---
title: "handoff: 分层立绘系统 — L0–L5 现状与 L3 向导的接手说明"
type: handoff
date: 2026-07-26
parent: 2026-07-26-013-plan-layered-sprite-system.md
---

# 交接：分层立绘系统

母卡 `2026-07-26-013`。L0–L5 全部并入 `develop`。

> **2026-07-26 更新**：L3 的导入向导 UI 已完成并按母卡 §8 判据 5 验收（含图层蒙版与剪贴蒙版的
> 合成，本来记在 `-024` §6「明确不做」，用户裁决一起做）。卡 `-024` status 已改 done，
> 验收结果与截图在该卡 §7，留下的口子在 §8。本文件 §2 只作历史记录，**不要再当成待办**。
> 顺带修了一个 dev 环境缺陷：`dev-electron.js` 从来没打包过 `psdWorker.js`，PSD 导入在
> `yarn dev` 下从第一天起就是死的（见 `-024` §5 末尾）。

## 1. 现状一览

| 里程碑 | 卡 | 状态 | 合并点 |
|---|---|---|---|
| L0 引擎 tag 组解耦 | 母卡 §4 | done | narraleaf-react 0.18.0（已发 npm，Studio 已采纳） |
| L1 外观模型重做 + 双迁移 | `-015` | done（含补做的目视验收 §4.5） | `8465609e` |
| L2 层栈编辑器 | `-018` | done | `3debbcaa` |
| L4 SpriteCompositor | `-022` | done | `2540afe1` |
| L5 组合浏览器 + 快照 | `-023` | done | `8e9ba3f3` |
| **L3 PSD 导入** | `-024` | **管线 done，向导 UI 未做** | `6beaa190` |

`develop` @ `6beaa190`。分支 `feat/layered-sprite-l2/-l3/-l4/-l5` 都已推 origin。
worktree `D:/Temp/nls-layered` 停在 `feat/layered-sprite-l3`，工作树干净。

## 2. 下一件事：L3 向导 UI

卡 `-024` §5 已经把要做的写死了。管线全部就绪且验过，向导只需要把它们串起来：

**能直接用的 API**

```ts
// 桥（src/shared/types/renderer.ts:153,155）
openPsd(): Promise<RequestStatus<{ filePath: string | null; document: PsdDocument | null }>>
bakePsd(request: PsdBakeRequest): Promise<RequestStatus<{ layers: PsdBakedLayer[] }>>

// 纯函数（src/shared/utils/psdLayerPlan.ts）
flattenLeaves(document.layers)          // 拍平成 PsdLeaf[]，带 top-level group
unsupportedBlends(leaves)               // 要作者拍板的层
canMergeBlendMode(mode)                 // false → UI 必须禁用 merge，只能 skip
planImport(leaves, resolutions)         // { axes, constants, baking, dropped }
toBakeTargets(plan, resolutions)        // PsdBakeRequest.layers

// 建外观（src/renderer/.../character/CharacterAppearance.ts）
setCanvas / createAxis / createTag / createLayer / setLayerAxis / setLayerAsset / setLayerOption
```

**四步**

1. 分层角色编辑器工具条加入口（`CharacterEditor.tsx`，工具条已有 Crop / Layers / Grid3x3 三个按钮，
   照抄第四个）→ 模态。
2. 开局 `openPsd()`。显示：文档尺寸、`planImport` 的默认映射（哪些组成轴、哪些是恒定层）、
   `dropped`（隐藏层）、以及**每个 `unsupportedBlends` 层一行 merge/skip**。
3. 确认 → `toBakeTargets` → `bakePsd` → `importFromPaths(AssetType.Image, layers.map(l => l.filePath))`
   → 用返回的资产 id 建 axes/tags/layers/options + `setCanvas(文档尺寸)` + 写 `PsdFingerprint`。
4. `PsdFingerprint` 类型已定义但**没有任何人写它**——重导重连是这一步的活。

**判据（母卡 §8 判据 5）**：导一份含图层组、剪贴蒙版、一个 `multiply` 图层的 PSD——
组→轴映射正确、蒙版已合成、`multiply` 层被**显式拦截**而不是静默导入。
造 fixture 用 `ag-psd` 的 `writePsdBuffer`（我就是这么造的，见卡 `-024` §4）。

**还没做的相邻项**：剪贴蒙版 / 图层蒙版按 PS 语义预合成（ag-psd 能读出来，但合进图层是另一份
工作量，且和混合模式一样需要作者可见的取舍）；规模守卫（图层数/像素/体积上限提示）。

## 3. 其余待办（都已登记，不紧急）

- **预览与合成器摆放不一致**（L4 卡 §4）：`LayerStackPreview` 用每层各自 `object-contain`，
  合成器按「各层自身尺寸居中」——引擎的规则。同一个栈在预览面和徽章里长得不一样，
  而且预览面**看不出**尺寸不符。要把预览改成同一套摆放，单独一卡 + 单独一次目视。
- **头像裁剪 `portrait`**：要在合成结果上框选，自成一卡。
- **Dev Mode 快照合成**：母卡 §8 判据 7 的第三处。走编译产物而非渲染器缓存，
  要先想清楚 compositor 在没有 workspace context 的 dev-mode 窗口里怎么拿资产。
- **F5 微卡**：迁移告警是硬编码英文 + 红色 `showError`（卡里说的是"标黄"），
  连带 `characterForm` 语法 token 改名那笔旧债。
- **preset↔layered 冷切换向导**：`setKind` 服务层就绪，UI 没有。
- **快照被故事行引用**：母卡 §9 开放问题，当前 snapshots 只是编辑器便利。

## 4. 会再咬人的坑

**验收**
- 用户铁令：UI 必须 orchestrator **亲手驱动 + 亲自读图**，子代理报告与"测试绿"都不算。
- **被遮挡窗口照样能 `Page.captureScreenshot`**（`visibilityState === "hidden"` 不影响截图）。
  坏的是*测量*：虚拟列表和刚激活的 tab 会报 0 个子元素。截一张图强制 paint，再重新查询。
- 每个脚本先加 setup guard 证明被测对象在屏幕上；编辑器 tab 是常驻挂载的，
  `document.querySelector` 会抓到**不可见的那个** tab——按 `offsetParent !== null` 过滤。

**驱动**
- 打开工程不需要原生对话框：`workspace.launch({projectPath}, false)`；
  `app.addRecentProject(name, path)` 播种启动器列表。**在副本上做**，迁移会改写工程。
- 服务层拿不到时用 React fiber 走查（`__reactContainer$` → hooks/props/context），
  Characters 面板必须先打开。
- `updatePayload(blockId, payload)` 是**整体替换不是合并**——我用它改一行的角色，
  把整行 payload 打没了（在副本上，无损失）。
- 改 `src/shared/**` 会**重启 Electron**（shared 编进 main），退回启动器且所有 CDP target id 失效。

**原生拖拽**
- `draggable` 默认失效，拖拽源必须带 `nl-drag-source`。
- **原生拖拽跑嵌套消息循环**，`dragstart` 里 `setState` 的结果对必须 `preventDefault` 的
  `dragover` 不可见 → 用 ref。CDP 鼠标步进要够慢（40ms/步 + 落点悬停 5 次），25ms 的版本 drop 不落。

**工程环境**
- worktree `D:/Temp/nls-layered` 有**自己独立的 node_modules 和 yarn 状态**（不是 junction），
  装依赖不碰主检出；本仓 `yarn.lock` 是 gitignore 的。
- 起停 dev 必须同一组变量：`NLS_DEV_RELOAD_PORT=<port> node project/app/dev-electron.js --cdp --cdp-port=<port>`
  → `NLS_DEV_RELOAD_PORT=<port> node project/app/stop-dev.js`。不带变量会去杀 5588 上别人的实例。
- **develop 常被主检出 checkout 着**。不能在别的 worktree 里 checkout 它。安全推法：
  `git commit-tree HEAD^{tree} -p origin/develop -p HEAD -m "…"` 造 merge commit，
  再 `git push origin <sha>:develop`——全程不碰任何工作树。
  **绝不用 `git update-ref` 改别人 checkout 着的分支。**
- 禁 `git stash`、禁 `git add -A` 主检出、禁 `git worktree remove`（会穿透 junction）。
- win32 vitest 基线 8 条失败（path polyfill ×3、runtimeProtocol ×2、storageManager、
  GameBuildManager darwin、mobileSigningIdentity）——不是回归。当前 2408 通过 / 8 失败。

**一次事故**
`5b59032e` 顶着 `docs(plugin)` 的消息落了一棵**过期的树**：9020 行删除跨四个会话。
已整体 revert（`b95e61ad`）。识别特征与处置写在 memory `stale-tree-mass-revert`。

## 5. 手边的东西

- 测试工程副本：`D:/Temp/nls-l1-verify/{demo3,demo3b,new-project}`（约 730MB）。
  `demo3` 里有 `Layered Test`（两轴四层 + 一个快照）与 `Stack Two`（遮挡诊断的 fixture），
  第 2 行已指向 `Layered Test`。用完可删。
- CDP 驱动脚本在上一个 session 的 scratchpad：`cdp.js` / `evalid.js` / `clipshot.js` /
  `dragtest.js` / `typedialog.js`。丢了就重写，都不长。
