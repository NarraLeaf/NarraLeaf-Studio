# Dev Mode 功能上下文

Dev Mode 是独立 window，用于从项目磁盘数据组装 bundle 并运行 UI runtime 预览。它不是 Workspace canvas preview。

## 当前实现

- 已有 `WindowAppType.DevMode` 和独立 renderer app。
- Workspace 通过 `DevModeService` 调用 main IPC：launch、stop、reload、getStatus。
- Main `DevModeManager` 维护单个 session，负责窗口创建/关闭、状态、bundle revision、watcher、reload debounce。
- Dev Mode 启动时会读取磁盘上的 `editor/ui/uidoc.json`、`editor/ui/uigraphs.json` 和 blueprint asset metadata/content。
- TypeScript blueprint 会在主进程编译为 IIFE，挂到 Dev Mode runtime 可访问的 module registry。
- Dev Mode renderer 可接收 bundle、渲染 surface、执行 blueprint runtime、展示 session error 和 blueprint debug panel。
- 启动 NarraLeaf 故事时按 slot 注入 Game UI surface：`dialog` → `Game({ dialog })`、`notification` → `Game({ notification })`、`choice` → `Game({ menu })`、`nvl` → `Game({ nvlDialog })`、`onStage` → `<Player>` children（NLR RootLayout 常驻、点击穿透）。缺失的 slot 使用 NarraLeaf 默认组件。
- 文件 watcher 监听 UI 文档、UI graph、blueprint metadata、assets content，变更后自动 reload。

## 入口文件

- Workspace service：`src/renderer/lib/workspace/services/core/DevModeService.ts`
- Workspace action：`src/renderer/apps/workspace/modules/actions/index.tsx`
- 启动前 flush：`src/renderer/apps/workspace/modules/actions/flushDevModeAssets.ts`
- Main manager：`src/main/app/application/managers/devMode/DevModeManager.ts`
- Bundle assembler：`src/main/app/application/managers/devMode/pipeline/bundleAssembler.ts`
- NLang compiler interface：`src/main/app/application/managers/devMode/compiler/INLangCompiler.ts`
- Blueprint TS compiler：`src/main/app/application/managers/devMode/compiler/blueprint/compileProjectBlueprintScripts.ts`
- Dev Mode app：`src/renderer/apps/dev-mode/DevModeApp.tsx`
- Dev Mode content：`src/renderer/apps/dev-mode/components/DevModeContent.tsx`
- Payload hook：`src/renderer/apps/dev-mode/hooks/useDevModePayload.ts`
- Runtime hook：`src/renderer/apps/dev-mode/hooks/useDevModeBlueprintRuntime.ts`
- Blueprint runtime：`src/renderer/lib/ui-editor/blueprint-runtime/`
- Shared protocol：`src/shared/types/devMode.ts`、`src/shared/types/ipcEvents.ts`

## 运行边界

- 默认入口是 surface entry；当前主要服务 UI preview/runtime。
- Dev Mode 从磁盘读 bundle，因此 Workspace 内 UIDocument/UIGraph dirty 状态需要在 launch/reload 前保存。
- Workspace preview 使用内存文档；Dev Mode 使用主进程 bundle，两者数据来源不同。
- Main Surface 和 Stage Surface link 语义应以 `UIDocument` / runtime root 解析实现为准。
- 当前 `NullNLangCompiler` 是可插拔编译接口的占位；真实 story/nlang 编译链未接入。

## 已知缺口

- Story runtime execution 和从剧情行启动未接入。
- nlang 编译仍是空实现接口。
- 运行时状态快照、reload 后剧情状态回滚未实现。
- 多入口选择 UI 不完整。
- Dev Mode 当前 watcher 主要覆盖 UI/Blueprint/asset content，不代表全项目热更新。
- 完整 player/game workflow 还没有落地；当前重点是 UI surface 与 blueprint runtime。

## 修改建议

- 改 bundle schema 时同步更新 shared type、main assembler、Dev Mode payload hook 和 renderer runtime。
- 改 Dev Mode launch/reload 时确认 Workspace 调用方是否 flush dirty UI 文档和 graph。
- 改 blueprint runtime 时同时验证 Workspace Blueprint Lite 输出和 Dev Mode executor 输入。
- 不要在 Workspace preview 中悄悄补完整 runtime 行为；需要真实执行时优先改 Dev Mode。
