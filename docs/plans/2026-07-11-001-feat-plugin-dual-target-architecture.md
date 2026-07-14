---
title: "feat: Plugin Dual-Target Architecture (Studio / Runtime)"
type: feat
status: done
date: 2026-07-11
---

# feat: Plugin Dual-Target Architecture (Studio / Runtime)

## Overview

插件系统 V1 只定义了一个执行位置：workspace 窗口。但插件的职责天然横跨两个世界——在 Studio 中注册编辑器扩展（边栏、蓝图节点元数据、widget、动态选项源），以及在游戏执行环境（Dev Mode 窗口、Preview、Production）中执行游戏逻辑（蓝图节点 execute、未来的 story action 执行器 / transition / transform 求值器）。

V1 架构没有表达"执行环境"这个维度，导致：

1. **硬编码后门**：`builtinPluginRuntimeNodes.ts` 把 gallery 插件的蓝图节点 `execute` 复制进 Studio 核心，由 `registerCoreBlueprintNodes()` 在所有环境注册。同一段逻辑存在两份（插件包内 + 核心内）。
2. **第三方插件运行时必然静默失败**：插件注册的节点出现在编辑器 palette，但 Dev Mode / Preview / Production 加载不到插件代码，执行时缺 `execute`。
3. **打包链路无运输工具**：`GameRuntimePackV1` 只有 bundle + assets，插件运行时代码物理上无法随游戏发布。
4. **API 面无法冻结**：`narraleaf-studio/plugin` re-export workspace 内部类型，公共 API 与实现无边界。

本计划将"执行环境（target）"提升为一等公民：一个插件 = 一个包 + 按 target 划分的多个 entry。**不保留 V1 兼容**——插件系统未公开，唯一内建插件 Gallery 直接随迁移或删除重建。

## 核心模型

### Manifest V2（唯一支持的版本）

```json
{
  "manifestVersion": 2,
  "id": "publisher.plugin-name",
  "name": "Plugin Name",
  "version": "1.0.0",
  "publisher": "Publisher",
  "description": "Short description",
  "entries": {
    "studio": "main.js",
    "runtime": "runtime.js"
  },
  "permissions": []
}
```

- `entries.studio`：Studio 扩展入口，仅在 workspace 窗口加载。API = `narraleaf-studio/plugin`。
- `entries.runtime`：游戏运行时入口，在所有游戏执行环境加载（Dev Mode 窗口、Preview、Production）。API = `narraleaf-studio/runtime`。
- 两个 entry 均可选，但至少声明一个。每个 entry 都是预打包 ESM，与 V1 相同的路径安全校验（相对路径、无穿越、文件真实存在）。
- V1 的 `entry` 字段不再接受；`manifestVersion: 1` 直接校验失败。

### 两套 host API，物理隔离

| | `narraleaf-studio/plugin`（现有） | `narraleaf-studio/runtime`（新增） |
| --- | --- | --- |
| 执行位置 | workspace 窗口 | Dev Mode 窗口、Preview、Production |
| 入口约定 | `definePlugin({ setup(app) })` | `defineRuntimePlugin({ setup(app) })` |
| 能力 | panels/actions/editors/keybindings/widgets/blueprintNodes 元数据/assets/storage/privileged | `blueprintNodes.register({type, execute})`、`log` |
| 安全模型 | 可信本地代码 + 主进程按 plugin actor 审核特权 | 游戏代码（跑在玩家机器上），无 privileged、无 Studio services，网络策略由 pack 管控 |
| React | host external（import map） | 不提供（运行时入口不做 React UI） |
| 实现位置 | `src/renderer/plugin/` | `src/renderer/lib/ui-editor/runtime/plugins/`（必须在 runtime 构建白名单 `@/lib/ui-editor/` 内） |

隔离机制沿用现有 shim 模式：

- Studio 窗口 import map：`narraleaf-studio/plugin` → `app://plugin-api/plugin.js`（读 `__NLS_PLUGIN_MODULE__`），新增 `narraleaf-studio/runtime` → `app://plugin-api/runtime.js`（读 `__NLS_RUNTIME_PLUGIN_MODULE__`）。
- 独立 runtime index.html import map：仅 `narraleaf-studio/runtime` → `nlgame://plugin-api/runtime.js`。
- 全局对象只在对应 loader 运行的环境暴露，跨界 import 得到明确报错（"plugin runtime is not available"），与现有行为一致。

### 蓝图节点的双侧拆分模式（不拆类型，靠共享模块）

`BlueprintNodeDef`（编辑器元数据 + execute）保持不变，workspace 的 studio entry 继续注册完整定义——编辑器内嵌预览仍需要 execute。游戏环境只需要 `{ type, execute }`（即 `BehaviorNodeDefinition`），由 runtime entry 注册进 `behaviorNodeRegistry`。

插件作者的写法：把节点定义放进共享模块，两个 entry 各自 import，由插件自己的 bundler 打进两份产物。execute 单一来源，Studio 不需要理解插件内部结构。

