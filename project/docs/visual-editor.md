# NarraLeaf Studio - UI Editor（Visual Editor）实现概览

本文档用于快速理解当前仓库中 **UI Editor** 的现有结构与扩展点，避免把注意力花在未来不一定会用到的细节上。

目标读者：需要维护 UI Editor、增加新的 UI 组件（Widget）、或对接运行时宿主能力的开发者。

---

## 0. M1 状态快照（与里程碑对齐）

本文件同时扮演 **当前代码实现基线** 与 **Visual Editor M1 冻结后的状态快照**。

- **与 Blueprint 文档的关系**：蓝图系统的契约冻结见 `project/docs/blueprint-system.md` 与 `project/docs/blueprint-system-milestones.md`（Blueprint M1）。Visual Editor M1 只冻结**界面编辑器侧**的产品边界与体验基线，不重开 Blueprint M1 范围。
- **M1 已冻结（编辑器侧）**：
  - 继续以通用 UI Editor 为核心；不建立独立 VN 领域主模型。
  - **编辑器内只做静态/布局预览**；真实交互与副作用以 **Dev Mode** 为主场。
  - **第一阶段复用**只依赖 **Stage Surface → App Surface Link** 与 **复制/粘贴**；不引入模板/preset/可嵌套组件系统。
  - **M2 第一批基础 widget 清单（已锁定为 8 项）**：`Text`、`Image`、`Button`、`Container/Frame`、`Stack`、`Scroll`、`Spacer/Divider`、`Option List / Repeater` 最小形态（实现顺序在 M2 内再定）。
- **当前实现基线**：内置可插入 widget 包含 `nl.rectangle`、**M2-A** 四类（`nl.text`、`nl.image`、`nl.button`、`nl.container`）与 **M2-B** 四类：`nl.stack`、`nl.scroll`、`nl.spacerDivider`、`nl.listRepeater`（见 `src/renderer/lib/ui-editor/widget-modules/builtin/index.ts`）。`Stack` / `Scroll` / `List / Repeater` 的直接子节点在编辑器中使用 **流式布局**（flex），画布拖拽平移对这些子节点关闭，尺寸与排序仍可在属性面板与层级中调整。属性面板 Blueprint 区块为 **M4-lite 真实入口**；**M4-full** 仍待后续里程碑。
- **M1 相关 UI 壳层文件（验收锚点）**：
  - 左栏 Surface 列表：`src/renderer/apps/workspace/modules/ui-editor/UISurfacesPanel.tsx` 及 `panel/*`
  - 画布编辑 Tab：`src/renderer/apps/workspace/modules/ui-editor/editors/UISurfaceEditorTab.tsx`
  - 属性面板拼装：`src/renderer/apps/workspace/modules/properties/PropertiesPanel.tsx`

更完整的阶段拆分与 M1 完成判定见 `project/docs/visual-editor-milestones.md`；方向与取舍见 `project/docs/visual-editor-implementation-guide.md`。

---

## 1. TL;DR（你需要记住的最小事实）

- **编辑对象**：以 `Surface` 为单位编辑 UI（App / Stage）。
- **复用机制**：Stage Surface 可以通过 **App Surface link**（`link.kind = "appSurface"`）复用任意 App Surface 的内容（同一份 `uidoc.json` 中的 element tree，按目标 Surface 的 `rootElementId` 渲染）。需要独立副本时用复制粘贴，不要与 Link 混淆。Surfaces 列表现对已链接的 Stage Surface 展示 **App Surface link · 名称** 摘要；完整配置见 Scene Properties **Linked App Surface**（与文档用语一致）。
- **数据资产**：
  - UI 文档：`editor/ui/uidoc.json`
  - 行为图：`editor/ui/uigraphs.json`
- **渲染管线**：`UIRuntimeBridgeService.renderSurface()` 递归渲染 element tree，并用 `EditorNodeWrapper` 包一层用于命中/布局。
- **交互层**：`UIEditorInteractionLayer`（基于 `react-selecto` + `react-moveable`）负责选择、拖拽、缩放、插入预览等编辑交互。
- **扩展入口**：新增一种“可插入的 UI 组件类型”主要通过 **Widget Module**（`UIWidgetModule`）来做。

