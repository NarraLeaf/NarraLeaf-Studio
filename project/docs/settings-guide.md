# 添加与使用设置指南

本文档介绍如何在 NarraLeaf Studio 中添加新的设置项，以及如何在界面中展示和保存这些设置。核心思路是：通过统一的设置注册层定义结构、通过 `SettingsExplorer` 等通用 UI 渲染，并利用 `app.state`、`SettingsService` 等不同作用域完成持久化。

## 一、设置系统概览

1. **设置模型**  
   - `src/renderer/lib/settings/models.ts` 定义了 `SettingScope`（全局/项目/运行时）、`SettingDescriptor` 和 `SettingCategory` 等基础类型。新设置必须提供 `id`、`type`、`label`、`description`、`defaultValue`，枚举类型还需要 `options`。
2. **设置定义与分类**  
   - `src/renderer/lib/settings/appSettings.ts` 中以数组方式按模块（general/appearance/editor/workspace/sync/advanced）列出全局设置定义，每条 `AppSettingDefinition` 都有 `category` 表示所属的栏目，用于左侧导航。
3. **注册中心**  
   - `src/renderer/lib/settings/registry.ts` 提供 `getAppSettingCategories`、`getSettingsByCategory` 等接口。UI 接口通过这些方法获取分组顺序，提高可复用性并降低硬编码。
4. **共享 UI**  
   - `SettingsExplorer`（`src/renderer/apps/settings/components/SettingsExplorer.tsx`）封装了搜索、过滤、控制渲染、输入流控制与提交逻辑，支持 `Switch/Select/Input` 控件，并支持任意来源的设置数据。
5. **界面入口**  
   - `SettingsApp` 现在使用左侧分类导航 + `SettingsExplorer`，通过 `app.state`（全局）加载和保存值。
   - `SettingsPanel`（工作区内侧边栏）同样复用 `SettingsExplorer`，但使用 `SettingsService` 提供的运行时 schema 和保存逻辑，保持界面一致性。

## 二、新增设置流程（以添加“自动保存频率”举例）

1. **在 schema 中定义**  
   - 打开 `src/renderer/lib/settings/appSettings.ts`，在相应模块的 `AppSettings` 数组追加如下对象：
     ```ts
     {
         key: "workspace.autoSaveFrequency",
         category: "workspace",
         scope: SettingScope.Global,
         type: RuntimeSettingType.Integer,
         label: "自动保存频率",
         description: "以分钟为单位指定自动保存的间隔。",
         defaultValue: 5,
     }
     ```
   - 确保 `key` 在 `shared/types/state/globalState.ts` 的结构（如 `workspace.autoSaveFrequency`）和默认值中也有对应项，否则保存/读取时无法进行类型检查。
2. **更新 global state**  
   - 在 `shared/types/state/globalState.ts` 的 `GlobalStateStructure` 中将对应字段加入（如新增 `workspace` 中的 `autoSaveFrequency: number`），并在 `GLOBAL_STATE_DEFAULTS` 中填入默认值。
3. **控制器无需修改**  
   - 因为 UI 通过 `registry` 动态拿到所有 `AppSettingDefinition`，只要 `key`/`category`/`type` 定义完成，新的设置会出现在 `SettingsApp` 中相应分类。`SettingsExplorer` 自动渲染控制并调用保存回调。
4. **如果需要运行时设置**  
   - 新设置属于运行时（如项目作用域），应在 `src/renderer/lib/workspace/services/settings/settings.ts` 的 `RuntimeSettings` 中增加对应 category/setting，并通过 `SettingsService` 的 schema 注册后，工作区 `SettingsPanel` 会自动显示。

## 三、设置值的读取与写入

1. **全局设置（应用级）**  
   - 读取：`getInterface().app.state.getGlobalState("xxx")`；  
   - 保存：`getInterface().app.state.setGlobalState("xxx", value)`。  
   - `SettingsApp` 中统一封装在 `commitSetting`，确保保存后更新本地 `values` 缓存，页面再次渲染时能体现场景。
2. **运行时设置（项目级）**  
   - 通过 `SettingsService` 获取 `getSettings`、`getValue`，使用 `setValue` 写入，同时 `SettingsExplorer` 会收到 `pending` 状态反馈。
3. **项目设置（如 `.nlstudio/editor`）**  
   - 若需要更复杂的项目设置，可以复用 `ProjectSettingsService`，或者在 UI 中用新的 `Registry` 替换数据源。界面依旧可使用 `SettingsExplorer`，只需实现 `describeSetting`/`getValue`/`onCommit` 三个函数即可。

## 四、扩展建议与最佳实践

- **保持分类清晰**：`SettingCategory` 的 `order` 决定导航顺序，优先级高的项顺序靠前。
- **使用 `SettingDescriptor.options` 提供枚举选项，而非在 UI 中硬编码字符串**。
- **保持 `GlobalStateStructure` 与 `AppSettings` 同步**：添加字段后务必在 `globalState.ts` 的结构与默认值里更新，并执行 `yarn lint` 确保类型通过。
- **重用 `SettingsExplorer`**：无论是弹窗、侧边栏，还是未来的设置页面，只需提供三个函数即可快速接入新的设置集合。
- **提示与验证**：如需输入验证可在 `SettingsExplorer` 内扩展 `parseSettingInput` 或在保存前手动校验后再调用 `onCommit`。

## 五、示例：从代码角度快速查找

- 查看所有设置定义：`src/renderer/lib/settings/appSettings.ts`  
- 查看类别排序与查找 API：`src/renderer/lib/settings/registry.ts`  
- 查看 UI 渲染与输入控制：`src/renderer/apps/settings/components/SettingsExplorer.tsx`  
- 查看全局设置入口：`src/renderer/apps/settings/SettingsApp.tsx`  
- 查看运行时设置 schema：`src/renderer/lib/workspace/services/settings/settings.ts`  
- 查看 global state 类型/默认值：`src/shared/types/state/globalState.ts`

通过以上路径即可完整掌握新设置添加/展示/持久化的全流程。