```
my-plugin/
  src/nodes.ts      ← BlueprintNodeDef[]（单一来源）
  src/main.tsx      ← studio entry: app.services.blueprintNodes.registerMany(nodes)
  src/runtime.ts    ← runtime entry: app.game.blueprintNodes.registerMany(nodes)
```

运行时注册校验与 Studio 侧一致：node type 必须以插件 ID 为前缀。

### 执行环境矩阵

| 扩展点 | studio entry | runtime entry |
| --- | --- | --- |
| 边栏 / actions / editors / keybindings / notifications | ✅ | — |
| widget 模块（编辑面） | ✅ | （渲染面后续阶段） |
| 蓝图节点 | 元数据 + palette + 编辑器预览 execute | 游戏 execute |
| 动态选项源 | ✅ | — |
| assets / storage（项目级 JSON） | ✅ | —（运行时数据走 persistence，经 `ctx.hostAdapter` 在 execute 时访问） |
| privileged（fs/bash/permissions） | ✅ | 永不提供 |
| story action / transform 字段 / transition 预设 | （未来）编辑器字段 | （未来）执行器 |

## 分期实施

### 第 1 期：Manifest V2 + Runtime API 定义 ✅（2026-07-11 完成）

- `src/shared/types/plugins.ts`：`PluginManifestV2` / `NormalizedPluginManifestV2`（`entries: { studio?: string; runtime?: string }`），新增 `RuntimePluginDescriptor`。
- `src/shared/utils/pluginManifest.ts`：校验 V2（entries 至少一个、每个 entry 走 `isSafeRelativeEntry`）。
- `PluginManager`：`readManifest` 校验所有声明的 entry 文件存在；`listWorkspacePlugins()` 只返回有 studio entry 的插件；新增 `listRuntimePlugins()`；`resolvePluginEntryFile` 接受任一已声明 entry。
- `src/renderer/lib/ui-editor/runtime/plugins/`：`runtimePluginApi.ts`（`defineRuntimePlugin` + 类型）、`loadRuntimePlugins.ts`（暴露 `__NLS_RUNTIME_PLUGIN_MODULE__`、动态 import、执行 setup、按插件收集错误）。
- `PluginApiHandler` 新增 `/runtime.js` shim；ejs import map 增加 `narraleaf-studio/runtime` 映射。
- `project/build/builtin-plugins.js`：按 manifest.entries 构建多个 entry。

### 第 2 期：Dev Mode 加载 runtime entry ✅（2026-07-11 完成）

- 新 IPC `plugin.runtimeList`（仅 DevMode 窗口可调），返回 `RuntimePluginDescriptor[]`（entryUrl = `app://plugins/{id}/{version}/{runtimeEntry}`）。
- Dev Mode 渲染进程在构建 `GameAppHost` 前加载 runtime 插件，`host.ready` 门控加载完成；单个插件失败不阻断其余（console + host log）。
- 删除 `builtinPluginRuntimeNodes.ts` 及其在 `registerCoreBlueprintNodes` 的调用。
- Gallery 最小迁移作为管线验证：manifest → V2 双入口，新增 `src/builtin-plugins/gallery/runtime.ts` 注册 3 个节点 execute（完整重构留在第 4 期）。

### 第 3 期：pack schema v2 + Preview/Production 加载 ✅（2026-07-11 完成）

- `GAME_RUNTIME_PACK_SCHEMA_VERSION = 2`；pack 增加 `plugins: Array<{ id, name, version, entryRelativePath }>`。
- `gameRuntimeArtifactCompiler` 接受 `runtimePlugins` 输入，把每个插件的 runtime entry 复制到 `appDir/plugins/{id}/{entryFileName}`；`PreviewManager` 从 `pluginManager.listRuntimePlugins()` 供给（enabled + 有 runtime entry）。
- 独立 runtime：`nlgame://plugin-api/runtime.js` shim；插件文件经现有 `nlgame://runtime/plugins/...` 静态服务；`GameRuntimeApp` 在 pack 就绪后、`host.ready` 之前加载插件。
- CSP `script-src 'self' nlgame:` 已允许动态 import，无需变更。

### 第 4 期：声明式 contributes + 依赖表打包过滤 + story action ✅（2026-07-11 完成）

- manifest `contributes.blueprintNodes` 声明化：两侧注册 API 强制"注册必须已声明"；pack 编译前静态校验项目蓝图用到的插件节点有可打包的提供方（缺失/禁用/版本不兼容/未声明 → Preview 启动失败并给出诊断）。实现：`selectRuntimePluginsForPack`。
- 打包挑选规则改为项目依赖表 hard 依赖（无表回退全部启用 + verbose 日志）；soft（storage）依赖不打包。
- Dev Mode runtime 加载接入与 workspace 相同的依赖 suppression（主进程读 `.nlproj` 依赖表 + 共享 `resolveDependencies`，best-effort）。
- story action 扩展点落地：studio 侧 `app.services.story.actions.register`（场景编辑器 Action Creator palette 的 Plugin 分类，宿主追踪回收 + 块归一防御）；运行时侧的架构答案是既有蓝图链路——插件动作生成含插件节点的 Blueprint 块，经 NLR Script + ScriptCleaner 执行，save/回退安全免费获得。不引入平行的"story action 执行器"机制。
- Gallery 未删除：已随第 2 期迁移为双入口参照实现，本期补充 contributes 声明。完整 UI 重写没有需求支撑，不做。

