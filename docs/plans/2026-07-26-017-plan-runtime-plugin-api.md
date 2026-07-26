---
title: "plan: M-RUNTIME — runtime 插件 API 收编与扩展"
type: plan
status: draft
date: 2026-07-26
parent: 2026-07-26-013-plan-steam-achievements-and-sidecar.md
---

# plan: M-RUNTIME — runtime 插件 API 收编与扩展

## 0. 定性（勘验推翻了初始判断）

初始判断是「runtime 插件 API 只有 4 个方法，太窄，要从零扩」。**勘验证明这是错的**：

内置插件 quick-save 通过 `ctx.hostAdapter.blueprintRuntime.hostApi` 拿到了**完整的宿主能力面**
（`src/builtin-plugins/quick-save/nodes.ts:92-97`）——`BlueprintHostApiRuntime`
（`BlueprintHostApiBridge.ts:206-301`）里有 navigation、~30 个 widget 方法、state、persistence、
localization、frame、game（存档全套 / history / choose / next / skip / dialog / preference /
nvl / textRead）、devtools。**任何第三方插件今天都能照做。**

所以本里程碑的真正内容不是"扩"，是**收编**：

> 把一个**已经事实上全开、却从未声明过的**能力面，变成显式、有版本、有文档、有权限门槛的公开 API；
> 顺手补上它形状上的三个洞。

### 0.1 三个问题

| # | 问题 | 证据 |
|---|---|---|
| **泄漏** | `hostApi` 不是公开 API，它经 `RuntimeBlueprintNodeDef.execute = BehaviorNodeDefinition["execute"]`（`runtimePluginApi.ts:27`）的类型缝漏出。无版本、无文档、**无 manifest 声明门槛、无权限边界**。装了任何插件 = 把玩家存档、本地化、退出应用的权限一并交出去。 | `nodes.ts:92-97`、`runtimePluginApi.ts:27` |
| **形状错** | 能力只在**节点 execute 内**可达。`setup` 期够不到，widget render 期够不到。成就插件要在 setup 期恢复本地镜像、要在任意时刻弹 toast——都做不到。 | `loadRuntimePlugins.ts:156-255` |
| **有洞** | `persistence.getAll/removeValue` 没转出；`assetUrl` 在 widget render 里拿不到（`ElementRendererProps` 无此项）；`onFullscreenChanged`/`onCloseRequested` 无插件注册点（后者还是单 handler 架构）；**引擎事件一条都没桥出来**。 | 见 §2 |

### 0.2 结论

`app.game.*` 成为**唯一**公开面；ctx 泄漏收口；能力按域拆分并加 manifest 静态声明门槛。

---

## 1. 硬约束（全部来自勘验，违反即构建失败）

| 约束 | 出处 |
|---|---|
| 新 API 实现**必须**落在 `src/renderer/lib/ui-editor/` 下，否则游戏 runtime bundle 构建报错 | `project/build/build-runtime.js:103-111` `allowedPrefixes` |
| importmap 是白名单，只有 5 项（runtime + 4 个 React）。**不新增宿主模块**，一切挂 `app.game.*` | `build-runtime.js:24-34`、`webShell.ts:78-88`、`app-entry-html.ejs:48-54` |
| `react-dom/client` **刻意不给**游戏环境：插件不得自建 React root。覆盖层必须由宿主渲染插件返回的 element | `pluginRuntimeApiModule.ts:10-17` |
| 类型包两个 entry 必须共享同一份 `_api.d.ts`，否则跨 entry 的 `BlueprintNodeDef → RuntimeBlueprintNodeDef` 会因 nominal 比较失败 | `packages/plugin-types/build.mjs:8-18` |
| 插件 runtime entry 必须自包含单文件 ESM，不能运行时 import 包内其他文件 | `project/docs/runtime-api.md:122` |
| CSP `script-src 'self' nlgame:`，无 unsafe-eval；`allowHttp=false` 时整会话阻断 http/ws | `networkPolicy.ts:24-30,38-54` |
| **现有隔离必须保持**：单插件 setup 抛错不拖垮游戏（每插件独立 try/catch，`.finally()` 无条件 ready） | `loadRuntimePlugins.ts:135-154`、`GameRuntimeApp.tsx:201-205` |
| 宿主模块全局被 freeze + 不可写不可配置（防后加载插件投毒），新增字段要走同一路径 | `loadRuntimePlugins.ts:79-96` |

## 2. 能力域划分

### R1 `app.game.store` — 插件作用域持久化

- 底座已有：`RuntimePersistenceStore`（`runtimeStorage.ts:230,347`，落 `userData/persistence.json`），
  web 侧 `WebGameStorage` 走 IndexedDB（`web.ts:126-146`）。
