# Create a NarraLeaf Studio Plugin

本文给其他 agent 一份直接可执行的插件创建手册。不要在插件里解释系统原理；只创建一个本地、预打包的 ESM 插件包。

## 快速规则

- 插件目录根部必须有 `manifest.json`（`manifestVersion: 2`）。
- 插件按执行环境（target）声明入口：`entries.studio`（workspace 编辑器扩展）和 `entries.runtime`（游戏执行环境逻辑），至少声明一个。
- studio 入口必须是 ESM，默认导出 `definePlugin({ setup(app) {} })`，从 `narraleaf-studio/plugin` 导入 API。
- runtime 入口必须是 ESM，默认导出 `defineRuntimePlugin({ setup(app) {} })`，从 `narraleaf-studio/runtime` 导入 API。
- Studio 只加载 manifest 声明的 entry 文件；开发者必须自己打包源码和依赖，每个 entry 都是自包含单文件。
- studio 入口的 React 相关包使用 Studio host external；runtime 入口不提供 React。
- 所有插件贡献的 ID、widget type、blueprint node type、action id、panel id、keybinding id 都必须以插件 ID 为前缀。
- 不要 import `@/...`、preload、`getInterface()`、Electron API 或 Node API。studio 入口需要特权能力时用 `app.privileged`；runtime 入口没有特权能力。

## 文件结构

最小插件包（仅 studio 扩展）：

```text
my-plugin/
  manifest.json
  main.js
```

带游戏运行时逻辑与构建源码的插件包：

```text
my-plugin/
  manifest.json
  main.js          ← studio entry（构建产物）
  runtime.js       ← runtime entry（构建产物）
  assets/
  src/
    nodes.ts       ← 双端共享的蓝图节点定义（单一来源）
    main.tsx
    runtime.ts
  package.json
  tsconfig.json
  vite.config.ts
```

安装时选择插件包目录。Studio 会复制整个目录到 `userData/plugins/{pluginId}`，但只按 manifest 加载声明的 entry 文件。

## manifest.json

```json
{
  "manifestVersion": 2,
  "id": "acme.panel-tools",
  "name": "Panel Tools",
  "version": "1.0.0",
  "publisher": "Acme",
  "description": "Workspace tools for NarraLeaf Studio.",
  "entries": {
    "studio": "main.js",
    "runtime": "runtime.js"
  },
  "contributes": {
    "blueprintNodes": ["acme.panel-tools.use-item"]
  },
  "permissions": [
    {
      "kind": "filesystem",
      "path": "/absolute/path/to/allowed-folder",
      "mode": "readwrite",
      "recursive": true
    }
  ]
}
```

Manifest 字段：

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `manifestVersion` | `2` | 必须是 `2`。 |
| `id` | `string` | 必须是小写命名空间 ID，例如 `publisher.plugin-name`。 |
| `name` | `string` | 插件名称。 |
| `version` | `string` | `x.y.z` 格式，可带 prerelease/build 后缀。 |
| `publisher` | `string` | 可选。 |
| `description` | `string` | 可选。 |
| `entries` | `{ studio?: string; runtime?: string }` | 至少声明一个 target；每个值必须是包内相对路径。未知 key 会被拒绝。 |
| `contributes` | `{ blueprintNodes?: string[]; widgets?: string[] }` | 插件提供的蓝图节点 / widget type 声明（必须以插件 ID 为前缀）。注册未声明的类型会抛错；打包时 Studio 用它静态校验项目用到的类型是否有运行时提供方。省略等同空数组。 |
| `permissions` | `PluginInstallPermission[]` | 可选，默认 `[]`。仅作用于 studio 入口。 |

entry 不能是绝对路径，不能包含 `..`、`.`、空字节、`?` 或 `#`。声明的入口文件必须实际存在。

权限字段：

```ts
type PluginInstallPermission =
  | {
      kind: "filesystem";
      path: string;
      mode: "read" | "write" | "readwrite";
      recursive: boolean;
    }
  | {
      kind: "api";
      capability: string;
    };
```

