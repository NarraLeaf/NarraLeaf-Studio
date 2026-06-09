# NarraLeaf Studio 设置项添加指南

本文档面向负责改动设置系统的 agent。目标是避免设置窗口出现“能保存但不会改变任何行为”的占位项。

## 基本原则

1. 只有真实落地的设置才能出现在设置 UI 中。
2. “真实落地”表示生产代码会读取该设置值，并把它应用到用户可观察的行为、渲染、服务逻辑或工作流中。
3. 只写入持久化存储、只能在 UI 中切换、只在类型里声明，都不算真实落地。
4. 新设置必须和它的消费代码在同一个改动中提交，除非任务明确要求先做底层能力且不暴露 UI。

## 当前设置入口

应用级设置：

- 定义文件：`src/renderer/lib/settings/appSettings.ts`
- 注册读取：`src/renderer/lib/settings/registry.ts`
- UI 入口：`src/renderer/apps/settings/SettingsApp.tsx`
- 共享渲染：`src/renderer/apps/settings/components/SettingsExplorer.tsx`
- 存储类型：`src/shared/types/state/globalState.ts`
- 存储 API：`getInterface().app.state.getGlobalState` / `setGlobalState`

工作区运行时设置：

- 定义文件：`src/renderer/lib/workspace/services/settings/settings.ts`
- 服务：`src/renderer/lib/workspace/services/core/SettingsService.ts`
- UI 入口：`src/renderer/apps/workspace/modules/settings/SettingsPanel.tsx`
- 存储位置：workspace service assets store，namespace 为 `runtime_settings`

项目编辑器设置：

- 服务：`src/renderer/lib/workspace/services/ProjectSettingsService.ts`
- 常见用途：编辑器布局、面板状态、UI editor viewport、打开的 tab session 等项目级偏好。
- 这类设置通常不需要进入 `SettingsExplorer`，除非用户确实需要手动配置。

## 添加设置前的判断

先回答这几个问题：

1. 这个设置改变什么真实行为？
2. 哪段生产代码会读取它？
3. 默认值应该在哪里生效？
4. 作用域是什么：全局应用、当前 workspace runtime，还是项目级编辑器状态？
5. 用户修改后是否需要立即生效，还是下次加载生效？
6. 是否需要迁移旧值、清理旧 key，或兼容缺失值？

如果第 1 和第 2 个问题没有明确答案，不要添加设置 UI。

## 应用级设置添加流程

应用级设置适合跨项目生效的用户偏好，例如应用外观、全局快捷行为、全局编辑器偏好。不要把项目内容、workspace 状态或调试开关塞进应用级设置。

1. 在 `src/shared/types/state/globalState.ts` 增加类型字段和默认值。

示例：

```ts
export interface GlobalStateStructure {
    app: {
        recentProjects: RecentlyOpenedProject[];
    };
    editor: {
        confirmBeforeBulkDelete: boolean;
    };
}

export const GLOBAL_STATE_DEFAULTS: Partial<GlobalStateType> = {
    "app.recentProjects": [],
    "editor.confirmBeforeBulkDelete": true,
};
```

2. 在真实消费代码中读取该设置。

示例：

```ts
const result = await getInterface().app.state.getGlobalState("editor.confirmBeforeBulkDelete");
const shouldConfirm = result.success ? result.data.value : true;
```

如果消费点在 main process，使用 `GlobalStateManager` 或已有 manager 注入方式读取，不要从 renderer 绕 IPC 反向取值。

3. 在 `src/renderer/lib/settings/appSettings.ts` 注册 UI 定义。

示例：

```ts
{
    key: "editor.confirmBeforeBulkDelete",
    category: "editor",
    scope: SettingScope.Global,
    type: RuntimeSettingType.Boolean,
    label: "Confirm before bulk delete",
    description: "Ask for confirmation before deleting multiple editor items.",
    defaultValue: true,
}
```

4. 确认 `AppSettingCategories` 已有合适分类。

如果需要新分类，同时更新：

- `src/renderer/lib/settings/appSettings.ts`
- `src/renderer/lib/settings/models.ts` 中的 `AppSettingCategoryKey`

5. 验证设置 UI 和消费行为。

必须验证：

- 设置出现在 `SettingsApp` 的正确分类中。
- 修改设置后，实际功能立即或按设计时机使用新值。
- 重启应用或重新打开窗口后，持久化值仍生效。

