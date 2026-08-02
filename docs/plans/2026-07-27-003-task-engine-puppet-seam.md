---
title: "task: 引擎 Puppet 接缝 —— 为 Live2D / Spine 开出宿主可注入的渲染面"
type: task
status: draft
date: 2026-07-27
parent: 2026-07-27-002-plan-live2d-and-spine-posture.md
repo: narraleaf-react (D:/Dev/org/NarraLeaf/narraleaf-react, 分支 dev_nomen)
---

# task: 引擎 Puppet 接缝

## 0. 命题

按 [2026-07-27-002](2026-07-27-002-plan-live2d-and-spine-posture.md) 的裁决：**不花钱、不背风险**。
引擎与 Studio 都**不含任何 Live2D / Spine 代码**，只出接缝；runtime 由用户自备、由宿主注入。

因此引擎侧的任务不是"支持 Live2D"，而是：

> 开出一种**绘制被委托给宿主**的 displayable，让引擎在完全不认识 Live2D / Spine 的前提下，
> 依然拥有它的位置、层级、变换、存档与剧情控制。

引擎里**不允许出现 `live2d` / `spine` 字样**（除 CHANGELOG 的举例外）。这是许可洁净性要求，
也顺带让第三方能接任何别的渲染器。

---

## 1. 勘验结论（已核对代码，全部是好消息）

| # | 发现 | 出处 |
|---|---|---|
| **1** | `LogicAction.DisplayableElements` **已经包含 `AbstractDisplayable<any, any>`**。类型系统已经容得下任意 Displayable 子类 | `src/game/nlcore/action/logicAction.ts` |
| **2** | 但 `Displayables.tsx` 对未知类型**直接 throw**。所以缺的只是渲染分支，不是架构 | `src/game/player/elements/displayable/Displayables.tsx:18-23` |
| **3** | `DevTools` **已经是 Studio 的既有接缝**：`registerDisplayable` / `setElementId` / `get·setDisplayableTransformProps` / `getLayerSrcs` 都在里面，且注释明确写着"Intended for editor hosts" | `src/game/nlcore/elements/built-in/DevTools.ts:66-139` |
| **4** | **预载零改动**：`Scene.preloadImage(src: string \| string[])` 是公开 API。模型贴图由 Studio 编译期发 `scene.preloadImage([...])` 即可走既有图片预载 | `src/game/nlcore/elements/scene.ts:452` |
| **5** | 存档链路按 **元素 id** 走 `elementMap`，`toData()/fromData()` 是每元素自理。照抄 `Text` 即可 | `gameState.ts:1477-1493`、`story.ts:249-258` |
| **6** | 加一个新元素的**足迹已有先例**：`feat(vfx)` 一次提交 12 文件 / ~1000 行（含 CHANGELOG + 2 个测试）。本卡规模与之相当或更小 | `git show 0626d71 --stat` |
| **7** | `Game` 已有 `plugins` / `use(plugin: IGamePluginRegistry)`，`Story` 已有 `registerService`。**注册模式现成**，不需要发明新机制 | `game.ts:181,241`、`story.ts:141` |
| **8** | ⚠️ **陷阱**：`logicAction.ts` 把四个联合类型**写了两遍**（`interface LogicActionInterface` 与 `namespace LogicAction` 各一份）。加元素必须改两处，只改一处会静默半通 | `logicAction.ts` 全文 |

### 1.1 控制面其实已经有一半

`Story.registerService(name, service)` + `service.trigger(key, ...args)`
（`src/game/nlcore/elements/service.ts`）今天就能让剧情驱动任意宿主逻辑，且带序列化与 abort。
**Service 唯一做不到的是"在舞台上画东西"。**

→ 所以本卡的**不可替代部分只有渲染**。控制面（motion / expression / param）理论上能挂 Service 走，
但那样命令不挂在元素上（无 per-element undo、无 history 归属），且 Studio 得替作者合成 service 名。
结论：仍然加专属 action，但它可以**独立成第二个 PR**，让第一个 PR 的面缩到最小。

---

## 2. 设计

### 2.1 命名

引擎侧叫 **`Puppet`**（提线木偶）——中性、短、VN 语境自然、不暗示骨骼（Live2D 不是骨骼动画）。
备选：`Rig` / `External` / `Live`。**这是待裁决项 §7.1。** 下文一律用 `Puppet`。

### 2.2 后端契约（本卡的核心，越小越好）

