---
title: "task: U3b 资产管理层 — 只补真缺的四块"
type: task
status: ready
date: 2026-07-26
plan: 2026-07-26-004-plan-ui-professionalization.md
branch: feat/ui-u3b-asset-management
---

# task: U3b 资产管理层

总计划 `2026-07-26-004` §U3b。**这张卡比总计划里写的小得多**——因为我在发卡前重测了基线，
发现总计划假设"还没有"的东西**大部分已经在 develop 上了**。见 §2。

## 0. 分支与纪律

- 从 `develop`（**`f52bfb4d`**）切 `feat/ui-u3b-asset-management`。
- 逐文件 `git add`，**禁止 `git add -A`**。每个 WI 完成即 commit。不合并、不 push。
- 禁止 `git worktree remove`、禁止 `git stash`。
- 提交前先 `git branch --show-current`。
- 这张卡**触碰资产写路径**（删除会真的删磁盘文件，替换会真的换字节）。任何自测都不许拿
  `D:\Dev\test\nlstudio\demo3` 当靶子练手——**先复制一份项目**，或者用你自己新建的项目。

### 0.1 共享检出：**两个外来未提交文件就在本卡的路径上**（比 U2 那次危险）

开卡时 `git status` 的外来未提交改动里，**有两个直接落在资产模块**：

```
 M src/renderer/apps/workspace/modules/assets/views/AssetsIconView.tsx   ← 本卡路径
 M src/renderer/apps/workspace/modules/assets/components/ImageCropper.tsx ← 本卡路径
 M src/renderer/styles/styles.css                                        ← 新增 .nl-opaque-surface
 M src/renderer/lib/components/elements/Modal.tsx
 M src/renderer/apps/launcher/tabs/{PluginDetailsModal,ProjectsTab}.tsx
 M src/renderer/apps/workspace/modules/blueprint-lite/…（2 个）
 M src/renderer/apps/workspace/modules/project/ProjectPanel.tsx
 M src/renderer/apps/workspace/modules/story-motion/…（2 个）
 M src/renderer/apps/workspace/modules/ui-editor/panel/templates/UITemplateStoreModal.tsx
 M docs/plans/2026-07-23-006-…（别人的卡）
?? docs/plans/2026-07-26-013-…、2026-07-26-014-…（别人的计划）
```

`AssetsIconView.tsx` 那处改的是分组表头的 sticky 背景（`bg-surface` → `bg-surface-sunken`），
`styles.css` 加了一个**尚未提交的 `.nl-opaque-surface` 类**。
**你在 `yarn dev` 里看到的资产面板包含这些效果；develop 上没有。**
U1 就是这么栽的：提交的代码适配了只存在于别人未提交 diff 里的类名，合并后样式失效，
而 lint、测试、截图**全部通过**。

因此本卡**必须**做隔离树审计，报告里给**过程**不只给结论：

1. `git archive HEAD | tar -x -C <隔离树>`；`node_modules` 用 junction；`yarn.lock` 要拷（它被 gitignore，yarn 4 没有它会拒绝跑）；
2. 在那棵树上跑 `yarn lint` + `yarn build:apps:dev`；
3. **额外**：`grep -rn "nl-opaque-surface" <隔离树>/src` 必须为空；
4. 报告里贴命令、退出码、隔离树的 `git status`（应为空）。

## 1. 风格铁律

- 复用既有组件：`ContextMenu`、`inputDialog`、`Modal`、既有 confirm。**不新增依赖**。
- **UI 里不要解释性文本**，不要新空态句子。
- 进度条要用既有组件；**不要**为导入造一个新的浮层体系。

## 2. 改前基线（orchestrator 亲测，**develop-only 隔离树**，别当背景读）

在 `git archive develop@f52bfb4d` 出来的干净树上构建、跑新实例量的——**不是**共享检出，
所以上面那些外来改动没有污染读数。证据图 `docs/plans/reports/assets/2026-07-26-U3b-before-*.png`。

**已经存在，本卡不要重做：**

| 能力 | 实测 |
|---|---|
| 单个资产右键菜单 | `Copy / Cut / Rename / Delete / New Group / Import Assets…` |
| 多选（ctrl-click / shift 范围） | 有；菜单变 `Copy 2 items / Cut 2 items / Delete 2 items / Create Tags / New Group / Import Assets…` |
| 批量删除 | 有 |
| 批量打标签 | 有（`Create Tags`，≥2 选中时出现） |
| 移动分组 | 有（拖拽 + 剪切/粘贴），**但右键菜单里没有入口** |
| 单个资产标签/描述 | 有（检查器里的 chips + textarea） |
| 导入 | 有（多选文件、远程 URL、拖文件夹按扩展名过滤） |
| 检查器 References 段 | 有（未被引用时显示 `Not referenced anywhere`） |
| **删除时的引用反查** | **已经在，而且会列出引用位置**：弹框 `These assets are still in use / Deleting them will leave the following places without a source: - room.jpg: First Day - Demo › First Day` |

