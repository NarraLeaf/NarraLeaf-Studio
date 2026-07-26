---
title: "plan: Steam 成就插件（伞卡）— sidecar / 构建时依赖 / runtime 能力扩展"
type: plan
status: draft
date: 2026-07-26
---

# plan: Steam 成就插件（伞卡）

## 0. 一句话

Steam 成就插件**不能只作为插件写**：Steamworks 是原生 C API，必须跑在能加载动态库的进程里，
而插件的 runtime 入口跑在打包游戏的**渲染进程**（`contextIsolation` + CSP + 网络封锁）。
所以本计划是一张伞卡，下挂**三条 Studio 侧能力**加插件本体：

| 编号 | 内容 | 卡 |
|---|---|---|
| **M-SIDECAR** | 插件自带原生子进程，随游戏打包并由游戏主进程托管 | 本卡 Part A |
| **M-BUILDDEP** | 插件声明构建时二进制依赖，Studio 下载 / 校验 / 缓存 | 本卡 Part B |
| **M-RUNTIME** | runtime 插件 API 从 4 个方法扩展到"一个真正的插件该有的程度" | **独立里程碑卡**（勘验中） |
| **P-STEAM** | `narraleaf.steam-achievements` 插件本体，进 `../Plugins` 注册表 | 本卡 Part D |

## 1. 现场勘验：插件现在能做什么、不能做什么

读的是 develop 当前状态，全部有出处。

### 1.1 两个入口目标（`src/shared/types/plugins.ts:15`）

| 入口 | 运行位置 | 能拿到什么 |
|---|---|---|
| `studio` | 仅 workspace 窗口 | `PluginServices` 白名单 + `BoundPrivilegedFacade`（fs / bash / 权限申请） |
| `runtime` | **每个游戏执行环境**（Dev Mode / Preview / 生产 / web / 移动） | 只有 `app.game.{blueprintNodes, widgets, data.readJson, log}` |

`RuntimePluginApp` 的全部表面就这四项（`runtimePluginApi.ts:41-67`）。**没有文件系统、没有网络、
没有原生、没有持久化、没有状态订阅。** 这是刻意的：runtime 入口是游戏代码。
它同时也是 M-RUNTIME 存在的理由：这个面窄到连"记住玩家解锁了什么"都做不到。

### 1.2 打包后的游戏长什么样

`gameRuntimeArtifactCompiler.ts` 产出 `appDir`：

```
appDir/
  main.js  native.js  gate.js  preload.js  renderer.js  renderer.css  index.html
  package.json                     # narraleaf.mode = production
  pack.json | <sealed bundle>      # GameRuntimePackV1
  assets/**  icons/**
  plugins/<pluginId>/<entry>.js    # runtime 入口，ESM
```

再由 electron-builder 打成 asar（`runGameBuild.ts:62`，`files:["**/*"] / asar:true`），
`asarUnpack` 目前只有 `["native.js","icons/**"]`（+ 加密时两个 bundle，`GameBuildManager.ts:1029`）。

生产态主进程是硬化的（`src/runtime/main/main.ts`）：`devTools:false`、拒绝任何
`--inspect/--remote-debugging-*`、`installRuntimeNetworkPolicy` 把渲染进程锁死在 `nlgame://`
协议内（除非项目开 `allowHttp`）、CSP 在 serve 时注入。

### 1.3 结论：三条硬缺口

| 缺口 | 后果 | 归属 |
|---|---|---|
| 无法运行原生代码 | Steamworks 无从调用 | M-SIDECAR |
| 无法把第三方二进制带进游戏包 | `steam_api64.dll` 进不去产物 | M-BUILDDEP |
| runtime 无持久化、无状态订阅、无生命周期 | 成就状态无法本地镜像；声明式规则写不出来 | M-RUNTIME |

---

## Part A — M-SIDECAR

### 2. 方案（已裁决：独立可执行子进程）

| 方案 | 判定 |
|---|---|
| A. 向游戏**主进程**注入 Node 原生插件（`.node`） | **否决**。ABI 绑死 Electron 的 Node 版本 × 平台 × 架构；Windows 宿主根本产不出 macOS 的 `.node`；且等于给插件开主进程后门，把 1.2 的硬化全废掉。 |
| B. **独立子进程 sidecar**，stdio 通信 | **采纳**。与 Electron ABI 完全解耦；崩溃隔离；能力面小可审计；对 Discord RPC / 本地分析等同样通用。 |
| C. 用游戏自带 Electron 以 `ELECTRON_RUN_AS_NODE` 跑 JS | **作为第二种 kind 一并支持**（纯 JS sidecar 零额外体积）；但**不推荐**在其中加载 `.node`，那是把 A 的 ABI 问题换个地方。 |

