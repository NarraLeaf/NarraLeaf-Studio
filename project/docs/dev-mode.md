# NarraLeaf Studio - Dev Mode（开发服务器）模块指引

本文档描述 **Dev Mode（开发服务器）** 的模块边界、主进程职责、IPC 协议与扩展点，用于在不破坏现有 Workspace/Editor 架构的前提下，提供一个“可运行完整游戏工作流”的预览窗口。

目标读者：需要实现/维护 Dev Mode 主进程逻辑、Dev Mode 窗口 App、以及对接 nlang 编译与运行时预览的开发者。

---

## 1. 需求摘要（从用户行为出发）

### 1.1 入口与窗口模型

- 用户在 Workspace 的 Toolbar 点击 **Dev Mode** 按钮。
- Studio 主进程启动一个 **独立窗口**（Dev Mode Window）。
- Dev Mode 是 **全局性的任务**：
  - 同一时间只能存在 **一个 Dev Mode 会话（session）**。
  - 不允许多窗口并行；若已存在会话，触发行为应为“聚焦已有窗口 / 切换入口 / 触发重载”等，而不是再开一个。

### 1.2 预览能力与扩展方向

Dev Mode Window 需要支持未来扩展为多种“启动入口（Entry）”，例如：

- 从某个 **Surface** 启动（默认：Main Surface）。
- 从某行 **剧情** 启动（例如从脚本某行开始播放）。
- 从某个“扩展启动操作”启动（例如插件注入的调试入口、录制回放入口等）。

### 1.3 启动时的编译与运行时数据

启动 Dev Mode 时引擎会开始执行 **nlang 编译**（当前未集成，但必须预留高度可扩展的接口），并向 Dev Mode Window 提供运行所需的最小数据集：

- UI 文档、行为图等 UI 资产（`uidoc.json` / `uigraphs.json`）。
- 剧情脚本/运行时脚本（未来扩展）。
- 项目配置（分辨率、语言、资源路径等，未来扩展）。

这些数据通过一个由 **主进程转发** 的 IPC 通道传输，并且协议需支持未来扩展更多类型的数据包与控制指令。

### 1.4 热更新（Reload）语义

- 当 Studio 检测到更新（文档/脚本/资源等）时，Dev Mode Window 应当：
  - **重载运行时文档/资产**；
  - 若当前处于剧情中，尝试 **回滚剧情状态**（具体回滚策略可后续实现，但要在架构上留出“状态快照/恢复”的接口与调用点）。

---

## 2. Surface 与 Main Surface（强约束）

### 2.1 Main Surface 的不可变约束

Dev Mode Window 默认渲染一个特定的 `App Surface`：**Main Surface**。

该 Surface 必须：

- **id 硬编码**：`"narraleaf-studio:main-surface"`
- **不可删除**
- **不可重命名**
- **默认生成**：新建项目/首次生成 UI 文档时必须存在
- **按 id 查找**：运行时与 Dev Mode 启动逻辑一律通过 `surfaceId` 查找，禁止用 `name` 查找

> 说明：id 对用户不可见，且不会与 uuid 冲突，因此使用稳定字符串即可。

### 2.2 Stage Surface Link（面向 Dev Mode 的复用机制）

为了让游戏内叠层可以复用 App 级页面（例如 Settings），Stage Surface 需要支持 Link 任意 App Surface：

- Stage Surface 与被 Link 的 App Surface 共用同一个 `UIDocument.elements`（同一份文档、同一棵树）。
- 渲染 Stage Surface 时，若存在 Link，渲染入口根节点来自被 Link 的 App Surface（详见 `project/docs/visual-editor.md` 的 Stage Surface Link 小节）。

Dev Mode/Player runtime 的 Surface 渲染实现必须包含 Link 解析机制，否则 Dev Mode 的 UI 复用能力无法落地。

---

## 3. 模块边界与推荐文件结构（保持低耦合）

Dev Mode 需要跨 Renderer（Workspace）与 Main Process（窗口/IPC/编译）两个域。建议把其职责拆成 3 个明确模块，并把文件放在“足够清晰”的目录中。

### 3.1 Renderer（Workspace）侧：触发与状态展示

职责：

- Toolbar 按钮触发 Dev Mode 启动/停止/重载等动作（通过 IPC request）。
- 展示 Dev Mode 任务状态（running / compiling / error / idle）。
- 未来扩展：入口选择 UI（从 surface 启动 / 从剧情行启动）。

推荐位置（示例）：

- `src/renderer/apps/workspace/modules/toolbar/*`（按钮与入口选择 UI）
- `src/renderer/lib/workspace/services/*`（若需要新增 workspace service 来管理 Dev Mode 状态）

### 3.2 Main Process：DevModeManager（会话与窗口的唯一真相）

职责（主进程的单一职责中心）：

