# Studio UI Editor & Blueprint System — Master Functional Specification

**Location:** `project/docs/implementation-plans/studio-ui-blueprint-master-spec.md`  
**Audience:** 工程实施、验收、Agent 规划；**不替代** `blueprint-system.md` / `visual-editor.md` 的完整架构叙述，而是把**功能预期与验收粒度**收敛到一份可对照的清单。  
**Canonical architecture:** `project/docs/blueprint-system.md`, `project/docs/blueprint-system-architecture.md`, `project/docs/visual-editor.md`, `project/docs/visual-editor-implementation-guide.md`  
**Milestone splits:** `project/docs/blueprint-system-milestones.md`, `project/docs/visual-editor-milestones.md`  
**Interleaved prompts:** `project/docs/agent-milestone-prompts.md`

---

## 0. How to use this document

- **“必须 / 应 / 可”**：与里程碑语言对齐——“必须”为硬验收，“应”为强推荐，“可”为可选增强。
- **Editor vs Runtime**：Workspace 内 **静态布局预览 + 结构编辑**；**真实执行、副作用、深度调试**以 **Dev Mode** 为主场（见 §2）。
- **与实现对齐**：文中 **代码锚点** 为便于检索的指针；若与代码冲突，以 **schema、类型定义与磁盘格式** 为准，并应回写修正本文件或里程碑文档。
- **P1–P7**：交错阶段见 `agent-milestone-prompts.md`；本文件按 **Visual Editor M1–M6** 与 **Blueprint M1–M5** 维度展开，并在 §4 给出与 P 阶段的映射。

---

## 1. Global invariants（全局不变量）

| ID | 规则 |
|----|------|
| G1 | **通用 UI Editor** 为界面编辑主线；不建立独立“VN 领域主模型”。 |
| G2 | **编辑器内预览** 仅为 **静态 / 布局向**；不把 Workspace 做成第二 Dev Mode。 |
| G3 | **第一阶段复用** 依赖 **Surface Link + 复制粘贴**；**不引入模板 / preset 系统**（除非产品另行立项）。 |
| G4 | **Visual Blueprint** 与 **TypeScript Blueprint** 共用同一套 **Runtime Contract、Host API 分层、Debug 协议**；禁止两条互不兼容的宿主语义。 |
| G5 | **绑定系统保持纯**：绑定与声明为纯计算；**副作用仅出现在事件执行图**（或 TS 模块内显式注册的事件路径）。 |
| G6 | **实例主蓝图**（`globalMain` / `surfaceMain` / `widgetMain`）与 **共享蓝图资产** 分层；共享资产不承担实例私有生命周期。 |
| G7 | 蓝图事件与图体 **以 `BlueprintDocument` / `uigraphs.json` 为真相**；旧版仅顶层 `graphs` 的路径为兼容区，**产品方向以 Blueprint 内事件图为准**（见 `blueprint-system-milestones.md` M2）。 |
| G8 | **Dev Mode** 为真实运行与调试主入口；Workspace 提供跳转、静态诊断、结构编辑。 |

---

## 2. Glossary（术语）

| Term | Meaning |
|------|---------|
| **UIDocument / uidoc** | 界面文档（元素树、布局、字面量属性等）。 |
| **UIGraphDocument / uigraphs** | 磁盘上的图与蓝图容器；含 **Blueprint 文档**（`blueprintDocument`）等。 |
| **BlueprintDocument** | 本地实例蓝图集合、owner 索引或 owner 记录、各 `Blueprint` 实体与绑定等。 |
| **Owner** | `globalMain` / `surfaceMain` / `widgetMain` / `sharedAsset` 等，用于定位“谁的主蓝图”。 |
| **widgetMain** | 某 Surface 上某控件实例绑定的逻辑主蓝图。 |
| **Visual Blueprint** | `frontend: "visual"`，`programKind: "graph"`，图为 `BlueprintGraphIr`。 |
| **TypeScript Blueprint** | `frontend: "typescript"`，`programKind: "scriptModule"`，源码 + 编译产物链路。 |
| **M3-min** | 缩小范围运行时：例如仅 **surface** 状态、`surfaceState` 声明源、最小节点集；用于先跑通闭环。 |
| **M3-full** | 在 M3-min 上扩展：**更多节点族、作用域、Host API、调试与错误语义** 等（里程碑中有列举，允许分阶段填满）。 |
| **M4-lite** | 仅 **入口 + 只读摘要 + 轻量 Tab**；**无**完整属性绑定编辑与 React Flow 画布。 |
| **M4-full** | 属性面板 **Literal / Bound / Broken**、声明与绑定编辑、**独立蓝图 Tab** 内 **Visual** 图编辑与校验等。 |