---

## 2. 核心概念（只保留对后续开发有用的部分）

### 2.1 Surface（挂载面）

UI Editor 以 `Surface` 作为编辑与管理单位（左侧 UI 面板管理 Surface 列表，点击打开 Surface 的编辑 Tab）。

- **App Surface**：`host: "app"`, `kind: "appSurface"`
- **Stage Surface**：`host: "player"`, `kind: "stageSurface"`，并带 `mount`：
  - `mount.kind: "slot"`：挂载到舞台插槽（`dialog/menu/notification/none`）
  - `mount.kind: "persistent"`：常驻舞台
  - `mount.kind: "layer"`：叠层/页面式 UI

#### 2.1.1 Stage Surface Link（复用 App Surface）

在 Dev Mode / Player 运行时场景中，经常需要“把 App 级页面复用到游戏内叠层中”，典型例子是 **Settings 页面**：

- App 外：作为 `App Surface`（例如在启动器或主界面中打开设置）
- 游戏内：作为 `Stage Surface (mount.kind = "layer")` 叠在舞台上

为避免“同一个页面维护两份 UI”，Stage Surface 需要支持 **Link 任意 App Surface**，并满足：

- **同一份 UI 文档**：Link 不是复制数据；Stage Surface 与被 Link 的 App Surface 共用同一个 `UIDocument` 的 `elements`（同一棵 element tree）。
- **按 id 解析**：运行时/编辑器预览必须通过 `surfaceId` 查找目标 App Surface，禁止依赖 `name`（因为 name 可被用户改动）。
- **渲染语义**：
  - Stage Surface 仍然决定 **挂载方式**（`mount`）与 **宿主环境**（player）。
  - Stage Surface 的“内容根节点”来自被 Link 的 App Surface：渲染时使用目标 App Surface 的 `rootElementId` 作为递归入口。
  - Stage Surface 自己的 `rootElementId` 仅用于兼容与占位（当未配置 Link 时仍正常渲染自身）。

建议的数据模型（用于后续类型与迁移实现）：

- 在 `UIStageSurface` 上新增可选字段：
  - `link?: { kind: "appSurface"; surfaceId: UISurfaceId }`

对应的渲染要求（用于 `UIRuntimeBridgeService.renderSurface()` 与 Player runtime）：

- 渲染 `surfaceId = stageSurface.id` 时：
  - 若 `stageSurface.link?.kind === "appSurface"`：
    - 解析目标 `appSurface`：`document.surfaces.find(s => s.id === stageSurface.link.surfaceId)`
    - 使用目标 `appSurface.rootElementId` 作为 element tree 入口
  - 否则使用 `stageSurface.rootElementId`

Surface 的设计分辨率为 `designSize`（宽高），编辑时视口缩放/平移不改变文档坐标系。

### 2.2 Element Tree（节点树）

`UIDocument.elements` 是一个以 id 为 key 的 element 表，父子关系通过：

- `parentId`
- `childrenIds`

来表达。每个 Surface 有一个 `rootElementId`，作为该 Surface 的根节点。

### 2.3 Selection（选中）

UI Editor 的选中状态复用 `UIStore.selection`，并用 `UIElementSelection` 数据结构区分 UI Editor 的 selection：

- `editor: "ui"`
- `surfaceId`
- `elementIds[]`
- `primaryId?`

这使得：画布选中、框选、层级树点击等，都能统一驱动属性面板与交互层。

---

## 3. 数据与持久化（实际落地）

### 3.1 文件位置（项目内）

路径约定统一由 `ProjectNameConvention` 提供：

- `editor/ui/uidoc.json`：UI 文档（`UIDocument`）
- `editor/ui/uigraphs.json`：行为图文档（`UIGraphDocument`）

对应约定定义：

- `src/renderer/lib/workspace/project/nameConvention.ts`

### 3.2 UIDocument（UI 文档）

类型定义在：

- `src/shared/types/ui-editor/document.ts`

读写与 auto-save（800ms debounce）在：

- `src/renderer/lib/workspace/services/ui-editor/UIDocumentService.ts`

