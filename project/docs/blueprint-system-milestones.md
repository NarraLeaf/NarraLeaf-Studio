# NarraLeaf Studio - Blueprint System Milestones（M1~M5）

本文档将蓝图系统的完整落地实现拆分为 `M1 ~ M5` 五个层级。它不是逐文件施工单，而是一份面向实现的阶段性架构与交付文档。

前置阅读：

- 架构速览：`project/docs/blueprint-system-architecture.md`
- 完整背景：`project/docs/blueprint-system.md`

---

## 1. 总体目标

蓝图系统的最终目标是为 NarraLeaf Studio 提供一套 **UI 中心、双执行后端、受限真实 TypeScript 并存、可调试、可资产化** 的逻辑平台。

最终系统必须满足：

- `Visual Blueprint` 和 `TypeScript Blueprint` 两种前端
- 统一 `Runtime Contract`
- 统一 `Runtime`
- 统一 `Host API`
- 统一 `Debug Protocol`
- 实例主蓝图与共享蓝图资产分层
- 纯绑定系统与副作用执行图分离
- Dev Mode 可真实运行和调试

---

## 2. 分阶段总览

### 2.1 里程碑定义

- `M1`：核心语义、类型、文档与协议冻结
- `M2`：本地实例蓝图存储、生命周期、绑定持久化
- `M3`：运行时闭环、Dev Mode 执行、调试事件
- `M4`：Studio 集成与 Visual Blueprint 编辑器
- `M5`：TypeScript Blueprint、共享蓝图资产、DevTools 强化

### 2.2 推荐实施顺序

必须严格按下面顺序推进：

1. 先稳定语义和 schema
2. 再稳定本地存储和 owner 生命周期
3. 再打通运行时与 Dev Mode
4. 再做 Visual 编辑器
5. 最后接入 TypeScript 前端和共享蓝图资产

不要倒过来先做复杂编辑器，否则很容易出现：

- 图能画但不能执行
- TS 能写但运行语义不稳定
- 绑定能配但没有统一 owner / id / scope

---

## 3. 全局实现规则

以下规则对 `M1 ~ M5` 全部生效。

### 3.1 统一运行时契约

所有蓝图前端必须对齐到同一套上层运行时契约。

- `Visual Blueprint -> Graph IR / Graph Program`
- `TypeScript Blueprint -> Compiled Script Module`

禁止形成两套互不兼容的宿主 API、状态模型和调试协议。

### 3.2 绑定纯度

绑定和声明系统必须保持纯计算。

- 可读状态
- 可调用纯函数
- 可组合其他声明
- 不可触发副作用

### 3.3 副作用边界

所有副作用都必须放进事件执行图。

包括：

- 写状态
- 导航
- 音频
- 动画
- 持久化
- 弹窗和通知

### 3.4 分层

必须明确区分：

- 实例主蓝图
- 共享蓝图资产

实例主蓝图不共享，共享蓝图不承担实例私有生命周期。

### 3.5 Dev Mode 优先

真实运行与调试的主场必须是 `Dev Mode`，不是编辑器内模拟壳。

### 3.6 兼容当前仓库

实现时优先复用现有基础：

- `uidoc.json`
- `uigraphs.json`
- `UIGraphService`
- `GraphExecutor`
- `BehaviorNodeRegistry`
- `UIHostAdapter`
- `DevModeBundle`

---

## 4. 最终目标数据结构

这部分不是要求在 `M1` 一次写死所有细节，但它定义了 `M1~M5` 共同收敛的目标。

### 4.1 Blueprint Owner

```ts
type BlueprintOwnerRef =
  | { kind: "globalMain" }
  | { kind: "surfaceMain"; surfaceId: string }
  | { kind: "widgetMain"; surfaceId: string; elementId: string }
  | { kind: "sharedAsset"; assetId: string };
```

### 4.2 Blueprint 文档

```ts
type BlueprintDocument = {
  schemaVersion: number;
  blueprints: Record<string, Blueprint>;
  ownerIndex: Record<string, string>;
  meta?: {
    createdAt?: string;
    updatedAt?: string;
  };
};
```

说明：

- `blueprints` 保存本地实例主蓝图
- `ownerIndex` 用于从 owner 快速定位 blueprint id

### 4.3 Blueprint 实体