- 现有 `hostApi.persistence` 只转出了 `get/set`，**`getAll`/`removeValue` 没转**（preload 有，
  `preload.ts:75-80`）。先补齐转发。
- 键强制 `pluginId.` 前缀，与 blueprintNodes/widgets 同款前缀校验。
- 区分**存档域**与**玩家域**：成就属于玩家域（跨存档），不该进 SavedGame。v1 只做玩家域，
  存档域留给 R3。
- **这是 P-STEAM 的阻塞项**（本地成就镜像）。

### R2 `app.game.events` — 事件桥

引擎侧可桥的（`narraleaf-react` @ `dev_nomen` v0.17.1，已勘验）：

| 插件事件 | 引擎来源 |
|---|---|
| `preloadComplete` / `firstSceneReady` | `Game` 生命周期事件，**带 replay 语义**（后注册也能收到），`game.ts:254-317` |
| `sceneEnter` / `sceneExit` | `event:state.scene.mount/unmount`（`gameState.ts:172-173`）。⚠️ 这是 **React 挂载级**，不是"剧情推进到某场景"，语义差别要写进文档 |
| `dialogueEnd` | `event:state.player.lineEnd`（`gameState.ts:168`） |
| `choiceMade` | `event:menu.choose`（`liveGame.ts:43`） |
| `characterPrompt` | `event:character.prompt`（`liveGame.ts:29`） |
| `gameEnd` | `event:state.end`（`gameState.ts:166`） |
| `beforeRestore` / `afterRestore` | `game.hooks`（`game.ts:39,43`） |

宿主侧可桥的：`fullscreenChanged`（`preload.ts:50`，今天只有 GameApp 消费）、
`closeRequested`（`preload.ts:59`，**今天是单 handler 架构**，要改多播才能给插件）、
`saveWritten`（`RuntimeSaveStore` 写入点）。

⚠️ `event:action.current` 引擎标注为**实验性**（`liveGame.ts:53`），不进 v1 公开面。

### R3 `app.game.state` — 变量读写与观察

- **读写已有**：`storyRuntime.sceneVar/savedVar`（`runtime/types.ts:103-114`）、
  `ctx.persistentVariables` 持久变量表、`hostApi.state.get/set`（surface 态）。收编即可。
- **观察是引擎缺口，不是 Studio 缺口**：`Namespace.set`（`storable.ts:48`）是纯赋值，
  Storable/Persistent 全链路**没有任何 change 事件**。
  → 见 §3 的引擎配套 **E1**。在 E1 落地前，声明式规则只能靠"在 R2 的 tick 事件里轮询比对"，
  **本卡不接受这个作为终态**。

### R4 `app.game.ui` — 插件覆盖层

今天插件只能注册**作者摆放的** widget（`widgets.register`），**不能主动画任何东西**。
成就 toast（非 Steam 构建下的 fallback）、调试角标、通知，全都无处落地。

- 新增宿主管理的 overlay 层 + `ui.overlay.mount(render): cleanup`。
- **插件返回 ReactElement，由宿主渲染**——因为 `react-dom/client` 被刻意封死（§1）。
- 层级、点击穿透、与 NVL/对话框的叠放次序需要定规矩（对齐 `ElementRendererRegistry` 的
  「内建永远优先于插件」原则，`loadRuntimePlugins.ts:123-133`）。

### R5 `app.game.assets` / `app.game.locale`

- `assetUrl(assetId)`：preload 有（`preload.ts:39`），但 widget render 的
  `ElementRendererProps` 里没有，插件只能硬编码 `nlgame://` 字符串。收编。
- `locale`：`hostApi.localization.getConfig/getLocale/setLocale` 已有
  （`BlueprintHostApiBridge.ts:254-261`），补一个 `onLocaleChange`，与 studio 侧 `PluginI18n` 对称。

### R6 收口 ctx 泄漏（本里程碑的核心）

- `RuntimeBlueprintNodeDef.execute` 的 ctx 从透传 `BehaviorNodeDefinition["execute"]`
  换成**显式窄类型**：`{ params, resolveInput, signal, eventPayload, … , game }`，
  其中 `game` 就是同一个 `app.game.*`。节点内外一套 API。
- ⚠️ **破坏性变更**：quick-save / gallery 两个内置插件要改；任何已发布的第三方插件若用了
  `ctx.hostAdapter` 会断。当前注册表只有一个纯 locale 插件（`helloyork.nekolang-i18n`，
  无 runtime entry），**现在是做这件事代价最低的时刻**。迁移策略见 §5 裁决项。

### R7 权限门槛

与 blueprintNodes/widgets 同款的 manifest 静态声明 + 加载期校验：

```jsonc
"contributes": {
  "runtimeCapabilities": ["store", "events", "state.read", "state.write", "ui.overlay", "saves.read"]
}
```

