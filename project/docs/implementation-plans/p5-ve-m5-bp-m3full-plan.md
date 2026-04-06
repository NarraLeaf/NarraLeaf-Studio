# P5: Visual Editor M5 + Blueprint M3-full（混合计划）

**Status:** Partial in-repo（2026-04）。静态诊断与 M3-full **扩展代码**已存在，**里程碑级逐项验收**仍部分开放。

## Visual Editor M5 — 已实现与 partial

| 类别 | 规则入口 | 矩阵状态（见 P7 附录） |
|------|----------|------------------------|
| 缺失资源 | `diagnostics/rules/resourceDiagnostics.ts` | done |
| link 异常 | `linkDiagnostics.ts` | done |
| Stage/Surface 配置 | `stageDiagnostics.ts` | partial（规则面偏窄） |
| 越界 | `layoutDiagnostics.ts` | done（核心越界） |
| 可见性 / 交互陷阱 | `interactionDiagnostics.ts` | partial（已覆盖核心子集） |
| 热点与尺寸 | `interactionDiagnostics.ts` | done |
| Dev Mode 入口提示 | `UISurfaceEditorTab.tsx` | done |

聚合入口：`collectSurfaceDiagnostics.ts`；属性面板条带：`PropertiesPanel.tsx`（P7：可跳转画布元素）。

## Blueprint M3-full — 已实现与 partial

| 子项 | 证据 | 状态 |
|------|------|------|
| `node.enter` / `node.exit` | `GraphExecutor.ts`、`debug.ts` | done |
| 扩展节点注册 | `blueprintM3FullNodes.ts`（对照 `blueprint-system-milestones.md` §7.7） | partial（需持续对照清单） |
| Host API 桥 | `BlueprintHostApiBridge.ts`、`devModeBlueprintHostAdapter.ts` | partial（家族逐项验收未齐） |
| Scope / 状态桥 | `ScopeStoreBridge.ts` | partial |
| 错误定位与调试桥 | Dev Mode `BlueprintRuntimeDebugPanel.tsx`、`execution.error` | partial（Workspace 统一跳转仍弱） |

## 明确非目标

- 在 P5/P7 单轮补全所有 Host API 家族与所有 §7.7 节点族而不另开阶段。
- 用 Workspace 替代 Dev Mode 作为深度调试唯一入口。

## 相关计划链

- 前置：`p2-bp-m3min-ve-m4lite-plan.md`
- 收口矩阵：`p7-doc-gap-closure-plan.md`
