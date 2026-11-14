# Dev Mode 功能上下文

Dev Mode 是独立 window，用于从项目磁盘数据组装 bundle 并运行 UI runtime 预览。它不是 Workspace canvas preview。

## 当前实现

- 已有 `WindowAppType.DevMode` 和独立 renderer app。
- Workspace 通过 `DevModeService` 调用 main IPC：launch、stop、reload、getStatus。
- Main `DevModeManager` 按规范化的项目路径维护 session，每个项目最多一个，不同项目可同时运行。每个 session 管理自己的窗口、状态、bundle revision、watcher 和 reload debounce；同一项目的 launch、stop 和 reload 串行执行。
- Dev Mode 启动时会读取磁盘上的 `editor/ui/uidoc.json` 和 `editor/ui/uigraphs.json`。
- 项目脚本由主进程 `pipeline/scriptCompiler.ts` 用 esbuild 编译后随 bundle 发送；剧情由 renderer 侧 `GameApp` 通过 `compileStudioStoryToNlr` 编译执行，Dev Mode 与打包游戏共用这条运行时。
- Dev Mode renderer 可接收 bundle、渲染 surface、执行 blueprint runtime、展示 session error 和 blueprint debug panel。
- 启动 NarraLeaf 故事时按 slot 注入 Game UI surface：`dialog` → `Game({ dialog })`、`notification` → `Game({ notification })`、`choice` → `Game({ menu })`、`nvl` → `Game({ nvlDialog })`、`onStage` → `<Player>` children（NLR RootLayout 常驻、点击穿透）。缺失的 slot 使用 NarraLeaf 默认组件。
- 剧情可以从场景开头、指定行（`startBlockId`）或变量快照启动；Dev Mode 调试面板提供按行启动。
- 文件 watcher 监听 UI 文档、UI graph、剧情、本地化、角色、品牌、蓝图元数据、脚本和 assets content，变更后自动 reload；热重载通过 `resume` 带回运行中的场景变量与存档变量。

## 入口文件

- Workspace service：`src/renderer/lib/workspace/services/core/DevModeService.ts`
- Workspace action：`src/renderer/apps/workspace/modules/actions/index.tsx`
- 启动前 flush：`src/renderer/apps/workspace/modules/actions/flushDevModeAssets.ts`
- Main manager：`src/main/app/application/managers/devMode/DevModeManager.ts`
- Bundle assembler：`src/main/app/application/managers/devMode/pipeline/bundleAssembler.ts`
- Script compiler：`src/main/app/application/managers/devMode/pipeline/scriptCompiler.ts`
- Dev Mode app：`src/renderer/apps/dev-mode/DevModeApp.tsx`
- Dev Mode content：`src/renderer/apps/dev-mode/components/DevModeContent.tsx`
- Payload hook：`src/renderer/apps/dev-mode/hooks/useDevModePayload.ts`
- Story runtime debug：`src/renderer/apps/dev-mode/components/StoryRuntimeDebugPanel.tsx`
- Shared game runtime：`src/renderer/lib/ui-editor/runtime/app/GameApp.tsx`
- Blueprint runtime：`src/renderer/lib/ui-editor/blueprint-runtime/`
- Shared protocol：`src/shared/types/devMode.ts`、`src/shared/types/ipcEvents.ts`

## 运行边界

- Dev Mode 从磁盘读 bundle，因此 Workspace 内 UIDocument/UIGraph dirty 状态需要在 launch/reload 前保存。
- Workspace preview 使用内存文档；Dev Mode 使用主进程 bundle，两者数据来源不同。
- Main Surface 和 Stage Surface link 语义应以 `UIDocument` / runtime root 解析实现为准。

## 修改建议

- 改 bundle schema 时同步更新 shared type、main assembler、Dev Mode payload hook 和 renderer runtime。
- 改 Dev Mode launch/reload 时确认 Workspace 调用方是否 flush dirty UI 文档和 graph。
- 改 blueprint runtime 时同时验证 Workspace Blueprint Lite 输出和 Dev Mode executor 输入。
- 不要在 Workspace preview 中悄悄补完整 runtime 行为；需要真实执行时优先改 Dev Mode。
