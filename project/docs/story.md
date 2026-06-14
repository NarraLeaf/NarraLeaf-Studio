# Story 功能上下文

本文描述 Workspace 的 Story 功能现状。Story 的持久化真相在 `StoryService` 和 shared story types；旧概念里的 stage preview、flow map、runtime 等内容只有在本文明确标为已实现时才可按实现处理。

## 当前实现

- 已有多 story library，每个 story 有独立 `StoryDocument`。
- 已有 chapter、scene、block tree 的创建、重命名、删除、移动和保存。
- 已有 Story panel，可管理 story/chapter/scene，并打开 scene editor tab。
- 已有 Scene editor，可按 block tree 渲染行，支持 inline 文本、插入、选择、多选、缩进、拖拽排序、折叠、删除、局部 undo/redo、clipboard、action creator、inspector。
- 已有 Story asset lock：背景、角色 asset、音频、dialogue voice asset 等引用会注册资产锁。
- 已有 plugin action registry API，但 scene action chooser 尚未把 plugin actions 合并进 UI。
- `canImportStoryPackage()` 和 `canExportStoryPackage()` 存在，但当前固定返回 `false`。

## 入口文件

- 类型：`src/shared/types/story/document.ts`
- Service：`src/renderer/lib/workspace/services/story/StoryService.ts`
- 数据模型工具：`src/renderer/lib/workspace/services/story/storyModel.ts`
- 模型测试：`src/renderer/lib/workspace/services/story/storyModel.test.ts`
- Story panel：`src/renderer/apps/workspace/modules/story/panel/StoryPanel.tsx`
- Scene editor 打开入口：`src/renderer/apps/workspace/modules/story/scene-editor/openStorySceneEditorTab.tsx`
- Scene editor tab：`src/renderer/apps/workspace/modules/story/scene-editor/StorySceneEditorTab.tsx`
- Scene editor controller：`src/renderer/apps/workspace/modules/story/scene-editor/useStorySceneEditorController.ts`
- Rows：`src/renderer/apps/workspace/modules/story/scene-editor/StorySceneEditorRows.tsx`
- Inspector：`src/renderer/apps/workspace/modules/story/scene-editor/StorySceneActionInspector.tsx`
- Action creator：`src/renderer/apps/workspace/modules/story/scene-editor/StoryActionCreatorPanel.tsx`
- Action command catalog：`src/renderer/apps/workspace/modules/story/scene-editor/storyActionCommands.ts`
- Clipboard：`src/renderer/apps/workspace/modules/story/scene-editor/storySceneClipboard.ts`
- Session restore：`src/renderer/apps/workspace/session/workspaceEditorSession.ts`

## 持久化模型

- Library index：`editor/story/index.json`
- Story document：`editor/story/stories/<storyId>/storydoc.json`
- `defaultStoryId` 是 UI convenience，不是项目 runtime 入口语义。
- Block tree 是真相；Scene editor 只投影成 rows。
- 文本段落使用 `StoryTextSegment.textId`。编辑文本时不要随意重建 `textId`，否则会破坏未来 localization/voice/review 的稳定引用。
- `note` 是 Studio-only action；不要把它当 runtime block。
- `code` 是逃生口类型，inspector 支持源码编辑，但 action creator 的默认命令列表没有暴露它。

## Scene Editor 行为要点

- Tab id 形如 `story:scene:<storyId>:<sceneId>`。
- 行选择、draft、chooser、折叠、inspector tab、拖拽状态属于 editor/UI 状态，不应写入 `StoryDocument`。
- Clipboard 使用 `application/x-narraleaf-story-actions`；内部粘贴会重建 block id 和 textId。
- 外部纯文本粘贴可识别角色台词；`Ctrl+Shift+V` 走纯 narration。
- Action Creator 收藏 key 是 Studio/global setting：`story.actionCreator.starredActionIds`，写入 `global.json`，不写入 StoryDocument。
- `StorySceneEditorTabPayload` 有 `activeBlockId` 字段，但当前 active selection 没有稳定回写 payload，不能假设 session 会恢复最新 active block。

## 已知缺口

- Story package import/export 未实现。
- Active Stage Snapshot、StorySnapshotService、右侧舞台预览、舞台拖拽回写未实现。
- Preview Context、Start using override 未实现。
- Flow Map、route diagnostics、unreachable/dead-end/cycle 分析未实现。
- Story diagnostics panel/rules 未实现。
- Story runtime execution、Dev Mode story entry、Story to `narraleaf-react` TypeScript generation 未实现。
- Localization CSV、voice/review workflow、批量生产 Data Manager 未实现。
- 变量定义管理基本未落地；当前 inspector 只有 `setVariable` 的 key/scope/value 字段。
- Condition branch 当前主要是 expression 文本编辑，没有完整 variable condition builder。
- Plugin action registry 已在 `StoryService` 存在，但 action chooser/panel 还未接入 `listPluginActions()`。

## 修改建议

- 改 Story 数据结构时先补 `storyModel.test.ts`，再改 editor 投影。
- 新增 block 类型时同步检查：shared type、normalize/schema、`storyActionCommands.ts`、row renderer、inspector、clipboard clone、asset lock 收集。
- Scene editor 的键盘/拖拽/clipboard 行为容易互相影响，修复时优先确认 row 投影和 selection state，而不是直接改持久模型。
