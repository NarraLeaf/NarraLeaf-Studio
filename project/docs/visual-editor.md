# NarraLeaf Studio - UI Editor 落地实现方案（DOM 原型式 / 按 Screen 分界面）

> 目标：在 **NarraLeaf Studio** 中新增一个“按屏幕（Screen）管理”的 UI 编辑器，让用户以接近原型设计软件的方式（层级、属性、行为为核心）编辑 UI，并且最终能够由 **NarraLeaf React**（纯 DOM + 动画库）在运行时渲染与执行行为。
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
- **叙事模型**：Scenes / Elements / Actions；UI 行为最终需要映射到“可被运行时执行”的结构化动作或回调绑定。

> 因本仓库未包含 NarraLeaf React 实现细节，本方案只定义“与运行时对接的边界/协议”，不臆造运行时 API。

---

## 2. 目标、非目标与设计原则

### 2.1 目标（MVP → 可扩展）

- **按 Screen 分界面**：每个 Screen 类似原型工具的一个画板/页面；可多 Screen 管理、切换、重命名、复制、删除。
- **编辑核心体验偏“原型工具”**：
  - 层级（Layers）是第一入口：树状结构、拖拽排序、分组/容器化
  - 属性（Inspector）可视化编辑：布局、样式、资源引用、可见性等
  - 行为（Behavior）结构化绑定：例如点击触发某个运行时动作
- **所见即所得（WYSIWYG）**：编辑器中的 UI 渲染应尽量复用/贴近运行时 DOM 组件。
- **可序列化**：编辑结果可保存为项目资产（JSON），支持版本化与迁移。
- **可扩展**：元素类型与属性字段可通过 registry 扩展（预留位置由用户填充）。

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
   - 职责：编辑态状态（当前 screen、selection、hover、viewport、tool mode、snap settings）
   - 与 `UIStore.selection` 的对接：将 UI 节点选中状态写入 `UIStore`，让 Properties 面板能复用“selection 驱动”的现有模式
3. 【待实现】`UIRuntimeBridge`（或 `UIRenderService`）
   - 职责：将 UI 文档映射为可渲染的 React 组件树，并提供“编辑器渲染容器”
   - 注意：此处只定义边界，不假设 NarraLeaf React 的内部 API；可采用“内部适配层”方式隔离运行时变化

> 是否把这些合并成一个 service：不建议。因为“文档持久化”和“交互状态”在工程上应该隔离，且会影响 undo/redo 设计。

---

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
- Undo/Redo 可按 node 粒度记录 diff
- 选择集（multi-select）与跨 screen 引用更容易管理

推荐结构：`screens[]` + `nodesById{}` + `roots{screenId -> rootNodeId}`。

#### 4.2.2 最小数据结构（MVP）

下面是“最小可用但可扩展”的 TS 结构草案（【待实现】；字段不是现有仓库字段，而是将要新增的 schema）。代码块内注释使用英文。

