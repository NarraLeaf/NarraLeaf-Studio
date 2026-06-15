# Settings 功能上下文

Studio/editor 偏好现在只有一套设置存储：Electron `userData/state/global.json`。

项目自身仍然有项目配置和项目内容设置；它们属于项目数据，不属于 Studio 设置存储。

开发模式下，主进程把 `userData` 指到 `.dev/temp/userData-dev/`，所以开发路径是：

`NarraLeaf-Studio\.dev\temp\userData-dev\state\global.json`

## 存储模型


| 范围                  | 入口                                                                  | 存储                                                                                    |
| ------------------- | ------------------------------------------------------------------- | ------------------------------------------------------------------------------------- |
| 应用全局设置              | `getInterface().app.state.*` / `GlobalStateManager`                 | `userData/state/global.json`                                                          |
| Workspace/editor 设置 | `GlobalSettingsService`                                             | 同一个 `global.json`                                                                     |
| Settings 窗口设置       | `SettingsApp` + `app.state.getGlobalState/setGlobalState`           | 同一个 `global.json`                                                                     |
| 项目配置                | `ProjectService` / project wizard / project config helpers          | 项目根 `.nlproj`，legacy fallback 为 `project.json`                                        |
| 项目内容设置              | 对应功能 service，例如 `StoryService`、`UIDocumentService`、`UIGraphService` | 项目内功能文件，例如 `editor/story/index.json`、`editor/ui/uidoc.json`、`editor/ui/uigraphs.json` |


不要再新增 project settings、workspace runtime settings、service-specific settings namespace。编辑器 UI 状态、workspace layout、editor session、UI editor viewport/snap/outline cache、Story action 收藏等，都走 `GlobalSettingsService`，最终写到 `global.json`。

这里的“项目配置/项目内容设置”指会随项目一起移动、导出或影响项目运行语义的数据。它不包括 Studio 如何显示这个项目、当前打开了哪些 tab、侧栏宽度、编辑器缩放、收藏了哪些编辑器命令这类 editor preference。

## 调用路线

普通 app/global 设置：

`renderer`
→ `getInterface().app.state.getGlobalState/setGlobalState/getAllGlobalState`
→ preload IPC
→ `AppGlobalStateGetHandler` / `AppGlobalStateSetHandler` / `AppGlobalStateGetAllHandler`
→ `GlobalStateManager`
→ `PersistentState`
→ `userData/state/global.json`

Workspace/editor 设置：

`WorkspaceLayout` / `useWorkspaceEditorSession` / `UIEditorStateService` / `StoryActionCreatorPanel`
→ `GlobalSettingsService`
→ `getInterface().app.state.*`
→ 同一条 `GlobalStateManager` 路线
→ `global.json`

项目配置：

`ProjectService`
→ 读取项目根 `.nlproj`，找不到时 fallback 到 legacy `project.json`
→ 返回 `ProjectConfig`

项目内容设置：

`StoryService` / `UIDocumentService` / `UIGraphService` 等功能 service
→ 读写各自项目文件
→ 项目目录内 JSON / asset / script 文件

## 入口文件

- Renderer global settings wrapper：`src/renderer/lib/workspace/services/GlobalSettingsService.ts`
- Main global state：`src/main/app/application/managers/storage/globalState.ts`
- Global state types/defaults：`src/shared/types/state/globalState.ts`
- IPC types：`src/shared/types/ipcEvents.ts`
- Preload bridge：`src/main/preload/ipc/interface.ts`
- Settings app registry：`src/renderer/lib/settings/appSettings.ts`
- Project config reader：`src/renderer/lib/workspace/services/core/ProjectService.ts`
- Project path conventions：`src/renderer/lib/workspace/project/nameConvention.ts`
- Story project content：`src/renderer/lib/workspace/services/story/StoryService.ts`
- UI project content：`src/renderer/lib/workspace/services/ui-editor/UIDocumentService.ts`、`src/renderer/lib/workspace/services/ui-editor/UIGraphService.ts`

## 项目设置边界

可以写项目文件的内容：

- 项目身份和元数据：name、identifier、metadata、resolution 等，写 `.nlproj` / legacy `project.json`。
- 会影响项目运行或导出的内容：story library、story document、UI document、UI graph、asset metadata、scripts。
- 项目内容内部的业务选择：例如 `editor/story/index.json` 里的 `defaultStoryId`，它是项目 story library 的 convenience 字段。

必须写 `global.json` 的内容：

- Studio/workspace UI 状态：侧栏显隐、宽度、active panel、bottom panel 高度。
- Editor session：当前打开的 workspace editor tabs。
- UI editor 编辑态：viewport、smart snap、outline collapse、inspector cache。
- 用户偏好：主题、语言、字体、soft wrap、auto save、最近项目列表。
- 编辑器工具偏好：Story Action Creator 收藏等。

判断规则：

- 会随项目交给另一个用户、影响项目 runtime/export，写项目文件。
- 只影响当前用户如何使用 Studio，写 `global.json`。
- 不要把“项目设置”实现成独立 settings store；项目设置就是项目内容文件的一部分。

## 快速验证

- 修改 workspace layout / editor session / UI editor 状态后，确认 `global.json` 更新。
- 重开 Studio 后，确认这些状态从 `global.json` 恢复。
- 修改项目配置或项目内容后，确认对应项目文件更新，而不是 `global.json`。
- `rg -n "ProjectSettings|projectSettings|runtime_settings|appUserSettings|userSettings" src` 不应出现结果。