### 3. Manifest 面（`contributes.sidecars`）

在 `PluginContributes`（`plugins.ts:44`）与校验器（`pluginManifest.ts:80` 的 `CONTRIBUTES_TYPE_KEYS`）
之外新增一个对象形状的 key，与 `locales` 同级处理：

```jsonc
"contributes": {
  "sidecars": [{
    "id": "narraleaf.steam-achievements.bridge",    // 必须以 pluginId 为前缀
    "kind": "executable",                           // "executable" | "node"
    "transport": "stdio-jsonl",                     // v1 仅此一种
    "autostart": "onGameStart",                     // "onGameStart" | "onRequest"
    "startupTimeoutMs": 5000,
    "shutdownTimeoutMs": 3000,
    "restart": { "maxRetries": 3, "backoffMs": 1000 },
    "targets": {
      "windows-x64": {
        "entry": "bin/win-x64/nl-steam-bridge.exe",
        "include": [
          "bin/win-x64/nl-steam-bridge.exe",              // 插件包内
          // ⚠️ dep: 的落点 = include 路径去掉 `dep:<id>/` 前缀。要让 DLL 与 exe **同目录**
          // （Windows 按 exe 所在目录搜索 DLL），必须由依赖的 files 映射把它放到 bin/win-x64/ 下。
          "dep:narraleaf.steam-achievements.sdk/bin/win-x64/steam_api64.dll"
        ],
        "sha256": { "bin/win-x64/nl-steam-bridge.exe": "…" }
      },
      "macos-arm64": { … }, "linux-x64": { … }
    }
  }]
}
```

规则：

- **平台键 = `<platform>-<arch>`**，取自 `GameBuildPlatform`×`GameBuildArch`。未声明的平台上该
  sidecar **不存在**，runtime 侧 `available()` 返回 false。web / android / ios **永远没有 sidecar**。
- `include` 两种来源：默认相对插件包根；`dep:<depId>/<path>` 指向构建时依赖的产物。
- `sha256` 对插件包内文件必填。安装时校验、打包时再校验。换了 exe 的篡改包装不上，而不是静默生效。

### 4. 安装期权限（新 `PluginInstallPermission` kind）

`pluginPermissions.ts:14` 的联合类型加一支：

```ts
| { kind: "sidecar"; id: string; platforms: string[] }
```

理由：sidecar 是**会随作者的游戏发给玩家**的原生可执行文件——插件权限里最重的一条，
比 `filesystem` 重，不能塞进 `api` capability 字符串里含混过去。安装对话框单独成段：
「此插件会在你构建的游戏中附带并运行一个原生程序（Windows x64 / macOS arm64）」，并展示指纹。

### 5. 打包集成

1. `copyRuntimePlugins`（`gameRuntimeArtifactCompiler.ts:467`）旁边加 `copyPluginSidecars`：
   按目标 `platform-arch` 选中一组 `targets`，复制到 `appDir/sidecars/<pluginId>/<sidecarId>/…`，
   把 entry 相对路径写进 `GameRuntimePackPluginEntry`（`gameRuntime.ts:71`）新增的 `sidecars?: […]`。
2. `buildAsarUnpackPatterns`（`GameBuildManager.ts:1029`）追加 `sidecars/**`。
   **可执行文件与动态库不能从 asar 内执行/加载**，这条是硬性的。
3. sealed（加密）模式下 sidecar **不进 bundle**，永远松散。它本身就是可执行体，保护不了，
   装作保护了只会误导。
4. `preflight.ts` 新增 `BuildPreflightCode`：
   - `sidecar-target-missing`（warning）：本次目标平台上没有对应 sidecar → 功能在产物里静默失效，必须提前说。
   - `sidecar-crossbuild-exec-bit`（**error**）：见 §6。

### 6. 已知硬边界（写进卡，不等踩到）

