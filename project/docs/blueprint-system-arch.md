# NarraLeaf Studio — Blueprint System（架构与里程碑合并稿）

本文档合并自原 `blueprint-system.md`、`blueprint-system-milestones.md`，以及 `project/docs/implementation-plans/` 内与蓝图相关的实施记录与主规格摘要。界面编辑器侧里程碑与选项见 **`project/docs/visual-editor-arch.md`**；快速代码结构见 **`project/docs/visual-editor.md`**；**内置节点与事件头清单**见 **`project/docs/blueprint-nodes.md`**。

**最高原则：** 编辑方式可以有两种（Visual / TypeScript），**上层运行时契约只能有一种**。

---

## 1. 结论与产品方向

- **范围：** 蓝图系统第一阶段聚焦 **UI**，不把剧情/任务/全项目逻辑一并卷入。
- **两种前端（创建时选定，互不转换）：** `Visual Blueprint`（图 / Graph IR）与 `TypeScript Blueprint`（受限真实 TS → 编译模块）。二者共享：**Runtime Contract、Host API、调试协议、作用域与状态模型**；底层执行载体可不同（图 vs 脚本模块）。
- **语义拆分：** **事件执行图**允许副作用；**绑定/字段求值**必须纯计算（可读状态、纯函数；不可写状态、导航、音频等）。
- **实例主蓝图：** `globalMain` / `surfaceMain` / `widgetMain`，与实例生命周期绑定、不可共享。**共享蓝图**进资产系统。
- **编辑器形态：** 属性面板负责入口、概览、绑定、快速创建；完整编辑在独立 Tab。技术栈推荐：**React Flow**（画布壳）+ **自研 Graph IR** + **Monaco**（TS 蓝图）+ **自研 Runtime / 节点注册 / TS 编译与游戏内装载链**。
- **Dev Mode：** 真实运行与调试的主场；编辑器内完整运行时模拟不是默认目标。

### 1.1 本期目标与明确非目标

**本期目标包括：** 控件交互、导航与层、页面/全局 UI 状态、数据绑定与声明、持久化、音频动画通知、列表模板/条件渲染边界内的动态 UI、可观测调试。

**非目标（第一阶段）：** 蓝图扩展为全项目唯一脚本语言；Visual ↔ TS 互转；TS 任意访问 Studio 内部；任意运行时 UI 树创建；外部服务/通用网络；复杂协作编辑。

**动态 UI 边界：** 支持模板化列表、条件块、有限模板实例化；不支持“任意运行时创建任意 widget tree”。

---

## 2. 当前仓库基线（演进起点）

**已有：** `uidoc.json`、`uigraphs.json`、`UIElement.behavior`、`UIBehaviorBinding`（`blueprintEvent`：`blueprintId` + `eventId`）、`UIGraphService`、`GraphExecutor`、`BehaviorNodeRegistry`、`UIHostAdapter`、`DevModeBundle`、属性面板 Blueprint 区块。

**曾存在的缺口方向（随里程碑逐步补齐）：** 事件→执行器全链、绑定/声明/变量/调试协议成型、Dev Mode 消费图逻辑等。实现进度以本文 **§10 仓库状态注记** 与 **§12 实施记录** 为准。

**演进策略：** 保留 UI 文档体系；将 `uigraphs.json` 升级为本地实例蓝图文档；行为图演进到 Blueprint Runtime；坚持 `hostAdapter` 边界；在 Dev Mode 补全真实运行与调试。

---

## 3. 为何不做 Visual / TypeScript 双向切换

互转会迫使系统解决“任意 TS 如何还原为图”等不可判定产品问题。创建时选定前端 + **统一宿主与调试契约**，可避免能力树分裂；用户心智上仍是**同一套逻辑平台**，仅语法表面不同。

---

## 4. 核心概念

| 概念 | 说明 |
|------|------|
| 实例主蓝图 | 每逻辑实例自动拥有；容纳事件入口、局部变量、实例耦合逻辑、**字段**（绑定源） |
| 共享蓝图资产 | 可复用函数/流程；进资产管理器 |
| 事件图 | 执行型：响应事件、调共享蓝图、写状态、导航、媒体、持久化 |
| 字段（Field） | 在成员面板定义，作为 **widgetProp 绑定** 的数据源；**不由图节点初始化**；可与 surface/global 状态键等关联 |
| 绑定 | 字面量 **或** 引用字段（symbol-first：展示按名，底层 `(blueprintId, fieldId)`） |