---

## 3. Interleaved phases (P1–P7) — feature mapping

与 `agent-milestone-prompts.md` **推荐顺序**一致：

| Phase | Bundled milestones (high level) | Primary intent |
|-------|----------------------------------|----------------|
| **P1** | VE **M2-A** + BP **M2** | 核心 widget 四件套 + 本地实例蓝图、owner、`blueprintEvent`、绑定持久化、只读摘要。 |
| **P2** | BP **M3-min** + VE **M4-lite** | 最小闭环：点击 → 事件图 → 状态 → 绑定求值 → UI；Dev Mode 调试事件；Workspace 真入口（轻量）。 |
| **P3** | VE **M2-B** + VE **M3** | Stack / Scroll / SpacerDivider / ListRepeater；官方组合范式与示例 Surface。 |
| **P4** | BP **M4** + VE **M4-full** | 独立蓝图编辑 Tab、React Flow 画布、成员树、检查器、图校验；属性面板完整绑定与跳转。 |
| **P5** | VE **M5** + BP **M3-full** | 编辑器静态创作反馈（资源、link、stage、布局、交互等）；运行时节点与 Host API、调试补全。 |
| **P6** | BP **M5** + VE **M6** | TS 蓝图、编译装载链、共享蓝图资产、DevTools 强化；编辑器生产级收口与复用体验。 |
| **P7** | *(meta)* | 文档 / 验收缺口收口：补追溯计划、对齐里程碑与代码、对照矩阵与剩余小项（见 `agent-milestone-prompts.md` P7）。 |

---

## 4. Visual Editor — M1–M6（功能预期明细）

### 4.1 M1 — Direction freeze & baseline

**目标：** 产品定位、非目标、M2 八件套边界、预览策略冻结。

**必须：**

- 锁定第一批 **8 个**基础 widget 类型（Text、Image、Button、Container/Frame、Stack、Scroll、Spacer/Divider、Option List/Repeater 最小形态）。
- 左栏 Surface、画布 Tab、属性面板文案 **不误导**：区分 **编辑器静态预览** vs **Dev Mode 运行时**。
- Blueprint 相关：**不在 M1 假装可点**；可为明确“延期说明”，**M4-lite 起升级为真实入口**。

**验收（摘要）：** `visual-editor.md` §0、`visual-editor-implementation-guide.md` §2.1、本文 §4.1 一致；团队能区分编辑器工作与运行时工作。

**锚点：** `visual-editor.md`，`visual-editor-implementation-guide.md`，`UISurfacesPanel.tsx`，`UISurfaceEditorTab.tsx`，`PropertiesPanel.tsx`。

---

### 4.2 M2 — Generic widgets

#### 4.2.1 M2-A（与 BP M2 同期）

**必须交付的 widget 类型（内置模块 id）：**

| Widget | 典型 id | 预期能力（最小） |
|--------|---------|------------------|
| Text | `nl.text` | 文本内容、基础样式入口；可插入/选中/复制/删除；inspector 完整。 |
| Image | `nl.image` | 图片填充 / 资源引用；inspector 与资源选择。 |
| Button | `nl.button` | 容器式按钮；可挂 UI 行为与蓝图事件入口（数据层）。 |
| Container | `nl.container` | 容器/框架；子级布局与 inspector。 |

