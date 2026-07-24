---
title: "task: M6 — 资源总览页 v1（只读）+ 流程图分支可读性"
type: handoff
status: draft
date: 2026-07-24
parent: 2026-07-22-001-feat-story-editor-overhaul.md
---

# task: M6 资源总览 + 流程图分支

你是执行者。前置阅读：总计划 `2026-07-22-001` §5.5（资源总览，含"预测与裁剪拆两步"的裁决理由）与 §5.4（流程图分支）、§8 不做清单；M3 卡 `2026-07-23-001` §0 纪律与 §1 风格铁律**原样适用**。分支：从 develop 切 `feat/story-m6-asset-overview`。报告：`docs/plans/reports/2026-07-24-m6-report.md`（≤60 行同模板）。

**并行提示**：另有执行者在做 0.16.1 采纳微卡（`transitions`/编译器转场分支/bible §1.3），与本卡零交集。共享检出纪律照旧。

## 背景与现状（2026-07-22 核实，行号会漂移按符号定位）

数据层基本现成，本卡主要是**呈现层 + 少量派生**：

- **`ReferenceService`**（`src/renderer/lib/workspace/services/references/`，模型 `referenceModel.ts`）：已是"某资产被谁引用"的权威（六切片：故事块/场景背景/故事动画、蓝图节点、UI 元素、语音、角色），增量重建、已被删除守卫使用。`getReferences(assetId)` / `isReferenced` / `getReferencedAssetIds` / `flushPendingRebuilds` 齐备。
- **`AssetsService`**（`services/core/AssetsService.ts`，基类 `assets/AssetServiceBase.ts`）：资产元数据与尺寸；类型枚举 Image/Audio/Video/JSON/Blueprint/Font/Other。
- 现有呈现只有**左侧栏**（`modules/assets/AssetsPanel.tsx`，list/icons 两视图）+ 单资产预览 tab；Properties 面板有"此资产被用在哪"区块（`modules/properties/components/AssetReferencesSection.tsx`，跳转走 `SearchJumpTarget`/`searchJump`）。**没有全页资产视图**。
- 构建侧：`GameBuildManager.ts` 有 `directorySize(<project>/assets)` 与移动端超限判断（现状是**整个 assets 目录打包**）；`build/preflight.ts` 是构建前校验的落点。
- 流程图：`modules/story-flow/sceneFlowModel.ts` 的 `buildSceneFlowGraph(document)` 纯投影——节点=场景，边=`jump` 块；`isUnderControlFlow` 把"处于任何 control 之下"一律标虚线（**过宽**：`sequence` 也算）。choice 是 `action` 块不是 control 块，所以选项分支现在完全不体现。

## WI-1 资源总览页（新 EditorModule 全页 tab，只读）

- 挂载：`modules/registry.ts` 的 `builtInEditors`（Welcome/各类预览页是同模式先例）。入口：assets 侧栏 header 一个按钮 + 全局 action/Quick Open 可达。**左侧栏定位不变**（快速拖入），不要动它。
- 内容（全部从既有服务派生，不新建持久化数据）：总量与总字节；**已引用 / 游离**两分（`getReferencedAssetIds` 的补集即游离）；按类型的数量与体积分布；体积 TOP N；单资产详情（选中后：预览、尺寸、hash/路径、**被引用列表**——复用 `AssetReferencesSection` 的行渲染与 `searchJump` 跳转，不要重写一套）。
- **打包预测**：显示"可达集体积 vs assets 目录总体积"的对比与差额（即"若按引用裁剪可省多少"）。**只读预测，绝不改变打包行为**（现状仍是整目录打包）——这是 §5.5 的明确裁决，v2 才做 opt-in 裁剪与 per-asset override。措辞上不得让人以为已经生效（但也**不要写解释性说明文字**——用"预测/实际"这类字段名与数值本身表达，风格铁律照旧）。
- 性能：`ReferenceService.ensureReady()`/`flushPendingRebuilds()` 后再计算；大项目下不要每次渲染重算（memo/一次性快照 + 变更事件失效）。

## WI-2 流程图分支可读性

- 收集 `jump` 块的祖先链，按最近的分支型祖先给边打 label：`choiceOption` → 该选项文本；`conditionBranch` → 其表达式 `source`（else 分支用既有 else 措辞）；纯 `sequence`/`parallel`/`race`/`repeat` **不再**算 conditional（修掉现在的过宽判定）。
- 同一 (源场景→目标场景) 有多条分支路径时，边聚合但 label 要能表达多路（形态自定，克制）。
- **边界（v1 明说，不要越界）**：不跳场景的场内分支不进场景图——场景图是场景之间的图。
- 现有节点/布局/交互（BFS 分层、双击打开场景、M5 传入的 `currentSceneId` 高亮）保持不变。

## 明确不做

打包行为变更、per-asset force/exclude override（v2）；资产的批量操作/删除入口（删除守卫已在别处）；场内分支节点化；虚拟化。

## 验证与停机

`yarn lint` 全绿；vitest 新失败 0 + 新增派生逻辑单测（游离集计算、类型聚合、可达集体积；边 label 的祖先链推导含 else/嵌套/多分支聚合）。真机：在有一定资产量的项目里打开总览页——数字与侧栏/属性面板一致、游离资产确实无引用、单资产跳转可达；流程图里 if/choice 分支边 label 正确、sequence 不再虚线；截图存 assets。停机：`ReferenceService` 的现有 API 不足以支撑（报告缺什么，不要在本卡里改它的语义）；总览页与既有面板出现数字口径不一致且无法调和（报告实例——这正是 v2 裁剪敢不敢做的前置证据）。