```ts
type BlueprintFrontendKind = "visual" | "typescript";

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
```

### 4.4 成员索引

```ts
type BlueprintMemberIndex = {
  variables: Record<string, BlueprintVariable>;
  declarations: Record<string, BlueprintDeclaration>;
  functions: Record<string, BlueprintFunctionSignature>;
};
```

### 4.5 程序类型

```ts
type BlueprintProgramKind = "graph" | "scriptModule";

type BlueprintProgram =
  | {
      kind: "graph";
      graphs: BlueprintGraphIndex;
    }
  | {
      kind: "scriptModule";
      source: TypeScriptBlueprintSource;
    };
```

### 4.6 图索引

```ts
type BlueprintGraphIndex = {
  events: Record<string, BlueprintEventGraph>;
  functions: Record<string, BlueprintFunctionGraph>;
  macros?: Record<string, BlueprintMacroGraph>;
};
```

### 4.7 绑定定义

```ts
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
  kind: "declaration";
  blueprintId: string;
  declarationId: string;
};
```

### 4.8 TypeScript Blueprint 源

```ts
type TypeScriptBlueprintSource = {
  language: "typescript";
  code: string;
  compiledModuleId?: string;
  outputPath?: string;
  diagnostics?: BlueprintDiagnostic[];
};
```

### 4.9 共享蓝图资产

```ts
type SharedBlueprintAsset = {
  assetId: string;
  name: string;
  frontend: "visual" | "typescript";
  blueprint: Blueprint;
  meta?: {
    tags?: string[];
    category?: string;
  };
};
```

---

## 5. M1：核心语义、类型、协议冻结

`M1` 的目标不是“蓝图能跑”，而是让后续开发不再在根语义上反复摇摆。

### 5.1 M1 范围

`M1` 必须明确并冻结：

- 系统范围只聚焦 UI
- 两种蓝图前端不互转
- 两种蓝图共享同一套上层运行时契约
- 实例主蓝图与共享蓝图资产分层
- 绑定系统纯度边界
- 宿主 API 一级分类
- 调试事件协议基础版
- 动态 UI 边界为模板列表/条件块，不做任意树编排

### 5.2 M1 主要产物

- Blueprint 类型定义
- Owner 模型
- 成员模型
- 绑定模型
- 图分类模型
- 节点语义分类
- Host API 协议定义
- Debug Event 协议定义
- 文档与 schema version 策略

### 5.3 M1 关键设计决策

必须在 `M1` 明确：

- `Visual Blueprint` 与 `TypeScript Blueprint` 都只是蓝图的两种创作前端
- `Visual Blueprint` 使用图结构和 Graph IR
- `TypeScript Blueprint` 使用受限但真实执行、并会编译进游戏产物的脚本模块
- `TypeScript Blueprint` 不是 DSL，也不是普通项目脚本
- `uigraphs.json` 继续作为本地实例蓝图文档载体
- 共享蓝图进入资产系统
- 绑定来源只能是声明成员，不直接存复杂表达式 AST

### 5.4 M1 需要定义的类型

`M1` 必须至少稳定下面这些逻辑对象：

- `BlueprintOwnerRef`
- `BlueprintDocument`
- `Blueprint`
- `BlueprintMemberIndex`
- `BlueprintVariable`
- `BlueprintDeclaration`
- `BlueprintFunctionSignature`
- `BlueprintGraphIndex`
- `BindingDefinition`
- `BindingTargetRef`
- `BindingSourceRef`
- `BlueprintDiagnostic`
- `BlueprintDebugEvent`
- `BlueprintHostApiContract`

### 5.5 M1 的宿主 API 协议

`M1` 不需要完成所有实现，但必须定义分层契约。

最少定义六大 API 家族：

- `navigation`
- `widget`
- `state`
- `persistence`
- `media`
- `devtools`

每类 API 都要明确：

- 能力名称
- 输入参数
- 返回值形态
- 是否异步
- 是否可在绑定系统调用

建议直接在协议层标记：

- `pure`
- `effectful`

### 5.6 M1 的调试协议

定义统一事件流：

