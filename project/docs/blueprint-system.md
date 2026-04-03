# NarraLeaf Studio - Blueprint System（蓝图系统）落地指南

本文档定义 NarraLeaf Studio 下一阶段的 **UI 中心蓝图系统** 的推荐方案、语义边界、存储结构、运行时契约、编辑器集成方式、调试能力与分期落地路线。

本文档不是泛泛而谈的“蓝图概念介绍”，而是面向实际实现的工程落地文档。目标是在尽量复用当前 `UI Editor` / `Dev Mode` 基础设施的前提下，把蓝图系统升级为一套真正可编程、可调试、可扩展、可资产化的 UI 逻辑平台。

---

## 1. 结论先行

基于当前仓库现状、已有 `visual-editor` / `dev-mode` 设计、以及对成熟可视化脚本方案的对比，推荐采用下面这条主线：

- **蓝图系统第一阶段聚焦 UI 领域**，不把剧情、任务、全项目逻辑一起卷入。
- **蓝图分为两类资产前端**：
  - `Visual Blueprint`
  - `TypeScript Blueprint`
- 这两类蓝图 **创建时即选择类型**，**不支持互相切换**。
- 两类蓝图共享同一套上层运行时契约，但不要求共享同一种底层执行载体：
  - `Visual Blueprint` -> 图结构 / Graph IR
  - `TypeScript Blueprint` -> 受限脚本模块 / Compiled TS Module
- 两类蓝图共享：
  - 同一套宿主 API
  - 同一套执行会话与调用入口模型
  - 同一套调试协议
  - 同一套作用域与状态模型
- 可视化蓝图采用 **接近 UE / Unity Visual Scripting 的图模型**：
  - 显式执行流 pin
  - 数据 pin
  - 事件入口
  - 函数/子图
  - 变量/声明成员
- 语义层明确拆成两类：
  - **事件执行图**：允许副作用、状态写入、导航、动画、音频、持久化
  - **绑定/声明系统**：必须保持纯计算，负责把控件属性绑定到声明值
- 每个“带蓝图的实例”都自动拥有一个 **实例主蓝图**，它与实例生命周期强绑定且不可共享：
  - 全局实例主蓝图
  - `Surface` 实例主蓝图
  - 控件实例主蓝图
- 共享蓝图作为 **独立资产** 进入资产系统，用于复用函数、流程、声明能力。
- 编辑器 UI 采用 **混合模式**：
  - 属性面板负责入口、概览、绑定和快速创建
  - 真正的蓝图编辑在独立 Tab 中完成
- 编辑器底层优先推荐 **React Flow + Graph IR Runtime + TS 编译进游戏的脚本模块运行时 + Monaco（TypeScript Blueprint）** 的组合，而不是把语义绑死在某个第三方节点引擎上。

---

## 2. 设计范围

### 2.1 本期目标

本期蓝图系统用于控制 UI 控件的实际逻辑，包括但不限于：

- 控件交互行为
- 页面导航与层管理
- 页面状态与全局 UI 状态
- 数据绑定与声明式属性计算
- 持久化数据读写
- 音频、动画、通知等运行时副作用
- 列表/模板实例化与条件渲染
- 可观测的运行时调试

### 2.2 明确不在本期目标内

下面这些内容不应混进第一阶段核心设计：

- 把蓝图直接扩展成全项目唯一脚本语言
- 允许任意 TypeScript 文件与可视化蓝图自由往返
- 允许 `TypeScript Blueprint` 任意访问 Studio 内部状态
- 在第一版就支持任意运行时 UI 树创建
- 在第一版就支持外部服务调用、通用网络请求、复杂协作编辑

### 2.3 第一版的动态 UI 边界

第一版不是完全静态 UI，也不是完全自由的运行时 UI 编排。推荐边界是：

- 支持 **模板化动态列表**
- 支持 **条件块**
- 支持 **有限的模板实例化**
- 不支持“任意运行时创建任意 widget tree”的全自由模式

这条边界很重要，因为它既能满足真实 UI 业务，又不会在第一版把系统复杂度推到难以落地的程度。

---

## 3. 当前仓库基线

在开始新设计前，必须明确当前仓库已经有哪些基础，不要重复造轮子。

### 3.1 当前已经存在的骨架

当前 UI 体系已经具备下面这些蓝图相关基础：

- `editor/ui/uidoc.json`
  - 保存 `UIDocument`
- `editor/ui/uigraphs.json`
  - 保存 `UIGraphDocument`