```ts
// src/game/nlcore/game/puppet/puppetBackend.ts  (新文件)

/** 宿主注册的绘制后端。引擎对它的内部一无所知。 */
export interface PuppetBackend {
    /** `Puppet` 的 `backend` 配置引用的唯一键，例如 "live2d"、"spine"。 */
    readonly name: string;
    /**
     * 绑定到宿主元素上创建一个实例。
     * 引擎拥有这个盒子的外部（位置 / 缩放 / 透明度 / 旋转 / 层级），后端拥有它的内部。
     */
    mount(container: HTMLDivElement, ctx: PuppetMountContext): PuppetInstance;
}

export interface PuppetMountContext {
    /** Puppet 声明的资源描述符，原样透传，引擎不解释。 */
    readonly src: string;
    /** 作者给后端的选项，原样透传，引擎不解释。 */
    readonly options: Readonly<Record<string, unknown>>;
    /** 盒子的逻辑尺寸（px）。变化时经 `PuppetInstance.resize` 再通知。 */
    readonly size: { width: number; height: number };
    /** 用与图片相同的规则把相对 src 解析成 URL。 */
    resolveSrc(src: string): string;
    /** 报告非致命问题：引擎记日志并保持舞台存活，不抛。 */
    warn(message: string, detail?: unknown): void;
}

export interface PuppetInstance {
    /** 模型加载完并画出第一帧后 resolve。用于 gate 首帧与 `waitForLoad`。 */
    ready(): Promise<void>;
    /** 施加一份**完整**状态。挂载时调一次，此后每次状态变化调一次。 */
    apply(state: Readonly<PuppetState>): void | Promise<void>;
    /**
     * 执行一条具名命令。引擎**从不解释** `name` / `payload`。
     * 返回 Promise 则剧情会等它（例如把一段 motion 播完）。
     */
    command(name: string, payload: unknown): void | Promise<void>;
    /** 盒子尺寸变化。 */
    resize(size: { width: number; height: number }): void;
    /** 可选：向编辑器宿主自述模型内容。见 §2.5。 */
    describe?(): Promise<PuppetDescription>;
    dispose(): void;
}

/** 会进存档的持久状态。一次性动作**不**在这里，走 `command`。 */
export type PuppetState = {
    /** 当前请求的具名动作（通常是 idle 循环），或 null。 */
    motion: string | null;
    /** 当前请求的具名表情，或 null。 */
    expression: string | null;
    /** 当前请求的具名皮肤 / 服装，或 null。 */
    skin: string | null;
    /** 自由数值参数（Live2D 参数、Spine 骨骼覆盖……）。 */
    params: Record<string, number>;
    /** 上面三项覆盖不到的自由字符串槽。 */
    slots: Record<string, string | null>;
};

/** 编辑器宿主用来填下拉框的模型自述。 */
export type PuppetDescription = {
    motions: string[];
    expressions: string[];
    skins: string[];
    params: { id: string; min: number; max: number; default: number }[];
    /** 模型自身画布尺寸，未知时 null。 */
    size: { width: number; height: number } | null;
};
```

**为什么是这个形状：**

- `apply(完整状态)` 而不是增量 —— **读档变成一次调用**：引擎从 SavedGame 重建 `PuppetState`，
  `apply` 一次即可，不需要回放动作序列。这是整个设计里最省事的一处。
- `command()` 是逃生口：一次性 motion、hit test、口型同步，全走它。引擎不需要为它们各开一个 API。
- `PuppetState` 里没有任何 Live2D / Spine 概念。`motion`/`expression`/`skin` 是两家都有的通用词，
  真正专有的东西落 `params` / `slots` / `command`。
- `describe?()` 可选 —— **让 Studio 不必自己解析 `.moc3` / `.skel`**。见 §2.5。

### 2.3 注册

挂在 `Game` 上，与既有 `Story.registerService` 同构：

```ts
// src/game/nlcore/game.ts
public registerPuppetBackend(backend: PuppetBackend): this
public getPuppetBackend(name: string): PuppetBackend | null
public listPuppetBackends(): string[]
```

放 `Game` 而不是 `GameConfig`：config 会被 `deepMerge` 且可 `freeze`，后端是带方法的活对象，不该进可序列化配置。
插件可以在自己的 `register(game)` 里调它（`IGamePluginRegistry`，`game/plugin/plugin.ts:3-7`），
所以 `game.use(live2dBackendPlugin)` 这条路自然成立，不需要额外机制。

### 2.4 后端缺席时的行为（**硬要求**）

用户自备 runtime 的直接后果是：**总会有人忘记装**。引擎必须优雅降级：