当前可实际用于插件特权 facade 的 API capability：

| capability | 说明 |
| --- | --- |
| `bash.execute` | 授权检查已接入；V1 handler 当前仍返回未实现。 |

以下 capability 是 Studio 内部权限窗口和后续能力保留项，不要让普通插件声明：

```text
plugin.permission.grant
plugin.trust.grant
plugin.fs.grant
plugin.install.approve
```

文件系统权限的 `path` 是真实路径字符串。授权按 `pluginId@version` 保存；插件版本号改变后需要用户重新授权。

## main.js（studio entry）

最小入口：

```ts
import { definePlugin } from "narraleaf-studio/plugin";

export default definePlugin({
  setup(app) {
    app.services.ui.notifications.info(`${app.manifest.name} loaded`);
  },
});
```

带清理函数：

```ts
import { definePlugin } from "narraleaf-studio/plugin";

export default definePlugin({
  setup(app) {
    const disposeKeybinding = app.services.ui.keybindings.register({
      id: `${app.plugin.id}.hello`,
      key: "cmd+shift+h",
      description: "Show plugin greeting",
      handler: () => {
        app.services.ui.notifications.success("Hello from plugin");
      },
    });

    return () => {
      disposeKeybinding();
    };
  },
});
```

`setup` 可返回：

```ts
void
Promise<void>
() => void | Promise<void>
Promise<() => void | Promise<void>>
```

## runtime.js（runtime entry）

runtime 入口在 Dev Mode 窗口、Preview 和打包后的游戏中执行，用于注册蓝图节点的 `execute` 绑定和插件 widget 的游戏渲染器。它没有 Studio services、没有特权能力；`setup` 返回值被忽略（游戏环境没有卸载生命周期）。

```ts
import { defineRuntimePlugin } from "narraleaf-studio/runtime";
import { createNodes } from "./nodes";
import { BadgeRenderer } from "./badge";

export default defineRuntimePlugin({
  setup(app) {
    app.game.blueprintNodes.registerMany(createNodes());
    app.game.widgets.register({ type: `${app.plugin.id}.badge`, render: BadgeRenderer });
    app.game.log("info", "runtime bindings registered");
  },
});
```

`app.game.blueprintNodes.register` 只读取 `type`、`displayName`、`execute` 三个字段，所以可以直接传入与 studio 入口共享的完整 `BlueprintNodeDef` 对象。node type 必须以插件 ID 为前缀。

推荐把节点定义放进 `src/nodes.ts` 由两个入口共同 import：studio 入口注册完整定义（palette + 编辑器预览），runtime 入口注册游戏 execute。这样 execute 逻辑只写一次。内建 Gallery 插件（`src/builtin-plugins/gallery/`）是参照实现。

execute 内通过执行上下文访问游戏宿主能力（如 persistence）：

```ts
execute: async ctx => {
  const hostApi = ctx.hostAdapter.blueprintRuntime?.hostApi;
  await hostApi?.persistence.set(`${PLUGIN_ID}.key`, value);
  return { nextPort: "next" };
},
```

## 构建要求

如果用 TypeScript 或 React 编写插件，把源码按 target 打包为独立的 ESM 入口。Studio 会提供 `narraleaf-studio/plugin`、`narraleaf-studio/runtime` 和 React host runtime；这些包必须 external，避免把第二份 React 打进插件。

Vite 示例（双入口）：

```ts
import { defineConfig } from "vite";

export default defineConfig({
  build: {
    lib: {
      entry: {
        main: "src/main.tsx",
        runtime: "src/runtime.ts",
      },
      formats: ["es"],
      fileName: (_format, entryName) => `${entryName}.js`,
    },
    rollupOptions: {
      external: [
        "narraleaf-studio/plugin",
        "narraleaf-studio/runtime",
        "react",
        "react-dom",
        "react-dom/client",
        "react/jsx-runtime",
        "react/jsx-dev-runtime",
      ],
    },
  },
});
```

