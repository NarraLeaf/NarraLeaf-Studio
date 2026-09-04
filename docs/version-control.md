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
| Intel Mac 怎么办 | 当时的答案是**可插拔可降级**；后来 Studio 直接**不再发 Intel Mac 宿主**，见 §7 |

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
| `.lore/` 天然排除；**点目录不天然排除** | `.nlstudio/services/panel_state.json` 不写进忽略文件就会被提交——已用差分实测：**不写忽略文件时它确实进了提交** |
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

❗ **合并开着的时候，那个暂存修订就是这次合并，写它会把合并换掉**——见 §4.34。

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

> **§4.23–§4.30 来自 2026-08-01 的合并实测。**
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
**既不需要读那份带标记的文件，也不需要从 DAG 重建**——原先「若 automerge 破坏 JSON
就改用 `threeWay` 重建」的备案，被一个更简单的答案取代了。

**并且这三个附属文件不会进提交**：解决之后提交，修订里只有 `doc.json`（实测
`sidecarsCommitted: []`）。Lore 自己排除它们，`.loreignore` 不需要为此加规则。

**这条对 Studio 还差半步，已补测**（`sidecarStaging.integration.test.ts`）：上面那次测量是
「解决完直接 commit」，而 Studio 的提交路径**先 `stage(globals, [root])` 整棵树**，那一刻三个
附属文件正躺在工作树里。补测结论是 **`stage` 连报都不报它们**（`stagedSidecars: []`），提交里
仍然只有 `doc.json`。所以写回管线不需要为它们做任何排除——但这是**实测**来的，不是从
上一段推的，两者的提交姿势不一样。

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

**所以逐变更解决（第二档）在机制上是通的**：先把合并结果写进工作树，再
`branchMergeResolve([绝对路径])`，提交出来的就是它。

两条附带实测：

- **不需要 `fileStageMerge`。** 直接 `revisionCommit` 就成功（本地路径与同步路径都是），
  「暂存合并结果」这一步是多余的。
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

**所以「取消合并」这个按钮可以存在**，它就挂在这条实测上。

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
  逐个读，**A、B 全程都读得出**——没有跨项目波及；
- **已发布的 V5a 没有因此受损**，同步之后不需要让作者重启。

**唯一会踩到它的是写回管线自己**：冲突解决之后那次 commit 如果走在线 globals，作者刚解决出来的
字节就会在当前进程里读不回来。所以 **写回管线必须用离线 globals 提交**——合并是在线
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

> **已修（2026-08-01）**：取的是第一种。`revisionReader.ts` 加了
> `readMergeGraph(globals, tips)`（当前分支 → 每个未覆盖的 tip 走 `history({revision})` →
> 仍有洞才并全部分支）与 `graphCoversAncestry(graph, tip)`，`threeWay` 改用前者。
> **实测：`history(globals, {revision: theirs})` 一步就够**，它给的 2 个节点里就有真 base，
> 分支兜底那步在普通两分支拓扑上不会跑到。
>
> **没用 `~base` 附属文件，理由是寻址方式不同**：`threeWay` 是按「两个修订」提问的，要对
> 任意一对修订作答（历史里两点比较、还没开始的合并、Lore 自动合掉因而根本没写附属文件的
> 路径）；附属文件只在合并进行中、且只为冲突路径存在，上面三种它一个都答不了，也分不出
> 「add/add」和「Lore 干净合掉了」。附属文件仍是写回管线的正解——那条路径确实在合并态里。
>
> 同时补上的是**「找不到 base」的两种含义要分开**：`ThreeWay.baseStatus` 现在是
> `found` / `absent-in-base` / `no-common-ancestor` / `indeterminate`。前两者之外，
> **`indeterminate`（图没读全）绝不能当 add/add** —— 把它们拼成同一个 `base: undefined`
> 正是本条缺陷发货时的样子。
>
> **还没修**：`VcsManager.getMergeBase` 仍旧走 `readRevisionGraph`，同一个洞原样还在
> （`VcsManager.ts` 不在这次改动的范围内）。

### 4.31 ⚠️ 同步之后，`_mine` / `_theirs` 两个 verb **跟附属文件和冲突标记是反的**

§4.25 是在**本地** `branchMergeStart` 上测的，那时 verb 与附属文件一致。**同步产生的合并上
不一致**，同一个仓库、同一个冲突文件（真 loreserver，`merge.integration.test.ts` 里已钉住）：

| 读什么 | 内容 |
|---|---|
| `doc.json` 的 `<<<<<<< ours` 段 | **作者自己的** |
| `doc.json~mine` | **作者自己的** |
| `doc.json~theirs` | 服务器那边的 |
| `branch_merge_resolve_mine` 写进工作树的 | **服务器那边的** ← 跟上面两行相反 |
| `branch_merge_resolve_theirs` 写进工作树的 | 作者自己的 |

机理：**两个 verb 跟的是分支指针，而同步已经把分支指针挪到服务器的 tip 上了**（这也是 §4.26
「同步之后 parent[0] 是拉下来的那一边」的同一件事）；附属文件与标记跟的是这次合并**记下来的
两侧**，不随指针动。

后果是这条必须写进文档的理由：**Studio 能产生的合并只有同步这一种**，所以照着 verb 名字做，
「保留我的」每次都会丢掉作者自己的工作、「保留对方的」每次都会丢掉同伴的——两边都是静默的，
而且本地测试全绿（本地两者一致）。

所以 [`merge.ts`](../src/main/app/application/managers/vcs/merge.ts) 的 `resolveConflicts`
**不调那两个 verb**：把 `~mine` / `~theirs` 拷到冲突文件上，再用**普通的**
`branch_merge_resolve`（§4.25 实测逐字节提交工作树内容）。两种来源下都正确，而且仍然是「整份
取一边」——全程不看文档内容，二进制与没有 spec 的文档同样成立。

> 另有一个**未测**的边界：`readMergeState().incoming` 读的是 `revisionMerged`，同步态下它给的
> 是**作者自己的 tip**（实测），与「收到的那一版」直觉相反。界面上那句「把从服务器拿到的版本
> （xxxxxx）合并进来」因此**可能名字取反**；只是个展示用的短哈希，没有按它做任何决定。

### 4.32 提交被拒时，**已经解决的路径不会回滚**，而且它们的附属文件已经没了

`completeMerge` 的语义是「每条路径取一边，然后提交收尾」。若作者漏了一条，提交按 §4.25 的
方式被拒（错误里带那条路径名）——**但前面几条已经落到工作树上了，并且提交里的 stage 那一步
已经把它们的附属文件删掉**。实测（`merge.integration.test.ts`「refuses when a conflicted path
was left undecided」）：

- `doc.json` 已是所选那一边的内容，尽管**什么都没记进历史**；
- `readMergeState().conflicts` 从 `[doc.json, other.json]` 缩成 `[other.json]`。

两条派生结论：

1. **渲染进程在失败路径上也必须重读文档。** 拒绝不是回滚，编辑器手上那份是合并前的字节，下一次
   自动保存就会把它写回去、盖掉作者刚选的那一边。
2. 这是唯一一处「已解决 vs 未解决」在仓库里读得出来的地方，但**只在一次被拒的提交之后**才成立，
   §4.24 那条（附属文件在普通 resolve 之后照样在）没有被推翻。

### 4.33 冲突文件让**整个项目打不开** —— 而这不是 Lore 的缺陷，是 §4.23 的直接后果

真机复现（无需服务端）：一个留着未完成合并的项目用 Studio 打开，工作区**根本起不来**：

```
Failed to initialize workspace
Failed to parse JSON from <project>/editor/story/index.json
```

链条是死的：§4.23 说 automerge 把 diff3 标记写进冲突文件 → 那份文件不再是合法 JSON →
`editor/story/index.json` 在工作区启动时就要解析 → `Service.initializeAll` 抛错 → 失败屏。
失败屏只提供「重试 / 打开启动器 / 打开别的项目」，**没有一条通向合并**。也就是说
**一旦真的有东西要解决，解决界面就够不着了**——而「关掉窗口第二天再回来」正是 §4.24
那套附属文件探测存在的理由。

裁决：**因为合并没做完而无法解析的文档，不是损坏文档**，把它挪进隔离区等于
给一份好文件贴坏标签。而「有没有合并在进行」在**解析任何文档之前**就问得出来——
`readMergeState` 只要状态头 + 一次附属文件遍历。