- `Puppet.config.backend` 找不到已注册后端时 → `gameState.logger.warn` **一次**（按 backend 名去重）；
- 元素照常参与 transform / layer / 存档，只是盒子里空着——**不抛、不白屏**；
- 状态记为 `"missing-backend"`，经 §2.5 的 DevTools 读出，Studio 在检视器里显红、导出时告警。

对应地，`ready()` 缺席时立即 resolve，避免 gate 死等。

### 2.5 DevTools 增补（编辑器专用，非公开面）

严格照 `DevTools.ts:110-139` 既有的 `get·setDisplayableTransformProps` 一对写法：

> **已落地，签名有两处与下面的初稿不同（以实现为准）**：`getPuppetStatus` / `onPuppetStatusChange`
> **不收 `gameState`**（它们用不到它，而 `DevTools` 的既有惯例是用得到才收）。
> 另外状态读取**同时开了公开面**——`Puppet.getStatus()` 与 `Puppet.onStatusChange(listener)`，
> 因为 backend 是**异步**失败的，只有同步读取回答不了「我的渲染器到底起来没有」。

```ts
static getPuppetStatus(puppet): "unmounted" | "missing-backend" | "loading" | "ready" | "error";
static onPuppetStatusChange(puppet, listener): LiveGameEventToken;

/** 转发到 instance.describe?.()。后端不实现或未就绪时返回 null。 */
static describePuppet(gameState, puppet): Promise<PuppetDescription | null>;

static getPuppetState(puppet): PuppetState;                       // 浅拷贝
static setPuppetState(gameState, puppet, patch, opts?: { merge?: boolean }): void;  // 不走 action，立即 apply
static runPuppetCommand(gameState, puppet, name, payload): Promise<void>;
static listPuppetBackends(game): string[];
```

`describePuppet` 是这批里价值最高的一个：**Studio 的检视器可以直接从活模型拉出 motion / expression /
skin / 参数列表来填下拉框，Studio 主进程永远不需要写 `.moc3` / `.skel` 解析器。**

### 2.6 明确不做的（v1）

| 不做 | 理由 |
|---|---|
| **Puppet 专属 transition**（两个模型交叉淡入） | `useDisplayable` 的双组机制会在 transition 时替换 refs → 后端实例被重挂载。v1 只用 wrapper 上的 transform，`show()`/`hide()` 走 opacity，够用。**要写进文档** |
| **hit-test / 点击区域** | 需要指针链路，独立一卡 |
| **口型同步** | 需要 audioManager 的分析器接缝，独立一卡 |
| **预载参与** | 已被 `scene.preloadImage()` 覆盖（勘验 #4），**零改动** |
| **`autoFit`** | 后端自己管内部缩放。`Puppet` 只给 `size: {width, height}` 盒子尺寸，外层 transform 叠在上面。语义可预测 |

---

## 3. 分期

### P1 —— 渲染接缝（可独立合并）

舞台上能出现、能被 transform、能进存档、编辑器能驱动。剧情还不能驱动。

| # | 文件 | 动作 | 量 |
|---|---|---|---|
| 1 | `src/game/nlcore/game/puppet/puppetBackend.ts` | **新** — §2.2 全部类型 + 注册表实现 | ~110 |
| 2 | `src/game/nlcore/elements/displayable/puppet.ts` | **新** — `Puppet extends Displayable`，照 `text.ts` 的骨架（config / state / transformState / `toData` / `fromData` / `_init` / `reset` / `useLayer`） | ~230 |
| 3 | `src/game/nlcore/game.ts` | 加 `registerPuppetBackend` / `getPuppetBackend` / `listPuppetBackends` + 私有 Map | ~25 |
| 4 | `src/game/nlcore/action/logicAction.ts` | `Puppet` 进 `DisplayableElements` / `GameElement`（**两份都改**，见勘验 #8） | ~8 |
| 5 | `src/game/player/type.ts` | `ExposedStateType.puppet` + `ExposedState[puppet]` + `ExposedKeys[puppet]`；`DisplayableExposed` 加 puppet | ~15 |
| 6 | `src/game/player/elements/displayable/Puppet.tsx` | **新** — `useDisplayable` + 单 transition 组 + 后端挂载 / 状态同步 / resize / dispose | ~190 |
| 7 | `src/game/player/elements/displayable/Displayables.tsx` | +1 个 `instanceof` 分支 | ~3 |
| 8 | `src/game/nlcore/common/elements.ts` | 导出 `Puppet` 与 §2.2 的类型 | ~6 |
| 9 | `src/game/nlcore/elements/built-in/DevTools.ts` | §2.5 全部 | ~90 |
| 10 | `src/game/nlcore/elements/displayable/puppet.test.ts` | **新** — 见 §5 | ~120 |
| 11 | `src/game/nlcore/game/puppet/puppetBackend.test.ts` | **新** — 注册表 + 缺席降级 | ~70 |
| 12 | `CHANGELOG.md` | 强制（见 §6） | ~25 |