**原则：** 每 widget **createDefaultElement、runtime render、inspector schema** 齐全；在 `BuiltinWidgetModules` 注册；与 `UIDocumentService` 创建路径一致。

**Blueprint：** 支持逻辑的 widget 应能挂 **`widgetMain`** 生命周期数据（由 BP M2 保证服务层）。

#### 4.2.2 M2-B

| Widget | 典型 id | 预期能力（最小） |
|--------|---------|------------------|
| Stack | `nl.stack` | 自动布局/流式子项规则（与文档 §4.2 一致）。 |
| Scroll | `nl.scroll` | 可滚动容器。 |
| Spacer/Divider | `nl.spacerDivider` | mode 切换（分割/留白等，以实现为准）。 |
| List / Repeater | `nl.listRepeater` | 最小列表/重复子项；**选择肢界面用组合范式**，不强制独立 OptionList 控件。 |

**验收：** 用户无需依赖“纯 rectangle 拼一切”即可搭建常见菜单、对话框、按钮列、带图背景界面。

**锚点：** `widget-modules/builtin/index.ts`，各 `builtin/*/inspector.tsx`，`UIDocumentService.ts`，`UISurfaceEditorTab.tsx`（Insert 列表）。

---

### 4.3 M3 — Surface reuse & composition patterns

**目标：** **不引入模板系统** 的前提下，用 **官方范例 + 约定** 提高 VN UI 搭建一致性。

**推荐交付（范例与结构）：**

- Dialog、Choice Menu、Notification/Toast、Settings、Save/Load、Overlay/Pause Menu 等 **参考结构**。
- **App Surface link**（Stage → App）复用约定。

**示例资产：** `project/examples/visual-editor/*/editor/ui/uidoc.json`；说明表见 `visual-editor.md` §4.4。

**验收：** 高频界面可按范式搭建；团队能形成 Surface 命名与组织习惯。

---

### 4.4 M4 — Blueprint entry & in-editor visibility

#### 4.4.1 M4-lite（P2）

**必须：**

- 属性面板或等价位置：**真实入口**（非虚假加号）；能看到 **是否挂了逻辑**（只读摘要级）。
- 能 **从当前 Surface/元素上下文** 打开 **轻量 Tab**（非完整图编辑器）。
- 与 **M3-min** 分工：执行闭环在 **Dev Mode**。

#### 4.4.2 M4-full（P4）

**必须（对齐 `blueprint-system-milestones.md` M4 §8）：**

- **属性面板：** 实例主蓝图概览；“打开蓝图编辑器”；属性行 **Literal / Bound / Broken**（及可选 Overridden）；绑定来源展示；**搜索/选择声明**、**就地创建声明**、**跳转到声明**、**解除绑定**（实现上允许分迭代，但产品目标如此）。
- **独立蓝图 Tab：** 左侧 **成员树**（事件、函数、变量、声明、共享引用等以产品为准）；中间 **React Flow** 仅画布交互；右侧 **节点/图检查器**；底部 **诊断列表**。
- **校验：** pin、入口、缺失声明、图合法性等 **在编辑器内可见**。
- **跳转：** Surface/控件/绑定/错误 → 对应蓝图或节点（目标完整性随里程碑验收）。

**边界：** React Flow **不负责**业务语义；语义由 **节点注册 + 校验层 + 执行层** 负责。

**锚点：** `blueprint-lite/*`，`ReadonlyBlueprintSection.tsx`，`BindablePropertyField.tsx`，`BlueprintEntryTab.tsx`，`BlueprintFlowCanvas.tsx`。

---

### 4.5 M5 — Validation & static creative feedback

**目标：** 编辑器从“能画”到“能发现问题”。

**推荐交付（逐项应对照实现或标注缺口）：**

- **缺失资源**（图片等引用无效）。
- **link** 异常（Surface/Stage/App 链接）。
- **Surface / Stage** 配置异常。
- **越界、可见性** 问题提示。
- **交互热点与尺寸** 检查。
- **面向 Dev Mode** 的清晰预览/跳转入口（不替代 Dev Mode 执行）。