```ts
type BlueprintDebugEvent =
  | { type: "execution.started"; executionId: string; blueprintId: string }
  | { type: "execution.finished"; executionId: string; blueprintId: string }
  | { type: "node.enter"; executionId: string; nodeId: string }
  | { type: "node.exit"; executionId: string; nodeId: string }
  | { type: "state.read"; scope: string; key: string }
  | { type: "state.write"; scope: string; key: string }
  | { type: "binding.evaluated"; bindingId: string }
  | { type: "function.call"; functionId: string }
  | { type: "function.return"; functionId: string }
  | { type: "execution.error"; executionId: string; message: string };
```

### 5.7 M1 验收标准

完成 `M1` 时应满足：

- 架构与实现文档不再对核心语义互相矛盾
- 类型层已经能表达完整目标系统
- 后续阶段不需要再推翻 owner、binding、frontend、programKind 的基础定义
- 任何新节点、新编辑器、新调试面板都能挂到同一套协议上

### 5.8 M1 代码落点与前向兼容约定（实现锚点）

以下与仓库实现对齐，用于区分「**契约已冻结**」与「**行为已实现**」：

- **Canonical 类型层**：`src/shared/types/blueprint/`（`schema.ts`、`document.ts`、`hostApi.ts`、`debug.ts`、`index.ts`）。宿主 API 能力表见 `BLUEPRINT_HOST_API_M1_CAPABILITIES`；契约版本见 `BLUEPRINT_HOST_API_CONTRACT_VERSION`。
- **UI 文档桥接（当前事实）**：`src/shared/types/ui-editor/document.ts` 中 `UIBehaviorBinding` 以 `kind: "blueprintEvent"`（`blueprintId` + `eventId`）为事件入口；`src/shared/types/ui-editor/graph.ts` 中磁盘 `uigraphs.json` 为 schema v2，`blueprintDocument` **必填**，顶层 `graphs` 仅作旧版行为图 IR 兼容区，**不是** Blueprint 事件图真相（事件图体在 `Blueprint.program.graphs.events[eventId].graph`）。
- **Dev Mode bundle 形状**：`src/shared/types/devMode.ts` 的 `ui.localBlueprints` / `ui.sharedBlueprints` 为可选；**M1 不要求** `DevModeManager` 写入，亦不改变 `uigraphs.json` 磁盘 schema 版本。
- **运行时 substrate**：`src/renderer/lib/ui-editor/runtime/types.ts` 中 `UIHostAdapter` 可选 `blueprintHostApiVersion`，表示未来向 `BlueprintHostApiContract` 对齐，**不表示** M3 宿主能力已全部实现。
- **本阶段明确不动（避免范围蔓延）**：`UIGraphService` 的真实 migration、`DevModeManager` 的 bundle 生产逻辑扩展、`GraphExecutor` 的派发与调试发射、属性面板与 inspector 的真实蓝图 UI。

---

## 6. M2：本地实例蓝图存储、生命周期、绑定持久化

`M2` 的核心是把“蓝图是什么”落到“蓝图存在哪、怎么跟 UI 实例绑定、如何随实例变化自动维护”。

### 6.1 M2 范围

`M2` 必须完成：

- `uigraphs.json` 升级为本地实例蓝图文档
- 实例主蓝图自动创建
- owner 索引建立
- 实例删除、复制、重命名时的蓝图生命周期规则
- 绑定定义可持久化
- 属性与声明成员之间建立稳定引用

### 6.2 本地文档职责

本地蓝图文档只负责实例主蓝图：

- 全局主蓝图
- `Surface` 主蓝图
- 控件主蓝图

不负责共享蓝图资产。

### 6.3 自动生成规则

`M2` 应建立下面这些规则：

- 项目初始化时自动创建 `globalMain`
- 创建 `Surface` 时自动创建 `surfaceMain`
- 创建支持逻辑的控件时按需创建 `widgetMain`
- 删除实例时自动删除对应主蓝图与 ownerIndex
- 重命名实例不改变 blueprint id
- 复制实例时生成新的 blueprint id 和新的 owner

### 6.4 Blueprint Owner 索引

需要一个稳定 owner key 计算规则，例如：

- `globalMain`
- `surfaceMain:<surfaceId>`
- `widgetMain:<surfaceId>:<elementId>`

文档内通过 `ownerIndex[ownerKey] = blueprintId` 快速定位实例主蓝图。

### 6.5 事件绑定持久化

当前仓库已采用蓝图事件入口模型（见 `src/shared/types/ui-editor/document.ts`）：

