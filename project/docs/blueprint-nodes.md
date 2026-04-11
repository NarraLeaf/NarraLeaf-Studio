# UI 蓝图节点与事件清单

本文档与实现共享术语，描述 **作用域**、**事件头**、**内置节点族** 与优先级。实现入口：`src/renderer/lib/ui-editor/blueprint-nodes/built-in/`、`src/shared/types/blueprint/graph.ts`（`resolveBlueprintEventHeadTypesForUiSlot` 等）。

---

## 1. 作用域与成员（心智模型）

| 概念 | 生命周期 / 语义 | 说明 |
|------|------------------|------|
| **Local Var** | 随控件或 Surface 实例、蓝图执行上下文；**重挂载可丢失** | `members.variables` + `blueprint.local.get/set`；仅图内临时状态 |
| **Field** | 随应用 / Surface 会话，在 **成员面板** 定义；**不由节点初始化** | `members.fields`；`widgetProp` 绑定的唯一符号源；`BindingSourceRef.kind === "field"` |
| **Host state** | `surface` / `global` / `persistence` | 由 Host API 读写；字段的 `valueSource`（如 `surfaceState`）指向其中的键 |
| **Layer** | 编辑器内图槽位（`graphs.events[eventId]`） | **仅整理与编译顺序**，不是「蓝图入口」；入口 = 事件头 + UI 槽位绑定 |

**权限（产品向）：** `globalMain` / `surfaceMain` 可定义字段；`widgetMain` 一般不定义「自有存储字段」，但可 **读写** 允许的 Host 状态并通过绑定引用字段；具体节点可见性由 `BlueprintNodeDef.scope` 与调色板上下文约束。

---

## 2. 事件头与 UI 槽位

Widget 在 `UIWidgetModule.blueprintEvents` 中声明槽位 id（如 `init`、`click`）。运行时 `dispatchElementBlueprintEvent(elementId, slotId)` 将槽位映射到图上的 **事件头节点类型**：

- 映射函数：`resolveBlueprintEventHeadTypesForUiSlot(slotId, widgetElementType?)`（`src/shared/types/blueprint/graph.ts`）。
- 可选按控件覆盖：在 `WidgetBlueprintEventDef` 上设置 `headNodeTypes`。
- 当前内置头节点类型常量：`blueprint.event.head.init`、`blueprint.event.head.click`（仅 `nl.button` 调色板与 scope 限制）。

### 2.1 建议扩展的事件（策划向）

下列可在后续版本增加 **槽位 + 头类型 + 宿主派发** 三元组实现。

**仅控件：** `beforeRender`（首帧布局前）、`mounted`、`visibilityChanged`、`enabledChanged`、`focus`、`blur`、`hoverStart`、`hoverEnd`。

**仅 Surface：** `beforeRender`、`mounted`、`enterStart`、`enterEnd`、`exitStart`、`exitEnd`、`focused`、`blurred`。

**仅全局：** `appBoot`（首屏前）、`firstSurfaceBeforeRender`、`resume`、`pause`、`saveLoaded`、`languageChanged`。

**动效 / 媒体：** `transitionFinished`、`animationFinished`、`audioFinished`、`timerElapsed`。

---

## 3. 内置节点目录（按领域）

**列说明：**「Owner」表示典型可用 owner（空 = 不额外限制）；「图」`E`=event，`F`=function，`M`=macro；**P**=计划优先级。

### P0 — 核心

| 领域 | 节点 / 能力（名称） | Owner | 图 | Pure | 备注 |
|------|---------------------|-------|----|------|------|
| Events | On widget initialize | widget | E | 否 | `blueprint.event.head.init` |
| Events | On button click | widget (`nl.button`) | E | 否 | `blueprint.event.head.click` |
| Flow | Function entry | 任意 | F | 是 | |
| Flow | Sequence, If, Delay | 任意 | E,M | 否 | Delay 为 latent |
| Layout | Reroute | 任意 | E,F,M | 否 | |
| Data | Literal | 任意 | E,F,M | 是 | |
| Locals | Get / Set Var | 任意 | 见 `graphKinds` | Set 否 | 执行局部变量 |
| Math | Add, Subtract, Multiply, Divide, +1, -1, ==, !=, <, <=, >, >= | 任意 | E,F,M | 是 | +1/-1：单 float 输入，输出原值±1；比较节点输出 boolean，可接 If 等 |
| String | Concat, Length, Trim, Case… | 任意 | E,F,M | 是 | |
| Navigation | openSurface, closeLayer 等 | 见实现 | E,M | 否 | Host |
| Widget | Set visible / enabled / variant | widgetMain | E,M | 否 | latent |
| State | state.get / set（surface/global） | 见 Host | E,M | 否 | |
| Persistence | get / set | 见 Host | E,M | 否 | |
| Debug | Log 等 | 见实现 | E,M | 否 | |

### P1 — 视觉小说 / UI 扩展（规划）

动效过渡、音频总线、Timer/Debounce、列表 ForEach、存档读写抽象、输入模式（skip/auto）、与剧情层桥接（`StartScene`、`PresentChoices` 等）— 需在 Host API 与节点注册表中逐项落地。

### P2 — 工具与随机

Random、Chance、JSON 属性读写、外链/剪贴板等 — 按需与平台策略一致后添加。

---

## 4. 磁盘与迁移

- `BlueprintDocument.schemaVersion === 5`：`members.fields` + `BindingSourceRef.kind === "field"`。
- 旧版 `declarations` / `kind: "declaration"` 在 `migrateBlueprintDocumentToLatest` 中自动升级（见 `src/shared/blueprint/migrateBlueprintDocument.ts`）。

---

## 5. 相关代码路径

| 区域 | 路径 |
|------|------|
| 成员与绑定类型 | `src/shared/types/blueprint/document.ts` |
| 事件头解析 | `src/shared/types/blueprint/graph.ts` |
| 派发 | `src/renderer/lib/ui-editor/blueprint-runtime/BlueprintDispatcher.ts` |
| 绑定求值 | `src/renderer/lib/ui-editor/blueprint-runtime/BindingEvaluator.ts`、`fieldEvaluation.ts` |
| 节点注册 | `src/renderer/lib/ui-editor/blueprint-nodes/` |
| 内置节点聚合 | `src/renderer/lib/ui-editor/blueprint-nodes/built-in/index.ts` |

---

*文档随 schema / 注册表演进请及时更新本文件与 `blueprint-system-arch.md`。*
