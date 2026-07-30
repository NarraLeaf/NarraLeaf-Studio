---
title: "handoff: 轨道的四个接缝都填上了，交接恢复与 diff"
type: handoff
status: ready
date: 2026-07-30
plan: 2026-07-28-002-plan-vcs-ui-frozen-workspace.md
branch: feat/vcs-documents-and-repository
worktree: D:/Temp/nls-vcs
---

**界面第二轮完工并合入 develop**（`88b00e82`）。轨道里那四个接缝——提交表单、逐文件变更清单、
历史翻页、状态栏那一位——全部填上，三件待裁决的也都拍板了（[计划 §6.1](2026-07-28-002-plan-vcs-ui-frozen-workspace.md)）。

先读[计划](2026-07-28-002-plan-vcs-ui-frozen-workspace.md)（**§4.5 是这一轮的全部结论**）与
[docs/version-control.md](../version-control.md)（唯一技术事实源，§4 的 22 条坑仍然全部成立）。
本文只讲交接。

---

## 一、这一轮做了什么

| | 内容 |
|---|---|
| **提交表单** | 轨道里的 `commit-form`。**在此之前，作者在整个 Studio 里没有任何办法提交**——V2 的机制全在，就是没有入口 |
| **逐文件变更清单** | 汇总行下的文件列表，50 行上限并明说漏了多少；提交表单**移到清单上方** |
| **历史翻页** | 「显示更早的版本」；主进程按 revision 缓存修订元数据，重读不重复付费 |
| **分支名** | 非默认分支时三处界面统一显示 `feature · #12`；`getInfo` 变成一次纯读 |
| **两个真缺陷** | 提交后状态栏停在旧编号；`notVersioned` 被截断成 "No version hist…" |
| **`.nlspkg` 导出** | 排除 `.lore/` 与 `.nlstudio/services` |

全量 **3940 通过**，失败是 win32 基线的 **5 个测试 / 4 个文件**
（`GameBuildManager`、`mobileSigningIdentity`、`storageManager`、`runtimeProtocol`）。五个 tsc 项目干净。

## 二、下一步（2026-07-30 更新：顶栏收编与 V4 整工程恢复已完工）

同日又落了两件：

- **顶栏的版本控件收进项目切换器的菜单**（develop `c045a085`）。顶栏原来把版本说了两遍——一次在
  自己的控件里，一次在状态栏。切换器的脸只说项目，版本那一段在菜单里，`ProjectSwitcher` 收
  `versionSurface` 作为 prop（**不许自己 new 一个**）。
- **V4 的整工程恢复**（develop `c338012c`）。恢复=新提交、绝不倒退；动手前打检查点、打不出来就中止；
  素材字节一起恢复；删除只认 `isVersioned`、逐个文件、模块里没有任何 `recursive: true`；
  **离开视图的闸门落在 `WorkspaceFreezeService.holdRelease()`，不落在按钮上**。

剩下的是 **V4 的单文档恢复**、**V3 语义 diff**、**V5 协作**，另外「启用版本控制」仍**只在轨道与
切换器菜单里**，进项目设置与新建向导那条（U2 的后半）没做。

**单文档恢复之前**：它需要一个「某个修订里有哪些文件」的清单，而现在的变更清单描述的是**工作树**，
不是修订。那份清单正是 V3 也要的东西，所以这两件事大概率一起做。逐文件行**现在是不可点的**，正是
因为点开什么都没有。

**改恢复这块之前**：`revisionRestore.ts` 的文件头注释是这块的全部论证（删除为什么这么窄、为什么
没有递归删、为什么修订路径是不可信输入、为什么素材要跟着恢复而快照不用）。删除那半边能静默毁数据，
读它比读 diff 快。

## 三、会咬你的（前四条是老的，仍然成立；后四条是这轮新的）

1. **不许轮询。** `repositoryStatus(scan)` 不是纯读（§4.17）。变更数只能在明确时机刷新。
2. **进出修订视图各有一个必须关掉的窗口**：进——先冻结再读；出——先撤 source 再撤闸门。
3. **`revisionMetadataSet` 写的是暂存修订**，没东西暂存时会贴到**下一次**提交上（§4.21）。
4. **冻结的正确性在写边界，affordance 是另一回事。** 少禁一个按钮是体验缺陷，把闸门挪进组件是
   数据丢失。
