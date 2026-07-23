---
title: "task: M4 引擎批 — NLR 硬化与新能力（narraleaf-react 仓）"
type: handoff
status: draft
date: 2026-07-23
parent: 2026-07-22-001-feat-story-editor-overhaul.md
---

# task: M4 引擎批（在 D:\Dev\org\NarraLeaf\narraleaf-react 仓工作）

你是执行者，工作仓是**引擎仓 narraleaf-react**，不是 Studio。本卡作者对引擎仓内部了解有限：**你的第一步是侦察**——读该仓的 README/贡献约定/测试设施，建立自己的现状地图；发现本卡契约与引擎架构冲突时停机报告，不要硬凑。报告写回 Studio 仓 `docs/plans/reports/2026-07-23-M4-engine-report.md`（同模板 ≤60 行，附各 API 的最终签名摘要）。

- 分支：引擎仓内从默认分支切 `feat/studio-m4-batch`。遵守引擎仓自己的代码与测试约定；**不破坏公开 API 语义**（新增可以，改动/删除停机报告）。
- 跨仓联调约定：每完成一个 WI，构建引擎 dist 并拷入 Studio 仓 `node_modules/narraleaf-react`（既有惯例），跑 Studio 的 `yarn vitest src/renderer/lib/ui-editor/runtime/game`（编译器集成测试消费引擎 API，是现成的回归网）。Studio 侧的消费 UI 不在本卡（后续 Studio 里程碑）。
- 子代理授权：同 Studio M3 卡 §0（小而独立可拆、diff 亲自复核、主线自己做）。
- Studio 侧参考（只读）：`src/renderer/lib/ui-editor/runtime/game/storyCompiler.ts`（`buildSentenceParts` 如何产出 Word/Pause；`Image.char` 表情路径）、`runtime/app/gameUiSlots.tsx`（fastForward/restoreToHistory 消费现场）。

## 工作项（按序；WI-1 先行是有意的——先建安全网再动内核）

### WI-1 `Control.all` / `Control.any` / `Control.allAsync` 硬化测试轮

系统化补测并发编排在三类干扰下的行为：**skip/快进**（fastForward 穿过进行中的并行组）、**save/load**（并行组中途序列化再恢复）、**undo/回退**（restoreToHistory 跨过并行组边界；注意 Studio 侧已知教训：`ScriptCleaner` 缺失则不入 undo 栈、`Condition` 每次流经重求值）。发现的缺陷：小修直接修，架构级停机报告。这些测试是 M7 演出透镜的准入条件。

### WI-2 `fastForward({ until: actionId })`

现有 `until: "menu" | "end"` 扩展支持在指定 action id 处停下（含"已越过/不可达"的明确返回语义）。Studio 将用它做 Dev Mode 时间线热跳。

### WI-3 当前 action 事件流 + StackModel 只读检查

对外暴露：①"当前执行 action id"的订阅点（供 Studio 播放头同步，Studio 有 actionIdBindings 可反查块）；②StackModel 的只读快照 API（调用栈视图用）。只读、不承诺内部结构稳定（标注 @experimental 可接受）。

### WI-4 text-event token（最大的一块，先设计后实现）

对话富文本中的事件 token：typewriter 揭示到该位置时触发**受限副作用**——首版仅角色表情切换（`Image.char`）与可选 SE。硬性语义：**skip/快进 = 落最终态**（所有已越过 token 的效果生效）；**重放安全**（say 重放时 token 随之重放）；不引入新的存档负担（效果由 say 动作重放承载）。设计与 `Sentence`/`Word`/`Pause` 现有 token 体系一致（Pause 是唯一控制 token 先例）。若发现 token 触发副作用与渲染层架构根本冲突 → 停机报告替代方案（如句边界拆分编译）。

### WI-5 对话内换行语义

验证 `Word`/`Sentence` 对 `\n` 的行为；不支持则加最小 break token。Studio 侧行模型不变（换行只存在于富文本 run 内）。

## 验证与停机

引擎仓自有测试全绿 + 新增测试；每 WI 后 dist 拷贝 + Studio 编译器集成测试回归；报告附 API 签名摘要与 WI-1 发现的缺陷清单。停机条款：公开 API 破坏性变更、WI-4 架构冲突、单 WI 超预估一倍。WI-4/5 若超预估可裁剪顺延（报告注明），WI-1..3 是本卡底线。
