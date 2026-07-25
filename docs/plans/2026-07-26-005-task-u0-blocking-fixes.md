---
title: "task: U0 阻断级修复 — 跳转根治、面板不遮舞台、编辑面不透明、验收工具链"
type: task
status: ready
date: 2026-07-26
plan: 2026-07-26-004-plan-ui-professionalization.md
branch: feat/ui-u0-blocking-fixes
---

# task: U0 阻断级修复

总计划 `2026-07-26-004`。本卡是本轮第一张，同时解锁 U1（不透明前置）与 U4（时间线前置），
并修掉一个已发布但**不工作**的功能。

## 0. 分支与提交纪律

- 从 `develop`（`41273b81`）切 `feat/ui-u0-blocking-fixes`。
- 逐文件 `git add`，**禁止 `git add -A`**——本检出与其他 session 共享，工作树里可能有别人的脏文件。
- 每个 WI 完成即 commit。不要合并、不要 push 到 develop。
- 本仓已有 CI style ratchet（`338eef9e`），提交前确认没有推高样式债。

## 1. 风格铁律（每个 WI 验收都含这条）

- 复用既有组件（`Button`/`Select`/`EnhancedInput`/`controlButtonClass()`/properties framework/`ContextMenu`）。
- **UI 里不要解释性文本**。空态不写句子。
- 不新增依赖、不引入新配色、不加 chip/徽章/图例堆砌。
- 编辑面上不要 `title` 原生 tooltip。

## 2. 现状（2026-07-24 orchestrator 亲测，行号会漂移，按符号定位）

- `src/renderer/apps/dev-mode/components/StoryRuntimeDebugPanel.tsx` — `TimelineTab.jumpToRow` 是跳转实现。
- `src/renderer/lib/ui-editor/runtime/app/GameAppHost.ts` — `GameAppStoryRuntimeBridge` 定义。
- `src/renderer/lib/ui-editor/runtime/app/GameApp.tsx` — bridge 实现（`fastForwardToActionId` / `relaunch`）。
- `src/renderer/lib/ui-editor/runtime/app/gameUiSlots.tsx` — **`restoreToHistory` 已在此被游戏内 backlog 使用**（特性探测惯例）。
- `node_modules/narraleaf-react/dist/game/nlcore/game/liveGame.d.ts` — `getHistory()` / `restoreToHistory(token)` /
  `fastForward({until})`。注意 d.ts 明写：`{actionId}` **在运行目标之前停下**；且**只扫描根执行栈**。
- `src/renderer/apps/dev-mode/components/DevModeContent.tsx` — `DevModeDebugOverlay` 的面板容器
  （`absolute inset-y-0 right-0 w-[min(100%,380px)]`）与 FAB。

## 3. 工作项

### WI-1 验收驱动工具（先做，后面每个 WI 都要用它自证）

新建 `tools/ui-verify/`：

- `drive.js` — CDP 连接（按 url 片段选 target）、`screenshot(name)`、`click(x,y)`、`evaluate(expr)`、
  `keys()`、`listTargets()`。纯机械层，不含任何判据。
- `README.md` — 三行用法（如何起实例、如何选 target、截图落在哪）。

**边界**：只做驱动层。**断言与 scenario 由 orchestrator 编写，不在本卡范围**——不要写任何
`assert*`/`expect*`/判定通过与否的代码，也不要写"验收脚本"。写了会被退回。

- 落点：`tools/ui-verify/`（新目录，不进 src，不入打包）。
- 判据：orchestrator 能用 `node tools/ui-verify/drive.js` 连上运行中的实例并取到一张截图。

### WI-2 时间线跳转根治

**先诊断，后动手。诊断结论必须写进报告，不许跳过。**

已知事实（orchestrator 实测，develop `41273b81`，demo3 `First Day` 场景 12 行）：

| 点击目标行 | 起点 | 实际落点 |
|---|---|---|
| 10 | 5 | 7 |
| 12 | 7 | 9 |
| 2（后向） | 9 | 3 |
| 9 | 3 | 5 |

**前向跳转永远只前进 2 行，与点击目标无关。** 先查清这个 +2 从哪来（是 fastForward 提前返回、
是 `firstActionIdForBlock` 取到错的 id、还是回落 `relaunch` 抛错被 `.catch(()=>{})` 吞掉），
把证据写进报告，再改。

**目标架构（snapshot-first）**：

1. 维护 `blockId → historyToken` 映射：订阅播放推进，从 `liveGame.getHistory()` 收集条目 token，
   经 `actionIdBindings` 反查 blockId。快进途中同样累积（引擎 d.ts 明确保证）。
2. 点击**已播过**的行 → `restoreToHistory(token)`：即时、精确、零重放。
   走 `gameUiSlots.tsx` 已有的特性探测惯例，不要直接 `liveGame.restoreToHistory`。
3. 点击**未播过**的行 → 才走 fastForward。若当前 `until:{actionId}` 的"目标前停"语义无法落到目标行，
   **不许用"多走一步"补偿**（会在 skip/menu 边界生出新的不一致）——报告写明，orchestrator 去开引擎卡
   要 `after:{actionId}`；本卡内该路径可以先落 N−1 但**必须在 UI 上诚实**（播放头就显示它实际在的行）。