```ts
// NOTE: Proposed schema for UI Editor (to be implemented).

export type UIDocumentVersion = number;

export type UIDocument = {
  schemaVersion: UIDocumentVersion;
  id: string; // document id (uuid)
  name: string;
  // Screens are first-class. Each screen has a root node.
  screens: UIScreen[];
  // Normalized node store (across all screens)
  nodes: Record<string, UINode>;
  // Optional: shared resources / symbols (future)
  // symbols?: Record<string, UISymbol>;
  meta?: {
    createdAt?: string; // ISO
    updatedAt?: string; // ISO
    // [EXTENSION POINT] add editor-specific metadata here
  };
};

export type UIScreen = {
  id: string; // uuid
  name: string;
  // Design-time size, typically from project resolution (ProjectConfig.metadata.resolution if provided)
  designSize: { width: number; height: number };
  rootNodeId: string;
  // Screen-level settings
  settings?: {
    backgroundColor?: string;
    // [EXTENSION POINT] safe area, device presets, etc.
  };
};

export type UINode = {
  id: string; // uuid
  type: string; // node type id, resolved via NodeTypeRegistry
  name?: string; // display name in Layers

  parentId: string | null;
  childrenIds: string[];

  // Layout & transform for editor/runtime mapping
  layout: UILayout;

  // Visual style (high-level; exact fields depend on your runtime components)
  style?: UIStyle;

  // Type-specific props (validated by registry)
  props?: Record<string, unknown>;

  // Behavior bindings (event -> actions)
  behavior?: UIBehavior;

  // [EXTENSION POINT] Custom fields per node type
  extra?: Record<string, unknown>;
};

export type UILayout = {
  // Use a single canonical coordinate system: screen-local logical pixels.
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
  // Example: "onClick": [{ kind: "narraleafAction", ... }]
  events?: Record<string, UIBehaviorAction[]>;
};

export type UIBehaviorAction =
  | { kind: "noop" }
  // [EXTENSION POINT] Add runtime-supported actions:
  // | { kind: "narraleafAction"; actionId: string; payload?: unknown }
  // | { kind: "setVariable"; key: string; value: unknown }
  // | { kind: "navigateScreen"; screenId: string }
  ;
```

#### 4.2.3 不变式（Invariants）与校验

必须在 `UIDocumentService` 内部保证（【待实现】）：

- `screen.rootNodeId` 必须存在于 `nodes`
- 每个 `UINode` 的 `childrenIds` 中的 id 必须存在，且其 `parentId` 必须等于当前 node id
- 跨 screen 的 node 可以共用同一 `nodes` 表，但必须可以从某个 screen root 追溯到（否则视为悬挂节点，需要清理或隔离到回收站）
- `layout.width/height` 不得为负；最小值策略（例如 1）应统一
- `type` 必须能在 NodeTypeRegistry 中找到（找不到时应降级为 UnknownNode 或提示缺失插件）

#### 4.2.4 可扩展点：NodeTypeRegistry（节点类型注册表）【待实现】

目的：让你后续可以不断加元素类型，但不污染核心编辑器。

建议提供以下抽象（字段为方案设计，不代表当前仓库已有）：

```ts
export type NodeTypeDefinition = {
  type: string; // stable id, e.g. "nl.image", "nl.text"
  displayName: string;
  icon?: unknown; // map to lucide-react icon component in UI layer

  // Editor rendering (WYSIWYG) - returns a React element for the node.
  // Must be pure and deterministic for the given node data.
  render: (ctx: NodeRenderContext) => React.ReactElement;

  // Default data when creating a node of this type.
  createDefault: (ctx: NodeCreateContext) => Partial<UINode>;

  // Inspector schema (drives property panel)
  // [EXTENSION POINT] You fill actual fields per node type.
  inspector?: PropertySchema;

  // Behavior schema (drives behavior editor)
  behavior?: BehaviorSchema;

  // Validation
  validate?: (node: UINode) => { ok: true } | { ok: false; message: string };
};
```

> 注意：上面只是“抽象层”，具体字段由你填充。关键是 registry 提供统一入口，使元素扩展不需要改核心引擎。

---

### 4.3 Layer 2：持久化与项目文件布局（Persistence）【待实现】

#### 4.3.1 文件存放位置（建议）

结合现有 `ProjectNameConvention` 中对 editor 目录的约定（存在 `editor/`），建议新增 UI Editor 专属文件到 **项目根目录的 `editor/` 目录**下：

- `editor/ui/uidoc.json`（主 UI 文档，包含 screens/nodes）
- （可选）`editor/ui/history.json`（不建议：history 通常不持久化；更建议仅内存）
- （可选）`editor/ui/thumbnails/<screenId>.png`（后做：screen 缩略图）

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

目标：将 `UIDocument` 的 `UIScreen.rootNodeId` 渲染为 **React DOM 组件树**，并且这棵树尽可能与 NarraLeaf React 运行时一致。

#### 4.4.1 映射策略：Editor/Runtime 共享渲染，但隔离“编辑包装”