**原则：** 静态规则在 **Workspace**；真实交互与运行时错误在 **Dev Mode**。

**锚点（示例）：** `lib/ui-editor/diagnostics/*`，`UISurfaceEditorTab.tsx` 内静态提示。

---

### 4.6 M6 — Production polish & team reuse

**目标：** 生产可用、团队可复用。

**推荐交付：**

- 稳定的 **官方范式 + 示例**（与 M3 协同，持续更新）。
- **插入 / 搜索 / 复制复用** 入口顺手。
- **属性面板** 体验一致（字段布局、绑定行、错误态）。
- **错误与空状态** 文案明确、可行动。
- **最佳实践** 写入 `visual-editor.md` / 实现指南等（非代码）。

**验收：** 团队可将其视为 **生产工具**；扩展 widget/范式/蓝图入口路径清晰。

---

## 5. Blueprint System — M1–M5（功能预期明细）

### 5.1 M1 — Semantics, types, protocols

**目标：** 根语义冻结，后续不推翻 owner、binding、frontend、`programKind`。

**必须覆盖的类型与协议（见里程碑 §5.4）：**  
`BlueprintOwnerRef`、`BlueprintDocument`、`Blueprint`、`BlueprintMemberIndex`、声明/变量/函数、`BlueprintGraphIndex`、`BindingDefinition`、`BindingTargetRef`、`BindingSourceRef`、诊断、**Debug Event**、**Host API 契约** 等。

**Host API（M1 协议层）：** 至少六大族：**navigation / widget / state / persistence / media / devtools**，并标注 **pure vs effectful**（能力表以 `BLUEPRINT_HOST_API_M1_CAPABILITIES` 等为参考）。

**调试协议（事件类型）：** 至少包含 `execution.started` / `finished` / `error`、`node.enter` / `node.exit`、`state.read` / `state.write`、`binding.evaluated` 等（完整列表见 `blueprint-system-milestones.md` §5.6）。

**验收：** 类型层能表达目标系统；新节点/编辑器/调试 UI 能挂到同一协议。

**锚点：** `src/shared/types/blueprint/*`，`document.ts`，`hostApi.ts`，`debug.ts`。

---

### 5.2 M2 — Local instance storage & lifecycle

**目标：** **uigraphs.json**（或等价）承载 **本地实例蓝图**；**owner 索引/记录**；创建/删除/复制时的 **蓝图生命周期**；**绑定持久化**。

**必须：**

- **自动生成** `globalMain` / `surfaceMain` / 按需 `widgetMain`；删除实例时清理；复制时 **新 blueprint id + 新 owner**；重命名 **不改变 blueprint id**。
- **事件绑定：** `UIBehaviorBinding` 中 `blueprintEvent: { blueprintId, eventId }`；图体在 `Blueprint.program.graphs.events[eventId].graph`。
- **绑定：** `bindings` 中保存；`UIElement.props` 存字面量；解除绑定可回退 **fallback**。
- **失效：** 删除声明 → 绑定 **broken**；UI **明示**，不静默回退。

**旧版 uigraphs：** 产品策略 **strict fail**（见里程碑）；不自动静默迁移。

**验收：** owner 可稳定解析；实例生命周期不破坏索引；绑定可持久化与失效可见。

**锚点：** `LocalBlueprintService.ts`，`UIGraphService`，`UIBehaviorBinding` 类型，`blueprintCopyRemap.ts`（复制 remap 数据层）。

---

### 5.3 M3 — Runtime closure & Dev Mode

#### 5.3.1 完整 M3（文档目标）

**必须包含的组件（概念）：**  
`BlueprintRegistry`、`BlueprintDispatcher`、执行器（图/脚本）、`BindingEvaluator`、`ScopeStoreBridge`、`HostApiBridge`、`DebugBridge`。

**作用域：** execution locals / surface / global UI / persistence（可分阶段实现）。

**派发链：** UI 事件 → 找主蓝图 → `eventId` → 事件图入口 → 执行 → Host API 副作用 → Debug 事件。

