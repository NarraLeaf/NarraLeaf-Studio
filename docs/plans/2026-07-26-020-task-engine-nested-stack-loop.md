---
title: "task(engine): 嵌套栈的 loop 信息在 snapshot 里被丢掉，Dev Mode 拿不到当前轮次"
type: task
status: done
date: 2026-07-26
repo: narraleaf-react
blocked-by-this: 2026-07-26-019-task-ui-u4-dev-mode-console.md (A-9)
---

# engine: `StackFrameSnapshot.branches` 只带 `frames`，把 `loop` 丢了

## 现象

U4 的执行上下文面板要回答「循环第几轮」。`StackSnapshot` 类型上有

```ts
loop?: { type: StackModelLoopType; counter: number; limit?: number; broken: boolean }
```

看起来够用，**实际拿不到**：Studio 里 `/repeat` 走到第二轮时，
`liveGame.getStackSnapshot().root` 上没有 `loop`，任何一层 branch 上也没有。
所以 Dev Mode 现在只能显示**声明的**次数（`Repeat ×3`），显示不了当前轮次。

## 根因（`stackModel.ts` → dist `main.js` 的 `snapshot()`）

```js
snapshot(){
  let e=[];                                   // frames
  for (…) {
    let r = { actionId, actionType };
    i.wait?.stackModels && (
      r.branchWaitType = i.wait.type,
      r.branches = i.wait.stackModels.map(s => s.snapshot().frames)   // ← 只取 .frames
    );
    e.push(r);
  }
  let t = { frames: e };
  this.__tag && (t.tag = this.__tag);
  this.loopConfig && (t.loop = {…});           // ← loop 挂在返回对象上，不在 frames 里
  return t;
}
```

`loop` 挂在**返回对象**上，而嵌套的 StackModel 只经由
`branches = stackModels.map(s => s.snapshot().frames)` 进入外层——`.frames` 留下，
**`.loop` 与 `.tag` 一起被丢弃**。`Control.repeat` 编译出来的正是
`StackModel.createCountLoop(...)` 这样一个嵌套模型，所以它的 `loopConfig`
在任何外部可见的快照里都不出现。

顺带：同一处让 `tag` 也丢了，异步栈的 `tag` 只在顶层 `async[]` 上才有。

## 建议的改法

`branches` 携带整个 snapshot，而不是只带 `frames`：

```ts
export type StackFrameSnapshot = {
    actionId: string | null;
    actionType: string | null;
    branchWaitType?: StackModelWaiting["type"];
    /** 每个分支的完整快照（含它自己的 loop / tag），不再只是 frames。 */
    branches?: StackSnapshot[];
};
```

这是**实验性只读 API**（类型注释里写明了 "not a stability contract"），
所以直接改形状比再加一个平行字段干净。Studio 侧目前只读 `branches` 的
`frames`，跟进成本是一行。

## 判据

- 一个 `/repeat 3` 的场景，走到第二轮时，从 `getStackSnapshot()` 出发能读到
  `counter === 2 && limit === 3`——无论那个循环嵌套多深；
- `parallel` 分支若自带 `tag`，在快照里也能读到；
- CHANGELOG 必须写（引擎卡铁律）。

## 来历

U4 验收（`2026-07-26-019` §7.1）唯一的红。orchestrator 在引擎源码里核过，
不是从执行者报告采信的。判据当初写成 `n/3` 是照着类型声明写的——
**没有验证这个字段在嵌套之后还活着**，属于判据的错；在引擎改之前
Studio 那边就显示声明次数，不假装满足。


---

## 完成记录（2026-07-26）

**引擎侧**：`narraleaf-react` 分支 `fix/nested-stack-loop-snapshot` → 已并入 `dev_nomen`（merge `2bb927b`），
版本 `0.19.1`，CHANGELOG 已写（含 breaking 说明）。改动就是提案的那两处：
`branches?: StackFrameSnapshot[][]` → `StackSnapshot[]`，
`map(s => s.snapshot().frames)` → `map(s => s.snapshot())`。
两个单测钉住它：嵌套 count loop 的 counter、嵌套栈的 tag，都**从父级 snapshot 读**而不是直接问嵌套模型。
`npm run lint` 0、`tsc --noEmit` 0、`vitest` 11/11。

**Studio 侧**：`findReportedLoop` 改成向 branches 递归下降；两处按老形状取值的地方跟着改
（分支当前行的 `branches[i][0]`、找并发帧的递归）。单测 14/14。

**判据全部满足，且是在真机上驱动出来的**（不是照类型推断）：
夹具 `Nesting Lab` 的 repeat 逐轮读作 **`Repeat 1/3` → `2/3` → `3/3`**，然后播放头离开循环进入 parallel。
U4 的 A-9 由红转绿，`--phase=fixture` 5/5。

**还欠一步（用户的活）**：`narraleaf-react@0.19.1` 需要发布，之后把 Studio 的
`package.json` 从 `^0.18.0` 提上去。目前是把本地 build 的 dist 拷进 `node_modules` 验证的，
`yarn install` 会把它冲掉。