- **Windows 宿主交叉构建 macOS/Linux 会丢执行位。** NTFS 无 exec bit，Node 报 0666，
  electron-builder 据此写进 dmg/AppImage → 产物里的 sidecar 不可执行。v1 的答案是
  **preflight 直接 error**：「带可执行 sidecar 的 macOS 目标必须在 macOS 宿主上构建」。
  （未来杠杆：我们自己拥有 `zipWriter.ts`，zip/dir 可后处理写死 0755；dmg/AppImage 走 electron-builder 内部，不免费。）
- **macOS 签名/公证。** 嵌套可执行文件必须与主体一同签名，否则 Gatekeeper 拒绝得比现在的
  「未签名」基线更狠（当前 `hasSigningIdentity = false`）。签名批次落地前，macOS + sidecar 仅供自用。
- **渲染进程内插件之间不互相隔离。** 所有 runtime 插件是同一渲染进程里的同源 ESM，
  preload 暴露的 sidecar 通道无法真正认证调用方的 pluginId。v1 明确接受并写进文档，不假装有隔离。
  （能力边界仍有效：宿主只会拉起**清单声明过**的 sidecar。）
- **Steam 覆盖层归属游戏 exe，不归 sidecar。** 成就 toast 由 Steam 客户端在被 hook 的游戏进程上绘制。
  这条必须**真机验证**，不能假定（§13 验收项）。

### 6.1 实现后新发现的边界（打包落地时暴露，非事前预料）

- **一次构建多个桌面目标时，sidecar 一个都不发。** 打包管线目前一个 `appDir` 服务所有桌面目标
  （`GameBuildWorkerConfig.appDir` 是单值），而 sidecar 是按 `<platform>-<arch>` 分的。
  同时勾选 Windows 和 macOS 时，实现选择**发一条构建警告并一个都不打包**——把 Windows 的 exe
  塞进 .app 里比不塞更糟。真正的修法是每目标一个 appDir，属打包管线改造，未做。
- **`sidecar-crossbuild-exec-bit` 当前被遮蔽。** `hostCanBuildTarget("windows", "macos")` 本来就是
  false，`unbuildable-platform` 会先报。这条实现了但在 Windows 宿主上观察不到，
  等交叉构建被放开时才成为生效消息。**§13 的验收项 8 因此今天无法执行。**
- **插件 zip 不带执行位，比 §6 那条更早也更普遍。** §6 只写了「构建期交叉编译丢执行位」，
  但**安装期**就已经丢了：`../Plugins/scripts/lib/zip.mjs` 与 Studio 的 `extractPluginZip`
  都不记录/还原 file mode，从注册表装的插件其 sidecar 在 macOS/Linux 上落地 0644，
  **根本 spawn 不起来**。来源不止一条（注册表 zip、本地目录安装、构建暂存），逐个去修容易漏，
  所以 S3 在 **spawn 前**统一补：posix 上 stat 看 owner-exec 位，缺了就 chmod 补齐
  （只在文件已授读的位上补执行，不放宽可见性）；chmod 失败不吞，直接判定该 sidecar 不可用。
  源头（zip 写入端）仍值得单独修，那是另一张卡。
- ~~**预览编译不带 sidecar**（`PreviewManager` 没有传 `sidecarPlatformKey`），所以 **Dev Mode 目前
  无法验证 sidecar**。~~ **已在 S3 补上**：预览按宿主平台的 `<platform>-<arch>` 打包 sidecar，
  并把 `hostUserDataDir` 一并传下去（`dep:` include 要走构建依赖缓存）。遗留一条：预览编译里
  sidecar 拷贝失败（缺 `dep:` 产物、摘要不符）会让**整次预览启动失败**，而不是降级成「本次没有
  sidecar」——生产构建那样报错是对的，预览不是。

### 7. 运行时托管（游戏主进程）

新增 `src/runtime/main/sidecarHost.ts`：

- 读 pack 里的 sidecar 声明；`autostart:"onGameStart"` 在窗口创建后拉起，`onRequest` 等首次调用。
- `child_process.spawn`，`stdio: ["pipe","pipe","pipe"]`。
  **cwd = `<userData>/sidecars/<pluginId>/<sidecarId>/`**（每 sidecar 一个可写目录）——
  同时解决 Steam 开发期 `steam_appid.txt` 必须位于 cwd 的问题；共享库仍从 exe 同目录加载
  （Windows 应用目录优先于 cwd；posix 走 rpath）。