**节点：** 控制流、状态读写、函数、共享蓝图调用等（里程碑 §7.7 列举方向）。

**Dev Mode bundle：** 含 `uidoc`、本地 `BlueprintDocument`、共享蓝图引用等（形状见 `devMode.ts` / 里程碑）。

#### 5.3.2 M3-min（P2，已定义的缩小范围）

**必须（闭环）：**

- 例如 **`blueprint.state.set`** 写入 **surface** 状态。
- **声明** `valueSource`：**仅 `surfaceState`**（该阶段）。
- **BindingEvaluator** 将有效值合并到渲染用属性。
- **调试事件：** 至少里程碑 P2 实施记录中列出的几类在 **Dev Mode 面板**可见。

**明确非目标（该阶段）：** 完整 React Flow 编辑器、属性面板绑定编辑、全 Host API、**可选** `node.enter`/`node.exit`（留给 M3-full）。

**锚点：** `BlueprintDispatcher.ts`，`blueprintM3MinNodes.ts`，`devModeBlueprintHostAdapter.ts`，`useDevModeBlueprintRuntime.ts`。

#### 5.3.3 M3-full（P5 或与 P5 交错）

在 M3-min 上扩展：

- **更多节点类型**（状态读写 scoped、导航、媒体等——以注册表与里程碑为准）。
- **GraphExecutor** 级 **node.enter / node.exit** 与结构化 **execution.error**。
- **Host API** 真桥接范围扩大（仍受 Dev Mode 能力约束）。
- **ScopeStoreBridge** 多作用域（逐步实现）。

**锚点：** `blueprintM3FullNodes.ts`，`GraphExecutor.ts`，`BlueprintHostApiBridge.ts`，`ScopeStoreBridge.ts`。

---

### 5.4 M4 — Studio integration & Visual Blueprint editor

见 **§4.4.2** 与 `blueprint-system-milestones.md` §8 全文（属性面板、Tab 布局、React Flow 边界、节点 UI 元信息、校验、跳转）。

**图能力边界：** 优先事件图/函数图/变量/声明读/函数调用/基础控制流；**不急着** 宏、复杂折叠、自动布局、极致大图性能。

---

### 5.5 M5 — TypeScript Blueprint, shared assets, DevTools

**必须（方向）：**

- **TS 编辑器**（Monaco）、模板、类型提示、诊断、与成员树/编译准备联动。
- **受限语义：** 仅允许 **虚拟模块 + 白名单 API**（如 `narraleaf-studio` shim）；禁止任意 import、Studio 内部对象。
- **编译与装载：** 源码 → 校验 → 打包为可注册模块 → 运行时执行 **编译产物**；诊断可回指源码。
- **共享蓝图资产：** `blueprint` 资产类型；可创建、搜索、分类、在实例蓝图中**调用**；绑定系统可引用共享声明（按里程碑）。
- **DevTools 增强：** 节点高亮、错误详情、状态/绑定记录等（分阶段填满）。

**明确非目标：** Visual ↔ TS **互转**、断点单步、时光回溯、任意动态 UI 树、共享继承、外联网络编排等（见里程碑 §11）。

**仓库衔接说明（摘自里程碑，实施时以代码为准）：**  
本地 `BlueprintDocument` 可能演进至 **schema v3**（`ownerRecords`、多私有修订 + `active`）；TS 可能在 **Dev Mode 主进程路径** 经 **esbuild** 编译并装入 bundle；`BlueprintBuildService` / 磁盘 `editor/generated/blueprints/` 可能分阶段落地。以 `p6-bp-m5-ve-m6-plan.md` 与当前 `LocalBlueprintService` / `compileProjectBlueprintScripts.ts` 为准。

---

## 6. Data & persistence（摘要）

| Artifact | Role |
|----------|------|
| **uidoc.json** | UI 元素树与字面量属性。 |
| **uigraphs.json** | **BlueprintDocument** 必填（schema 以类型与迁移为准）；顶层旧 `graphs` 为兼容。 |
| **Blueprint asset** | 共享蓝图 JSON（`SharedBlueprintAsset`），进资产系统。 |
| **DevModeBundle** | Dev Mode 装载：uidoc + local blueprints + shared blueprint 列表等。 |