- `UIElement.behavior`
  - 已支持 `events[eventName] -> UIBehaviorBinding`
- `UIBehaviorBinding`
  - 事件入口为 `kind: "blueprintEvent"`（`blueprintId` + `eventId`），图体在 `Blueprint.program.graphs.events`
- `UIGraphService`
  - 已有图文档加载、保存、auto-save、CRUD
- `GraphExecutor`
  - 已有最小图执行器
- `BehaviorNodeRegistry`
  - 已有最小节点注册机制
- `UIHostAdapter`
  - 已抽象宿主行为注入边界
- `DevModeBundle`
  - 已把 `uidoc` 和 `uigraphs` 一并推给 Dev Mode
- 属性面板
  - 已有 `Blueprint` 占位区块

### 3.2 当前还没有接通的闭环

虽然骨架存在，但当前闭环并未真正打通：

- UI 事件还没有真正派发到图执行器
- `GraphExecutor` 在工程里几乎还没有进入运行链路
- 编辑器预览里的 `hostAdapter.effects.runEffect` 仍是 no-op
- Dev Mode 虽然拿到了 `uigraphs`，但并未真正消费图逻辑
- 蓝图编辑器本体仍不存在
- 绑定系统、声明系统、变量系统、调试协议都还没有成型

### 3.3 当前系统对新蓝图方案的启示

这说明最正确的方向不是另起炉灶，而是：

- **保留现有 UI 文档体系**
- **升级现有图文档为真正的 Blueprint 文档**
- **把现有 `Behavior Graph` 演化为更成熟的 Blueprint Runtime**
- **继续坚持 `hostAdapter` 这类宿主边界**
- **在 Dev Mode 上补完“真实运行 + 调试”**

---

## 4. 为什么不做“可视化 / TypeScript 双向切换”

你已经明确给出一个非常重要的产品取舍：

- 用户创建蓝图时就选择：
  - 可视化蓝图
  - TypeScript 蓝图
- 两者 **不要求互相切换**

这个决定非常正确，原因如下。

### 4.1 语义层面的好处

如果强行做双向切换，系统必须回答下面这些极难问题：

- 任意 TS 代码如何还原成图？
- 注释、格式化、局部抽象、手写 helper 如何映射回节点？
- 图上的节点稳定 id 如何与文本编辑保持一致？
- 一旦用户在代码模式写了超出可视化模型表达能力的逻辑，图模式如何展示？

这类问题不是“实现麻烦”而已，而是会直接污染产品语义。

而“创建时选一种蓝图前端”则完全不同：

- 用户一开始就知道自己在用哪种方式
- 不会产生“为什么切回图后变形了”的预期落差
- 可以把复杂度集中在统一的宿主协议、状态模型和调试体系，而不是图文双向同步

### 4.2 心智模型层面的影响

这种方案最大的好处是 **预期稳定**，但也会带来一个新问题：

- 用户会把它理解成两套语言吗？

如果处理不好，就会出现：

- 视觉蓝图是一套能力
- TS 蓝图是另一套能力
- 两边节点/函数/API 不一致
- 调试表现也不同

这会导致团队认知分裂。

### 4.3 推荐的化解方式

为了避免这种分裂，必须坚持下面四条：

- 两种蓝图共享同一套宿主 API
- 两种蓝图共享同一套运行时契约
- 两种蓝图共享同一套调试协议
- 两种蓝图共享同一套作用域和状态模型

也就是说：

- **编辑器不同**
- **语法表面不同**
- **底层能力树不能不同**

推荐把它们定义成：

- `Visual Blueprint`：图形化前端
- `TypeScript Blueprint`：受限但真实执行的脚本前端

而不是：

- “两种不同的逻辑系统”

---

## 5. 蓝图系统的产品心智模型

推荐把蓝图系统讲清楚时，始终围绕下面五个概念：

### 5.1 实例主蓝图

每个有逻辑能力的实例自动拥有一个“主蓝图”，不可共享、不可挪作通用资产：

- `Global Main Blueprint`
- `Surface Main Blueprint`
- `Widget Main Blueprint`

实例主蓝图的职责：

- 容纳实例自身的事件入口
- 容纳实例自身的局部变量
- 容纳与当前实例生命周期强耦合的逻辑
- 容纳当前实例的声明成员

### 5.2 共享蓝图资产

共享蓝图是进入资产系统的可复用能力：

- 共享函数库
- 共享流程
- 共享纯计算声明
- 共享宿主 API 封装

它们应该主要存放在资产管理器中，而不是和某个特定 `Surface` 强绑定。

