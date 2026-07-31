---
title: "handoff: 版本控制的机制部分全部落地，交接界面的第二轮"
type: handoff
status: ready
date: 2026-07-29
plan: 2026-07-28-002-plan-vcs-ui-frozen-workspace.md
branch: feat/vcs-documents-and-repository
worktree: D:/Temp/nls-vcs
---

**机制部分已经全部落地并合入 develop（`985081c8`）**：冻结、解冻重载、显示某个修订、提交与检查点、
Dev Mode 跑聚焦版本、主进程的拒绝。**界面的第一轮也落了**：版本轨道、顶栏控件、状态栏位。

你接手的是**界面的第二轮**：轨道里那些还是接缝的东西。

先读 [计划](2026-07-28-002-plan-vcs-ui-frozen-workspace.md)（形态、裁决、每个里程碑的实测结论）与
[docs/version-control.md](../version-control.md)（唯一技术事实源，**§4 现在有 22 条坑，全部实测**）。
本文只讲交接。

---

## 一、已落地（都在 develop 上）

| | 内容 |
|---|---|
| **V6a** | `VersionControlService` + IPC + 类型 |
| **U1a / U1a′** | 冻结的写边界（闸门在 `createBoundPrivilegedFacade` + `BaseFileSystemService`，判据 `isVersioned`）；Studio 状态搬出版本库 |
| **U1b** | 顶栏与编辑区的只读 affordance（`freezeGuard.ts` + `readOnlyInteraction.ts`） |
| **U1c** | 解冻重载（`WorkspaceReloadService`，参与者静态表） |
| **U1d** | 工作区能显示某个修订（`DocumentSource` 端口 + 读边界闸门） |
| **V2** | 提交与检查点（检查点由 `observeWrites` 驱动，**绝不扫描**） |
| **U4** | Dev Mode 跑聚焦版本（快照落在 `.nlstudio/`，不进工作集） |
| **UI-1** | 版本轨道（最左、可折叠）、顶栏控件、状态栏位、提交信息/时间/人员 |

全量测试 **3849 通过**，失败是 win32 基线的 **5 个测试 / 4 个文件**
（`GameBuildManager`、`mobileSigningIdentity`、`storageManager`、`runtimeProtocol`）。五个 tsc 项目干净。

## 二、你的活：轨道里的接缝

都在 `components/layout/VersionRail.tsx`，按名字找得到：

| 接缝 | 内容 |
|---|---|
| `data-vcs-seam="commit-form"` | **故意空着**：一个点不动的 Commit 按钮正是 `freezeGuard` 的规则禁止的东西 |
| `data-vcs-seam="change-list"` | 汇总行与刷新是真的，逐文件清单要接上去 |
| `VERSION_HISTORY_PAGE = 50` | 翻过第一页 |
| `versionStatusText()` | 状态栏那一位显示什么，复杂历史（分支、合并）下**尚未裁决** |

之后按计划是 **V4 恢复**（恢复产生新提交、单文档恢复）、**V3 语义 diff**、**V5 协作**，以及把
「启用版本控制」也放进项目设置与新建向导（现在只有轨道里那个按钮）。

## 三、会咬你的十条（前五条能毁数据，后五条只是让你白干）

1. **不许轮询。** `repositoryStatus(scan)` 不是纯读：扫到一个新目录会记进暂存状态，之后目录被删，整个
   session 都报成删除（§4.17）。变更数只能在明确时机刷新。
2. **`action: KEEP(0)` 是「已修改」**（§4.18）。映射在 `repository.ts` 做好了，别绕过去。
3. **状态里的路径是仓库相对，写侧要绝对**（§4.16）。两边都是 `string`，编译器不拦。
4. **`revisionMetadataSet` 写的是暂存修订**，而且没东西暂存时它不报错、会贴到**下一次**提交上（§4.21）。
5. **进出修订视图各有一个必须关掉的窗口**：进——先冻结再读；出——先撤 source 再撤闸门。顺序反了就是
   把历史写到工作树上（计划 §4.2.3 第 4 条）。