修法（渲染进程，三处）：

1. `workspaceProjectPreflight` 在 `Service.initializeAll` **之前**问一次 `getMergeState`；
2. 有冲突路径时装上 `mergeConflictReads`：那几条路径的读改读 `<path>~mine`（作者自己那一边，
   §4.23 保证逐字节等于他上次提交的内容），于是每份文档都能解析；
3. 同时 `freezeProjectWrites({kind:"merge"})`。**冻结必须和替换同时装、且在第一次读之前**：
   编辑器手上拿的不是磁盘上的东西，一次迁移或一次自动保存就会把合并前的内容盖到 automerge
   的结果上。

三条边界：**没有冲突路径的合并不装**（automerge 全合上了，磁盘上就是要提交的东西）；
**版本控制答不上来就照常打开**（可选能力，不能让它挡住开项目）；**合并结束/放弃时必须先
`clearMergeConflictReads()` 再重读**——提交会删掉附属文件，还挂着替换去重读会把每份冲突
文档读成「不存在」，作者刚解决出来的东西会被默认值顶掉。

> `kind: "merge"` 是第三种冻结原因。`WorkspaceFreezeKind` 的注释早就写着「加第三种会在上报处
> 编译失败，那正是该被问『这种情况怎么说』的地方」——确实如此：构建/预览在合并态下同样要拒绝，
> 但话术不是「解除冻结」而是「先把合并做完」。

### 4.34 ❗ 给暂存修订写元数据，会把那次**合并换掉**（已修）

真机上看到的是：作者把每个冲突选完、按「完成合并」（合并状态确实关了、工作树干净），
再上传**仍然** `branchPush: Branch has diverged`；再按一次「从服务器获取」（静默、无冲突、
多一个修订）之后才能发出去。

**合并修订的两个 parent 是同一个修订**——作者自己的 tip，写了两遍：

```
1 942e699fbb <-
2 5eca573ac6 <- 942e699fbb
3 274134c073 <- 5eca573ac6,5eca573ac6      ← 合并；远端 tip cfa2e56266 不在里面
```

所以 §4.26「合并修订确实有两个 parent」**数对了、人错了**：`parents.length === 2` 一直成立，
而两条线从来没接上。

#### 定到哪一行

对着真服务器做的对照（每种写法一个独立仓库，都是同步产生的冲突）：

| 怎么收尾 | parent 含远端 tip | 推得上去 |
|---|---|---|
| `stage` + `commit`（离线 / 在线 / 保活存储 / 先读 history / 先读 status / 同一个 store 里解冲突） | ✅ | ✅ |
| `commit`（不 stage） | ✅ | ✅ |
| **`stage` + `revisionMetadataSet` + `commit`** | ❌ | ❌ |
| `stage` + `commit` + `revisionMetadataSet` | ✅ | ✅（但标签落到下一个修订，见 §4.21） |
| `commitWorkingTree` / `VcsManager.completeMerge` | ❌ | ❌ |

即 **§4.21 那一行就是原因**：`revisionMetadataSet` 写的是暂存修订，而合并开着的时候
**那个暂存修订就是这次合并**，写它等于把它换成一个普通的暂存修订，
随后的 commit 于是把本地 tip 当成两个 parent 都写上。

#### 修法：合并那次提交**不打标签**

`commitWorkingTree` 现在在 stage 之后问一次状态（`scan:false, revisionOnly:true`，本来就要问），
`revisionMerged && revisionStaged` 为真就跳过 `setRevisionMetadata`，并且 `VcsCommitResult.kind`
返回 `undefined`——**记下的是什么就答什么**。

提前排除的替代方案：改成提交之后再打标签——实测它会落到**下一个**修订（正是 §4.21），
合并照样没标签，而下一次普通提交会被标两次。

屏幕上不损失什么：版本轨画历史时 `row.merge`（两个 parent）**比** `kind` **先被问到**，
合并行拿的是合并图标；而被折叠掉的只有 `checkpoint`，没标签不会被折叠。

守卫在 `merge.integration.test.ts`：本地那条管 parent 是不是那两个分支 tip（不需服务器），
远端那条管「同步产生的合并做完之后一次就推得上去」。**两条缺一不可**：
parent 数量一直是 2，而本地合并怎么写都对。

### 4.35 跑远端集成测试要先登录，而 `identity` 得是**账号 id**

以前远端那半只能对着一台**不验身份**的 loreserver 跑；对着真服务器第一句就是
`repositoryCreate: connecting to remote: No token stored`。两个坑，都是同一回事的两面：

1. **裸 globals**：上网的调用 `identity` 必须是登录拿到的**账号 id**，不是人名。
   Lore 的会话存在按系统用户的 auth store 里，**就是按这个键查的**（`serverSession.ts` 写了）；
2. **`VcsManager`**：它不接受 identity 参数，而是从设置里读
   `versionControl.serverSessions`（`resolveOnlineIdentity`）。测试里那个空的 `fakeApp`
   于是以作者名上网——**不报错**，`sync` 只是找不到分支、答一个干净的空结果，
   于是一条关于冲突的 spec 失败在「没有冲突」上。

现在**每一个有远端块的文件都接好了**，共用 `loreTestAccount.ts`：三个环境变量在那里读一次，
`signInLoreTestAccount()` 在每个远端 `describe` 的 `beforeAll` 里登录一次（进程内只登录一次），
`loreTestIdentity(AUTHOR)` 给上网的 globals 填账号 id、给没有令牌的运行填回作者名。
所以一台裸 loreserver 照旧能跑，一台验身份的服务器也能一条命令跑完整个目录：

```bash
LORE_TEST_REMOTE="lore://127.0.0.1:41437" LORE_TEST_AUTH="https://127.0.0.1:41502" \
  LORE_TEST_TOKEN="$(nlteam token mint <user> --root <台子> …)" \
  npx vitest run src/main/app/application/managers/vcs/
```

`serverSession.integration.test.ts` 以前只认 `LORE_TEST_AUTH_URL`，于是这条命令会静默跳过它；
现在两个名字都收。

⚠ **那台服务器的证书颁发机构必须是这台机器已经信任的。** `signInToServer` 没有 pinning 钩子——
客户端库拿宿主自己的信任库建链，Windows 上连 `SSL_CERT_FILE` 都不看（`authorityTrust.ts` 开头
写了原因）。所以 `nlteam init` 新起一台服务器跑测试会卡在 `transport error`，而那句话被归类成
`certificate`：不是缺陷，是这台机器不认识那个新 CA。可行的做法是**整份复制一台已经被信任的台子**
（`tls/` 一起复制——证书按主机名签、跟端口无关），端口整组错开再起。

❗ **每条远端 spec 都会在服务器上留一个项目登记**，而它们不会自己消失（拿掉登记是一次 Team 调用，
测试进程没有 Team 会话）。所以跑之前先复制一份台子、跑完把复制的那份整个删掉，比事后去共用台子上
一条条摘干净省事得多。真要摘：`DELETE FROM projects WHERE ...`，就是 `projects.forget` 做的事。

### 4.36 ❗ 克隆不会把历史本身带下来，于是克隆出来的项目**没有历史**（已修）

实测：一个已经有四个修订的项目，克隆下来之后每一次**本地**历史读都是
`revisionHistory: Not found`；而 Studio 的读全是离线的，所以版本轨对刚加入项目的人说
**「还没有版本」**——而那份项目明明有历史。比较、合并基、「改了什么」都跟着没东西可走。

一个只有**一个**修订的项目看不到这个（tip 后面没东西可缺），这是它一直没被发现的原因之一；
另一个是**失败与「真的没有版本」在屏幕上长得一模一样**。

测量（同一份克隆，依次）：

| 读法 | 结果 |
|---|---|
| `history()` 离线 | ❌ `Not found` |
| `history()` **在线** | ✅ 4 个修订 |
| `history()` 离线（紧接着再读一次） | ✅ 4 个修订 |
| `history({limit: 1})` 离线 | ✅ 1 个修订 |

即 **一次在线读就把缺的那些取回来了，而且 `cache: true` 会留住**（一次性修复）；
带 `limit` 的读不会走到缺的那一段，所以不报错。

真机上也验了一份早先存疑的仓库（`Address not found: fe2109bb…`）：一次在线读之后
`ok 7 revisions`，随后的离线读也好了。所以那个洞**就是克隆留下的**，不是同步造的。

