# NarraLeaf Studio - UI Editor 落地实现方案（DOM 原型式 / 按 Surface 分界面）

> 目标：在 **NarraLeaf Studio** 中新增一个“按挂载面（Surface）管理”的 UI 编辑器，让用户以接近原型设计软件的方式（层级、属性、行为为核心）编辑 UI，并且最终能够由 **NarraLeaf React**（纯 DOM + 动画库）在运行时渲染与执行行为。
>
> 本方案强调“可落地、贴合现有工程结构、不臆造现有能力”。凡是当前仓库中不存在但计划新增的内容，均以【待实现】/【可扩展】标注。

---

## 1. 已确认的上下文（来自当前仓库）

### 1.1 Studio 工程形态（已存在）

- **应用类型**：Electron App（主进程 `src/main`、渲染进程 `src/renderer`、共享层 `src/shared`）。
- **前端技术栈**：
  - React `^19.2.0`
  - TailwindCSS `^3`
  - TypeScript `^5.7.3`
- **渲染进程启动入口**：`src/renderer/lib/renderApp.tsx`
  - 通过 `getInterface()` 获取平台信息、App 信息，再渲染 React Root。
- **Workspace App**：`src/renderer/apps/workspace/WorkSpaceApp.tsx`
  - `WorkspaceProvider` 初始化 `Workspace` 与所有 `Service`，并激活服务
  - `RegistryProvider` 提供基于 hooks 的 UI 状态访问（但状态源是 `UIStore`）
- **核心架构抽象**：
  - `WorkspaceContext`：包含 `project: Porject` 与 `services: ServiceRegistry`
  - `Service`：统一生命周期（`init/activate/dispose`）与依赖初始化（`Service.initializeAll`）
  - `ServiceRegistry` + `Services` enum：统一服务索引（例如 `Services.Assets`、`Services.ProjectSettings`、`Services.UI`）
- **IDE UI 框架（已存在）**：
  - `UIService`：VSCode/IDEA 风格的 UI 中枢，聚合子服务：notifications/actionBar/panels/editor/dialogs/statusBar/focus/keybindings
  - `UIStore`：单一事实源（Single Source of Truth），包含：
    - `panels`、`editorLayout`（支持 group/tabs split）、`actions`、`actionGroups`、`selection` 等
  - `EditorService`（Studio 内部）：管理 editor tabs（通过 `UIStore.openEditorTabInGroup`）
  - `WorkspaceLayout`：IDE 布局容器（左右侧边栏 + 底部面板 + 中央 editor tabs 区域），并通过 `ProjectSettingsService` 将布局状态持久化到项目级设置。
- **文件系统与项目设置（已存在）**：
  - `FileSystemService`：通过 `getInterface().fs.*` 做读写（支持 `readJSON`/`write`/`writeRaw` 等）
  - `ProjectSettingsService`：项目级设置缓存，注释说明存储于 `.nlstudio/settings.json`（实际由 main process 提供 IPC API）
- **项目路径约定（已存在）**：`ProjectNameConvention`
  - 项目配置：`project.json`
  - 资产数据与元信息：`assets/` 与 `assets/assets.metadata.<type>.json`
  - Editor 相关目录：存在 `editor/` 约定（注释：不打包进最终产品），以及 `.nlstudio/editor.json` 等约定
- **资产系统（已存在）**：
  - `AssetsService`：含 `imageService/audioService/videoService/jsonService/fontService`，并提供 `getEvents()`（含 `deleted/updated`）
  - `ImageService`：支持 `readLocalImage/readImageFromBuffer` 并解析图片元信息（width/height/format）

### 1.2 运行时表演内核（由用户指定：NarraLeaf React）

本仓库不是 NarraLeaf React 本体，但 UI Editor 的“运行时目标”由用户明确为 **NarraLeaf React**，其核心约束如下（来源：NarraLeaf React 文档上下文）：

- **渲染范式**：纯 React + DOM（不依赖 Pixi 等渲染库）。
- **动画依赖**：Motion（文档中提到要求 Motion 11+）。
- **叙事模型**：Scenes / Elements / Actions；UI 行为在本项目中以「行为图（Behavior Graph）」作为唯一正式表达，并通过 Host Adapter 映射为运行时可执行的效果（effects）。
- **UI 构建与路由（技术映射补充）**：NarraLeaf React 在 **播放器层（Player）内部**提供基于 **Page / Page Router** 的 UI 组织方式（文档“Page Router”）。页面元素会被缩放以适配 Player 尺寸，并通过 Router API 在播放器内部切换。

> 因本仓库未包含 NarraLeaf React 实现细节，本方案只定义“与运行时对接的边界/协议”，不臆造运行时 API。

#### 1.2.1 运行时由两层组成（用户需要知道的最小事实）

实际运行时由两部分组成：

1. **应用层（App Runtime）**
   - 技术：Electron + 自有路由器
   - 职责：启动页、设置、画廊、存档页等“游戏外应用界面”
2. **播放器层（Player Runtime）**
   - 技术：NarraLeaf React Player
   - 职责：游戏演出（舞台、插槽、叠层界面）、设置、存档页
   - 约束：**NarraLeaf React 的 Page Router 仅存在于播放器层内部**

Studio 中编辑的 UI 必须同时服务于：

- 编辑环境（Studio 内预览）
- 生产运行时（App Runtime + Player Runtime）

并共享 **同一份 JSON 文档**（同一套结构、同一套行为语义）。

#### 1.2.2 将「Surface（界面挂载面）」作为核心概念（降低“页面”歧义）

为了让 Studio 编辑器与运行时共享同一份 JSON 文档，并保证编辑/生产环境行为一致，本方案引入一个更中立的概念：**Surface（挂载面）**。

- **Surface**：一个“可被挂载并渲染 UI 的容器目标”，在运行时对应到某个具体宿主与布局系统（例如 App 宿主、Player 宿主）。
- **Page（NarraLeaf React）**：仅在 **播放器层内部**存在的一种容器（带 `id`），可由 Page Router 切换；它不是 Studio 的用户心智核心，只是某类 Surface 的技术映射结果。

因此，Studio 的 UI 编辑对象不应等价于 “Page”，也不应把“页面”作为用户必须理解的前提，而应等价于：

- **Surface = 用户可以挂载内容的方式/位置**

并且强调：**Page 只是“可切换 Surface”的子概念**（用于技术映射说明）。