---

## 5. 统一运行时契约与数据模型

### 5.1 目标类型（M1~M5 收敛）

```ts
type BlueprintOwnerRef =
  | { kind: "globalMain" }
  | { kind: "surfaceMain"; surfaceId: string }
  | { kind: "widgetMain"; surfaceId: string; elementId: string }
  | { kind: "sharedAsset"; assetId: string };

type BlueprintFrontendKind = "visual" | "typescript";

type BlueprintDocument = {
  schemaVersion: number;
  blueprints: Record<string, Blueprint>;
  ownerIndex?: Record<string, string>; // legacy / migration
  ownerRecords?: unknown; // v3+: active + multiple private revisions per owner
  meta?: { createdAt?: string; updatedAt?: string };
};

type Blueprint = {
  id: string;
  name: string;
  owner: BlueprintOwnerRef;
  frontend: BlueprintFrontendKind;
  programKind: BlueprintProgramKind;
  members?: BlueprintMemberIndex;
  bindings?: Record<string, BindingDefinition>;
  program: BlueprintProgram;
  meta?: Record<string, unknown>;
};

type BlueprintMemberIndex = {
  variables: Record<string, BlueprintVariable>;
  fields: Record<string, BlueprintField>;
  functions: Record<string, BlueprintFunctionSignature>;
};

type BlueprintProgramKind = "graph" | "scriptModule";

type BlueprintProgram =
  | { kind: "graph"; graphs: BlueprintGraphIndex }
  | { kind: "scriptModule"; source: TypeScriptBlueprintSource };

type BlueprintGraphIndex = {
  events: Record<string, BlueprintEventGraph>;
  functions: Record<string, BlueprintFunctionGraph>;
  macros?: Record<string, BlueprintMacroGraph>;
};

type BindingDefinition = {
  id: string;
  target: BindingTargetRef;
  source: BindingSourceRef;
  mode: "replace";
  fallback?: LiteralValue;
};

type BindingTargetRef = {
  kind: "widgetProp";
  surfaceId: string;
  elementId: string;
  propPath: string;
};

type BindingSourceRef = {
  kind: "field";
  blueprintId: string;
  fieldId: string;
};

type TypeScriptBlueprintSource = {
  language: "typescript";
  code: string;
  compiledModuleId?: string;
  outputPath?: string;
  diagnostics?: BlueprintDiagnostic[];
};

type SharedBlueprintAsset = {
  assetId: string;
  name: string;
  frontend: "visual" | "typescript";
  blueprint: Blueprint;
  meta?: { tags?: string[]; category?: string };
};
```

### 5.2 事件绑定（磁盘真相）

```ts
type UIBehaviorBinding =
  | { kind: "noop" }
  | { kind: "actions"; actions: UIBehaviorAction[] }
  | { kind: "blueprintEvent"; blueprintId: string; eventId: string };
```

- 事件图体在 **`Blueprint.program.graphs.events[eventId].graph`**。
- `uigraphs.json` schema v2+：**`blueprintDocument` 必填**；顶层 `graphs` 仅为旧版行为图 IR **兼容区**，不是 Blueprint 事件图真相。

### 5.3 图与节点分类

- 图分型：`eventGraph`、`functionGraph`、后续 `macroGraph`。
- 节点：**纯节点**（只产出值、无副作用）与 **执行节点**（执行 pin、可副作用）；注册层即区分。

### 5.4 TypeScript Blueprint 风格（示例）

受限虚拟模块 + 注册式 API，例如：

```ts
import { bound, events } from "narraleaf-studio";

bound.bindSymbol("titleText", (ctx) => ctx.state.surface.get("title"));

events.on("submitButton.click", async (ctx) => {
  await ctx.host.navigation.openSurface("result");
});
```

禁止：任意 import、Studio 内部对象、把 TS 蓝图当普通项目脚本。

---

## 6. 作用域与状态

至少四类：**execution locals**、**surface**、**global UI**、**persistence**。原则：绑定只读；事件图可读可写；持久化走宿主 API；访问路径可观测以利调试。

