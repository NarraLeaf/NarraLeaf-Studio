# NarraLeaf Studio 文档入口

本文是给 agent 的 Workspace 探索入口。它只保留定位信息和工程边界；功能细节请进入对应功能文档阅读。

代码事实优先级高于文档。`project/docs/` 中的旧计划已经被合并清理，若文档和代码冲突，以 `src/renderer/lib/workspace/services/`、`src/renderer/apps/workspace/`、`src/shared/types/` 的实现为准。

## 功能文档

- `project/docs/ui.md`：UI Editor、Surface、Widget、Blueprint、Workspace preview、Dev Mode UI runtime 边界。
- `project/docs/story.md`：StoryService、多 story 文档、Story panel、Scene editor、剧情编辑器已实现与未实现范围。
- `project/docs/settings.md`：全局设置、Workspace runtime settings、项目 editor settings 的存储边界。
- `project/docs/dev-mode.md`：Dev Mode window、主进程 DevModeManager、bundle/reload/blueprint runtime。
- `project/docs/plugin.md`：插件系统设计状态、当前未实现项、已有预留点。
- `project/docs/develop.md`：通用开发文档；与本文档整理无关。

## Workspace 主入口

Workspace 是 Studio 的主要 window，服务由固定 `ServiceRegistry` 驱动。

- App 入口：`src/renderer/apps/workspace/WorkSpaceApp.tsx`
- Context：`src/renderer/apps/workspace/context/WorkspaceContext.tsx`
- Workspace 对象：`src/renderer/lib/workspace/workspace.ts`
- Service 基类：`src/renderer/lib/workspace/services/Service.ts`
- Service 注册表：`src/renderer/lib/workspace/services/serviceRegistry.ts`
- Service enum/interface：`src/renderer/lib/workspace/services/services.ts`

典型服务获取方式：

```ts
const story = context.services.get<StoryService>(Services.Story);
```

不要手动 `new` service。当前 service 是固定 singleton 集合，初始化由 `WorkspaceProvider` 创建 context 后统一完成。

## 当前 Workspace Services

| Service | 入口文件 | 何时先读 |
| --- | --- | --- |
| `Project` | `services/core/ProjectService.ts` | 需要项目配置、`.nlproj` / legacy `project.json` 读取。 |
| `FileSystem` | `services/core/FileSystem.ts` | 需要 renderer 到 main 的文件读写 IPC。 |
| `Uuid` | `services/core/UuidService.ts` | 需要统一生成 id。 |
| `UI` | `services/core/UIService.ts`、`services/ui/*` | 需要 panel、editor tab、dialog、notification、focus、keybinding。 |
| `GlobalSettings` | `services/GlobalSettingsService.ts` | 需要 Studio/editor 设置、workspace tab/session 恢复，全部写入 `userData/state/global.json`。 |
| `Assets` | `services/core/AssetsService.ts`、`services/assets/*` | 需要资产导入、分组、metadata、remote cache、asset lock。 |
| `ServiceAssets` | `services/core/ServiceAssetsService.ts` | 需要 service 私有 JSON store 或私有文件。 |
| `PanelState` | `services/core/PanelStateService.ts` | 需要按 panel 保存 UI 状态。 |
| `Character` | `services/core/CharacterService.ts` | 需要角色、角色组、appearance、variant 资产锁。 |
| `Story` | `services/story/StoryService.ts` | 需要 Story 文档、chapter/scene/block mutation。 |
| `UIDocument` | `services/ui-editor/UIDocumentService.ts` | 需要 UI surface 和 element document。 |
| `RuntimeBridge` | `services/ui-editor/UIRuntimeBridgeService.tsx` | 需要从 UIDocument 渲染 editor preview。 |
| `UIEditorState` | `services/ui-editor/UIEditorStateService.ts` | 需要 selection、tool、viewport、snap、inspector 编辑态。 |
| `UIEditorHistory` | `services/ui-editor/UIEditorHistoryService.ts` | 需要 UI surface undo/redo。 |
| `UIGraph` | `services/ui-editor/UIGraphService.ts` | 需要 `uigraphs.json` 和 local blueprint document。 |
| `LocalBlueprint` | `services/ui-editor/LocalBlueprintService.ts` | 需要编辑 private blueprint、fields、variables、event/function graph。 |
| `UIBlueprintLifecycle` | `services/ui-editor/UIBlueprintLifecycleCoordinator.ts` | 需要 UIDocument 与 private blueprint owner 同步。 |
| `DevMode` | `services/core/DevModeService.ts` | 需要启动/停止/reload Dev Mode。 |
| `UIEditorFontFace` | `services/ui-editor/UIEditorFontFaceService.ts` | 需要 UI editor 字体 asset 加载。 |
| `BlueprintNodeCatalog` | `services/ui-editor/BlueprintNodeCatalogService.ts` | 需要 Blueprint node palette/definition。 |

## Agent 阅读规则

- 先用本文判断功能归属，再进入对应功能文档和代码入口。
- `services.ts` 只是接口索引，很多 UI 直接使用具体 service class 的扩展方法；查行为时必须读实现文件。
- 区分三类状态：持久文档状态、项目 editor/session 状态、纯 UI 临时状态。不要把 selection、draft、collapse、viewport 等编辑态随意写进文档模型。
- 新增 workspace tab 时默认检查 `workspaceEditorSession.ts` / `useWorkspaceEditorSession.ts` 是否需要 session restore。
- Story 任务以 `StoryService` 和 `src/shared/types/story/` 为持久化真相；Scene editor 的 UI 状态不要反向污染 `StoryDocument`。
- UI editor 任务要区分 `UIDocument`、`UIEditorStateService`、`UIGraphService.blueprintDocument` 和 Dev Mode runtime。Workspace canvas preview 不等于完整 runtime。
- Dev Mode 从磁盘 bundle 读取 UI 文档和 graph；启动前若涉及 UIDocument/UIGraph dirty 状态，需要确认调用方是否 flush/save。

## 常用项目路径

- Project config：`.nlproj`，legacy fallback 为 `project.json`。
- Studio/global settings：Electron `userData/state/global.json`。
- Service private store：`editor/services/<namespace>.json`。
- Service private file：`editor/assets/<uuid>`。
- UI document：`editor/ui/uidoc.json`。
- UI graph / local blueprint：`editor/ui/uigraphs.json`。
- Story library index：`editor/story/index.json`。
- Story document：`editor/story/stories/<storyId>/storydoc.json`。