它负责：

- 初始化并确保 `editor/ui/` 目录存在
- load/save
- dirty 状态与 revision
- 基础编辑操作（创建/删除 Surface，创建 Element，更新 layout/props，删除元素等）
- schema 迁移（以 `src/shared/types/ui-editor/document.ts` 中 `UI_DOCUMENT_SCHEMA_VERSION` 为准，包含 legacy surface kind 的迁移逻辑）

### 3.3 UIGraphDocument（本地 UI 图文档壳 + 实例蓝图）

类型定义在：

- `src/shared/types/ui-editor/graph.ts`

读写与 auto-save（800ms debounce）在：

- `src/renderer/lib/workspace/services/ui-editor/UIGraphService.ts`

它负责：

- load/save（`blueprintDocument` 为本地实例蓝图真相；顶层 `graphs` 仅为旧版行为图 IR 兼容区）
- dirty/revision
- 旧版 `UIGraph` CRUD（非 Blueprint 事件图主路径）

---

## 4. 渲染与宿主适配（Editor 预览）

### 4.1 渲染入口

Surface 在编辑器中的渲染入口为：

- `src/renderer/lib/workspace/services/ui-editor/UIRuntimeBridgeService.tsx`

关键点：

- 通过 `renderSurface({ surfaceId, hostAdapter, ... })` 找到 surface 与 root element
- 按 `childrenIds` 顺序递归渲染 element tree
- 每个 element 外包 `EditorNodeWrapper`，输出 `data-ui-element-id` 用于命中与选择

### 4.2 EditorNodeWrapper（定位与命中标识）

实现位于：

- `src/renderer/lib/ui-editor/runtime/EditorNodeWrapper.tsx`

默认把 `UILayout` 映射为绝对定位（root 为 relative，普通子节点为 absolute）。当父节点类型属于 **流式布局容器**（`nl.stack`、`nl.scroll`、`nl.listRepeater`，见 `UI_FLOW_LAYOUT_PARENT_ELEMENT_TYPES`）时，子节点使用 `layoutMode: "flow"`：`position: relative` 且 **忽略** 文档中的 `x/y` 作为画布偏移，由父级 flex 与 `width/height` 驱动排列。

统一写入：

- `data-ui-element-id="<id>"`
- `className="ui-editor-node ..."`

### 4.3 Host Adapter（宿主能力注入）

渲染与行为执行使用 `UIHostAdapter`：

- `src/renderer/lib/ui-editor/runtime/types.ts`

在编辑器 Tab 里目前用一个最小 adapter（`effects.runEffect` 为 no-op）：

- `src/renderer/apps/workspace/modules/ui-editor/editors/UISurfaceEditorTab.tsx`

如果需要让行为图在编辑器预览里产生真实效果（例如导航、弹窗、发事件），应把这些能力实现到一个真实的 host adapter 中，而不是把宿主 API 直接写进数据结构。

---

## 4.4 M3：组合范式与示例资产（无模板系统）

**不**提供编辑器内 “New from pattern” 或模板库。官方做法是：

1. 阅读本文与 `project/docs/visual-editor-milestones.md` §6 中的范式说明。
2. 对照 `project/examples/visual-editor/` 下各子目录中的 `editor/ui/uidoc.json`（及配套的 `uigraphs.json` 壳）。将 JSON 片段合并进项目的 `editor/ui/`，或按结构在画布中手搓。
3. **选择肢列表（Option list）** 不单独占一类主 widget：使用 **`nl.listRepeater` + `nl.button` + `nl.text`**（及可选 `nl.spacerDivider`）表达；Repeater 仅设计时预览份数，无运行时数据源。

子目录与用途对应：

| 目录 | 范式 |
|------|------|
| `dialog-surface/` | 对话框：容器 + 纵向 Stack + 操作行横向 Stack |
| `choice-menu/` | 选择菜单：`Scroll` + `List / Repeater` + 行按钮 |
| `notification-toast/` | 通知条：横向 Stack + Spacer |
| `settings-layer/` | 设置页 + **Stage layer 通过 App Surface link 复用同一 App 树** |
| `save-load-grid/` | 存读档：`Scroll` + `List / Repeater` 行模板 |
| `overlay-pause/` | 暂停/叠层菜单：全屏容器 + 纵向 Stack |