---

## 7. 绑定与字段

- 属性：`Literal` / `Bound` / `Broken`（可选 `Overridden`）；失效时 **broken** 明示，不静默 fallback。
- 绑定定义在文档 `bindings`；`UIElement.props` 存字面量。
- 删除字段 → 绑定 broken；支持用户重绑或改回字面量。

---

## 8. 存储布局

- **实例主蓝图：** 与 UI 强耦合，载体为升级后的 **`uigraphs.json`**（路径可保留）。
- **共享蓝图：** `assets/blueprints/` 等独立文件，**不进** `uigraphs.json`。
- 旧版 `uigraphs`：**strict fail**，不自动静默迁移（需显式迁移工具或手工处理）。

---

## 9. 宿主 API（M1 协议层）

六大族：**navigation / widget / state / persistence / media / devtools**。每项需约定：能力名、参数、返回值、异步性、**是否可在绑定中调用**；协议层标记 `pure` / `effectful`。

**M3-min 落地时示例能力：** `navigation.openSurface`、`navigation.closeLayer`、`widget.setVisible`、`widget.setEnabled`、`state.get`/`set`、`persistence.get`/`set`、`media.playAudio`、`media.playAnimation`、`devtools.log` 等（完整度随 M3-full 扩展）。

---

## 10. 调试协议（事件类型）

统一事件流（完整列表以 `src/shared/types/blueprint/debug.ts` 为准），概念上包括：

- `execution.started` / `execution.finished` / `execution.error`
- `node.enter` / `node.exit`（M3-full）
- `state.read` / `state.write`
- `binding.evaluated`
- `function.call` / `function.return`

Dev Mode 为调试主阅读界面。

---

## 11. Dev Mode 与 Bundle

推荐 `DevModeBundle.ui` 含：`uidoc`、本地 `BlueprintDocument`、`sharedBlueprints`（内容或索引）、版本信息。

运行链概要：打包 → Dev Window → Registry + Host + Debug Bridge → UI 事件 → 主蓝图 + `eventId` → Executor → Host API → Debug 事件。

---

## 12. 代码落点（索引）

| 区域 | 路径 |
|------|------|
| Canonical 类型 | `src/shared/types/blueprint/*`（`schema.ts`、`document.ts`、`hostApi.ts`、`debug.ts`）；`BLUEPRINT_HOST_API_M1_CAPABILITIES`、`BLUEPRINT_HOST_API_CONTRACT_VERSION` |
| UI 桥接 | `src/shared/types/ui-editor/document.ts`、`graph.ts` |
| Dev Mode 形状 | `src/shared/types/devMode.ts` |
| 运行时适配 | `src/renderer/lib/ui-editor/runtime/types.ts`（`UIHostAdapter`、`blueprintHostApiVersion`） |
| 服务 | `UIGraphService`、`LocalBlueprintService`、`UIBlueprintLifecycleCoordinator` |
| 运行时 | `blueprint-runtime/*`、`GraphExecutor`、`blueprintM3MinNodes`、`blueprintM3FullNodes` |
| 编辑器壳 | `src/renderer/apps/workspace/modules/blueprint-lite/*` |
| 属性绑定 | `src/renderer/apps/workspace/modules/properties/blueprint/*` |
| Dev Mode | `DevModeManager`、`useDevModeBlueprintRuntime`、`BlueprintRuntimeDebugPanel` |

**Studio 蓝图 Tab（简化布局）：** 可折叠左侧栏承载「图层」（`graphs.events` 槽，**仅组织与编译顺序，不约定蓝图入口**）与成员区（执行用 `members.variables` 默认值 + 绑定用 `members.fields`）；中间为全宽画布；节点参数在节点卡片上编辑（含 `variableRef` 下拉）。若多个控件事件要跑同一张图，在属性面板将各事件的 `blueprintEvent` 指向同一图层 `eventId` 即可。事件入口由 **事件头节点** 与 Widget 模块声明的 `behavior.events` 槽位共同决定；详见 `project/docs/blueprint-nodes.md`。

---

## 13. 里程碑 M1 — M5（实施顺序不可倒置）

**顺序：** M1 语义/类型 → M2 存储与生命周期 → M3 运行时与 Dev Mode → M4 Visual 编辑器与 Studio 集成 → M5 TS 蓝图、共享资产、DevTools。

