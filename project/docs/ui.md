# UI / Blueprint 功能上下文

本文合并 UI Editor、Visual Editor、Blueprint 与 Widget Logic 的当前状态。Workspace 内 canvas 是编辑预览；完整执行边界主要在 Dev Mode。

## 当前实现

- 已有 UI surface/element 文档：`UIDocumentService` 负责 `editor/ui/uidoc.json` 的创建、迁移、编辑、保存。
- 已有 App Surface 和 Stage Surface；Stage 可 link 到 App Surface，复用同一棵 element tree。
- 已有 Surface panel 和 Surface editor tab，支持创建/删除 surface、Stage link、canvas 编辑、outline、inspector、拖拽/缩放、复制粘贴、分组排列、undo/redo、图片拖放、静态诊断、card preview。
- 已有 widget module registry 和内置 widget 渲染。
- 已有 local blueprint document：`UIGraphService` 持久化 `editor/ui/uigraphs.json`，`LocalBlueprintService` 操作 private blueprint。
- 已有 Blueprint Lite editor，可编辑 surface/widget private blueprint 的 event graph、variables、fields、TypeScript module source。
- 已有 Dev Mode UI runtime，可读取磁盘 bundle、执行最小 blueprint runtime、应用 Host API 变更并展示 debug panel。

## 入口文件

- UI document 类型：`src/shared/types/ui-editor/document.ts`
- UI graph 类型：`src/shared/types/ui-editor/graph.ts`
- Blueprint document 类型：`src/shared/types/blueprint/document.ts`
- UIDocument service：`src/renderer/lib/workspace/services/ui-editor/UIDocumentService.ts`
- UIGraph service：`src/renderer/lib/workspace/services/ui-editor/UIGraphService.ts`
- Local blueprint service：`src/renderer/lib/workspace/services/ui-editor/LocalBlueprintService.ts`
- Blueprint lifecycle：`src/renderer/lib/workspace/services/ui-editor/UIBlueprintLifecycleCoordinator.ts`
- Editor state：`src/renderer/lib/workspace/services/ui-editor/UIEditorStateService.ts`
- Editor history：`src/renderer/lib/workspace/services/ui-editor/UIEditorHistoryService.ts`
- Preview bridge：`src/renderer/lib/workspace/services/ui-editor/UIRuntimeBridgeService.tsx`
- Font face service：`src/renderer/lib/workspace/services/ui-editor/UIEditorFontFaceService.ts`
- Node catalog：`src/renderer/lib/workspace/services/ui-editor/BlueprintNodeCatalogService.ts`
- Surface panel：`src/renderer/apps/workspace/modules/ui-editor/UISurfacesPanel.tsx`
- Surface editor：`src/renderer/apps/workspace/modules/ui-editor/editors/UISurfaceEditorTab.tsx`
- Blueprint Lite：`src/renderer/apps/workspace/modules/blueprint-lite/`
- Property binding：`src/renderer/apps/workspace/modules/properties/blueprint/`
- Widget modules：`src/renderer/lib/ui-editor/widget-modules/`
- Surface runtime renderer：`src/renderer/lib/ui-editor/runtime/surface/SurfaceElementTree.tsx`
- Blueprint runtime：`src/renderer/lib/ui-editor/blueprint-runtime/`
- Built-in blueprint nodes：`src/renderer/lib/ui-editor/blueprint-nodes/built-in/`

## UI 文档模型

- UI document 路径：`editor/ui/uidoc.json`
- UIGraph / local blueprint 路径：`editor/ui/uigraphs.json`
- Main App Surface 使用稳定 id，运行时按 id 查找，不按 name 查找。
- Stage Surface link 到 App Surface 时，渲染入口应解析到被 link 的 App Surface root。
- Flow parent 主要包括 `nl.stack`、`nl.scroll`、`nl.listRepeater`。
- Editor-only 状态不要写入 UIDocument，例如 viewport、selection、snap、outline collapse、inspector cache。

## Blueprint 模型

- 当前事件图真相是 `UIGraphDocument.blueprintDocument.blueprints[*].program.graphs`，不是 legacy `graphs` map。
- Private owner slot 包括 `globalMain`、`surfaceMain:<surfaceId>`、`widgetMain:<surfaceId>:<elementId>`。
- `UIBlueprintLifecycleCoordinator` 在 UIDocument mutate 后同步 surface/widget private blueprint ownerRecords，并清理已删除对象。
- `LocalBlueprintService` 不单独落盘，所有 mutation 通过 `UIGraphService.applyGraphMutation()` 进入 `uigraphs.json`。
- UI history snapshot 同时覆盖 UIDocument surface 子树和相关 private blueprints，但 history 本身不落盘。

## Workspace Preview 与 Dev Mode 边界

- `UIRuntimeBridgeService.renderSurface()` 用当前内存 UIDocument 渲染 Workspace preview 和 surface card preview。
- Workspace preview 不默认执行完整 blueprint runtime，也不等同 player runtime。
- 启动 Dev Mode 前，调用方需要确保 dirty UIDocument/UIGraph 已保存；Dev Mode 主进程从磁盘读取 `uidoc.json` 和 `uigraphs.json`。
- Dev Mode 的 runtime、Host API trace、binding evaluation、debug event bus 在 `src/renderer/apps/dev-mode/` 与 `src/renderer/lib/ui-editor/blueprint-runtime/`。

## 已知缺口

- TypeScript Blueprint 编辑体验仍是 textarea 级 partial，没有完整 Monaco/类型提示/源码级诊断闭环。
- 共享 Blueprint asset 有读取和 Dev Mode 编译路径，但 Workspace 内创建、搜索、编辑、实例调用共享 blueprint 的产品入口不完整。
- Function graph service API 存在，但 Workspace UI 暴露不完整。
- 完整 DevTools、节点高亮、调用栈、局部变量、TS source map 等不是完整闭环。
- Widget logic command 中 `setText`、`setSource`、`setLabel`、`refreshItems` 等仍是 planned；当前 runtime 主要实现 visible/enabled/variant、state/persistence/navigation/devtools 等能力。
- `UIBehaviorAction` 类型层基本只有 `noop`，旧 actions 行为绑定没有形成完整动作系统。

## 修改建议

- 改 UI document 时同步检查 `UIDocumentService` migration、history snapshot、clipboard、Dev Mode bundle。
- 改 widget 能力时先查 widget module 定义，再查 runtime renderer 和 property editor。
- 改 blueprint 时区分：document schema、LocalBlueprint service API、Blueprint Lite UI、Dev Mode runtime executor。
- 需要真实运行行为时优先走 Dev Mode，而不是在 Workspace preview 里补执行语义。
