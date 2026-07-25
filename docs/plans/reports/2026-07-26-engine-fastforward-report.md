# report: engine — `LiveGame.fastForward` 挂死（卡片 2026-07-26-007）

分支 `fix/fastforward-hang`（自 `dev_nomen`），commit 范围 `e91dc07..e2f9afc`（1 个）。未 push / 未合并 / 未发版。
改动：`src/game/nlcore/game/liveGame.ts`、新增 `src/game/nlcore/game/fastForwardTermination.test.ts`、`CHANGELOG.md`。

## 诊断（先复现）
真机复现卡片 §1：播放头 1→3 停住，FAB 停在 `Skipping…` disabled。**关键**：手点舞台只前进一行又卡住 → 循环还活着，是 `await settled` 没被兑现。随后给引擎打临时日志（每步打印 awaitable 的 `__stack`，1.5s 未 settle 报 STALLED）拿到直接证据：

```
[FF-DIAG] step 3 awaitable-from: new Awaitable << CharacterAction.executeAction << ...
[FF-DIAG][dialog] skip received ...        <- step 1/2 有这行，step 3 完全没有
[FF-DIAG] STALLED at step 3
```

**根因**：挂住的是一条 `say`（`CharacterAction`）的 awaitable，只有**已挂载的** `PlayerDialog` 能经 `afterClick` 兑现它。而 `event:state.player.skip` 是一次性广播、无重放：`fastForward` 的循环在微任务上恢复，远早于 React 把这一行 commit，于是对"渲染器还没画出来的那一行"发的这一次 skip **一个监听者都没有**，被静默丢弃 → 没人 settle → promise 两头都不兑现。加一个 `requestAnimationFrame` 再发**仍然挂**（实测），一帧不保证 commit —— 正确形状是"重发直到兑现"。
附带后果：`finally` 永不执行 → **音量停在 0、`isFastForwarding` 永远 true**，这是"游戏被冻住"的另一半。

## 修复
`emit(skip); await settled;` 换成 `LiveGame.settleSuspendedStep()`：注册 `onSettled` → 立刻发一次（同步兑现则零额外开销，快路径不变）→ 未兑现则每 ~16ms 重发，直到兑现或超过 `options.stepTimeout`（默认 10000ms）。超时返回**新枚举值 `"stalled"`**（actionId 跳转带 `reachedTarget:false`），走正常 return，`finally` 恢复音量与标志。**所有情形下都终止。** `until:{actionId}` 语义未动，未加 `after:{actionId}`。

## 变异验证（同一份新测试）
未修代码（用 `git show dev_nomen:` 覆盖 liveGame.ts 后跑）：
```
× reports 'stalled' instead of hanging when the suspended step never answers a skip  2017ms
× carries reachedTarget:false through a stall for an actionId jump                   2006ms
× keeps re-issuing the skip until the renderer is mounted to honour it               2009ms
✓ costs no extra frame when the step settles on the first skip                          1ms
Tests  3 failed | 1 passed (4)
```
修复后：`Tests 4 passed (4)`（三条从 2000ms 挂死守卫降到 83/90/61ms）。全仓 `32 files / 342 tests passed`，新失败为零；`yarn lint` 干净。

## 真机复验（§5.3）
`build:dev --target-dir …/NarraLeaf-Studio/node_modules/narraleaf-react` 后按 §1 原步骤（Timeline 点第 1 行 → FAB → Skip to next choice）：**907ms 结束**（原 >73s 不结束），播放头跑到第 12 行 `setBackground` 并进入下一场景，菜单项恢复可点，舞台正常渲染，DevTools 无 error。另一轮 New Game 直接 Skip：818ms。

## 舞台变黑：未复现，判为独立现象
同版本同项目两轮（含卡片原步骤的 Timeline 跳转变体）均未变黑，舞台停在最后一帧、角色与文本都在。唯一拍到的黑屏来自 Dev Mode **热重载重启**（`NLR hot reload restart superseded by a newer bundle revision`），与 skip 无关，属 Studio 开发回路。不并入本卡；若能稳定复现建议单开一卡。

## CHANGELOG / 风险
CHANGELOG 新增 `[Unreleased] / Fixed` 两条：挂死修复（明确写了**不是 0.17 回归**，0.16.1 同形）＋ `"stalled"` 新枚举值与 `stepTimeout`，点名返回类型变宽、穷举 `switch` 需补一支。

- 返回类型加 `"stalled"` 对宿主是类型层破坏性变化（运行时向后兼容）。
- 真正跳不过的挂起（进行中的 `Control.sleep`、`skipTransition:false` 的 Layer/Camera 转场、长视频）会等满 `stepTimeout` 才报 `"stalled"`；让它们 fast-forward 可跳属于另一张卡。
- **Studio 的 `node_modules/narraleaf-react/dist` 现在是本分支的 development 构建**（非 npm 0.17.0）；他人做性能/正式验收需重装依赖或换生产构建。