### 13.1 M1 — 核心语义、类型、协议冻结

**冻结：** UI 范围；两前端不互转；统一运行时契约；实例/共享分层；绑定纯度；副作用仅在事件图；宿主 API 一级分类；调试事件基础版；动态 UI 边界（模板列表/条件块，非任意树编排）。

**产物：** 完整类型（含 `BlueprintDiagnostic`、`BlueprintDebugEvent`、`BlueprintHostApiContract` 等）、文档与 schema 版本策略。

**M1 验收：** 类型层能表达目标系统；后续不推翻 owner、binding、frontend、programKind。

**实现锚点：** `src/shared/types/blueprint/`；**M1 不要求** `DevModeManager` 写入 bundle 新字段以改变磁盘 schema；`UIHostAdapter` 的契约版本字段不表示 M3 能力已全部实现。

### 13.2 M2 — 本地实例存储、生命周期、绑定持久化

**内容：** `uigraphs.json` 作为本地实例蓝图文档；自动生成 `globalMain` / `surfaceMain` / 按需 `widgetMain`；删除/复制/重命名规则（复制新 id+owner，重命名不改 blueprint id）；`ownerIndex` / **ownerRecords** 索引；`blueprintEvent` 持久化；`bindings` 与 props 分离。

**验收：** owner 稳定；绑定可持久化、重命名可追踪、broken 可见。

### 13.3 M3 — 运行时闭环、Dev Mode、调试

**组件概念：** `BlueprintRegistry`、`BlueprintDispatcher`、`BlueprintExecutor`、`BindingEvaluator`、`ScopeStoreBridge`、`HostApiBridge`、`DebugBridge`。

**派发链：** UI 事件 → 主蓝图 → `eventId` → 执行上下文 → Executor → Host → Debug。

**绑定求值：** 查绑定 → 解析声明 → 上下文求值 → 返 UI →（可选）`binding.evaluated` 事件。

**图执行协议：** pin、异步、`maxSteps` 等；脚本模块：编译、装载、虚拟模块、注册入口/符号/函数、错误捕获。

**M3 最小节点族方向：** 事件入口、变量读写、分支、序列、调函数、调共享蓝图、状态读写、导航、音频/动画、持久化、调试日志等（与注册表逐项对照）。

**动态模板：** 条件块、列表数据源、模板上下文 — 可先由宿主组件承载，运行时提供数据与声明求值。

#### 13.3.1 M3-min（已定义的缩小范围）

- 状态域示例：仅 **surface**。
- 声明 `valueSource`：如仅 **`surfaceState`**。
- 执行：`GraphExecutor` + `blueprint.state.set` 等最小节点。
- 调试：六类事件在 Dev Mode 内嵌面板；**无** Workspace IPC；可无 `node.enter`/`exit`（留给 M3-full）。

#### 13.3.2 M3-full（扩展方向）

- `node.enter` / `node.exit`、扩展节点族、`BlueprintHostApiBridge`、`ScopeStoreBridge`、错误定位与 Workspace 跳转等 — **按家族与节点清单逐项验收**，整体可 partial。

**M3 验收：** 点击触发真实逻辑；状态读写可见；绑定驱动 UI；Dev Mode 可执行；至少节点进出或错误可读。

### 13.4 M4 — Studio 集成与 Visual Blueprint 编辑器

**目标：** 属性面板升级；绑定 UI；声明选择；主蓝图跳转；独立蓝图 Tab；React Flow 画布；节点检查器；图校验与错误列表。

**属性行状态：** Literal / Bound / Broken（可选 Overridden）。

**Tab 布局：** 左成员树 / 中 React Flow / 右检查器与调试 / 底错误/日志。

**React Flow：** 仅交互壳；语义由领域层（pin 兼容、合法性、纯/执行分类）负责。

**节点编辑器元信息：** `BlueprintNodeEditorMeta`（category、displayName、keywords、`isPure`、pins、inspector schema）与运行时注册共享。

**能力边界：** 优先事件图、函数图、变量、声明读、函数调用、基础控制流；宏、复杂折叠、自动布局、极致大图性能可延后。

**校验：** pin 类型、必填输入、事件图入口、声明存在、共享调用签名、TS 产物过期等。