#### 1.2.3 三种 Surface（用户可挂载内容的三种方式/位置）

为了降低用户心智负担，并贴合运行时真实存在的形态，本方案把 UI 拆为三类 Surface（也是 Studio 左侧栏要呈现的三组“挂载点类型”）：

1. **应用界面（App Surface）**
   - 宿主：应用层（Electron + 自有路由器）
   - 行为特征：可切换（由应用路由决定）
2. **播放器舞台层（Player Stage Surface）**
   - 宿主：播放器层（NarraLeaf React Player）
   - 行为特征：**常驻**（播放器表演期间始终存在）
3. **播放器叠层界面（Player Overlay Surface）**
   - 宿主：播放器层（NarraLeaf React Player）
   - 行为特征：可切换（由播放器内部路由/叠层系统决定）
   - 技术映射：在 NarraLeaf React 中通常映射为 `Page id="..."` 并由 Page Router 切换（仅在“技术映射说明”中提及）

> 注意：播放器内部“Slots（插槽）”不是第四类 Surface。它属于 **Player Stage Surface 的能力**：Stage 提供若干可挂载的插槽位置，用于替换/承载特定 UI 组件（例如对话框、选项等）。

---

## 2. 目标、非目标与设计原则

### 2.1 目标（MVP → 可扩展）

- **按 Surface 分界面**：每个 Surface 是一个“运行时可挂载目标”，并按三分类组织：
  - App Surface（应用界面）
  - Player Stage Surface（播放器舞台层 + Slots 能力）
  - Player Overlay Surface（播放器叠层界面；在技术映射中可对应 NarraLeaf React Page）
- **编辑核心体验偏“原型工具”**：
  - 层级（Layers）是第一入口：树状结构、拖拽排序、分组/容器化
  - 属性（Inspector）可视化编辑：布局、样式、资源引用、可见性等
  - 行为（Behavior）结构化绑定：例如点击触发某个运行时动作
- **所见即所得（WYSIWYG）**：编辑器中的 UI 渲染应尽量复用/贴近运行时 DOM 组件。
- **可序列化**：编辑结果可保存为项目资产（JSON），支持版本化与迁移。
- **编辑/生产环境同构**：通过“中立的 UI Runtime 适配层 + 约定接口”让同一份 JSON 在编辑器预览与生产运行时具有相同行为（同选择的节点类型、同事件触发、同动作语义）。
- **可扩展**：元素类型与属性字段、插槽定义、行为节点都通过 registry 扩展（预留位置由用户填充）。

### 2.2 非目标（明确不做或后做）

- 不引入 Pixi/WebGL/Canvas 渲染内核来替代运行时 DOM（编辑交互可以用 DOM/overlay 实现）。
- 不以白板/绘图工具为产品形态（例如自由绘制、手绘风、矢量路径编辑等不是第一优先级）。
- 不在本阶段实现复杂排版系统（Auto Layout / 约束布局全量版等）——但会预留扩展点。

### 2.3 关键原则（避免未来返工）

1. **文档模型（Document Model）与渲染实现解耦**：编辑器/运行时都从同一份“UI 文档”读取。
2. **运行时一致性优先**：编辑器显示效果应尽量与 NarraLeaf React 运行时一致（同 DOM 组件、同 CSS/主题）。
3. **增量落地**：先做稳的 MVP（移动/缩放/层级/属性/保存/预览），再做复杂吸附、约束、组件化等。
4. **所有新增能力都必须可被序列化**：避免只存在于编辑器内存态的“不可导出功能”。

---

## 3. 总体架构：在现有 Studio 架构内落地 UI Editor

### 3.1 在 Studio 中的定位

UI Editor 是 **Workspace 的一个内建模块**，以“Editor Tab + Panels + Actions/Keybindings”的方式集成：

- **中央编辑区**：作为一个 `EditorTabDefinition<TPayload>` 打开（由 `UIService.editor.open(...)` 或 Registry 的 `openEditorTab(...)` 触发）
- **侧边栏/底部**：
  - Layers（层级树）
  - Inspector（属性）
  - Assets（复用现有资产面板或提供 UI 专用筛选视图）
  -（可选）Console/Problems（后做）
- **全局 Actions/Keybindings**：通过 `UIStore.registerAction/registerActionGroup` 注册（参考 `useModuleLoader` 的模式）

> 这与当前 Workspace 的模块加载机制一致：模块在 `useModuleLoader()` 中注册 Panels/Actions/Keybindings，UI 状态由 `UIStore` 统一管理。

### 3.2 建议新增的核心服务（与现有 Service 系统对齐）

以下服务均为【待实现】，但必须按现有 `Service` 生命周期/依赖注入模式实现：

1. 【待实现】`UIDocumentService`（或 `UIScreenService`）
   - 职责：UI 文档的加载/保存/版本迁移/变更追踪/脏标记（modified）
   - 依赖：`FileSystemService`、`ProjectService`（读取 `project.json`）、`UuidService`、`AssetsService`（校验引用/监听删除）
2. 【待实现】`UIEditorStateService`
   - 职责：编辑态状态（当前 surface、selection、hover、viewport、tool mode、snap settings）
   - 与 `UIStore.selection` 的对接：将 UI 节点选中状态写入 `UIStore`，让 Properties 面板能复用“selection 驱动”的现有模式
3. 【待实现】`UIRuntimeBridge`（或 `UIRenderService`）
   - 职责：将 UI 文档映射为可渲染的 React 组件树，并提供“编辑器渲染容器”；同时通过宿主接口（Host Adapter）对接 NarraLeaf React 的 Page Router、Stage/Slots 等运行时概念
   - 注意：此处只定义边界，不假设 NarraLeaf React 的内部 API；可采用“内部适配层”方式隔离运行时变化

> 是否把这些合并成一个 service：不建议。因为“文档持久化”和“交互状态”在工程上应该隔离，且会影响 undo/redo 设计。

---

### 3.3 核心资产形态（UI 文档 / 行为图）

为了保证“编辑器与运行时完全同构”，本项目需要把两类内容都资产化（可序列化、可迁移、可复用）：

- **UI 文档（UIDocument）**：描述界面结构（surfaces/nodes/layout/style/props），并在节点上仅保存“行为引用”（不保存行为实现）。
- **行为图（Behavior Graph）**：描述行为逻辑（nodes/ports/edges/entries），可被多个 UI 节点、多个 surface 复用与绑定。