未声明即该域在 `app.game` 上**不存在**（不是调用时报错）。安装对话框按域展示人话描述。
理由：今天装任何插件等于交出存档读写权，这不该继续。

## 3. 引擎侧配套（`narraleaf-react`）

**E1 — `Namespace.set` 发变化事件。** 载荷 `{namespace, key, previous, next}`。
这是"某持久变量变成 true 就触发"的**根因修复**，替代轮询。属于引擎公开面变更，
按仓库规矩**必须写 CHANGELOG**（见 `engine-changelog-rule`）。

已核实的现状：引擎有多条事件总线（`LiveGame.events` / `GameState.events` / `Game` 生命周期），
有 `game.use(plugin)` 插件机制（`game/plugin/plugin.ts:3-36`，仅 register/unregister 两个回调），
有 `Story.registerService` + `Service.on/trigger`（`elements/service.ts:36,50` —— 宿主对象随存档
序列化、剧本可 trigger）。**唯独 Storable/Persistent 无变化通知。**

`Story.registerService` 值得单独评估：它是引擎认可的"宿主向剧本暴露自定义动作"的口子，
可能是比蓝图节点更自然的插件接入点。列为 **spike**，不进 v1。

## 4. 平台降级（web 壳差异，已勘验）

| 域 | web |
|---|---|
| `store` | ✅ IndexedDB（`web.ts:126-146`） |
| `events` | 部分：`closeRequested` **天然不存在**（`web.ts:122-125` 返回空 unsubscribe）；fullscreen 事件有但 `requestFullscreen` 受用户手势门控，失败只 warn |
| `state` / `ui` / `assets` / `locale` | ✅ 同桌面 |
| `sidecar`（来自 M-SIDECAR） | ❌ 永远不可用 |

每个域必须自带 `available` 语义，插件按域降级，而不是整体假定桌面。

## 5. 待裁决

1. **R6 破坏性变更的迁移策略**：(a) 直接断，改两个内置插件，趁注册表还没有 runtime 插件；
   (b) 保留 `ctx.hostAdapter` 一个大版本并打 deprecation 日志。
   **推荐 (a)** ——注册表目前零个 runtime 插件，成本只会随时间上升。
2. **R7 权限门槛是否对内置插件也强制**：推荐**是**，内置插件不该有特权路径，否则门槛形同虚设。
3. **E1 是否同期做**：推荐**是**。不做则 R3 的观察能力只能轮询，声明式成就规则会变成一个
   靠 tick 事件比对的补丁，这正是上一轮"补出来的东西物理上看不见"那类错误的同构。

## 6. 工作项

| WI | 内容 | 依赖 |
|---|---|---|
| **R1** | `app.game.store` + 补 `persistence.getAll/remove` 转发 + 前缀校验 + web 后端 | — |
| **R2** | 事件桥（引擎 7 条 + 宿主 3 条）；`closeRequested` 单 handler → 多播 | — |
| **R3** | `app.game.state` 读写收编 | E1（观察部分） |
| **R4** | overlay 层 + `ui.overlay.mount`，宿主渲染插件 element | — |
| **R5** | `assetUrl` / `locale` + `onLocaleChange` | — |
| **R6** | ctx 窄类型化，收口 `hostAdapter` 泄漏；改内置插件 quick-save / gallery | R1-R5 |
| **R7** | `contributes.runtimeCapabilities` + 加载期校验 + 安装对话框 | R6 |
| **R8** | `project/docs/runtime-api.md` 重写 + `packages/plugin-types` 重新生成并验证 | R7 |
| **E1** | 引擎 `Namespace` 变化事件 + CHANGELOG | — |

## 7. 验收判据（可断言）

1. 一个只声明 `["store"]` 的测试插件：`app.game.store` 可用，`app.game.state` **在对象上不存在**
   （`typeof === "undefined"`，不是调用时抛错）。
2. 同一插件在节点 `execute` 内 `ctx.hostAdapter` 为 `undefined`；`ctx.game.store` 与 setup 期拿到的是同一实例。
3. 插件在 setup 期写 `store`，重启游戏后读回同值（桌面查 `userData/persistence.json`，web 查 IndexedDB）。
4. 插件 `ui.overlay.mount` 的元素在游戏画面上可见，且**内建对话框叠在它之上**（层级规矩生效）。
5. E1：脚本里把某持久变量置 true → 插件的 `state.onChange` 回调在**同一帧**收到，无轮询延迟。
6. 一个 setup 抛错的插件：游戏照常 boot，其余插件正常（现有隔离未被破坏）。
7. `yarn build:plugin-types` 通过，`verify()` 探针 typecheck 绿。
8. web 目标：`events.closeRequested` 的 `available` 为 false，插件不因此报错。