**真缺的（= 本卡的全部内容）：**

| 缺口 | 实测 |
|---|---|
| **替换资产内容** | 全 DOM 搜 `replace` / `re-import` / `swap file` **全部为 false**；代码里也没有任何 `replaceAsset` |
| **引用守卫可被绕过** | 它只活在 `useAssetActions.ts` 这个 hook 里。分组级联删除（`GroupAssetsManager` 逐个调 `deleteAsset`）与任何程序化删除**都绕过它** |
| **导入没有队列感** | 只有一个布尔 spinner；失败项事后弹一次 alert（最多列 3 条）；**且指定分组时若移动失败会 `return`，把导入失败的 alert 整个吞掉** |
| `AssetOverviewCommand` 空壳 | 仍挂在 `WorkspaceLayout.tsx:20` / `:766`，组件 `return null`。该文件现在**已提交、可自由改** |

顺带记下、**本卡不修**：`Ctrl+A` 的 `handleSelectAll` 写好了但没接线；没有框选；
`AssetLockManager` 从来没在删除路径上被读过（`ReferenceService` 已取代它）。

## 3. 用户裁决（2026-07-26，不要重新讨论）

1. **只做 §2 下半张表的四块**，上半张表的能力**一概不重做**。
2. **引用守卫保持"警告 + 仍可确认"**，不改成硬拦截——作者有时就是要删（例如正准备换掉那张图）。
   但要**降级默认按钮**：`Cancel` 变默认/主按钮，删除变危险色的次要按钮。总计划 §U3b-2 里
   "明确拦截"那句话按此裁决执行。

## 4. 工作项

### WI-1 替换资产内容（最大的一块，先做）

- 保 id 换文件：所有引用点自动跟随（因为引用存的是 assetId，不需要改引用）。
- **必须按这个顺序**：写入新字节 → **重算 `hash`** → **`AssetsService.clearThumbnailCache(assetId)`** →
  写元数据 → `emit("updated")`。今天没有任何代码路径做前三步中的任何一步。
  - `hash` 目前只在导入（`LocalAssetsManager` 里）和复制时算过一次，之后再没更新过；
    而 `useAssetBlobUrl` 等好几处**拿 hash 当 React dep** 来决定要不要重读 blob——
    hash 不变 = 那些地方永远拿旧图。
  - `clearThumbnailCache` 今天**只有 `deleteAsset` 调**。不调它，渲染层会从**旧的缩略图 PNG** 重读。
- 入口：单个资产的右键菜单 + 检查器里一个动作即可。**不做批量替换。**
- 尺寸不需要持久化（`ImageService` 每次读时算），但要确认预览确实重算了。

### WI-2 引用守卫下沉到卡口

- 把反查从 `useAssetActions` 下沉到 **`AssetsService.deleteAsset`**（以及 `deleteGroup` 的枚举阶段），
  使分组级联与程序化删除**绕不过去**。
- 语义按 §3.2：**默认阻止，但可以带一个显式的"我知道，继续"参数**，由 UI 层在作者确认后传入。
  不要在 service 层弹 UI。
- UI 层：保留现有弹框与引用清单，**把 `Cancel` 变成默认按钮，删除按钮变危险色次要按钮**。
- **这一项必须带单元测试**——见 §5。

### WI-3 导入队列

- 多文件导入要有**逐项进度**（第 n / 共 m，或每项一行状态），不是一个布尔 spinner。
- **失败项可重试**，不是事后一条 alert。
- 修掉那个吞提示的缺陷：指定 `groupId` 时移动失败会 `return`，导致导入失败的汇总**根本不显示**。
- 用既有组件做。不要造新的浮层体系。

### WI-4 删掉 `AssetOverviewCommand` 空壳

- 删 `WorkspaceLayout.tsx:20` 的 import 与 `:766` 的挂载、删组件文件、清掉
  `modules/registry.ts` 与 `asset-overview/index.tsx` 里的再导出。

## 5. 测试（这张卡的硬要求，因为写路径今天是零覆盖）

