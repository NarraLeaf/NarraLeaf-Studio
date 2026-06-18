# Workspace UI 功能上下文

本文描述 Workspace shell 的关键机制：panel、editor tab、focus、dialog、notification、action/keybinding 和 session restore。它不描述 UI surface 编辑器本身；UI Editor 见 `project/docs/ui-editor.md`。

## 当前实现

- `UIService` 是 Workspace UI 的中心 service，内部持有一个 `UIStore`，并暴露 notifications、actionBar、panels、editor、dialogs、statusBar、focus、keybindings 等子服务。
- `RegistryProvider` 是 React 层的便利 wrapper，实际状态仍来自 `UIStore`。
- `useModuleLoader()` 注册 built-in panels、actions、action groups、panel keybindings。
- Workspace layout 已有 left/right sidebar、bottom panel、main editor area、action bar、dialog overlay、notification container。
- Editor 主路径是 group-aware `editorLayout`，支持打开、关闭、聚焦、批量关闭 tab。
- `workspaceEditorSession.ts` / `useWorkspaceEditorSession.ts` 负责保存和恢复可序列化 editor tabs。
- Dialog 支持 confirm、alert、自定义 dialog；QuickPick/InputBox API 仍是 placeholder。

## 入口文件

- App shell：`src/renderer/apps/workspace/WorkSpaceApp.tsx`
- Layout：`src/renderer/apps/workspace/components/layout/WorkspaceLayout.tsx`
- Main editor area：`src/renderer/apps/workspace/components/layout/MainEditorArea.tsx`
- Editor group：`src/renderer/apps/workspace/components/layout/EditorGroup.tsx`
- Sidebars：`src/renderer/apps/workspace/components/layout/LeftSidebar.tsx`、`RightSidebar.tsx`
- Bottom panel：`src/renderer/apps/workspace/components/layout/BottomPanel.tsx`
- Registry：`src/renderer/apps/workspace/registry/Registry.tsx`
- Registry types：`src/renderer/apps/workspace/registry/types.ts`
- Built-in modules：`src/renderer/apps/workspace/modules/registry.ts`
- Module loader：`src/renderer/apps/workspace/hooks/useModuleLoader.tsx`
- UI service：`src/renderer/lib/workspace/services/core/UIService.ts`
- UI store：`src/renderer/lib/workspace/services/ui/UIStore.ts`
- UI sub-services：`src/renderer/lib/workspace/services/ui/`
- Session：`src/renderer/apps/workspace/session/workspaceEditorSession.ts`
- Session hook：`src/renderer/apps/workspace/hooks/useWorkspaceEditorSession.ts`

## UIStore 与 Registry

- `UIStore` 是 Workspace UI 状态真源，保存 notifications、panels、panel visibility、dialogs、actions、action groups、selection、editor layout。
- `RegistryProvider` 通过 hooks 订阅 `UIStore`，并提供 React 组件更方便使用的 register/open/close API。
- 新增 panel/action/actionGroup 时可走 module registration；运行时扩展也应最终进入 `UIStore`。
- `UIStore.editorTabs` / `activeEditorTabId` 是旧 flat tab 状态；当前 Workspace 主要看 `editorLayout`。

## Editor Tab 机制

- 当前主路径是 `UIStore.openEditorTabInGroup()`、`closeEditorTabInGroup()`、`setActiveEditorTabInGroup()`。
- `UIService.editor.open()` 已路由到 group-aware API，但 `EditorService.close()`、`getAll()` 等仍读写旧 flat tab 状态；处理当前 Workspace tab 时优先使用 Registry 或 `UIStore` 的 group-aware API。
- Tab 定义使用 `EditorTabDefinition`，通常包含 `id`、`title`、`component`、`payload`、`closable`、`modified` 等。
- Workspace 已有 VS Code 风格的 editor quick switch：`Ctrl+Tab` / `Ctrl+Shift+Tab` 在所有 group-aware editor tabs 间按运行时 MRU 顺序切换，按住 `Ctrl` 显示列表，松开 `Ctrl` 激活高亮项，`Esc` 取消；该状态不持久化。
- 新增可恢复 tab 时必须补 `workspaceEditorSession.ts` 的 serialize/restore 逻辑。
- 当前 session restore 主要支持 root 为单一 editor group 的布局；不要假设 split layout 已完整持久化。

