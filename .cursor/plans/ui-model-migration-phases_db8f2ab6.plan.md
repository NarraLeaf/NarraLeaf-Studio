---
name: ui-model-migration-phases
overview: UI 模型与 Appearance 迁移的分阶段执行表（P1–P5），任务量均衡、可顺序交付；完整背景与技术决策见主计划。
todos:
  - id: uimig-p1-registry-container
    content: "P1: Single registry truth + Container unification (Units 1–2) — widget module as insert/render source; collapse element-types; palette/docker/context menu only Container/Text/Image/Button/List; Container absorbs rectangle/stack/scroll/spacerDivider; layout.kind free|stack|scroll; remove old builtin modules; TransformController/EditorNodeWrapper/UIRuntimeBridge/diagnostics aligned"
    status: completed
  - id: uimig-p2-appearance-runtime
    content: "P2: Appearance runtime (Unit 3) — shared appearance types; AppearanceResolver; WidgetRuntimeStateStore + system interaction state; Container/Button renderers consume resolver; whitelist visual fields only; interaction layer feeds signals"
    status: completed
  - id: uimig-p3-appearance-inspector
    content: "P3: Variant + conditional rows authoring UI (Unit 4) — widget-modules/shared/appearance/*; container/button inspectors; no dual flat appearance model; minimal PropertiesPanel/FieldRenderer touch"
    status: completed
  - id: uimig-p4-blueprint-list
    content: "P4: Blueprint boundary + List (Units 5–6) — explicit widget.setVariant (or equivalent); remove per-prop appearance binding for appearance-capable widgets; Dev Mode variant patch; behavior-graph/catalog nodes; List user concept replaces ListRepeater"
    status: completed
  - id: uimig-p5-shell-cutover-verify
    content: "P5: Shell hard cutover + verification (Units 7–8) — docker presets for Container modes; interaction/moveable/diagnostics on new model; bump UI_DOCUMENT_SCHEMA_VERSION; delete dead old types/registry; manual pass per parent plan Verification Matrix"
    status: pending
isProject: false
---

# UI 模型迁移 — 分阶段计划表（P1–P5）

**主计划（单一事实来源，含 Problem Frame、8 个 Implementation Units、验证矩阵、风险与文件布局原则）：**  
[ui-model-migration_db8f2ab6.plan.md](./ui-model-migration_db8f2ab6.plan.md)

本表将主计划中的 **Unit 1–8** 重组为 **最多 5 个阶段**；阶段内保留主计划中的关键文件路径、目标与验收要点。策略不变：**硬切换**、无旧 schema/widget 兼容层、蓝图**仅可切换 variant**、appearance 为**共享能力**（非 OO 继承）、**控件本地运行时状态**（不复用 surface state 承载 variant/伪状态）。

**Agent 进度标记：** 本文件 YAML 前置元数据中的 `todos` 为可勾选项。完成某阶段后，将对应条目的 `status` 改为 `completed`（进行中可用 `in_progress`）。稳定 `id`：`uimig-p1-registry-container`、`uimig-p2-appearance-runtime`、`uimig-p3-appearance-inspector`、`uimig-p4-blueprint-list`、`uimig-p5-shell-cutover-verify`。

---

## 阶段总览

| 阶段 | 名称 | 对应主计划 Units | 核心交付 | 前置依赖 |
|------|------|------------------|----------|----------|
| **P1** | 注册真相源与 Container 统一 | Unit 1 + Unit 2 | 单一插入/渲染注册链；`Container` 吸收 Rectangle/Stack/Scroll/SpacerDivider；`layout.kind` 驱动 flow 语义 | — |
| **P2** | Appearance 运行时与解析 | Unit 3 | `appearance` 类型、`AppearanceResolver`、`WidgetRuntimeStateStore`；Container/Button renderer 经 resolver 出图 | P1 |
| **P3** | 变体与条件行创作 UI | Unit 4 | `shared/appearance/*`；Container/Button inspector 变体 + 条件属性行 | P2 |
| **P4** | 蓝图边界与 List 语义 | Unit 5 + Unit 6 | `widget.setVariant` 等显式 API；移除 appearance 逐属性绑定 UI；`List` 取代 ListRepeater 用户概念 | P2（可与 P3并行启动接口设计，实现建议 P3 后接） |
| **P5** | 壳层收口、硬切换与验证 | Unit 7 + Unit 8 | Docker/交互/诊断全面切新模型；`UI_DOCUMENT_SCHEMA_VERSION` 提升；删残余旧类型；按主计划验证矩阵收口 | P1–P4 |

---

## P1 — 注册真相源与 Container 统一