```ts
type UIBehaviorBinding =
  | { kind: "noop" }
  | { kind: "actions"; actions: UIBehaviorAction[] }
  | { kind: "blueprintEvent"; blueprintId: string; eventId: string };
```

语义要点：

- 某个实例上的某个事件名（`UIBehavior.events[eventName]`）指向 **实例主蓝图** 中的某个 **事件图**（`eventId`）。
- 事件图体持久化在 `Blueprint.program.graphs.events[eventId].graph`；**不**再以顶层 `UIGraphDocument.graphs` 为 Blueprint 事件真相。

旧版 `kind: "graph"` / 仅顶层 `graphs` 的路径不再作为产品方向；`uigraphs.json` 旧 schema 采用 **strict fail**，不自动迁移。

### 6.6 绑定持久化模型

属性绑定不应直接塞进 `UIElement.props` 的任意位置，而应有统一定义。

推荐：

- `UIElement.props` 保存字面量配置
- 蓝图文档中的 `bindings` 保存绑定规则

这样做的好处：

- 字面量与绑定来源分离
- 绑定可统一管理与调试
- 解除绑定后可回退到 fallback

### 6.7 选择器与声明成员引用

`M2` 还需要确定绑定引用策略：

- UI 展示按名称和作用域搜索
- 底层永远通过 `(blueprintId, declarationId)` 定位

这一步必须同时定义：

- 声明成员稳定 id
- 重命名行为
- 删除声明成员时的失效绑定处理

### 6.8 失效绑定策略

推荐失效策略：

- 删除声明成员后，绑定进入 `broken` 状态
- UI 明确显示绑定失效
- 不自动 silently fallback
- 支持用户手动重新绑定或改回字面量

### 6.9 M2 验收标准

完成 `M2` 时必须满足：

- 所有实例主蓝图都能被稳定定位
- 实例创建/删除/复制不会破坏 ownerIndex
- 控件属性绑定可以持久化
- 绑定重命名后仍可稳定追踪
- 旧 `uigraphs`：产品决策为 **strict fail**（明确错误而非静默升级）；需要迁移时由项目维护者手工处理或在未来里程碑引入显式迁移工具

---

## 7. M3：运行时闭环、Dev Mode 执行、调试事件

`M3` 是整个系统最重要的里程碑。它决定蓝图是不是“真的系统”，而不是“编辑器造型”。

### 7.1 M3 范围

`M3` 必须完成：

- UI 事件到 Blueprint Runtime 的派发
- 运行时作用域与状态桥
- 绑定与声明求值
- 执行节点副作用落地
- Dev Mode 真正运行蓝图
- 调试事件回传

### 7.2 Runtime 总体结构

建议把运行时拆成下面这些组件：

- `BlueprintRegistry`
  - 持有本地蓝图与共享蓝图
- `BlueprintDispatcher`
  - 负责事件入口派发
- `BlueprintExecutor`
  - 执行图程序或脚本模块
- `BindingEvaluator`
  - 求值绑定和声明成员
- `ScopeStoreBridge`
  - 连接局部/Surface/全局/持久化状态
- `HostApiBridge`
  - 调宿主 API
- `DebugBridge`
  - 上报调试事件

### 7.3 作用域实现

运行时至少需要四类作用域容器：

- `execution locals`
- `surface state`
- `global ui state`
- `persistence state`

需要定义：

- 读取接口
- 写入接口
- 快照接口
- 变更通知接口

### 7.4 绑定求值模型

绑定求值应遵循：

1. UI 组件请求某属性值
2. `BindingEvaluator` 查询该属性是否有绑定
3. 若有绑定，则解析到声明成员
4. 在当前作用域上下文中求值得到值
5. 将结果返回给 UI 层
6. 发出 `binding.evaluated` 调试事件

绑定结果不应直接缓存到文档，而应作为运行时值。

### 7.5 事件派发模型

推荐事件派发链：

1. 控件或 `Surface` 产生事件
2. 根据实例 owner 找到主蓝图
3. 根据 `eventId` 找到事件图入口
4. 创建 `execution context`
5. 交给 `BlueprintExecutor`
6. 执行过程中通过 `HostApiBridge` 落地副作用
7. 通过 `DebugBridge` 上报过程事件

### 7.6 节点执行规则

`M3` 需要明确图程序执行协议：