`AssetsService` / `LocalAssetsManager` / `GroupAssetsManager` / `useAssetActions` / `useMultiSelection`
**目前一个测试都没有**。本卡至少要补：

- **WI-2 的守卫**：被引用 → 默认阻止；带"继续"参数 → 放行；**分组级联删除也被拦**（这条最重要，
  它就是今天的绕过口）。
- **WI-1 的顺序**：替换后 hash 变了、`clearThumbnailCache` 被调了、`emit("updated")` 发了。
  用替身即可，不需要真磁盘。

不要求给整个资产模块补齐测试——**只覆盖你这张卡新增/改动的行为**。

## 6. 硬约束（踩了就是退回）

- **不重做 §2 上半张表的任何能力。**
- 不改资产元数据的磁盘格式（分片布局、shard JSON 结构）。
- 不动 `ReferenceService` 的索引模型（`referenceModel.test.ts` 必须保持绿）。
- 不引入资产级 undo/history（今天没有，本卡不补——**替换与删除都是不可撤销的**，
  这一点要在 UI 上让作者知道，但**用按钮层级表达，不要写解释句子**）。
- **不许写 assert / scenario / 通过判定。** 判据在 §7，orchestrator 亲验。
- **不要拿 demo3 当写操作靶子。** 自测用复制出来的项目。

## 7. 判据（orchestrator 亲验）

驱动路径：启动器 →（一个**复制出来的**测试项目）→ 资产面板。每条断言前过 setup guard：
**资产面板搜索框可见（宽度 > 0，不只是存在）**、**目标树行 `elementFromPoint` 可达**。
（提醒：Escape 会收起资产面板；资产名在编辑器 tab 上也会出现，选择器必须限定在面板内。）

| # | 判据 | 量 |
|---|---|---|
| A | **替换真的换了** | 替换后：磁盘字节变了、`hash` 与替换前**不同**、缩略图 PNG 被删除或重建 |
| B | **引用点跟随** | 同一个 assetId 被三处引用（故事行背景 / 角色差分 / UI 元素），替换后**三处渲染都变成新图**，各截一张 |
| C | **守卫绕不过去** | 删除一个**含被引用资产的分组**时被拦下并列出引用点（今天：分组级联直接删掉，不经守卫） |
| D | **按钮层级** | 引用弹框里 `Cancel` 是默认/主按钮，删除是危险色次要按钮；键盘 Enter 落在 Cancel 上 |
| E | **导入有队列感** | 导入 20 个文件（含 2 个故意坏的）：全程可见逐项进度；结束后失败项**列出且可重试**；重试成功后计数正确 |
| F | **吞提示的缺陷已修** | 指定分组导入且移动失败时，导入失败的汇总**仍然出现** |
| G | **空壳没了** | 全 app 搜 `AssetOverviewCommand` 归零；资产面板第三视图不受影响 |
| H | **既有能力无回归** | 重命名 / 单删 / 批删 / 批量标签 / 拖拽移组 / 检查器 References 段逐一仍工作 |
| I | **测试** | §5 两组测试存在且绿；`referenceModel.test.ts` 仍绿 |

要截的图：`替换前后的三处引用点` / `分组级联删除被拦` / `引用弹框的按钮层级` / `导入 20 个文件的中途与结束态`。

**目视 + 断言双绿才合并。** "测试全绿"不构成通过。

## 8. 自验（报告里逐项给结果，这不是验收）

1. `yarn lint`（tsc）绿。
2. `yarn test`：win32 基线 8–9 个失败不是回归，**但要列出你看到的失败清单**。
3. **隔离树审计**（§0.1，含 `nl-opaque-surface` 的 grep）——贴命令、退出码、`git status`。
4. 真机自测：用**复制出来的项目**走一遍 §7 的路径，说明你看到了什么。
   **不要碰 demo3**；若不慎碰了，明说并给还原过程。

## 9. 报告

`docs/plans/reports/2026-07-26-U3b-report.md`：改了哪些文件、每个 WI 的做法与取舍、§8 逐项结果、
隔离树审计过程、以及**你没做到或没把握的地方**。

## 10. 何时必须停下来报告

- 替换资产内容需要改元数据磁盘格式，或需要资产级 undo 才做得对。
- 守卫下沉到 `AssetsService` 会让某条既有调用路径死锁/循环（`ReferenceService.ensureReady` 是异步的，
  而 `deleteAsset` 今天是同步语义——**如果这里要改签名，先停下来说**）。
- 三处引用点里有任何一处**做不到替换后自动跟随**。
- 隔离树里编译失败但工作树里是绿的——**立刻停，这就是 U1 那个坑**。