**修法：克隆自己把历史取下来**。`VcsManager.cloneRepository` 写完地址之后多一步
`readRevisionGraph`（在线）。三条理由：那一刻网络本来就开着；克隆本来就是
「六个允许上网的地方」之一，所以**不用开第七个**；取下来就留住，后面所有读照旧离线。
失败只记日志：克隆已经落盘，把它变成「克隆失败」会给作者留一个非空目录、向导再也不肯往里克隆。

守卫：`clonedHistory.integration.test.ts`（需服务器）——断言是在**上不了网的 globals** 上做的，
否则一次在线读怎么都会绿。夹具必须推四个修订，一个修订的项目证不了任何事。

⚠ `signInRecovery.test.ts` 盯的是克隆的**调用顺序**，所以它多了 `history` + `release` 两步。

### 4.37 ❗ 服务器**拒绝**令牌，Studio 却说不出那是拒绝（已修）

上一条把整个目录接到验身份的服务器上之后，第一次看见这个。拿一个签名无效的令牌登录，
服务器答的原话是：

```
authLoginWithToken: exchanging external token:
  code: 'The request does not have valid authentication credentials',
  message: "the token presented for exchange was not accepted"
```

一望而知是「拒绝」，而 `describeSignInFailure` 把它归成了 **`unknown`**——那条正则找的是
`unauthenticated` / `permission denied` / `invalid` / `expired` / `refused` 五个词，
这句话**一个都不含**（`not have valid` 不是 `invalid`，`authentication` 不是 `unauthenticated`）。

后果落在文案上：设置面里那句话从
「**The server refused this token. It may have expired or been revoked.**」
退成「**The server could not be added.**」——恰好把「令牌过期了、去换一个」这个唯一的下一步吞掉。

**为什么一直没人看见**：这条路只有在**这台机器已经信任那个颁发机构之后**才走得到。
在那之前每次登录都断在传输层，被上面的 `certificate` 分支接走了。而「已经信任」恰恰是
真实作者的常态——第一次点过「信任」以后就一直是。

**修法**：把那个判断抽成 `isSignInRefusal(message)`（`serverSession.ts`，已导出），
词表补上 `not accepted` 与 `valid authentication credentials`——后者是 gRPC 的
`UNAUTHENTICATED` 规范句、不是 loreserver 自己的措辞，所以值得按原句收。
单测在 `serverSession.test.ts`，用的就是上面这句实测原文。

`serverSession.integration.test.ts` 那条 `certificate` 断言也跟着改了：它现在收
**`certificate` 或 `refused` 两者之一，并且拒收第三种答案**。测试问不出这台机器信不信那个 CA
——`diagnoseEndpoint` 读的是 Node 自带的机构表，而后端客户端读的是操作系统那份，
所以一个「本账号已信任的私有 CA」在探针眼里是不受信的、在登录时却好用。

### 4.38 刚克隆的项目一打开就有一项「谁也没改过」的变更 —— 是收敛，不是缺陷

真机实测过的现象：克隆下来、打开，版本轨立刻显示 `editor/ui/uidoc.json` 已修改，作者什么都没做。
查下来**不是版本控制的问题，是界面文档的加载期收敛**，而且它按设计只发生一次。

`UIDocumentService.load()` 有四个「改了就存回去」的理由（`needsSave`）：

| 理由 | 什么时候为真 |
|---|---|
| `schemaChanged` | 盘上的 `schemaVersion` 比本构建低 |
| `normalizedChanged` | 归一化器改了任何东西（`nl.image` 旧属性折叠、输入模型） |
| `mainSurfaceChanged` | 主表面或它的根元素不在 |
| `flowLayoutsChanged` | 流式布局的子元素坐标不在归位 |

**一次实测的两条**（同一台机器、同一份构建，各复制一份项目再打开）：

- **v11 的项目** → `uidoc.json` 改成 v12，外加新建 `editor/save-schema.json`：两项变更。
  v12 是 2026-08-27 19:50 `7c56f44a7` 抬的，而那天晚上看到这个现象的克隆正好是 v11。
- **v12 的项目**（版本已经跟本构建一致）→ **照样改**。diff 是
  `nl.image` 的三个 `props.assetId` 折进 `imageFill`（2026-08-28 `d1d494d8e`，见
  `legacy-image-props-fold`）加一个 `meta.updatedAt`。

**第二次打开同一份项目，文件逐字节不变**——收敛成立。所以这是「旧形状被就地改写一次」，
不是每次打开都脏。

**新建的项目碰不到**：出厂骨架模板已经是收敛后的形状（v12、5 个 `nl.image` 全无旧属性）。
守卫在 `src/renderer/apps/project-wizard/starterTemplateSettled.test.ts`：七条断言逐条对应
上表那四个理由，每条都做过 non-vacuous 验证（把模板改坏，对应那条必红）。

**混版本不在射程内，这是裁决而不是疏漏**（2026-08-28，用户）。Studio 还没发布，眼下正是在为发布
**砍掉**更早的兼容形状，所以「一队人跑着两个 Studio 版本」这个人群目前不存在：地板以下的文档直接
拒绝，收敛把还在的旧形状一次改写掉，都是有意的。上面那段现象因此只会落在**本机的老项目**上，
打开一次就过去了。

发布之后混版本才成立，届时要面对的是这三件事，先记在这里免得重新推导一遍：老项目升级格式时，
① 版本轨只说「1 项变更 · 界面页面」，没有一句话说那是格式升级；② 升级一旦提交，仍在旧 Studio 上
的人**硬拒**读不了（`schemaVersion > UI_DOCUMENT_SCHEMA_VERSION`，"UI document schema is newer
than this Studio version"）；③ 不提交则人人背着同一项幽灵改动，每次合并都撞。**发布前不要动它。**

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

### 5.3.1 把一个**已有的本地项目**连到服务器（已实现，2026-07-31）

这是最常见的起点：作者先在本机启用了版本控制（离线建库），后来才有服务器。**它能连上，不需要重新
clone**，但**连接是两件事，只做第一件会静默地半成功**。

作者面的三步：

1. 打开项目 → 版本轨道 → **连接服务器**；
2. 填**一个字段**，形如 `lore://studio.example.lan:41337/my-game`。
   **末尾那一段是项目在服务器上的名字**，也就是队友 clone 时要用的那一串（见下面第 2 条）；
3. **上传到服务器**（push）。之后队友在启动器里用**从服务器获取项目**加同一个地址就能拿到。

底下实际发生的（`VcsManager.setRemote` → `remote.ts`）：

```
写 .lore/config.toml 的 remote_url          # 纯本地，只改这一行
  → 在一个临时空目录里 repositoryCreate(online, {repositoryUrl, id: 本项目的 repositoryId})
                                            # ← 登记，没有它就是下面第 1 条
  → 失败则把 remote_url 回滚               # 要么两件都成，要么一件都不留
```

**三条实测坑，每条都会让上面这段看起来可以省掉：**

1. **只写 `remote_url` 会得到一个「推得上去、clone 不下来」的项目。**
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
> **loreserver 的默认地址**，而它写进了**每一个 Studio 建过的项目**。今天已换成
> `lore://unconfigured.invalid/none`（RFC 2606，永远解析不了），并且
> `isVcsRemoteConfigured` **把新旧两个占位符都当作「没配」**——老项目不迁移也不会被误判成已连接。

### 5.4 命名

**不要在 Studio 侧的任何名字里出现 `lore`。** Lore 是 0.x，协议会破坏性变更，甚至可能需要换底层。名字应该描述能力，不是供应商。

| 东西 | 名字 |
|---|---|
| Studio 内部模块 | `src/main/app/application/managers/vcs/`，`VcsManager` |
| 抽象层若抽成包 | `@narraleaf/vcs` |
| 服务端 | 产品名 **NarraLeaf Team**，仓库 `NarraLeaf-Team`，包 `@narraleaf/team`，命令 `nlteam` |

## 6. 离线 diff 策略

稀疏 + 懒加载意味着历史版本的 fragment **大概率不在本地**。加上 §4.8 的默认不缓存，天真实现会让每次 diff 都走网络。

必须做的四件事：

1. **所有读操作显式传 `cache: true` / `localCache: true`**——这一条解决大半问题
2. **预热**：打开 diff 视图时先用 `revisionDiff` 拿变更文件清单，再批量 `storageGet` 把两个版本的 blob 拉进本地 store，然后纯本地做 diff
3. **复用 store handle**：globals 里设 `storeKeepAlive`，避免连续调用反复开关 store（默认保活 10 秒）
4. **UI 承认现实**：设计成「首次 diff 可能联网」，给 loading 态。不要假装纯离线

