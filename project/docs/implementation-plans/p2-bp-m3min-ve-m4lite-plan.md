# P2 — Blueprint System M3-min + Visual Editor M4-lite（实施记录）

## 目标（已完成范围）

- Dev Mode：`Button` 点击 → `blueprintEvent` → `GraphExecutor` → `blueprint.state.set` → `surface state` → `BindingEvaluator` → 有效属性 → UI 可见变化。
- 调试：`execution.started` / `execution.finished` / `execution.error` / `state.read` / `state.write` / `binding.evaluated`（Dev Mode 内嵌面板，无 Workspace IPC）。
- 编辑器：元素级与 Surface 级真实 Blueprint 入口（轻量 Tab，非 React Flow 编辑器）。
- 声明：`BlueprintDeclaration.valueSource` 仅开放 `surfaceState` 一种可求值来源。

## 非目标（保持边界）

- 完整 Visual Blueprint / React Flow 画布、属性面板绑定编辑、全局/持久化/导航等媒体类 Host API 真执行、`node.enter`/`node.exit`、调试回传主进程。

## 手工验收要点

1. 在 `uigraphs.json` 的对应 `widgetMain` 蓝图中为 `click` 事件图填入至少一个 `blueprint.state.set` 节点（`entries.main` 或 `default` 指向该节点），并为某声明配置 `valueSource: { kind: "surfaceState", key: "..." }`，在同一蓝图 `bindings` 中将控件属性（如 `text` 或 `layout.visible`）绑定到该声明。
2. `uidoc` 中按钮 `behavior.events.click` 为 `blueprintEvent`（可通过现有 `UIDocumentService.setElementBlueprintEvent` 或等价数据）。
3. 打开 Dev Mode：点击按钮，观察 UI 变化与右侧 Blueprint debug 事件流。
4. Workspace：选中元素与 Scene Properties，使用「Open blueprint entry」打开轻量 Tab，核对 payload 与列表信息。

## 关键文件索引

| 区域 | 路径 |
|------|------|
| 声明求值 | `src/renderer/lib/workspace/services/ui-editor/blueprint/declarationEvaluation.ts` |
| 类型 | `src/shared/types/blueprint/document.ts`（`BlueprintDeclarationValueSource`） |
| 运行时 | `src/renderer/lib/ui-editor/blueprint-runtime/*` |
| 节点 | `src/renderer/lib/ui-editor/behavior-graph/blueprintM3MinNodes.ts`（`blueprint.state.set`） |
| Host 适配 | `src/renderer/lib/ui-editor/runtime/types.ts`、`runtime/hostAdapters/devModeBlueprintHostAdapter.ts` |
| Dev Mode | `src/renderer/apps/dev-mode/hooks/useDevModeBlueprintRuntime.ts`、`components/DevModeContent.tsx`、`DevModeSurfaceRenderer.tsx`、`BlueprintRuntimeDebugPanel.tsx` |
| 入口 UI | `src/renderer/apps/workspace/modules/blueprint-lite/*`、`ReadonlyBlueprintSection.tsx`、`SurfaceBlueprintEntrySection.tsx` |

## 与 M4-full 的兼容约定

- `BlueprintEntryTabPayload`（`blueprintId`、`ownerKind`、`surfaceId`、`elementId?`、`focusEventId?`）保留给完整编辑器复用。
- `ReadonlyBlueprintSection` / Surface 入口的状态字段可演进为 Literal / Bound / Broken 完整状态机。
- `SurfaceStateStore`、`BindingEvaluator`、`DebugBridge` 在 M3-full 扩展为多作用域与更全节点族，而非被画布层替换。
