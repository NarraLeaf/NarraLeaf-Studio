## 1. 系统定位

NarraLeaf Studio 的蓝图系统是一个 **UI 中心的逻辑平台**，用于控制：

- 控件交互
- 页面逻辑
- 数据绑定
- 页面状态与全局 UI 状态
- 持久化设置
- 音频、动画、导航等运行时行为
- 列表/模板化动态 UI

第一阶段不把它扩展成“全项目唯一脚本系统”，重点只放在 UI 领域。

---

## 2. 核心结论

- 蓝图分为两种前端：
  - `Visual Blueprint`
  - `TypeScript Blueprint`
- 两种蓝图在创建时选择类型，**不支持互相切换**。
- 两种蓝图共享同一套上层运行时契约，但不要求共享同一种底层执行载体：
  - `Visual Blueprint` -> 图结构 / Graph IR
  - `TypeScript Blueprint` -> 受限脚本模块 / Compiled TS Module
- 两种蓝图共享：
  - 同一套宿主 API
  - 同一套调用入口与执行会话模型
  - 同一套调试协议
  - 同一套作用域和状态模型
- 可视化蓝图采用接近 `UE / Unity Visual Scripting` 的模型：
  - 执行流 pin
  - 数据 pin
  - 事件入口
  - 函数/子图
  - 变量/声明成员
- 语义明确分为两层：
  - **事件执行图**：允许副作用
  - **绑定/声明系统**：必须纯计算

---

## 3. 非目标

第一阶段不做下面这些内容：

- 任意 TypeScript 与可视化蓝图的双向转换
- 任意 TS 访问 Studio 内部状态
- 任意运行时创建 UI 树
- 通用网络请求和外部服务系统
- 协作编辑
- 断点、单步、时光回溯

---

## 4. 蓝图资产模型

蓝图不是单一全局文档，而是分为两类来源。

### 4.1 实例主蓝图

每个带逻辑能力的实例自动拥有一个主蓝图：

- `Global Main Blueprint`
- `Surface Main Blueprint`
- `Widget Main Blueprint`

特性：

- 自动生成
- 不可共享
- 不可删除
- 生命周期绑定实例
- 主要承载实例自身事件、局部变量、声明成员

### 4.2 共享蓝图资产

共享蓝图存放在资产系统内。

用途：

- 可复用函数
- 可复用流程
- 纯计算声明
- 对宿主 API 的封装

特性：

- 独立资产
- 可搜索、分类、引用
- 可被实例主蓝图调用

---

## 5. 系统心智模型

蓝图系统必须围绕下面五个概念理解：

- **实例主蓝图**
  - 某个全局、页面、控件自己的私有逻辑容器
- **共享蓝图资产**
  - 可复用逻辑资产
- **事件图**
  - 响应事件并执行副作用
- **声明成员**
  - 供绑定系统引用的纯值定义
- **绑定**
  - 控件属性对字面量或声明成员的引用

---

## 6. 运行语义

### 6.1 事件执行图

事件执行图负责：

- 接收控件事件、生命周期事件、页面事件
- 调用函数图或共享蓝图
- 读写状态
- 触发导航
- 播放音频和动画
- 读写持久化

事件执行图允许副作用。

### 6.2 绑定/声明系统

绑定和声明系统负责：

- 文本绑定
- 可见性绑定
- 启用状态绑定
- 列表数据绑定
- 样式值绑定

绑定和声明系统必须保持纯计算：

- 可读状态
- 可调用纯函数
- 可组合其他声明
- 不可写状态
- 不可导航
- 不可触发副作用

---

## 7. 作用域与状态模型

第一阶段统一支持四层状态域：

- **局部变量**
  - 单次执行、函数作用域、临时值
- **Surface 状态**
  - 页面内状态、表单中间值、tab、局部列表条件
- **全局 UI / App 状态**
  - 全局主题、语言、全局 UI 状态、路由上下文
- **持久化状态**
  - 设置、偏好、缓存、存档片段

规则：

- 绑定只读状态
- 事件图可读写状态
- 持久化必须通过宿主 API
- 所有状态读写要可观测，可进入调试事件流

---

## 8. 绑定模型

控件属性支持两种主输入：

- 字面量
- 绑定引用