4. 删掉吞掉回落失败的 `.catch(() => {})`；失败要有可观测结果（console.warn 足够，**不要加 UI 文案**）。
5. `orderIndex` 用行序判断前后向的逻辑要重估：`/label`+`/goto` 落地后行序≠执行序。
   snapshot-first 之后这个判断大概率不再需要（"播过没播过"才是正确的分岔条件）。

- 判据（orchestrator 会用自己的 scenario 断言，不看你的报告）：
  - 顺序播到第 5 行后，点击第 1..4 行中任意一行 → **播放头行号 == 目标行号**；
  - 点击第 6..12 行 → 播放头行号 == 目标行号，或（若受引擎语义所限）== 目标−1 且**报告已说明**；
  - 全 12 行逐行点一遍，不得出现"落点与目标无关"的情况；
  - 舞台状态与落点一致（第 12 行 setBackground 之后背景确实变了）。

### WI-3 调试面板不遮舞台

`DevModeDebugOverlay` 的面板从 `absolute` 覆盖改为**挤压布局**：舞台与面板是同一个 flex 行的兄弟，
面板出现时舞台按剩余宽度重新 fit（`StageViewportFrame` 已经按容器算 scale，确认它能跟上）。

- 面板宽度保持 380px，动画可保留。
- 判据：demo3 `First Day` 播到 Nattou 立绘出现，**打开面板前后各截一张，立绘完整可见、无裁切**。

### WI-4 编辑面不透明

**裁决（用户 2026-07-24）：工作区背景图功能保留**——它是可选配置，不想要的人可以关掉。
所以本项**不是删背景图**，是让"开着背景图时正文依然可读"。不要动背景图的设置、加载或渲染路径；
只改这三处表面的底色。**自验与验收都必须在背景图开启的项目上做**（demo3 就是开着的）。

把"需要读字"的表面改为不透明；侧栏/标题栏/tab 条**保留现状**（本轮不动）。

范围（只这三处）：
1. 故事编辑器正文滚动区（`StorySceneEditorTab.tsx` 的行列表容器）；
2. 右栏检查器的字段区（`StorySceneActionInspector` 挂载的面板体）；
3. Dev Mode 调试面板体（`StoryRuntimeDebugPanel` / `BlueprintRuntimeDebugPanel` 的根）。

用既有 surface token，不要发明新颜色；不要给这些容器加边框/阴影来"补偿"。

- 判据：三处容器的计算 `backgroundColor` alpha == 1；正文文字与其背景对比度 ≥ 7:1
  （orchestrator 会在真机上量）。

### WI-5 顺手修（都在上面几个文件里，不额外扩面）

- Dev Mode 快照选择器：原生 `<select>` → 项目 `Select` 组件。
- Dev Mode FAB：`favicon.ico` → 表达"调试工具"的 lucide 图标（用既有图标集，不新增资源）。
- Dev Mode `Stack` tab 在无内容时**不显示 "Nothing on the stack" 文案**——该 tab 无内容时整个 tab 隐藏
  （tab 条按有内容动态显示；这不是新机制，`snapshots.length > 0 ?` 已是同款范式）。

## 4. 明确不做（出现冲动即停）

- 不改故事文档 schema、不改编译器行为。
- 不动故事编辑器的行结构、头像尺寸、分组导轨、类别色条——**那是 U1**，本卡碰了会撞车。
- 不动资产面板与资源总览——**那是 U3**。
- 不重写 `describeStoryBlock`／不搬编辑器投影——**那是 U4**。
- 不写任何断言/验收脚本（见 WI-1 边界）。
- 不加任何 UI 解释文案。

## 5. 自验要求（报告里逐项给结果）

1. `yarn lint`（tsc）全绿。
2. vitest 相关范围新失败为零（win32 基线失败列出即可）。
3. `yarn build:apps:dev` 全绿。
4. 用 WI-1 的 drive.js 自己走一遍 WI-2/WI-3 的路径，截图存 `docs/plans/reports/assets/2026-07-26-U0-*`。
   **注意：你的截图不构成验收**，orchestrator 会独立复验；截图是给你自己自证用的。

## 6. 判断与自由度

规格没写死的（挤压布局的具体 flex 结构、token 选择、FAB 图标选型），自行决策并在报告"偏离与决策"记录。
规格写死的（snapshot-first 架构、不许"多走一步"补偿、WI-1 边界、不做清单）没有自由度。

## 7. 反馈报告（必交）

写入 `docs/plans/reports/2026-07-26-U0-report.md`，**≤60 行**：

```
# U0 报告
分支/commits: feat/ui-u0-blocking-fixes @ <首..尾 sha>
## 状态
WI-1..WI-5: done | partial(差什么) | skipped(为什么)
## +2 诊断结论
<根因，含证据>
## 文件
## 偏离与决策
## 自验
lint / vitest / build / 截图路径
## 风险与已知问题
## 需要 orchestrator 重点看的点
```

## 8. 何时必须停下来报告（而不是继续）

- 诊断发现 `+2` 的根因在引擎侧（本卡**不许改引擎**）。
- snapshot-first 需要引擎补 API。
- 挤压布局导致 `StageViewportFrame` 的 scale 计算出现回归。
- 触碰区有其他 session 的未提交改动。