### 5.3 事件图

事件图是执行型图，用于：

- 响应控件事件
- 调用共享蓝图
- 写状态
- 触发导航
- 播放动画、音频
- 读写持久化

### 5.4 声明成员

声明成员是绑定系统的基础，不是动作图。

它们可以是：

- 变量
- 常量
- 纯计算值
- 派生结果
- 供属性绑定引用的命名声明

### 5.5 绑定

控件属性不是只能填写字面量。每个可绑定属性应支持三类输入：

- 字面量
- 引用声明成员
- 未来可扩展的表达式/模板值

当前更推荐的主路径是：

- 属性侧通过选择器搜索或新建声明成员
- 底层通过稳定 id 绑定
- 展示层通过名称帮助用户理解

这是一个 **symbol-first binding** 模型，而不是单纯的文本表达式模型。

---

## 6. 推荐的整体技术路线

### 6.1 编辑器框架推荐

综合自由度、长期维护性、与当前 React/Electron/TypeScript 栈的适配度，推荐：

- **React Flow** 作为可视化编辑器画布层
- **Monaco** 作为 `TypeScript Blueprint` 编辑器
- **自研 Graph IR**
- **自研 TS 编译与游戏内模块装载链**
- **自研 Blueprint Runtime**
- **自研节点/宿主 API 注册系统**

### 6.2 为什么优先推荐 React Flow

React Flow 更适合当前项目，原因有四点：

- 它只是图编辑交互层，不强绑定你的运行语义
- 它和现有 React 组件体系天然一致，界面样式更容易和 Studio 统一
- 自定义节点、选择器、popup、浮层、hover 面板都更容易融入现有 UI 组件库
- 相比把语义塞进框架，React Flow 更适合作为“壳”

这与你提到的高自由度要求是匹配的。

### 6.3 为什么不优先用 Rete.js

Rete 的优势在于自带较强的图执行范式，但它的代价是：

- 更容易让领域模型被框架抽象牵着走
- 长期要不断与其编辑模型做对齐
- 视觉和交互层定制虽可做，但自由度管理成本更高

如果你的目标是做“产品级 Studio”，而不是只做一个“能跑的节点图 demo”，那么更建议把运行语义掌握在自己手里。

### 6.4 为什么不建议自研整套图编辑器

除非后续发现标准图编辑交互完全不够用，否则不建议第一版自研图编辑内核。原因很现实：

- 缩放、平移、连线、框选、吸附、节点分组、键盘操作都很重
- 大图性能和交互细节调优会吞噬大量时间
- 这部分投入不会直接提升蓝图语义价值

真正应该自研的，是：

- Graph IR
- TS 编译链、虚拟模块与游戏内装载链
- 宿主 API
- 语义校验
- 调试协议
- 绑定系统
- `TypeScript Blueprint` 转译与执行链

---

## 7. 统一运行时契约与程序模型设计

`Visual Blueprint` 和 `TypeScript Blueprint` 不再强制归一到同一个 IR，而是归一到同一套 **Blueprint Runtime Contract**。

### 7.1 为什么“统一运行时契约”才是唯一真相

如果没有统一运行时契约，就会出现下面的结构性问题：

- 可视化蓝图执行器一套
- TS 蓝图执行器一套
- 调试事件一套
- 宿主 API 绑定一套
- 变量模型一套

这会让系统不可维护。

因此推荐：

- `Visual Blueprint` -> 归一化为 Graph IR / Graph Program
- `TypeScript Blueprint` -> 编译为游戏内脚本模块
- Dev Mode / Player / 编辑器预览 -> 都通过同一套 Runtime Contract 调用
- 两种蓝图最终都要暴露同一种上层程序视图：
  - 事件入口
  - 可调用函数
  - 可绑定符号
  - 调试可观测点

### 7.2 程序模型的最小结构建议

可以把现有 `UIGraphDocument` 演化为更完整的 Blueprint 文档。概念上建议至少包含：

```ts
type BlueprintOwnerRef =
  | { kind: "globalMain" }
  | { kind: "surfaceMain"; surfaceId: string }
  | { kind: "widgetMain"; surfaceId: string; elementId: string }
  | { kind: "sharedAsset"; assetId: string };

type BlueprintFrontendKind = "visual" | "typescript";

type BlueprintProgramKind = "graph" | "scriptModule";

type BlueprintDocument = {
  schemaVersion: number;
  blueprints: Record<string, Blueprint>;
  meta?: Record<string, unknown>;
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
```

其中：

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