**仓库分层（避免误判）：** 长期目标仍以里程碑全文为准；**已显著落地：** 统一 Blueprint Tab、成员树、图校验与诊断、属性绑定三态、解绑/跳转、声明创建与搜索绑定（`blueprint-lite/`、`properties/blueprint/`）。**Partial：** 部分错误一键直达、画布**不**默认挂完整 `blueprintRuntime`（真实执行在 Dev Mode）。

**M4 验收：** 用户可从属性面板进入、编辑 Visual 蓝图、建绑定、存事件图、在编辑器内看到校验错误。

### 13.5 M5 — TypeScript 蓝图、共享资产、DevTools

**内容：** Monaco（目标）与 TS 模板、类型提示、诊断、编译与装载链、成员树联动；**单一 `blueprint` 资产类型**的共享蓝图；资产面板创建/搜索/分类/引用；调用共享蓝图（函数式、纯声明导出优先）；DevTools：节点高亮、调用栈、局部变量、状态快照、副作用日志、绑定 trace、错误详情、TS 源码↔成员最小映射。

**明确非目标：** 互转、断点单步（默认）、时光回溯、任意动态 UI 树、共享继承、网络编排等。

**仓库衔接（勿将里程碑句等同全部完成）：** 可能出现 **schema v3**（`ownerRecords`、多私有修订 + `active`）；TS 或在 **Dev Mode 主进程** esbuild 编译并内联装入 bundle；**Workspace `BlueprintBuildService`、磁盘 `editor/generated/blueprints/` manifest、Monaco 级体验、完整多面板 DevTools、VE-M6 插入/搜索/remap UI** 等仍可能为 **partial**（见 §14）。

### 13.6 完成判定摘要

| 里程碑 | 判定 |
|--------|------|
| M1 | 术语与契约稳定 |
| M2 | 实例蓝图自动存在、绑定持久化与 broken |
| M3 | Dev Mode 真实执行与调试流 |
| M4 | Studio 内可管理编辑 Visual 蓝图 |
| M5 | TS 蓝图 + 共享资产 + DevTools 可用（按 residual 表持续收口） |

### 13.7 建议延后到 M6+

可视化↔TS 互转；断点/单步/条件断点；时光回溯；任意动态 UI 树；共享继承；网络编排；协作编辑；大图性能专项等。

---

## 14. 全局不变量（摘自原 Master Spec）

| ID | 规则 |
|----|------|
| G4 | Visual 与 TS 蓝图共用 Runtime Contract、Host API、Debug 协议 |
| G5 | 绑定纯；副作用仅在事件图或 TS 注册的事件路径 |
| G6 | 实例主蓝图与共享资产分层 |
| G7 | 事件图真相在 `BlueprintDocument` / `blueprintDocument`；顶层旧 `graphs` 仅为兼容 |
| G8 | Dev Mode 为真实运行与调试主入口 |

---

## 15. 交错阶段 P1–P7 与里程碑映射

| Phase | 捆绑（高层） | 意图 |
|-------|----------------|------|
| P1 | VE M2-A + BP M2 | 四件套 widget + 本地实例蓝图、`blueprintEvent`、只读摘要 |
| P2 | BP M3-min + VE M4-lite | 最小闭环 + Workspace 真入口（轻量 Tab） |
| P3 | VE M2-B + VE M3 | Stack/Scroll/Spacer/ListRepeater + 官方示例 |
| P4 | BP M4 + VE M4-full | React Flow 编辑 + 属性绑定工作流 |
| P5 | VE M5 + BP M3-full | 静态诊断 + 运行时节点与 Host API 扩展 |
| P6 | BP M5 + VE M6 | TS/共享资产/DevTools + 编辑器生产收口 |
| P7 | Meta | 文档与验收矩阵对齐、小缺口编码（如去掉 `prompt`、声明搜索绑定、诊断跳转） |

---

## 16. 实施记录与验收矩阵摘要（原 implementation-plans）

### 16.1 P1 — VE M2-A + BP M2（已实施记录）