- 维护全局唯一 `DevModeSession`（生命周期、状态机、资源句柄）。
- 创建/聚焦/关闭 Dev Mode Window。
- 执行启动流水线（compile → bundle → launch window → init runtime）。
- 负责 IPC 转发通道（向 Dev Window 推送文档、脚本、控制指令）。
- 处理 reload：重载数据包 + 尝试状态回滚（调用 runtime 接口）。

推荐位置（示例）：

- `src/main/app/application/managers/devMode/DevModeManager.ts`
- `src/main/app/application/managers/devMode/types.ts`
- `src/main/app/application/managers/devMode/pipeline/*`（可插拔启动流水线步骤）

### 3.3 Dev Mode Window（Renderer App）：运行时预览壳

职责：

- 渲染一个特定的 App Surface（默认 Main Surface）。
- 运行 player/app runtime（完整工作流预览）。
- 处理来自主进程的“数据包更新 / reload / focus entry change”指令。

推荐位置（示例）：

- `src/renderer/apps/dev-mode/*`

> 当前仓库 `WindowAppType` 尚无 Dev Mode 类型；建议后续新增 `WindowAppType.DevMode`，使 Dev Mode Window 与 Workspace/Settings 解耦，并拥有独立的 props 与路由入口。

---

## 4. 类型与协议设计（可扩展、可演进）

### 4.1 会话状态机（主进程）

Dev Mode 作为全局任务，建议显式状态机：

- `idle`：无会话
- `starting`：开始启动但窗口未 ready
- `compiling`：nlang 编译/资源打包中
- `running`：窗口已 ready 且运行中
- `reloading`：收到更新，正在重载
- `error`：启动或运行失败（可重试）
- `stopping`：正在关闭会话

状态机的核心价值：

- UI 可稳定显示任务状态（Workspace toolbar）。
- IPC 事件与窗口生命周期更可控（避免“窗口已关但仍在推送”）。

### 4.2 启动入口（Entry）统一抽象

为了支持“从 Surface 启动 / 从剧情行启动 / 扩展入口”，入口应该是一个可扩展的 discriminated union（示意）：

- `entry.kind = "surface"`
  - `surfaceId: UISurfaceId`（默认 `"narraleaf-studio:main-surface"`）
- `entry.kind = "story"`
  - `scriptId` / `filePath`（二选一，取决于项目脚本体系）
  - `line`（从某行开始）
  - `checkpointId?`（未来扩展）
- `entry.kind = "extension"`
  - `extensionId`
  - `payload`（由扩展自定义）

### 4.3 主进程转发 IPC 通道（数据 + 控制）

要求：

- Studio 主进程作为 **唯一数据源**（source of truth），向 Dev Mode Window 推送“运行时需要的数据包”。
- 协议必须允许未来新增数据类型，不破坏旧实现。
- 支持最少两类消息：
  - **Control**：launch / stop / reload / changeEntry / focus 等
  - **Payload**：uidoc / uigraphs / scripts / settings / compiledArtifacts 等

推荐做法：

- 在 `src/shared/types/ipcEvents.ts` 增加 Dev Mode 的 request 事件（Workspace → Main）：
  - `devMode.launch`
  - `devMode.stop`
  - `devMode.reload`
  - `devMode.getStatus`
  - `devMode.setEntry`（可选，若允许运行中切换入口）
- 同时为 Main → DevWindow 增加“转发频道”的 message 事件（由主进程发给 DevWindow）：
  - `devMode.payload.update`（携带版本号/增量信息）
  - `devMode.control.reload`
  - `devMode.control.setEntry`

> 现有 IPC 基础设施使用 `Namespace.NarraLeafStudio`，并通过 `IPCEventType` 统一声明事件；Dev Mode 事件建议沿用相同风格（`devMode.*` 命名空间）。

### 4.4 数据包（Bundle）与版本控制

为了支持 reload 与未来增量更新，建议把“传输给 Dev Window 的内容”组织为一个 Bundle：

- `bundleId`：一次启动会话的唯一 id
- `revision`：自增版本号（每次更新 +1）
- `timestamp`
- `ui`：
  - `uidoc`（完整 JSON 或增量 patch，初期可全量）
  - `uigraphs`（含必填的 `blueprintDocument`；实例蓝图与 `localBlueprints` 同源）
  - `localBlueprints`（`BlueprintDocument`，与 `uigraphs.blueprintDocument` 一致；M2+ 起随项目保存；执行闭环属后续里程碑）
- `scripts`：脚本/剧情内容（未来）
- `settings`：运行时需要的项目设置（未来）
- `compiled`：nlang 编译产物（未来）
- `meta`：任意扩展字段（未来插件）

Dev Window 侧应当：

- 只接收“比当前 revision 更新”的 bundle
- 以 bundle 为单位执行 reload（原子替换），避免半更新状态