### 7.3 Blueprint 的成员体系

一个成熟蓝图资产不应只有一张“主图”，而应包含成员：

- 事件入口
- 函数/子图
- 变量
- 常量
- 声明成员
- 共享调用入口

推荐成员结构如下：

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

### 7.4 图的分类

本项目推荐图按用途分型，而不是全部混在一张图中：

- `eventGraph`
- `functionGraph`
- `macroGraph`（后续）

第一阶段不建议额外发明“所有东西都用一张万能图”。

### 7.5 TypeScript Blueprint 的程序形态

推荐 `TypeScript Blueprint` 使用虚拟模块导入和注册式 API，而不是导出式声明对象：

```ts
import { bound, events } from "narraleaf-studio";

bound.bindSymbol("titleText", (ctx) => {
  return ctx.state.surface.get("title");
});

events.on("submitButton.click", async (ctx) => {
  await ctx.host.navigation.openSurface("result");
});
```

这意味着：

- TS Blueprint 是真实脚本模块
- 它参与游戏构建并编译进运行时产物
- 它通过运行时注册事件、函数和绑定符号
- 它不需要编译成图节点才能运行

### 7.6 节点语义分类

节点应从语义上分成两大类：

- **纯节点**
  - 只读输入
  - 只产出值
  - 不写状态
  - 不触发副作用
- **执行节点**
  - 带执行 pin
  - 允许写状态
  - 允许导航、动画、持久化、宿主调用

这条分类将直接决定：

- 绑定系统是否可预测
- 调试器是否易理解
- 可视化图执行是否易验证

---

## 8. 作用域与状态模型

蓝图第一版至少要覆盖四个状态域。

### 8.1 蓝图局部变量

用于：

- 单次逻辑流程临时值
- 函数局部变量
- 节点间中间状态

它们不应自动持久化。

### 8.2 Surface 状态

用于：

- 当前页面的筛选条件
- 表单中间值
- 当前 tab
- 弹层显隐
- 列表查询结果

这是 UI 业务里最常用的一层。

### 8.3 全局 UI / App 状态

用于：

- 当前主题
- 当前语言
- 当前用户会话 UI 状态
- 全局通知、全局路由上下文

### 8.4 持久化状态

用于：

- 设置
- 偏好
- 本地缓存
- 存档片段

推荐通过统一宿主 API 暴露，而不是允许节点直接碰底层存储实现。

### 8.5 推荐的数据访问原则

- 绑定系统只读状态
- 事件图可读可写状态
- 持久化能力只通过宿主 API 访问
- 所有状态访问都走可观测路径，便于调试器记录

---

## 9. 绑定与声明系统

这是本方案里最需要谨慎设计的部分。

### 9.1 你的方案：属性引用声明节点

你希望：

- 属性内既能写字面量
- 也能链接声明节点
- 声明节点可能来自：
  - 全局主蓝图
  - 当前 `Surface` 主蓝图
  - 当前控件主蓝图
- 选择时通过 Studio 选择器按名字搜索
- 底层通过 id 跟踪

这是一个合理方案，但必须配套补齐心智模型。

### 9.2 这个方案的优点

- 复用性强
- 引用关系清晰
- 重命名时更容易做安全重构
- 不会把复杂表达式散落在每个属性输入框里
- 可以形成“声明成员面板”，提高大型 UI 可维护性

### 9.3 这个方案的风险

如果没有辅助设计，用户会同时面对四层概念：

- 属性值
- 声明节点
- 作用域
- 选择器结果

一旦 UI 表达不好，用户会不明白：

- 为什么这里不能直接写表达式
- 为什么绑定的是名字但底层又是 id
- 当前属性到底绑定到了哪里
- 重命名后为什么显示变化但逻辑没坏

### 9.4 推荐的化解方式

建议采用下面这套表达方式：

- 属性编辑框有三种状态：
  - `Literal`
  - `Bound`
  - `Mixed/Override`（后续可扩）
- 当用户选择 `Bound` 时：
  - 先弹选择器
  - 可搜索已有声明成员
  - 也可直接新建声明成员
- 绑定完成后，在属性行内始终显示：
  - 绑定来源作用域
  - 声明名称
  - 跳转按钮
  - 解除绑定按钮

### 9.5 推荐保留“纯度边界”

绑定/声明系统必须保持纯计算：

- 可以读取状态
- 可以调用纯函数
- 可以组合其他声明
- 不可以写状态
- 不可以导航
- 不可以触发音频/动画/持久化

所有副作用都必须回到事件执行图。