- Widgets：`nl.text`、`nl.image`、`nl.container`、`nl.button`；`supportsBlueprintLogic`。
- 本地蓝图：`ensureEventGraph` / `removeEventGraph` / `listEventGraphIds`；`setElementBlueprintEvent` / `clearElementBlueprintEvent`。
- 只读摘要：`ReadonlyBlueprintSection`、`useReadonlyBlueprintSummary`。
- 校验：owner/event 一致；绑定解析到存在声明。
- 复制预备：`planSubtreeDuplicateBlueprintRemap`（数据层）。
- **非目标：** M2-B 四件套、完整蓝图编辑器、运行时执行、剪贴板 remap UI。

### 16.2 P2 — BP M3-min + VE M4-lite

- 闭环：Button → `blueprintEvent` → `GraphExecutor` → `blueprint.state.set` → surface state → `BindingEvaluator` → UI。
- 调试：`execution.*`、`state.*`、`binding.evaluated`（Dev Mode 内嵌，无 Workspace IPC）。
- 声明：仅 `surfaceState` 等 M3-min 约束。
- **非目标：** 完整 React Flow、属性面板完整绑定编辑、全 Host API、`node.enter`/`exit`。

### 16.3 P3 — VE M2-B + M3 示例

- Widgets：`nl.stack`、`nl.scroll`、`nl.spacerDivider`、`nl.listRepeater`；流式子布局规则。
- 示例：`project/examples/visual-editor/` 六组（dialog、choice、toast、settings、save-load、overlay-pause）；示例内 `uigraphs.json` 可能为旧 schema，**加载时迁移**（以 `UIGraphService.migrateIfNeeded` 与类型为准）。

### 16.4 P4 — BP M4-full + VE M4-full（混合）

**已落地：** M4-lite；Literal/Bound/Broken；解绑、跳转；就地创建与搜索声明绑定（P7 去掉 `prompt`）；`BlueprintEntryTab`、图校验、`onDiagnosticPick` 聚焦。

**仍 partial：** 画布 `blueprintRuntime`（产品边界：非默认必做）；部分 Workspace 静态诊断跳转。

### 16.5 P5 — VE M5 + BP M3-full（混合）

- 静态诊断：`resourceDiagnostics`、`linkDiagnostics` **done**；`layout`、interaction 热点/尺寸 **done**；`stage`、部分可见性 **partial**。聚合：`collectSurfaceDiagnostics.ts`。
- M3-full：`node.enter`/`exit` **done**；扩展节点、Host API 家族、Scope、错误→Workspace 闭环 **partial**。

### 16.6 P6 — BP M5 + VE M6（方案与残余）

**决策摘录：** 独立 `BlueprintBuildService`（单一编译真相）；`editor/generated/blueprints/` 目标布局；owner **多私有修订 + 单一 `active`**；单一 `blueprint` 资产类型；单一编辑器壳按 `frontend` 切换；编译失败**严格阻断**。

**单元：** 契约与 owner 记录 → Build Service → 统一壳与资产入口 → Dev Mode 装载与 registry → DevTools 与 TS 映射 → VE M6 收口。

**记录级残余风险（实施记录曾列）：** Workspace 侧实时 TS 编译 IPC 可能未齐；manifest 落盘可能改为 bundle 内联；`bound.bindSymbol` 可能未接 `BindingEvaluator`；`InsertSearchPopover`、剪贴板 remap UI；`eval` 装载长期可改 blob/import；示例 JSON 版本与运行时迁移说明需与 `visual-editor.md` §4.4 一致。

### 16.7 P7 — 文档与缺口收口

- **矩阵：** 句级 `done/partial` 对照（原附录 A）；**编码：** `prompt` → 正式 UI；声明搜索绑定；诊断条带带 `elementId` 可选中画布元素；里程碑与实现指南事实对齐。
- **刻意非目标：** 画布挂 `blueprintRuntime`、完整 Build Service 在 Workspace、完整 InsertSearch 系统 — 不默认纳入 P7。

#### 16.7.1 句级对照矩阵（归档，2026-04-05 基线）