- 帧格式：**换行分隔 JSON（NDJSON）**，stdout 是协议，stderr 是日志（转进游戏日志，生产态仅 warning 以上）。
- 握手：宿主发 `{"t":"hello","protocol":1,…}`，sidecar 须在 `startupTimeoutMs` 内回
  `{"t":"ready","protocol":1,"caps":[…]}`，否则判定不可用。
- 关停：`before-quit` 发 `{"t":"bye"}` → 等 `shutdownTimeoutMs` → SIGTERM → kill。
  复用现有存档 flush 的同一条 `before-quit` 路径（`main.ts:173`）。
- 崩溃：向插件发 `exit` 事件，按 `restart` 退避重启；超次数后永久标记不可用。

preload（`preload.ts:83`）新增 `sidecar` 分支，runtime 插件 API 新增：

```ts
app.game.sidecar = {
  available(sidecarId: string): boolean;
  start(sidecarId: string): Promise<SidecarHandle>;   // 幂等
};
type SidecarHandle = {
  request<T>(method: string, params?: unknown): Promise<T>;  // 相关 id 由宿主维护
  notify(method: string, params?: unknown): void;
  onEvent(cb: (method: string, params: unknown) => void): () => void;
  onExit(cb: (info: { code: number | null; signal: string | null }) => void): () => void;
  stop(): Promise<void>;
};
```

---

## Part B — M-BUILDDEP：构建时二进制依赖

### 7.1 实现后发现：M-BUILDDEP 对 Steam 这个用例基本落空

**Steamworks SDK 在 Valve 合作伙伴登录之后**，无鉴权下载永远拿不到。也就是说构建时依赖
下载缓存这条「主打功能」，对它当初被设计出来所服务的那一个插件，唯一可走的是 §10 的
**手动放置缓存**路径——功能退化成一份文档步骤。

这不代表 M-BUILDDEP 白做（公开可下载的二进制依赖仍然受益），但**Steam 插件的 README 必须
把手动放置写成正路，而不是降级路径**。若最终只剩手动放置，值得重新评估这条依赖是否该改为
「插件 studio 入口自己问用户要 SDK 路径」——那本来就是 §8 里划给插件自己的一条。

### 7.2 实现后发现：安装期就丢执行位（比 §6 那条更早更普遍）

插件 zip 不携带文件 mode（注册表的 `zip.mjs` 与 Studio 的 `extractPluginZip` 都不设），
安装路径上也没有 chmod。**从注册表装的插件，其 sidecar 在 macOS/Linux 上落地是 0644，
根本 spawn 不起来。** §6 只标了游戏构建交叉编译那一种。
修法：spawn 前在 posix 上确保 entry 可执行——来源不止一条（注册表 zip / 本地目录 / 构建暂存），
逐个源头修容易漏，spawn 前是所有路径的必经处。

### 7.3 实现后发现：`steam_appid.txt` 作者无处安放

开发期 `SteamAPI_Init` 需要它位于 sidecar 的 cwd（`<userData>/sidecars/...`），而 runtime 插件
API 没有文件系统，作者只能手工去找那个路径。**正解是别让作者管**：sidecar 是原生进程，自己有
文件系统——由插件在握手后把 App ID 告诉它，sidecar 自行设置 `SteamAppId` 环境变量或写出
`steam_appid.txt`。App ID 本来就在插件的目录数据里。

### 7.4 其余待办（实现期暴露）

- **线协议要对账。** Steam 插件先于 `sidecarHost.ts` 写完，`req`/`res`/`event` 及全部字段名是
  插件侧的提案。S3 落地后**必须逐字段对齐**，否则两边各说各话。
- **`avgrate` 统计目前不可达**：它要 `UpdateAvgRateStat(name, count, sessionLength)`，
  §11.3 的节点表没有这个形状。要么补节点，要么把 `avgrate` 从数据模型里删掉——
  留着一个只写镜像、永远同步不到 Steam 的类型是骗人的。
- **插件读不到项目的发行语言**（`PluginServices` 上没有项目服务），所以 §11.2 的本地化缺失校验
  只能对着目录自带的 `locales` 列表做。要做成对着项目做，得给 studio 插件面加只读项目信息。
- **类型包要发布**：插件对着分支生成的 0.3.0 `.d.ts` 才编译得过，已发布的 `narraleaf-studio@0.2.0`
  早于窄 ctx / `store` / `sidecar`。插件 manifest 里的 `studioVersion` 是猜的，发版时填真数。

### 8. 职责边界（已裁决）

