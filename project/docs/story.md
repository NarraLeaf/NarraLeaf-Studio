# Story 功能上下文

本文定位 Workspace 的 Story 数据、编辑和运行链路。持久化模型在 `StoryService` 和 shared story types；行为验证使用对应测试与 Dev Mode。

## 当前实现

- 已有多 story library，每个 story 有独立 `StoryDocument`。
- 已有 chapter、scene、block tree 的创建、重命名、删除、移动和保存。
- 已有 Story panel，可管理 story/chapter/scene，并打开 scene editor tab。
- 已有 Scene editor，可按 block tree 渲染行，支持 inline 文本、插入、选择、多选、缩进、拖拽排序、折叠、删除、局部 undo/redo、clipboard、action creator、inspector。
- 已有 Story asset lock：背景、角色 asset、音频、dialogue voice asset 等引用会注册资产锁。
- Plugin actions 同时接入 Action Creator 与 slash chooser；`useStoryPluginActionCommands` 跟随注册变更。
- Story Action 快速编辑器（双击 action 行展开的紧凑 inline card）已覆盖绝大多数 action：dialogue、narration、choice/menu（choiceOption 支持 hiddenWhen/disabledWhen 条件）、setBackground（含 transition）、character、audio、image、text、layer、video、displayable（含 mask/clip/filter/darken/circleReveal/circleClose/wipe 视觉特效）、camera（含镜头效果）、nvl、setVariable、wait、control、jump、note。
- Transform 编辑支持 Preset ↔ Motion 双模式；Motion 模式使用 `MotionSelector`（仿项目资产选择器 + 鼠标 hover 实时动画预览），绑定 Story Motion 动画资产。
- Transition 编辑是预设驱动的类型化字段，可选种类由 `STORY_TRANSITION_KINDS`（`src/shared/types/story/document.ts`）定义，字段与编译器 `createTransition` 消费的 `props` 对齐。
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
- 文本段落使用 `StoryTextSegment.textId`。编辑文本时不要随意重建 `textId`，否则会破坏本地化、配音和版本比较的稳定引用。
- `note` 是 Studio-only action；不要把它当 runtime block。

## Scene Editor 行为要点

- Tab id 形如 `story:scene:<storyId>:<sceneId>`。
- 行选择、draft、chooser、折叠、inspector tab、拖拽状态属于 editor/UI 状态，不应写入 `StoryDocument`。
- Clipboard 使用 `application/x-narraleaf-story-actions`；内部粘贴会重建 block id 和 textId。
- 外部纯文本粘贴可识别角色台词；`Ctrl+Shift+V` 走纯 narration。
- Action Creator 收藏 key 是 Studio/global setting：`story.actionCreator.starredActionIds`，写入 `global.json`，不写入 StoryDocument。
- 行焦点、选择与滚动位置通过 `storyEditorSessionStore` 写入 `PanelStateService`；重新打开场景时恢复。显式导航传入的 `payload.activeBlockId` 优先于保存的焦点。

## 跨模块能力

- 场景快照由 `StoryService` 管理，选择与默认项在 `modules/story-snapshots/`。快照是可选的启动输入。
- 舞台预览与图层视图在 `scene-editor/preview/`，由 `useStoryScenePreviewController` 驱动。预览编辑仍通过领域服务提交。
- 故事流程图由 `modules/story-flow/` 构建，从 Story panel 打开为 editor tab。
- `lib/lint/rules/story.ts` 提供不可达场景、死路、调用循环等规则，报告通过 Problems 面板展示。
- 存档与全局变量由 `VariableRegistryService` 管理，场景局部变量由场景声明行管理。
- 本地化与配音分别由 `LocalizationService`、`VoiceService` 管理，使用故事的稳定 `textId`。
- `runtime/app/ChoiceSlotSurface.tsx` 使用 `GameMenu`、`useUIMenuContext` 渲染运行时选项。

## 格式与可用范围

- `.story` 是 `project/app/story.js` 使用的工具格式，查询和编辑先读 `project/app/story.md`。
- 普通作者使用行编辑器与现有文本导入导出流程。
- NarraLang 的脚本视图、解析和回写属于开发 checkout 的实验能力，入口统一由 `narralangUiEnabled` 控制，启用参数为 `--experimental --x-narralang`。打包版 Studio 拒绝实验模式。
- 单个故事没有独立的打包导入导出；项目整体的 `.nlspkg` 导入导出是另一项功能。

## 修改建议

- 改 Story 数据结构时先补 `storyModel.test.ts`，再改 editor 投影。
- 新增 block 类型时同步检查：shared type、normalize/schema、`storyActionCommands.ts`、row renderer、inspector、clipboard clone、asset lock 收集。
- Scene editor 的键盘/拖拽/clipboard 行为容易互相影响，修复时优先确认 row 投影和 selection state，而不是直接改持久模型。