6. **`repositoryFlush` 会等满 store 的 keep-alive**（§4.22）。默认 10 秒时每次提交要 10 秒；现在是 1 秒。
7. **可用性先问**，不可用时整个入口不存在，三种 reason 对作者说不同的话。
8. **历史是 DAG 不是链**。`parents` 是数组，按第一父级压平只是展示，别让这个假设漏进数据层。
9. **轨道宽度必须在 `DockEnv` 里**，编辑器有 480px 硬地板。既有测试用的是**恒等式**（窗口加宽正好
   一个轨道宽度必须复现无轨道时的布局），别把它弱化成不等式——不等式分不清漏算和重复计算。
10. **冻结的正确性在写边界，affordance 是另一回事。** 界面上少禁一个按钮是体验缺陷；把闸门挪进组件
    是数据丢失。

## 四、验收（用户的铁令：你亲眼看，子代理报告不算）

配方与四条陷阱都写在 [tools/ui-verify/README.md](../../tools/ui-verify/README.md) 里，**动手前读它**。
其中最贵的一条：**先断言 `dist` 比最新的非测试源码新**——本轮两次差点用一个小时前的构建做验收，
成因是集成测试留下的 dev server 占着 reload 端口，启动器于是中止并留下旧实例继续答话。

**别自己写 CDP 驱动**：`tools/ui-verify/drive.js` 已经有分步拖拽、真鼠标事件、`Input.insertText`。
本轮我手搓了一套一模一样的才发现，白花了力气。

现成的验收夹具：`D:/Temp/nls-vcs-proj-withhistory` 是一个**带两个修订**的工程（`.lore/` 在里面），
`D:/Temp/nls-vcs-proj` 是干净副本（无版本控制）。两个状态都能直接进。

## 五、待用户裁决的三件

1. **轨道的展开状态跨会话持久化**——上一轮展开过，下次打开工程它自动展开着。按 dock 面板惯例合理，
   按「临时冻结态的控制权」这个定义又不该自动回来。已问，未答。
2. **`.nlspkg` 导出没有排除 `.nlstudio/services`**，所以面板布局仍会跟着导出包走。与改动前一致（不是
   回归），但既然它现在正式是 Studio 状态，要不要排除是个新问题。
3. **状态栏那一位在复杂历史下显示什么**（见 §2 的 `versionStatusText()`）。

## 六、已知缺口（都记在计划 §4.3 与 §4.2.2）

- **Cmd+Q 跳过「关闭项目前的检查点」**：退出那条路有 20 秒硬上限，而提交在大工程上没有上界。
- **修订视图与 Dev Mode 快照里，资产字节是当下的**，只有文档是历史的。要让资产也变成历史的，得把
  资产 URL 解析整条路由改成修订感知的——那是另一个里程碑。
- **停靠求解器一个先存在的洞**：`resolveDock` 解析右栏时不看左栏，把右栏拖过头会让编辑器落到 240 而
  不是 480。**与版本轨道无关**（带不带轨道完全一样），已钉测试。
- **U1b 未覆盖的 affordance 清单**在计划 §4.2.2：场景行的其余控件、`StoryFindBar` 的替换、
  `StorySceneActionInspector` 的自制编辑器、基于 `div` 的自制按钮（`fieldset` 只作用于表单控件）。
- **插件的读路径没有改道**：显示修订时插件读到的仍是工作树。

## 七、环境

| | |
|---|---|
| worktree | `D:/Temp/nls-vcs`（分支 `feat/vcs-documents-and-repository`，已并入 develop，树干净） |
| **worktree 里 `yarn` 跑不了** | `yarn.lock` 在 `.gitignore` 里、不进版本库。用 `node node_modules/typescript/bin/tsc --project src/<p>/tsconfig.json` 逐个跑五个项目，`node node_modules/vitest/vitest.mjs run` 跑测试 |
| 端口 | 别用 9222/5588（别人的 session）。本轮用过 9224/9226 与 5601/5607/5611；起之前先确认空闲 |
| 主 checkout | 有别的 session 的未提交文件，别动、别在那儿切分支、绝不 stash。要在 develop 上合并推送时，从 `origin/develop` 拉一个临时 worktree |
