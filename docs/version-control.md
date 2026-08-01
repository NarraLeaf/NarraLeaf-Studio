# Studio 版本控制：技术路线

Studio 的版本控制以 [Epic Games Lore](https://github.com/EpicGames/lore) 为底层，**diff 逻辑和冲突解决界面由 Studio 自己实现**。本文是这条路线的唯一事实来源：架构、依赖方式、进程模型、已验证的能力边界，以及必须提前知道的坑。

选 Lore 而不是 Git 的理由只有一条，但足够：Studio 的资产是二进制和 JSON，Lore 的存储热路径**不做 CRLF 转换、不做编码推断、没有 clean/smudge filter**（[system-design.md §13](https://github.com/EpicGames/lore/blob/main/docs/explanation/system-design.md)），且分块去重是 fragment 级而非文件级。Git 的 autocrlf + LFS 组合在这两点上都是长期事故源。

> **状态**：Lore 于 2026-06-16 开源，本文基于 **v0.8.5**（2026-07-16）核实。Lore 是 pre-stable 0.x，
> **API 和协议在 1.0 前都会变**；数据格式官方承诺向前兼容。
>
> **2026-07-27 重大变更**：Studio 不再使用 `@lore-vcs/sdk` 的运行时。绑定改为
> [自己写](#21-客户端自有-koffi-绑定)，只保留 SDK 作为 devDependency 供 ABI 快照脚本使用。
> §4 的坑分成了两类：**已由自有绑定按构造消除**的，和**仍然成立**的，每条都标了。

## 0. 结论先行

| 问题 | 结论 |
|---|---|
| 能拿到任意历史版本的原始 blob 做 diff 吗 | **能**，已验证字节精确，无需工作树、无需服务器 |
| 三路合并的 base 能拿到吗 | **Lore 不提供**，但 DAG 完整；LCA 已在 §9 的封装层里实现 |
| 能纯离线吗 | **单机能**，已验证；团队场景首次读远端历史要联网 |
| 原生库能进 Electron 吗 | **能**，Electron 38 直接可用，无需重编 |
| 需要写服务端包装吗 | **P0 不需要**，见 §5。局域网协作已实现，连接流程见 §5.3.1 |
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

### 2.1 客户端：自有 koffi 绑定

**Studio 自己绑定 lorelib，不用 SDK 的运行时。**

```jsonc
// package.json
"dependencies":    { "koffi": "2.16.2" },
"optionalDependencies": {          // 只要 DLL，不要 JS
  "@lore-vcs/sdk-amd64-unknown-windows": "0.8.5",
  "@lore-vcs/sdk-arm64-apple-darwin":    "0.8.5",
  "@lore-vcs/sdk-amd64-unknown-linux":   "0.8.5",
  "@lore-vcs/sdk-arm64-graviton-linux":  "0.8.5"
},
"devDependencies": { "@lore-vcs/sdk": "0.8.5" }   // 仅供 ABI 快照脚本
```

四个平台包各自带 `os`/`cpu` 字段，包管理器只装匹配当前平台的那个（Windows 上只装
`sdk-amd64-unknown-windows`，29MB DLL）。放进 `optionalDependencies` 是**故意的**：装不上
（不支持的平台、`--no-optional`、网络失败）不能让 Studio 整个装不上。

**为什么丢掉 SDK 的 JS**——三条，都是硬的：

1. **失败模式是静默数据损坏。** SDK 用一张 `convertOptions` 查找表转换参数，其中 `loreHash`
   一类**没有实现 handler**。传错方向不报错，而是把定长字段零填充：调用成功，partition 全零。
   自有绑定里结构体字段的声明类型**就是**编码规则（`LoreString` 收十六进制、`LoreHash` 收 32
   字节），没有可查的表，也就没有可查错的表。
2. **加载失败不可逆。** SDK 在模块求值期 `koffi.load()`，ESM 求值抛异常被 Node 永久缓存，
   不支持的平台上一句静态 import 就让主进程启动期崩溃。自有绑定在**函数内**加载，用户修好
   安装后可以 [`refreshVcsAvailability()`](../src/main/app/application/managers/vcs/backend.ts) 恢复，不必重启。
3. **只用得上 27%。** 131 个 verb 里我们需要 ~35 个；SDK 为另外 96 个背了几百个事件结构体和
   一整套通用转换层，我们承担全部风险却拿不到收益。

**ABI 正确性怎么保证**——手写结构体写错布局 = 内存损坏，所以三道防线：

| 防线 | 位置 |
|---|---|
| 与 SDK 生成的绑定**逐字段比对**（420 结构体 / 131 函数 / 226 事件 tag 的快照） | [`tools/lore-abi-extract.mjs`](../tools/lore-abi-extract.mjs) → `abi/upstream.json` |
| 161 个断言：字段名/类型/顺序、别名、verb 签名、事件 tag 数值、声明顺序 | [`abi/definitions.test.ts`](../src/main/app/application/managers/vcs/lore/abi/definitions.test.ts) |
| 打真 DLL 的往返测试（建库→暂存→提交→历史→读 blob→分支） | [`lore.integration.test.ts`](../src/main/app/application/managers/vcs/lore/lore.integration.test.ts) |

快照**进版本库**，所以校验不需要装 SDK。升级 Lore 时重跑提取脚本，`upstream.json` 的 diff
**就是升级报告**。

**关键：lorelib 是普通共享库（.dll/.dylib/.so），不是 N-API addon。** 它不随 Electron ABI 变化，Electron 升级不需要重编——这比 [`@narraleaf/encryption`](../src/main/app/application/managers/security/packKeyService.ts) 的 node-gyp 路线省心得多。唯一 ABI 绑定的是 `koffi`，它自带各 ABI 的 prebuilt。

已验证：Electron 38.8.6 / Node 22.22.0 / ABI 139 下 SDK 直接加载并完成 storagePut→storageGet 往返，零额外配置。

### 2.2 构建配置

esbuild 必须把 koffi 标记为 external，与现有 `@narraleaf/encryption` 同构：

```js
// project/build/build-main.js 和 project/app/dev-electron.js
external: ['electron', 'esbuild', '@narraleaf/encryption', 'koffi']
```

平台包**不用**列进 external：`library.ts` 用 `createRequire(__filename)` 做计算 require，
esbuild 静态分析跟不进去，自然不会打包它。

**打包后仍然惰性**这一条已用 metafile 证明，不是靠注释保证：
[`pluggability.test.ts`](../src/main/app/application/managers/vcs/pluggability.test.ts) 从 `src/main/index.ts`
走静态导入图（只跟 import 语句和 require，**不跟** `import()`），断言 `vcs/lore/` 一个文件都不在里面，
同时断言 `VcsManager.ts` 和 `backend.ts` 在里面（否则这个断言是空的）。

electron-builder **不需要改**：[electron-builder.yml](../electron-builder.yml) 已有 `asarUnpack: node_modules/**/*`，原生库不会被封进 asar。这是最容易翻车的一步，Studio 已经免疫。

### 2.4 工作集：`.loreignore` 是 Lore 自己的能力

**本文此前的隐含前提是「排除得由调用方解决」——那是错的。** Lore 支持 `.loreignore`，实测语义
（v0.8.5，靠 DLL 字符串定位到 `lore-revision/src/filter.rs` + `glob-match`，再用真库逐条验证）：

| 行为 | 实测 |
|---|---|
| 被排除的路径发 **`FILTER_EXCLUDE`(102)**，不是 `PATH_IGNORE`(130) | 所以 `stage` 不会因此抛错，§4.5 的仓库外守卫仍然完整 |
| 单段模式**任意深度**匹配 | `dist` 也会排除 `sub/dist`；要锚定根就写 `/dist/` |
| 多段模式根锚定；`*.ext` 任意深度 | |
| `#` 注释与空行无效力；`!` 取反可用 | |
| `.lore/` 天然排除；**点目录不天然排除** | `.nlstudio/plugins/x.js` 不写进忽略文件就会被提交——已用差分实测：**不写忽略文件时它确实进了提交** |
| `repositoryStatus` 同样遵守 | |
| 忽略文件自身进版本库 | 策略随 clone 传播 |

所以 `stage(globals, [root])` 一次调用即可，**不需要传显式路径清单**，也就没有几千个路径塞进
一个 `LoreStringArray` 的规模问题。策略表在
[workingSet.ts](../src/main/app/application/managers/vcs/workingSet.ts)，谓词与忽略文件由**同一张表**生成，
两者不可能漂移。

### 2.3 进程模型

**全部 Lore 调用必须在主进程**——原生 FFI，渲染进程碰不到。

P0 建议：**全放主进程**，作为一个新的 manager，与现有 [managers](../src/main/app/application/managers/) 布局一致：

```
src/main/app/application/managers/vcs/
  backend.ts             # 可插拔边界：动态加载 + 可用性判定（见 §7）
  lore/                  # 自有 koffi 绑定（见 §3）
  revisionReader.ts      # blobAt / blobsAt / mergeBase / threeWay / changedPaths
  VcsManager.ts          # 按项目 keying 的 session，flush → close → release
  documents/             # 文档模型与规范序列化（H1，待建）
  diff/                  # Studio 自己的 diff 引擎（待建）
```

Lore 的异步变体在自己的线程池上跑，`waitAsync()` 返回 Promise，主进程不会被算力阻塞。但**回调要穿过 koffi 进 V8**，高频进度事件（每 fragment 一个）有 jank 风险。

因此：把 `VcsManager` 的对外接口设计成**可整体搬走**的形态。如果 profiling 显示 clone/sync 造成掉帧，再把批量传输挪进 `utilityProcess`（Studio 的 [buildWorker](../src/main/buildWorker/) 已有先例）。交互式读路径（status、打开文件时的 diff）留在主进程，省掉一次 IPC 往返。**不要预先加这个进程边界。**

## 3. 边界在哪

绑定全部关在 [`vcs/lore/`](../src/main/app/application/managers/vcs/lore/) 里，上面只有一个插拔口
[`backend.ts`](../src/main/app/application/managers/vcs/backend.ts)。规则两条：

1. **`backend.ts` 之上不许静态引用 `lore/`**，直接间接都不行——只能 `import type` 或
   `await import()`。这条由 §2.2 的导入图测试守着，不靠人记。
2. **Studio 面向业务的类型里不许出现 `Lore` 前缀。** 往外暴露自己的 `Revision`、`BlobRef`、
   `ChangeSet`。Lore 是 0.x，随时可能要换底层；名字描述能力，不描述供应商。

`lore/` 内部分工：

| 文件 | 职责 |
|---|---|
| `abi/definitions.ts` | 纯数据：结构体、别名、verb 表、事件 tag。不 import koffi，不碰原生库 |
| `abi/upstream.json` | 从 SDK 生成物提取的 ABI 快照，`definitions.test.ts` 的比对基准 |
| `library.ts` | 惰性 `koffi.load`、`LORE_LIB_PATH` 逃生舱、asar 解包、按需绑定 + 符号缺失探测 |
| `values.ts` | 显式编码/解码：hex ↔ 定长字段（**非法即抛**）、字符串、字节、路径越界防护 |
| `events.ts` | 事件解码表：**在回调内拷贝完**，没有借用内存能逃出去 |
| `call.ts` | 唯一的 invoke：单 trampoline、异步 off-thread、注册/注销配对、错误富化、`PATH_IGNORE` 转异常 |
| `verbs.ts` | ~22 个有类型的操作，Studio 唯一调用面 |

## 4. 坑（全部实测，不是推测）

这一节是本文的核心。以下每条都在 v0.8.5 上复现过。

### 4.1 标识符编码：一个上游 bug，不是设计

> **已按构造消除（2026-07-27）。** 自有绑定里没有转换表：结构体字段的声明类型就是编码规则，
> `LoreHash`/`LorePartition`/`LoreContext` 字段收定长字节，长度不对**抛错**而不是补零
> （[`values.ts` 的 `hashBytes`](../src/main/app/application/managers/vcs/lore/values.ts)）。
> 下面保留原始推导，因为它解释了为什么「照抄清单」不是解法。

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

**当时封装层的对策**是自适应降级：先按 hex 发，捕获到 `Unexpected String value` 再改写并锁存决定。它能用，但正确性依赖上游一句错误文案不变。自有绑定不需要这套：`revisionTreeLoad` 的 `repository`/`revisionHash` 在头文件里**本来就是** `LorePartition`/`LoreHash`，按声明类型发定长字节即可，上游修不修 handler 都不影响我们。

### 4.2 `.callback()` 是替换，不是追加

> **已消除**：SDK 专有行为。自有绑定注册**唯一一个** trampoline，事件在 JS 里分发给多个订阅者
> （[`call.ts`](../src/main/app/application/managers/vcs/lore/call.ts)）。

调两次 `.callback()`，第一个 handler 被**静默丢弃**，调用照样返回 `rc=0`，你只是拿不到数据。
这个坑极难 debug——没有报错，只有空结果。

### 4.3 事件数据是借来的 FFI 内存

> **前半已消除**：自有绑定在回调内**立即完整解码并拷贝**，出了 `decodeEvent` 就没有借用内存
> （[`events.ts`](../src/main/app/application/managers/vcs/lore/events.ts)），没有「忘记 clone」这回事。
> **后半仍然成立**：回调里**不能重入调用 Lore**，这是进程级契约，`invoke` 先收集完再处理。

回调返回后 `event.data` 就失效。SDK 用一个惰性 `.data` getter 建模这件事，忘了 `clone()`
就是随机内存垃圾且不报错。

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

> **已消除**：自有绑定在**函数内**调 `koffi.load()`，失败只是一个异常。用户修好安装后
> `refreshVcsAvailability()` 就能恢复，不必重启 Studio。下面是 SDK 的原始行为，保留是因为
> 它解释了为什么可用性判定至今仍然缓存（探测一次要 dlopen 29MB，不是因为不能重试）。

`@lore-vcs/sdk` 在**模块求值期**就调 `koffi.load()`。ESM 模块求值一旦抛异常，Node 会**永久缓存这个失败**——同一进程里再 import 多少次都是同一个错误，`vi.resetModules()` 也够不着（模块归 Node 的 loader 管，不归 vitest）。

两个后果：

1. **运行时**：Studio 进程如果第一次加载后端就失败，不重启就永远恢复不了。所以 [backend.ts](../src/main/app/application/managers/vcs/backend.ts) 把「不可用」判定**缓存下来**——重试没有意义。
2. **测试**：一个用坏路径触发加载失败的测试，会污染同文件里后续所有测试。可用性降级测试和 happy path 因此被**故意拆成两个文件**（vitest 按文件分 worker）。

### 4.14 revisionTree 读路径在 SDK 里零测试覆盖

`lore-js` 自己的测试套件**没有任何 `revisionTree` 用例**。capi 有实现、绑定是自动生成的，但 JS 层没人验证过。Studio 会是早期用户——这条路径的回归测试得 Studio 自己写。

### 4.15 关掉 store 不等于放开仓库

`storageClose` 只关一个 store handle。**仓库本身还开着**（`storeKeepAlive` 默认保活若干秒），
后果有两个：

- Windows 上删不掉项目目录，`rmSync` 报 **EPERM**
- 用户自己的 `lore` CLI 会**一直阻塞**在仓库锁上（§4.12 说的就是这个锁）

必须显式调 `repositoryRelease`。这条是写绑定时被测试的 teardown 逼出来的：整套测试全绿，
但删自己的临时目录失败。`VcsManager.closeProject` 现在是 **flush → closeStore → release** 三步。

### 4.16 路径方向是不对称的，类型上看不出来

| 调用 | 路径形态 |
|---|---|
| `fileStage` / `fileUnstage` 等**输入** | **绝对路径**。相对路径按进程 CWD 解析（§4.4），随后因为在仓库外被**静默忽略**（§4.5） |
| `repositoryStatus` 的**输出** | **仓库相对路径** |

也就是说「拿 status 的结果去 stage」这个最自然的写法，是坏的。任何把状态输出回喂给暂存的地方
都必须转换。TypeScript 类型两边都是 `string`，不会拦你。

### 4.17 `repositoryStatus(scan)` 不是纯读操作

**扫描会写状态。** 扫描时发现一个**新目录**，Lore 会把它记进暂存状态；之后把该目录删掉，
接下来整个 session 都会把它报成删除——尽管它从未被提交过。

对照实验（同样的文件操作、同样的最终磁盘状态，只差中间一次扫描）：

```
不调用中间扫描 -> []
调用了中间扫描 -> ["fresh:2", "fresh/inner.txt:2"]     // 2 = DELETE
```

新文件落在**已跟踪的目录**里不会有这个效果，是**目录**才会。

后果是硬的：**状态查询不能挂定时器轮询。** 作者中途建了个临时目录又删掉，两次轮询之间就会在
他的变更列表里留下不存在的删除项；他若照着提交，提交的是从未存在过的东西的删除。UI 只能按需
扫描，V2 的定时检查点也不能靠"定时扫一遍看有没有变化"来判断是否需要提交。

### 4.18 `LoreFileAction` 没有 MODIFY 这个成员

```
KEEP=0  ADD=1  DELETE=2  MOVE=3  COPY=4
```

**改过内容的文件报的是 `KEEP`(0)**，同时 `summary.modifies` 加一、`dirty` 为真。把 `action`
读成"没变"会让**项目里每一处编辑从状态列表里消失**。实测确认。

另外：重命名报成 delete + add，`summary.moves` 为 0 且 `fromPath` 为空——**不是** MOVE。
MOVE/COPY 只有走显式的移动 verb 才会出现。

### 4.19 §4.15 补充：暂存之后没有提交，release 之前还要 flush

§4.15 说「关 store 不等于放开仓库，还得 `repositoryRelease`」。实测补充：**`stage` 之后若没有
跟一次 commit，只调 `repositoryRelease` 仍然删不掉目录**，要先 `flushRepository`。带 commit 的
同一串调用则正常释放。

也就是说安全的收尾顺序是 **flush → closeStore → release**，而不是只在写路径末尾 flush。

### 4.20 `REPOSITORY_CREATE` 事件里的 path 在 Windows 上是正斜杠

`LoreRepositoryCreatePayload.path` 返回 `C:/Users/...` 形态，与 `path.join` 产出的根路径不可
直接比较。当成展示值，别当成路径键。

### 4.21 `revisionMetadataSet` 写的是**暂存修订**，不是 HEAD；且没暂存时会**泄漏到下一次提交**

`LoreRevisionMetadataSetArgs` 没有 revision 字段，直觉上会以为它写当前 HEAD。**实测是写
暂存修订**——也就是下一次 commit 将要产生的那个。

按「commit 之后再打标记」写，结果是每个标记都落在**后一个**修订上：检查点读回来是 commit，
下一次 commit 读回来是 checkpoint。对照实验（同一个库，`probe.kind`）：

```
stage → set(alpha) → commit          -> rev2 带 probe.kind=alpha    ✅
stage → commit（不 set）              -> rev3 无 probe.kind          ✅ 不会继承
（干净树）set(ghost) → commit 失败     -> 之后 stage → commit 产生的 rev4 带 probe.kind=ghost ❌
```

第三行是硬约束：**没有东西可提交时调 set 不会报错，它会等着贴到下一个提交上**。所以
[`commitWorkingTree`](../src/main/app/application/managers/vcs/repository.ts) 的顺序是
**stage → 确认有东西可提交 → set → commit → flush**，确认那一步用
`repositoryStatus(scan:false, revisionOnly:true)`（纯读，不触发 §4.17）。另外每条提交路径都写
这个键，所以万一泄漏也是被覆盖而不是被继承。

顺带实测：Lore 自己也往同一张表里写 `branch` / `timestamp` / `message` / `created-by` /
`committed-by`。所以 Studio 的键必须带前缀（`narraleaf.kind`），而**提交信息与作者名是读得回来的**。

### 4.22 `repositoryFlush` 会等满 `storeKeepAliveSeconds`

写路径末尾那一句强制的 flush（§4.11），耗时**不是**取决于要落盘多少东西，而是等前面那些
带 `storeKeepAlive` 的调用把 store 放掉。实测同一条 stage→set→commit→flush 管线：

| session globals | flush | 总计 |
|---|---|---|
| `storeKeepAlive: true`（默认 10 秒） | 9996 ms | 10012 ms |
| `storeKeepAlive: true, storeKeepAliveSeconds: 1` | 988 ms | 1009 ms |
| 不设 `storeKeepAlive` | 4 ms | 29 ms |

stage / commit 本身在三种配置下都是 5–20 ms，**开销全在等待**。

明显但**错误**的解法是只给 flush 那一次调用传 `storeKeepAlive: false`：完全无效（带 1029 ms
/ 不带 1009 ms）。等待属于**之前那些读**，只有窗口长度能缩短它。所以
[`VcsManager.globalsFor`](../src/main/app/application/managers/vcs/VcsManager.ts) 设
`storeKeepAliveSeconds: 1` —— 保住 §6.3「连续调用不反复开关 store」的本意（一批 blob 读之间
的间隔远小于 1 秒），同时把每次提交的代价从 10 秒压到 1 秒。

---

> **§4.23–§4.30 来自 2026-08-01 的合并实测**（卡 [2026-07-31-004](plans/2026-07-31-004-plan-vcs-diff-and-resolve.md) 的 D0）。
> 此前仓库里**没有一行代码碰过 Lore 的合并面**，所以这八条全部是第一次测量。脚本是
> `mergeSpike*.integration.test.ts`（打真 DLL，其中三条要真 loreserver 0.8.5）。
> **§4.29 值得单独读**：它记的是一条真缺陷，也记着这条缺陷第一次被归因错了——错的那版会让
> 我们在同步按钮旁边写一句根本不必要的「请重启 Studio」。

### 4.23 automerge 把冲突标记写进 JSON —— 但它同时在旁边留下三份干净的副本

同一个键两边都改，Lore 写的是 **diff3 三段式**标记（`<<<<<<< ours` / `||||||| original` /
`=======` / `>>>>>>> theirs`），标记直接插在 JSON 结构里，于是**这份文档不再能 `JSON.parse`**：

```
SyntaxError: Expected double-quoted property name in JSON at position 423
```

本地 `branchMergeStart` 与远端 `revisionSync` 产出的**字节完全相同**（同一个 sha256），
所以这是一套机制而不是两套。

**但真正有用的发现是另一半**：同一次合并还会在冲突文件旁边写三个附属文件——

| 文件 | 实测 |
|---|---|
| `doc.json~base` | 能 `JSON.parse`，无标记 |
| `doc.json~mine` | 能 parse，sha256 **与 `blobAt(mine)` 逐字节相同** |
| `doc.json~theirs` | 能 parse，sha256 **与 `blobAt(theirs)` 逐字节相同** |

也就是说三路合并的三个输入**已经在磁盘上了**，各自是一份完整、可解析的文档。写回管线
**既不需要读那份带标记的文件，也不需要从 DAG 重建**——计划 §6 里那个「若 automerge 破坏 JSON
就改用 `threeWay` 重建」的备案，被一个更简单的答案取代了。

**并且这三个附属文件不会进提交**：解决之后提交，修订里只有 `doc.json`（实测
`sidecarsCommitted: []`）。Lore 自己排除它们，`.loreignore` 不需要为此加规则。

### 4.24 冲突路径**只在事件流里出现一次**，`repositoryStatus` 永远不报

一次冲突合并之后，四种 status 形态**全部返回空列表**：

| 调用 | 结果 |
|---|---|
| `repositoryStatus({scan:true})` | `[]` |
| `repositoryStatus({scan:true, checkDirty:true})` | `[]` |
| `repositoryStatus({scan:false})` | `[]` |
| `repositoryStatus({scan:true, paths:[冲突文件]})` | `[]` |

原因是合并已经把结果**记进了暂存修订**，工作树与暂存修订一致，于是「没有变更」。
`summary` 也全是 0。所以 §4.18 那套「靠 status 找出改了什么」的办法在合并态下完全失效。

**唯一说出路径的地方是事件流**：`BRANCH_MERGE_CONFLICT_FILE`（tag **29**）。
实测 `revisionSync` **也**发这个 tag（一次 sync 共 13 个事件，tag 直方图
`{2:1, 5:1, 29:1, 44:1, 45:1, 176:1, 177:1, 178:5, 179:1}`，其中只有 `177`（sync file）和
`29` 带路径）。

> **既有缺陷，本条直接指出**：[`remote.ts`](../src/main/app/application/managers/vcs/remote.ts)
> 从 `result.files` 里筛 `conflictUnresolved || conflict` 来列冲突文件，而
> `REVISION_SYNC_FILE` 的解码器把这两个标志**写死成 `false`**
> （[`events.ts`](../src/main/app/application/managers/vcs/lore/events.ts)，因为那个结构体
> 根本没有这两个字段）。所以那个筛选**永远命中不了**，一次冲突同步只能落到 `["*"]` 占位符。
> 正解是订阅 tag 29，不是查 status。

### 4.25 `branchMergeResolve(paths)` 提交的就是工作树里的字节 —— 逐字节

三个 resolve verb 各自在**独立仓库**里单独调用（三个混在一起调用会让结果不可归因，这是第一轮
踩过的坑），结果分明：

| verb | 对工作树做什么 | 提交进修订的内容 |
|---|---|---|
| `branch_merge_resolve` | **什么都不改**，接受现有字节 | **与我们写进去的第三份内容逐字节相同** |
| `branch_merge_resolve_mine` | 用 mine **覆写**工作树 | mine |
| `branch_merge_resolve_theirs` | 用 theirs **覆写**工作树 | theirs |

**所以逐变更解决（计划的第二档）在机制上是通的**：先把合并结果写进工作树，再
`branchMergeResolve([绝对路径])`，提交出来的就是它。

两条附带实测：

- **不需要 `fileStageMerge`。** 直接 `revisionCommit` 就成功（本地路径与同步路径都是），
  计划 §1.4 里那个「暂存合并结果」的步骤是多余的。
- `_mine` / `_theirs` **不发** `BRANCH_MERGE_RESOLVE_FILE` 事件（`files: []`），只有
  `resolve` 发。想确认哪些路径被解决了，得看工作树，不能看事件。

### 4.26 合并修订确实有两个 parent，但 **parent[0] 是哪一边取决于合并从哪来**

`parents.length === 2` 在提交事件与 `readRevisionGraph` 两处一致，历史列表画合并点的前提成立。

**但顺序不一致**，而 `flattenFirstParent` 只走 parent[0]：

| 合并来源 | parent[0] |
|---|---|
| 本地 `branchMergeStart` | **本地分支的 tip**（`parent0IsLocalTip: true`） |
| 远端 `revisionSync` | **拉下来的那一边**（`parent0IsIncomingTip: true`） |

也就是说一次同步合并之后，「第一父线」是**对方的**线而不是作者自己的。历史列表照现在的写法
会在同步之后换一条主干。

### 4.27 `branchMergeAbort` 完整回滚工作树

整棵工作树按内容哈希做清单，合并前 / 合并后 / abort 后三次对比：abort 后与合并前
**逐文件相同**（`differsFromBeforeMerge: []`），三个附属文件也被删干净，status 回到合并前。

**所以「取消合并」这个按钮可以存在**（计划 §4.4 把它挂在这条实测上）。

### 4.28 仓库锁在**同一个进程内**同样是阻塞的

§4.12 说的是「第二个进程会一直等」。实测补充：**同一个进程里**对已经持有的仓库再
`openStore`，同样永远不返回——第一轮的实验挂死 240 秒就是这个，不是 Lore 慢。

所以任何持有 store 的代码路径必须在下一个打开之前走完 flush → closeStore → release。

### 4.29 ⚠️ **在线提交的内容，写它的那个进程读不回来**

判据只有一个：**提交时 globals 上的 `offline` 标志**。一个已经在服务器上登记过的仓库，
用 `offline: false` 提交出来的修订，**写它的那个进程取不到它的新内容**：

```
storageGet: 1/1 get items failed          ← 只针对这次提交新写的内容
```

三个对照，同一个仓库、同一个进程（`onlineCommitCheck.integration.test.ts`）：

| 情形 | 读回来 |
|---|---|
| **没登记服务器**时在线提交 | ✅ 7 字节——所以**光有 `offline:false` 不是判据** |
| 已登记，**离线**提交 | ✅ 26 字节 |
| 已登记，**在线**提交 | ❌ `storageGet: 1/1 get items failed` |
| 在那次在线修订上读**更早**的文件 | ✅ 6 字节 |

最后一行划出了真正的爆炸半径：**坏的不是那个修订，是那次提交新写的片段**。修订树完全正常
（`listFilesAt` 照给路径、大小、内容地址），同一棵树上更早的内容照读不误。
`repositoryStatus` / `revisionHistory` 也全程正常——死的**只有 `storageGet`**。

**换一个进程读同一个仓库立刻成功**，所以字节确实落了盘；像是在线会话在内存里把自己刚写的
片段记成了「远端的」。为什么这样**不知道**。

补救全部无效，别再试：`repositoryFlush`；`closeStore` + `openStore` 重开；等 15 秒 / 45 秒；
读侧换 `offline:true` / `offline:false`；`storageOpen` 带 `hasRemoteConfig:1` + 真实
`remoteUrl`；`blobAt` 的 resolve 路线与 `documentsAt` 的 walk 路线（同一个 `readAddress`，
两条都失败）；`resetLoreLibraryForRetry()` 的两种调用顺序——它只丢掉 JS 侧的 `LoreLibrary`
缓存，**从不 unload 那个 DLL**，第二次 `koffi.load` 拿到的是同一个 HMODULE。

> **这一条曾被写成「同步毒死整个进程」，那是夹具造成的假象**，保留在此是因为它值得记住：
> 当时每一次失败的读，读的都是 `commitAll(onlineGlobals, …)` 的产物，于是「同步之后连同步
> 之前的提交也读不出」看起来成立——而那条「之前的提交」本身就是在线提交。**归因错了就会
> 修错东西**：照那个版本，Studio 该在同步按钮旁边写「请重启」，而真相是同步一切正常。

**对 Studio 的后果（按真实姿势实测，不是推断）**：`VcsManager.globalsFor` 是
`offline: !options.online`，只有五个网络动词才 spread `offline:false`，**提交走的是离线
globals**。所以：

- 一次真同步之后，作者自己的提交**和从服务器收到的修订**都读得出来（收到的 `other.json`
  69 字节，本地此前从没有过这份内容）——同步只是**下载**片段，不新写内容；
- 两个互不相干的服务器仓库放在同一个进程里，published → 克隆 A → 同步 A → 同步 B 四个阶段
  逐个读，**A、B 全程都读得出**——没有跨工程波及；
- **已发布的 V5a 没有因此受损**，同步之后不需要让作者重启。

**唯一会踩到它的是本卡自己**：冲突解决之后那次 commit 如果走在线 globals，作者刚解决出来的
字节就会在当前进程里读不回来。所以 **D6 的写回管线必须用离线 globals 提交**——合并是在线
动作，提交不是，这两件事在同一条管线里必须用不同的 globals。这条没有测过，因为那条管线还
不存在；写它的时候按这条来，并在它的集成测试里钉住。

### 4.30 `readRevisionGraph` 只覆盖当前分支，于是 `threeWay` 对任何跨分支合并都答「没有 base」

这一条是 **Studio 侧的缺陷**，不是 Lore 的，但它是在测 Lore 的时候掉出来的。

`readRevisionGraph(globals)` 走的是 `history(globals, {limit})`，**不传 branch 就只给当前分支**。
实测一次 main/feature 的两侧合并：

```
currentBranchGraph:      ["#1 e40c23c2", "#2 3475cd9d"]     ← 只有 main
featureBranchGraph:      ["#1 e40c23c2", "#2 18730fe6"]
theirsTipInCurrentGraph: false
baseFromCurrentGraph:    null          ← mergeBase 找不到，因为对面的 tip 不在图里
baseFromUnionGraph:      e40c23c2…     ← 两个分支的图合起来就找到了，且就是真正的 base
```

于是 `threeWay` 返回 `base: undefined`。而 `threeWay` 的注释明写「base 缺失 = add/add，
**绝不能当空文件**」——照这个契约，**每一次普通的跨分支冲突都会被判成 add/add**，
逐变更合并会整个走错分支。

修法有两个，都成立：把两边分支的 `history` 并起来再算 LCA；或者干脆**用 §4.23 的
`~base` 附属文件**——合并态下它就在磁盘上，比重算 LCA 更直接也更便宜。

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

### 5.3.1 把一个**已有的本地工程**连到服务器（已实现，2026-07-31）

这是最常见的起点：作者先在本机启用了版本控制（离线建库），后来才有服务器。**它能连上，不需要重新
clone**，但**连接是两件事，只做第一件会静默地半成功**。

作者面的三步：

1. 打开工程 → 版本轨道 → **连接服务器**；
2. 填**一个字段**，形如 `lore://studio.example.lan:41337/my-game`。
   **末尾那一段是工程在服务器上的名字**，也就是队友 clone 时要用的那一串（见下面第 2 条）；
3. **上传到服务器**（push）。之后队友在启动器里用**从服务器获取工程**加同一个地址就能拿到。

底下实际发生的（`VcsManager.setRemote` → `remote.ts`）：

```
写 .lore/config.toml 的 remote_url          # 纯本地，只改这一行
  → 在一个临时空目录里 repositoryCreate(online, {repositoryUrl, id: 本工程的 repositoryId})
                                            # ← 登记，没有它就是下面第 1 条
  → 失败则把 remote_url 回滚               # 要么两件都成，要么一件都不留
```

**三条实测坑，每条都会让上面这段看起来可以省掉：**

1. **只写 `remote_url` 会得到一个「推得上去、clone 不下来」的工程。**
   push 返回成功、`repositoryStatus` 报 `remoteBranchExists: true`——而 `repositoryClone`
   **按名字、按仓库 id、按仓库自己的 `name` 全部答 `Not found`**。
   **只有 `repositoryCreate` 会在服务器上登记仓库，push 不会**，而 `repositoryCreate` 拒绝在已经是
   仓库的目录里跑——所以才要那个临时目录 + 显式 `id`。
   这条最危险的地方在于：**从设置它的那台机器上看，一切都是对的**。
2. **URL 必须带一个非空路径段，而那一段就是仓库在服务器上的名字。**
   `lore://host:41337` 和 `lore://host:41337/` 都报 `parsing repository URL: Invalid URL`。
   存进 config 时路径段会被**剥掉只留源**，所以配置文件里看到的和填进去的不是同一个字符串。
3. **建库必须离线。** `repositoryCreate` 在 `offline:false` 下会**连服务器建库**，同名不同 id 直接报错。
   所以 `initRepository` 永远走 `offline: true`，连服务器是之后一个独立的、作者显式发起的动作。

**断开**（`setRemote(null)`）是纯本地的：写回未配置占位符，服务器上的东西一概不动。

> **占位符的历史包袱**：旧占位符是 `lore://127.0.0.1:41337/local`，剥掉路径之后就是
> **loreserver 的默认地址**，而它写进了**每一个 Studio 建过的工程**。今天已换成
> `lore://unconfigured.invalid/none`（RFC 2606，永远解析不了），并且
> `isVcsRemoteConfigured` **把新旧两个占位符都当作「没配」**——老工程不迁移也不会被误判成已连接。

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
| [backend.ts](../src/main/app/application/managers/vcs/backend.ts) | **插拔边界**。动态加载、平台闸门、可用性判定与缓存、`refreshVcsAvailability`、`VcsUnavailableError` |
| [lore/abi/definitions.ts](../src/main/app/application/managers/vcs/lore/abi/definitions.ts) | 手写 ABI：结构体 / 别名 / verb 表 / 事件 tag。**纯数据**，不 import koffi |
| [lore/abi/upstream.json](../src/main/app/application/managers/vcs/lore/abi/upstream.json) | 从 SDK 生成物提取的 ABI 快照（420 结构体 / 131 函数 / 226 tag），进版本库 |
| [lore/library.ts](../src/main/app/application/managers/vcs/lore/library.ts) | 惰性 `koffi.load`、`LORE_LIB_PATH`、asar 解包、按需绑定 + `LoreCapabilityError` |
| [lore/values.ts](../src/main/app/application/managers/vcs/lore/values.ts) | 显式编解码，非法标识符**抛错不补零**；路径越界防护 |
| [lore/events.ts](../src/main/app/application/managers/vcs/lore/events.ts) | 32 个事件解码器，回调内即拷贝 |
| [lore/call.ts](../src/main/app/application/managers/vcs/lore/call.ts) | 单 trampoline、异步 off-thread、注册/注销配对、`PATH_IGNORE` 转异常、错误带 Rust `file:line` |
| [lore/verbs.ts](../src/main/app/application/managers/vcs/lore/verbs.ts) | 22 个有类型的操作：建库 / 状态 / 暂存 / 提交 / 历史 / diff / 读 blob / 分支 |
| [revisionReader.ts](../src/main/app/application/managers/vcs/revisionReader.ts) | `blobAt` / `blobsAt` / `readRevisionGraph` / `mergeBase` / `threeWay` / `changedPaths` |
| [VcsManager.ts](../src/main/app/application/managers/vcs/VcsManager.ts) | **按项目路径 keying** 的 session（store handle 复用 + 每项目串行化），flush → close → release |
| [vcsAction.ts](../src/main/app/application/managers/window/handlers/vcsAction.ts) | 10 个 IPC handler：9 读 + `initRepository` |
| [shared/vcs/workingSet.ts](../src/shared/vcs/workingSet.ts) | 工作集**策略**（谓词 + 忽略文件），两进程共用一份；走磁盘的遍历留在 main |
| [VersionControlService.ts](../src/renderer/lib/workspace/services/core/VersionControlService.ts) | 渲染进程服务：可用性缓存、状态快照与订阅、历史缓存 |
| [vcs.ts](../src/shared/types/vcs.ts) | 渲染进程类型 + 平台表 + `isVcsPlatformSupported()`，**不含任何 `Lore` 前缀** |

测试（`yarn vitest run src/main/app/application/managers/vcs/`，201 个）：

| 文件 | 覆盖 |
|---|---|
| [abi/definitions.test.ts](../src/main/app/application/managers/vcs/lore/abi/definitions.test.ts) | 161 断言，逐字段比对 `upstream.json` |
| [lore.integration.test.ts](../src/main/app/application/managers/vcs/lore/lore.integration.test.ts) | 17 个，打真 DLL：写路径、读路径、编码拒绝、回调生命周期（250 次连续调用不耗尽 koffi 回调池） |
| [revisionReader.integration.test.ts](../src/main/app/application/managers/vcs/revisionReader.integration.test.ts) | 8 个，打真 DLL：blob 字节精确、三路合并、add/add 的 base 缺失 |
| [revisionReader.test.ts](../src/main/app/application/managers/vcs/revisionReader.test.ts) | 6 个纯逻辑：LCA，含 criss-cross 的稳定裁决 |
| [backend.test.ts](../src/main/app/application/managers/vcs/backend.test.ts) | 6 个降级测试（含 Intel Mac / Windows ARM64 路径） |
| [pluggability.test.ts](../src/main/app/application/managers/vcs/pluggability.test.ts) | 3 个：静态导入图里没有 `lore/`，且这个断言非空 |

构建侧：`koffi` 在 [build-main.js](../project/build/build-main.js) 与 [dev-electron.js](../project/app/dev-electron.js) 里标了
external；`asarUnpack` 已有，没改。session 释放接在 [index.ts](../src/main/index.ts) 的 `window-closed` 上。

### 渲染进程接口

```ts
window[RendererInterfaceKey].vcs
```

| 方法 | 返回 |
|---|---|
| `getAvailability()` | `{available}` 或 `{available:false, reason, detail}` — **先问这个** |
| `isRepository(projectPath)` | `{isRepository}`；后端不可用时为 `false`，不抛 |
| `getInfo(projectPath)` | `{root, repositoryId, head?, headNumber, branch}` — **纯读**，走 `repositoryStatus(scan:false, revisionOnly:true)`，不触发 §4.17 |
| `initRepository(projectPath, options?)` | `{root, repositoryId, head?, headNumber, branch}` — **唯一的写**，见下 |
| `getStatus(projectPath)` | `VcsStatus`；**会扫描**，只能按需调，理由见 §4.17 |
| `restoreRevision(projectPath, revision, options?)` | `{from, checkpoint, revision, filesWritten, filesRemoved}` — **唯一会覆写作者文件的调用**，见下 |
| `getHistory(projectPath, limit?)` | `{entries: [{revision, number, parents}]}` |
| `readBlob(projectPath, revision, path)` | `{contentBase64}` |
| `getChangedPaths(projectPath, from, to)` | `{paths}` |
| `getThreeWay(projectPath, mine, theirs, path)` | `{baseRevision?, base?, mine, theirs}`（均 base64） |
| `getMergeBase(projectPath, a, b)` | `{base?}` |

**写侧现在有四个**：`initRepository`（V1）、`commit` / `checkpoint`（V2）、`restoreRevision`（V4）。前三个都只会
**新增一个修订**，够不到冲突，所以不需要 resolve UI 先存在。`restoreRevision` 也不需要，理由不同且值得写下来：
它**不合并**——把某个修订的内容写到工作树上，再把结果记成一个新修订，从头到尾只有一边。真正有两边的写
（merge）仍然故意缺席。

`restoreRevision` 的三条硬约束（细节见 [revisionRestore.ts](../src/main/app/application/managers/vcs/revisionRestore.ts)）：

- **动手前先打检查点**，打不出来就**整个中止**（"没东西可记录"不算打不出来：干净树的恢复前状态就是 HEAD）；
- **只增不退**：在 `#61` 上恢复 `#12` 得到 `#62`，`#13..#61` 一条都不消失；
- **只碰工作集**：写和删两边都以 `isVersioned` 为判据，`.nlstudio/` / `editor/cache` / `dist` / `.lore/` 在两个
  方向上都不在这个操作的范围里。删除是逐个文件 `rm(recursive:false)`，清空目录用 `rmdir`（非空即拒绝），
  **模块里没有、也不许有任何 `recursive:true`**。修订路径是不可信输入，越界（`..` / 绝对路径）**拒绝而不是跳过**。

**为什么 keying 是硬要求**：Studio 是 one-project-one-window，单例 runtime 会让第二个打开的项目和第一个抢同一个 store handle——而 Lore 的仓库锁是独占的（§4.12），后果不是数据竞争而是死等。DevMode 踩过这个坑。

### 升级绊线

升级 Lore 的流程是机械的，不需要审计：

1. 换平台包版本，重跑 `node tools/lore-abi-extract.mjs`
2. 读 `abi/upstream.json` 的 diff——**那就是 ABI 变更报告**
3. `definitions.test.ts` 会指出我们哪个结构体/别名/verb 签名/事件 tag 对不上，逐条改
4. 跑打真库的集成测试

原来那条「hash 编码自适应」的绊线随 `loreClient.ts` 一起删掉了：自有绑定按字段声明类型编码，
上游修不修 `loreHash` handler 都与我们无关。

## 10. 待解问题

- **界面尚未对接**。渲染进程的框架层已落（`VersionControlService`：可用性、状态快照、历史缓存、
  变更订阅），但还没有任何 VCS 界面消费它。总体规划见
  [plans/2026-07-27-001-plan-editor-data-and-version-control.md](plans/2026-07-27-001-plan-editor-data-and-version-control.md)
- **仓库来源已定，尚未实现**：项目目录 == 仓库根（`repositoryCreate` 就在项目根建 `.lore/`，
  没有第二种布局）。**不自动建库**——建库会在项目根写独占锁，必须是作者的显式决定。入口留在
  项目设置 + 新建项目向导，属 V1
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