**决策记录（transform 字段 / transition 预设）**：不在本期发明插件 API。核心当前没有任何预设注册系统（`StoryTransitionRef`/`StoryTransformRef` 由 storyCompiler 硬编码解析，无 registry），先给插件开口意味着同时替核心发明预设系统与文档 schema，属于独立的故事功能项目。待核心预设系统成立后，其插件开口按本架构落位：编辑器字段 → studio entry，求值/执行 → runtime entry。

### 第 5 期：文档拆分 ✅（2026-07-11 完成）

- `project/docs/studio-api.md`：`narraleaf-studio/plugin`（PluginApp）完整参考，含新的 `story.actions`。
- `project/docs/runtime-api.md`：`narraleaf-studio/runtime`（RuntimePluginApp）完整参考 + 故事级运行时模式。
- `plugin.md` 收敛为系统协议文档，新增执行环境矩阵；`create-plugin.md` 收敛为创建手册，API 参考改为指针；移除旧 registry 时代的内部 service 接口列表。

### 第 6 期（最终收尾）：插件 widget 游戏渲染面 + slash chooser ✅（2026-07-12 完成）

- **插件 widget 游戏渲染面**：调查确认游戏渲染走 `ElementRendererRegistry`（纯 render 函数，刻意与编辑器 widget module 分离，内建 widget 各有 runtime-only renderer）。落地与蓝图节点同构：runtime entry 经 `game.widgets.register({ type, render })` 注册渲染器，loader 收集后并入宿主注册表（内建类型永远优先、跨插件冲突抛错、`contributes.widgets` 声明强制）。`render` 签名与 studio 侧 `UIWidgetModule.render` 一致，共享模块单一来源。
- **React host externals 进游戏环境**：runtime plugin loader 在 `__NLS_RUNTIME_PLUGIN_MODULE__` 上暴露 `externals`（react / react-dom / jsx-runtime / jsx-dev-runtime）；React shim 源码统一到 `pluginRuntimeApiModule.ts`，从任一宿主全局解析——同一份 shim 服务 workspace、Dev Mode 窗口与独立 runtime（新增 `nlgame://plugin-api/react*.js` + import map）。`react-dom/client` 刻意不给游戏环境（插件不得自建 React root）。
- **contributes.widgets**：manifest 校验、双侧注册强制、pack 静态校验（`usedBy.widget` ↔ 打包提供方 ↔ 声明清单）全部与 blueprintNodes 对称。
- **slash chooser**：插入行 `/` 快捷输入与 Action Creator palette 共用 `useStoryPluginActionCommands()`，插件动作两处可用（chooser 支持 initialText 传入 `createBlock`）。

## 关键设计决策记录

1. **runtime loader 放在 `@/lib/ui-editor/runtime/plugins/`**：这是唯一同时被 Dev Mode 窗口（Studio renderer bundle）和独立 runtime bundle（`build-runtime.js` 白名单前缀 `@/lib/ui-editor/`）可达的位置。
2. **workspace 不加载 runtime entry**：workspace 通过 studio entry 的完整 `BlueprintNodeDef` 获得编辑器预览所需 execute，语义不变。
3. **runtime entry 无清理生命周期**：游戏环境是进程级一次性加载，`setup` 返回值被忽略（文档明示）。Studio 端 cleanup 语义不变。
4. **插件加载失败的运行时策略**：记录错误并继续启动游戏（一个坏插件不应砖化玩家的游戏/开发者的预览），错误经 host log 可见。
5. **动态 import 在 IIFE bundle 中可用**：workspace（同为 esbuild IIFE）已在生产使用 `import(entryUrl)` 加载插件 ESM，esbuild 保留非静态路径的原生动态 import。
6. **pack 内插件文件走 `nlgame://runtime/` 静态路径**而非新协议 host：`resolveRuntimeStaticPath` 已有根目录逃逸防护，复用即可。

## 验收标准

- `builtinPluginRuntimeNodes.ts` 不存在；核心代码中没有任何以具体插件 ID 为条件的逻辑。
- Gallery 蓝图节点在 Dev Mode 与 Preview 中通过其自身 runtime entry 执行。
- 一个只含 `entries.runtime` 的插件可以被安装、启用，且不出现在 workspace 加载列表。
- typecheck + vitest 全绿（win32 6 个既有基线失败除外）。
- `project/docs/plugin.md` 反映 V2 协议与双入口模型。
