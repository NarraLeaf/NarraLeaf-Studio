---
title: "task: NLR 0.16.0 迁移 — Transition 接口一步到位 + 新转场目录化与预设"
type: handoff
status: draft
date: 2026-07-24
parent: 2026-07-22-001-feat-story-editor-overhaul.md
---

# task: NLR 0.16.0 迁移（前置任务，gate M7 及一切转场相关工作）

你是执行者。背景：表演内核 narraleaf-react 已发布 **0.16.0**（dev_nomen `576015c`），**Transition 接口大改 + 新增一批转场动画**。Studio 一直以 dist 拷贝跟随 dev_nomen，所以"能跑"，但正式迁移从未做：旧 Transition 调用面、统一过渡词表未覆盖新转场、检查器无新预设、包版本关系未理清。本卡**一步到位**：迁移无 shim、新转场全量入词表、预设做齐。

前置阅读：bible `2026-07-19-001` **§1.3 统一过渡词表**（词表是立法文本，本卡要修法）；M3 卡 §0/§1 纪律铁律原样适用。分支：从 develop（`18237b1`）切 `feat/story-nlr-0-16-migration`。报告：`docs/plans/reports/2026-07-24-nlr-0-16-report.md`（≤60 行同模板，附：接口 diff 盘点结论、词表新旧对照表、包版本策略说明）。

## WI-0 上轮小尾巴（先行，与迁移同区）

1. **TextEvent 舞台寻址与 /show 对齐**（表情线复核 CONCERN）：`compileEventRun` 按 `normalizeObjectName(characterId)` 取图，而 `/show` 走 `getCharacterStageObjectName`（objectName 优先，`displayableTarget.ts`）——自定义 objectName 的角色 TextEvent 静默 no-op。修：改为同一寻址函数；寻址不到时同族 warning（不再静默）。
2. `StorySceneEditorRows.tsx` 插入表情处注释声称 "insert then open the picker" 但代码只 insert——实现自动开 picker 或改注释，择一（倾向前者，一步操作更顺）。
3. `src/shared/types/story/document.ts` ~:133 陈旧注释仍引用已删除的 `BlueprintDocument.persistentVariables`——更新为注册表表述。
4. 翻译构建会丢 TextEvent（沿承 Pause 同族限制，`storyCompiler.ts` 翻译重建路径）——本卡只在该处补一行 known-limitation 注释 + 报告记录，不修。

## WI-1 侦察与盘点（先做完再动手迁移）

- 引擎侧：在引擎仓比对 0.15.x→0.16.0 的 Transition 公开面（`git -C D:\Dev\org\NarraLeaf\narraleaf-react log/diff` 围绕 `576015c publish: 0.16.0`；有 CHANGELOG 读 CHANGELOG），产出：改名/改签名/删除清单 + **新增转场动画完整枚举**（名称、参数、方向性）。
- Studio 侧消费面盘点：`storyCompiler.ts` 的 `createTransition`/`createShowTransform`、`StoryTransitionRef` 类型、`commands/specs/*` 的 `t=` 枚举与 apply 方向感知映射（bible §1.3 的实现处）、`ActionInspector` 过渡编辑区、Story Motion、UI-editor runtime 其余 Transition 用点。盘点结论进报告。

## WI-2 接口迁移（一步到位）

- 全部调用面迁至 0.16.0 新接口；**不留 shim、不留双路径**。
- `package.json` 的 narraleaf-react 版本对齐 0.16.0，并在报告说明 dist 拷贝与 npm 版本的关系（生产构建/打包用哪份、开发用哪份——现状是什么就写什么，发现不一致提方案不擅改发布管线）。
- 既有行为回归红线：编译器集成测试全绿；既有项目的 `t=` 规范值语义不变（见 WI-3 兼容要求）。

## WI-3 新转场目录化（修法）

- 0.16.0 新转场全量纳入统一过渡词表：bible §1.3 规范值表**更新**（文档修订 + 表格扩展，含各指令支持子集与方向感知映射）、specs `t=` 枚举与别名、apply 层映射、i18n en/zh。
- 规范值命名遵守 bible B6（小写单词、可连字符、别名可输入、补全插入规范值）。
- **向后兼容硬性**：既有全部规范值在新接口下语义保持；确实无法保持的列成清单停机报告（那是产品裁决）。

## WI-4 预设制作

- 检查器过渡编辑区升级为**预设选择**：每个转场一张预设（默认参数套装：时长/方向/缓动等），选中后参数可再调——形态复用既有 picker/卡片惯例（风格铁律：不发明新 UI 语言、无解释文案；LetsGal 的"预设卡+简述"是读感参照非样式照抄）。
- quickParams 的 `t=`/`d=` token 与新词表联动（palette/手册自动随 spec 更新，无需另做）。
- 默认参数取值在报告列表（orchestrator 验收要抽查观感）。

## 验证与停机

lint 全绿；vitest 全量新失败 0；**真机**：Dev Mode 逐类转场 smoke（/bg、/show、/hide、/jump 各覆盖代表性新旧值）+ 截图/短录屏存 assets；既有 Demo 项目打开→编译→预览无回归。停机：某规范值在新接口下无法保义（列清单交裁决）；引擎 0.16.0 自身缺陷需要修（小修按 worktree+fix 分支惯例做并报告——**注意：删 worktree 前先 `rmdir` 断开 node_modules junction 再 `git worktree remove`，直接删会穿透 junction 清空主仓依赖，已踩过**）；预设形态与现有检查器组件语言冲突。