---

## 5. nlang 编译（未集成，但必须可插拔）

Dev Mode 启动流程必须包含“编译步骤”的接口，但不应把具体编译实现写死在 DevModeManager 中。

建议定义接口（示意）：

- `INLangCompiler.compile(context): Promise<CompileResult>`
- `CompileResult` 至少包含：
  - `ok` / `errors`
  - `artifacts`（可选：产物路径/内存内容）
  - `diagnostics`（可选：用于 Dev Window 展示）

然后在 DevModeManager 中把启动流程组织为可插拔 pipeline：

- `prepare`：收集项目路径/配置/入口参数
- `compile`：调用 compiler（当前可返回空产物，但结构不变）
- `bundle`：组装 DevModeBundle（uidoc/uigraphs 等）
- `launchWindow`：创建或聚焦 Dev Window
- `initRuntime`：把 bundle 推送给 Dev Window 并请求其 ready

未来新增：

- `compileAssets`（资源打包）
- `compileScripts`（脚本编译）
- `preflightChecks`（依赖检查）
- `extensions`（扩展注入步骤）

---

## 6. Reload 与“剧情状态回滚”扩展点

### 6.1 Reload 的最小落地策略

当更新发生时（文档/脚本/资源），主进程触发：

- 重新生成 bundle（revision +1）
- 向 Dev Window 发送 `payload.update` + `control.reload`
- Dev Window 重载运行时：
  - 重新加载 UI 文档（并重新渲染 surfaces）
  - 重新加载脚本/运行时数据（未来）

### 6.2 剧情状态回滚（预留接口）

“尝试回滚剧情状态”需要运行时提供可恢复的状态抽象：

- `IRuntimeStateSnapshot.capture(): Snapshot`
- `IRuntimeStateSnapshot.restore(snapshot): Promise<void>`

建议在 Dev Mode runtime 中引入“检查点（checkpoint）”概念：

- 在进入剧情前 / 每个关键节点创建 checkpoint
- reload 后尝试 restore 到最近 checkpoint
- 若 restore 失败，回退到“重新从入口启动”

本期实现可以先仅保留接口与调用点，具体状态序列化/恢复后续迭代。

---

## 7. Main Surface 的工程落地点（避免散乱）

为了保证 `"narraleaf-studio:main-surface"` 的不可变性与可迁移性，建议把约束集中在两处：

### 7.1 文档层（强约束）：创建与迁移时确保存在

- 在 `UIDocumentService.createEmptyDocument()` 中创建 Main Surface 时使用固定 id。
- 在 `UIDocumentService.migrateIfNeeded()`（或专门的 migration step）中：
  - 若不存在 Main Surface，则创建并补齐 root element
  - 若存在但 id 不符合，则执行迁移（例如从 legacy surface 映射到固定 id）

### 7.2 UI 层（弱约束）：编辑器里禁止删除/重命名

- `UISurfacesPanel` 等 UI 层面：
  - 对 Main Surface 隐藏 “Delete / Rename” 操作
  - 在属性面板中对 name 字段禁用编辑（或强制回写）

> 约束以“文档层强约束”为准，UI 层只是减少用户误操作入口。

---

## 8. Dev Mode 与 Surface Link 的结合点（渲染链路要求）

Dev Mode Window 在渲染 Surface 时必须满足：

- 默认渲染入口为 Main Surface：`surfaceId = "narraleaf-studio:main-surface"`
- 当 player 渲染 Stage Surface 时，必须解析 `stageSurface.link` 并渲染对应 App Surface 的 element tree
- Surface 查找必须统一通过 `surfaceId`（而非 name），以保证可重命名与稳定引用

建议将 “Surface → 有效 rootElementId” 的解析逻辑抽成一个纯函数/服务（示意）：

- `resolveSurfaceRoot(document, surfaceId): UIElementId | null`
  - 若 surface 为 stage 且 link 存在：返回 link 目标 app 的 rootElementId
  - 否则：返回自身 rootElementId

这样可以让：

- `UIRuntimeBridgeService.renderSurface()`（编辑器预览）
- Player runtime（Dev Mode 运行）

复用同一套解析语义，减少分叉。

---

## 9. 开发建议（落地顺序）

建议最小可运行里程碑按以下顺序实现：

1. Dev Mode IPC 请求：Workspace → Main（launch/stop/status）
2. Main Process 的 DevModeManager：单例会话 + 窗口创建与聚焦
3. Dev Mode Window App：能接收 bundle 并渲染 Main Surface
4. Bundle 初版：只包含 `uidoc`（全量），并支持 reload
5. Surface Link：Stage Surface link 解析 + 渲染链路打通
6. 入口扩展：从 Surface / 从剧情行启动的 UI 与协议
7. nlang 编译接口接入：先接空实现，再逐步接真实编译与诊断输出