绑定引用指向声明成员，而不是直接写复杂表达式。

### 8.1 绑定来源

声明成员可来自：

- 全局主蓝图
- 当前 `Surface` 主蓝图
- 当前控件主蓝图
- 共享蓝图资产

### 8.2 绑定追踪方式

- UI 显示以名称和作用域为主
- 底层持久化使用稳定 id

### 8.3 属性编辑体验

属性行需要支持：

- 切换 `Literal / Bound`
- 搜索声明成员
- 就地创建声明成员
- 展示当前绑定来源
- 跳转到声明
- 解除绑定

---

## 9. TypeScript Blueprint 语义

`TypeScript Blueprint` 不是导出式声明 DSL，也不是普通项目脚本，而是 **受限但真实执行的 TypeScript 脚本模块**。

约束：

- 只能 import 宿主暴露的虚拟模块与运行时 API
- 不可直接 import Studio 内部实现
- 不可直接操作编辑器状态
- 编译后进入游戏运行时模块系统
- 通过注册式 API 向蓝图运行时暴露事件、函数、声明和值绑定

推荐风格：

```ts
import { bound, events } from "narraleaf-studio";

bound.bindSymbol("titleText", (ctx) => {
  return ctx.state.surface.get("title");
});

events.on("submitButton.click", async (ctx) => {
  await ctx.host.navigation.openSurface("result");
});
```

本质上：

- 表面语法是 TypeScript
- 执行模型是真实脚本模块
- 但模块边界、导入源、全局能力和宿主访问全部受限

---

## 10. 统一运行时契约与程序模型

所有蓝图不再强制归一到单一 IR，而是归一到 **统一 Blueprint Runtime Contract**。

### 10.1 统一原则

- `Visual Blueprint` 以图结构表达逻辑
- `TypeScript Blueprint` 以脚本模块表达逻辑
- 两者最终都要注册为同一种可执行程序视图：
  - 事件入口
  - 可调用函数
  - 可绑定符号
  - 调试可观测点

### 10.2 Owner 模型

```ts
type BlueprintOwnerRef =
  | { kind: "globalMain" }
  | { kind: "surfaceMain"; surfaceId: string }
  | { kind: "widgetMain"; surfaceId: string; elementId: string }
  | { kind: "sharedAsset"; assetId: string };
```

### 10.3 Blueprint 前端类型

```ts
type BlueprintFrontendKind = "visual" | "typescript";
```

### 10.4 Blueprint 程序类型

```ts
type BlueprintProgramKind = "graph" | "scriptModule";
```

### 10.5 Blueprint 文档

```ts
type BlueprintDocument = {
  schemaVersion: number;
  blueprints: Record<string, Blueprint>;
  meta?: Record<string, unknown>;
};
```

### 10.6 Blueprint 实体

```ts
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

### 10.7 Blueprint 程序联合

```ts
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

### 10.8 成员体系

```ts
type BlueprintMemberIndex = {
  variables: Record<string, BlueprintVariable>;
  declarations: Record<string, BlueprintDeclaration>;
  functions: Record<string, BlueprintFunctionSignature>;
};
```

说明：

- `Visual Blueprint` 的 `members` 可直接来自图编辑结构
- `TypeScript Blueprint` 的 `members` 可来自静态分析、运行时注册结果或缓存索引

### 10.9 图分类

- `eventGraph`
- `functionGraph`
- `macroGraph`（后续）

### 10.10 脚本模块源

```ts
type TypeScriptBlueprintSource = {
  language: "typescript";
  code: string;
  compiledModuleId?: string;
  outputPath?: string;
  diagnostics?: BlueprintDiagnostic[];
};
```

### 10.11 节点分类

- **纯节点**
  - 只产出值
  - 无副作用
- **执行节点**
  - 带执行 pin
  - 可写状态
  - 可触发宿主行为

---

## 11. 存储模型

### 11.1 本地实例蓝图

实例主蓝图继续与 UI 文档强关联，保留在：

- `editor/ui/uigraphs.json`

但其 schema 要从“简单行为图文档”升级为“本地 UI Blueprint 文档”。

### 11.2 共享蓝图资产

共享蓝图进入资产系统，以独立文件存在。

推荐目标布局：

