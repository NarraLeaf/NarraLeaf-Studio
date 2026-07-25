---
title: "task: 引擎 — LiveGame.fastForward 永不返回，且把游戏冻在黑屏上"
type: task
status: ready
date: 2026-07-26
repo: narraleaf-react (D:/Dev/org/NarraLeaf/narraleaf-react)
branch: fix/fastforward-hang
---

# task: `LiveGame.fastForward` 挂死

**这是已发布版本里的缺陷，严重度高**：它让 Studio devtools 的 "Skip to next choice" 完全不可用，
并且把正在运行的游戏冻在黑屏上，只能关窗口。Studio 侧已经绕开它（U0 改走
`restoreToHistory` + 冷跳，不再调 `fastForward`），但**引擎的公开 API 仍然是坏的**，
任何用它的宿主都会中招。

## 0. 分支与纪律

- 仓库 `D:/Dev/org/NarraLeaf/narraleaf-react`，从 **`dev_nomen`**（不是 master）切 `fix/fastforward-hang`。
- 逐文件 `git add`。不合并、不 push、**不发版**（`npm publish` 与打 tag 归用户）。
- **CHANGELOG 必须写**（本仓硬性规矩）：在未发布小节记这条修复，写清楚对宿主的影响面。
- eslint 在本仓是 CRLF 敏感的，注意行尾。

## 1. 复现（orchestrator 亲测，2026-07-25）

环境：NarraLeaf-Studio `develop`，`node_modules/narraleaf-react` = **0.17.0**，demo3 项目，
场景 `First Day`（12 行，无 menu）。

1. Studio 里 Run Dev Mode → New Game → 进入 `First Day`。
2. 左下角调试 FAB → Story Runtime → Timeline，点第 1 行让播放头落到开头。
3. FAB → **Skip to next choice**（走 `LiveGame.fastForward({ until: "menu" })`）。

观察到：
- 播放头从第 1 行推进到 **第 3 行就停住**（推进了 2 步）；
- **舞台整个变黑**（游戏内容消失）；
- 菜单项停在 `Skipping…` 且 disabled，**持续 73 秒以上不恢复**——promise 既不 resolve 也不 reject。

场景开头的行序是：`1 旁白` → `2 character enter`（带转场的 `show`）→ `3 对白`。
停住的位置正好在转场之后。

**归因提醒**：Studio 在 **0.16.1** 上的旧读数是"前向跳转恒定 +2"，与这里的"推进 2 步后挂住"同形。
**这大概率是既有缺陷，不是 0.17 引入的回归**——不要在 CHANGELOG 里写成 0.17 的回归，
除非你拿出 0.16.1 上不复现的证据。

## 2. 嫌疑区（orchestrator 读码所得，不是结论，别直接照抄进修复）

`src/game/nlcore/game/liveGame.ts` 的 `fastForward` 循环里：

```ts
const awaitable = this.stackModel.getWaitingAwaitable();
if (awaitable) {
    const settled = new Promise<void>(resolve => awaitable.onSettled(() => resolve()));
    gameState.events.emit(GameState.EventTypes["event:state.player.skip"], true);
    await settled;               // <- 挂在这里的可能性最大
}
```

已排除的两条：
- `Awaitable.onSettled`（`src/util/data.ts:419`）对**已 settle** 的 awaitable 会立即回调，不会静默丢失；
- `StackModel.getWaitingAwaitable`（`stackModel.ts:580`）已经过滤了 `isSettled()` 的项。

所以最可能是：**这个 awaitable 根本不响应 `event:state.player.skip`**（例如在飞的转场 / 动画 /
`Control.sleep` / 非 say 类挂起），于是 `settled` 永远不会 resolve。
JSDoc 承诺的「in-flight transitions are settled immediately」在这条路径上没有兑现。

**为什么现有测试没抓到**：`src/game/nlcore/game/fastForwardTarget.test.ts` 用的是 gameState + stackModel
的**脚本化替身**（duck-typed seam），它证明的是缝的契约，不是真实渲染器的行为。
所以修复必须带一个**能在未修代码上失败**的测试，且这个测试要覆盖"awaitable 不响应 skip"这个形态，
而不是再加一条替身用例。

## 3. 要求

- **先复现、后修**。诊断结论（这个 awaitable 是什么、为什么不响应 skip）写进报告。
- 修好之后 `fastForward` 在所有情形下都必须**终止**：正常推进到 menu/end、遇到不可 skip 的挂起、
  达到 `maxSteps`、以及目标不可达。**永不 resolve 是不可接受的失败模式**——宁可返回一个诚实的
  `reason`（必要时新增一个枚举值并在 CHANGELOG 说明），也不要挂住。
- 舞台变黑要一并查清：它是挂死的**症状**还是**并发原因**（例如 skip 事件在转场中途把渲染态打断）。
  如果是独立缺陷，报告里分开写，不要混成一条。
- `until: { actionId }` 的既有语义（**在运行目标之前停下**、只扫根栈）**维持不变**，本卡不引入
  `after: { actionId }`——Studio 已改走快照恢复，不需要它。
- 变异验证：新测试必须先在**未修**代码上跑挂，再在修复后转绿，报告里两个结果都要给。

## 4. 明确不做

- 不改 `restoreToHistory` / `getHistory` / 快照语义（Studio 现在依赖它们，且它们工作正常）。
- 不加 `after: { actionId }`。
- 不动 `Control.all/any` 的语义。
- 不发版、不打 tag。

## 5. 自验

1. 本仓测试全绿（`yarn test` 或仓内既有命令），新失败为零。
2. 新测试在未修代码上失败、修复后通过（两份输出都贴进报告）。
3. `build:dev` + postbuild `--target-dir` 把 dist 拷进 Studio 的 `node_modules/narraleaf-react`，
   然后**在 Studio 里按 §1 的步骤真机复验**：Skip to next choice 必须在有限时间内结束、
   舞台不得变黑、菜单项恢复可点。
4. CHANGELOG 已写。

## 6. 报告

`D:/Dev/org/NarraLeaf/NarraLeaf-Studio/docs/plans/reports/2026-07-26-engine-fastforward-report.md`
（放 Studio 仓便于归档），**≤45 行**：分支/commits、诊断结论、修复形状、变异验证两份输出、
真机复验结果、CHANGELOG 摘要、风险。

## 7. 何时必须停下来报告

- 根因在渲染层且修复会改变 skip 的公开行为（影响面超出本卡）。
- 舞台变黑是独立缺陷且需要单独的修复方向。
- 修复需要改 `Awaitable` 的通用语义（那会波及全仓）。