单机场景（P0）完全不涉及这些——所有 fragment 本来就在本地。

## 7. 可插拔与降级 —— 缺后端只砍一个功能，不砍整个 app

v0.8.5 官方产物只有四个：

| 平台 | 状态 |
|---|---|
| `win32-x64` | ✅ |
| `darwin-arm64`（Apple Silicon） | ✅ |
| `linux-x64` | ✅ |
| `linux-arm64` | ⚠️ 仅 Graviton/Neoverse-512tvb（SVE），普通 ARM 跑不了 |
| **`darwin-x64`（Intel Mac）** | ❌ **没有** |
| **`win32-arm64`** | ❌ **没有** |

**当时的决定：不砍平台，砍能力。** 没有原生构建的机器上，版本控制这一个功能报告自己不可用，其余功能完全不受影响。

> **⚠ 后续推翻（Intel Mac 部分）：Studio 不再把 Intel Mac 当宿主平台，只发 Apple Silicon 版。**
>
> 降级机制本身没变，也仍然必须留着——`win32-arm64` 还在用它。变的是 `darwin-x64`：那台机器上缺的
> 不止版本控制，还有 iOS 签名（zsign 不发 macOS x64 资产）和媒体转换（我们的 LGPL ffmpeg 只编
> arm64），三个子系统里两个不归我们管。作者会在把内容投进工具**之后**一个一个撞上去，而
> 「这个平台不支持」是一次性的诚实坏消息。Rosetta 也是单向的：x64 能跑在 Apple Silicon 上，arm64
> 不能跑在 Intel 上，所以 arm64 安装包不是替代品。决定与理由写在
> [.github/workflows/release.yml](../.github/workflows/release.yml) 顶部。
>
> **这说的是 Studio 跑在哪，不是游戏跑在哪。** 作者在 Apple Silicon 上做的游戏仍然可以打给
> Intel Mac，见 `GAME_BUILD_ARCHS_BY_PLATFORM`（`src/shared/types/gameBuild.ts`）。
>
> 所以下表里 `darwin-x64` 那行现在是「不会被命中」而不是「会降级」；本节其余内容照旧适用于
> `win32-arm64` 与自建库（`LORE_LIB_PATH`）。

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
| [lore/events.ts](../src/main/app/application/managers/vcs/lore/events.ts) | 49 个事件解码器，回调内即拷贝 |
| [lore/call.ts](../src/main/app/application/managers/vcs/lore/call.ts) | 单 trampoline、异步 off-thread、注册/注销配对、`PATH_IGNORE` 转异常、错误带 Rust `file:line` |
| [lore/verbs.ts](../src/main/app/application/managers/vcs/lore/verbs.ts) | 39 个有类型的操作：建库 / 状态 / 暂存 / 提交 / 历史 / 元数据 / 树 / 分支 / 合并 / 推送同步 / 克隆 / 登录 |

上面这层之上是按题目分开的模块，`VcsManager` 只做 session 与串行化，具体动作都在这里：

| 文件 | 职责 |
|---|---|
| [repository.ts](../src/main/app/application/managers/vcs/repository.ts) | 建库与读状态；Lore 的数字 file action 在这里映成字符串联合，是两侧词汇的分界 |
| [revisionReader.ts](../src/main/app/application/managers/vcs/revisionReader.ts) | `blobAt` / `blobsAt` / `readRevisionGraph` / `mergeBase` / `threeWay` / `changedPaths` |
| [workingFile.ts](../src/main/app/application/managers/vcs/workingFile.ts) | 比较的**工作树那一侧**：一个仓库相对路径的当前字节，越界与超限分别是拒绝和失败 |
| [workingSet.ts](../src/main/app/application/managers/vcs/workingSet.ts) | 工作集在磁盘上的遍历（策略在 `@shared/vcs/workingSet`） |
| [revisionRestore.ts](../src/main/app/application/managers/vcs/revisionRestore.ts) | 恢复：先打检查点、只增不退、只碰工作集，模块内不允许 `recursive:true` |
| [revisionSnapshot.ts](../src/main/app/application/managers/vcs/revisionSnapshot.ts) | 把一个修订写成一个普通工程目录（Dev Mode 跑历史修订靠它，见 §9.2 之外的路径驱动约束） |
| [merge.ts](../src/main/app/application/managers/vcs/merge.ts) | 合并状态与逐路径取舍；`~base` / `~mine` / `~theirs` 的读法 |
| [mergeDocument.ts](../src/main/app/application/managers/vcs/mergeDocument.ts) | 冲突的第二档：逐处改动地和解一份文档 |
| [diff/](../src/main/app/application/managers/vcs/diff) | 比较的呈现层：内容 / 文档 / 文档集 / 修订 / 工作树 / 工程配置各一份 presenter，见 §9.1 |
| [remote.ts](../src/main/app/application/managers/vcs/remote.ts) | 唯一需要 `offline: false` 的模块：推送、同步、克隆 |
| [serverApi.ts](../src/main/app/application/managers/vcs/serverApi.ts) · [serverDiscovery.ts](../src/main/app/application/managers/vcs/serverDiscovery.ts) | 一次 HTTPS 请求，与「问一个地址背后是什么」 |
| [serverSession.ts](../src/main/app/application/managers/vcs/serverSession.ts) · [serverTokens.ts](../src/main/app/application/managers/vcs/serverTokens.ts) · [serverPassword.ts](../src/main/app/application/managers/vcs/serverPassword.ts) | 登录与令牌保管。**会话按服务器 origin 存在账户级**，不属于任何一个工程 |
| [serverProjects.ts](../src/main/app/application/managers/vcs/serverProjects.ts) · [serverProjectsSession.ts](../src/main/app/application/managers/vcs/serverProjectsSession.ts) | 服务器上的工程清单，REST 与长连接两条同形的读法 |
| [localRepositories.ts](../src/main/app/application/managers/vcs/localRepositories.ts) | 不开库就判断本机已经有哪些仓库（Lore 的库锁是独占且阻塞的，所以这条不能开库） |
| [authorityTrust.ts](../src/main/app/application/managers/vcs/authorityTrust.ts) | 把签名端的 CA 装进本机信任库——全 Studio 唯一改操作系统设置的地方 |

接线与两侧类型：

| 文件 | 职责 |
|---|---|
| [VcsManager.ts](../src/main/app/application/managers/vcs/VcsManager.ts) | **按项目路径 keying** 的 session（store handle 复用 + 每项目串行化），flush → close → release |
| [vcsAction.ts](../src/main/app/application/managers/window/handlers/vcsAction.ts) | 42 个 IPC handler：**21 读**（什么都不改，含只走网络不记录的 `probeServer` / `getSyncState`）· **12 个动工程目录的**（建库 / 提交 / 检查点 / 恢复 / 设置远端 / 五个合并动作 / 同步 / 克隆）· **9 个服务器与账户动作**（登录三种 / 登出 / 加服务器 / 刷新 / 忘记 / 推送 / 发布）。谁可以指名哪个工程见下 |
| [shared/vcs/workingSet.ts](../src/shared/vcs/workingSet.ts) | 工作集**策略**（谓词 + 忽略文件），两进程共用一份；走磁盘的遍历留在 main |
| [VersionControlService.ts](../src/renderer/lib/workspace/services/core/VersionControlService.ts) | 渲染进程服务：可用性缓存、状态快照与订阅、历史缓存 |
| [vcs.ts](../src/shared/types/vcs.ts) | 渲染进程类型 + 平台表 + `isVcsPlatformSupported()`，**不含任何 `Lore` 前缀** |

测试（`yarn vitest run src/main/app/application/managers/vcs/`，52 个文件 **724 个用例**，其中 28 个 skip；打真 DLL 的
那批叫 `*.integration.test.ts`）。挑出值得点名的：