---

## 5. 交互层（选择/变换/插入）

交互层组件：

- `src/renderer/lib/ui-editor/interaction/UIEditorInteractionLayer.tsx`

它负责：

- 框选/点击选择（`react-selecto`）
- 移动/缩放控制柄（`react-moveable`）；**流式布局子节点**（父为 `nl.stack` / `nl.scroll` / `nl.listRepeater`）关闭拖拽平移，仍可调宽高与旋转
- 根据 `UIStore.selection` 解析 DOM 目标（通过 `data-ui-element-id`）
- 监听 `UIDocumentService` 变化后更新 overlay rect（`updateRect`）
- 插入模式的拖拽预览（Insert preview overlay）

坐标换算（client ↔ viewport ↔ surface）在：

- `src/renderer/lib/ui-editor/geometry/index.ts`

交互层的“控制器”模式（例如 transform / crop）在：

- `src/renderer/lib/ui-editor/interaction/controllers/`

---

## 6. Widget Modules（新增一种可插入的 UI 组件类型）

### 6.1 为什么是 Widget Module

当前仓库中，“新增一种 UI 组件类型”优先通过 `UIWidgetModule` 来扩展，它统一了：

- 默认 element 数据创建（createDefaultElement）
- 画布渲染（render）
- 属性面板 schema（createInspector，可选）
- docker bar（createDockerBarItems / createMultiSelectDockerBarItems，可选）

定义在：

- `src/renderer/lib/ui-editor/widget-modules/types.ts`

注册表：

- `src/renderer/lib/ui-editor/widget-modules/WidgetModuleRegistry.ts`
- `src/renderer/lib/ui-editor/widget-modules/registryInstance.ts`

内置模块列表：

- `src/renderer/lib/ui-editor/widget-modules/builtin/index.ts`

### 6.2 与“旧注册表”的关系（兼容层）

仓库仍保留了 legacy 的 `ElementTypeRegistry` / `ElementRendererRegistry` 形式以兼容现有代码：

- Element types（用于文档创建/校验）：`src/renderer/lib/ui-editor/element-types/*`
- Element renderers（用于运行时桥接渲染）：`src/renderer/lib/ui-editor/runtime/*`

但两者的 builtin 都是“从 BuiltinWidgetModules 映射出来”的：

- `src/renderer/lib/ui-editor/element-types/builtin/index.ts`
- `src/renderer/lib/ui-editor/runtime/builtin/index.ts`

因此，新增模块时的优先入口仍然是 **Widget Modules**。

### 6.3 新增一个 Widget（最短路径）

建议最小改动路径：

- 在 `src/renderer/lib/ui-editor/widget-modules/builtin/` 新增模块文件（参考 `rectangle.tsx` 与其子目录实现）
- 把新模块加入 `src/renderer/lib/ui-editor/widget-modules/builtin/index.ts` 的 `BuiltinWidgetModules`

完成后你会自动得到：

- 右键菜单 Insert（由 `UISurfaceEditorTab` 读取 `widgetModuleRegistry.list()`）
- runtime bridge 渲染（通过 builtin renderer 映射）
- `UIDocumentService.createElement()` 的 type 校验与默认创建（通过 builtin element types 映射）

---

## 7. 行为图（Behavior Graph）执行基础

行为图数据类型：

- `src/shared/types/ui-editor/graph.ts`

节点注册表与内置节点：

- `src/renderer/lib/ui-editor/behavior-graph/BehaviorNodeRegistry.ts`
- `src/renderer/lib/ui-editor/behavior-graph/builtinNodes.ts`

图执行器：

- `src/renderer/lib/ui-editor/behavior-graph/GraphExecutor.ts`

执行语义（最小约定）：

- 从 `entry.start` 指定的 node+port 开始
- 执行 node 对应 definition
- 根据返回的 `nextPort`（默认 `"next"`）沿 edges 找下一跳
- 通过 `hostAdapter.effects.runEffect(effectId, payload)` 落地副作用（内置 `effect.run` 节点）