两者之间通过结构化引用建立关系（例如 `UIBehaviorBinding { kind: "graph"; graphId; entry }`），从而让 UI 与行为都能独立演化、独立迁移，同时又能在运行时被同一套解释器执行。

### 3.4 行为系统：行为图（Behavior Graph）是唯一正式表达

本项目中，**UI 行为的唯一正式表达方式是「行为图（Behavior Graph）」**。

UI 编辑器不会以“脚本”“回调函数”或“动作列表（Action List）”作为面向用户的主要交互模型，而是采用**结构化、可视化、可序列化的节点蓝图编程模型**，以保证：

- 行为可视化、可理解、可调试
- 文档可迁移、可校验、可分析依赖
- 编辑器与运行时完全同构
- 行为系统长期可扩展（而不演化成技术债）

### 3.4.1 设计立场（明确约束）

本项目在行为系统上的**明确立场**如下：

1. **行为 = 图（Graph），不是代码**
   - UI 文档中**不允许**存储函数、脚本字符串、匿名回调
   - 所有行为必须由 **节点 + 端口 + 连线** 表达

2. **行为图是唯一的一等公民**
   - 行为图（Graph）是可编辑、可复用、可绑定的核心资产
   - UI 节点只“引用”行为图的入口（entry），而不内嵌行为逻辑

3. **行为系统是宿主中立的**
   - 行为图本身不直接调用 NarraLeaf React / App Runtime API
   - 所有副作用通过 Host Adapter 执行（见 3.4.4）

4. **不为 MVP 留下不可回收的“简化债务”**
   - 任何非图形化行为方案，只允许作为：
     - 内部过渡
     - 自动生成
     - 兼容旧数据
   - 不作为用户长期使用的创作模型

### 3.4.2 设计参照：Unity / Unreal 的“节点蓝图”经验（概念对齐，不照搬实现）

本项目选择“行为图”作为唯一正式表达方式，核心原因与 Unity / Unreal 的可视化脚本（例如 Unity Visual Scripting / Unreal Blueprint）相同：

- 它们把“行为”建模为可序列化资产（graph asset），从而允许编辑器、版本控制、校验、依赖分析、调试工具围绕同一份数据共演化。
- 它们把“副作用执行”明确隔离到宿主能力里（引擎/运行时提供节点实现或适配层），而不是让用户在资产里写任意代码。

我们借鉴的是**资产化 + 可视化 + 可执行同构**这三点，而不是把引擎的 API/节点集合硬搬进 NarraLeaf。

### 3.4.3 行为图协议（最小可扩展约定）

行为图需要满足三个工程要求：

- **可序列化**：纯数据结构（JSON），不包含可执行代码
- **可校验**：节点类型、端口连线、输入输出类型（后续可扩展）都可静态检查
- **可执行**：运行时按统一语义解释执行（编辑器预览与生产运行时同构）

因此建议的最小结构如下（协议草案，注释英文；【待实现】）：

```ts
// Behavior graph spec (proposed).

export type UIGraphId = string;

export type UIGraphDocument = {
  graphs: Record<UIGraphId, UIGraph>;
};

export type UIGraph = {
  id: UIGraphId;
  name?: string;
  // Entry points are named, bound from UIBehaviorBinding {kind:"graph", entry:"..."}
  entries: Record<string, UIGraphEntry>;
  nodes: Record<string, UIGraphNode>;
  edges: UIGraphEdge[];
  // [EXTENSION POINT] variables/constants shared within this graph
  // variables?: ...
};

export type UIGraphEntry = {
  // Which node+port starts the execution
  start: { nodeId: string; port: string };
  // Optional typed inputs from event payload
  // inputs?: ...
};

export type UIGraphNode = {
  id: string;
  type: string; // resolved via BehaviorNodeRegistry
  // Serializable parameters for this node
  params?: Record<string, unknown>;
};

export type UIGraphEdge = {
  // Connect output -> input (flow or data)
  from: { nodeId: string; port: string };
  to: { nodeId: string; port: string };
};
```

### 3.4.4 Host Adapter：副作用执行边界（宿主中立的关键）

为保证“宿主中立”，行为图（以及 UI 文档）**不直接**调用 NarraLeaf React / App Runtime 的具体 API。

统一约定：

- 行为图只产生“效果请求（effect request）”
- 副作用由 **Host Adapter** 在不同宿主（编辑器预览 / App Runtime / Player Runtime）中落地执行

Host Adapter 的接口与分层思路见 `4.4.3 Host Adapter`。在行为系统视角，它是唯一允许接触宿主 API 的边界。

### 3.4.5 行为节点分层：控制流（Control Flow）与效果（Effect）

为保持“宿主中立”（不把 NarraLeaf React / App Runtime 的具体 API 写死进 schema），建议把行为节点分成两类：

1. **控制流节点（Control Flow）**
   - 例如：Sequence / If / Switch / Delay
   - 特征：不依赖宿主能力，只依赖图执行器本身

2. **效果节点（Effect）**
   - 特征：把“需要产生副作用的操作”抽象为稳定的 `effectId + payload`
   - 执行：统一通过 Host Adapter 的 `effects.runEffect(effectId, payload)` 来落地

这样你可以先定义一组稳定的 effect id（例如 `navigate.playerPage`、`navigate.appRoute`、`set.variable`、`emit.event`），而“如何调用 NarraLeaf React 的 Page Router / App 路由 / Player 能力”由不同宿主的 adapter 自己决定与实现。

## 4. 技术分层（绝对细化的抽象分层）

### 4.1 Layer 0：基础设施（已存在）

- Electron IPC 接口：`getInterface()`
- 文件系统：`FileSystemService`
- 项目设置：`ProjectSettingsService`
- 资产：`AssetsService` + 子服务（`ImageService` 等）
- Studio UI 框架：`UIService` / `UIStore` / Registry hooks

### 4.2 Layer 1：UI 文档模型（Document Model）【待实现】

核心目标：定义一个 **可序列化、可迁移、可扩展** 的 UI 文档 schema。

#### 4.2.1 设计策略：规范化（Normalized）存储

原因：

- 层级树的局部编辑（移动节点、重排、复制）更高效
- Undo/Redo 可按 element 粒度记录 diff
- 选择集（multi-select）与跨 surface 引用更容易管理

推荐结构：`surfaces[]` + `elementsById{}` + `roots{surfaceId -> rootElementId}`。

