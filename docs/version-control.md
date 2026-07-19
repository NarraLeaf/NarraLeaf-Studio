# Studio 版本控制：技术路线

Studio 的版本控制以 [Epic Games Lore](https://github.com/EpicGames/lore) 为底层，**diff 逻辑和冲突解决界面由 Studio 自己实现**。本文是这条路线的唯一事实来源：架构、依赖方式、进程模型、已验证的能力边界，以及必须提前知道的坑。

选 Lore 而不是 Git 的理由只有一条，但足够：Studio 的资产是二进制和 JSON，Lore 的存储热路径**不做 CRLF 转换、不做编码推断、没有 clean/smudge filter**（[system-design.md §13](https://github.com/EpicGames/lore/blob/main/docs/explanation/system-design.md)），且分块去重是 fragment 级而非文件级。Git 的 autocrlf + LFS 组合在这两点上都是长期事故源。

> **状态**：Lore 于 2026-06-16 开源，本文基于 **v0.8.5**（2026-07-16）核实，核实日期 2026-07-18。Lore 是 pre-stable 0.x，**API 和协议在 1.0 前都会变**；数据格式官方承诺向前兼容。

## 0. 结论先行

| 问题 | 结论 |
|---|---|
| 能拿到任意历史版本的原始 blob 做 diff 吗 | **能**，已验证字节精确，无需工作树、无需服务器 |
| 三路合并的 base 能拿到吗 | **Lore 不提供**，但 DAG 完整；LCA 已在 §9 的封装层里实现 |
| 能纯离线吗 | **单机能**，已验证；团队场景首次读远端历史要联网 |
| 原生库能进 Electron 吗 | **能**，Electron 38 直接可用，无需重编 |
| 需要写服务端包装吗 | **P0 不需要**，见 §5 |
| Intel Mac 怎么办 | **VCS 做成可插拔可降级**，Studio 照常全平台分发，见 §7 |

## 1. Lore 架构（够用的最小认知）

| 层 | 内容 |
|---|---|
| Fragment | FastCDC 内容定义分块 + Zstandard 压缩，BLAKE3 内容寻址。去重在这一层 |
| Immutable store | 只增不改的 fragment 仓库。本地一份（兼作 LRU 缓存），远端一份（真源） |
| Mutable store | 分支指针、元数据，用 CAS 推进 branch tip |
| Revision | 320 字节记录 + 64KiB tree block 构成的 Merkle 树 |
| Partition | 128 位标识符，在版本控制层**等价于一个 repository**，也是访问控制边界 |

中心化但不要求常在线：staging / commit / branch / switch / diff 全部走本地 store。稀疏工作副本是**默认**——clone 只拉 view 声明的子集，fragment 按需拉取。

传输 QUIC（UDP 41337）+ gRPC（TCP 41337）+ HTTP（TCP 41339）。

## 2. Studio 如何依赖 Lore

### 2.1 客户端：`@lore-vcs/sdk`

**它是 optional 依赖，不是普通依赖：**

```jsonc
// package.json
"optionalDependencies": {
  "@lore-vcs/sdk": "0.8.5"   // 锁死版本（无 caret），见 §8
}
```

SDK 自身再用 `optionalDependencies` + `os`/`cpu` 分发平台子包，npm/yarn 只装匹配当前平台的那个（已验证：Windows 上只装了 `sdk-amd64-unknown-windows`，29MB DLL）。

放进 `optionalDependencies` 是**故意的**：装不上（不支持的平台、`--no-optional`、网络失败）不能让 Studio 整个装不上。配合 §7 的降级，Studio 在任何平台都能装、能跑。

**关键：lorelib 是普通共享库（.dll/.dylib/.so），不是 N-API addon。** 它不随 Electron ABI 变化，Electron 升级不需要重编——这比 [`@narraleaf/encryption`](../src/main/app/application/managers/security/packKeyService.ts) 的 node-gyp 路线省心得多。唯一 ABI 绑定的是 `koffi`，它自带各 ABI 的 prebuilt。

已验证：Electron 38.8.6 / Node 22.22.0 / ABI 139 下 SDK 直接加载并完成 storagePut→storageGet 往返，零额外配置。

### 2.2 构建配置

esbuild 必须把 SDK 和 koffi 标记为 external，与现有 `@narraleaf/encryption` 完全同构：

```js
// project/build/build-main.js 和 project/app/dev-electron.js
external: ['electron', 'esbuild', '@narraleaf/encryption', '@lore-vcs/sdk', 'koffi']
```

electron-builder **不需要改**：[electron-builder.yml](../electron-builder.yml) 已有 `asarUnpack: node_modules/**/*`，原生库不会被封进 asar。这是最容易翻车的一步，Studio 已经免疫。

### 2.3 进程模型

**全部 Lore 调用必须在主进程**——原生 FFI，渲染进程碰不到。

P0 建议：**全放主进程**，作为一个新的 manager，与现有 [managers](../src/main/app/application/managers/) 布局一致：

```
src/main/app/application/managers/vcs/
  backend.ts             # 可插拔边界：动态加载 + 可用性判定（见 §7）
  loreClient.ts          # 唯一 import @lore-vcs/sdk 的文件（见 §3）
  revisionReader.ts      # blobAt / blobsAt / mergeBase / threeWay / changedPaths
  VcsManager.ts          # 按项目 keying 的 session，flush-then-close
  diff/                  # Studio 自己的 diff 引擎（待建）
```

Lore 的异步变体在自己的线程池上跑，`waitAsync()` 返回 Promise，主进程不会被算力阻塞。但**回调要穿过 koffi 进 V8**，高频进度事件（每 fragment 一个）有 jank 风险。

因此：把 `VcsManager` 的对外接口设计成**可整体搬走**的形态。如果 profiling 显示 clone/sync 造成掉帧，再把批量传输挪进 `utilityProcess`（Studio 的 [buildWorker](../src/main/buildWorker/) 已有先例）。交互式读路径（status、打开文件时的 diff）留在主进程，省掉一次 IPC 往返。**不要预先加这个进程边界。**

## 3. 必须自己封一层

`@lore-vcs/sdk` **只允许被一个文件 import**（`loreClient.ts`）。理由有三，每条都是硬的：

1. Lore 是 0.x，**没有 semver 保护**，API 会变
2. SDK 是用 Python + Jinja 从 `lore.h` **代码生成**的，header 一动 SDK 就动
3. §4 那一堆坑必须被封死在一个地方，不能散落各处

Studio 面向业务的类型里**不许出现 `Lore` 前缀**。往外暴露自己的 `Revision`、`BlobRef`、`ChangeSet`。这样万一要换底层（或 Lore 1.0 破坏性变更），改动面是一个文件。

## 4. 坑（全部实测，不是推测）

这一节是本文的核心。以下每条都在 v0.8.5 上复现过。

### 4.1 标识符编码：一个上游 bug，不是设计

**这条最初被误判过，值得记录推导过程。** 表面现象是「`storage*` 要十六进制字符串，`revisionTree*` 要 `{data:Uint8Array}`」——但这是错误归纳，照这个结论写封装层会埋下静默数据损坏。

真实规则从 SDK 自己的生成器推导得出（[`lore-js/generator/templates/native.ji`](https://github.com/EpicGames/lore-js/blob/main/generator/templates/native.ji)）：

生成器为每个函数产出一张 `convertOptions` 表，`convertToLoreDatatype` 按表把 JS 值转成 C 表示。它实现了 `loreBoolean` / `loreString` / `loreBytes` / `loreBinary` / `lorePartition` / `loreContext` / `loreAddress` / `arrayTypes` / `complexTypes` 九个 handler。

> **契约：所有标识符一律传十六进制字符串。**

**唯一缺陷**：生成器还会产出 `loreHash: [...]` 条目，但 `convertToLoreDatatype` **没有 `loreHash` handler**。这些字段原样撞上 koffi，报 `Unexpected String value, expected object`。

v0.8.5 受影响的函数**恰好四个**：

| 函数 | 未转换的 hash 字段 |
|---|---|
| `revisionTreeLoad` | `revisionHash` |
| `storageMutableLoad` | `key` |
| `storageMutableStore` | `key`, `value` |
| `storageMutableCompareAndSwap` | `key`, `expected`, `value` |

Studio 的路径上只有 `revisionTreeLoad`。

**为什么必须封装而不是背清单**——两个方向的失败模式是不对称的：

| 传错方向 | 后果 |
|---|---|
| 该传二进制却传了 hex | **抛异常**。安全 |
| 该传 hex 却传了二进制 | `hexStringToByteArray({data})` 读 `.length` 得 `undefined`，返回**长度为 0** 的数组，koffi 把定长字段零填充。**调用成功，partition 变成全零** |

第二种是静默数据损坏。之所以在单仓库测试里没暴露，是因为 `revisionTreeLoad` 的 `repository` 会被 store handle 覆盖——一旦 Studio 用一个 store 跨多仓库（links/layers、多项目同开），它立刻变成数据路由 bug。

**封装层的对策**：先按 hex 发；只有捕获到 `Unexpected String value` 且该调用声明了 `hashArgs` 时，才改写这些字段并锁存决定。这样在今天的 SDK 上自动降级，在上游修复后自动保持 hex，**不需要版本嗅探**，也永远不会把非 hash 字段改写成会零填充的形态。见 [loreClient.ts](../src/main/app/application/managers/vcs/loreClient.ts)。

### 4.2 `.callback()` 是替换，不是追加

调两次 `.callback()`，第一个handler 被**静默丢弃**，调用照样返回 `rc=0`，你只是拿不到数据。这个坑极难 debug——没有报错，只有空结果。

封装时只留一个 callback 入口，内部自己分发。

### 4.3 事件数据是借来的 FFI 内存

回调返回后 `event.data` 就失效。**想留住任何东西必须 `event.clone()`**，忘了就是随机内存垃圾且不报错。

另外：回调里**不能重入调用 Lore**，这是进程级契约。先收集事件，出了回调再处理。

### 4.4 路径按进程 CWD 解析，不是按 `repositoryPath`

`lore-revision/src/util/path.rs:654` 调 `std::path::absolute()`，相对路径按**进程当前工作目录**解析。Electron 主进程的 CWD 永远不是项目目录。

**所有路径一律传绝对路径。**

### 4.5 路径错了不报错，静默跳过

传了仓库外的路径，`fileStage` 返回 **`rc=0`**、发一个 `PATH_IGNORE` 事件、`totalCount: 0`，然后 commit 才报 `Nothing staged for commit`。

封装层必须**显式监听 `PATH_IGNORE` 并抛错**，否则用户的资产会悄无声息地没进版本库。

### 4.6 `offline: true` 不是网络开关

大部分 verb 尊重它，但 `repositoryInfo` 照样去连远端并超时失败。不能靠这个 flag 保证不卡网络——需要超时和取消。

### 4.7 离线创建仓库也强制要 URL

`repositoryCreate` 不给 `repositoryUrl` 直接失败（`lore-revision/src/repository/create.rs:44`），哪怕全程离线。填一个占位 URL 即可，没有任何东西会去连它。

### 4.8 远端拉回的 fragment 默认不落盘

```c
// lore_global_args_t
uint8_t cache;  // Without this only state fragments and fragments
                // flagged for local cache priority are retained
```

`storageGet` 的 item 上也有 `localCache`。**默认都不缓存**，意味着反复 diff 同两个版本会反复走网络。本地缓存还是 LRU + 预算上限，会被驱逐。

对策见 §6。

### 4.9 读 blob 的 payload 字段叫 `bytes`

`STORAGE_GET_DATA` 事件的载荷在 `.bytes`，不是 `.data`。`STORAGE_GET_HEADER` 先给 `sizeContent`。

### 4.10 类型表面撒谎：写侧 API 不存在

`@lore-vcs/sdk` 导出了 `LoreRevisionTreeAddArgs`、`LoreRevisionTreeCommitArgs`、`LoreRevisionTreeModifyArgs` 等类型，**但对应的函数不存在**：

- `lore.h` 里只有 args struct，**没有函数声明**
- DLL 里**没有导出这些符号**（实测 `lore_revision_tree_add` / `_commit` / `_modify` 全部 missing）
- 对应提案 [LEP 2026-05-14](https://github.com/EpicGames/lore/blob/main/docs/proposals/2026-05-14-low-level-revision-api.md) 状态仍是 **Draft**

**能读不能写。** 内存态构造 revision 目前不可能，写回必须走工作树：`fileWrite` → `fileStage` → `revisionCommit`。对 diff 场景够用。

### 4.11 不 flush 会丢 commit —— 最危险的一个

**实测**：一个进程连做两次 `revisionCommit`（各自都返回了 revision hash）然后退出，另一个进程读回来**只看得到第一次提交**。第二次彻底消失。加一句 `repositoryFlush` 之后，两次都在。

原因是 Lore 的 mutable store（存分支 tip）是**延迟落盘**的（`flush_delay_seconds` 默认 10 秒）。提交返回成功、工作树看起来也对，但分支 tip 还在内存里。

而且这是**竞态**，不是稳定失败——第一次提交侥幸持久化了（大概是被第二次提交的写操作带下去的）。间歇性丢数据比稳定丢数据更糟。

> **任何写路径在向用户报告成功之前必须 flush。** 封装层已经把 flush 放进 [`closeProject`](../src/main/app/application/managers/vcs/VcsManager.ts)，并在 [`flushRepository`](../src/main/app/application/managers/vcs/revisionReader.ts) 上写了警告。

### 4.12 仓库锁是独占的，而且是阻塞而非报错

store handle 开着的时候，第二个进程访问同一仓库会**一直等**，不会失败。实测：持有方 20 秒后退出，等待方立刻成功——它整整阻塞了 16 秒。

对 Studio 的后果：只要项目开着，用户的 `lore` CLI 就会挂住。所以 `VcsManager` 的 session **必须在窗口关闭时释放**，这条已经接到 [src/main/index.ts](../src/main/index.ts) 的 `window-closed` 上。忘了这一步不会有任何报错，只会让外部工具莫名其妙地卡死。

### 4.13 加载失败是不可逆的，整个进程都别想再用

`@lore-vcs/sdk` 在**模块求值期**就调 `koffi.load()`。ESM 模块求值一旦抛异常，Node 会**永久缓存这个失败**——同一进程里再 import 多少次都是同一个错误，`vi.resetModules()` 也够不着（模块归 Node 的 loader 管，不归 vitest）。

两个后果：

1. **运行时**：Studio 进程如果第一次加载后端就失败，不重启就永远恢复不了。所以 [backend.ts](../src/main/app/application/managers/vcs/backend.ts) 把「不可用」判定**缓存下来**——重试没有意义。
2. **测试**：一个用坏路径触发加载失败的测试，会污染同文件里后续所有测试。可用性降级测试和 happy path 因此被**故意拆成两个文件**（vitest 按文件分 worker）。

### 4.14 revisionTree 读路径在 SDK 里零测试覆盖

`lore-js` 自己的测试套件**没有任何 `revisionTree` 用例**。capi 有实现、绑定是自动生成的，但 JS 层没人验证过。Studio 会是早期用户——这条路径的回归测试得 Studio 自己写。

## 5. 服务端策略

### 5.1 P0：不需要任何服务端，也不需要包装

已验证：`repositoryCreate` → `fileStage` → `revisionCommit` → `revisionHistory` → 读任意历史 blob，**全程 `offline: true`，从未启动过 loreserver**。

Studio 的主力用户是单人或 2–5 人小团队。单人场景下版本控制是纯本地功能，零服务端。这应该是 P0 的全部范围。

### 5.2 P1：局域网协作 —— 裸 loreserver

单个可执行文件，无外部依赖，零配置可跑：

```bash
loreserver --config /opt/loreserver/config
```

持久化只要一个 `local.toml`（immutable/mutable store 路径 + 自签证书）。健康检查 `curl http://127.0.0.1:41339/health_check`。

**认证是个洞，必须知道**：Lore 只有 JWT/JWKS **验证**能力，且**所有随附配置都没开**（`[server.auth]` 缺失 = 接受未认证请求）。它不提供用户体系、不签发令牌。开箱即用 = 谁连上谁能读写。

对局域网小团队这可接受——把网络隔离当边界，这也是多数 Perforce 内网部署的实际状态。但要在 Studio 的文档里写明白。

### 5.3 P2：只有在需要认证时才写包装

**不要为了包装而包装。** 唯一值得写服务端的理由是需要真正的身份认证。那时候需要的是一个 sidecar，而不是代理：

- 签发 JWT
- 暴露 JWKS 端点供 loreserver 拉公钥
- 顺带做项目发现/列表

loreserver 本身不动，它只负责验签。这是个几百行的服务，不是一个平台。

### 5.4 命名

**不要在 Studio 侧的任何名字里出现 `lore`。** Lore 是 0.x，协议会破坏性变更，甚至可能需要换底层。名字应该描述能力，不是供应商。

| 东西 | 名字 |
|---|---|
| Studio 内部模块 | `src/main/app/application/managers/vcs/`，`VcsManager` |
| 抽象层若抽成包 | `@narraleaf/vcs` |
| 服务端（若真的要做） | 产品名 **NarraLeaf Hub**，仓库 `NarraLeaf-Hub`，包 `@narraleaf/hub` |

## 6. 离线 diff 策略

稀疏 + 懒加载意味着历史版本的 fragment **大概率不在本地**。加上 §4.8 的默认不缓存，天真实现会让每次 diff 都走网络。

必须做的四件事：

1. **所有读操作显式传 `cache: true` / `localCache: true`**——这一条解决大半问题
2. **预热**：打开 diff 视图时先用 `revisionDiff` 拿变更文件清单，再批量 `storageGet` 把两个版本的 blob 拉进本地 store，然后纯本地做 diff
3. **复用 store handle**：globals 里设 `storeKeepAlive`，避免连续调用反复开关 store（默认保活 10 秒）
4. **UI 承认现实**：设计成「首次 diff 可能联网」，给 loading 态。不要假装纯离线

单机场景（P0）完全不涉及这些——所有 fragment 本来就在本地。

## 7. 可插拔与降级 —— Studio 依旧全平台分发

v0.8.5 官方产物只有四个：

| 平台 | 状态 |
|---|---|
| `win32-x64` | ✅ |
| `darwin-arm64`（Apple Silicon） | ✅ |
| `linux-x64` | ✅ |
| `linux-arm64` | ⚠️ 仅 Graviton/Neoverse-512tvb（SVE），普通 ARM 跑不了 |
| **`darwin-x64`（Intel Mac）** | ❌ **没有** |
| **`win32-arm64`** | ❌ **没有** |

**决定：不砍平台，砍能力。** Studio 在所有平台照常分发；没有原生构建的机器上，版本控制这一个功能报告自己不可用，其余功能完全不受影响。

### 为什么必须是动态加载

`@lore-vcs/sdk` 在**模块求值期**调 `koffi.load()`（§4.13）。也就是说一句静态 `import` 就足以在 Intel Mac 上**让主进程启动期崩溃**——不是丢一个功能，是整个 app 起不来。实测：把平台子包移走，静态 import 直接抛 `Failed to load shared library`。

所以 [backend.ts](../src/main/app/application/managers/vcs/backend.ts) 是唯一的插拔边界，规则只有一条：

> **`vcs/` 之上的任何代码，都不许在模块作用域 import 到 `@lore-vcs/sdk`——直接或间接都不行。**

`VcsManager` 只用 `import type`（编译期擦除），实际后端走 `await import()`，包在平台闸门 + try/catch 里。

### 三种不可用，分开报

```ts
type VcsUnavailableReason =
    | "unsupported-platform"    // 这个 OS/arch 就没有构建
    | "backend-missing"         // 平台支持，但这份安装里没装上
    | "backend-load-failed";    // 装了但加载失败（损坏、缺 CRT、被策略拦）
```

分开是有意义的：第一种要说「你的机器不支持」，第三种要说「你的安装坏了」——给用户的行动完全不同。

### 逃生舱

`LORE_LIB_PATH` 环境变量可以指定任意 lorelib 路径，**并且会跳过平台闸门**。Intel Mac 用户如果自己 `cargo build --target x86_64-apple-darwin` 出一份，指过去就能用。这条也是自建平台包之外的低成本路子。

### 渲染进程必须先问再用

`vcs.getAvailability()` 是**唯一**正确的探测方式。不要用 try/catch 去试其它调用——那样分不出「不支持」和「这个目录不是仓库」。详见 §9 的接口。

### 实测降级行为

把平台包移走后启动 Studio：

```
app alive, page title: NarraLeaf - launcher          ← 应用正常启动
getAvailability : {"available":false,"reason":"backend-load-failed","detail":"Failed to load shared library: ..."}
isRepository    : {"success":true,"data":{"isRepository":false}}   ← 优雅返回，不抛
getInfo         : {"success":false,"error":"Version control backend failed to load: ..."}
非 VCS 的 IPC    : {"success":true}                   ← 完全不受影响
```

装回去之后 `getAvailability` 立刻恢复 `{"available":true}`，全链路正常。

### 打包补充

- macOS：`.dylib` 要 codesign + hardened runtime + notarization。Studio 目前 `resetAdHocDarwinSignature: true` 走未签名分发，这条**不引入新问题**，但正式签名时要一并处理
- Windows：确认 lorelib 是静态链接 MSVC runtime 还是需要 vcredist
- **跨平台构建是个真陷阱**：yarn 按 `os`/`cpu` 只装匹配**构建机**的平台包。在 Windows 上打 mac 包，会把 Windows DLL 装进去而没有 dylib，产出一个 VCS 永远不可用的 mac 版。CI 必须在目标平台上装依赖，或配 `supportedArchitectures`
- Docker 的 `linux/arm64` 服务端镜像是针对 AWS Graviton3 编译的，Apple Silicon 上必须 `--platform linux/amd64`

## 8. 版本策略

三个因素叠加，兼容风险是**高**：0.x 无 semver、SDK 从 header 代码生成、客户端与服务端协议必须匹配。

- **锁死版本**，不用 `^`，不用 nightly
- Studio 每个发行版绑定一个具体 Lore 版本，发行说明写明所需 loreserver 版本
- 按季度评估升级，不跟版本
- 升级时重跑 §9 的验证脚本

参考节奏：开源首月发了 0.8.3 / 0.8.4 / 0.8.5，约两周一发。

## 9. 已落地的实现

依赖已装，全链路已接通，并在**运行中的 Studio** 里验证过（可用与不可用两条路都验证了）。

| 文件 | 职责 |
|---|---|
| [backend.ts](../src/main/app/application/managers/vcs/backend.ts) | **插拔边界**。动态加载、平台闸门、可用性判定与缓存、`VcsUnavailableError` |
| [loreClient.ts](../src/main/app/application/managers/vcs/loreClient.ts) | **唯一** import `@lore-vcs/sdk` 的地方。单 callback、自动 clone、hash 编码降级、`PATH_IGNORE` 转异常、错误带 Rust `file:line`、路径越界防护 |
| [revisionReader.ts](../src/main/app/application/managers/vcs/revisionReader.ts) | `blobAt` / `blobsAt` / `readRevisionGraph` / `mergeBase` / `threeWay` / `changedPaths` / `flushRepository` |
| [VcsManager.ts](../src/main/app/application/managers/vcs/VcsManager.ts) | **按项目路径 keying** 的 session（store handle 复用 + 每项目串行化），flush-then-close |
| [vcsAction.ts](../src/main/app/application/managers/window/handlers/vcsAction.ts) | 8 个只读 IPC handler |
| [vcs.ts](../src/shared/types/vcs.ts) | 渲染进程类型 + 平台表 + `isVcsPlatformSupported()`，**不含任何 `Lore` 前缀** |
| [backend.test.ts](../src/main/app/application/managers/vcs/backend.test.ts) | 6 个降级测试（含 Intel Mac / Windows ARM64 路径） |
| [revisionReader.test.ts](../src/main/app/application/managers/vcs/revisionReader.test.ts) | 11 个集成测试，打真实原生库 |

构建侧：`@lore-vcs/sdk` 和 `koffi` 在 [build-main.js](../project/build/build-main.js) 与 [dev-electron.js](../project/app/dev-electron.js) 里标了 external；`asarUnpack` 已有，没改。session 释放接在 [index.ts](../src/main/index.ts) 的 `window-closed` 上。

### 渲染进程接口

```ts
window[RendererInterfaceKey].vcs
```

| 方法 | 返回 |
|---|---|
| `getAvailability()` | `{available}` 或 `{available:false, reason, detail}` — **先问这个** |
| `isRepository(projectPath)` | `{isRepository}`；后端不可用时为 `false`，不抛 |
| `getInfo(projectPath)` | `{root, repositoryId, head?, revisionCount}` |
| `getHistory(projectPath, limit?)` | `{entries: [{revision, number, parents}]}` |
| `readBlob(projectPath, revision, path)` | `{contentBase64}` |
| `getChangedPaths(projectPath, from, to)` | `{paths}` |
| `getThreeWay(projectPath, mine, theirs, path)` | `{baseRevision?, base?, mine, theirs}`（均 base64） |
| `getMergeBase(projectPath, a, b)` | `{base?}` |

**写侧故意不做**：没有 resolve UI 之前放出提交入口，等于让渲染进程在没有冲突处理的情况下提交。

**为什么 keying 是硬要求**：Studio 是 one-project-one-window，单例 runtime 会让第二个打开的项目和第一个抢同一个 store handle——而 Lore 的仓库锁是独占的（§4.12），后果不是数据竞争而是死等。DevMode 踩过这个坑。

### 升级绊线

`loreClient` 的 hash 编码是**自适应**的，测试里有一条断言专门盯着它：

```ts
check("fallback fired and latched to binary on v0.8.5",
      __hashCodecForTests() === "binary");
```

上游一旦实现 `loreHash` handler，这条断言会失败——那不是回归，是**信号**：把断言翻成 `=== "hex"`，然后确认没有别处依赖旧行为。

## 10. 待解问题

- **UI 尚未对接**。主进程侧完整可用，渲染进程还没有任何 VCS 界面。交接说明见 [plans/2026-07-18-001-handoff-vcs-integration.md](plans/2026-07-18-001-handoff-vcs-integration.md)
- **仓库来源未定**：Studio 目前假设「项目目录 == 仓库根」，但没有任何地方**创建**仓库。用户怎么把一个项目变成 Lore 仓库（向导？菜单？自动？）是产品决策，未做
- **LCA 的 criss-cross**：`mergeBase` 当前按 `revisionNumber` 取最高的共同祖先。两分支互相合并过时会有多个极小公共祖先，Git 用递归 merge base 解决。当前取舍写在 [revisionReader.ts](../src/main/app/application/managers/vcs/revisionReader.ts) 注释里：降级结果是「base 略差 → 用户多看到几个冲突」，不是错误合并
- **取消/超时**：长操作（clone、sync）能否中途取消未验证。`offline` 不可靠（§4.6），封装层还没有超时机制
- **多仓库 store 复用**：§4.1 的零填充风险只在一个 store 跨多仓库时才会咬人。links/layers 或多项目同开时要专门测 `repository` 参数确实生效
- **跨平台 CI**：§7 说的构建机平台包陷阱还没在 CI 里防住
- **文件锁**：Lore 当前的锁是「告知」不是「强制」，且全仓库查询不可扩展。强制锁在 Lore 2026 roadmap 上，二进制资产的并发编辑保护要等
- **UEFN 兼容**：Lore OSS 用 Zstandard，UEFN 历史上用 Oodle，两者不兼容，Epic 正在收敛。与 Studio 无关，但解释了为什么 Lore Desktop 打不开 UEFN 项目

## 参考

- [EpicGames/lore](https://github.com/EpicGames/lore) · [lore-js](https://github.com/EpicGames/lore-js) · [文档站](https://epicgames.github.io/lore/)
- [system-design.md](https://github.com/EpicGames/lore/blob/main/docs/explanation/system-design.md) — 架构权威文档
- [roadmap.md](https://github.com/EpicGames/lore/blob/main/docs/roadmap.md) — VFS、强制锁、桌面/Web 客户端时间线
- `lore-capi/lore.h` — 所有 SDK 的规范来源，判断某能力是否存在**以它为准**，不要信 TypeScript 类型（§4.10）