- 运行时（NarraLeaf React）：直接渲染节点对应的业务组件
- 编辑器：渲染同一套业务组件，但每个节点外包一层 `EditorNodeWrapper`

`EditorNodeWrapper` 的职责（【待实现】）：

- 为 DOM 节点提供稳定标识：`data-ui-node-id="<id>"`
- 管理 pointer events：阻止运行时交互触发（例如 click 不应直接执行剧情）
- 提供测量与命中所需的 ref：供交互层获取 `getBoundingClientRect()`
- 提供可视化辅助：hover 高亮、选中描边（可由 overlay 层统一画）

#### 4.4.2 CSS/主题隔离：强建议 iframe

原因：Studio 本身有 Tailwind 与全局样式，容易污染“画布内 UI”的运行时样式。

建议：

- 编辑器 tab 中嵌入 `iframe` 作为“画布渲染环境”
- 在 iframe 内加载与运行时一致的 CSS/主题资源
- overlay（选框、控制点、对齐线）仍放在 iframe 外层或同层，但需要做坐标映射（见交互层）

【待实现】如果暂不做 iframe，可先用一个 root container + CSS reset，但未来大概率会回到隔离方案。

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

- **Screen Logical Space**：UI 文档中 `layout.x/y/width/height` 所在坐标系（建议 = 设计分辨率像素）
- **Viewport Space**：编辑器画布缩放/平移后，对应到屏幕上的坐标
- **DOM Client Space**：`getBoundingClientRect()` 返回的浏览器坐标

必须实现以下可复用的转换函数（【待实现】）：

- `screenToViewport(point|rect)`
- `viewportToScreen(point)`
- `clientToViewport(point)`
- `clientToScreen(point)`（常用：鼠标事件 -> 文档坐标）

> 注意：如果采用 iframe，client space 还会分为 parent 与 iframe 的坐标，需要额外做 iframe 偏移换算。

#### 4.5.3 选择模型（Selection Model）

现有 `UIStore` 已有 `selection: { type: "asset" | "node" | "scene" | "character" | null; data: any }`。

建议 UI Editor 直接复用 `type: "node"`，并定义 `data` 的结构（【待实现】）：

```ts
// Proposed selection payload for UI nodes.
export type UINodeSelection = {
  editor: "ui";
  screenId: string;
  nodeIds: string[]; // multi-select
  // Optional: primary node for inspector focus
  primaryId?: string;
};
```

使得：

- Layers 面板与画布点击都能更新同一 selection
- Properties 面板只订阅 selection，便能展示 node 属性

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

#### 4.6.1 Editor Tab：UI Screen Editor

一个 Screen 对应一个 editor tab（或 tab payload 指向当前 screenId）：

- tab id：建议稳定，例如 `ui-editor:screen:<screenId>`
- tab title：screen name
- tab payload：至少包含 `screenId`
- modified：由 `UIDocumentService` 提供脏状态（未保存变更）

在现有体系中，这些将通过 `EditorTabDefinition<TPayload>` 注册并打开（见 `EditorService` 与 Registry 的 `openEditorTab`）。

#### 4.6.2 Layers Panel（层级树）

功能（MVP）：

- 显示当前 screen 的 node 树（root -> children）
- 单选/多选（Shift/Ctrl）
- 拖拽调整层级与顺序（建议 `dnd-kit`）
- 显示可见性（eye）、锁定（lock）【可扩展】

数据来源：

- node 树：来自 `UIDocumentService` 当前文档
- 选中状态：来自 `UIStore.selection`（type=node）

#### 4.6.3 Inspector Panel（属性面板）

必须遵循“不要臆造字段”的原则：Inspector 面板的字段由 NodeTypeRegistry 定义。

核心机制（【待实现】）：

- 订阅 `UIStore.selectionChanged`
- 若 `editor !== "ui"` 或无 nodeIds，则显示空态
- 若单选：读取 `UINode` 并渲染该 type 对应的 `inspector schema`
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
  - 选择后将 asset 引用写入 node.props 或 node.style（由 NodeTypeRegistry 定义字段）