#### 4.2.2 最小数据结构（MVP）

下面是“最小可用但可扩展”的 TS 结构草案（【待实现】；字段不是现有仓库字段，而是将要新增的 schema）。代码块内注释使用英文。

```ts
// NOTE: Proposed schema for UI Editor (to be implemented).

export type UIDocumentVersion = number;

export type UIDocument = {
  schemaVersion: UIDocumentVersion;
  id: string; // document id (uuid)
  name: string;
  // Surfaces are first-class. Each surface has a root element.
  surfaces: UISurface[];
  // Normalized element store (across all surfaces)
  elements: Record<string, UIElement>;
  // Optional: shared resources / symbols (future)
  // symbols?: Record<string, UISymbol>;
  meta?: {
    createdAt?: string; // ISO
    updatedAt?: string; // ISO
    // [EXTENSION POINT] add editor-specific metadata here
  };
};

export type UIHost = "app" | "player";

export type UISurfaceKind =
  | "appSurface"          // App Surface (app runtime)
  | "playerStageSurface"  // Player Stage Surface (always-on) + slots
  | "playerOverlaySurface"; // Player Overlay Surface (switchable; maps to Page Router)

export type UISurface = {
  id: string; // uuid
  name: string;
  host: UIHost;
  kind: UISurfaceKind;
  // Design-time size, typically from project resolution (ProjectConfig.metadata.resolution if provided)
  designSize: { width: number; height: number };
  rootElementId: string;
  // Surface-level settings
  settings?: {
    backgroundColor?: string;
    // [EXTENSION POINT] safe area, device presets, etc.
  };
  // Optional routing info (meaning depends on host/kind)
  route?: {
    // For "playerOverlaySurface": should map to NarraLeaf React <Page id="...">
    // For "appSurface": app route id (future)
    id?: string;
  };
  // Slots exist only for playerStageSurface (by convention)
  slots?: Record<string, UISlotDefinition>;
};

export type UISlotDefinition = {
  // Stable slot id (defined by your runtime conventions)
  id: string;
  name: string;
  // Optional: slot layout container root (if slot itself hosts a subtree)
  rootElementId?: string;
  // [EXTENSION POINT] slot capabilities / constraints
  // e.g. allowedNodeTypes?: string[]
  // e.g. acceptsMultiple?: boolean
};

export type UIElement = {
  id: string; // uuid
  type: string; // element type id, resolved via ElementTypeRegistry
  name?: string; // display name in Layers

  parentId: string | null;
  childrenIds: string[];

  // Layout & transform for editor/runtime mapping
  layout: UILayout;

  // Visual style (high-level; exact fields depend on your runtime components)
  style?: UIStyle;

  // Type-specific props (validated by registry)
  props?: Record<string, unknown>;

  // Behavior bindings (event -> operation graph entrypoints)
  behavior?: UIBehavior;

  // [EXTENSION POINT] Custom fields per element type
  extra?: Record<string, unknown>;
};

export type UILayout = {
  // Use a single canonical coordinate system: surface-local logical pixels.
  // x/y/width/height are editor authoritative values (not DOM pixels).
  x: number;
  y: number;
  width: number;
  height: number;

  // Optional transforms (keep minimal in MVP)
  rotation?: number; // degrees
  opacity?: number;  // 0..1
  visible?: boolean;

  // [EXTENSION POINT] constraints / anchors for responsive layout
  // constraints?: UIConstraints;
};

export type UIStyle = {
  // Keep this minimal and map to runtime component style props.
  // [EXTENSION POINT] fill, stroke, shadow, typography, etc.
};

export type UIBehavior = {
  // Event bindings are structured data, not arbitrary code.
  // IMPORTANT: Graph is the only first-class authoring model.
  // "actions" is allowed only as an internal transitional/compatibility layer:
  // - legacy data migration
  // - auto-generated graph (or internal tooling)
  // - temporary internal wiring (not user-facing)
  // Users should author graphs, not action lists.
  events?: Record<string, UIBehaviorBinding>;
};

export type UIBehaviorBinding =
  | { kind: "noop" }
  // Legacy/transitional binding (NOT user-facing)
  | { kind: "actions"; actions: UIBehaviorAction[] }
  // Graph binding (recommended)
  | { kind: "graph"; graphId: string; entry: string };

export type UIBehaviorAction =
  | { kind: "noop" }
  // [EXTENSION POINT] Add runtime-supported actions here.
  // Keep it host-neutral and map via Host Adapter.
  // | { kind: "navigate"; target: { host: "player"; pageId: string } }
  // | { kind: "navigate"; target: { host: "app"; routeId: string } }
  // | { kind: "setVariable"; scope: "game" | "ui"; key: string; value: unknown }
  ;
```

#### 4.2.3 不变式（Invariants）与校验

必须在 `UIDocumentService` 内部保证（【待实现】）：

- `surface.rootElementId` 必须存在于 `elements`
- 每个 `UIElement` 的 `childrenIds` 中的 id 必须存在，且其 `parentId` 必须等于当前 element id
- 跨 surface 的 element 可以共用同一 `elements` 表，但必须可以从某个 surface root 追溯到（否则视为悬挂元素，需要清理或隔离到回收站）
- `layout.width/height` 不得为负；最小值策略（例如 1）应统一
- `type` 必须能在 ElementTypeRegistry 中找到（找不到时应降级为 UnknownElement 或提示缺失插件）

#### 4.2.4 可扩展点：ElementTypeRegistry（元素类型注册表）【待实现】

目的：让你后续可以不断加元素类型，但不污染核心编辑器。

建议提供以下抽象（字段为方案设计，不代表当前仓库已有）：

```ts
export type ElementTypeDefinition = {
  type: string; // stable id, e.g. "nl.image", "nl.text"
  displayName: string;
  icon?: unknown; // map to lucide-react icon component in UI layer

  // Editor rendering (WYSIWYG) - returns a React element for the element.
  // Must be pure and deterministic for the given element data.
  render: (ctx: ElementRenderContext) => React.ReactElement;

  // Default data when creating an element of this type.
  createDefault: (ctx: ElementCreateContext) => Partial<UIElement>;

  // Inspector schema (drives property panel)
  // [EXTENSION POINT] You fill actual fields per element type.
  inspector?: PropertySchema;

  // Behavior schema (drives behavior editor)
  behavior?: BehaviorSchema;

  // Validation
  validate?: (element: UIElement) => { ok: true } | { ok: false; message: string };
};
```