这条规则必须写进系统设计，否则绑定系统会迅速变成隐式脚本系统。

---

## 10. 实例主蓝图 + 共享蓝图资产

你提出的模型是：

- 全局、Surface、控件实例都自动拥有自己的主蓝图
- 主蓝图不可共享
- 共享蓝图主要放在资产管理器内

这是一个好的方向，推荐采纳，但需要做少量收束。

### 10.1 为什么这个模型是对的

它天然区分了两类逻辑：

- **实例私有逻辑**
  - 跟某个页面或控件生命周期耦合
  - 不适合被其他地方复用
- **共享逻辑**
  - 有明确抽象边界
  - 可以资产化
  - 可以搜索、分类、重命名、版本化

### 10.2 推荐的限制

建议第一阶段不要允许实例主蓝图被“提升为共享资产”或反向降级，这类重构等后期再做。

第一阶段推荐严格如下：

- 实例主蓝图自动生成
- 实例主蓝图不可删除
- 实例主蓝图不可共享
- 共享蓝图必须通过资产管理器新建

### 10.3 推荐的调用方式

共享蓝图在第一阶段优先支持两类复用：

- 作为 **函数式调用目标**
- 作为 **纯声明/计算能力提供者**

不建议第一阶段就做“共享蓝图继承实例主蓝图”的复杂模型。

---

## 11. TypeScript Blueprint 语义

### 11.1 定位

`TypeScript Blueprint` 不是普通 TS 文件，而是：

- 参与游戏构建的真实脚本模块
- 只能 import 宿主暴露的虚拟模块与运行时 API
- 编译后随游戏运行时一起装载执行

### 11.2 禁止的方向

第一阶段必须明确禁止：

- 直接 import Studio 内部状态
- 任意访问 Renderer / Main 进程实现细节
- 把 TS Blueprint 当成普通扩展脚本

否则它会迅速失控。

### 11.3 推荐的 TS Blueprint 风格

推荐使用注册式 API，而不是导出式声明对象：

```ts
import { bound, events } from "narraleaf-studio";

bound.bindSymbol("title", (ctx) => {
  return ctx.state.surface.get("title");
});

events.on("button.click", async (ctx) => {
  await ctx.host.navigation.openSurface("result");
});
```

这能带来三件事：

- 更接近游戏脚本的心智模型
- 允许保留真实模块执行语义
- 仍然能通过宿主 API 与虚拟模块实现边界控制

### 11.4 为什么不建议自由 TS

如果允许自由 TS，最终一定会遭遇：

- 宿主 API 无法稳定收敛
- 模块边界与依赖边界失控
- 调试协议映射困难
- 共享资产引用和作用域解析失控

因此第一阶段必须坚持：

- **看起来是 TS**
- **执行起来是真实脚本模块**
- **但模块来源、可导入包和宿主访问全部受限**

---

## 12. 存储模型

你选择的是混合存储，这也是推荐方案。

### 12.1 推荐原则

- **实例主蓝图**：继续和 UI 文档强耦合存储
- **共享蓝图资产**：进入资产系统，单独文件化

### 12.2 本地实例蓝图的推荐落地方式

当前仓库已有 `editor/ui/uigraphs.json`。第一阶段最务实的方案是：

- 保留 `uigraphs.json` 路径
- 但升级其 schema，使其从“简单行为图文档”演化成“本地 UI Blueprint 文档”

这样做的好处：

- `DevModeManager` 已经会监听并打包它
- `UIGraphService` 已经存在，可以迁移升级
- 现有 `visual-editor` 文档里也已有认知基础

### 12.3 共享蓝图资产的推荐落地方式

共享蓝图不应继续塞进 `uigraphs.json`。

推荐：

- 在资产系统中新增 `blueprint` 资产类型
- 每个共享蓝图一个独立文件
- 支持：
  - 名称
  - 分类
  - 标签
  - frontend kind
  - 图程序或脚本模块内容
  - TS 源码（若是 TS Blueprint）
  - 编译产物索引或构建元数据（若是 TS Blueprint）

### 12.4 推荐的文件布局

可以参考下面的目标布局：

```text
editor/
  ui/
    uidoc.json
    uigraphs.json           # 本地实例主蓝图文档（升级后的 schema）

assets/
  blueprints/
    xxx.nlbp.json           # 共享 Visual Blueprint
    yyy.nltsbp.json         # 共享 TypeScript Blueprint
```

扩展名不必在第一版就最终锁死，但“实例本地文档”和“共享资产文件”必须分开。

---

