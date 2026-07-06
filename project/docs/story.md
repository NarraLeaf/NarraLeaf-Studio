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
- Story Action 快速编辑器（双击 action 行展开的紧凑 inline card）已覆盖绝大多数 action：dialogue（含 pauseAfter）、narration、choice/menu（choiceOption 支持 hiddenWhen/disabledWhen 条件）、setBackground（含 transition）、character、audio、image、text、layer、video、displayable（含 mask/clip/filter/darken/circleReveal/circleClose/wipe 视觉特效）、nvl、screenEffect、setVariable、wait、control、jump、code、note。
- Transform 编辑支持 Preset ↔ Motion 双模式；Motion 模式使用 `MotionSelector`（仿项目资产选择器 + 鼠标 hover 实时动画预览），绑定 Story Motion 动画资产。
- Transition 编辑是预设驱动的类型化字段：dissolve / fadeIn(startPos) / maskCircle(center/from/to) / maskWipe(direction/reverse)，与编译器 `createTransition` 消费的 `props` 对齐。
- Dialogue/narration/choice/note 支持富文本：`StoryTextSegment.rich`（bold/italic/color/ruby/cps/fontSize 标记 + 内联 Pause），编辑行上方有一个会话级共享（不落盘）的浮动富文本工具条。`value` 始终是纯文本投影，向后兼容。
- Story 编译器已实现：`compileStudioStoryToNlr`（`src/renderer/lib/ui-editor/runtime/game/storyCompiler.ts`）把 scene 编译成 narraleaf-react 运行时对象，接入 `GameApp`，可在 Dev Mode preview 中真机运行（含 transition、motion transform、富文本 Sentence/Word/Pause、displayable 特效等）。

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
- 富文本模型/编辑器：`richText.ts`、`RichTextInput.tsx`、`RichTextToolbar.tsx`（同目录）
- 会话级 UI 状态（富文本工具条展开态）：`storyEditorSessionStore.ts`（同目录）
- Motion 选择器（hover 预览）：`src/renderer/apps/workspace/modules/story-motion/MotionSelector.tsx`
- 编译器：`src/renderer/lib/ui-editor/runtime/game/storyCompiler.ts`（测试：`storyCompiler.integration.test.ts`）
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
- Story 运行时编译（→ narraleaf-react 运行时对象）与 Dev Mode preview 已实现；但 Story 导出为 `narraleaf-react` TypeScript 源码仍未实现。
- 富文本工具条当前只暴露 bold/italic/color/pause；ruby/cps/fontSize 已在数据模型与编译器中支持，工具条控件是后续项。
- 运行时 Game UI Menu（choice 渲染面）依赖尚未发布的 NLR 接口（`GameMenu`/`useUIMenuContext`/`ChoiceEvaluated`）；`ChoiceSlotSurface.tsx` 中以 `TODO(nlr-gameui)` 临时打桩，choice slot 在依赖发布前处于惰性状态。
- Localization CSV、voice/review workflow、批量生产 Data Manager 未实现。
- 变量定义管理基本未落地；当前 inspector 只有 `setVariable` 的 key/scope/value 字段。
- Condition branch 当前主要是 expression 文本编辑，没有完整 variable condition builder。
- Plugin action registry 已在 `StoryService` 存在，但 action chooser/panel 还未接入 `listPluginActions()`。

## 修改建议

- 改 Story 数据结构时先补 `storyModel.test.ts`，再改 editor 投影。
- 新增 block 类型时同步检查：shared type、normalize/schema、`storyActionCommands.ts`、row renderer、inspector、clipboard clone、asset lock 收集。
- Scene editor 的键盘/拖拽/clipboard 行为容易互相影响，修复时优先确认 row 投影和 selection state，而不是直接改持久模型。