Studio 的职责是：**让插件声明构建时二进制依赖，并在项目构建时下载、校验、缓存**。
Studio 的职责**不是**替插件张罗依赖。三条路径的归属：

| 路径 | 谁负责 |
|---|---|
| 插件把依赖直接打进自己的下载包 | 插件作者（Studio 无需知情，走 §3 的包内 `include`） |
| 插件声明外部 URL，构建时下载缓存 | **Studio**（本 Part） |
| 插件要求用户自己下好、手动指路径 | **插件自己**（用它的 studio 入口 + `privileged.fs`），Studio 不管 |

### 9. Manifest 面（`contributes.buildDependencies`）

```jsonc
"contributes": {
  "buildDependencies": [{
    "id": "narraleaf.steam-achievements.sdk",       // pluginId 前缀
    "description": "Steamworks SDK redistributable binaries",   // 展示给作者
    "targets": {
      "windows-x64": {
        "url": "https://…/steamworks_sdk_162.zip",
        "sha256": "…",                              // 必填，无则拒绝
        "archive": "zip",                           // "zip" | "none"
        "files": {                                  // 归档内路径 → 依赖产物内相对路径
          "redistributable_bin/win64/steam_api64.dll": "bin/win-x64/steam_api64.dll"  // 必须与 sidecar exe 同目录
        }
      }
    }
  }]
}
```

### 10. 实现（对齐既有先例）

`ensureWinCodeSignCache`（`buildWorker/winCodeSignCache.ts`）已经是这套流程的样板：
**fetch → 校验摘要 → staging 目录 → 原子 rename → 命中即跳过联网**。照抄它的形状：

- 缓存根：`<userData>/cache/build-deps/<sha256>/`。**用 sha256 做缓存键**，
  换 URL 但文件没变时不会重下。
- 解归档复用 `extractPluginZip` / `zipModel`（`pluginRegistryClient.ts:143`），已带 zip-slip 防护。
- **离线**：缓存命中就不联网；未命中且取不到 → preflight **error**，并给出
  「把文件手动放到 `<cache path>` 即可继续」的指引。作者永远有一条不联网的出路。
- 装期权限第二条重权限：`{ kind: "buildDependency"; id: string; hosts: string[] }`，
  对话框展示**下载主机名 + 摘要**。下载外部二进制塞进作者的游戏，必须让作者看见是从哪儿来的。
- Studio **不做**：版本解析、依赖图、license 接受流程、镜像回退。

---

## Part C — M-RUNTIME（独立里程碑）

→ **`2026-07-26-014-plan-runtime-plugin-api.md`**

三路勘验推翻了本卡初稿对它的定性。初稿写的是「runtime API 只有 4 个方法，太窄，要扩」，
**事实是它已经全开**：内置 quick-save 插件通过 `ctx.hostAdapter.blueprintRuntime.hostApi`
拿到了完整宿主能力面（存档全套、本地化、退出应用、~30 个 widget 方法），
任何第三方插件今天都能照做——而这条路径**没有 manifest 声明门槛、没有权限边界、没有文档、没有版本**。

所以 M-RUNTIME 的内容是**收编**而非扩张，详见 014 卡。本伞卡对它的阻塞依赖只有一条：

- **R1** `app.game.store`（插件作用域持久化）。没有它，Dev Mode 测不了成就、web/itch 版没有成就、
  游戏内成就画廊做不了、`Is Achievement Unlocked` 无法同步返回用于剧本分支。

另有一条**引擎侧**发现直接影响 Part D 的设计：引擎的 Storable/Persistent
**没有任何变化事件**（`Namespace.set` 是纯赋值）。因此"某变量变成 true 就解锁成就"这种声明式规则
**今天只能靠轮询**。014 把根因修复（引擎发变化事件）列为配套项 E1。

---

## Part D — `narraleaf.steam-achievements` 插件

NarraLeaf 官方，落 `../Plugins` 注册表，**不做内置**（不把 Steam 依赖焊进 Studio 本体）。
结构上是 `builtin-plugins/gallery` 的同构体（storage 目录 + 面板 + 动态下拉的蓝图节点），
外加一个 sidecar。

### 11.1 数据模型（plugin storage，随 `contributes.runtimeData` 发布）