- 节点类型 id
- 输入 pin
- 输出 pin
- 执行 pin
- 返回的 next port
- 异步支持
- 错误传播

建议保留 `maxSteps` 防止死循环。

同时需要为脚本模块执行定义统一入口协议：

- 模块编译
- 模块装载
- 允许 import 的虚拟模块集合
- 注册事件入口
- 注册声明符号
- 注册可调用函数
- 模块实例生命周期
- 脚本错误捕获与定位

### 7.7 节点分类在 M3 的落地

`M3` 先实现最小节点族：

- 事件入口节点
- 变量读取/写入
- 条件分支
- 序列
- 调用函数
- 调用共享蓝图
- 状态读取/写入
- 导航
- 音频 / 动画
- 持久化读写
- 调试日志

纯节点和执行节点要从注册层就明确分开。

### 7.8 动态模板与条件块

虽然完全自由 UI 树创建不在范围内，但 `M3` 必须为下面能力提供运行时基础：

- 条件显示块
- 模板列表数据源
- 模板实例上下文

最小做法：

- 先把列表数据绑定和条件块视为 UI 宿主组件能力
- 蓝图运行时只负责给它们提供数据和声明求值

### 7.9 Host API Bridge

`M3` 要把当前最小 `UIHostAdapter` 升级为真正的 `Blueprint Host API` 实现。

至少要支持：

- `navigation.openSurface`
- `navigation.closeLayer`
- `widget.setVisible`
- `widget.setEnabled`
- `state.get`
- `state.set`
- `persistence.get`
- `persistence.set`
- `media.playAudio`
- `media.playAnimation`
- `devtools.log`

### 7.10 Dev Mode Bundle

`M3` 需要升级 Dev Mode bundle，使其包含：

- `uidoc`
- 本地实例蓝图文档
- 共享蓝图资产内容或索引
- 版本信息

推荐结构：

```ts
type DevModeBundle = {
  bundleId: string;
  revision: number;
  timestamp: string;
  ui: {
    uidoc: UIDocument;
    localBlueprints: BlueprintDocument;
    sharedBlueprints?: SharedBlueprintAsset[];
  };
};
```

### 7.11 调试事件桥

`M3` 不要求完整调试 UI，但必须完成事件桥。

要求：

- 运行时每个执行过程有唯一 `executionId`
- 事件流可被 Dev Mode 订阅
- Studio 可接收执行轨迹
- 错误可定位到 blueprint / graph / node 级

### 7.12 M3 验收标准

完成 `M3` 时必须满足：

- 某个按钮点击能真实触发蓝图逻辑
- 蓝图可读写状态并产生可见结果
- 绑定值能驱动 UI 属性变化
- Dev Mode 能真实执行蓝图
- 至少能看到节点进入/退出与错误信息

### 7.13 M3-min（增量落地，与 Visual Editor M4-lite 同期）

仓库已落地一版 **缩小范围** 的 M3 子集（文档与计划：`project/docs/implementation-plans/p2-bp-m3min-ve-m4lite-plan.md`），用于先行验证闭环与协议：

- **状态域**：仅 `surface` 运行时状态（非 global / persistence / navigation / media）。
- **执行**：沿用 `GraphExecutor` + 适配后的 `BlueprintGraphIr`；最小节点 `blueprint.state.set`。
- **绑定求值**：`BlueprintDeclaration.valueSource` 仅 `surfaceState`；`BindingEvaluator` 在 Dev Mode 渲染前合并有效属性。
- **调试**：上述六类事件在 Dev Mode 内嵌面板可见；**无** Workspace / 主进程调试桥。
- **节点追踪**：不含 `node.enter` / `node.exit`（留给 M3-full）。

---

## 8. M4：Studio 集成与 Visual Blueprint 编辑器

`M4` 才是“用户真正能操作蓝图”的阶段，但它建立在 `M2 + M3` 之上。

### 8.1 M4 范围

`M4` 必须完成：

- 属性面板蓝图入口升级
- 绑定 UI
- 声明选择器
- 主蓝图跳转
- 独立蓝图编辑 Tab
- `Visual Blueprint` 编辑器
- 节点检查器
- 图级校验与错误展示

### 8.2 属性面板能力

属性面板应至少具备：

