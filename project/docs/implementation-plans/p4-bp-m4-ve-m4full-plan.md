# P4: Blueprint System M4-full + Visual Editor M4-full（混合计划）

**Status:** Partial in-repo（2026-04）。本文件区分 **已落地** 与 **仍属 partial / 回 P4-P6** 的项，避免将 M4-full 误判为全部完成。

## 已落地（可追溯）

| 能力 | 证据路径 |
|------|----------|
| M4-lite：只读摘要 + 打开统一 Blueprint Tab | `blueprint-lite/*`、`ReadonlyBlueprintSection.tsx`、`SurfaceBlueprintEntrySection.tsx` |
| 属性行 Literal / Bound / Broken | `usePropertyBindingState.ts`、`BindablePropertyField.tsx` |
| 解除绑定、跳到声明 | `usePropertyBindingState.ts`、`useOpenBlueprintTarget.ts` |
| 就地创建声明并绑定 | `LocalBlueprintService.createDeclaration`、`setWidgetPropBinding`；UI：**属性面板内**「Create & bind」（P7 去掉 `window.prompt`） |
| 搜索/选择已有声明并绑定 | 同上 + P7：`BindablePropertyField` 内声明列表与筛选 |
| Visual 图编辑、图级校验、Tab 内诊断 | `BlueprintEntryTab.tsx`、`BlueprintDiagnosticsPanel.tsx`、`graphValidation.ts` |
| Tab 内从诊断聚焦图/节点/声明 | `onDiagnosticPick` + `useBlueprintEditorState.applyDiagnosticTarget` |

## 仍属 partial（文档与矩阵一致）

| 项 | 说明 | 建议阶段 |
|----|------|----------|
| Workspace 静态诊断 → 画布节点 | P7：带 `elementId` 的诊断条可 **选中画布元素**；无 `elementId` 的项仍仅文案 | P7 / P5 |
| 编辑器画布挂接 `blueprintRuntime` | `UISurfaceEditorTab` 仍为最小 host；**非 P7 默认必做**（产品边界：真实执行在 Dev Mode） | P4/P5 单独立项 |
| 图诊断与属性静态提示的文案统一 | P7 已对齐 Blueprint 面板与 Properties 条带说明 | — |

## 明确非目标

- 在 Workspace 内复制完整 Dev Mode 运行时模拟器。
- 替换 React Flow 或重写 `GraphExecutor` 主架构。

## 验收锚点

- 属性绑定路径不再依赖浏览器 `prompt`。
- 可从属性行检索已有 declaration 并完成绑定。
- Blueprint Tab 内诊断点击可聚焦目标。

## 相关计划链

- 前置：`p2-bp-m3min-ve-m4lite-plan.md`
- 收口与矩阵：`p7-doc-gap-closure-plan.md`
