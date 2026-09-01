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
  render: (props: RuntimeWidgetRendererProps) => ReactElement | null;
};
```

### game.blueprintNodes

注册蓝图节点的游戏侧 execute 绑定。行为约束：

- `type` 必须以插件 ID 为前缀（`${plugin.id}.`）。
- `type` 必须在 manifest `contributes.blueprintNodes` 中声明，否则注册抛错——静态校验（pack 编译）依赖 contributes 判断"项目用到的节点是否有运行时提供方"。
- 跨插件注册同名 type 抛错（该插件记为加载失败）。
- `register` 只读取 `type`、`displayName`、`execute`，可以直接传入与 studio entry 共享的完整 `PluginBlueprintNodeDef` 对象（多余字段被忽略）。

execute 内通过 `ctx.game` 访问游戏宿主能力——就是 `setup(app)` 收到的那个 `app.game`：

```ts
execute: async ctx => {
  // 未声明的域在对象上不存在（不是会抛错的方法），所以判存即降级。
  await ctx.game.store?.set("key", value);   // 需声明 runtimeCapabilities: ["store"]
  return { nextPort: "next" };
},
```

`ctx` **不是**宿主的 `BehaviorNodeExecutionContext`：它只有 `params`（inspector 参数值）、`resolveInput`（读数据输入针脚）、`eventName` / `eventPayload`、`signal`（中断）、`game`。宿主上下文携带的 `hostAdapter` 被刻意挡在外面——经由它可以够到存档、本地化、退出应用的全套宿主 API，而这条路径没有 manifest 声明、没有安装提示。插件能碰到的一切都必须经过 `ctx.game`，`contributes` 因此才是插件权力的真实清单。执行语义（isLatent、回滚清理）仍由宿主的 blueprint 运行时统一处理。

同一份定义也会被 studio entry 注册进编辑器目录，编辑器同样只传这个窄上下文；编辑器背不动任何运行时能力，所以那里 `ctx.game` 的门控域全部缺席。

### game.widgets

注册插件 widget 元素类型的游戏侧渲染器。宿主把它并入游戏的 `ElementRendererRegistry`（与内建 `nl.*` 渲染器同一注册表），当项目的 UI 文档中出现该 widget 元素时由宿主渲染。

- `type` 必须以插件 ID 为前缀，且必须在 manifest `contributes.widgets` 中声明。
- `render` 接收的是 `RuntimeWidgetRendererProps`，**不是**宿主传给内建渲染器的 `ElementRendererProps`。理由与节点上下文相同：宿主那份带着 `hostAdapter`，经由它可以够到存档、本地化、退出应用、正在播的混音器，而这条路径没有 manifest 声明、没有安装提示。收窄发生在注册那一刻——宿主注册表里存的从来不是插件自己那个函数，而是包好的绑定。
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

#### RuntimeWidgetRendererProps

```ts
type RuntimeWidgetRendererProps = {
  element: UIElement;                    // 正在绘制的这个元素：它自己的 props / layout / extra
  surface: UISurface;                    // 它所在的 Surface
  document: UIDocument;                  // 整份界面文档
  children?: ReactNode;                  // 已渲染好的子元素（除非自己摆放）
  instanceKey?: string;                  // 同一份作者元素被重复绘制时的稳定后缀
  listItemScope?: UIListItemScope | null;// 画在列表条目模板里时，这一次画的是哪一行
  renderChildren?: (options?) => ReactNode[];
  runtimeData?: { surfaceState?, globalState?, pageProps? };   // 只读
  dispatchEvent?: (eventName, payload?, options?) => Promise<void>;
  game?: RuntimePluginGame;              // 就是 setup(app) 收到的那个 app.game
};
```

- **`document` 是数据不是权力**：游戏本来就在画它，而结构型控件没有它写不出来——查自己的 part、
  算自己的后代，内建的 list 与 switch 就是这么做的。
- **`dispatchEvent` 是插件 widget 通往作者蓝图的唯一一条路**，也是宿主的蓝图运行时不能干脆整个扣下的原因：
  把一次点击翻译成 `mouseClick` 的那张表只认内建 widget 类型，插件类型不在表里，所以没有别的东西会替它
  触发事件槽。它**绑死在正在绘制的这个元素上**（插件不能替别的元素发事件），并且默认带上这一次绘制所在的行，
  只有要指向另一行时才传 `options`。它**每次渲染都是一个新函数**——从事件处理器里调用它，需要在 effect 里
  用就放进 ref，别放进依赖数组。
- **`dispatchEvent` 与 `game` 是可选的**，这样同一个 render 函数也能直接当 studio 侧 widget module 的
  `render` 用：编辑器画布上既没有在跑的游戏，也没有可以发事件的蓝图，两者在那里确实不存在。
  **反过来不成立**——按编辑器那份 props 写的函数当不了 runtime 渲染器，因为 `hostAdapter` 不会在那里。

### game.menu

出货游戏窗口上方那条原生菜单栏，整条声明、整条替换。

- **需要声明 `runtimeCapabilities: ["menu"]`，并且只在真的有菜单栏的宿主上存在**：网页导出（页面没有自己的菜单栏）和 Dev Mode（那扇窗是 Studio 的，上面已经有 Studio 的菜单）都没有这个域，`if (app.game.menu)` 是唯一诚实的判断。
- `set(spec)` 替换整条栏，没有增删单项：菜单是被整体阅读的东西，两个插件各自追加只会得到谁都没选择过的顺序。传空的 `menus` 就是把菜单栏撤掉。
- **一行说什么是插件的，一行是什么意思是游戏的**：`spec` 里的 `label` 是已经定好的字符串，动作则是一份封闭词表（`@shared/types/gameMenu` 的 `GameMenuAction`），勾选态、灰态与语言/窗口尺寸这类动态列表由运行时按当前游戏状态解析，插件不参与。词表之外的一切走 `{ type: "fn", fnRef }`——调用作者在全局蓝图里声明的函数。
- **没有快捷键，也不会有**：菜单加速键会在渲染层看到按键之前被主进程吃掉，那等于从作者的输入意图里拿走一个键而不告诉任何人。
- 游戏没挂载时调用会 reject（那时还没有可供解析的状态）。

```ts
const menu = app.game.menu;
if (menu) {
  await menu.set({ menus: [{ label: "File", items: [
    { kind: "action", label: "Settings", action: { type: "openPage", surfaceId } },
    { kind: "separator" },
    { kind: "action", label: "Quit", action: { type: "quitApp" } },
  ] }] });
}
```

内建插件 `narraleaf.menu-bar` 就是这个域的第一个使用者：作者面在 Studio 左边栏，文档随包（`contributes.runtimeData`），标签走工程本地化键。

### game.locale

游戏当前语言，以及工程自己的文案。

- `current` / `onChange(listener)`：玩家正在读的语言，与切换通知。
- `text(key)`：按工程的本地化键取当前语言下的文案，走的是 `Get Text` 节点那张表、那条 fallback 链；工程没声明这个键时返回 `null`。**给玩家看的字一律走这里**，插件自带一份译文是翻译流程唯一看不到的那份。

### game.log

写入宿主日志，自动带 `[plugin:{id}]` 前缀。Dev Mode 输出到窗口 console；Preview/Production 经 runtime bridge 输出到游戏进程日志。

## 故事级逻辑的运行时模式

不存在独立的"story action 运行时执行器"——故事级插件逻辑的运行时路径是蓝图：

1. studio entry 注册蓝图节点（palette 元数据 + 编辑器预览 execute），runtime entry 注册同一批节点的游戏 execute。
2. 作者在故事中使用 Blueprint 块（`{action:"blueprint"}`），块内使用插件节点。
3. 游戏中该块编译为 NLR `Script` action，经共享行为图解释器执行插件节点——save/load/回退安全由现有 `ScriptCleaner` 机制保证。

studio entry 可以额外注册 palette 动作（`app.services.story.actions`，见 [studio-api.md](./studio-api.md)）帮作者一键插入预构造的故事块；这些块是标准故事块，文档不因此依赖插件。

## 限制

- 当前 API 面：`blueprintNodes` + `widgets` + `log`，加上 manifest 声明后才出现的能力域（`store` / `events` / `state.*` / `saves.*` / `ui.overlay` / `assets` / `locale` / `menu` / `story.compile`）。transform 字段、transition 预设等扩展点等待核心先建立对应的预设系统（见设计文档决策记录）。
- runtime entry 必须自包含（单文件 ESM），不能在运行时 import 插件包内其他文件；React 相关包与 `narraleaf-studio/runtime` 除外（host external）。
- `react-dom/client` 不可用：插件不得在游戏内挂载自己的 React root。
- 无 cleanup、无跨插件依赖排序。

## 关键实现文件

- API 定义：`src/renderer/lib/ui-editor/runtime/plugins/runtimePluginApi.ts`
- loader：`src/renderer/lib/ui-editor/runtime/plugins/loadRuntimePlugins.ts`
- shim 源码：`src/shared/utils/pluginRuntimeApiModule.ts`