> 注意：上面只是“抽象层”，具体字段由你填充。关键是 registry 提供统一入口，使元素扩展不需要改核心引擎。

---

### 4.3 Layer 2：持久化与项目文件布局（Persistence）【待实现】

#### 4.3.1 文件存放位置（建议）

结合现有 `ProjectNameConvention` 中对 editor 目录的约定（存在 `editor/`），建议新增 UI Editor 专属文件到 **项目根目录的 `editor/` 目录**下：

- `editor/ui/uidoc.json`（主 UI 文档，包含 surfaces/nodes/graphs 等）
- （可选）`editor/ui/history.json`（不建议：history 通常不持久化；更建议仅内存）
- （可选）`editor/ui/thumbnails/<surfaceId>.png`（后做：surface 缩略图）

【待实现】需要在 `ProjectNameConvention` 增加对应 path helper（避免散落硬编码）。

#### 4.3.2 读写机制（贴合现有 FileSystemService）

`UIDocumentService` 将复用：

- `FileSystemService.readJSON<T>(path)`：加载 UI 文档
- `FileSystemService.write(path, JSON.stringify(doc), "utf-8")`：保存 UI 文档
- 保存时机建议：
  - **显式保存**（Ctrl/Cmd+S）
  - **节流自动保存**（例如 500ms/1s，类似 `WorkspaceLayout` 对设置做 debounce 的模式）

#### 4.3.3 schemaVersion 与迁移（必须设计）

必须在 UI 文档最外层带 `schemaVersion`，并提供迁移表：

```ts
type Migration = (doc: any) => any;
const migrations: Record<number, Migration> = {
  // 1: migrateV1toV2,
};
```

迁移原则：

- 迁移应是纯函数（输入旧 doc，输出新 doc）
- `UIDocumentService.load()`：
  - 读取 JSON
  - 校验 `schemaVersion`
  - 若落后则依次迁移并写回（或标记“需保存”）
  - 若超前则提示“Studio 版本过旧”

---

### 4.4 Layer 3：运行时映射（Runtime Mapping）【待实现】

目标：将 `UIDocument` 的 `UISurface.rootElementId` 渲染为 **React DOM 组件树**，并且这棵树尽可能与 NarraLeaf React 运行时一致；同时对接 NarraLeaf React 的 **Player Stage / Page Router** 概念，以保证“编辑/生产同构”。

#### 4.4.1 映射策略：Editor/Runtime 共享渲染，但隔离“编辑包装”

- 运行时（NarraLeaf React）：直接渲染节点对应的业务组件
- 编辑器：渲染同一套业务组件，但每个节点外包一层 `EditorNodeWrapper`

`EditorNodeWrapper` 的职责（【待实现】）：

- 为 DOM 节点提供稳定标识：`data-ui-element-id="<id>"`
- 管理 pointer events：阻止运行时交互触发（例如 click 不应直接执行剧情）
- 提供测量与命中所需的 ref：供交互层获取 `getBoundingClientRect()`
- 提供可视化辅助：hover 高亮、选中描边（可由 overlay 层统一画）

#### 4.4.2 CSS/主题：无需 iframe，轻量隔离即可

实际情况：Studio 本身有 Tailwind 与全局样式，但它们对编辑区的影响通常**没那么大**；同时 UI 编辑器做的是**静态编辑**（关注结构/布局/属性/行为绑定），不需要为了“运行时样式完全隔离”而承担 `iframe` 的工程复杂度（坐标换算、事件桥接、资源加载差异等）。

建议采用更轻量的隔离策略即可（【待实现】）：

- 在编辑区使用专用 root container（例如 `.ui-canvas-root`），把画布内 UI 的样式作用域尽量收敛到该容器下
- 仅在必要时对画布 root 做最小的 reset，避免 Studio 的全局样式产生明显干扰
- 主题/变量尽量与运行时对齐（例如通过 CSS variables / theme tokens），而不是依赖“完全隔离的运行时 CSS 环境”

只有当未来出现明确的“样式不可控”问题时，才考虑把 `iframe` 作为可选方案，而不是默认方案。

#### 4.4.3 Host Adapter：用中立接口保证编辑/生产同构（关键补充）【待实现】

为避免把编辑器与 NarraLeaf React（或未来 App 导航）强耦合，本方案引入 **Host Adapter（宿主适配器）**：同一份 `UIDocument` 在不同环境下，通过不同 adapter 注入能力，从而达到一致行为。

核心约束：

- UI 文档只描述“结构（nodes）+ 目标（surfaces）+ 行为（behavior graphs）”
- 运行时/编辑器分别提供 adapter，实现：
  - 页面导航（App 路由 / Player Page Router）
  - 插槽挂载（Stage slots）
  - 行为执行（操作节点 → 实际效果）

建议的 adapter 接口（草案，注释英文；【待实现】）：

```ts
export type UIHostAdapter = {
  host: "app" | "player";

  // Navigation capability (optional depending on host/kind)
  navigate?: (target: unknown) => Promise<void> | void;

  // Slot capability (playerStageSurface only)
  resolveSlot?: (slotId: string) => { mount: (el: React.ReactNode) => void } | null;

  // Behavior side-effects (host-neutral execution)
  effects: {
    // [EXTENSION POINT] you define stable effect ids and payload schemas
    runEffect: (effectId: string, payload: unknown) => Promise<void> | void;
  };
};
```

> 运行时 adapter 会对接 NarraLeaf React 的 Page Router（例如 navigate 到某个 Page id）；编辑器 adapter 则可以用“模拟导航栈/当前 page”来实现一致预览。

#### 4.4.4 开发模式：独立预览子窗口（Test App）+ Studio Developer Tools 叠层

在项目的开发模式中，Studio 会创建一个新的窗口（子窗口）用于承载“预览/测试应用”（Test App），并在该窗口内叠加 Studio 的开发者工具（Developer Tools overlay）。

这个开发模式窗口的目标是：

- **更贴近生产运行时**：在独立窗口中渲染 UI（以及相关宿主能力），减少与 Studio 主界面样式/布局/输入系统的耦合
- **更好的调试体验**：Developer Tools overlay 提供调试叠层（例如命中/选中信息、布局信息、性能提示等），帮助定位渲染与行为问题
- **避免不必要的隔离复杂度**：既然开发模式天然具备“新窗口承载预览”的形态，就不必为了隔离而默认引入 `iframe`