| 文件 | 覆盖 |
|---|---|
| [abi/definitions.test.ts](../src/main/app/application/managers/vcs/lore/abi/definitions.test.ts) | 244 个，逐字段比对 `upstream.json` |
| [lore.integration.test.ts](../src/main/app/application/managers/vcs/lore/lore.integration.test.ts) | 17 个，打真 DLL：写路径、读路径、编码拒绝、回调生命周期（250 次连续调用不耗尽 koffi 回调池） |
| [repository.integration.test.ts](../src/main/app/application/managers/vcs/repository.integration.test.ts) | 22 个：建库、状态、暂存与 §4.17 那个扫描副作用 |
| [revisionReader.integration.test.ts](../src/main/app/application/managers/vcs/revisionReader.integration.test.ts) | 19 个，打真 DLL：blob 字节精确、三路合并、add/add 的 base 缺失 |
| [revisionReader.test.ts](../src/main/app/application/managers/vcs/revisionReader.test.ts) | 10 个纯逻辑：LCA，含 criss-cross 的稳定裁决 |
| [merge.integration.test.ts](../src/main/app/application/managers/vcs/merge.integration.test.ts) | 19 个：合并状态、逐路径取舍、关闭合并；`mergeSpike*.integration` 是它的四组前置实测 |
| [diff/](../src/main/app/application/managers/vcs/diff) 七个 `.test.ts` | 111 个：内容 / 文档 / 文档集 / 修订 / 工作树 / 工程配置各一份 presenter，加一份登记表 |
| [serverSession.test.ts](../src/main/app/application/managers/vcs/serverSession.test.ts) · [serverDiscovery.test.ts](../src/main/app/application/managers/vcs/serverDiscovery.test.ts) · [publish.test.ts](../src/main/app/application/managers/vcs/publish.test.ts) | 22 / 21 / 13 个：登录、探测地址、发布的三步 |
| [backend.test.ts](../src/main/app/application/managers/vcs/backend.test.ts) | 6 个降级测试（含 Intel Mac / Windows ARM64 路径） |
| [pluggability.test.ts](../src/main/app/application/managers/vcs/pluggability.test.ts) | 3 个：静态导入图里没有 `lore/`，且这个断言非空 |

IPC 那一层的测试不在这个目录下：
[vcsAction.test.ts](../src/main/app/application/managers/window/handlers/vcsAction.test.ts)（35 个）管的是**一次请求可以指名哪个工程**。

构建侧：`koffi` 在 [build-main.js](../project/build/build-main.js) 与 [dev-electron.js](../project/app/dev-electron.js) 里标了
external；`asarUnpack` 已有，没改。session 释放接在 [index.ts](../src/main/index.ts) 的 `window-closed` 上。

### 渲染进程接口

```ts
window[RendererInterfaceKey].vcs
```

42 个方法，与 `vcsAction.ts` 的 handler 一一对应。逐条的语义写在
[renderer.ts](../src/shared/types/renderer.ts) 的声明上，这里只列需要先知道的那几条与全部分组：

| 方法 | 返回 |
|---|---|
| `getAvailability()` | `{available}` 或 `{available:false, reason, detail}` — **先问这个** |
| `isRepository(projectPath)` | `{isRepository}`；后端不可用时为 `false`，不抛 |
| `getInfo(projectPath)` | `{root, repositoryId, head?, headNumber, branch}` — **纯读**，走 `repositoryStatus(scan:false, revisionOnly:true)`，不触发 §4.17 |
| `getStatus(projectPath)` | `VcsStatus`；**会扫描**，只能按需调，理由见 §4.17 |
| `getSyncState(projectPath)` | **这一面上唯一走网络的读**，服务器不在时约 2s，禁止开工程时调或按定时器调 |
| `restoreRevision(projectPath, revision, options?)` | `{from, checkpoint, revision, filesWritten, filesRemoved}` — 见下 |
| `sync(projectPath)` | `VcsSyncResult`；**会覆写作者文件**，冲突是**成功**答案而不是失败 |

其余按题目分组：读历史与内容（`getHistory` / `readBlob` / `readWorkingFile` / `readRevisionDocuments` /
`getChangedPaths`）· 比较（`diffRevisions` / `diffWorkingTree` / `getThreeWay` / `getMergeBase`）·
合并（`getMergeState` / `getMergeDocument` / `resolveConflicts` / `completeMerge` / `unresolveConflicts` /
`restartConflicts` / `abortMerge`）· 记录（`initRepository` / `commit` / `checkpoint`）·
服务器绑定（`getRemote` / `setRemote`）· 账户与服务器（`getServerSession` / `signIn` / `signInWithPassword` /
`signOut` / `trustAuthority` / `probeServer` / `listServers` / `addServer` / `refreshServer` / `forgetServer`）·
传输（`push` / `sync` / `clone` / `publishProject` / `listLocalRepositories`）。

**会动工程目录的有十二个**，分三类看：只**新增一个修订**的 `initRepository`（V1）、`commit` / `checkpoint`（V2）——
够不到冲突，所以不需要 resolve UI 先存在；**用历史覆写工作树**的 `restoreRevision`（V4）、四个落字节的合并动作
（`resolveConflicts` / `completeMerge` / `restartConflicts` / `abortMerge`）与 `sync`，外加只改仓库里合并状态的
`unresolveConflicts`；以及只改配置或写新目录的 `setRemote` 与 `clone`。`publishProject` 不在这十二个里算，但它的
第三步**也会改写 `.lore/config.toml`**。`restoreRevision` 不需要 resolve UI 的理由和前三个不同且值得写下来：
它**不合并**——把某个修订的内容写到工作树上，再把结果记成一个新修订，从头到尾只有一边。

### 一次请求可以指名哪个工程

`projectPath` 是渲染层填的字段，而 IPC 注册表是全进程一份、按 sender 找窗口的，所以**任何窗口都能发这 42 条里的
任何一条**。会用历史覆盖工作树的六个——`restoreRevision` 与四个合并写，加 `sync`——因此用
`requireWindowProject(window, projectPath)` 把工程取自**窗口自己的 props** 而不是 payload：这几条替换掉的字节从未
被提交过，没有任何东西留着它们，指错工程不是「动了错的工程」而是**在那个工程里毁掉了工作**。`push` 与 `signIn`
同样断言，理由弱一些：调用点只有工作区自己的版本轨。比较用 `normalizeProjectPath`（`D:\Game` 与 `d:\game` 是一个
工程两个 session key），拒绝时把窗口自己的拼法交给下游，并且**不在日志里写出被指名的那个路径**——它不是这个作者的
工程。拒绝会经 `ipcRegistry` 落到该窗口工程的日志面板上（`windowProjectRefusal.ts`）。

⚠ **断言路径没有关上「把工程送上服务器」这一族**，别把它读成关上了：

- `publishProject` 的 `remoteOrigin` 是 payload 字段，从不与该工程 `.lore/config.toml` 里的 remote 比对，而发布的
  第三步**会改写那个文件**——之后 push / sync 从文件读地址，于是静默跟着换了目标；
- **会话与令牌按服务器 origin 存在账户级**，不属于工程，任何指向同一个 origin 的工程都借得到，
  `withServerSession` 还会自己重放令牌；
- `signIn` 的 `authUrl` 是 payload 字段，且**优先于令牌自带的地址**，令牌就送到它指的主机；
- 这一族没有信任闸（`DISTRUSTED_OPERATIONS` 里没有 VCS 条目），也不查窗口的文件系统授权。

`publishProject` 还**故意没有**路径断言：启动器的服务器页会让向导先把工程写到本机再送上去，而那个窗口自己没有工程，
断言会把「在服务器上新建一个工程」这条路整条堵死。要关的是「可以送到哪里、可以花账户的哪份凭据」，
不是「哪个工程」——这需要先决定服务器会话到底以什么为作用域，比任何单个 handler 都大。
`initRepository` 同理不能断言：向导合法地指一个还不是任何窗口工程的新目录。

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

## 9.1 比较界面：索引 + 详情 + presenter

比较是一个编辑器标签页（`modules/vcs-changes`），不是面板也不是对话框：一次比较是一份文档，
而工作区已经用标签页装文档，作者也因此能把它和正要改的编辑器并排放。

左边是**索引**，右边是**详情**，这个分工是这块界面唯一的结构性约定：

- **索引每份文档恒占一行**，与它内部有多少条改动、走的哪一档、被截断与否都无关。行尾放改动数。
  多数文档就是一个文件；一份 document set（见 §9.2）由 manifest 加成员组成，同样只占一行。
- **详情区一次只挂一个 presenter**（`ChangeDetailHost`，`data-change-presenter` 是它的抓手）。
- 文件按**分类**分组（故事／人物／界面／素材／本地化／音频／项目／其他，见
  `renderer/lib/vcs/changeCategory.ts`），组头带文件数，超过 `GROUP_COLLAPSE_THRESHOLD` 默认折叠。