- 监听资产删除事件：
  - `AssetsService.getEvents().on("deleted", ...)`
  - 当引用资源被删除时：
    - 对应 node 标记“引用缺失”（UI 上警告）
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

## 6. Screen 级别体系（“按屏幕分界面”的核心）

### 6.1 Screen 与项目分辨率的关系

本仓库 `ProjectConfig` 的 `metadata` 中包含 `resolution?: {width,height}`（Partial），并且已有 `BaseProjectService.parseResolution`。

建议策略（MVP）：

- 新建 Screen 默认采用：
  - 若项目配置里有 resolution：用它作为 `designSize`
  - 否则给一个默认（【由你填】）
- Screen 的 `designSize` 是“文档坐标系基准”，不随编辑器窗口变化

### 6.2 多 Screen 管理的 UI 形态（建议）

不臆造具体 UI，但从现有 IDE 布局出发，推荐两种落地方式：

- 方式 1：左侧新增一个 Panel（例如 “Screens”），列表管理 screens（新建/重命名/复制/删除）
- 方式 2：在 UI Editor 的 tab 内提供顶部下拉/侧边栏切换（但这不符合 IDE 风格）

更贴合现有体系的是方式 1：通过 `UIStore.registerPanel({ position: Left|Right, ... })` 集成。

---

## 7. 与现有 Studio 系统的集成点清单（不写到文件级，但写到抽象级）

### 7.1 与 UIService / UIStore / Registry 的集成

你将使用以下现有能力（已存在）：

- `UIStore.registerPanel`：注册 Layers/Inspector/Screens 等面板
- `UIStore.registerAction` / `registerActionGroup`：注册 UI Editor 的操作（对齐、复制、删除、保存等）
- `UIService.keybindings.registerMany`：为 UI Editor 注册快捷键（并可用 `when` 控制生效场景）
- `UIStore.selection`：复用 `type: "node"`，让 Properties 面板可直接按 selection 驱动
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
- 最近打开的 screenId

保存方式：复用 `ProjectSettingsService.setBatch` 的 debounce 模式（参考 `WorkspaceLayout`）。

---

## 8. MVP 里程碑拆解（保证可落地、不虚构）

> 这里不是产品承诺，只是工程落地拆分；每一项都能在现有架构里实现并逐步上线。

### 8.1 MVP-0：文档与 UI 入口（最小通路）

- 【待实现】定义 `UIDocument` 最小 schema（screen + node）
- 【待实现】`UIDocumentService`：能创建空文档、保存/加载 JSON
- 【待实现】注册一个 UI Editor editor tab（能打开、显示当前 screen）
- 【待实现】在 tab 中渲染 root -> children 的 DOM（可先用最简单 div 占位）

验收点：

- 新建 UI 文档 → 保存到 `editor/ui/...` → 重启 Studio → 能加载回来

### 8.2 MVP-1：选中与属性编辑（以层级/属性为核心）

- 【待实现】Layers panel：显示树 + 点击选中（写入 `UIStore.selection`）
- 【待实现】Inspector panel：显示通用 layout 字段，并能修改（走 command）
- 【待实现】画布点击命中：点击节点也能选中（通过 `data-ui-node-id` + hit test）

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
- 【待实现】行为系统最小实现：允许绑定一个 `noop` 或“占位动作”，并能序列化保存

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
- 与 Screen resize 的策略：`__________`

---

## 10. 风险与工程注意事项（贴合现状）

- **样式污染风险**：Studio 使用 Tailwind + 全局样式；若不做 iframe/隔离，画布内 UI 样式很可能偏离运行时。
- **性能风险**：大量节点时，频繁 `getBoundingClientRect()` 与 React re-render 可能成为瓶颈；需在交互层做节流/缓存。
- **序列化风险**：不要在文档中存函数/闭包；行为必须结构化数据。
- **兼容性风险**：UIStore.selection.data 当前为 `any`，容易被不同编辑器模块写入冲突；建议统一添加 `editor: "ui"` discriminator。

