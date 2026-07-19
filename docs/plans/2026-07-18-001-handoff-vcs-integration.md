---
title: "handoff: 版本控制主进程层已就绪，交接 Studio 内对接"
type: handoff
status: ready
date: 2026-07-18
---

版本控制的**主进程层已经完整落地并验证过**，渲染进程一侧一行都还没写。你的任务是 Studio 内的对接：历史视图、diff 视图、冲突解决界面。

先读 [docs/version-control.md](../version-control.md)——那是这条路线的唯一事实来源，尤其是 **§4 的 14 个坑**，每一条都是实测出来的，不是推测。本文只讲你直接需要的部分：能用什么、不许碰什么、以及哪些设计已经定死了。

底层是 [Epic Games Lore](https://github.com/EpicGames/lore) v0.8.5，**pre-stable 0.x**。选它的唯一理由：Studio 的资产是二进制和 JSON，Lore 的存储热路径不做 CRLF 转换、不做编码推断、没有 clean/smudge filter，且去重是 fragment 级。

---

## 一、五条不要重新谈判的规则

### 1. VCS 是可选能力，**先问 `getAvailability()` 再用**

Epic 不给 **Intel Mac** 和 **Windows ARM64** 出原生构建。Studio 仍然全平台分发，这个功能在那些机器上直接不可用。

```ts
const a = await window[RendererInterfaceKey].vcs.getAvailability();
if (!a.success || !a.data.available) {
    // 隐藏整个 VCS 入口。不要显示一个点了会报错的按钮。
    return;
}
```

**不要用 try/catch 去探测**。那样分不清「这台机器不支持」和「这个目录不是仓库」——用户看到的错误会完全误导。三种不可用有各自的 `reason`：

| reason | 含义 | 该对用户说什么 |
|---|---|---|
| `unsupported-platform` | 这个 OS/arch 没有构建 | 「此平台暂不支持版本控制」 |
| `backend-missing` | 平台支持但没装上 | 「安装不完整，请重装」 |
| `backend-load-failed` | 装了但加载失败 | 「组件损坏，请重装」 |

**判定是进程级缓存的，不会变。** 查一次存起来即可，不用轮询——加载失败在 Node 里是永久的（§4.13）。

### 2. 不许在 `vcs/` 之外碰 `@lore-vcs/sdk`

连间接都不行。SDK 在**模块求值期**就调 `koffi.load()`，一句静态 import 就能让主进程在 Intel Mac 上**启动期崩溃**——不是丢功能，是整个 app 起不来。

插拔边界是 [`vcs/backend.ts`](../../src/main/app/application/managers/vcs/backend.ts)，唯一一个。渲染进程本来也够不着原生 FFI，走 IPC 就对了。

### 3. 每个调用都带 `projectPath`

Studio 是 one-project-one-window，VCS session 按项目路径 keying。**没有「当前项目」这个隐式概念**，别加。

叠加原因：Lore 的仓库锁是**独占且阻塞**的（§4.12）。单例不会产生数据竞争，会产生死等。

### 4. `base` 缺失 ≠ 空文件

`getThreeWay` 返回的 `base` 是 optional：

```ts
{ baseRevision?: string; base?: string; mine: string; theirs: string }  // 均 base64
```

`base` 为 `undefined` 表示**两边共同祖先里没有这个文件**——这是 add/add 冲突。当成空文件处理等于静默采纳了一边。必须当独立冲突类型呈现。

### 5. Lore 自带的 diff 对你没用

`fileDiff` 是行级文本 diff（`context_lines`、`ignore_whitespace`）。Studio 的资产是二进制和 JSON，**diff 逻辑由 Studio 自己写**，这是整条路线的前提。

有用的是 `getChangedPaths(from, to)`：它给你两个版本之间变了哪些文件。**先用它筛，再去读 blob**，不要遍历整棵树。

---

## 二、你能用的接口

`window[RendererInterfaceKey].vcs`，全部返回 `RequestStatus<T>`：

| 方法 | 返回 |
|---|---|
| `getAvailability()` | `{available}` / `{available:false, reason, detail}` |
| `isRepository(projectPath)` | `{isRepository}`；后端不可用时为 `false`，不抛 |
| `getInfo(projectPath)` | `{root, repositoryId, head?, revisionCount}` |
| `getHistory(projectPath, limit?)` | `{entries: [{revision, number, parents}]}` |
| `readBlob(projectPath, revision, path)` | `{contentBase64}` |
| `getChangedPaths(projectPath, from, to)` | `{paths}` |
| `getThreeWay(projectPath, mine, theirs, path)` | `{baseRevision?, base?, mine, theirs}` |
| `getMergeBase(projectPath, a, b)` | `{base?}` |

类型在 [`@shared/types/vcs`](../../src/shared/types/vcs.ts)。**里面没有一个 `Lore` 前缀，请保持**——底层是 0.x，随时可能要换。

几点契约：

- **blob 是 base64**，不是 Buffer。渲染进程自己 `atob` 或 `Uint8Array.from(atob(s), c => c.charCodeAt(0))`
- **`path` 是仓库相对路径**，绝对路径和 `../` 会被拒（已测）
- **`parents`**：`[0]` 是直接父，`[1]` 是 merge 的另一个父，根修订为空数组
- **`number`** 是仓库内单调递增，可以当廉价的拓扑序用

## 三、已经替你解决的（不要重做）

- **三路合并的 base**：Lore **没有** merge-base API。`mergeBase` 是从 `parent[2]` DAG 自己算的，已实现并测过
- **14 个 FFI 坑**全部封死在 `loreClient.ts` / `revisionReader.ts`。你看不到 hex/binary、看不到 `.clone()`、看不到 `LoreEventTag`
- **路径越界防护**、**`PATH_IGNORE` 转异常**（Lore 对仓库外路径返回成功且静默跳过）
- **store handle 复用 + 每项目串行化**
- **窗口关闭时释放 session**（否则独占锁会一直卡住用户的 `lore` CLI）

## 四、你会撞上的现实

### 首次 diff 可能要联网

Lore 的工作副本是稀疏的，历史版本的 fragment 大概率不在本地。封装层已经开了 `cache: true` / `localCache: true`，但**第一次读仍可能走网络**。

**UI 要有 loading 态**，不要假装是本地即时操作。理想做法：打开 diff 视图时先 `getChangedPaths` 拿清单，再批量预热 blob，然后纯本地渲染。

单机项目（没有远端）完全不涉及——所有 fragment 本来就在本地。

### 仓库还不存在

**Studio 目前没有任何地方创建 Lore 仓库。** `isRepository` 对一个普通项目目录返回 `false`，这是正确的。

「用户怎么把项目变成版本库」是**未决的产品决策**：向导里勾选？菜单命令？首次打开时询问？这个要先定，否则 UI 无处落地。

### 写侧故意不存在

没有 stage / commit / merge 的 IPC。这是刻意的：在 resolve UI 之前放出提交入口，等于让渲染进程在没有冲突处理的情况下写数据。

顺序应该是：**先做只读的历史 + diff 视图 → 再做冲突解决 → 最后才开写侧。**

真要加写侧时记住一条铁律（§4.11 实测）：**提交后不 `flush` 会丢 commit**。`revisionCommit` 返回了 hash、工作树看起来也对，但分支 tip 还在内存里，进程一退就没了。而且是竞态，间歇性丢数据。`flushRepository` 已经写好并接在 `closeProject` 上。

## 五、验证方式

主进程层有 17 个测试（`yarn vitest run src/main/app/application/managers/vcs/`），其中 11 个打真实原生库。

对接完成后请**在真实 app 里验证**，不要只跑单测——这套东西最危险的两个行为（flush 丢数据、独占锁）**单进程测试完全看不见**，都是驱动真实 app 才发现的。方法见 [[dev-app-cdp-drive]] 那条记忆，或直接 `yarn dev` + CDP 9222。

Windows 上 `yarn test` 有 **8 个既有失败**（5 个文件，file-mode 和路径分隔符问题），那是基线，不是你引入的。

## 六、延伸阅读

| 文档 | 内容 |
|---|---|
| [docs/version-control.md](../version-control.md) | **唯一事实来源**。架构、依赖、14 个坑、可插拔设计、服务端策略、版本策略 |
| §4 | 14 个实测坑。改 `vcs/` 之前必读 |
| §7 | 可插拔与降级，含 `LORE_LIB_PATH` 逃生舱 |
| §9 | 已落地文件清单 + 接口表 |
| §10 | 待解问题（本文第四节是它的子集） |

判断 Lore 某个能力是否存在，**以 `lore-capi/lore.h` 和 DLL 导出符号为准，不要信 TypeScript 类型**——SDK 导出了一批根本不存在的函数的类型（§4.10）。
