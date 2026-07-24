---
title: "task: M4b 引擎 — text-event token 实现 + M4 复核 nits（narraleaf-react 仓）"
type: handoff
status: draft
date: 2026-07-23
parent: 2026-07-23-003-task-m4-engine-batch.md
---

# task: M4b 引擎批二（narraleaf-react 仓）

你是执行者，工作仓=引擎仓。前置阅读：`docs/plans/reports/2026-07-23-M4-engine-report.md`（**其 §偏离 中的 WI-4 设计已被验收接受，本卡就是实现它**）+ M4 卡 `2026-07-23-003` 的纪律与跨仓约定（原样适用）。

- 工作区：继续用隔离 worktree `D:\Dev\org\NarraLeaf\narraleaf-react-m4`；`feat/studio-m4-batch` 已并入 dev_nomen（`27eb425`，post-merge 全量 235 测试绿）。在 worktree 内从 dev_nomen 新建 `feat/studio-m4b-text-event`（主检出占着 dev_nomen，直接 `git branch` + `git checkout` 新名即可）。
- 报告：Studio 仓 `docs/plans/reports/2026-07-23-M4b-engine-report.md`（≤60 行，附最终 API 签名）。
- 跨仓：每 WI 后 `build:dev` + postbuild `--target-dir` 拷 Studio `node_modules/narraleaf-react`，跑 Studio `vitest src/renderer/lib/ui-editor/runtime/game` 回归（Studio 侧 M5 并行开发中，dist 更新对它是收益不是风险——但**公开 API 不许破坏**，M4 卡停机线不变）。

## WI-0 M4 复核 nits（先行）

1. **peek 透视挂起 awaitable 的误报**：`until:{actionId}` 的匹配在"目标是进行中 do 块的续延"时提前 reachedTarget:true（`stackModel.ts` peekTopActionId 跳过 awaitable + `liveGame.ts` 目标检查先于 menu/skip 处理）。修：仅当栈顶项本身是目标 CalledActionResult 时命中（或等价守卫），并补一条能表达该栈形的测试（复核代理指出现有 scripted 测试模型表达不了此形状——需要真 StackModel 集成测试或扩展模型）。
2. **公共导出**：`StackSnapshot`/`StackFrameSnapshot` 从公共入口 barrel 导出（Studio 现在只能 `ReturnType` 取型）。
3. **零监听零分配**：`event:action.current` 的 payload 分配挪进监听者存在性检查内（热路径）。

## WI-1 text-event token 实现（按已接受设计，五条契约为硬性验收）

1. token 类比 `Pause` 进入 word 串（`Sentence`/`Word` 体系一致性）；公开构造 API 命名遵循仓内惯例，效果描述符为**受限闭集**：首版=角色表情切换 + 可选 SE，不开放任意动作。
2. 揭示语义：打字机 roll() 到达 token 时执行副作用（直改元素态 + flush，**不入 stackModel**）。
3. **skip = 落最终态**：trySkip/untilEnd 路径对已越过的全部 token 生效其效果。
4. **重放安全 / 零存档负担**：词不入存档（Sentence.toData()→null 现状），效果随 say 动作重评自然重放；存档仅带常规 elementStates——用测试锁定"say 中途存/读档后状态一致"。
5. 同一 token 不得因渲染重入而重复触发（幂等门）。

**测试策略**（引擎无 React 无头设施，M4 报告已声明）：缝级测试为主（token→效果派发、skip 落终态、幂等、存读档一致——repo 的 duck-typed 缝测惯例）；打字机渲染路径若能以低成本 jsdom 化则加（不许为此引入大型测试基建——超出即停机报告替代方案）；真渲染验证：仓内示例/playground（先侦察）或在报告中给出 Studio 侧最小手测脚本（raw NLR story 即可，Studio 尚不产 token）。

## 验证与停机

引擎全量测试绿 + 新增测试；dist 拷贝 + Studio 集成回归每 WI 一轮；报告附 API 签名与"Studio 侧编译器将来如何产出该 token"的建议接口（给后续 Studio 行内表情 UI 的卡用，只写接口建议，不实现 Studio 侧）。停机：公开 API 破坏性变更；契约 3/4/5 任一无法在现架构下成立（报告替代方案：句边界拆分编译）；测试基建超预估。
