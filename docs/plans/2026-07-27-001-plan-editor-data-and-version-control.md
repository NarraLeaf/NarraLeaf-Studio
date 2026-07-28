---
title: "plan: 编辑器数据硬化与版本控制系统"
type: plan
status: draft
date: 2026-07-27
branch: feat/vcs-and-data-hardening
worktree: D:/Temp/nls-vcs
---

# plan: 编辑器数据硬化与版本控制系统

现状是「主进程有一层只读的 Lore 封装，渲染进程一行没接，没有任何地方创建过仓库」。
目标是让 Studio 拥有一套**作者能用**的版本控制：显式提交、按时间的自动检查点、只读的历史
浏览、语义级 diff、恢复即新版本，以及**协作**（局域网 / 公网 loreserver）。

底层路线不变，仍是 [Epic Games Lore](https://github.com/EpicGames/lore) v0.8.5，理由写在
[docs/version-control.md §0](../version-control.md)。本卡改的是**上面那一层**。

结论先行，四条：

1. **`@lore-vcs/sdk` 的 JS 层要整体丢掉，绑定我们自己写。** 不是因为它丑，是因为它的失败
   模式是静默数据损坏（`loreHash` 缺 handler → 零填充 partition），而且它在**模块求值期**
   `koffi.load()`，一次失败整个进程永久不可恢复。我们只需要 131 个 verb 里的 ~35 个，自己
   绑一遍比继续给它打补丁**更快、更准**。DLL 继续用官方平台包，不自己编。
2. **写侧完全可行，今天实测过了。** 我 dump 了 DLL 的导出表（263 个符号），并用真库跑通
   `create → stage → commit → flush → status`，全程 offline。写侧不存在的只有
   `lore_revision_tree_add/_commit/_modify`（内存态构造 revision），而我们不需要它。
3. **版本控制的前置条件是数据硬化，不是反过来。** 现在 8 个文档服务各写各的 JSON，
   `JSON.stringify` 的键序取决于代码路径。不先做**规范化序列化**，diff 全是噪声、
   三路合并根本没法做。硬化不是版本控制的配套，是它的地基。
4. **协作从第一天就要在接口里，哪怕服务端后做。** 分支、同步状态、冲突模型如果等到 V5
   再塞进已经定型的接口，前面四个里程碑要返工。P0 仍然是单机可用，但类型和 IPC 面按
   协作形态设计。

裁决（本卡开工前已定，不再重新谈判）：

| 问题 | 裁决 |
|---|---|
| 谁产生版本 | **显式提交** + **按时间的自动检查点**，间隔由设置控制（0 = 关） |
| 什么进版本库 | **整个项目目录**，排除缓存与派生物（见 §4.2） |
| 回到旧版本 | **只读浏览** + 「恢复」**产生新提交**，历史永不丢失；支持单文档粒度恢复 |
| 协作 | **在范围内**。局域网裸 loreserver 先行，公网需要签发 JWT 的 sidecar |

---

## 1. 现场勘验

### 1.1 已经有的（2026-07-18 落地，只读）

| 文件 | 职责 | 本卡命运 |
|---|---|---|
| [backend.ts](../../src/main/app/application/managers/vcs/backend.ts) | 插拔边界、平台闸门、可用性缓存 | **保留**，改为指向新绑定 |
| [loreClient.ts](../../src/main/app/application/managers/vcs/loreClient.ts) | 唯一 import SDK 的地方，14 个坑的封印 | **删除**，被 `lore/` 取代 |
| [revisionReader.ts](../../src/main/app/application/managers/vcs/revisionReader.ts) | blobAt / mergeBase / threeWay / changedPaths | **保留逻辑**，换底层调用 |
| [VcsManager.ts](../../src/main/app/application/managers/vcs/VcsManager.ts) | 按项目 keying 的 session | **扩写**，加写侧与协作 |
| [vcsAction.ts](../../src/main/app/application/managers/window/handlers/vcsAction.ts) | 8 个只读 IPC | **扩写** |
| [@shared/types/vcs](../../src/shared/types/vcs.ts) | 渲染进程类型，无 `Lore` 前缀 | **扩写** |

### 1.2 今天实测的（不是推测）

**DLL 导出表**（PE export directory 直接解析，`lorelib-amd64-unknown-windows.dll` v0.8.5）：
263 个符号。本卡需要的全部存在：

```
lore_repository_create / _flush / _status / _clone / _info
lore_file_stage / _unstage / _write / _info / _history / _reset / _dump
lore_revision_commit / _history / _info / _diff / _restore / _sync
lore_revision_metadata_set / _get / _list
lore_branch_create / _list / _switch / _info / _diff / _push
lore_branch_merge_into / _merge_start / _merge_resolve / _merge_abort
lore_storage_open / _close / _get / _put
lore_auth_login_with_token / _login_interactive / _logout / _list
lore_notification_subscribe · lore_lock_file_acquire · lore_log_configure
```

缺席的只有 `lore_revision_tree_add / _commit / _modify`——与 [§4.10](../version-control.md)
记录一致，且与我们无关（写回走工作树）。

**真库往返**（临时目录，`offline: true`，未启动任何服务端）：

- `repositoryCreate` 在**项目根**建 `.lore/`（`config.toml` / `id` / `instance` /
  `immutable/` / `mutable/`，各带一个 `lock`）。**工作树 = 项目目录**，没有第二种布局可选。
- `fileStage` → `revisionCommit` → `repositoryFlush` 成功，提交事件给出 revision + repository。
- `repositoryStatus` 一次性给出：`branchName`、`revision`、`revisionNumber`、
  `revisionStaged`、`revisionMerged`、`revisionLocal/Remote` 及其编号、
  `isLocalAhead` / `isRemoteAhead` / `remoteAvailable` / `remoteAuthorized` / `remoteBranchExist`。
  **协作 UI 需要的同步状态，一个调用全有。**

**FFI 形状**：每个 verb 都是
`lore_x(const LoreGlobalArgs*, const LoreXArgs*, LoreEventCallbackConfig) -> int32_t`，
args 结构体平均 3–8 个字段，标识符一律 `LoreString`（十六进制）。这就是为什么自己绑不贵。

### 1.3 编辑器数据的实际形态

落盘位置由 [ProjectNameConvention](../../src/renderer/lib/workspace/project/nameConvention.ts)
统一声明，但**读写逻辑分散在 8 个服务里**，各自 `JSON.stringify`、各自迁移、各自防错：

| 服务 | 文档 |
|---|---|
| StoryService | `editor/story/index.json`、`editor/story/stories/<id>/storydoc.json`、`animations/*.json` |
| UIDocumentService / UIGraphService | `editor/ui/uidoc.json`、`editor/ui/uigraphs.json` |
| VariableRegistryService | `editor/variables.json` |
| LocalizationService | `editor/localization/*.json` |
| VoiceService | `editor/voice/*.json` |
| AssetsService | `assets/assets.metadata.<type>.json`、`assets.groups.<type>.json` |
| ProjectService | `project.json` / `.nlproj` |
| blueprintPersistenceAction（主进程） | 蓝图文档 |

[PR #37](../../src/renderer/lib/workspace/services/autosave/DebouncedSaver.ts) 已经解决了
**写的时机与原子性**（原子写 + 自动保存上限 + 失败重试 + 退出前 flush）。本卡要解决的是
**写的内容**：字节是否确定、结构是否可校验、损坏是否可隔离。

---

## 2. V0 — 重写 Lore 的 TypeScript 接口

### 2.1 为什么不是「继续封 SDK」

三条硬理由，每条都在 [§4](../version-control.md) 有实测记录：

1. **失败模式不对称。** `convertToLoreDatatype` 没有 `loreHash` handler，传错方向不报错，
   而是把定长字段**零填充**——调用成功，partition 变成全零。当前封装靠「先 hex、捕获特定
   错误串再降级」绕开，代价是我们的正确性依赖上游一句错误文案不变。
2. **加载失败不可逆。** SDK 在模块求值期 `koffi.load()`，ESM 求值一旦抛异常 Node 永久缓存，
   同进程再 import 都是同一个错误。用户修好安装也必须重启 Studio。
3. **我们只用得上 ~27%。** 131 个 verb 里需要 ~35 个；SDK 为另外 96 个背了几百个事件结构体
   和一整套通用转换层，我们承担了它们全部的风险却拿不到收益。

### 2.2 模块布局

```
src/main/app/application/managers/vcs/lore/
  library.ts      # 定位 + 惰性 koffi.load，LORE_LIB_PATH 逃生舱，符号存在性探测
  abi/
    primitives.ts # LoreString / LoreHash / LorePartition / LoreContext / LoreBinary / ...
    args.ts       # 我们用到的 ~35 个 args 结构体
    events.ts     # 我们消费的 ~30 个事件结构体 + LoreEventTag 子集
  encode.ts       # 按声明类型显式编码；hex 非法即抛，绝不静默零填充
  decode.ts       # 事件解码，出 FFI 内存即拷贝
  call.ts         # 唯一的 invoke：注册/注销 callback、异步 off-thread、事件分发、错误富化
  verbs.ts        # ~35 个有类型的操作，Studio 唯一调用面
  index.ts
```

### 2.3 相对 SDK 的六个具体改进

| # | SDK 行为 | 新绑定 |
|---|---|---|
| 1 | 模块求值期 `koffi.load()` | `openLibrary()` 内惰性加载；失败可重试（用户修好安装不必重启） |
| 2 | 通用转换表，缺 handler 即零填充 | 每个字段按声明类型走显式编码器；hex 长度/字符不合法**抛错** |
| 3 | `.callback()` 是替换语义，调两次静默丢第一个 | 单一 trampoline，事件向多个订阅者分发 |
| 4 | `event.data` 是借来的 FFI 内存 | 解码即拷贝（`Buffer.from` / 结构体展开），没有借用对象能逃出回调 |
| 5 | 符号不存在 → koffi 抛底层错误 | `hasSymbol()` 探测，缺失即 `LoreCapabilityError`，带 verb 名 |
| 6 | 注册的 callback 是否注销不明确 | `koffi.register` / `unregister` 严格配对在 `finally` |

保留 SDK 已经封住的四条（它们是对的，只是位置要换）：路径必须绝对（Lore 按进程 CWD 解析）、
`PATH_IGNORE` 必须转异常（否则资产静默不进库）、回调内禁止重入 Lore、错误带 Rust `file:line`。

### 2.4 ABI 正确性怎么保证

手写结构体的风险是**布局写错 = 内存损坏**。三道防线：

1. **交叉校验脚本** `tools/lore-abi-check.mjs`：把我们的结构体定义与 SDK 生成的
   `types/args/ffi.js`、`types/ffi.js` **逐字段比对**，字段名/类型/顺序不一致即失败。
   `@lore-vcs/sdk` 因此降级为 **devDependency**——只在这个脚本里出现，生产不加载。
   升级 Lore 时这个脚本就是 diff 报告。
2. **sizeof 断言**：`abi.test.ts` 对每个结构体断言 `koffi.sizeof`，布局漂移立刻红。
3. **真库集成测试**：现有 11 个测试迁移过来，再加写侧往返（create/stage/commit/history/
   restore/branch/merge），跑真 DLL。

### 2.5 依赖形态

```jsonc
"optionalDependencies": {
  "@lore-vcs/sdk-amd64-unknown-windows": "0.8.5",
  "@lore-vcs/sdk-arm64-apple-darwin":    "0.8.5",
  "@lore-vcs/sdk-amd64-unknown-linux":   "0.8.5",
  "@lore-vcs/sdk-arm64-graviton-linux":  "0.8.5"
},
"dependencies":    { "koffi": "2.16.2" },
"devDependencies": { "@lore-vcs/sdk": "0.8.5" }   // 仅供 ABI 校验脚本
```

平台包自带 `os`/`cpu` 字段，包管理器只装匹配的那个。**跨平台打包的陷阱依旧**
（[§7](../version-control.md)：在 Windows 上打 mac 包会装进 DLL 而没有 dylib），CI 必须在
目标平台装依赖——本卡把这条写成显式检查而不是口头约定。

---

## 3. H — 编辑器数据硬化

### 3.1 目标

版本控制对数据的要求比「能读回来」高一档：

| 要求 | 为什么版本控制需要 | 现状 |
|---|---|---|
| **字节确定性** | 同样的内容必须产生同样的字节，否则每次保存都是全文件 diff | ❌ 键序随代码路径 |
| **可枚举** | 必须有一个地方知道「这个项目由哪些文档构成」 | ⚠️ 路径有约定，文档集无清单 |
| **可校验 + 可迁移** | 读旧版本的文件必须是全函数，不能崩 | ⚠️ 各服务各写各的 |
| **损坏可隔离** | 一个坏文件不能让项目打不开，更不能被覆盖掉 | ❌ 解析失败即失败 |
| **可摘要 / 可结构化 diff** | 「这次改了什么」要说人话，不是行号 | ❌ 不存在 |

### 3.2 文档模型

新增 `src/shared/documents/`（shared：主进程要解析它做 diff，渲染进程要序列化它落盘）。

```ts
interface DocumentSpec<T> {
    kind: DocumentKind;                       // "story" | "ui-graphs" | "voice" | ...
    /** 相对项目根，来自 ProjectNameConvention，是版本化路径的唯一来源 */
    pathOf(id?: string): string[];
    version: number;                          // 当前 schema 版本
    parse(raw: unknown, ctx): T;              // 校验 + 迁移；失败抛 DocumentCorruptError
    serialize(doc: T): string;                // 规范化编码
    summarize(doc: T): DocumentSummary;       // 历史/diff 界面要的标题与计数
    diff?(base: T, head: T): DocumentChange[];// 语义 diff（V3 才要求实现）
}
```

**规范化编码**（`canonicalJson.ts`）：键按 code unit 排序、2 空格缩进、LF、结尾换行、
拒绝 `undefined`/`NaN`/`Infinity`、数字用最短往返表示。

- 排序键**比保留插入序更确定**——JS 引擎本来就会把整数样式的键重排，插入序从来不是真保证。
- 缩进换行不是为了给人看行 diff（我们的 diff 是结构化的），是为了 **FastCDC 分块**：
  单行大 JSON 改一个字符会重写整个 chunk，多行版本只动一两个。

**损坏隔离**：解析失败不覆盖、不静默。把原文件复制到
`.nlstudio/quarantine/<时间戳>/<原路径>`，向 SaveStatus 报一条可见的错误，文档以「未加载」
状态存在——**绝不用默认值覆盖一个读不懂的文件**，那等于删数据。

### 3.3 排序键会重排作者写下的内容 —— H1 审计发现，必须先解决

H1 完工时做了一次审计，结论是**四个文档格式把对象当有序 map 用**，键序就是作者看到的顺序。
排序键不是"整理格式"，是**打乱作者的内容**。已逐条核实：

| 格式 | 键序表现为什么 | 证据 |
|---|---|---|
| `StoryScene.blocks` | 场景变量表与快照面板的行序 | `listSceneDeclarationBlocks` = `Object.values(scene.blocks)`，注释明写 "in document order"（`src/shared/types/story/declarations.ts:60`） |
| `Blueprint.program.graphs.events` | 事件层列表；`eventIds[0]` 决定默认打开哪一层 | `src/shared/types/blueprint/document.ts:170`、`BlueprintMemberTree.tsx:729` |
| `AssetsMap[type]` / `AssetGroupMap[type]` | 资产浏览器排序，且 shift 范围选择依赖它 | `newAssets[type] = Object.values(assetsMap[type])`（`useAssetData.ts:85`） |
| `StoryDocument.scenes`（无章节场景） | 流程图布局与本地化行序 | `sceneFlowModel.ts:113`、`localizationModel.ts:69` |

键全是 UUID，所以排序 = 随机重排。**这条不解决就上规范化，第一次 normalize-on-open 会当着
作者的面打乱他的变量表和资产列表，看起来就是 Studio 把工程搞坏了。**

三条路：

| 方案 | 代价 | 问题 |
|---|---|---|
| **(a) 加显式顺序数组**（推荐） | 4 个格式各一次 schema 迁移 | 工作量最大 |
| (b) 读取处改为确定性排序（按名/按时间） | 小 | **作者失去手动排序能力**，是产品倒退 |
| (c) 这四个格式豁免键排序 | 最小 | 内容最大的四个文档恰恰不确定，diff 噪声全落在它们身上 |

**推荐 (a)**，理由不只是版本控制：这四个格式**今天就已经**在依赖一个 JS 只是碰巧给的保证——
对象键序是插入序，任何一次 `{...spread}` 重建、`map`/`filter` 回填都会改变它，与 VCS 无关。
仓库里 `rootBlockIds` / `childrenIds` 已经是这么做的，有现成先例。

> **已拍板（2026-07-27）：走 (a)，schema 可以迁移。**

拍板后再勘验，发现**"四次迁移"并不成立**——顺序信息有一半本来就在结构里：

| 格式 | 既有承载 | 结论 |
|---|---|---|
| `StoryScene.blocks` | `rootBlockIds` + 块的 `parentId`/`childrenIds` 构成树 | **不需要迁移**，深度优先走既有结构即可 |
| `StoryDocument.scenes`（无章节） | `chapters[].sceneIds` 只覆盖有章节的场景 | 需要承载 |
| `Blueprint...graphs.events` | 无 | 需要迁移（bp v9→v10），且 `graphs.functions` 有**同一个**缺陷——`functionIds[0]` 决定没有事件层时默认打开哪张图 |
| `AssetsMap` / `AssetGroupMap` | 无 | 需要承载；且实测**资产顺序是导入序不是作者排的**（UI 里没有任何重排手势） |

**资产这一条的落地形态是被推翻过一次的裁决**：第一版把分片改成了信封结构
（`{assets: {...}, assetIds: [...]}`），代价是**旧版 Studio 打开迁移过的工程会看到空资产库**。
这不是不可避免的——已发货的加载器 `assignValidAssets` 对校验失败的条目只是警告并跳过，其余资产
照常保留；空库纯粹是因为信封把资产**下移了一层**，旧读取器只看见一个叫 `assets` 的条目并合理地
拒绝了它。所以改为**独立顺序文件**：内容分片字节形态不变，顺序放同级的另一个文档。
前向兼容变成完全的，主进程那三个读取点一行都不用改。

一个空的资产库是 Studio 能显示给作者的最惊悚的东西，而危险不在显示，在于作者接下来会做什么
（重新导入一遍，或者认定工程坏了）。为一个**本来就不是作者排的**顺序付这个代价不成比例。

而且第一条顺带暴露一个**已经存在的 bug**：`listSceneDeclarationBlocks` 的注释写着 "in document
order"，实现却是 `Object.values(scene.blocks)`，拿的是**插入序**。在场景中间插入的块，变量表里
会跑到末尾。与版本控制无关，今天就是错的。

**迁移的硬约束**：迁移必须在**同一次 parse 里**从对象键序推出顺序数组。`JSON.parse` 对非整数样式
的键保留插入序，所以今天的键序**就是**作者的顺序——但只到下一次改写为止。顺序数组一旦晚于任何
一次规范化写入才填，作者的顺序就已经没了，之后再怎么修都找不回来。

### 3.3.1 H2b 开工前已知的地雷

- **`Asset.ext` 在内存里可以是 `undefined`。** `JSON.stringify` 静默丢弃它，
  `encodeCanonicalJson` 会**抛错**（这正是它存在的理由——静默丢字段就是静默丢数据）。资产分片
  接规范化写入之前，`ext` 必须是「删掉这个键」而不是「赋值 undefined」。同类写法在别处大概率
  也有，H2b 第一步应该先扫一遍。
- **搜索与引用的结果顺序**（`searchIndexModel.ts:263`、`referenceModel.ts:251`）取自
  `Object.entries(graphs.events)`，规范化后会变成 UUID 序。属于结果排序而非作者内容，不拦 H2b，
  但届时应该给它一个显式排序而不是继续依赖记录顺序。

### 3.4 迁移路径

8 个服务逐个接入，每个都是「读走 `parse`、写走 `serialize`」的窄改动 + 一个往返测试。
接入完成后做一次**全项目规范化**：打开项目时若检测到非规范字节，重写一遍（在建仓库之前
做，这样第一个提交就是规范形态，而不是第二个提交里冒出一个全文件 diff）。

§3.3 的四个格式**排在这一步之前**——顺序问题没解决，规范化就不能对它们跑。

---

## 4. V1–V5 — 版本控制本体

### 4.1 V1 仓库与工作集

- `repository.ts`：`init`（`repositoryCreate` + 写入忽略策略 + 首次全量 stage + 初始提交）、
  `status`（映射 `repositoryStatus`）、`release`。
- **仓库来源的产品决策**（[§10](../version-control.md) 的未决项）在此定死：
  **不自动建库**。项目设置里一个显式「启用版本控制」入口，以及新建项目向导里一个勾选项。
  理由：建库会在项目根写 `.lore/`（含独占锁），必须是作者的决定。
- `workingSet.ts`：什么进库。**默认全收，排除下列**：

  | 排除 | 原因 |
  |---|---|
  | `.lore/` | 仓库自身 |
  | `.nlstudio/` | 本机缓存与插件安装 |
  | `editor/cache/` | 缩略图等派生物 |
  | `editor/assets/remote/` | 远端资产缓存 |
  | `dist/`、`node_modules/`、`.git/` | 构建与外部工具 |
  | `ATOMIC_WRITE_TEMP_PATTERN` 命中的临时文件 | 原子写的 scratch 文件，[fs.ts](../../src/shared/utils/fs.ts) 已有该常量 |

  `resources/icons/derived/`（烘焙图标）**收**——它是工程内容不是缓存，这条已有先例。

  实现走 Lore 自己的 `.loreignore`（能力与实测语义见 [version-control.md §2.4](../version-control.md)），
  谓词与忽略文件由同一张表生成，我们这侧不可能漂移。

  > **已知缺口（V1 尾巴或 V2 一并解决）**：`.loreignore` 进版本库、随 clone 传播、且用户可编辑，
  > 而 Studio 的谓词是编译进程序的。作者手改一行，或者未来 Studio 改了策略而老仓库还留着旧文件，
  > 两边就静默分歧——而这正是 `workingSet.ts` 自己称为「本里程碑最坏故障」的那一种：Studio 显示
  > 文件受保护，每次提交都悄悄漏掉它，等作者要取回来时才发现。
  > **对策**：打开仓库时把磁盘上的忽略文件与编译进来的策略比对，不一致就报告（不要静默改写作者
  > 的文件）。约二十行加一个测试。

### 4.2 V2 提交与检查点

提交顺序是硬的，写错就丢数据：

```
flushPendingSaves()      # 渲染进程 8 个 autosaver 全部落盘（已有实现）
  → fileStage(变更路径)   # PATH_IGNORE 必须转异常
  → revisionCommit(消息)
  → repositoryFlush()     # 不 flush 会丢提交，且是竞态（§4.11 实测）
  → 报告成功
```

**检查点 vs 提交**：都是 Lore 的普通 revision，靠 `revisionMetadataSet` 打
`narraleaf.kind = checkpoint | commit` 区分。历史界面默认折叠检查点。

- 不用独立分支：分支切换会动工作树，检查点绝不该动作者的文件。
- 间隔设置：`versionControl.checkpointIntervalMinutes`（默认 15，0 = 关）。
- 定时器只在**有实际变更**时开火，无变更不产生空提交。
- 另外三个无条件检查点：关闭项目前、构建前、恢复前。

**身份**：Lore 的 `identity` 是 global 参数。单机取设置里的作者名；接入认证后取登录身份。

### 4.3 V3 历史与语义 diff

- 历史：`revisionHistory` + 已实现的 DAG 读取；`revisionMetadataGet` 补 kind 标记。
- 变更清单：`getChangedPaths(from, to)` 先筛，**不要遍历整棵树**。
- 语义 diff：`路径 → DocumentSpec` 反查 → 两侧 blob 各自 `parse` → `spec.diff` 产出
  `DocumentChange[]`（「场景『序章』新增 3 行对白」「角色 Alice 的差分 angry 换图」）。
  二进制资产不做内容 diff，只报增/删/改 + 大小 + 缩略图。

### 4.4 V4 恢复

- 默认**只读浏览**：任意修订的文档可读、可预览、可 diff，不动工作树。
- 「恢复到此版本」= 把该修订的内容写进工作树 → **产生一个新提交**，历史不回退。
- 单文档恢复同理，只写一个文档。
- 工作树被写之后必须通知渲染进程重载：新增 `vcs:working-tree-changed` 事件，
  受影响的服务丢弃内存态重读。**这条不做，编辑器会用旧内存把恢复的内容再写回去。**

### 4.5 V5 协作

- 远端配置：仓库 URL 存在 `.lore/config.toml`（Lore 自己管），Studio 侧只存展示名与最近同步时间。
- 动作：`clone` / `push`（`branch_push`）/ `sync`（`revision_sync`）/ 分支列表与切换 /
  `branch_merge_into` + `merge_start` / `merge_resolve` / `merge_abort`。
- 冲突：Lore 报冲突文件清单，**解决逻辑是 Studio 自己的**——三路 base 已实现
  （`mergeBase`，Lore 无此 API），文档级三路合并由 `DocumentSpec` 提供。
  `base` 缺失表示 add/add，**不能当空文件**。
- 认证现实：loreserver 开箱**不校验任何身份**（`[server.auth]` 缺失 = 谁连上谁能读写）。
  局域网可接受，公网必须有签发 JWT 的 sidecar（**NarraLeaf Hub**，另开卡）。
  Studio 侧先接 `auth_login_with_token`，把这条路留通。

### 4.6 V6 渲染进程框架（本卡只搭架子，不做界面）

- `VersionControlService`（workspace service）：可用性、仓库状态、历史缓存、
  提交/恢复命令、变更订阅。**先问 `getAvailability()`**，不可用就整个入口不存在。
- IPC 扩写：`initRepository` / `getStatus` / `commit` / `listBranches` / `createBranch` /
  `switchBranch` / `restore` / `diffDocuments` / `push` / `sync` + 进度事件。
- 长操作（clone / push / sync）必须可取消、有进度：Lore 的进度事件是每 fragment 一个，
  **穿 koffi 进 V8 有 jank 风险**，在绑定层做节流后再上 IPC。

---

## 5. 里程碑与顺序

| # | 里程碑 | 依赖 | 产出 |
|---|---|---|---|
| **V0** | 重写 Lore 绑定 | — | `vcs/lore/`、ABI 校验脚本、真库测试；旧 `loreClient.ts` 删除 |
| **H1** | 文档模型与规范序列化 | — | `shared/documents/`、`canonicalJson`、隔离机制 |
| **H2** | 8 个服务接入文档模型 | H1 | 各服务读写走 spec + 往返测试 + 全项目规范化 |
| **V1** | 仓库与工作集 | V0 | init/status/忽略策略；「启用版本控制」入口 |
| **V2** | 提交与检查点 | V1, H2 | 提交管线、检查点策略与设置项 |
| **V6a** | 渲染框架（无界面） | V2 | `VersionControlService` + IPC + 类型 |
| **V3** | 历史与语义 diff | V2, H2 | diff 引擎 + `DocumentSpec.diff` |
| **V4** | 恢复 | V3 | 恢复为新提交、单文档恢复、工作树变更事件 |
| **V5** | 协作 | V4 | clone/push/sync/分支/合并/冲突解决；认证接口 |

V0 与 H1 可并行（互不依赖）。V0 先动，因为它是唯一会推翻既有代码的一步。

---

## 6. 风险与未决

| 风险 | 处置 |
|---|---|
| 手写 ABI 布局写错 → 内存损坏 | §2.4 三道防线；先落校验脚本再落绑定 |
| Lore 0.x 升级破坏协议 | 锁死版本；ABI 校验脚本即升级 diff 报告 |
| 独占且**阻塞**的仓库锁 | session 按项目 keying + 窗口关闭释放（已有）；检查点不得在后台长时间持锁 |
| 规范化重写 = 一次全项目大 diff | 在建库**之前**做，让第一个提交就是规范形态 |
| 恢复后编辑器用旧内存覆盖 | `vcs:working-tree-changed` 事件是 V4 的验收项，不是可选项 |
| 二进制资产并发编辑 | Lore 的文件锁目前是「告知」不是强制，强制锁在上游 roadmap；先只做告知 |
| criss-cross merge base | 现取 `revisionNumber` 最高的共同祖先，降级后果是多看到几个冲突，不是错误合并 |
| 公网协作的认证 | loreserver 裸跑不校验身份；公网必须等 Hub sidecar，文档要写死这条 |

未决（不在本卡内解决，但要留出位置）：

- **NarraLeaf Hub**（JWT 签发 + JWKS + 项目发现）另开卡，本卡只保证 `auth_*` 接口通。
- **Intel Mac / Windows ARM64** 仍无官方构建，能力降级路径已实现且实测过，本卡不改。
- **大文件与仓库体积**：Lore 的本地 store 是 LRU + 预算上限，长期项目的体积策略未评估。
