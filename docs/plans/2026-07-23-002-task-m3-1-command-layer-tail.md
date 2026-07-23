---
title: "task: M3.1 指令层收尾 — palette、组头站位、ghost 确认、复核 nits、变量注册表迁移（条件启动）"
type: handoff
status: draft
date: 2026-07-23
parent: 2026-07-23-001-task-m3-command-layer.md
---

# task: M3.1 指令层收尾

你是执行者。前置阅读：`2026-07-23-001-task-m3-command-layer.md`（§1 风格铁律、§0 纪律与子代理授权**原样适用**，不再复述）＋ bible `2026-07-19-001` §3（WI-4 用）＋ `docs/plans/reports/2026-07-23-M3-report.md`。分支：从 develop（`5e8d4cf`）切 `feat/story-m3-1-command-tail`。报告：`docs/plans/reports/2026-07-23-M3.1-report.md`（同模板 ≤60 行）。

**并行提示**：另一执行者同时在 narraleaf-react 仓做 M4 引擎批，与本卡零文件交集；共享树警告照旧（逐文件 add）。

## WI-0 复核 nits（先行，子代理友好）

1. **检查器陈旧 undo 闭包**（M3 复核发现，Tab.tsx ~:684-707 + controller ~:611-620）：面板回调闭包过期 `scene`——检查器开着时发生"不触发签名"的场景变更（如别的行 quickParam 点击、拖拽移动），下一次面板编辑会推入陈旧 undo 快照，一次 Ctrl+Z 静默回退两笔。修法方向：面板回调经 ref 取最新 scene（或桥发布带版本的回调），不要靠扩大签名门控硬扛；顺带把桥的逐键 `JSON.stringify` 门控换成廉价版本号比较。
2. **replace 模式草稿槽不受"离视关槽"保护**（controller ~:1188 只键 `beforeBlockId ?? afterBlockId`）：重开草稿行（anchor 为 null）时开过滤/折叠 → 隐形插入态。把 `replaceBlockId` 纳入同一关槽条件。
3. `ensureAssetInvalidationWired` 无退订（单项目单窗下安全）：留一行注释说明设计前提即可，不强行改。

## WI-1 声明 ghost 确认（bible §3.5 残项）

声明成功后清槽 + ghost 区短暂 `✓ var gold: number = 0`（随下一次输入消隐，不弹 toast）。落点：InsertRow ghost 区（`storyCommandGhost`），复用现有 ghost 渲染，不新增组件。

## WI-2 palette 升级（原 M3 卡 §4 WI-4，原文适用）

`/` 空态分类浏览（ACTION_COMMAND_CATEGORIES 色+图标分组，输入即过滤，复用 ActionCommandMenu/StoryActionCreatorPanel 渲染）；搜索域 = token+aliases+本地化 label+**拼音静态表**（生成脚本一次性、产物入库、零运行时依赖）；指令手册面板从 spec registry 派生（签名/别名/说明，挂现有帮助入口）。

## WI-3 组头站位下拉（原 M3 卡 §4 WI-5，原文适用）

分组头 hover-reveal 站位下拉（left/center/right）。读=扩展 `buildDialogueAppearances` 累积模式扫描该角色最近 enter/move 的 `at=`；写=改写该行 `at=`，无则组头上方插入 `/move <角色> at=<pos>`；全走 history。文档永远命令行，UI 只是声明式外壳（P3）。

## WI-4 变量注册表迁移（bible §3.1/3.2；**条件启动**）

- **启动门**：动手前 `git status` 检查你将触碰的区域（`src/main/**`、蓝图模块、`BlueprintDocument` 消费链 ~20+ 文件）是否有另一 session 的脏文件。**有 → 整个 WI-4 顺延（报告注明），不要部分启动。**
- 范围（bible 为准）：`VariableRegistryService`（项目级 persistent 注册表）；`BlueprintDocument.persistentVariables` 删除、全部消费者改读注册表（干净切换，无双读）；`StoryVariableRef` persistent 臂 `storageKey`→`variableId`（**schema v7→v8** 迁移，迁移时按 storageKey 建注册表条目、id 取 storageKey 保稳定）；`/persis` 不再依赖全局蓝图 owner。
- **裁决已定（不再讨论）**：persistent 严格校验维持（用户确认无"宿主注入未声明"模式）；禁用声明行仍声明+播种。

## 验证与停机

lint/vitest 同前（新失败 0）；真机过一遍 WI-1/2/3 的可见面 + 顺延累积的手测面（差分头像、M2 五面、M3 草稿行/概览——用户手测仍在欠账，你做基础确认即可）；截图存 assets。停机条款沿用 M3 卡 §8（WI-4 的启动门是其特化）。顺序：WI-0 → WI-1 → WI-2 → WI-3 → WI-4（条件）。WI-2/3 若超预估可再裁（报告注明）。