- **caveat 每组一次，绝不逐行**：哪些文件没被完整比较是组级的一句话，具体原因在各自的详情里。

这四条替换掉的是「每个文档全展开纵向堆叠」，那种形态下四十个变更文件就是一个上千行的滚动列。

### 加一个 presenter

`renderer/lib/vcs/presenters/registry.ts`。`matches(entry)` 认领，`Detail` 画。
`presenterFor` **永不返回 undefined**，认不出回落 `GenericChangeDetail`（就是那份通用的改动行列表）。
写完把模块 import 进 `ChangeDetailHost.tsx` 的那张清单——注册发生在模块求值期。

认领判据有两种：看 `entry.contentClass`（资产，由比较过程判定）或看 `entry.documentKind`（有 spec 的文档）。
两个都匹配时后 import 的赢，`registry.test.ts` 钉着这条。

**两侧的字节走 `comparisonSide.ts`**：修订侧 `readBlob`，工作树侧 `vcs.readWorkingFile`（路径校验 +
大小上限，见 `managers/vcs/workingFile.ts`）。`useSideObjectUrl` 负责 `createObjectURL` 与撤销——
一个 presenter 自己造 URL 就要自己负责撤销，而这个界面一次会看几十张几 MB 的图。

### 五档，以及为什么 `content` 必须是独立一档

`semantic` → `summary` → `structural` → `content` → `opaque`（`shared/documents/diff.ts`）。

`content` 是「认出了格式、读了文件头」：位图给尺寸、音频给时长与采样率、字体给 family。
它独立成档不是分类癖，是因为把它并进 `opaque` 会在屏幕上摆出一句假话——`opaque` 的说明是
「未读取。太大、非文本或读不出，只报告大小」，而它正上方那行写着「1920×1080 → 1280×720」。
**判据挂在 provider 上**：读了文件头的才配 `content`，`headBytes === 0` 的留在 `opaque`。

⚠ **资产内容按 asset id 分片存放，文件名没有扩展名**（`assets/content/99/55/3d15abb…`）。
任何按路径判类型的逻辑在真实项目上都会全部落空——`contentClass.ts` 因此在扩展名判不出时
按魔数嗅探。**写这类逻辑前先看真实路径长什么样，别照着测试夹具想象。**

### 两列蒙版：界面与蓝图

`UIDocumentChangeDetail` / `UIGraphsChangeDetail`：左列旧版、右列新版，改动标在它所在的那一版上
（删除只画旧侧、新增只画新侧、修改两侧都画）。四种色调收在 `changeMask.ts` **一处**——
新增 `primary`、删除 `danger`、改属性 `warning`、仅移动位置最弱一档且无色相。

界面那侧用 `GameSurfaceRenderer` 渲染历史文档（`passive` + `staticDocument` +
`surfacePointerEvents:"none"`）。⚠ **`interactive` 必须留 ON**：`EditorNodeWrapper` 只在 interactive
时写 `data-ui-element-id`，关掉就没有任何元素可寻址、蒙版全部落空。
蓝图那侧不需要编译链路——IR 就在文件里（`program.graphs.<slot>.<id>.graph`，坐标在
`meta.editorLayout`），画布自带平移缩放（ctrl+滚轮，与 UI 编辑器同一套速率），**两列共用一个
变换，叠加在 `sharedGraphViewport` 之上**。

**改动数与蒙版数必须对得上**，这是作者信任这个界面的全部依据：`accountedChanges` /
`accountedGraphChanges` 对着真 spec diff 断言，定位不到的元素**计入一行说明而不是静默丢掉**。

### 蓝图卡片：真节点、真引脚

节点不是占位矩形。标题栏加逐行引脚，高度由引脚行数决定、宽度由标题与两列引脚标签决定
（`graphNodeShape.ts`，纯算术，单位是作者布局用的图坐标，所以卡片和 `meta.editorLayout` 在同一套
坐标里）。执行引脚画箭头、数据引脚画圆点，连线落在**它真正连接的那个引脚**上而不是卡片边缘中点；
目录里查不到的引脚（Switch 的分支、函数头的参数）从边反推出来，所以那些线也有落点。
节点目录的查询由调用方传进来，画布本身不要求工作区的目录已经建好——查不到就退回类型标识符，
画一个没有引脚的普通卡片。

**没有改动的节点整体去色**：底色退到 `surface`、标题 `fg-muted`、引脚 `fg-subtle`，于是画面上
只有戴蒙版的节点还有颜色。⚠ **仅位置变动的节点保留完整卡片配色**，只有它的蒙版是无色相那一档
——把它一起去色等于说「这个节点不必看」，而它可能正是作者在找的那个。

缩放仍然是算术（`viewport.scale * nav.zoom` 乘进每一个尺寸），不是 CSS `scale()`，所以蒙版边框
在任何缩放下都是 1px，引脚和连线也不会跟着变粗。引脚与标签在行高约 5px、字号约 6px 以下不画，
但连线的几何不依赖它们画出来。⚠ **贴合视图那一档下节点标题仍然只是几个字的残段**：详情栏只有
三百多像素宽，那一档看的是结构和蒙版，读字要缩放进去。

### 角色表是一人一张卡

`characterSections.ts` / `CharacterChangeDetail`：分组照抄角色表自己的形状——一个角色一张卡、
卡头是作者起的名字，不属于任何角色的行（角色顺序、分组）收成卡前后两段。**预算是整个面板一份
而不是每张卡一份**：行没有虚拟化，一份文档可能带着生成器的整份改动预算。装不下的那张卡保留装得下的
行并自己报告余量，它后面的卡不画——半张卡也比没有强，作者至少知道那个角色变了。

**字段的名字取自作者编辑它的那块面板**（`CHARACTER_FIELD_NAME_KEY`）。生成器交回来的是文档里的
存储键（`defaultAvatarAssetId`、`backend`），而标签是「资料 {field}」，原样画出来就是把 JSON 键摆在
作者面前。六个面板画得出、却从不给标签的字段（别名、分组、画布、头像差分轴、PSD、傀儡的默认状态）
在 `documentDiff.characters.fields` 下另有词条，取词来源是那些控件自己的说法（设定画布、
头像随此轴变化、导入 PSD）。⚠ **它们不放进 `characters.*`**：面板不画的词摆在面板自己的命名空间里，
下一个人会把它当成面板的标签，于是同一件东西有了两个名字。

⚠ **`attributes` 与傀儡的 `options` 保留存储键，这是裁决不是欠账**：Studio 没有编辑它们的界面，
两者都是插件或导入写进去的数据袋，存储名是任何能碰到它们的人唯一知道的名字。
`characterSections.test.ts` 两头钉着——一头是「每个词都得是产品已经画得出的」，
一头是这两个键必须查不到。

### 改动行也是回到画布上的路

画布上的蒙版和它底下的那份改动行问的是**相反的两个问题**，所以答案不一样：点蒙版问「这个节点上
改了什么」，答案是把列表收窄到那一行；点改动行问「这条改动在哪」，答案是把画布挪到它身上，
而**收窄在这里是错的**——那会把作者正在逐条走的行本身拿走。

这条缝是 `RowReveal`（`DocumentChangeList.tsx`）：`can` **逐行**回答「这个面能不能挪过去」，`go` 挪，
`label` 给行凑出可读的名字。逐行问是因为**看起来能点、点下去不动的行比不能点的行更坏**：
不在当前这张图上的改动、不属于任何节点的改动、页面没有句柄的元素，它们的行仍然是文字。
列表自己一个字都不判断——它是版本轨道也在画的那份列表，那里它上面什么都没有。

蓝图那侧挪的是**两列共用的那个变换**，落点取**两个版本的并集**：被拖过的节点在这一张图里有两个位置，
只框住新版那个会把旧版那张卡推出画面，而「一边有、一边没有」正是**新增**的样子——作者问的是它挪去了哪，
拿到的却是另一个问题的答案。连线同理，框的是它连的两张卡而不是线的中点。
缩放取「够读」与「装得下」里较小的那个，**装得下赢**：阅读阈值是偏好，把一半答案留在画面外是错答案；
已经比「够读」更近的缩放不动它，那是作者自己挑的。地板是适应视图，所以这个动作只可能是往里走。

