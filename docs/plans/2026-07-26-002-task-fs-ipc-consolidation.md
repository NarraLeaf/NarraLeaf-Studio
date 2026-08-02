---
title: "task: 主进程 fs IPC 收敛 —— 加性 fileName、单一切分工厂、递归求大小、删死 API"
type: handoff
status: draft
date: 2026-07-26
parent: 2026-07-24-005-task-m6-asset-overview.md
---

# task: 主进程 fs IPC 收敛

你是执行者。这张卡把一个**有损契约**收干净，并顺手解决资源总览的规模问题。它的起因是一个真实缺陷：资源总览把带扩展名的文件全部算成 0 字节，因为 `fs.list` 返回的 `name` 去掉了扩展名、扩展名单独放在 `ext` 里，而调用方直接拿 `name` 拼路径。修那个 bug 时发现全仓只有两处正确重组过。

前置阅读：`docs/plans/reports/2026-07-24-m6-report.md`；`docs/plans/2026-07-24-005-task-m6-asset-overview.md`（§WI-1 与"打包只做预测"的裁决）；M3 卡 `2026-07-23-001` §0 纪律与 §1 风格铁律**原样适用**。

分支：从 develop（`15466bb`+）切 `feat/fs-ipc-consolidation`。报告：`docs/plans/reports/2026-07-26-fs-ipc-report.md`（≤50 行）。

**共享检出铁律**：逐文件 `git add <path>`；禁 `git add -A`/`.`；禁 `git stash`；**每次提交前 `git branch --show-current`**；**禁止 `git worktree remove`**。

**并行提示**：另有两张卡同时在跑（`2026-07-26-001` Dev Mode 保真度、`2026-07-26-003` A4+斜杠面）。你独占 `src/main/**` 的 fs 相关面与 `packages/plugin-types`；**不要**碰 `storyStageSnapshot.ts`、Dev Mode 面板、`commands/specs/**`。

## WI-1 加性 `fileName` + 单一切分工厂

现状与裁决（已定，不再讨论）：**不重定义 `name`**。把 `name` 改成完整文件名虽然更像 node 的 `Dirent`，但是**反向静默破坏**——`nlproj.ts` 的旧版探测按 `name === "project" && ext === ".json"` 匹配会突然失配，三处重组会变成 `logo.png.png`，而且 `app.privileged.fs.list` 是**插件公开面**，消费方在 `NarraLeaf/Plugins` 仓里，你管不到。

做法：

- 在 fs.list 的条目上**加性**增加 `fileName`（完整文件名）。旧字段语义一字不改。
- 新建 `splitFileEntry(fileName)` 工厂放进 `@shared/utils/fileEntry`（`entryFileName` 已在那里），让 **`FsListHandler`（`src/main/app/application/managers/window/handlers/fsAction.ts`）与 `privilegedAction.ts` 的 `list` 分支都经它构造条目**——这两处目前是同一份切分逻辑的重复副本，正是"两个真相源"的来源。
- 既有的重组调用点（`entryFileName` 的消费者）可以改用 `fileName`，但**不是必须**：本 WI 的价值在于让下一个调用者无法写错，不在于把现有正确代码重排。改与不改都请在报告里说明取舍。

## WI-2 删 `Fs.listFiles`

`src/shared/utils/fs.ts` ~:168 的 `Fs.listFiles` **零消费者**，且带着第三种约定（`""` 而不是 `null`）。它不是死代码，是上了膛的陷阱——下一个调用者会照它的形状写，然后重演这次的静默错数。删掉。若删除时发现其实有消费者，停下报告（说明我的核实过时了）。

## WI-3 递归求大小的 IPC（资源总览的规模问题）

资源总览现在**每个文件一次 IPC**（`fs.list` + 逐个 `fs.details`）。万级资产项目就是万次往返，页面转圈数秒并与编辑器争抢通道。

- 在主进程加一个**递归目录求大小**的 IPC（返回总字节 + 文件数，必要时按类型/子目录分组——按总览页实际需要来定，不要过度设计）。
- **关键要求：与构建自己的口径共用一份实现。** `GameBuildManager.ts` 的 `directorySize` 是构建侧的权威；M6 复核已经发现总览的遍历与它在**符号链接**处理上分歧（`directorySize` 用 `Dirent.isFile()`，符号链接算 0 且不递归；总览侧走 `fs.stat` 会跟随）。**让两个调用方共用一个函数**，而不是让新 IPC 再模仿一遍——否则"实际"这个数字与构建的真实行为还会再次分家，而资源总览 v2 的裁剪决策就建立在这个数字上。
- 总览页改用新 IPC，删掉逐文件遍历。**页面语义不变**：仍然只读、仍然"实际 / 若裁剪 / 差额"（`If trimmed`，绝不暗示裁剪已生效）。
- 报告里给出改造前后的加载耗时对比（哪怕只是你手上项目的粗略数字）。

## WI-4 重新生成插件类型包

`app.privileged.fs.list` 的返回形状加性变化后，插件作者拿到的 `.d.ts` 不更新，这个新字段对他们等于不存在。重新生成 `packages/plugin-types`（构建脚本 `packages/plugin-types/build.mjs`；注意历史教训：**两个 surface 必须共享同一个 bundle**，否则跨 entry 的节点共享会坏）。版本号按仓内惯例处理，**不要 publish**（发布是用户的事）。

## 明确不做

打包行为变更、资源总览 v2 的引用裁剪与 per-asset override（仍是 v2，本卡只解决规模）；重定义 `name`；插件包 publish。

## 验证与停机

`yarn lint` 全绿；vitest 新失败 0（win32 基线 3 条）。测试要求：`splitFileEntry` 与 `entryFileName` 的 round-trip（含多点名、dotfile、无扩展名、结尾点这些能击穿只取词干的实现的用例——M6 那次的 fake 就是因为形状与真实契约相反而给 bug 背书，别重演）；新 IPC 与 `directorySize` 在同一目录上给出**同一个数字**的测试。

真机：在资源总览页上确认数字与改造前一致（除符号链接场景下的口径统一）、加载明显变快；打开一个装了插件的项目确认插件仍正常加载（类型包重生成不影响运行时，但确认一次）。

停机：`directorySize` 与新 IPC 无法共用实现（说明架构上有真障碍，报告实例）；`Fs.listFiles` 其实有消费者；插件类型包重生成需要改动 build 脚本的结构（超出本卡，报告）。