在工程结构上（【待实现】），这意味着：

- `UIRuntimeBridge` 在 Studio 主窗口用于“静态编辑视图”
- 同一份 `UIDocument` 在开发模式子窗口中用于“更接近运行时的预览/测试”
- 两个窗口通过统一的文档与 Host Adapter 语义保持一致，但拥有各自的渲染容器与调试叠层

---

### 4.5 Layer 4：编辑器交互系统（Interaction System）【待实现】

> 本层是“像原型工具”的关键，但你明确不想做 canvas 适配。这里给出 DOM-only 可落地的交互分层。

#### 4.5.1 交互基础：工具（Tool）与状态机

定义编辑器工具模式（MVP）：

- `Select`：选择/框选/拖拽移动/缩放
- `Pan`：按 Space 或中键进行画布平移
- `Insert`：插入新节点（按类型）

工具状态机建议落在 `UIEditorStateService`（或与 view model 相关的 store）：

```ts
export type UITool =
  | { kind: "select" }
  | { kind: "pan" }
  | { kind: "insert"; nodeType: string };
```

#### 4.5.2 坐标系统与变换（必须统一）

必须明确至少三套坐标：

- **Surface Logical Space**：UI 文档中 `layout.x/y/width/height` 所在坐标系（建议 = 设计分辨率像素）
- **Viewport Space**：编辑器画布缩放/平移后，对应到屏幕上的坐标
- **DOM Client Space**：`getBoundingClientRect()` 返回的浏览器坐标

必须实现以下可复用的转换函数（【待实现】）：

- `screenToViewport(point|rect)`
- `viewportToSurface(point)`
- `clientToViewport(point)`
- `clientToSurface(point)`（常用：鼠标事件 -> 文档坐标）

> 注意：如果未来引入 `iframe`（可选方案）或采用“独立预览子窗口”承载画布，坐标换算会多一层容器/窗口偏移，需要在 `clientToSurface` 等函数中统一处理。

#### 4.5.3 选择模型（Selection Model）

现有 `UIStore` 已有 `selection: { type: "asset" | "element" | "scene" | "character" | null; data: any }`。

建议 UI Editor 直接复用 `type: "element"`，并定义 `data` 的结构（【待实现】）：

```ts
// Proposed selection payload for UI nodes.
export type UIElementSelection = {
  editor: "ui";
  surfaceId: string;
  elementIds: string[]; // multi-select
  // Optional: primary element for inspector focus
  primaryId?: string;
};
```

使得：

- Layers 面板与画布点击都能更新同一 selection
- Properties 面板只订阅 selection，便能展示 element 属性

#### 4.5.4 DOM 交互实现路线（不引入 canvas）

有两种可行路线，均为【待实现】并可分阶段采用：

**路线 A（推荐）：引入成熟 DOM 交互库作为“交互零件”**

- 多选框选：`react-selecto`
- 拖拽/缩放/旋转控制点：`react-moveable`
- Layers 拖拽排序：`dnd-kit`

优点：交互手感与边界情况（handles、比例锁定、多选变换等）省大量时间。  
代价：需要引入新依赖并做适配（但适配成本远小于自研交互）。

**路线 B：自研最小交互（MVP）**

- 仅支持：单选、拖拽移动、四边缩放
- 旋转、框选、多选变换暂不做

优点：依赖少；缺点：你迟早还会补齐复杂交互，整体成本通常更高。

> 本方案默认路线 A，但不会假设这些库已在 `package.json` 中存在（它们目前不在依赖里）。

#### 4.5.5 Snap / Guides / Grid（分层实现）

MVP 建议只做：

- 网格（Grid）：渲染辅助线；移动/缩放时对 `x/y/width/height` 进行取整（例如 1/2/4/8 px）
- 元素间对齐（Guides）：
  - 基于“已渲染 DOM”的边界框（`getBoundingClientRect`）计算
  - 支持对齐：左/右/上/下/水平居中/垂直居中

更高级的（后做）：

- 智能间距提示（equal spacing）
- 分布（distribute）
- 自动对齐线优先级（closest wins）

Snap 的工程建议：把“几何计算”单独放在 `ui-editor/geometry` 层（【待实现】），避免散落在组件里。

---

### 4.6 Layer 5：编辑器 UI（Panels / Inspector / Layers）【待实现】

#### 4.6.1 Editor Tab：UI Surface Editor

一个 Surface 对应一个 editor tab（或 tab payload 指向当前 surfaceId）：

- tab id：建议稳定，例如 `ui-editor:surface:<surfaceId>`
- tab title：surface name
- tab payload：至少包含 `surfaceId`
- modified：由 `UIDocumentService` 提供脏状态（未保存变更）

在现有体系中，这些将通过 `EditorTabDefinition<TPayload>` 注册并打开（见 `EditorService` 与 Registry 的 `openEditorTab`）。

#### 4.6.2 Layers Panel（层级树）

功能（MVP）：

- 显示当前 surface 的 element 树（root -> children）
- 单选/多选（Shift/Ctrl）
- 拖拽调整层级与顺序（建议 `dnd-kit`）
- 显示可见性（eye）、锁定（lock）【可扩展】

数据来源：

- element 树：来自 `UIDocumentService` 当前文档
- 选中状态：来自 `UIStore.selection`（type=element）

#### 4.6.3 Inspector Panel（属性面板）

必须遵循“不要臆造字段”的原则：Inspector 面板的字段由 ElementTypeRegistry 定义。

核心机制（【待实现】）：

- 订阅 `UIStore.selectionChanged`
- 若 `editor !== "ui"` 或无 elementIds，则显示空态
- 若单选：读取 `UIElement` 并渲染该 type 对应的 `inspector schema`
- 若多选：展示“通用字段（layout）”的批量编辑；type-specific 字段只在相同 type 时才显示（否则隐藏）

通用字段（MVP）建议只包含：

- `x/y/width/height`
- `visible`
- `opacity`
- `rotation`（可选，若 MVP 暂不支持旋转则不在 UI 中开放）

#### 4.6.4 Assets 面板对接（复用现有 AssetsService）

本仓库已经具备 `AssetsService` 与 `ImageService` 等能力，因此 UI Editor 的资源引用应复用该体系，而不是另起一套。

建议策略：