- 当前实例主蓝图概览
- “打开蓝图编辑器”按钮
- 当前属性是否绑定的状态提示
- 绑定来源展示
- 搜索声明成员
- 就地创建声明成员
- 跳转到声明成员
- 解除绑定

### 8.3 UI 交互状态

属性面板里的属性行需要支持以下状态：

- `Literal`
- `Bound`
- `Broken`
- `Overridden`（后续可选）

推荐第一阶段至少做好前三种。

### 8.4 蓝图 Tab 布局

推荐统一布局：

- 左侧：成员树
  - 事件
  - 函数
  - 变量
  - 声明成员
  - 引用的共享蓝图
- 中间：React Flow 画布
- 右侧：节点检查器 / 图检查器 / 调试面板
- 底部：错误列表 / 运行日志

### 8.5 React Flow 负责的内容

`M4` 中 `React Flow` 只负责编辑画布，不负责业务语义。

它负责：

- 节点放置
- 连线
- 缩放平移
- 选中
- 框选
- 节点拖拽
- 连接校验入口

业务语义由领域层决定：

- pin 是否兼容
- 节点是否允许连接
- 图是否合法
- 是否为纯节点

### 8.6 节点 UI 元信息

为了驱动编辑器，节点注册层需要新增 UI 元信息：

```ts
type BlueprintNodeEditorMeta = {
  category: string;
  displayName: string;
  keywords?: string[];
  isPure: boolean;
  inputPins: BlueprintPinDef[];
  outputPins: BlueprintPinDef[];
  inspector?: BlueprintNodeInspectorSchema;
};
```

这样：

- 运行时和编辑器共享节点注册
- 编辑器按元信息渲染节点
- 搜索面板按 `category + keywords` 工作

### 8.7 图编辑能力边界

`M4` 优先支持：

- 事件图
- 函数图
- 变量节点
- 声明读取节点
- 函数调用节点
- 基础控制流

`M4` 不急着支持：

- 宏系统
- 复杂图折叠
- 自动布局
- 大图性能优化到极致

### 8.8 校验系统

编辑器内必须有统一校验层，至少校验：

- pin 类型不兼容
- 缺失必填输入
- 事件图无入口
- 引用的声明不存在
- 共享蓝图调用签名不匹配
- TS Blueprint 编译产物过期

### 8.9 从当前 UI 上下文跳转

`M4` 应支持：

- 从选中的 `Surface` 打开其主蓝图
- 从选中的控件打开其主蓝图
- 从属性绑定直接跳到声明成员
- 从错误提示跳到节点

### 8.10 M4 验收标准

完成 `M4` 时必须满足：

- 用户可以从属性面板进入蓝图系统
- 用户可以创建和编辑 Visual Blueprint
- 用户可以为属性建立绑定
- 用户可以在图中创建事件逻辑并保存
- 校验错误能在编辑器中看到

---

## 9. M5：TypeScript Blueprint、共享蓝图资产、DevTools 强化

`M5` 是蓝图系统从“可用”走向“完整”的阶段。

### 9.1 M5 范围

`M5` 必须完成：

- `TypeScript Blueprint` 编辑器
- TS 编译与游戏内模块装载链
- 共享蓝图资产类型
- 资产管理器集成
- 调用共享蓝图
- DevTools 增强视图

### 9.2 TypeScript Blueprint 编辑器

`M5` 中 `TypeScript Blueprint` 应具备：

- Monaco 编辑器
- 脚本模板
- 宿主 API 类型提示
- 上下文对象类型提示
- 诊断错误展示
- 编译与装载准备
- 与成员树联动

### 9.3 TypeScript Blueprint 的能力边界

`M5` 必须保持受限语义：

- 不开放任意 import
- 不开放 Studio 内部对象
- 不开放任意模块系统
- 只允许使用允许列表内的虚拟模块与宿主 API

这里的“受限”主要是为了保持蓝图系统的语义边界和构建一致性，而不是为了在 Electron 内再额外引入一层重型安全沙箱。

推荐通过虚拟模块提供注册式 API，例如：

```ts
import { bound, events } from "narraleaf-studio";
```

### 9.4 TS 编译与装载链

编译与装载流程建议如下：

1. 解析源码
2. 校验 import 是否在允许列表中
3. 注入或解析宿主类型
4. 转译并打包为游戏运行时可装载模块
5. 将编译结果纳入当前游戏构建产物
6. 游戏运行时装载该模块并收集注册结果：
   - 事件入口
   - 绑定符号
   - 可调用函数