## 13. 宿主 API 分层

第一版必须优先暴露的宿主 API 已基本明确。

### 13.1 导航与层管理

- 打开 `Surface`
- 关闭当前层
- 推入/弹出 layer
- 打开弹窗、通知
- 切换视图

### 13.2 控件控制

- 读写控件属性
- 设置可见性/禁用
- 设置选中/焦点
- 操作列表数据源

### 13.3 状态容器

- 读页面状态
- 写页面状态
- 读全局状态
- 写全局状态

### 13.4 持久化

- 读设置
- 写设置
- 读偏好
- 写偏好

### 13.5 音频/动画/媒体

- 播放音频
- 停止音频
- 播放动画
- 切换动效

### 13.6 调试桥

- 记录日志
- 上报运行错误
- 发送变量快照
- 发送当前节点高亮事件

### 13.7 不推荐暴露的能力

第一阶段暂不建议把下面这些作为核心 API：

- 任意网络请求
- 任意外部服务调用
- 任意文件系统访问
- 直接碰 Studio 编辑态状态

---

## 14. 编辑器交互设计

### 14.1 总体形态

采用你确认过的混合模式：

- 属性面板只做：
  - 入口
  - 绑定
  - 蓝图概览
  - 快速创建
- 完整编辑在独立 Tab 中进行

### 14.2 属性面板职责

在现有 `PropertiesPanel` 基础上，蓝图区块建议升级为：

- 当前实例主蓝图摘要
- 绑定概况
- 最近事件入口
- “打开蓝图编辑器”按钮
- “创建 / 搜索声明成员”入口

不要在属性面板里直接塞完整图编辑器。

### 14.3 独立蓝图编辑 Tab 结构

推荐的 Tab 布局：

- 左侧：成员与作用域面板
  - 事件
  - 函数
  - 变量
  - 声明成员
  - 引用的共享蓝图
- 中间：图编辑画布
- 右侧：节点检查器 / 绑定检查器 / 调试状态
- 底部或侧边：日志与执行追踪

### 14.4 Visual Blueprint 编辑体验要点

- 节点分类清晰
- 搜索插入统一
- 作用域显式可见
- 绑定声明可跳转
- 节点调试高亮要稳定

### 14.5 TypeScript Blueprint 编辑体验要点

- Monaco 提供受限 API 自动提示
- 显示可用上下文类型
- 编译错误就地展示
- 支持跳转到对应成员
- 必要时提供“编译结果 IR 预览”用于调试

---

## 15. 调试与 DevTools

你要求第一版就具备：

- 当前执行位置
- 变量查看
- 调用栈/子图栈

这意味着调试不应是后补插件，而要从运行时一开始就设计进去。

### 15.1 调试事件协议

推荐执行器统一发出以下事件：

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

### 15.2 调试视图

推荐提供一个统一 `Blueprint DevTools` 入口，负责：

- 当前节点高亮
- 当前调用栈
- 当前局部变量
- 当前作用域状态快照
- 最近副作用日志

### 15.3 编辑器预览与 Dev Mode 的关系

第一阶段可以分层：

- 编辑器内预览
  - 可选择最小预览
  - 不要求一开始就完全真实
- Dev Mode
  - 必须是主要调试入口
  - 必须使用真实宿主 API

但无论在哪个入口里，调试协议都应统一。

---

## 16. Dev Mode 集成

当前 `DevModeManager` 已经会打包 `uigraphs.json`，这是极好的起点。

### 16.1 第一阶段必须补完的点

- Dev Mode 真正加载 Blueprint 文档
- Dev Mode 运行时注册蓝图执行器
- UI 事件触发真正进入蓝图
- 调试事件回传到 Studio

### 16.2 推荐的运行路径

推荐路径如下：

1. 主进程打包：
   - `uidoc`
   - 本地实例蓝图文档
   - 共享蓝图资产索引/内容
2. Dev Window 接收 bundle
3. Runtime 建立：
   - UI 树
   - Blueprint Registry
   - Host Adapter
   - Debug Bridge
4. UI 事件发生
5. 定位实例主蓝图事件入口
6. 执行 IR
7. 副作用通过 Host Adapter 落地
8. 调试事件通过 DevTools Bridge 上报

### 16.3 为什么 Dev Mode 必须是主调试场所

因为很多能力只有在真实运行宿主里才有意义：

- 导航
- 层切换
- 音频
- 持久化
- 真实状态容器

把这些全都模拟在编辑器内，性价比并不高。

---

## 17. 与当前代码结构的映射关系

