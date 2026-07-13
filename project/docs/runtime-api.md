# narraleaf-studio/runtime API 参考

runtime entry 的完整 host API。系统协议与加载链路见 [plugin.md](./plugin.md)，创建手册见 [create-plugin.md](./create-plugin.md)，studio entry 的 API 见 [studio-api.md](./studio-api.md)。

## 执行环境

runtime entry 在所有游戏执行环境加载，且在游戏 boot（NLR 挂载、首个蓝图执行）之前完成：

| 环境 | 加载来源 |
| --- | --- |
| Dev Mode 窗口 | IPC `plugin.runtimeList`（enabled + 声明 runtime entry − 项目依赖 suppression） |
| Preview / Production | pack `plugins` 段（编译时按项目依赖表挑选并复制） |

它是游戏代码：没有 Studio services、没有 `app.privileged`。网络访问由 pack 网络策略统一管控。宿主提供 React host externals（`react`、`react-dom`、`react/jsx-runtime`、`react/jsx-dev-runtime`）供 widget 渲染器使用；`react-dom/client` 刻意不提供——插件不得在游戏内挂载自己的 React root。

## 入口约定

```ts
import { defineRuntimePlugin } from "narraleaf-studio/runtime";

export default defineRuntimePlugin({
  setup(app) {
    // register runtime bindings
  },
});
```

- 必须默认导出 `defineRuntimePlugin({ setup })`；也接受 named export `plugin`。
- `setup` 返回 `void | Promise<void>`。游戏环境是进程级一次性加载，没有卸载生命周期，返回值被忽略。
- loader 按 `pluginId@version:entryUrl` 幂等缓存：StrictMode 双调用、Dev Mode live reload 都不会重复执行 `setup`。
- `setup` 抛错只影响当前插件：记录到宿主日志（Dev Mode console / runtime log），游戏照常启动。

## RuntimePluginApp

```ts
type RuntimePluginApp = {
  plugin: PluginIdentity;              // { id, name?, version?, publisher? }
  manifest: NormalizedPluginManifestV2;
  game: {
    blueprintNodes: {
      register(def: RuntimeBlueprintNodeDef): void;
      registerMany(defs: RuntimeBlueprintNodeDef[]): void;
    };
    widgets: {
      register(def: RuntimeWidgetRendererDef): void;
      registerMany(defs: RuntimeWidgetRendererDef[]): void;
    };
    log(level: "info" | "warning" | "error", message: string): void;
  };
};

type RuntimeBlueprintNodeDef = {
  type: string;
  displayName?: string;
  execute: BlueprintNodeExecuteFn;
};

type RuntimeWidgetRendererDef = {
  type: string;
  render: (props: ElementRendererProps) => ReactElement | null;
};
```

### game.blueprintNodes

注册蓝图节点的游戏侧 execute 绑定。行为约束：

- `type` 必须以插件 ID 为前缀（`${plugin.id}.`）。
- `type` 必须在 manifest `contributes.blueprintNodes` 中声明，否则注册抛错——静态校验（pack 编译）依赖 contributes 判断"项目用到的节点是否有运行时提供方"。
- 跨插件注册同名 type 抛错（该插件记为加载失败）。
- `register` 只读取 `type`、`displayName`、`execute`，可以直接传入与 studio entry 共享的完整 `BlueprintNodeDef` 对象（多余字段被忽略）。

execute 内通过执行上下文访问游戏宿主能力：

```ts
execute: async ctx => {
  const hostApi = ctx.hostAdapter.blueprintRuntime?.hostApi;
  await hostApi?.persistence.set(`${PLUGIN_ID}.key`, value);   // 跨存档持久化
  return { nextPort: "next" };
},
```

`ctx` 是共享行为图解释器的 `BehaviorNodeExecutionContext`：`params`（inspector 参数值）、`blueprintLocals`、`eventPayload`、`signal`（中断）、`trace` 等。执行语义（isLatent、回滚清理）由宿主的 blueprint 运行时统一处理。

### game.widgets

注册插件 widget 元素类型的游戏侧渲染器。宿主把它并入游戏的 `ElementRendererRegistry`（与内建 `nl.*` 渲染器同一注册表），当项目的 UI 文档中出现该 widget 元素时由宿主渲染。

- `type` 必须以插件 ID 为前缀，且必须在 manifest `contributes.widgets` 中声明。
- `render` 接收与内建元素渲染器相同的 `ElementRendererProps`（element/surface/document/hostAdapter/renderChildren/renderSurface/runtimeData 等）——与 studio 侧 `UIWidgetModule.render` 的签名一致，插件可以把 render 函数放进共享模块，两个 entry 复用同一实现。
- 内建类型永远优先；跨插件同名注册抛错。
- 渲染器使用 JSX 时，构建时把 `react`、`react/jsx-runtime` 作为 external，游戏环境经 import map 提供宿主 React 实例。

```tsx
import { defineRuntimePlugin } from "narraleaf-studio/runtime";
import { BadgeRenderer } from "./badge";   // 与 studio widget module 共享

export default defineRuntimePlugin({
  setup(app) {
    app.game.widgets.register({ type: `${app.plugin.id}.badge`, render: BadgeRenderer });
  },
});
```

### game.log

写入宿主日志，自动带 `[plugin:{id}]` 前缀。Dev Mode 输出到窗口 console；Preview/Production 经 runtime bridge 输出到游戏进程日志。

## 故事级逻辑的运行时模式

不存在独立的"story action 运行时执行器"——故事级插件逻辑的运行时路径是蓝图：

1. studio entry 注册蓝图节点（palette 元数据 + 编辑器预览 execute），runtime entry 注册同一批节点的游戏 execute。
2. 作者在故事中使用 Blueprint 块（`{action:"blueprint"}`），块内使用插件节点。
3. 游戏中该块编译为 NLR `Script` action，经共享行为图解释器执行插件节点——save/load/回退安全由现有 `ScriptCleaner` 机制保证。

studio entry 可以额外注册 palette 动作（`app.services.story.actions`，见 [studio-api.md](./studio-api.md)）帮作者一键插入预构造的故事块；这些块是标准故事块，文档不因此依赖插件。

## 限制

- 当前 API 面：`blueprintNodes` + `widgets` + `log`。transform 字段、transition 预设等扩展点等待核心先建立对应的预设系统（见设计文档决策记录）。
- runtime entry 必须自包含（单文件 ESM），不能在运行时 import 插件包内其他文件；React 相关包与 `narraleaf-studio/runtime` 除外（host external）。
- `react-dom/client` 不可用：插件不得在游戏内挂载自己的 React root。
- 无 cleanup、无跨插件依赖排序。

## 关键实现文件

- API 定义：`src/renderer/lib/ui-editor/runtime/plugins/runtimePluginApi.ts`
- loader：`src/renderer/lib/ui-editor/runtime/plugins/loadRuntimePlugins.ts`
- shim 源码：`src/shared/utils/pluginRuntimeApiModule.ts`
