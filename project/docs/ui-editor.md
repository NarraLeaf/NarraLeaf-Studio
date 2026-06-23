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
- 已有 widget module registry 和内置 widget 渲染。插入栏主区包含 Container、Text、Image、Button；Slider、List 和 Page 收在 overflow 菜单。
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
- `nl.slider` 是数值映射滑块控件，props 使用 `value` / `min` / `max` / `step` / `orientation`。插入时会创建两个专用 `nl.container` 内部部件：`track` 和 `handle`，并通过 `extra.sliderSlot` 与 `trackElementId` / `handleElementId` 识别。
- Slider 的 `track` / `handle` 可以双击进入后按普通 Container 编辑外观，但它们不是普通用户子元素；运行时布局由 Slider renderer 拥有，`handle` 位置由当前映射值推导。
- Editor-only 状态不要写入 UIDocument，例如 viewport、selection、snap、outline collapse、inspector cache。

## Blueprint 模型

- 当前事件图真相是 `UIGraphDocument.blueprintDocument.blueprints[*].program.graphs`，不是 legacy `graphs` map。
- Private owner slot 包括 `globalMain`、`surfaceMain:<surfaceId>`、`widgetMain:<surfaceId>:<elementId>`、`widgetValue:<surfaceId>:<elementId>:<encodedPropPath>`。
- Blueprint Value 是新的单点属性动态数据提供方案，当前覆盖 `nl.text` 的 `props.text`、`nl.button` 的 `props.label`、Page 组件 `nl.frame` 的 `props.params`、`nl.slider` 的 `props.value`。Text / Button / Slider 检视器不再使用旧 `binding:` 元数据连接内容字段，而是在 `UIElement.valueBindings` 中记录 `{ kind: "blueprintValue", blueprintId, valueType }`。
- 字面值切换为 Blueprint Value 时，`LocalBlueprintService` 会为该属性创建私有 value blueprint，并用当前字面值种子化默认 `Init` layer：`blueprint.event.head.init` 连接到 `blueprint.data.returnValue`。`string` 值使用 Text literal，`json` 值使用 JSON literal，`float` 值使用 Float literal。不会创建额外刷新 layer；刷新由 Blueprint Value 内部记录的 Element 属性依赖驱动。
- `nl.list` 私有 Blueprint 具有 Collection Events Head：`scroll`、`scrollEnd`、`itemRender`、`itemClick`、`itemHover`、`selectionChanged`。这些节点会在 List widget 的创建上下文浮窗中出现，并由真实滚动、条目渲染、点击、悬停和选中索引变化触发。
- `nl.slider` 私有 Blueprint 具有 Slider Events Head：`dragStart`、`valueChanged`、`dragEnd`。事件 payload 默认输出映射后的 `value`；需要 0-1 值时使用 `Get Slider Normalized Value` 节点。
- `UIBlueprintLifecycleCoordinator` 在 UIDocument mutate 后同步 Page / Game UI / widget private blueprint ownerRecords，并清理已删除对象。
- `LocalBlueprintService` 不单独落盘，所有 mutation 通过 `UIGraphService.applyGraphMutation()` 进入 `uigraphs.json`。
- UI history snapshot 同时覆盖 UIDocument 界面子树和相关 private blueprints，但 history 本身不落盘。
- Page 和 Game UI 后续可以拥有专属 Blueprint 节点；当前导航节点仍使用底层 surface id 作为内部参数。

## Workspace Preview、Dev Mode 与 Frame 边界

- `UIRuntimeBridgeService.renderSurface()` 用当前内存 UIDocument 渲染 Workspace preview 和 card preview。
- Workspace preview 不默认执行完整 blueprint runtime，也不等同 player runtime。
- Workspace preview 中 Slider 只读显示当前字面值或 Blueprint Value 初始值推导出的 handle 位置，不通过指针拖拽改值。Dev Mode / 运行时可通过真实交互或 Slider Host API 更新运行时值。
- 启动 Dev Mode 前，调用方需要确保 dirty UIDocument/UIGraph 已保存；Dev Mode 主进程从磁盘读取 `uidoc.json` 和 `uigraphs.json`。
- Dev Mode 的 runtime、Host API trace、binding evaluation、debug event bus 在 `src/renderer/apps/dev-mode/` 与 `src/renderer/lib/ui-editor/blueprint-runtime/`。
- Blueprint Value runtime 在元素挂载时执行 `init`，并在求值期间记录 Element/property 读取依赖。后续 UIDocument/runtime 同步时只比较这些依赖的属性快照；目标属性变化会排队重跑该 value binding，无关 surface/global state 变化不会强制重跑。没有返回值时保留上一次解析值，或退回 UIDocument 中的字面 props。
- 内部 widget `nl.frame` 在用户界面显示为 Page。它只出现在 Page surface 的 insert palette overflow 中，Game UI 不显示入口。
- Page 组件不是 iframe；它通过共享 renderer 在当前 UIDocument 中真实渲染目标 Page。目标必须是另一个 Page，不能指向当前 Page、Game UI、缺失 surface，或形成循环嵌套；非法目标显示占位错误而不是中断渲染。
- 在 Workspace 编辑器中，Page 组件内部是只读预览，不注入可编辑的子 Page editor chrome，也不会让选择/resize 命中子 Page 的元素。选中 Page 组件时，resize 控制器上方的浮动按钮组显示 Share 图标按钮，用于打开目标 Page 的独立编辑器 tab。
- Page 组件在属性面板中隐藏通用 Width / Height 行，改用 Scale。Scale 基于目标 Page 的 `designSize` 换算；`100%` 会把 Page 组件布局尺寸设为目标 Page 的真实分辨率。
- Page 组件首版为静态目标：props 包含 `targetSurfaceId`、`params`、`navigationMode: "static"`，并预留动画字段；不实现 frame-local push / replace / back。嵌入内容仍会渲染子 Page 内已有 widget / appearance 动画能力。
- Dev Mode 中每个 Page 组件实例创建独立 `runtimeScopeId`。`surfaceId` 仍用于查找 blueprint owner，`runtimeScopeId` 用于 surface state、widget locals、widget runtime state 和 lifecycle 隔离。
- 子 Page 在 Frame 实例首次挂载时触发自己的 `surfaceInit`，目标变化或组件卸载时触发 `surfaceUnmount`。同一个目标 Page 被多个 Page 组件引用时，这些 lifecycle 和本地状态互不共享。
- 子 Page 可通过 Host API `frame.getParam(key)` 读取父级传入参数，并通过 `frame.emit(event, data)` 向父 Page 上的 Page 组件实例发送固定 widget 事件 `pageEvent`；事件 head 输出 `event` 和 `data`。
- Slider Host API 通过 `widget.getSliderProperties` / `widget.setSliderProperties` 读取和写入运行时值与范围。`Set Slider Value`、`Set Slider Range` 只更新运行时状态，不写回 UIDocument，也不会自动再次派发 Slider 事件。

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