**目标：** 定死用户层对象集与单一注册链；用统一 `Container` 替换用户侧的 Rectangle、Stack、Scroll、SpacerDivider。

**主计划对应：** Unit 1、Unit 2。

**关键决策（摘自主计划）：** 决策 1（硬切换）、2（Container 统一）、8（palette 与实现解耦）；`Container.layout.kind = free | stack | scroll`；Divider 为预设非独立类型。

**主要文件：**

| 动作 | 路径 |
|------|------|
| 改 | `src/renderer/lib/ui-editor/widget-modules/types.ts` |
| 改 | `src/renderer/lib/ui-editor/widget-modules/registryInstance.ts` |
| 改 | `src/renderer/lib/ui-editor/widget-modules/builtin/index.ts` |
| 改 | `src/renderer/lib/ui-editor/runtime/builtin/index.ts` |
| 改 | `src/renderer/lib/workspace/services/ui-editor/UIDocumentService.ts` |
| 删或合并 | `src/renderer/lib/ui-editor/element-types/*` |
| 改 | `src/shared/types/ui-editor/document.ts` |
| 新建 | `src/shared/types/ui-editor/container.ts` |
| 改 | `src/renderer/lib/ui-editor/widget-modules/builtin/container.tsx`、`container/types.ts`、`container/renderer.tsx` |
| 改 | `src/renderer/lib/workspace/services/ui-editor/UIRuntimeBridgeService.tsx` |
| 改 | `src/renderer/lib/ui-editor/runtime/EditorNodeWrapper.tsx` |
| 改 | `src/renderer/lib/ui-editor/interaction/controllers/TransformController.ts` |
| 改 | `src/renderer/lib/ui-editor/diagnostics/rules/layoutDiagnostics.ts`、`interactionDiagnostics.ts` |
| 改 | `src/renderer/lib/ui-editor/docker/UIEditorDockerBar.tsx` |
| 改 | `src/renderer/apps/workspace/modules/ui-editor/editors/UISurfaceEditorTab.tsx` |
| 删 | `builtin/rectangle*`、`stack*`、`scroll*`、`spacerDivider*` |

**验收要点：**

- 插入路径只有一套真相源；docker 与右键菜单仅暴露 `Container`、`Text`、`Image`、`Button`、`List`（List 可先占位或最小实现，完整语义在 P4）。
- 新建 `Container` 可覆盖旧 rectangle/container/stack/scroll/divider 主要场景；flow 与绝对布局由 `layout.kind` 与统一逻辑驱动，非历史 widget type 字符串集合。
- 交互层对 flow 子的拖拽/缩放限制与新容器模型一致。

---

## P2 — Appearance 运行时与解析

**目标：** 建立共享 appearance 数据形状、纯函数 resolver、控件本地运行时状态；Container/Button 最终视觉由 resolver 输出。

**主计划对应：** Unit 3。

**关键决策：** 决策 3（共享能力非继承）、4（widget-local 状态）、6（appearance 仅白名单视觉字段）、7（同组内最后匹配条件行）；禁止结构字段进入 resolver。

**主要文件：**

| 动作 | 路径 |
|------|------|
| 新建 | `src/shared/types/ui-editor/appearance.ts` |
| 新建 | `src/renderer/lib/ui-editor/runtime/appearance/AppearanceResolver.ts` |
| 新建 | `src/renderer/lib/ui-editor/runtime/appearance/WidgetRuntimeStateStore.ts` |
| 新建 | `src/renderer/lib/ui-editor/runtime/appearance/SystemInteractionState.ts` |
| 改 | `src/renderer/lib/ui-editor/runtime/types.ts` |
| 改 | `container/renderer.tsx`、`button/renderer.tsx` |
| 改 | `src/renderer/lib/ui-editor/interaction/UIEditorInteractionLayer.tsx` |

**验收要点：**

- Container/Button 视觉值只来自 resolver，renderer 内不散落 hover/active 等旧 props 判断。
- `activeVariantId` 与系统伪状态不依赖 surface state；resolver/store 可独立阅读维护。

---

## P3 — 变体与条件行创作 UI

**目标：** Inspector 以 variant 为一等对象，variant 内 property groups + 条件行；不污染通用 properties framework 为领域系统。

**主计划对应：** Unit 4。

**关键决策：** 决策 7；设计态可预览系统状态命中，但不等于蓝图可写；清理扁平外观字段避免双轨。

**主要文件：**