## 工作区运行时设置添加流程

运行时设置适合当前 workspace 内的服务行为，例如项目安全策略、预览行为、资源加载策略。它们通过 `SettingsService` 管理。

1. 在 `src/renderer/lib/workspace/services/settings/settings.ts` 添加 schema。

示例：

```ts
{
    type: RuntimeSettingType.Boolean,
    name: "security.allowRemoteResource",
    label: "Allow remote resources",
    description: "Allow workspace assets to load remote resources.",
    defaultValue: false,
}
```

2. 在真实服务中读取设置值。

示例：

```ts
const settings = ctx.services.get<SettingsService>(Services.Settings);
const allowRemote = settings.getValue<RuntimeSettingType.Boolean>("security.allowRemoteResource") ?? false;
```

3. 如果这个设置控制安全、网络、文件写入或脚本执行，默认值必须保守。

4. 如果要新增分类，更新 `RSCategories` 和 `RuntimeSettings`。

5. 确认 workspace 设置面板只显示有设置项的分类。

## 项目级编辑器设置添加流程

项目级编辑器设置适合“跟项目走”的编辑状态，例如 sidebar 宽度、editor tab session、UI editor viewport。

优先使用 `ProjectSettingsService`：

```ts
const settingsService = context.services.get<ProjectSettingsService>(Services.ProjectSettings);
await settingsService.set("uiEditor.viewport", viewport);
const restored = await settingsService.get("uiEditor.viewport");
```

要求：

- key 必须有清晰命名空间，例如 `uiEditor.viewport`、`workspace.editorSession`。
- 读取失败或值缺失时必须有本地默认值。
- 保存频率高的设置需要 debounce 或只在稳定时写入。
- 不要默认暴露在设置窗口中；只有用户需要手动控制时才接入 `SettingsExplorer`。

## 枚举、数字和校验

枚举设置：

- `options` 只能包含真实支持的值。
- UI 文案不能承诺尚未实现的模式。
- 消费代码必须处理未知旧值，并回退到默认值。

数字设置：

- 必须明确单位，例如 px、ms、minutes。
- 必须设置合理边界。应用级设置可在提交前校验；运行时设置可使用 schema 的 `validation`。

示例：

```ts
validation: value => {
    if (value < 1 || value > 60) {
        return "Value must be between 1 and 60.";
    }
    return true;
}
```

布尔设置：

- label 写成明确动作或状态。
- description 写清启用后的效果。
- 不要添加未来才会生效的开关。

## 反占位检查

提交前对新增 key 做全文搜索：

```powershell
rg -n "your.setting.key|settingName" src project -S
```

一个合格设置至少应该出现于：

- schema 或 global state 类型定义
- 默认值或注册定义
- UI 注册定义，除非该设置不暴露 UI
- 生产消费代码
- 测试或验证路径，视风险决定

如果搜索结果只出现在 `appSettings.ts`、`settings.ts`、`globalState.ts` 或文档里，这个设置就是占位项，必须移除或补上真实消费代码。

## 验证命令

至少运行：

```powershell
yarn tsc --project src/renderer/tsconfig.json
```

如果改了 shared 或 main 类型，也运行：

```powershell
yarn tsc --project src/shared/tsconfig.json
yarn tsc --project src/main/tsconfig.json
```

如果设置影响业务逻辑，运行相关测试；没有现成测试时，补一个聚焦测试或记录手动验证路径。

## 删除设置

删除未落地或废弃设置时：

1. 从 UI schema 中删除定义。
2. 从 global state 类型和默认值中删除不再使用的 key。
3. 从 runtime settings schema 中删除不再使用的 setting。
4. 删除消费代码中已废弃的读取逻辑。
5. 视持久化存储策略决定是否需要迁移旧数据。对于无害旧 key，可以让它留在用户本地存储中，但类型和 UI 不应继续暴露它。

## Agent 交付清单

完成设置相关任务时，在最终回复中说明：

- 新增、修改或删除了哪些设置 key。
- 每个保留设置对应的真实消费位置。
- 是否更新了 `globalState.ts`、`appSettings.ts`、runtime settings 或 `ProjectSettingsService` 调用点。
- 运行了哪些验证命令，以及是否有无关的既有失败。