界面那侧没有可挪的平移（页面是整页画出来的），行点击就只把那个元素的蒙版点出来。
⚠ **两侧不许只做一侧**：两块画布共用 `CanvasShell` 正是为了不长成两个功能。

### 分屏里的故事是剧本，不是改动行

`storyScriptPlan.ts` / `StoryScriptRow.tsx`：每一半按**它那一版的字节**画场景的块，沿用故事编辑器
自己的投影（`lib/story/storyRowProjection`）与栏标记组件。只读，两半里没有任何控件。

- **粒度是块，而且就停在块**：`storyDiff.ts` 整块比较 `payload`，所以数据支持的是「这一行变了」，
  不是「这一行里的哪几个字变了」。呈现层不许比数据更细——从整块比较里画出来的逐词高亮是编出来的。
- **只画有改动的场景，但那个场景整场画出来**：前后两行是让改动行可读的东西；四十个没动过的场景
  是一堵墙，不是答案。
- **剧本画不出来的改动仍然走改动行**（文档名、章节的场景表），排在剧本前面。一条都不丢，
  上一条／下一条走过的仍然是同一个总数。
- **说话人按版本读**：角色表也按那一半的版本解析，所以改名前后两列各自显示各自的名字。
  资产名与项目变量名是**按当前项目**读的，同 `useVersionedAssets` 读预览语言的取舍。

## 9.2 一份文档由多个文件组成：document set

`shared/documents/documentSet.ts`。**本仓目前一个都没注册**，故事仍是单文件；这一层是先落地的那半。

背景是故事文档要拆成一个场景一个文件（`storydoc.json` 只剩章节、场景桩、入口场景，旁边是
`scenes/<sceneId>.json`）。拆之前必须先有这一层，因为版本控制层**在「一个文件」之上没有任何概念**：
`resolve()` 一条路径对一个 spec，`merge3(base, mine, theirs)` 每边只收一个值，比较预算按路径花。

设计只由一条要求决定：**格式自己的 `diff` / `merge3` / `summarize` 一行都不用改。**
`diffStoryDocument` 要整份文档才答得出任何东西（场景顺序、`sceneRank`、共有场景集、schema 版本闸
都是整份文档的事实）。所以 set spec 就是**整份文档**的普通 `DocumentSpec`，外加一张
`DocumentSetLayout` 说明这份文档怎么摊在文件上、怎么拼回去：`assemble(parts) → 生值`（`parse` 随后
在它上面跑）、`disassemble(document) → 各部分的生值`。`paths` 由 manifest 与 member 两个模式导出，于是
注册表原样认领成员路径，`pathFor({storyId})` 给 manifest、`pathFor({storyId, sceneId})` 给成员。

三条规则，下游全部建在它们上面：

1. **成员按路径枚举，绝不按 manifest 的内容。** 每个调用方手里都只有一份路径清单，而且都付不起
   「先解析 manifest」：修订比较有两次 tree walk，工作树比较有 status 加一次 tree walk，合并只有一个
   目录。而且 manifest 驱动会造出第二个「这份文档由哪些文件组成」的事实源，两者恰好会在最要紧的时候
   不一致——**没被 manifest 列出的成员文件，正是一次坏合并留下的形状**。所以：匹配 member 模式且 set
   key 相同的路径就是成员，`assemble` 拿到找到的一切，由**格式**决定收下、丢掉还是 `corrupt`。
2. **决定回写到哪个文件，靠拆解，不靠路径算术。** 作者的答案由**原样不动的** `applyMergeDecisions`
   贴回整份文档，然后把结果重新 `disassemble`；改动落在哪一部分，那个文件就是它的归属。若改用
   `DocumentChange.path` 推导归属，就多出第三套寻址要跟 `diff`、`merge3` 同步，而且表达不了一次合法地
   动两个文件的改动（改场景名同时动 manifest 的桩和成员本身）。
3. **一个 set 是一个预算单位、一行、一个冲突。**

### 预算的单位从「路径」改成了「文档」

`DIFF_PATH_LIMIT`（2000）已更名为 **`DIFF_UNIT_LIMIT`**，数值不变。旧的前提是「一个文件就是一份
文档」；一旦一份文档能是很多文件，这个前提就朝最贵的方向失效：**四部 560 场景的故事是 2244 个文件、
4 份文档**，按路径数它会超限，于是**整个项目里每一份文档**——人物、译文、素材——都会被报成「未读取」，
只因为作者没碰过的某个故事很大。现在先折叠再计数；没注册 set 的项目数出来的和以前一模一样。

数值没有上调，这是刻意的：调大是吸收同一道算术的另一种办法，只买到再翻一倍的时间，
**错的是单位不是数字**。

另有 **`DOCUMENT_SET_MEMBER_LIMIT`（2000）**：一份文档的文件数超过它就不再组装，答成**一行**
「改了，没读」，并通过 `onDegrade` 说明原因。**不回落成每个成员一行**——那正是 `DIFF_UNIT_LIMIT`
要挡的洪水从另一扇门进来。`DIFF_PARSE_BYTE_CEILING` 对 set 按**总字节**计。

### 比较与索引

`revisionDiff` / `workingTreeDiff` 先折叠再花预算，`DocumentDiffEntry` 多了一个 `members`：这一行
代表的**发生了改动的**那些路径。行本身报在 manifest 上，而 manifest 常常自己没变——日常编辑改的是
成员。索引仍是每份文档一行（`ChangeIndexRow.memberCount`，只在**悬浮提示**里说文件数，绝不加第二行）。

set 只有四档：**没有 `structural`**。「值不同的那些 JSON 路径」需要每边一份 JSON，而 set 有 N 个
文件；逐文件走一遍会产出第四套寻址，`diff`、`merge3`、解决界面谁都用不了。组装不起来就直接落到
`opaque`，并把原因交给 `onDegrade`。

### 合并

`mergeDocument.ts` 按 §4.23 的附属文件组装，一份文件一组：

- 旁边有 `~mine` / `~theirs` 的文件贡献这两边，有 `~base` 就贡献 base；
- **旁边什么都没有的文件，把工作树里的字节同时给三边。** 它已经被 automerge settle 了（或根本没动），
  三边一致就是在说这件事：`merge3` 那里不会生出任何决定，字节保持后端留下的样子，提交按 §4.25 逐字节
  记录。拿 automerge 的结果当那个文件的 base 是个小小的虚构，但三边一致，由它生不出任何决定。
- **manifest 自己冲突且没有 `~base` = 整份文档 add/add**，由 `documentSetPartsFrom` 拒绝组装没有
  manifest 的 set 来表达。`~base` 存在但解析不了**不降级成 add/add**（理由同单文件那条）。

`VcsMergeDocument.members` 报出这一次回答会 settle 的**每一条**冲突路径，`resolveDocumentChanges`
返回同一张表，`VcsManager.completeMerge` 拿它去调 `branch_merge_resolve`。**必须传全部**：漏一条，
提交会被拒并点名它（§4.32），而先前那几条的附属文件已经被那次失败提交的 stage 删掉了。`merge.ts` 的
`resolveConflicts` 同理，把属于同一 set 的路径展开成它全部的冲突路径再逐个拷附属文件——
**拷附属文件加普通 `branch_merge_resolve` 那套一个字没改**（§4.31）。

settle 之后 set 只重写**字节真的变了**的那些文件；settle 后的文档里不再有的成员**会被删掉**——
成员按路径枚举，留着的文件下次会被原样折回来，作者接受的删除会自己悄悄撤销。

### 拆故事的人还欠什么

- **`workspaceProjectPreflight` 那条 `mergeConflictReads` 现在是对的，别去动它。** 它装的是
  `readMergeState().conflicts`，而那份清单来自 `findConflictedPaths` 的**附属文件遍历**——与路径形状
  无关，所以每个冲突的成员文件都会各自被替换成 `~mine`，§4.33 那条链不会因为拆文件而重开。
  **一旦有人把冲突清单折叠成「每份文档一行」，preflight 必须继续拿未折叠的那份**，否则成员读不到
  `~mine`，工作区又打不开了。
- **解决面板仍是每个冲突文件一行。** 主进程这半已经能「从 set 的任一路径组装整份文档、一次 settle
  全部成员」，但 `VcsMergeState.conflicts` 没有折叠，所以面板会给同一份文档画 N 行。逐变更 settle
  会写全部成员，之后再对其中一行按「保留我的」就会把它盖掉。折叠面板的行是**必须做**的一步。
