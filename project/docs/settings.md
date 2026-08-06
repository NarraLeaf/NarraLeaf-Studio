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
- 成品游戏对玩家的行为：`app.autoSave`（自动保存开关 / 间隔 / 保留数量），写 `.nlproj`，由 `bundleAssembler` 烘焙进 bundle 交给游戏运行时。UI 在「项目 → 游戏」。
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

## `global.json` 里有四类东西，还原和导出都不能按整个文件来

这个文件混装了偏好、最近项目、每个工程的编辑器会话、每个工程的写作统计。实测一份真实
profile 是 96 个键，其中只有约 30 个是偏好。所以「还原设置」和「导出设置」都不能表述成
「文件里的全部内容」，必须按声明好的范围来，范围定义在两个地方：

- `src/shared/constants/settingsScopes.ts`：主进程也要用的部分——**受保护键**
  （`app.recentProjects`、`stats.project.*`，任何删除请求都会被 `AppGlobalStateDeleteHandler`
  拒绝）、**工作区布局键**（侧栏 / dock / editor session / uiEditor，自成一个还原范围）、
  以及没有设置行但确实是偏好的键。
- `src/renderer/lib/settings/settingsScope.ts`：跟 registry 有关的部分。哪些键是偏好只有
  `appSettings.ts` 知道，而它是渲染层模块，所以范围在渲染层算出来，主进程只负责拒绝。

### 还原 = 删除，不是写回默认值

新的 `app.globalState.delete` 通道（`GlobalStateManager.delete` → 广播 `value: undefined`）。
之所以不是「把默认值写回去」：有几个键**故意不在 `GLOBAL_STATE_DEFAULTS` 里**，它们的读取方
要自己算兜底——`editor.slashAtAlias` 按设备语言决定，`ui.background*` 要 clamp 和白名单。
只有「没有存值」才能走到那个兜底。以前没有删除通道，`clearAllProjectStats` 只能写空记录将就。

三个范围：单行（悬停出现，只在与默认值不同时出现）、`data.resetWorkspaceLayout`、
`data.resetAllPreferences`。

### 导出 = 带版本的文档，导入前先给出 diff

`src/shared/utils/settingsDocument.ts`。导入会**逐键按 registry 的描述符校验**（枚举成员、
min/max、值类型）——这个文件是作者能打开编辑的 JSON，手改过的文件是常态不是例外。本 build
不认识的键会列出来并跳过，不会写进 store。

两个开关（背景图、提交身份）**默认都是开的**：这个功能叫「在设备之间搬运设置」，到了那台机器
上你要的就是自己的壁纸和自己的署名。开关留着是给「把文件给别人」那种情况。

⚠ **`ui.backgroundImage` 存的是文件名不是路径**（`userData/backgrounds/` 里按内容哈希命名）。
所以导出必须**把图片本身一起带走**（文档里的 `wallpaper` 块，base64，上限 8MB），
导入时**先**经 `app.writeBackgroundImage` 把字节写回本机缓存**再**写那个键——顺序反了的话，
键一广播每个窗口就去读一个还不存在的文件。只默认开启而不带图片会比不带更糟：
另一台机器会拿到一个指向空气的壁纸设置。

⚠ **`sanitizeBundleFileName` 的扩展名集合是参数，不是默认值**。它原本是给诊断包写的、
硬编码 `.log`/`.txt`；设置导出复用它时静默继承，于是保存框提示的文件名是
`narraleaf-studio-settings.json.log`。每个调用点都要自己写清楚允许什么。

## 下载源与镜像

Studio 自己的下载分两类，不要混：

- **source**：下游工具会往上面拼路径的基址。`build.electronMirror`（electron-builder 拼
  `<mirror><version>/<file>`）、`build.electronBuilderBinariesMirror`（拼
  `<mirror><name>/<name>.7z`，布局不同所以是两个键）、两个 registry URL。
- **rewrite**：`network.downloadRewrites`，对**不是 Studio 选的地址**做前缀替换。插件的
  `.zip`、商店图标、插件构建依赖，这些地址是从目录文件里来的，任何 source 设置都够不着——
  这就是为什么只配 `plugins.registryUrl` 会得到「商店能浏览、装不上」。

解析器在 `src/shared/utils/downloadSource.ts`（纯函数，构建 worker 也要用），主进程侧的入口是
`managers/downloadRewrites.ts`。改写只允许 https，命中会往日志写一行 `原地址 -> 新地址`。

## 缓存

`src/main/app/application/managers/storage/cacheInventory.ts` 是**唯一**知道 Studio 在磁盘上留了
什么的地方。六个桶（electron-builder 缓存、插件构建依赖、Chromium 缓存、插件图标、PSD 导入
残留、日志），都保证「删掉只损失时间，不损失工作」。`backgrounds/`、`dev-mode-saves/`、
`plugins/`、`authorization/`、`signing/`、`state/` **不是缓存**，不在里面。

## 快速验证

- 修改 workspace layout / editor session / UI editor 状态后，确认 `global.json` 更新。
- 重开 Studio 后，确认这些状态从 `global.json` 恢复。
- 修改项目配置或项目内容后，确认对应项目文件更新，而不是 `global.json`。
- `rg -n "ProjectSettings|projectSettings|runtime_settings|appUserSettings|userSettings" src` 不应出现结果。