```ts
type AchievementCatalog = {
  version: 1;
  appId?: string;                       // Steam App ID
  achievements: Achievement[];
  stats: SteamStat[];
};
type Achievement = {
  id: string;                           // Steam API Name，^[A-Za-z0-9_]{1,44}$
  name: Record<LocaleCode, string>;
  description: Record<LocaleCode, string>;
  hidden: boolean;
  iconAchievedAssetId?: string;         // 取自资产库
  iconUnachievedAssetId?: string;
  progress?: { statId: string; max: number };
};
type SteamStat = {
  id: string; type: "int" | "float" | "avgrate";
  defaultValue: number; min?: number; max?: number; incrementOnly?: boolean;
};
```

### 11.2 作者侧（studio 入口）

- **成就编辑器**：一个 editor tab（不是右侧面板——成就表是表格，要宽度）。行内编辑、
  图标从资产库选（`app.services.assets`）、按语言切换填文案。
- **校验**：API Name 合法性/唯一性、图标必须 64×64 PNG（Steam 要求）、
  项目发行语言里缺失的本地化条目、进度型成就引用的 stat 是否存在。
- **导出到 Steamworks**：Steam 没有公开的 schema 上传 API，成就只能在合作伙伴站点录入或用
  stats 页的导入/导出。所以导出成一个 **zip**（VDF/JSON + 全部 64×64 图标），经
  `privileged.fs.selectSaveFile` 保存——**不需要任何常驻文件系统权限**。
  ⚠️ **VDF 确切字段名需对着现行合作伙伴文档做一次 spike**，不要照记忆写（WI-D3）。

### 11.3 游戏侧（runtime 入口 + 蓝图节点）

| 节点 | 说明 |
|---|---|
| `Unlock Achievement (id)` | 解锁；**同时写本地镜像**，Steam 不在也有效 |
| `Is Achievement Unlocked (id) → bool` | 读**本地镜像**。⚠️ **不是同步的**：`app.game.store` 是异步的，节点因此 `isLatent`，**用不了内联剧情表达式**，只能在 event/macro 图里用 |
| `Indicate Achievement Progress (id, cur, max)` | Steam 的 "3/10" toast |
| `Set Stat / Add Stat / Get Stat` | 统计量 |
| `Steam Available → bool` | sidecar 握手成功且 `SteamAPI_Init` 成功 |
| `Steam Language → string` | `GetCurrentGameLanguage()`，可用来自动匹配游戏语言 |
| `Reset All Stats (alsoAchievements)` | 测试 / 「清除数据」菜单 |

**降级是设计的一部分，不是补丁**：Steam 不可用时每个写节点只写本地镜像并静默成功，读节点照常工作。
itch/web 版、Dev Mode、没开 Steam 的开发机全部可用，且作者能用一套脚本同时供给 Steam 成就和
游戏内成就画廊（画廊读 `runtimeData` 目录 + `app.game.store` 镜像）。

### 11.4 Sidecar：`nl-steam-bridge`

- **Rust + `steamworks` crate**（或 C++ + 官方 SDK）。单文件可执行，每平台-架构一个。
  版权归 NarraLeaf，可随插件包分发。
- 主循环：`SteamAPI_RunCallbacks()` ~50ms 一次 + 读 stdin。
- 启动序列：`SteamAPI_Init` → `RequestCurrentStats` → 回 `ready`。
  **不调用 `SteamAPI_RestartAppIfNecessary`**——在子进程里调它会去重启子进程，语义是错的；
  改为「Steam 没跑就报不可用」，文档写明发行时游戏必须由 Steam 拉起。
- 方法集与 §11.3 一一对应，外加 `stats.store`（批量提交，节点写入后去抖 ~1s）。

---

## 12. 平台 / 降级矩阵

| 目标 | sidecar | Steam 成就 | 本地镜像 | 游戏内画廊 |
|---|---|---|---|---|
| Windows / macOS / Linux（声明了对应 arch） | ✅ | ✅ | ✅ | ✅ |
| 桌面但未声明该 arch | ❌ | ❌（preflight warning） | ✅ | ✅ |
| Web | ❌ 永远 | ❌ | ✅（localStorage） | ✅ |
| Android / iOS | ❌ 永远 | ❌ | ✅ | ✅ |
| Dev Mode / Preview | ✅（同桌面路径） | ✅（需 `steam_appid.txt`） | ✅ | ✅ |

## 13. 工作项