- **delete/modify 冲突后端写什么，没测过。** 只有 `~mine` 或只有 `~theirs` 的文件，这里按
  `blocked: "unreadable"` 拒绝整份文档（与单文件那条同规则）。要支持得先量 Lore 到底写了什么。
- **删掉的成员路径还要不要 settle，没测过。** 现在照 settle。这条靠 `expandDocumentSets` 的**并集**
  语义成立：传进来的 set 路径**只要附属文件还在旁边就保留**，而不是丢掉再从 `findConflictedPaths`
  重新推——那道遍历要求冲突文件本身在盘上，而 `writeDocumentSet` 刚把它删了，于是最该 settle 的那条
  恰好是遍历看不见的（第一版就是这么写的，提交会被拒，而先settle 的那几条附属文件已经没了，§4.32）。
  也不能无条件保留：折叠后的界面用 **manifest** 指代一份 set，而干净 automerge 的 manifest 旁边没有
  附属文件，`takeSide` 会在它上面抛。Lore 对一条工作树里已不存在的冲突路径怎么反应，仍未测。
- **一份成员在盘上但读不出来 = 整份文档 `blocked: "unreadable"`。** 不是跳过：跳过会让它从三边同时
  消失、组装出的文档里没有它，然后写回那一步的删除循环把作者的文件删掉。写回只允许删**进过合并**的
  文件（`ComposedSet.files` 记的是这一批，不是找到的那一批）。

## 10. 待解问题

- ~~**resolve 面板没有做过目视验收**~~ —— **2026-08-25 做了**，用两份 clone 对同一行台词和同一个
  元素名各改一次，push 一边、另一边 Get，造出真冲突。**机制全部成立**：三态选择在（`已自动合并`
  是第三个）、未决时底部写「还有 N 个文件没选边」并拦住完成、`ui-document` 没有 merge3 所以只给
  整文件两个按钮、完成后逐文件按各自的选择落盘（实测一份保留我的、一份保留对方的，结果正确，
  冲突标记清干净）。**说话的那一半原有五处欠账，目视验收又添了第 6 处；2026-08-25 六处全部了结**：

  1. ✅ **索引与详情曾按文件命名**（`storydoc.json` / `editor/story/stories/48bb82a5-…`）。现在走
     `documentName.ts`，与比较界面同一套四态答案：故事显示作者起的标题，没有自己名字的显示种类名，
     读不到标题的显示「故事（id）」。路径退到 tooltip，目录那一列删掉——名字自己就能区分了。
     ⚠ **`buildConflictRows` 的 `names` 是必填的**，理由与 `buildChangeIndex` 相同：默认值等于给
     「悄悄退回文件名」留一条路，而合并正是最不该有这条路的界面。名字读**工作树**那一份故事库，
     因为合并期间它就是自动合并的结果；它自己也冲突时读不出来，那就落到 `unnamed`。
  2. ✅ **冲突的值曾是序列化 JSON**（`text {"textId":"…","role":"narration","value":"…"}`）。
     `describeMergeSides` 现在**同时描述两侧**：嵌套字段展开成 `text.value` 这样的名字，
     **两侧不同的字段排在最前**，两列用同一份字段表所以逐行对得上。一行台词因此以它自己开头。
     判据写在函数注释里：一条决策存在的理由就是两侧不同，先画双方一致的部分等于先画不是问题的那部分。
  3. ✅ 名字被截成 `s…` 随 1 一起消失。
  4. ✅ 合并期间作者的文件在磁盘上带着 `<<<<<<< ours` / `||||||| original` / `>>>>>>> theirs`，
     这是设计（见 §4.23 与 merge 冻结的注释）。曾经**只有重新打开项目**能正确面对它：
     `workspaceProjectPreflight` 在任何文档被解析之前装上替身与冻结，而**刚刚同步出冲突的那个窗口
     按原样重读**，于是故事面板空白、仪表盘 0 场景，还没有冻结保护。
     现在同步走进同一个状态：`sync` 在重读之前调用 `WorkspaceFreezeService.showMergeConflicts`，
     装冻结、装替身、丢掉可能正在看的历史版本，然后才重读。
     ⚠ **冲突路径问仓库要，不取 `result.data.conflicts`**——两条路因此是同一个问题的同一个答案，
     而不是碰巧一致；同步自己那份还更易逝（走事件流，下一次调用就没了，§4.24）。
     ⚠ **不 flush**：到这一步工作树已经被改写，flush 等于把编辑器手里的合并前内容写回去，
     正是这道冻结要拦的那次写。
     **恢复模式不再被提议**——它是为「没人说得清的损坏」准备的，而合并说得清自己，出路是把合并
     做完或放弃（`useRecoveryOffer` 问仓库有没有未完成的合并，**不是问冻结**：冻结在开项目时
     才 armed，答不了「刚刚同步出冲突的这个窗口」）。
  5. ✅ 4 修好之后那两条红色通知不再出现（它们本来就是 4 的后果）。剩下的那处自相矛盾也修了：
     面板顶栏从前**无条件**写「该项目的两个版本正在合并」，于是合并一结束，它就和自己面板正文里
     那句「该项目没有正在进行的合并」当面顶牛——一屏两个答案，错的那个还在上面。
     现在走 `mergeHeadingKey(state)`：有合并才说合并，没有就退回面板自己的名字（「合并」），
     那句话不主张任何事。⚠ **它收的是 state 不是布尔**：`null` 是「还没人问过」，
     把它折进「没有合并」等于把一个仅仅是**大概率**的判断摆上屏幕。
  6. ✅ **同步的冲突通知曾按文件命名**：`syncConflictDetailMany` 把
     `editor/story/stories/48bb…/storydoc.json` 原样列给作者，而它指过去的那个面板管同一批文件
     叫作者起的名字——先到的那条反而是 Studio 在讲自己的存储。现在走 `listDocumentNames`，
     和索引、详情、版本轨道同一套答案。
     ⚠ **名字是当场读一次**（`readDocumentNames`），不是挂 `useDocumentNames`：后者会让每个
     用到 `useVersionSurface` 的表面都背上一次故事索引读取，只为一条几乎不出现的通知。

  **4 的目视验收（2026-08-25，真机、真服务器、真冲突）**：两份克隆各自改过同一份故事，按下轨道上
  的「从服务器获取」，同步以两个冲突结束（`storydoc.json` 与 `uidoc.json`）。同一个窗口随即显示：

  - 仪表盘 `场景 1 · 字数 9 · 蓝图节点 3 · 界面 1`——与同步前逐项相同，而这正是从前归零的地方；
  - 故事面板 `故事（1）Harbour · Chapter 1 · Scene 1· 2 行`，打开后两行台词是作者自己那一侧
    （`Second line, rewritten on B.` / `Ben adds a line.`）；
  - 状态栏 `当前不保存任何改动 · 有一次合并尚未完成，在版本面板中完成合并后恢复保存`，
    轨道上是 `合并进行中 · 有 2 个文件要选保留哪一边 · 完成合并`；
  - 界面上**没有**「恢复模式」，也没有「该项目未能正常加载」。

  **5 与 6 的目视验收（同日，同一台服务器、同一次冲突）**：

  - 通知从两行路径变成 `有 2 个文件在本地和服务器上都被修改过： Harbour 界面页面`；
  - 合并进行中时顶栏是「该项目的两个版本正在合并」；按「放弃合并」并确认之后，**同一个还开着的
    标签页**里那句降到 0 次，顶栏变成「合并」、正文是「该项目没有正在进行的合并」，
    「当前不保存任何改动」也一并消失（冻结随合并结束解除），故事面板仍是
    `Harbour · Chapter 1（1）· Scene 1 · 2 行`。
- **`ui-document` / `ui-graphs` 没有 `merge3`，这是裁决不是欠账**：两个作者各自重排同一个界面树，
  交织出的第三种布局能正常渲染、谁都没写过——正是 `DocumentMergeRefusal` 存在的那种静默失败。
  真要做，先解决寻址：元素跨 surface 拖动时两侧地址不同（`uiDocumentDiff.ts` 顶部有说明）。
- **故事在窄详情栏里仍走通用改动行**：剧本形态只在分屏标签页里（§9.1）。台词级的逐词对照
  没有做，也不该在这一层做——`storyDiff.ts` 比较的是整块 `payload`，要更细得先动 spec。
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