提示：目前编辑器 Tab 的 host adapter 默认是 no-op，因此图执行的副作用在编辑器中不会产生真实效果，属于预期行为；要实现预览效果，需要提供一个真实 adapter。

---

## 8. UI 集成点（Workspace 内）

### 8.1 左侧面板：Surfaces 管理

面板模块入口：

- `src/renderer/apps/workspace/modules/ui-editor/index.tsx`

面板实现（Surface 列表 + 创建/删除 + Stage mount 筛选 + 打开 Tab）：

- `src/renderer/apps/workspace/modules/ui-editor/UISurfacesPanel.tsx`

### 8.2 Editor Tab：Surface 编辑

Tab 实现：

- `src/renderer/apps/workspace/modules/ui-editor/editors/UISurfaceEditorTab.tsx`

它负责：

- 获取 services（runtime bridge/state/document/ui）与 widget modules
- 视口 transform（scale/offset）
- 画布右键菜单 Insert（按 widget modules 动态生成）
- 渲染 surface 内容 + interaction layer + docker bar
- dirty 指示（通过 `uiService.editor.setModified(tabId, documentService.isDirty())`）

### 8.3 编辑态状态：工具/视口/交互覆盖

编辑态服务：

- `src/renderer/lib/workspace/services/ui-editor/UIEditorStateService.ts`

它负责：

- 统一存储 tool（select/pan/insert）
- 统一存储 viewport（并持久化到 `ProjectSettingsService`：`uiEditor.viewport`）
- 订阅并转发 selectionChanged
- 可选的 interactionOverride（用于控制器模式切换等）

---

## 9. 关键文件索引（高频入口）

### 9.1 Schema / Types

- `src/shared/types/ui-editor/document.ts`
- `src/shared/types/ui-editor/graph.ts`
- `src/shared/types/ui-editor/selection.ts`
- `src/shared/constants/ui-editor.ts`

### 9.2 项目内文件路径约定

- `src/renderer/lib/workspace/project/nameConvention.ts`

### 9.3 Services（持久化 + 状态 + 渲染桥接）

- `src/renderer/lib/workspace/services/ui-editor/UIDocumentService.ts`
- `src/renderer/lib/workspace/services/ui-editor/UIGraphService.ts`
- `src/renderer/lib/workspace/services/ui-editor/UIEditorStateService.ts`
- `src/renderer/lib/workspace/services/ui-editor/UIRuntimeBridgeService.tsx`

### 9.4 Widget Modules（扩展点）

- `src/renderer/lib/ui-editor/widget-modules/types.ts`
- `src/renderer/lib/ui-editor/widget-modules/WidgetModuleRegistry.ts`
- `src/renderer/lib/ui-editor/widget-modules/registryInstance.ts`
- `src/renderer/lib/ui-editor/widget-modules/builtin/index.ts`
- `src/renderer/lib/ui-editor/widget-modules/builtin/rectangle.tsx`
- `src/renderer/lib/ui-editor/widget-modules/builtin/rectangle/*`

### 9.5 Runtime / Wrapper

- `src/renderer/lib/ui-editor/runtime/EditorNodeWrapper.tsx`
- `src/renderer/lib/ui-editor/runtime/ElementRendererRegistry.ts`
- `src/renderer/lib/ui-editor/runtime/builtin/index.ts`

### 9.6 Interaction / Geometry

- `src/renderer/lib/ui-editor/interaction/UIEditorInteractionLayer.tsx`
- `src/renderer/lib/ui-editor/interaction/useSurfaceInteractionEvents.ts`
- `src/renderer/lib/ui-editor/interaction/controllers/*`
- `src/renderer/lib/ui-editor/geometry/index.ts`

### 9.7 Workspace UI

- `src/renderer/apps/workspace/modules/ui-editor/UISurfacesPanel.tsx`
- `src/renderer/apps/workspace/modules/ui-editor/editors/UISurfaceEditorTab.tsx`
- `src/renderer/apps/workspace/modules/ui-editor/editors/useUISurfaceEditorServices.ts`