输出后把 `dist/main.js`、`dist/runtime.js` 放到插件包根目录，或把 manifest 的 `entries` 指到输出位置。注意每个 entry 必须自包含：runtime entry 不能在运行时 import 插件包内的其他文件。

不要 external `lucide-react`，除非 Studio 后续明确提供该 host module。插件可以自己 bundle 图标库，也可以先用文本按钮或传 `icon: null`。

## 安装和验证

1. 打开 Launcher。
2. 进入 Plugins。
3. 点击 Install Local。
4. 选择包含 `manifest.json` 的插件目录。
5. 点击 Approve Permissions。
6. 如果授权成功，插件会自动启用；也可以手动 Enable。
7. 打开 workspace。
8. 检查 workspace notification 和 Launcher 插件状态。

更新插件时提升 `manifest.version`，重新安装同一插件目录，然后重新授权。

## API 参考

- studio entry（`PluginApp`：services、UI kit、privileged）：[studio-api.md](./studio-api.md)
- runtime entry（`RuntimePluginApp`：game.blueprintNodes、log、故事级运行时模式）：[runtime-api.md](./runtime-api.md)
- 系统协议（manifest、授权、加载链路、打包、执行环境矩阵）：[plugin.md](./plugin.md)

## 推荐创建模板

```ts
import { definePlugin } from "narraleaf-studio/plugin";

export default definePlugin({
  async setup(app) {
    const prefix = app.plugin.id;

    const disposeKeys = app.services.ui.keybindings.registerMany([
      {
        id: `${prefix}.command`,
        key: "cmd+shift+p",
        description: "Run plugin command",
        handler: () => app.services.ui.notifications.info("Command executed"),
      },
    ]);

    app.services.ui.actions.register({
      id: `${prefix}.action`,
      label: "Plugin Action",
      tooltip: "Run plugin action",
      onClick: () => app.services.ui.notifications.success("Action executed"),
      order: 900,
    });

    return () => {
      disposeKeys();
      app.services.ui.actions.unregister(`${prefix}.action`);
    };
  },
});
```

## 常见失败原因

| 现象 | 检查 |
| --- | --- |
| 安装失败 | `manifest.json` 不是合法 JSON，或 `id` / `version` / `entries` 校验失败（`manifestVersion` 必须是 `2`，`entries` 至少声明一个 target，每个入口文件必须存在）。 |
| 授权后仍不能启用 | `manifest.version` 已变更，需要重新批准当前版本。 |
| workspace 不加载插件 | 插件不是 `enabled` 状态、没有声明 `entries.studio`，或上次有 `lastError`。 |
| `import` 失败 | 入口不是 ESM，或打包后仍有未被处理的外部依赖。 |
| `definePlugin` 不可用 | 插件不在 workspace plugin runtime 中运行，或导入名不是 `narraleaf-studio/plugin`。 |
| `defineRuntimePlugin` 不可用 | 代码不在游戏执行环境（Dev Mode/Preview/Production）中运行，或导入名不是 `narraleaf-studio/runtime`。 |
| 蓝图节点/widget 注册抛错 | type 没有以插件 ID 为前缀，或没有在 manifest `contributes.blueprintNodes` / `contributes.widgets` 中声明。 |
| Preview 启动报 "Plugin validation failed" | 项目用到的插件节点/widget 缺运行时提供方：插件被禁用/未安装、没有 `entries.runtime`、版本与项目记录不兼容，或该 type 未列入 `contributes`。 |
| widget 在编辑器可见但游戏中不渲染 | runtime 入口没有 `app.game.widgets.register` 该类型的渲染器。 |
| 文件操作被拒绝 | manifest 权限路径、mode、recursive 或插件版本授权不匹配。 |
| action/panel/widget 覆盖内建项 | 贡献 ID 没有用插件 ID 前缀。 |