| 动作 | 路径 |
|------|------|
| 新建 | `src/renderer/lib/ui-editor/widget-modules/shared/appearance/*` |
| 改 | `src/renderer/lib/ui-editor/widget-modules/builtin/container/inspector.tsx` |
| 改 | `src/renderer/lib/ui-editor/widget-modules/builtin/button/inspector.tsx` |
| 改 | `src/renderer/apps/workspace/modules/properties/PropertiesPanel.tsx` |
| 必要时改 | `.../properties/framework/fields/FieldRenderer.tsx` |

**验收要点：**

- 可创建/重命名/删除 variant；单 variant 内可对同一属性追加多条条件行；切换编辑 variant 时右侧不串 variant。

---

## P4 — 蓝图边界与 List 语义

**目标：** 蓝图仅能通过显式 API 切换 variant；将 `ListRepeater` 重塑为用户语义 `List`。

**主计划对应：** Unit 5、Unit 6。

**关键决策：** 决策 5；Dev Mode patch 扩展 variant，不扩展任意外观 patch；非 appearance 控件若保留 `widgetProp` 须白名单防回流。

**主要文件（蓝图）：**

| 动作 | 路径 |
|------|------|
| 改 | `src/renderer/lib/ui-editor/runtime/types.ts` |
| 改 | `src/renderer/lib/ui-editor/blueprint-runtime/BlueprintHostApiBridge.ts` |
| 改 | `src/renderer/lib/ui-editor/runtime/hostAdapters/devModeBlueprintHostAdapter.ts` |
| 改 | `src/renderer/lib/ui-editor/blueprint-runtime/BindingEvaluator.ts` |
| 改 | `.../properties/blueprint/usePropertyBindingState.ts`、`BindablePropertyField.tsx` |
| 改 | `src/renderer/lib/ui-editor/behavior-graph/blueprintM3MinNodes.ts`、`blueprintM3FullNodes.ts`、`nodeEditorCatalog.ts` |

**主要文件（List）：**

| 动作 | 路径 |
|------|------|
| 新建或重命名 | `src/renderer/lib/ui-editor/widget-modules/builtin/list/*` |
| 改或替换 | `builtin/listRepeater/*` |
| 改 | `builtin/index.ts`、`document.ts`、`UIEditorDockerBar.tsx` |

**验收要点：**

- 蓝图可切换 Container/Button 的 active variant；不可直接写 hovered/active/disabled；appearance-capable 无逐属性绑定入口。
- Palette 为 `List` 非 `ListRepeater`；预览复制不干扰真实实例点击。

---

## P5 — 壳层收口、硬切换与验证

**目标：** Docker 高频能力、交互、诊断、Moveable 全量对齐新模型；schema 版本提升与残留删除；按主计划 **Verification Matrix** 手工收口。

**主计划对应：** Unit 7、Unit 8。

**主要文件：**

| 动作 | 路径 |
|------|------|
| 改 | `UIEditorDockerBar.tsx`、`UISurfaceEditorTab.tsx` |
| 改 | `UIEditorInteractionLayer.tsx`、`TransformController.ts`、`useMoveableHandlers.ts` |
| 改 | `diagnostics/collectSurfaceDiagnostics.ts`、`diagnostics/rules/*` |
| 改 | `src/shared/types/ui-editor/document.ts`（schema version） |
| 审阅 | `UIBlueprintLifecycleCoordinator.ts`、`DevModeSurfaceRenderer.tsx`、`PropertiesPanel.tsx` |
| 删 | 废弃 widget、旧 registry 残留、旧常量与 type guard |

**验收要点：**

- 空白 surface 仅用新对象集完成纵向容器、滚动、列表、按钮、文本常见流；docker 与 inspector 分工清晰；诊断不提已移除类型名。
- 代码库无双轨旧 widget 入口；执行方可按主计划「Verification Matrix」四块（编辑器创作 / 交互布局 / Dev Mode·运行时 / 架构清理）逐项勾选。

---

## 验证矩阵与风险

**完整验证矩阵与风险缓解：** 见主计划 [ui-model-migration_db8f2ab6.plan.md](./ui-model-migration_db8f2ab6.plan.md) 中 **Verification Matrix**、**Risks and Mitigations**、**File Arrangement Principles**、**Sources**。

---

## 主计划 TODO 与阶段映射（便于同步跟踪）

| 主计划 todo id | 建议阶段 |
|----------------|----------|
| `model-cutover` | P1 |
| `container-unification` | P1（与 model-cutover 紧密重叠） |
| `appearance-capability` | P2 |
| `editor-shell-rewire` | P1 起步，P5 收口 |
| `runtime-blueprint-boundary` | P4 |
| `button-list-rework` | P2–P3（Button appearance），P4（List） |
| `verification-matrix` | P5 |

（主计划 YAML 中 `todos` 仍以主计划文件为准；本表为执行顺序建议。）