**Owner 定位：** 由 `ownerIndex` 或演进后的 **ownerRecords** 表达；运行时解析 **active** 私有蓝图 id（若启用多修订模型）。

---

## 7. Runtime pipeline（逻辑顺序）

1. 用户操作触发 UI 行为（如 click）。
2. 若绑定为 `blueprintEvent`，**Dispatcher** 根据 `blueprintId` + `eventId` 解析 **Visual 图** 或 **TS 模块**。
3. **Visual：** `GraphExecutor` 执行 IR，调用节点注册表；**TS：** 执行已装载模块中注册的 handler。
4. 副作用通过 **Host API**（state / navigation / …）落地。
5. **BindingEvaluator** 根据声明与绑定求值，合并到下一帧渲染属性（策略以实现为准）。
6. **DebugBridge** 持续发出调试事件；Dev Mode UI 订阅。

---

## 8. Debug protocol（调试事件 — 预期集）

最小集应覆盖（名称以 `src/shared/types/blueprint/debug.ts` 为准）：

- 执行生命周期：`execution.started` / `execution.finished` / `execution.error`
- 图追踪：`node.enter` / `node.exit`（M3-full 起）
- 状态：`state.read` / `state.write`（可带 scope）
- 绑定：`binding.evaluated`

Dev Mode 面板为 **主阅读界面**；Workspace 是否镜像由产品决定，**不替代** Dev Mode。

---

## 9. Static diagnostics vs Dev Mode（职责边界）

| Concern | Workspace / Editor | Dev Mode |
|---------|-------------------|--------|
| 布局、资源引用、link、stage 配置 | 静态规则 + 轻提示 | 可选补充 |
| 图编辑期校验 | 是 | - |
| 真实执行、运行时 Host API、完整错误栈 | 否（仅跳转/说明） | 是 |
| 节点级执行轨迹 | 可选弱展示 | 是 |

---

## 10. Non-goals & deferred（汇总）

- 可视化与 TS 蓝图 **互转**。
- Workspace 内 **完整模拟运行时**。
- **模板/组件系统**（M1–M6 默认不做）。
- **断点/单步/协作编辑**（默认延后）。
- **任意**动态 UI 树创建、共享蓝图 **继承**、外联服务编排（见里程碑 §11）。

---

## 11. Verification matrix（验收用对照表）

使用时：为每一行标记 **Done / Partial / Not done**，并附 **commit 或 PR** 与 **备注**。

**P7 快照（2026-04-05）**：详细句级矩阵与证据路径见 `p7-doc-gap-closure-plan.md` 附录 A；下表仅作主规格索引，**不替代** P7 矩阵。

| ID | P7 摘要状态 |
|----|-------------|
| VE-M3-01-B（示例 schema 语义） | Partial → 以 `visual-editor.md` §4.4 迁移说明 + `p3` 计划为真相 |
| VE-M4-02 | Partial → 绑定 UI 与图编辑已大部分落地；画布 `blueprintRuntime` 非 P7 必做 |
| VE-M5-01 | Partial → 多类 done，`stage`/可见性子集 partial |
| VE-M6-01 | Partial → 见 `p6` Remaining risks |
| BP-M3-02 | Partial |
| BP-M4-01 | Partial（与 VE-M4-full 交叉） |
| BP-M5-01 | Partial |

### 11.1 Visual Editor

| ID | Criterion |
|----|-----------|
| VE-M1-01 | M1 八件套范围与预览策略在三份文档一致。 |
| VE-M2-01 | M2-A 四件套可插入、编辑、持久化。 |
| VE-M2-02 | M2-B 四件套可用；ListRepeater 支持范式化选择肢界面。 |
| VE-M3-01 | 官方示例目录与 `visual-editor.md` 说明一致。 |
| VE-M4-01 | M4-lite：真入口 + 只读逻辑状态 + 跳转轻量 Tab。 |
| VE-M4-02 | M4-full：Literal/Bound/Broken + 绑定/解绑 + 打开蓝图 Tab + 图编辑。 |
| VE-M5-01 | 静态诊断覆盖里程碑 §8.2 所列类别（按实现逐项勾）。 |
| VE-M6-01 | 插入/搜索/复制与属性面板体验达到“生产收口”定义（产品确认）。 |