合计 ~900 行 / 12 文件 —— 与 `feat(vfx)` 同量级。

### P2 —— 剧情控制面

| # | 文件 | 动作 |
|---|---|---|
| 1 | `src/game/nlcore/action/actions/puppetAction.ts` | **新** — `setMotion` / `setExpression` / `setSkin` / `setParam` / `setSlot` / `command`；`command` 支持 `{ await: true }` 让剧情等它 |
| 2 | `src/game/nlcore/action/actionTypes.ts` | `PuppetActionTypes` + `PuppetActionContentType` |
| 3 | `src/game/nlcore/action/logicAction.ts` | `PuppetAction` 进 `Actions` / `ActionTypes` / `ActionContents`（**两份**） |
| 4 | `puppet.ts` | 加对应链式方法 |
| 5 | `puppetAction.test.ts` | duck-typed 执行测试 |

**为什么拆开**：P1 的价值（Studio 能在编辑器里摆、预览、存档）不依赖 P2；
P2 的形状会被 Studio 的作者面反过来影响（哪些命令要进时间线、哪些要能等）。先落地 P1 拿到真实反馈。

### P3 —— 可选增强

transition / hit-test / 口型同步。**不排期**，等 Studio 侧真实需求。

---

## 4. Studio 侧的对接（不在本卡，仅为闭环说明）

- 宿主在游戏挂载前 `game.registerPuppetBackend(...)`——Dev Mode 预览与导出产物走同一条路
  （沿用 [[runtime-unification-goal]] 的共享 GameApp）；
- `CharacterAppearance` 加 `kind: "puppet"`（`character/types.ts:134-143` 已是判别联合，模式现成）；
- 资产族（多文件资产）—— **本次接入最大的一块工程量，比渲染还大**，值得单独立卡；
- SDK 安装入口与授权门控 —— 见 002 号 §6.3 / §6.4。

### 4.1 ⚠ 预览与出货的 CSP 不对称（2026-07-27 勘验，Studio 侧阻塞风险）

两条链路的 CSP **不一样**，而差的恰好是 WebAssembly：

| 链路 | `script-src` | 出处 |
|---|---|---|
| Dev Mode 预览 | `'self' app: file: 'unsafe-inline' 'unsafe-eval' **'wasm-unsafe-eval'**` | `devModeNetworkPolicy.ts:30` |
| **导出的游戏** | `'self' nlgame:` —— **没有 `wasm-unsafe-eval`** | `src/runtime/main/networkPolicy.ts:43` |

而 `live2dcubismcore.min.js` 里确实有 `WebAssembly.instantiateStreaming` 与 `_em_module.wasm` 引用。
补充勘验：**SDK 全树没有任何 `.wasm` 文件**，整个 min.js 里 base64 总量只有 ~7KB，
所以模块本体应当是 wasm2js 编译出的纯 JS，WASM 只是 glue 里的优选路径。
**但这是静态推断，没有跑过。**

风险的形状比结论更重要：**Live2D 可能在编辑器预览里好好的，只在导出的游戏里挂**——
因为只有出货那条链路缺 `wasm-unsafe-eval`。这是最难发现的一类缺陷。

**已实测结论（2026-07-27，orchestrator 亲测）：不需要改 CSP。**

在 Node `vm` 沙箱里加载 `live2dcubismcore.min.js`，三种条件下都跑通并返回 `csmGetVersion() = 0x6000001`：

| 条件 | 结果 |
|---|---|
| A. `WebAssembly` 正常可用 | ✅ 初始化成功 |
| B. `WebAssembly` 完全不存在 | ✅ 初始化成功 |
| C. `WebAssembly` 存在但 `compile`/`instantiate`/`Module` 全部抛 `CompileError`（**Chrome 在缺 `wasm-unsafe-eval` 的 CSP 下的真实行为**） | ✅ 初始化成功，靠 JS 回退 |