下面是推荐的改造方向。

### 17.1 共享类型层

重点文件：

- `src/shared/types/blueprint/`（M1 已落地：**canonical 契约层**；入口 `index.ts`）
- `src/shared/types/ui-editor/document.ts`
- `src/shared/types/ui-editor/graph.ts`
- `src/shared/types/devMode.ts`
- `src/renderer/lib/ui-editor/runtime/types.ts`（`UIHostAdapter` 与 `BlueprintHostApiContract` 的契约版本字段）

建议（与当前实现对齐）：

- **术语与终态模型以 `blueprint/*` 为准**；`ui-editor/*` 与 `devMode` 承载与 Studio / Dev Mode 的集成形状。
- 在 `document.ts` 中事件绑定使用 `blueprintEvent`（`blueprintId + eventId`）；事件图 IR 存于 `Blueprint.program.graphs.events[eventId].graph`，**不**再以顶层 `UIGraphDocument.graphs` 为 Blueprint 事件真相。
- 在 `graph.ts` 的 `UIGraphDocument` 上 **`blueprintDocument` 必填**（`uigraphs.json` schema v2）；顶层 `graphs` 仅保留与旧行为图执行器的兼容占位。
- 在 `devMode.ts` 的 `DevModeBundle.ui` 中显式携带 `localBlueprints`（与 `uigraphs.blueprintDocument` 一致）。**M3-min 起**：Dev Mode renderer 内可执行最小 `blueprintEvent` 链（`surface` 状态 + 绑定求值）；完整 Host API 与跨窗口调试仍属后续里程碑。

### 17.2 Service 层

重点文件：

- `src/renderer/lib/workspace/services/ui-editor/UIGraphService.ts`

建议：

- 逐步升级为 `UIBlueprintService`
- 至少补上：
  - schema migration
  - 成员级 CRUD
  - 绑定/声明操作
  - 本地实例蓝图访问 API

### 17.3 属性面板集成

重点文件：

- `src/renderer/apps/workspace/modules/properties/PropertiesPanel.tsx`
- 各 widget inspector

建议：

- 把现在的 `BlueprintPlaceholder` 升级为真实入口
- 支持：
  - 打开蓝图 Tab
  - 属性绑定
  - 创建 / 搜索声明成员

### 17.4 UI 编辑器集成

重点文件：

- `src/renderer/apps/workspace/modules/ui-editor/editors/UISurfaceEditorTab.tsx`

建议：

- 增加“打开当前控件 / Surface 主蓝图”的入口
- 与选择状态联动
- 支持从当前上下文直接跳转到蓝图编辑器

### 17.5 运行时与宿主适配

重点文件：

- `src/renderer/lib/ui-editor/runtime/types.ts`
- `src/renderer/lib/ui-editor/behavior-graph/*`
- `src/renderer/lib/workspace/services/ui-editor/UIRuntimeBridgeService.tsx`

建议：

- 把最小 `Behavior Graph` 扩展为 Blueprint Runtime
- 明确事件派发、状态读写、声明求值、调试协议

### 17.6 Dev Mode

重点文件：

- `src/main/app/application/managers/devMode/DevModeManager.ts`
- `src/renderer/apps/dev-mode/components/DevModeContent.tsx`
- `src/renderer/apps/dev-mode/components/DevModeSurfaceRenderer.tsx`

建议：

- bundle 中增加共享蓝图资产
- Dev Window 真正消费蓝图
- 注入真实 `hostAdapter`
- 建立调试桥

---

## 18. 分期实施路线

下面是一条更适合当前仓库状态的落地路线。

### Phase 0：冻结核心语义

先确认下面这些不再反复摇摆：

- UI 中心范围
- Visual / TypeScript 蓝图不互转
- 同一运行时契约
- 实例主蓝图 + 共享蓝图资产
- 事件图与纯绑定系统分离

这一步完成后，文档和类型定义才能稳定。

### Phase 1：升级文档与类型

目标：

- 定义 Blueprint 文档结构
- 定义 owner 模型
- 定义成员模型
- 定义绑定模型
- 定义宿主 API 分类

产出：

- 新增或升级 shared types
- 明确 schema version 与迁移策略

### Phase 2：升级本地蓝图存储

目标：

- 把 `uigraphs.json` 升级为本地实例蓝图文档
- 为实例主蓝图自动生成与维护生命周期
- 建立 owner 到 blueprint 的索引

产出：

- `UIGraphService` 升级
- migration 实现

### Phase 3：先打通运行时闭环

目标：