5. **三个版本界面各读各的 head，这是有意的**（状态栏那一位不在轨道的树里）。所以**任何产生修订的
   新路径都必须让 `afterRevision()` 跑到**，否则界面之间会当场矛盾——这轮真的发生了，轨道 `#3`
   旁边状态栏 `#2`。事件是 `VersionControlService.onRevisionRecorded`。
6. **「还有更多历史吗」永远看原始条目数，不看行数。** 压平丢掉被合并分支的修订，折叠藏掉检查点，
   两者叠加能让读满的一页只画出三行。按行数判断会告诉一个工程「到底了」而其实还有几百条。
7. **`VcsSession.details` 只缓存修订明细，绝不缓存图。** 新提交改变图，改不了一个已存在修订记录
   过的东西——这就是能缓存与不能缓存的分界线。
8. **`getInfo` 现在是一次纯读，别让它退回去。** 它曾经为一个无人读取的 `revisionCount` 走整棵
   修订图；状态栏能便宜地问到分支名，靠的就是这件事被删掉。

## 四、验收（用户的铁令：你亲眼看，子代理报告不算）

配方与四条陷阱在 [tools/ui-verify/README.md](../../tools/ui-verify/README.md)，**动手前读它**。
这轮又踩到了第一条：源码改完六秒后 dev server 还没重建，bundle 比源码**旧 7 秒**。
`ls -l dist/windows/workspace/index.js` 对一眼比什么都便宜；改了主进程要 `build-main.js --dev`
并重启实例。

**`location.reload()` 在 workspace 窗口上会把它弄没**（两次都是），launcher 上没事。要刷新就从
launcher 重开工程。

**强制看到默认分支之外的形态**：Studio 里建不出分支，所以把 `VCS_DEFAULT_BRANCH` 临时改成别的值、
重建 apps、看一眼、再改回来。这条比想办法造一个真分支便宜得多。

## 五、夹具的当前状态（与上一轮交接不同了）

| | |
|---|---|
| `D:/Temp/nls-vcs-proj-withhistory` | **61 个修订**（原本 2 个），够触发翻页；工作树里留着两条待提交的变更 |
| `D:/Temp/nls-vcs-proj` | 干净、无版本控制。**没动过**，仍然是「未启用」那条路的夹具 |
| `D:/Temp/nls-vcs-proj-commit` | 原始两修订夹具的副本，本轮开工前拷的 |

## 六、已知缺口（老的仍在，加一条新的）

- **Cmd+Q 跳过「关闭项目前的检查点」**；**修订视图与 Dev Mode 快照里资产字节是当下的**；
  **插件的读路径没有改道**；**停靠求解器右栏的先存在的洞**——四条都在计划 §4.2.2 / §4.3。
- **新增：`getInfo` 不进缓存**，所以每个 `useVersionSurface` 实例在挂载时和每次记录修订后各多一次
  IPC 往返。两者都是纯读、都不在定时器上，接受。要缓存的话得先想清楚提交如何让它失效。
- **48px 折叠条不显示分支名**：`writing-mode: vertical-rl` 里塞一个分支名在 48px 内不可读。

## 七、环境

| | |
|---|---|
| worktree | `D:/Temp/nls-vcs`（分支 `feat/vcs-documents-and-repository`，已并入 develop，树干净） |
| **worktree 里 `yarn` 跑不了** | 用 `node node_modules/typescript/bin/tsc --project src/<p>/tsconfig.json` 逐个跑五个项目，`node node_modules/vitest/vitest.mjs run` 跑测试 |
| 端口 | 别用 9222/5588（别人的 session）。本轮用 9228 / 5613，起之前先确认空闲；停实例要 `NLS_DEV_RELOAD_PORT=5613 node project/app/stop-dev.js`，**不带这个环境变量它会去杀 5588 上别人的实例** |
| 主 checkout | 有别的 session 的未提交文件，别动、别在那儿切分支、绝不 stash。要在 develop 上合并推送时，从 `origin/develop` 拉一个临时 worktree |