- UI 文档中不要直接存本地路径；存 `Asset` 的标识（例如 asset id + type + source）【具体字段以现有资产类型定义为准】
- Inspector 中提供“选择图片/字体”的 picker：
  - 读取 `AssetsService.getAssets()` 展示可用资源
  - 选择后将 asset 引用写入 element.props 或 element.style（由 ElementTypeRegistry 定义字段）
- 监听资产删除事件：
  - `AssetsService.getEvents().on("deleted", ...)`
  - 当引用资源被删除时：
    - 对应 element 标记“引用缺失”（UI 上警告）
    - 或自动清空引用字段（需明确策略）

> 注意：本仓库中资产引用结构由 `Asset<T, AssetSource>` 定义（在 `src/renderer/lib/workspace/services/assets/types`），UI 文档引用应与之对齐；本方案不在这里臆造 Asset 的具体字段。

---

## 5. 编辑器内部“变更系统”：命令、历史、脏状态（必须可落地）

### 5.1 为什么必须用命令系统（Command Pattern）

UI 编辑器的操作高度语义化（移动、缩放、重排、改属性、改行为、批量操作），若直接 setState，后续会出现：

- Undo/Redo 无法覆盖所有变更
- 多选批量操作难以合并
- 保存/modified 状态不可靠

因此建议：

- 所有会改变 `UIDocument` 的操作都必须走 `command.execute()`。

### 5.2 Command 抽象（【待实现】）

```ts
export type UICommand = {
  id: string;
  label: string;
  // Apply change
  do: (ctx: UICommandContext) => void;
  // Revert change
  undo: (ctx: UICommandContext) => void;
  // Optional: merge for continuous dragging
  canMergeWith?: (next: UICommand) => boolean;
  merge?: (next: UICommand) => UICommand;
};
```

`UICommandContext` 需要能访问：

- 当前 `UIDocument`（可变或不可变策略二选一）
- `UIDocumentService` 的更新接口（例如 `applyPatch`）
- 事件通知（documentChanged）

### 5.3 Continuous 操作的合并策略（拖拽/缩放）

拖拽移动会产生大量中间状态，必须合并：

- 鼠标按下：开始一个“事务”（transaction）
- 鼠标移动：只更新内存态（或产生可 merge command）
- 鼠标抬起：提交一个可 undo 的最终 command（或合并后的 command）

> 这与 `AssetsService.transaction()` 的 batching 思想一致，但对象不同；可借鉴其“beginBatch/endBatch + flush”结构。

### 5.4 modified（未保存）状态的来源

建议由 `UIDocumentService` 维护：

- 文档加载后记录 `lastSavedRevision`
- 每次 command commit 后 revision++ 并设置 dirty
- 保存后更新 `lastSavedRevision`

然后通过 `UIService.editor.setModified(tabId, true/false)` 或直接更新 tab definition 的 `modified` 字段（取决于你们 tab 状态承载方式）来反映 UI。

---

## 6. Surface 级别体系（防止用户迷惑的概念模型）

> 本节用于解决你提出的核心问题：**“游戏内叠层也是页面，但有些页面只能用叠层，有些又是静态页面”** 如何在概念上不让用户迷惑。
>
> 方案：对用户暴露的最高层概念不是“页面”也不是“屏幕”，而是 **挂载面（Surface）**。页面只是某些 Surface 的一种表现形式（Overlay Page / App Page），而舞台固定层（Stage）不是页面。

### 6.1 用户侧心智模型（只记住 Surface，不强迫理解 Page）

对用户（内容创作者）而言，Studio 只需要暴露一个核心概念：

- **Surface（界面挂载面）**：你要把界面“挂载到哪里/以什么方式存在”。

Surface 只有三类（与运行时真实形态一一对应）：

- **App Surface**：应用层界面（可切换）
- **Player Stage Surface**：播放器舞台常驻层（始终存在，且提供 Slots）
- **Player Overlay Surface**：播放器叠层界面（可切换）

“页面（Page）”一词尽量不作为用户概念使用；它只在“技术映射说明”中出现，用于解释 Player Overlay Surface 在 NarraLeaf React 中如何落地。

### 6.2 Studio 左侧栏的交互心智（与你的设计思路对齐）

你描述的交互可以用非常直观的方式固化成用户心智：

- **左侧栏（UI / Surfaces）**
  - 顶部：一个水平按钮组（Segmented Control），用于选择挂载点类型：
    - App Surface
    - Player Stage Surface
    - Player Overlay Surface
  - 下方：当前类型下的“挂载内容容器”列表（可简化命名为“界面”）
    - 新建/重命名/复制/删除
    - 点击某个容器 → 打开对应的编辑区（Editor Tab）

- **中央编辑区（Editor Tab）**
  - 显示当前 Surface 容器的 UI 结构与预览（WYSIWYG）
  - 点击画布元素或左侧容器树节点 → 更新 selection

- **右侧栏（属性 / Inspector）**
  - 单一事实源来自 `UIStore.selection`
  - 无论 selection 来源于左侧列表/树还是画布点击，都只通过同一 selection 模型驱动属性面板展示

> 这里的“容器”是为了减少“页面”歧义的命名策略。它是一个可编辑、可保存、可在运行时挂载的 UI 内容单元（对用户来说就是“一个界面”）。

### 6.3 技术映射说明（仅在这里提及 NarraLeaf React Page）

当且仅当需要解释运行时落地时，才引入“Page”术语：

- **Player Overlay Surface** → NarraLeaf React：通常映射为 `<Page id="...">...</Page>`，由 Player 的 Page Router 在播放器内部切换显示
- **Player Stage Surface** → NarraLeaf React：对应 Player 内“常驻舞台层”，不通过 Page Router 切换
- **App Surface** → App Runtime：对应 Electron 应用层路由（自有路由器），与 Player Page Router 无关

### 6.4 Surface 与分辨率（设计尺寸）关系

本仓库 `ProjectConfig` 的 `metadata` 中包含 `resolution?: {width,height}`（Partial），并且已有 `BaseProjectService.parseResolution`。

建议策略（MVP）：

- 新建 Surface 默认采用：
  - 若项目配置里有 resolution：用它作为 `designSize`
  - 否则给一个默认（【由你填】）
- Surface 的 `designSize` 是“文档坐标系基准”，不随编辑器窗口变化

