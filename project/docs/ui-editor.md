# UI Editor / Blueprint 功能上下文

本文描述 UI Editor、Page、Game UI、Widget Logic 与 Blueprint 的当前状态。Workspace 内 canvas 是编辑预览；完整执行边界主要在 Dev Mode。

## 当前实现

- 用户概念分为 Page 和 Game UI。
- Page 表示完整可打开的界面，例如标题页、设置页、存档页、历史页或画廊页。Page 未来可通过 page API 作为游戏外界面打开，也可通过 layer API 在游戏中叠加显示。
- Game UI 表示游戏运行时固有界面，例如 On-Stage、Dialog、Notification、Choice、HUD 或快捷栏等，服务于正在进行的剧情和 Player 状态。
- 底层仍保留 `appSurface` / `stageSurface` 作为内部数据边界：`appSurface` 映射 Page，`stageSurface` 映射 Game UI。
- UI document 由 `UIDocumentService` 负责 `editor/ui/uidoc.json` 的创建、迁移、编辑、保存。
- UI 管理器边栏按 Page / Game UI 创建和浏览界面；Page 创建时可设置画布尺寸，Game UI 固定使用项目分辨率并选择插槽。
- 已有 canvas 编辑、outline、inspector、拖拽/缩放、复制粘贴、分组排列、undo/redo、图片拖放、静态诊断、card preview。
- 已有 widget module registry 和内置 widget 渲染。
- 已有 local blueprint document：`UIGraphService` 持久化 `editor/ui/uigraphs.json`，`LocalBlueprintService` 操作 private blueprint。
- 已有 Blueprint Lite editor，可编辑 Page / Game UI / widget private blueprint 的 event graph、variables、fields、TypeScript module source。
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
- UI manager panel：`src/renderer/apps/workspace/modules/ui-editor/UISurfacesPanel.tsx`
- Interface editor：`src/renderer/apps/workspace/modules/ui-editor/editors/UISurfaceEditorTab.tsx`
- Blueprint Lite：`src/renderer/apps/workspace/modules/blueprint-lite/`
- Property binding：`src/renderer/apps/workspace/modules/properties/blueprint/`
- Widget modules：`src/renderer/lib/ui-editor/widget-modules/`
- Runtime renderer：`src/renderer/lib/ui-editor/runtime/surface/SurfaceElementTree.tsx`
- Blueprint runtime：`src/renderer/lib/ui-editor/blueprint-runtime/`
- Built-in blueprint nodes：`src/renderer/lib/ui-editor/blueprint-nodes/built-in/`

## UI 文档模型

- UI document 路径：`editor/ui/uidoc.json`
- UIGraph / local blueprint 路径：`editor/ui/uigraphs.json`
- Main Page 使用稳定 id，运行时按 id 查找，不按 name 查找。
- Page 底层为 `appSurface`，host 为 `app`。
- Game UI 底层为 `stageSurface`，host 为 `player`，插槽为 `onStage`、`dialog`、`notification`、`choice`。
- Game UI 不再暴露 link 或 layer 配置；Page 在游戏内作为叠层显示的互通由后续 page/layer API 内部管理。
- Flow parent 主要包括 `nl.stack`、`nl.scroll`、`nl.listRepeater`。
- Editor-only 状态不要写入 UIDocument，例如 viewport、selection、snap、outline collapse、inspector cache。

## Blueprint 模型

- 当前事件图真相是 `UIGraphDocument.blueprintDocument.blueprints[*].program.graphs`，不是 legacy `graphs` map。
- Private owner slot 包括 `globalMain`、`surfaceMain:<surfaceId>`、`widgetMain:<surfaceId>:<elementId>`。
- `UIBlueprintLifecycleCoordinator` 在 UIDocument mutate 后同步 Page / Game UI / widget private blueprint ownerRecords，并清理已删除对象。
- `LocalBlueprintService` 不单独落盘，所有 mutation 通过 `UIGraphService.applyGraphMutation()` 进入 `uigraphs.json`。
- UI history snapshot 同时覆盖 UIDocument 界面子树和相关 private blueprints，但 history 本身不落盘。
- Page 和 Game UI 后续可以拥有专属 Blueprint 节点；当前导航节点仍使用底层 surface id 作为内部参数。

## Workspace Preview、Dev Mode 与 Frame 边界

- `UIRuntimeBridgeService.renderSurface()` 用当前内存 UIDocument 渲染 Workspace preview 和 card preview。
- Workspace preview 不默认执行完整 blueprint runtime，也不等同 player runtime。
- 启动 Dev Mode 前，调用方需要确保 dirty UIDocument/UIGraph 已保存；Dev Mode 主进程从磁盘读取 `uidoc.json` 和 `uigraphs.json`。
- Dev Mode 的 runtime、Host API trace、binding evaluation、debug event bus 在 `src/renderer/apps/dev-mode/` 与 `src/renderer/lib/ui-editor/blueprint-runtime/`。
- Frame 系统本次只预留接口概念：未来可放置名为 Page 的组件，在其中渲染其他 Page 内容；渲染宽高比固定为目标 Page 尺寸；嵌套路径上不能出现重复 Page。本次不实现可拖拽 Page widget。

## 已知缺口

- TypeScript Blueprint 编辑体验仍是 textarea 级 partial，没有完整 Monaco/类型提示/源码级诊断闭环。
- 共享 Blueprint asset 有读取和 Dev Mode 编译路径，但 Workspace 内创建、搜索、编辑、实例调用共享 blueprint 的产品入口不完整。
- Function graph service API 存在，但 Workspace UI 暴露不完整。
- 完整 DevTools、节点高亮、调用栈、局部变量、TS source map 等不是完整闭环。
- Widget logic command 中 `setText`、`setSource`、`setLabel`、`refreshItems` 等仍是 planned；当前 runtime 主要实现 visible/enabled/variant、state/persistence/navigation/devtools 等能力。
- `UIBehaviorAction` 类型层基本只有 `noop`，旧 actions 行为绑定没有形成完整动作系统。
- Page 作为游戏内 layer 的真实运行时 host 语义仍待 page/layer API 完成。

## 修改建议

- 改 UI document 时同步检查 `UIDocumentService` migration、history snapshot、clipboard、Dev Mode bundle。
- 改 widget 能力时先查 widget module 定义，再查 runtime renderer 和 property editor。
- 改 blueprint 时区分：document schema、LocalBlueprint service API、Blueprint Lite UI、Dev Mode runtime executor。
- 需要真实运行行为时优先走 Dev Mode，而不是在 Workspace preview 里补执行语义。
