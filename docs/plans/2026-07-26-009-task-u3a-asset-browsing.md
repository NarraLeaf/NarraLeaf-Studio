---
title: "task: U3a 资产浏览层 — 真缩略图、搜索筛选、总览并入"
type: task
status: queued
date: 2026-07-26
plan: 2026-07-26-004-plan-ui-professionalization.md
branch: feat/ui-u3a-asset-browsing
---

# task: U3a 资产浏览层

总计划 `2026-07-26-004` §U3a。用户裁决"资产管理器做完整版"，拆成 U3a 浏览层 / U3b 管理层；
本卡是 U3a，**只解决"看不见图"，不碰资产写路径**。

> **状态 queued**：与 U1 触碰区不交叉，但共享同一个检出，两张卡并行会互相 `git checkout`。
> 由 orchestrator 在 U1 落地后（或备好独立 worktree 后）再发。

## 0. 分支与纪律

- 从当时的 `develop` 切 `feat/ui-u3a-asset-browsing`。
- 逐文件 `git add`，**禁止 `git add -A`**。每个 WI 完成即 commit。不合并、不 push。
- 禁止 `git worktree remove`、禁止 `git stash`。

## 1. 风格铁律

- 复用既有组件。**UI 里不要解释性文本**——现存的 `No videos yet` / `No json files yet` 正是要删的东西。
- 不新增依赖、不引入新配色。

## 2. 为什么这张卡存在（实测）

orchestrator 在真机上量过 demo3（22 个资产，其中 20 张图片）：

- 侧栏 **List view**：纯文件名树，零缩略图，每个文件一个通用图片图标。
- 侧栏 **Icon view**：**同样零缩略图**。表头写 `Images / 0 assets`（**计数错误**——20 张图都在分组里，
  没有计入）；`Character` / `UI` 分组渲染成两张**空白大卡片**只写 "3 items"/"6 items"；
  音频资产显示一个音符占位符；`Videos 0 assets / No videos yet`、`JSON Files 0 assets / No json files yet`。
  **也就是说：图标视图里一张图标都没有。**
- **资源总览**：6 块巨型数字砖 + 2 条进度条 + 3 个纯文本列表，`Largest` 列表**零缩略图**——
  一个资产页列出最大的图片却不显示图片。`22 items · 73.8 MB` 在 tab 头与 Library Total **重复两次**。
  页面被压在 350px 侧栏与 600px **恒空**的 Properties 面板之间，只剩 ~690px。

## 3. 工作项

### WI-1 真缩略图

- Icon view 必须显示**真实缩略图**：图像直出；视频首帧、音频波形可以后置，但要成体系——
  **不许用通用文件图标冒充缩略图**。
- 修正表头计数（`Images / 0 assets` → 含分组内资产的真实数量）。
- 复用既有的缩略图/objectURL 缓存（`storyBadgeImageCache` 的 retain/release 范式），
  **不要再造一套缓存**；大量资产下必须有 refcount 与失效，不得泄漏 objectURL。

### WI-2 分组卡片有内容

- `Character` / `UI` 这类分组不再是空白卡片：显示前 N 张缩略图（堆叠或小网格）。
- 空分组不写句子，给一个可执行入口（复用既有 Import / New Group 按钮范式）。

### WI-3 搜索与筛选

- 按类型、是否被引用、大小、标签筛选；**搜索命中要能跨分组**（现在分组默认折叠，
  搜到的东西如果还藏在折叠分组里等于没搜到）。
- 复用既有 `Filters` 控件，不新造筛选栏。

### WI-4 总览并入

- 资源总览从独立 tab 降级为资产管理器的一个**视图**；`AssetOverviewCommand` 的独立入口退役。
- 6 块数字砖压到**一行**；`Largest` / `Unreferenced` 列表**带缩略图**。
- 消灭重复计数（同一个数字不得在一屏里出现两次）。

### WI-5 详情面板去内部词汇

- 分片路径 `content/35/f4/5bbaf…` 与裸 hash 不再直接示人（可折叠 / 可复制即可，不写解释句）。

## 4. 明确不做（这些是 U3b）

- 就地重命名、删除、移动分组、批量操作、替换资产内容、标签增删改、导入队列。
- **任何写资产的路径**。本卡是只读浏览层。
- 不动故事编辑器（U1）、Dev Mode（U4）、检查器（U2）。

## 5. 判据（orchestrator 亲验）

1. 打开 Icon view 截图：**每个图像资产都能看见自己的内容**；表头计数与实际一致。
2. `Character` / `UI` 分组卡片上能看到缩略图，不是空白。
3. 搜 `nattou` 能跨分组命中（含默认折叠的分组）。
4. 总览首屏能看到**资产本身**而不只是数字；`Largest` 每行带缩略图；无重复计数。
5. 全 app 搜不到 `No videos yet` / `No json files yet` 这类句子。
6. 打开 20+ 资产的项目滚动无卡顿，objectURL 无泄漏（反复切视图后计数稳定）。

## 6. 自验

`yarn lint` 绿；vitest 相关范围新失败为零；`yarn build:apps:dev` 绿；
用 `tools/ui-verify/drive.js` 自己走一遍。**你的截图不构成验收。**

## 7. 报告

`docs/plans/reports/2026-07-26-U3a-report.md`，**≤45 行**。

## 8. 何时必须停下来报告

- 缩略图生成需要主进程新 IPC（规模超出本卡）。
- 总览并入会破坏既有的 searchJump 跳转契约。
- 触碰区有其他 session 的未提交改动。
