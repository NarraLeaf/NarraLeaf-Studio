# Plugin 功能上下文

本文记录插件系统的当前真实状态和设计方向。当前仓库没有完整插件运行时，不要把设计文档里的能力当作已实现。

## 当前实现状态

- `Services.Plugin` 仍是注释状态，`ServiceRegistry` 没有注册 `PluginService`。
- `IPluginService` 只是空接口，没有对应 service class。
- Launcher 的 Plugins tab 是 placeholder。
- 安装授权窗口只展示 Studio 从结构化 install 权限项合成的权限文案；插件或 manifest 不能直接提供可显示的权限字符串。
- `ProjectNameConvention.Plugins` 预留了 `.nlstudio/plugins/`。
- `BlueprintNodeCatalogService` 注释和 API 支持 extension registration，但当前主要注册 built-in nodes。
- `StoryService` 已有 plugin action registry：`registerPluginAction()`、`unregisterPluginAction()`、`listPluginActions()`、`onPluginActionsChanged()`。
- Scene action UI 有 `plugin` category，但 action chooser/panel 尚未合并 `StoryService.listPluginActions()`。

## 设计方向

预期插件系统应由一个 renderer `PluginService` 编排，但对插件暴露 plugin-facing facades，而不是直接透传内部 service 实例。所有动态注册必须返回 disposer，并由插件生命周期统一回收。

计划中的主要能力包括：

- 插件发现、加载、激活、停用、卸载。
- 插件 manifest 校验。
- 插件入口脚本解析与注入。
- Workspace panel/action/editor tab/widget module/inspector/appearance/context menu 等 contribution points。
- Project、Assets、Dev Mode 等受控 facade。
- 主进程 plugin manager 与 preload plugin API。

## 建议入口

- Service enum/interface：`src/renderer/lib/workspace/services/services.ts`
- Registry：`src/renderer/lib/workspace/services/serviceRegistry.ts`
- Launcher placeholder：`src/renderer/apps/launcher/tabs/PluginsTab.tsx`
- Story plugin action registry：`src/renderer/lib/workspace/services/story/StoryService.ts`
- Story action UI：`src/renderer/apps/workspace/modules/story/scene-editor/storyActionCommands.ts`
- Blueprint node catalog：`src/renderer/lib/workspace/services/ui-editor/BlueprintNodeCatalogService.ts`
- Project path convention：`src/renderer/lib/workspace/project/nameConvention.ts`

## 实现前置检查

- 先补 `Services.Plugin`、`PluginService`、注册表、生命周期测试，再接 UI contribution。
- 插件 API 不应暴露内部 mutable document/service 实例；要做 facade 和权限边界。
- 插件注册 UI/Blueprint/Story 扩展时必须有 disposer，并在停用/卸载时回收。
- 若接入 Story action，必须同步 action creator、row creation、clipboard、asset lock 和未来 runtime 语义。