```text
editor/
  ui/
    uidoc.json
    uigraphs.json

assets/
  blueprints/
    xxx.nlbp.json
    yyy.nltsbp.json
```

规则：

- 本地实例蓝图不与共享资产混存
- 共享蓝图由资产管理器创建与管理

---

## 12. 宿主 API 分层

第一阶段宿主 API 重点暴露六大类：

- **导航与层管理**
  - 打开/关闭 `Surface`
  - layer 管理
  - 通知、弹窗
- **控件控制**
  - 可见性、禁用、焦点、选中
  - 列表数据源
- **状态容器**
  - 读写页面状态
  - 读写全局状态
- **持久化**
  - 读写设置、偏好、缓存
- **音频 / 动画 / 媒体**
  - 播放、停止、切换
- **调试桥**
  - 日志、错误、变量快照、当前节点

第一阶段不开放：

- 任意网络请求
- 任意文件系统访问
- Studio 编辑态状态操作

---

## 13. 编辑器结构

### 13.1 总体形态

采用混合模式：

- 属性面板负责入口、概览、绑定、快速创建
- 独立 Tab 负责完整编辑

### 13.2 Visual Blueprint 编辑器

推荐技术：

- `React Flow` 作为图编辑层

结构：

- 左侧：成员与作用域面板
- 中间：画布
- 右侧：节点检查器 / 绑定检查器 / 调试状态
- 底部或侧边：日志和执行追踪

### 13.3 TypeScript Blueprint 编辑器

推荐技术：

- `Monaco`

要求：

- 受限 API 提示
- 上下文类型展示
- 编译错误展示
- 成员跳转
- 可选编译结果 / 装载结果预览

---

## 14. 调试模型

第一阶段至少支持：

- 当前执行位置
- 当前调用栈
- 当前局部变量
- 当前作用域状态快照
- 最近副作用日志

统一调试事件：

- `execution.started`
- `execution.finished`
- `node.enter`
- `node.exit`
- `state.read`
- `state.write`
- `binding.evaluated`
- `function.call`
- `function.return`
- `execution.error`

推荐统一入口：

- `Blueprint DevTools`

---

## 15. Dev Mode 角色

`Dev Mode` 是蓝图系统的主要真实运行与调试入口。

职责：

- 接收 `uidoc + 本地蓝图 + 共享蓝图资产`
- 初始化 Blueprint Runtime
- 用真实宿主 API 运行蓝图
- 回传调试事件

推荐执行链：

1. 主进程打包 UI 文档和蓝图
2. Dev Window 收到 bundle
3. Runtime 初始化
4. UI 事件触发蓝图入口
5. 根据蓝图类型执行图程序或脚本模块
6. 通过 Host Adapter 落地副作用
7. 通过 DevTools Bridge 上报调试事件

---

## 16. 当前仓库基线映射

当前仓库已有基础：

- `uidoc.json`
- `uigraphs.json`
- `UIBehaviorBinding(kind: "graph")`
- `UIGraphService`
- `GraphExecutor`
- `BehaviorNodeRegistry`
- `UIHostAdapter`
- `DevModeBundle` 中的 `uigraphs`
- 属性面板中的 `Blueprint` 占位

当前缺口：

- UI 事件未真正进入图执行器
- 图运行时未接到 Dev Mode 实际执行链
- 绑定/声明系统缺失
- 调试协议缺失
- 蓝图编辑器缺失
- `uigraphs` schema 仍偏旧

---

## 17. 实施优先级

正确顺序不是先做大编辑器，而是：

1. 统一运行时契约与程序模型
2. 实例主蓝图生命周期与存储
3. 运行时闭环
4. 绑定系统
5. Dev Mode 调试基础
6. Visual Blueprint 编辑器
7. TypeScript Blueprint 编辑器
8. 共享蓝图资产

---

## 18. 最终设计原则

蓝图系统必须始终遵守下面这些原则：

- 编辑方式可以有两种，上层语义与宿主协议只能有一种
- 绑定系统必须纯，副作用必须显式
- 实例逻辑与共享逻辑必须分层
- 运行时能力统一通过宿主 API 暴露
- Dev Mode 是真实运行和调试主场
- 可视化编辑器和 TS 编辑器只是前端，运行时契约与执行后端才是系统核心