依赖：`S1→S2→S3→S4`；`B1→B2`；`M-RUNTIME` 独立推进但 R1 是 `D5` 的阻塞项；`D*` 依赖 `S4 + B2 + R1`。

| WI | 内容 | 落点 |
|---|---|---|
| **S1** | `contributes.sidecars` 类型 + 校验器 + `sidecar` 安装权限 kind + 安装对话框 + sha256 校验 | `shared/types/plugins.ts`、`shared/utils/pluginManifest.ts`、`shared/types/pluginPermissions.ts`、`apps/plugin-permission` |
| **S2** | 打包集成：`copyPluginSidecars`、pack 字段、`asarUnpack`、两条 preflight | `preview/compiler/`、`build/GameBuildManager.ts`、`build/preflight.ts` |
| **S3** | 主进程 `sidecarHost.ts`：spawn / NDJSON / 握手 / 相关 id / 退避重启 / 关停；preload 通道 | `src/runtime/main/`、`src/runtime/preload/` |
| **S4** | runtime API `app.game.sidecar` + 文档 + `narraleaf-studio` 类型包 bump | `runtime/plugins/runtimePluginApi.ts`、types 包 |
| **B1** | `contributes.buildDependencies` 类型 + 校验器 + `buildDependency` 安装权限 kind | 同 S1 各处 |
| **B2** | 下载/校验/缓存实现（照 `winCodeSignCache` 形状）+ `dep:` 来源解析 + 离线 preflight | `buildWorker/`、`build/preflight.ts` |
| **M-RUNTIME** | runtime 插件能力面扩展（独立卡，含 R1/R2） | 另卡 |
| **D1** | 插件骨架 + 目录数据模型 + storage/runtimeData | `../Plugins/plugins/narraleaf.steam-achievements` |
| **D2** | 成就编辑器 tab（表格 / 本地化 / 图标选取 / 校验） | 同上 |
| **D3** | **spike**：核对 Steamworks 后台导入格式；实现 zip 导出（VDF + 64×64 图标） | 同上 |
| **D4** | `nl-steam-bridge`（Rust）+ 各平台构建流水线 + 指纹 | 新仓库或插件仓子目录 |
| **D5** | 蓝图节点 + 本地镜像 + 降级 | 同上 |

## 14. 验收判据（可断言；遵循本轮铁律 R2：orchestrator 亲眼看）

1. Windows 上构建 dir 目标 → 产物中存在
   `resources/app.asar.unpacked/sidecars/<id>/nl-steam-bridge.exe`，且 `app.asar` 内**没有**它。
2. 启动产物，Steam **未运行**：游戏正常启动，`Steam Available` 为 false，
   `Unlock Achievement` 后 `Is Achievement Unlocked` 为 true（本地镜像生效），
   sidecar 已退出或标记不可用；**无崩溃、无弹窗**。
3. Steam **运行中**、`steam_appid.txt` 就位：解锁后 **Steam 客户端里成就实际点亮**（截图为准），
   且 **overlay toast 是否出现被真机确认**（§6 未知项，结论写回卡里）。
4. 关闭游戏 → sidecar 进程 3s 内消失（任务管理器为准），无孤儿进程。
5. Web 目标构建：产物中无 `sidecars/`，游戏可启动，成就走本地镜像。
6. 篡改插件包内 exe 一个字节 → 安装被拒，报指纹不符。
7. 断网 + 清空 `build-deps` 缓存 → 构建报 error 并给出手动放置路径；把文件放进去后构建通过。
8. ~~Windows 宿主勾选 macOS 目标 → preflight 报 `sidecar-crossbuild-exec-bit` 且阻断构建。~~
   **今天不可执行**：`unbuildable-platform` 先于它触发（见 §6.1）。等交叉构建放开后再验。

## 15. 明确不做

- 不做主进程原生插件加载（方案 A），不新增 `gameMain` 入口目标。
- 不做 sidecar 的网络能力代理、不做 sidecar 之间互通。
- 构建时依赖不做版本解析、依赖图、license 接受流程、镜像回退。
- 不做 Steam 云存档 / 创意工坊 / 排行榜 / 微交易——v1 只有成就与统计。
- 不做成就「死引用」审计（哪条成就没有任何脚本解锁）：需要 studio 插件读取项目文档的 API，
  当前白名单没有，不该为这一个用途开。列为后续。
- 不做 macOS 公证；带 sidecar 的 macOS 产物在签名批次落地前仅供自用。