## Focus 与 Keybinding

- Focus 真源是 `FocusManager`，focus context 包括 area 和 targetId。
- 打开/激活 editor tab 时 Registry 会把 focus 设置到 `FocusArea.Editor`。
- Dialog 打开时 focus 切到 `FocusArea.Dialog`，关闭时从 focus stack 恢复之前焦点。
- `KeybindingService` 在 `UIService.init()` 启动；action 和 action group 的 shortcut 会由 `UIStore` 自动注册。
- 需要键盘行为时检查 `when`、`allowInEditable` 和 `keyboardEditable.ts`，避免在输入框中吞掉文本编辑快捷键。
- `WorkspaceEditorQuickSwitch` 是全局 overlay，但仍通过现有 keybinding service 注册；它设置 `allowInEditable: true`，因为 `Ctrl+Tab` 需要从文本编辑控件中切换 editor tab。

## Dialog / Notification / Status

- `DialogService.confirm()` 和 `alert()` 已可用。
- `DialogService.show()` / `showAndWait()` 可用于自定义 React content。
- `showQuickPick()` 和 `showInputBox()` 目前只创建空 content dialog，没有真实 QuickPick/InputBox 组件。
- Notification 走 `NotificationService`，UI 容器在 `src/renderer/apps/workspace/components/ui/NotificationContainer.tsx`。
- `StatusBarService` 有 store/API，但 Workspace layout 中没有完整 status bar UI；不要把 status bar item 当作可见能力。

## Panel 与 PanelState

- Panel 注册信息来自 built-in modules，通过 `useModuleLoader()` 进入 `UIStore.registerPanel()`。
- Panel 可放在 left/right/bottom 等位置，visibility 存在 `UIStore.panelVisibility`。
- 需要跨打开保存的 panel 内部状态时使用 `PanelStateService`，不要把 panel 私有 UI 状态塞进 feature document。
- `PanelStateService` 使用 `panel_state` namespace，并 debounce 保存。

## Selection 与资产联动

- `UIStore.selection` 是 Workspace 级 selection，当前类型包括 asset、character、element、scene 或 null。
- `UIService` 监听 `AssetsService` 删除/更新事件：删除选中资产时清空 selection，并关闭相关 preview tab；更新选中资产时浅拷贝刷新 selection。
- 功能模块自己的编辑态仍应保留在对应 service 或组件状态中，不要把复杂 domain state 塞到全局 selection。

## 已知缺口

- QuickPick/InputBox 没有真实 UI。
- Status bar UI 未完整挂载。
- Welcome tab 自动打开逻辑仍被注释。
- 部分 placeholder module 仍存在，例如 Localization、Running Tasks。
- 旧 flat editor tab API 仍保留，容易和当前 group-aware layout 混淆。
- Split editor layout 的 session restore 不完整。

## 修改建议

- 新增 Workspace tab：先定义稳定 tab id 和 payload，再补 session serialize/restore。
- 新增全局快捷键：优先通过 action/actionGroup shortcut 或 `KeybindingService.registerMany()`，并设置正确 `when` / `allowInEditable`。
- 新增 editor tab 切换行为：使用 group-aware `editorLayout` 和 Registry 的 `setActiveEditorTab(tabId, groupId)`；不要回退到旧 flat `activeEditorTabId`。
- 新增 dialog：简单确认用 confirm/alert，复杂 UI 用 custom content；不要调用 QuickPick/InputBox 后假设已有真实选择器。
- 改 panel 状态：可恢复的 panel 私有 UI 状态放 `PanelStateService`，持久业务数据放对应 domain service。