| Phase | Ref | Milestone sentence | Status | Evidence path(s) | Notes |
|-------|-----|--------------------|--------|------------------|-------|
| P1 | VE-M2-01 | Text/Image/Button/Container 可插入、编辑、持久化 | done | `widget-modules/builtin/`，§16.1 | |
| P1 | BP-M2-01 | widgetMain、事件图、绑定持久化、owner 生命周期 | done | §16.1，`LocalBlueprintService` | |
| P2 | BP-M3-01 | 点击→事件图→状态→绑定→UI→调试流 | done | §16.2，`useDevModeBlueprintRuntime.ts` | M3-min ≠ M3-full |
| P2 | VE-M4-01 | 真入口+只读摘要+轻量 Tab | done | `blueprint-lite/`，`ReadonlyBlueprintSection.tsx` | |
| P3 | VE-M2-02-A~D | stack/scroll/spacerDivider/listRepeater | done | 各 `builtin/*` 目录 | |
| P3 | VE-M3-01-A | 六组官方示例目录 | done | `project/examples/visual-editor/` | |
| P3 | VE-M3-01-B | 示例蓝图 schema 与迁移语义一致 | partial | 示例 `uigraphs.json`，`visual-editor.md` §4.4 | |
| P4 | VE-M4-02-A | Literal/Bound/Broken | done | `usePropertyBindingState.ts` | |
| P4 | BP-M4-01-A | 打开蓝图编辑器 | done | `useOpenBlueprintTarget.ts` | |
| P4 | BP-M4-01-B | 搜索已有声明 | partial → P7 收口 | `properties/blueprint/*` | |
| P4 | BP-M4-01-C | 就地创建声明 | partial → P7 去 prompt | 同上 | |
| P4 | BP-M4-01-D/E | 解绑/跳转声明 | done | 同上 | |
| P4 | BP-M4-01-F | 图级校验与错误 | done | `BlueprintDiagnosticsPanel.tsx` | |
| P4 | BP-M4-01-G | 从错误跳到节点 | partial | Tab 内较好，Workspace 不统一 | |
| P5 | VE-M5-01-A~F | 静态诊断各类 | done/partial 混杂 | `diagnostics/rules/*`，§16.5 | |
| P5 | BP-M3-02-A | node.enter/exit | done | `GraphExecutor.ts`，`debug.ts` | |
| P5 | BP-M3-02-B~D | 节点族、Host API、错误定位 | partial | `blueprintM3FullNodes.ts` 等 | |
| P6 | BP-M5-01-A~D | TS、编译、共享资产、DevTools | partial | TS 面板、compile 主进程链等 | |
| P6 | VE-M6-01-A~C | 插入搜索、复制 remap、属性一致 | partial | §16.6 remaining risks | |

**P7 落地摘要（编码）：** `BindablePropertyField` 声明列表与 Create & bind；`PropertiesPanel` 诊断条带选中元素；`BlueprintDiagnosticsPanel` 文案与空状态对齐。

### 16.8 验收 ID 索引（便于勾表）

| ID | 含义 |
|----|------|
| BP-M1-01 | 类型与 Host/Debug 协议可扩展 |
| BP-M2-01 | 实例生命周期与绑定、broken |
| BP-M3-01 | M3-min 闭环 |
| BP-M3-02 | M3-full 扩展 |
| BP-M4-01 | Studio Visual 编辑与校验 |
| BP-M5-01 | TS + 共享资产 + DevTools |
| VE-M* | 见 `visual-editor-arch.md` §11 |

---

## 17. 运行时管线（逻辑顺序）

1. UI 行为触发（如 click）。  
2. `blueprintEvent` → Dispatcher 按 `blueprintId` + `eventId` 解析 **图** 或 **TS 模块**。  
3. Visual：`GraphExecutor`；TS：已装载模块 handler。  
4. 副作用经 Host API。  
5. `BindingEvaluator` 合并下一帧属性。  
6. `DebugBridge` 输出事件；Dev Mode 订阅。

---

## 18. 静态诊断 vs Dev Mode（职责）

| 关注点 | Workspace | Dev Mode |
|--------|-----------|----------|
| 布局、资源、link、stage | 静态规则 | 可选补充 |
| 图编辑期校验 | 是 | - |
| 真实执行、完整错误栈 | 否（跳转/说明） | 是 |

---

## 19. 修订策略

- **架构级变更** 先更新本文与 `visual-editor-arch.md` / `visual-editor.md`，再同步依赖方。
- **完成度** 以代码与类型为准；`partial` 项关闭时更新 §16 矩阵叙述。

---

*End of blueprint-system-arch.md*
