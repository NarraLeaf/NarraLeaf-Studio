---
title: "task: 行内表情 — TextEvent 的 Studio 侧 UI/编译 + 引擎收尾三件"
type: handoff
status: draft
date: 2026-07-23
parent: 2026-07-22-001-feat-story-editor-overhaul.md
---

# task: 行内表情（B1 四件套收官）

你是执行者，跨两仓：引擎收尾（小）+ Studio 主体。前置阅读：`docs/plans/reports/2026-07-23-M4b-engine-report.md`（TextEvent API 与 `buildSentenceParts → TextEvent.expression` 接口建议——**编译器落点以它为准**）；总计划 §3.1；M3 卡 §0/§1 纪律与铁律原样适用。报告：`docs/plans/reports/2026-07-24-inline-expression-report.md`（≤60 行同模板）。

**并行协调（硬性）**：另一执行者同时做 M-VAR。①本卡 story schema 版本预分配 **v8**（M-VAR=v9）；②两卡文件交集应为零（你在 scene-editor 富文本/编译器 sentence 段 + 引擎；对方在注册表/蓝图/services），若你发现自己要动 `declarations.ts`、蓝图模块或 `VariableRegistry*` → 停机报告。

## WI-0 引擎收尾三件（先行；引擎仓，重建 worktree）

`git -C D:\Dev\org\NarraLeaf\narraleaf-react worktree add ..\narraleaf-react-inline dev_nomen` 后在 worktree 内切 `fix/text-event-followups`（基线 dev_nomen `f93bb6d`）：

1. **TextEvent 公共 JSDoc 补 skip 语义**（类文档写明：跳过/瞬时揭示 = 已越过 token 全部落终态）。
2. **NVL 重挂载重放守卫**：会话内 NVL 容器重挂载会重跑 instant-reveal 分支 → SE 重放 + 陈旧表情覆盖新状态（序列化加载安全，须保持）。契约：**重挂载不得重发 SE、不得回写表情**；实现自选（如效果消耗标记上移到 gameState 级、或历史句渲染路径剥离 token），缝测锁定。
3. **（力所能及则做）契约 5c/5d 升级为集成级**：真组件 trySkip 路径 + LiveGame 存/读档中途一致性各一条；测试基建超预估则报告说明维持缝级。

每步后 `build:dev` + postbuild `--target-dir` 拷 Studio，跑 Studio `vitest src/renderer/lib/ui-editor/runtime/game` 回归。分支留待 orchestrator 合并；worktree 留存。

## WI-1 文档模型（Studio；schema v7→**v8**）

`StoryRichRun` 联合新增事件 run：`{ event: { expression?: { characterId: string; formName?: string; variants?: StoryCharacterVariantSelection }; sound?: { assetId: string } } }`（形状可按实现微调，闭集不开放任意动作——与引擎侧对齐）。迁移=版本戳无操作。`value` 纯文本投影不受影响（事件零宽）。

## WI-2 编辑器 UI

- 插入：对话行富文本编辑态中，经现有 token 插入入口（Interpolation/Pause popover 同族）加"表情"项——仅当行有 `characterId`；选择器复用 `CharacterAppearancePicker`（form/差分）。SE 变体若顺手（资产选择器复用）一并做，否则报告顺延。
- 渲染：token 在 `RichTextView`/`renderRunsToElement` **统一渲染器**中呈现为零宽紧凑标记（小差分头像或类别色小点，沿用既有 token 视觉语言，绝不新发明样式）；读/编两态一致（这是 story-row 交接文档明文的统一渲染器红线）。点击 token → 重开选择器；删除同字符语义。
- 行外联动：该行的组内表情语义不变（`/face` 行照旧）；不做"token 自动改写 /face"魔法。

## WI-3 编译器

`buildSentenceParts` 遇事件 run → 按 M4b 报告接口产出 `TextEvent.expression(...)`（差分→资产经 `shared/utils/characterVariant` 共享逻辑）/ `TextEvent.sound(...)`。资产 URL 解析沿编译器既有 character 路径。诊断：characterId 无效/差分无资产 → 与既有 character 块同族 warning。集成测试：事件 run 编译产物形状 + 纯文本投影不含事件。

## 验证与停机

lint/vitest 新失败 0；**真机端到端是本卡硬验收**（这也是 TextEvent 引擎特性的首次全链路验证）：Dev Mode 中一句台词打字机走到 token 处立绘换差分、skip 后为终态、存/读档后重放一致；截图/短录屏存 assets。停机：统一渲染器无法零宽承载 token；引擎 API 不符合报告所述；schema 冲突（见并行协调）。