### 11.2 Blueprint System

| ID | Criterion |
|----|-----------|
| BP-M1-01 | 共享类型与 Host API / Debug 协议可扩展。 |
| BP-M2-01 | 实例蓝图生命周期与绑定持久化、broken 语义正确。 |
| BP-M3-01 | Dev Mode 可跑通点击 → 状态 → 绑定 → UI（M3-min 至少）。 |
| BP-M3-02 | M3-full：扩展节点与 Host API、node 追踪等与里程碑一致（分阶段）。 |
| BP-M4-01 | Studio 内可编辑 Visual 图并保存；校验可见。 |
| BP-M5-01 | TS 蓝图可编辑、编译、装载执行；共享资产可管理并参与运行时解析。 |

---

## 12. Implementation plans & docs index

| File | Role |
|------|------|
| `implementation-plans/p1-ve-m2a-bp-m2-plan.md` | P1 实施记录与范围。 |
| `implementation-plans/p2-bp-m3min-ve-m4lite-plan.md` | P2 闭环与文件索引。 |
| `implementation-plans/p3-ve-m2b-ve-m3-plan.md` | P3 追溯：M2-B + M3 示例与锚点。 |
| `implementation-plans/p4-bp-m4-ve-m4full-plan.md` | P4 混合：M4-full 已做 / partial / 边界。 |
| `implementation-plans/p5-ve-m5-bp-m3full-plan.md` | P5 混合：静态诊断 + M3-full 状态。 |
| `implementation-plans/p6-bp-m5-ve-m6-plan.md` | P6 深度方案、实施记录与残余风险。 |
| `implementation-plans/p7-doc-gap-closure-plan.md` | P7 文档、矩阵与收口实施记录。 |
| `agent-milestone-prompts.md` | P1–P7 Prompt 模板与顺序。 |

---

## 13. Key code anchors（参考索引，非 exhaustive）

| Area | Paths |
|------|-------|
| Builtin widgets | `src/renderer/lib/ui-editor/widget-modules/builtin/` |
| Blueprint types | `src/shared/types/blueprint/` |
| Local blueprint service | `src/renderer/lib/workspace/services/ui-editor/LocalBlueprintService.ts` |
| Runtime dispatch | `src/renderer/lib/ui-editor/blueprint-runtime/BlueprintDispatcher.ts` |
| Graph execution | `src/renderer/lib/ui-editor/behavior-graph/GraphExecutor.ts` |
| Min / full nodes | `blueprintM3MinNodes.ts`, `blueprintM3FullNodes.ts` |
| Dev Mode | `src/renderer/apps/dev-mode/` |
| Blueprint editor UI | `src/renderer/apps/workspace/modules/blueprint-lite/` |
| Properties + binding | `src/renderer/apps/workspace/modules/properties/blueprint/` |
| TS compile (main) | `src/main/app/application/managers/devMode/compiler/blueprint/compileProjectBlueprintScripts.ts` |
| Static diagnostics | `src/renderer/lib/ui-editor/diagnostics/` |

---

## 14. Revision policy

- **架构级变更** 必须先改 `blueprint-system.md` / `visual-editor.md` 再同步本文件。
- **里程碑状态**（例如 M4-full 是否“完成”）以 **本仓库验收表 + 里程碑 §验收** 为准；本文件 **不自动**随单次 commit 更新——在阶段收尾时人工或 P7 批量修订。
- **P7（2026-04-05）** 已对本文件 §11 增加矩阵索引快照、§12 补全 `p3`–`p5` 计划链；后续 partial 项关闭时应同时更新 §11 快照行与 `p7-doc-gap-closure-plan.md` 附录。

---

*End of master specification.*