补充：对于 Player Overlay Surface（技术上映射到 NarraLeaf React Page），运行时会对页面做缩放适配；因此编辑器中的 viewport 缩放（设计工具层）与运行时的 Player scale（表演层）是两件事，必须在模型中区分：

- 编辑器 viewport：仅影响“你怎么查看/编辑”，不改变文档坐标
- 运行时 player scale：影响“游戏实际显示”，由 Player 控制；UI 文档只提供设计尺寸与布局规则

### 6.5 多 Surface 管理的 UI 形态（建议）

不臆造具体 UI，但从现有 IDE 布局出发，推荐两种落地方式：

- 方式 1：左侧新增一个 Panel（例如 “UI”），列表管理 surfaces（新建/重命名/复制/删除；并按三分类分组）
- 方式 2：在 UI Editor 的 tab 内提供顶部下拉/侧边栏切换（但这不符合 IDE 风格）

更贴合现有体系的是方式 1：通过 `UIStore.registerPanel({ position: Left|Right, ... })` 集成。

---

## 7. 与现有 Studio 系统的集成点清单（不写到文件级，但写到抽象级）

### 7.1 与 UIService / UIStore / Registry 的集成

你将使用以下现有能力（已存在）：

- `UIStore.registerPanel`：注册 Layers/Inspector/Surfaces 等面板
- `UIStore.registerAction` / `registerActionGroup`：注册 UI Editor 的操作（对齐、复制、删除、保存等）
- `UIService.keybindings.registerMany`：为 UI Editor 注册快捷键（并可用 `when` 控制生效场景）
- `UIStore.selection`：复用 `type: "element"`，让 Properties 面板可直接按 selection 驱动
- `EditorService` / Registry 的 `openEditorTab`：打开 UI Editor tab

### 7.2 与 AssetsService 的集成

已存在能力：

- `AssetsService.getAssets()/list/fetch/exists`
- `AssetsService.getEvents().on("deleted"/"updated")`
- `ImageService.readLocalImage` 可用于 Inspector 显示图片信息（例如尺寸）

UI Editor 的落地要求（【待实现】）：

- 定义“UI 文档引用资产”的统一引用结构（必须与 `Asset` 类型对齐，不重复发明）
- 在 `UIDocumentService` 中做引用检查/修复策略

### 7.3 与 ProjectSettingsService 的集成

建议用于保存“编辑器偏好”（而不是 UI 文档内容）：

- 网格开关/网格大小
- 吸附开关
- 画布背景色偏好
- 最近打开的 surfaceId

保存方式：复用 `ProjectSettingsService.setBatch` 的 debounce 模式（参考 `WorkspaceLayout`）。

---

## 8. MVP 里程碑拆解（保证可落地、不虚构）

> 这里不是产品承诺，只是工程落地拆分；每一项都能在现有架构里实现并逐步上线。

### 8.1 MVP-0：文档与 UI 入口（最小通路）

- 【待实现】定义 `UIDocument` 最小 schema（surface + element）
- 【待实现】`UIDocumentService`：能创建空文档、保存/加载 JSON
- 【待实现】注册一个 UI Editor editor tab（能打开、显示当前 surface）
- 【待实现】在 tab 中渲染 root -> children 的 DOM（可先用最简单 div 占位）

验收点：

- 新建 UI 文档 → 保存到 `editor/ui/...` → 重启 Studio → 能加载回来

### 8.2 MVP-1：选中与属性编辑（以层级/属性为核心）

- 【待实现】Layers panel：显示树 + 点击选中（写入 `UIStore.selection`）
- 【待实现】Inspector panel：显示通用 layout 字段，并能修改（走 command）
- 【待实现】画布点击命中：点击元素也能选中（通过 `data-ui-element-id` + hit test）

验收点：

- 修改 x/y/width/height 会立即影响画布渲染
- selection 在 Layers 与画布之间同步

### 8.3 MVP-2：拖拽移动/缩放（DOM-only）

- 引入路线 A 或路线 B（见 4.5.4）
- 【待实现】拖拽移动 → command 合并（或 transaction）
- 【待实现】缩放 → 更新 layout.width/height + x/y（按锚点计算）

验收点：

- 拖动结束后一次 undo 能回到原位置

### 8.4 MVP-3：资产引用与行为（最小行为）

- 【待实现】至少一个“图像节点类型”与 assets 引用对接（字段由你确定）
- 【待实现】行为系统最小实现：允许把事件绑定到 `graph`（或 `noop`），并能序列化保存；`actions` 仅作为内部过渡/兼容层存在（不做用户创作模型）

验收点：

- 资产删除时能提示引用缺失（或清空引用）

---

## 9. 预留扩展区（由你填写）

> 本节刻意留空/占位，避免本方案替你臆造产品字段。你可以在这里逐步补齐“元素类型”“属性字段”“行为动作”等扩展内容。

### 9.1 【可扩展】元素类型清单（Node Types）

- 类型 ID：`__________`
  - displayName：`__________`
  - 默认 props：`__________`
  - Inspector 字段：`__________`
  - 运行时映射：`__________`
  - 行为支持：`__________`

(重复添加更多类型...)

### 9.2 【可扩展】通用样式字段（UIStyle）

- `__________`
- `__________`

### 9.3 【可扩展】行为动作（UIBehaviorAction）

- `kind: "__________"`
  - payload: `__________`
  - runtime mapping: `__________`

### 9.4 【可扩展】布局约束（UIConstraints）

- 约束模型选择：`__________`（例如 anchors / flex / auto layout）
- 字段定义：`__________`
- 与 Surface resize 的策略：`__________`

---

## 10. 风险与工程注意事项（贴合现状）

- **样式差异风险**：Studio 使用 Tailwind + 全局样式，但对编辑区的影响通常可控；编辑区以静态编辑为主，默认不采用 `iframe`。建议通过“画布 root 作用域收敛 + 必要时最小 reset + 主题 token 对齐”降低样式偏差；开发模式的独立预览子窗口也能进一步减少与 Studio 主界面样式系统的耦合。
- **性能风险**：大量节点时，频繁 `getBoundingClientRect()` 与 React re-render 可能成为瓶颈；需在交互层做节流/缓存。
- **序列化风险**：不要在文档中存函数/闭包；行为必须结构化数据。
- **兼容性风险**：UIStore.selection.data 当前为 `any`，容易被不同编辑器模块写入冲突；建议统一添加 `editor: "ui"` discriminator。

