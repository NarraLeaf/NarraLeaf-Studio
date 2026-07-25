---
title: "task: A4 + 斜杠面主语归属 —— /fx 的 backdrop 与 blend，以及 / 空态与侧栏对齐"
type: handoff
status: draft
date: 2026-07-26
parent: 2026-07-24-006-plan-story-action-model-alignment.md
---

# task: A4 · 补漏 + 斜杠面归属对齐

你是执行者。两件事：补齐 `/fx` 的最后两个引擎能力，以及消掉 A1 留下的**同一个动词在两个菜单里住在不同地方**的不一致。用户在真机使用中确认了后者。

前置阅读：`docs/plans/2026-07-24-006-plan-story-action-model-alignment.md` §5.2（`/fx` 的两条新增，标 P3）、§4.2（`accepts` 归类规则）、§12；`docs/plans/reports/2026-07-25-a1-report.md`；M3 卡 `2026-07-23-001` §0 纪律与 §1 风格铁律**原样适用**。

分支：从 develop（`15466bb`+）切 `feat/story-a4-slash-subjects`。报告：`docs/plans/reports/2026-07-26-a4-report.md`（≤50 行）。

**共享检出铁律**：逐文件 `git add <path>`；禁 `git add -A`/`.`；禁 `git stash`；**每次提交前 `git branch --show-current`**；**禁止 `git worktree remove`**。

**并行提示**：另有两张卡同时在跑（`2026-07-26-001` Dev Mode 保真度、`2026-07-26-002` 主进程 fs IPC）。你独占 `commands/specs/**` 与 palette/浏览面；**不要**碰 `storyStageSnapshot.ts`、Dev Mode 面板、`src/main/**`。

## WI-1 斜杠面主语归属对齐（本卡的主菜）

**症状**：A1 把侧栏改成了 spec 的投影——一个带目标的动词按 `accepts` 出现在**每一个**它支持的主语下（`/show` 落角色/图片/文字/图层/视频五处）。但 `/` 空态的分类浏览仍按 `spec.category` 单点归属，`/show` 只挂在「角色」下。于是**两个菜单对"一个动词住在哪"说法不一致**——作者在侧栏能在「图片」下找到"显示"，在 `/` 里却找不到。这是 §2 的 D1 在斜杠面的残留。

- 让 `/` 空态的分类浏览**复用侧栏那套归类**（`commands/specSidebar.ts` 的派生：有 target → 按 `accepts` 落每个主语；无 target → 按 `category`）。两个面从此同源。
- **已知的实现约束**（A1 复核指出，不要一头撞上去）：palette 的高亮遍历**按 command id 走**，而多主语归属意味着同一个 id 会在浏览网格里出现多次。要求：**一个按键只对应一个高亮目标**，遍历顺序稳定可预测，`Enter` 取的就是眼睛看到的那一个（交互模型规则 2「高亮是 Enter 的指针」）。实现自选（去重遍历、或让高亮携带"组+id"复合键），但这条不变式必须成立并有测试。
- **输入态不变**：一旦作者开始打字，仍是扁平排序候选列表（那是正确的形态，别改）。本 WI 只动**空态浏览**。
- 指令手册（同为 spec 派生）如果也是单点归属，一并对齐；若它按分类罗列本就合理，保持不动并在报告说明。

## WI-2 `/fx` 的 `backdrop` 与 `blend`（§5.2，原标 P3）

`Displayable` 的 20 个链式方法里，这两个 Studio 还没有入口：

- `backdrop` → 毛玻璃 `backdrop-filter`；`blend` → 混合模式 `mix-blend-mode`。
- 按既有 `displayableEffect` 的形状加两个 operation（`action.displayable.<op>`），走 `/fx` 的 inspector-first 路径（B10：`/fx` 落块即开检查器，复杂参数在检查器里）。**不要**给它们各自开新 token——那正是 B3 泛型动词要消除的"对象类型 × 动词"矩阵。
- 参数与取值以**引擎 0.16.1 的 d.ts 为准**（不要猜；`mix-blend-mode` 的可选值集合按引擎暴露的枚举，不要照抄 CSS 全集）。数值一律钳制（仓内 idiom `Math.min(1, Math.max(0, x))`）。
- 检查器控件复用既有 effect 参数区的惯例；i18n en+zh 两份。

## WI-3 顺手的一致性收尾（都很小）

1. **插件动作失去自有色调**：A1 之后插件动作并入「工具」灰（旧 `plugin` 分类的 `#9aa3ad` 消失）。判断一下这是否可接受——插件动作在菜单里从此与内置工具同色，作者分不出哪些来自插件。若你认为该给它们保留可辨识性，按 A1 的机制加一个带色 group（**注意**：色值要同步补进 `specSidebar.test.ts` 的钉值表，否则测试会挂——那正是它的设计意图）；若认为可接受，在报告里给出理由。
2. `/stop petals`（petals 是 vfx）会**静默变成对一个不存在音效的 audio stop**（A3 的 `fallbackKind` 机制，已有测试、有意为之）。评估一下：作者拼错对象名时这个静默回落是否会造成困惑；若值得改，方案是"解析不到任何对象时出诊断"而不是取消 fallbackKind。给结论，别擅自改语义。

## 明确不做

payload 层把 show/hide/transform 收敛进 `displayable`（§9）；`Control.whileLoop`/`breakLoop`；Vfx wearable 等专业能力；打字态候选列表的形态。

## 验证与停机

`yarn lint` 全绿；vitest 新失败 0（win32 基线 3 条）。必须有的测试：`/show` 在 `/` 空态浏览里出现在五个主语下**且**高亮遍历不重复命中；`/fx` 的两个新 operation 编译产物形状 + 钳制。

真机：`/` 空态按分类浏览、在「图片」下找到"显示"并建块可用、键盘上下走一遍高亮不跳乱；`/fx` 的毛玻璃与混合模式在 Dev Mode 里实际生效（截图）；顺带确认 A1/A3 的行视觉未退化（类别色条与徽章）。截图存 `docs/plans/reports/assets/`。

停机：高亮不变式与多主语归属无法同时成立（报告方案，别牺牲不变式）；引擎的 `backdrop`/`blend` 参数面与 `displayableEffect` 的既有形状无法对齐；单个 WI 规模超预估一倍。