- UI 事件 -> Blueprint Runtime
- 状态读写
- 声明求值
- 副作用落地
- Dev Mode 真实执行

产出：

- 最小可运行蓝图闭环
- 调试事件基础版

注意：这一阶段的优先级应高于先做炫目的图编辑器。

### Phase 4：属性面板接入

目标：

- 绑定 UI
- 声明选择器
- 蓝图入口
- 主蓝图跳转

产出：

- 让用户在不进入完整编辑器的情况下先完成基本绑定

### Phase 5：Visual Blueprint 编辑器

目标：

- React Flow 画布
- 节点插入
- 连线校验
- 成员管理
- 事件图 / 函数图

产出：

- 第一个真正可用的可视化蓝图编辑器

### Phase 6：TypeScript Blueprint 编辑器

目标：

- Monaco
- 受限 API 提示
- TS 编译进游戏产物
- 错误定位

产出：

- 第二种蓝图前端

### Phase 7：调试增强

目标：

- 当前节点高亮
- 局部变量查看
- 调用栈
- 声明值查看

产出：

- `Blueprint DevTools`

### Phase 8：共享蓝图资产系统

目标：

- 资产管理器中的共享蓝图
- 搜索
- 分类
- 调用引用

产出：

- 真正的可复用能力体系

---

## 19. 推荐的 MVP 顺序

如果必须控制风险，最推荐的 MVP 顺序不是“先做完整大而全编辑器”，而是：

1. 定义统一运行时契约与程序模型
2. 实例主蓝图生命周期与存储
3. 运行时事件闭环
4. 绑定系统
5. Dev Mode 调试基础
6. Visual Blueprint 编辑器
7. TypeScript Blueprint 编辑器
8. 共享蓝图资产

这是因为：

- 没有运行时闭环，编辑器只是空壳
- 没有绑定系统，UI 蓝图无法真正控制 UI
- 没有 Dev Mode 调试，语言复杂度一上去就不可维护

---

## 20. 明确推荐采纳的关键设计决策

为了避免后续实现过程中不断反复，下面这些决策建议直接视为当前版本的推荐结论：

### 20.1 必采纳

- 蓝图第一阶段只聚焦 UI 领域
- `Visual Blueprint` 与 `TypeScript Blueprint` 创建时即选择，不做互转
- 两者共享同一套宿主协议、作用域模型和调试体系
- 绑定系统保持纯计算
- 副作用只允许在事件执行图中发生
- 实例主蓝图不可共享
- 共享蓝图进入资产系统
- UI 入口走“属性面板 + 独立 Tab”
- 编辑器底层优先选 React Flow + Monaco

### 20.2 强烈建议

- 继续利用 `uigraphs.json` 做本地实例蓝图的第一阶段载体
- 尽早建立调试协议
- 在 Dev Mode 中先跑通真实蓝图执行
- `TypeScript Blueprint` 保持受限 API + 虚拟模块导入 + 编译进游戏运行时

### 20.3 不建议

- 做任意 TS 与图的双向同步
- 让绑定系统执行副作用
- 把共享蓝图和实例主蓝图混在同一层语义里
- 在第一阶段就做完全自由的动态 UI 树编排

---

## 21. 仍然存在但不阻塞的开放点

下面这些问题还可以后续细化，但不会阻塞主架构：

- 本地实例蓝图文档是否继续保留 `uigraphs.json` 文件名
- 共享蓝图资产扩展名最终命名
- `Blueprint DevTools` 最终作为独立面板还是 Dev Mode 内嵌视图
- 绑定 UI 中“内联创建声明成员”的具体交互细节
- 动态模板列表的节点集和 UI 组件边界

如果没有新的产品硬约束，推荐先按本文档的默认方案推进，不要在这些细枝末节上过早消耗主要开发时间。

---

## 22. 最后总结

对 NarraLeaf Studio 而言，最正确的蓝图系统不是“再加一个图编辑器”，而是：

- 用 Graph IR + 受限 TS 脚本模块把 UI 逻辑正式提升为一等公民
- 用实例主蓝图 + 共享资产把私有逻辑与复用逻辑分层
- 用纯绑定系统把 UI 声明能力稳定下来
- 用受限 `TypeScript Blueprint` 承接高级用户
- 用 Dev Mode + DevTools 把复杂逻辑真正调试起来

只要坚持下面这条总原则，后续系统就不会跑偏：

- **编辑方式可以有两种**
- **上层运行时契约只能有一种**

这条原则应当成为整个 Blueprint System 的最高设计约束。