7. 生成 diagnostics
8. 交给 Runtime 执行

### 9.5 源码与执行产物的关系

`M5` 中源码与运行时产物的关系必须定义清楚：

- 源码是 `TypeScript Blueprint` 的编辑源
- 编译后的模块产物是执行源
- 每次源码变更后重新校验和编译
- 运行时执行的是编译后的游戏模块，而不是额外的运行时沙箱脚本

### 9.6 共享蓝图资产集成

资产系统中新增 `blueprint` 资产类型后，`M5` 必须支持：

- 创建共享 Visual Blueprint
- 创建共享 TypeScript Blueprint
- 搜索共享蓝图
- 分类、标签
- 在实例主蓝图中调用共享蓝图
- 在绑定系统中引用共享声明

### 9.7 共享蓝图调用协议

共享蓝图调用建议优先支持：

- 函数式调用
- 纯声明导出

不建议 `M5` 就做：

- 共享蓝图继承
- 动态 monkey patch
- 实例主蓝图升级为共享蓝图

### 9.8 DevTools 强化

`M5` 的 DevTools 需要从“有事件流”升级到“可读可用”：

- 当前节点高亮
- 调用栈
- 局部变量面板
- 状态快照面板
- 最近副作用日志
- 绑定求值记录
- 错误详情

### 9.9 TS Blueprint 调试

由于运行时执行的是编译后的脚本模块，`M5` 需要建立最小映射关系：

- 源码位置 -> 注册出来的事件 / 符号 / 函数
- 编译诊断 -> 源码位置
- 运行错误 -> blueprint 成员定位

第一阶段不必做完整 source map，但必须能定位到“哪个成员坏了”。

### 9.10 M5 验收标准

完成 `M5` 时必须满足：

- 用户可以创建 TypeScript Blueprint
- 源码可以稳定编译并在游戏运行时中装载执行
- 共享蓝图可在资产系统中创建和被引用
- Visual / TypeScript 两种蓝图共用同一套宿主协议与调试体系
- DevTools 已能阅读执行状态和错误

**仓库当前衔接说明（P6 实施后）**：本地 `BlueprintDocument` 已升至 **schema v3**（`ownerRecords`、多私有修订 + `active`）；TypeScript 蓝图在 **Dev Mode 主进程路径** 经 esbuild 编译并以内联脚本装入 `DevModeBundle`；Workspace 侧独立 `BlueprintBuildService` / 磁盘 `editor/generated/blueprints/` manifest 仍为后续增强。TS 的 `bound.bindSymbol` 与属性绑定求值链尚未合并。

---

## 10. 每个里程碑的完成判定

### 10.1 M1 完成判定

- 核心术语、owner、frontend、binding、runtime 协议全部稳定
- 团队后续不再争论“蓝图到底是什么”

### 10.2 M2 完成判定

- 创建 `Surface` / 控件后，实例主蓝图可自动存在并持久化
- 绑定关系可以保存、重命名追踪、失效提示

### 10.3 M3 完成判定

- Dev Mode 中能真实触发事件、执行蓝图、看到调试流

### 10.4 M4 完成判定

- 用户可以通过 Studio UI 管理和编辑 Visual Blueprint

### 10.5 M5 完成判定

- 用户可以写 TypeScript Blueprint、使用共享蓝图资产，并通过 DevTools 排查问题

---

## 11. 建议延后到 M6+ 的内容

下面这些内容建议不要混入 `M1~M5`：

- 可视化与 TypeScript 蓝图互转
- 断点 / 单步 / 条件断点
- 时光回溯和状态恢复
- 任意动态 UI 树创建
- 共享蓝图继承系统
- 网络请求与外部服务编排
- 协作编辑
- 大图性能专项优化

---

## 12. 最终建议

这五个里程碑里，真正不能跳过的是：

- `M1`
- `M2`
- `M3`

因为它们共同定义了：

- 语义
- 存储
- 运行时

如果这三层没有先稳住，后面的 Visual 编辑器和 TypeScript 前端都会变成不稳定外壳。

因此整个蓝图系统的实施原则应当是：

- **先把逻辑系统做对**
- **再把编辑体验做强**