而且条件 A 下也打出了 `failed to asynchronously prepare wasm` —— 结合 SDK 全树没有 `.wasm` 文件、
整个 min.js 的 base64 总量只有 7KB，可以判定 **Cubism SDK for Web 5-r.5 发行的就是 wasm2js 纯 JS 版本，
WASM 分支是 glue 里的死代码**。

推论：

1. **`buildRuntimeCsp()` 不用动**，出货产物不需要放宽为 `wasm-unsafe-eval`。这是好消息——
   安全策略保持原样。
2. 也**不存在"预览快、出货慢"的性能不对称**：两条链路都走同一份 JS 回退。

⚠️ 保留的限度：以上是 Node 沙箱里的 API 级模拟，不是 Electron 渲染进程里的真实 CSP 头。
**仍然要求 Live2D 的最终验收在打包产物上做一次**——只是它现在是例行确认，不再是阻塞风险。
另外这个结论**绑定在 5-r.5 这个版本上**：若 Live2D 未来改回真 WASM 分发，这条要重测。

Spine（`@esotericsoftware/spine-webgl`）是纯 JS，本来就不受影响。

---

## 5. 测试计划

引擎测试是 **vitest + node env，无 jsdom / 无 React harness**（见 [[narraleaf-react-engine-repo]]），
所以 `Puppet.tsx` 不做单测，测元素与注册表这两个纯逻辑seam：

1. `Puppet` 构造 → `toData()` → `fromData()` 往返，状态与 transformState 全等；
2. `reset()` 回到构造配置（存档/`newGame` 语义）；
3. 注册表：重名后端覆盖行为、`getPuppetBackend` 未命中返回 `null`；
4. **缺席降级**：`mount` 阶段没有后端时不抛，状态为 `missing-backend`，warn 只发一次；
5. `PuppetState` 序列化对未知 key 的容忍（前向兼容：老引擎读新档不崩）；
6. P2：`puppet.setMotion("x")` 产出的 action 链形状 + `executeAction` 的 duck-typed 调用。

**回归网**：引擎 `npm run lint` + `npm test`；随后 dist 拷进 Studio 后跑
`yarn vitest src/renderer/lib/ui-editor/runtime/game`（storyCompiler 集成，~102 测试）。

---

## 6. 工程约束（违反即返工）

- **分支**：从 `dev_nomen` 开（不是 `master`）。共享 checkout 有并发会话，**必须开 worktree**：
  `git worktree add <path> -b feat/puppet-seam dev_nomen` + `node_modules` 用 Junction 链过去。
- **CRLF**：eslint 强制 `linebreak-style: windows`。新文件写 CRLF 或 `eslint --fix`。
- **CHANGELOG 必写**（[[engine-changelog-rule]]）：本卡是新增公开面，条目要覆盖
  `Puppet`、`PuppetBackend` 系列类型、`Game.registerPuppetBackend`、以及 DevTools 增补
  （DevTools 虽非公开面，但 Studio 依赖它，要记）。
- **dist → Studio**：`npm run build:dev` 后
  `node project/postbuild.js --target-dir "D:/Dev/org/NarraLeaf/NarraLeaf-Studio/node_modules/narraleaf-react"`。
- **`logicAction.ts` 改两份**（勘验 #8）。
- 引擎源码内**不得出现 `live2d` / `spine`**（CHANGELOG 举例除外）。加一条 lint/grep 断言进 CI 更稳。

---

## 7. 待裁决

1. **命名**：`Puppet` / `Rig` / `External` / `Live`。倾向 `Puppet`。
2. **`command` 的等待语义**：默认不等（fire-and-forget）还是默认等？
   倾向**默认不等**，用 `{ await: true }` 显式开启——与 `Sound` 的既有直觉一致，且避免作者写出隐式卡顿。
3. **`describe()` 是否强制**：倾向可选（`describe?`）。后端不实现时 Studio 退回"手填名字"，
   功能降级但不阻塞。
4. **一个 Puppet 是否允许换 src**（换模型）而不是重建元素：v1 倾向**不允许**（换模型 = 换元素），
   避免 backend 实例生命周期与 transition 纠缠。
5. **P1 是否连 `size` 一起做**，还是先固定为 stage 尺寸：倾向一起做，成本只有几行。

---

## 8. 一句话摘要

引擎只需要**一个盒子和一张契约**：盒子由既有的 `Displayable` 机制管（位置、层、变换、存档全部白拿），
契约把绘制委托出去。加起来约 900 行、12 个文件、与 `feat(vfx)` 同量级，
而且引擎从头到尾不认识 Live2D 和 Spine——这既是许可要求，也恰好是最省的设计。
