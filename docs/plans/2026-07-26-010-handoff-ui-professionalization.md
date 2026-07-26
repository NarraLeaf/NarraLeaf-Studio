---
title: "handoff: 界面专业化一轮 — 交接给下一任 orchestrator"
type: handoff
status: active
date: 2026-07-26
plan: 2026-07-26-004-plan-ui-professionalization.md
---

# handoff: 界面专业化一轮

给下一任 orchestrator。**先读这份，再读总计划 `2026-07-26-004`。**

## 0. 三十秒版本

上一轮（`2026-07-22-001`，17 分支）工程赢了、体验没发生。本轮是纠偏，已完成
**U0 / U0.1 / U1 / U2 / U3a + 一个引擎根治**，剩 **U3b / U4 / U5**。
本轮和上一轮的唯一实质差别是**验收方式**：orchestrator 亲手拉起应用、亲眼读图、跑自己写的断言。
**这条不能软化——它是本轮唯一真正的护栏，且已经四次抓到测试与 lint 看不见的问题。**

## 1. 当前状态（2026-07-26 核实）

| | |
|---|---|
| Studio `develop` | `1e10c170`，已推送，0 ahead |
| 引擎 `narraleaf-react` | `dev_nomen` @ `1ea5846` = **0.17.1 已由用户发版**，npm latest 0.17.1 |
| Studio 依赖 | `^0.17.1`，node_modules 已是 npm 生产包（无 sourcemap）——旧的"dist 是开发构建"欠账**已闭合** |
| 工作树 | **完全干净**——原先 9 个外来未提交文件已于 2026-07-26 提交为新基线（见 §4） |
| 本地已合并分支 | `feat/ui-u0-blocking-fixes` / `feat/ui-u0-1-surface-opacity` / `feat/ui-u1-reading-layer` / `feat/ui-u3a-asset-browsing`，可删可留 |

## 2. 已完成

- **U0**（`2026-07-26-005`）时间线跳转改 snapshot-first（`restoreToHistory` + 冷跳兜底，**不再调 `fastForward`**）；
  调试面板从覆盖改挤压布局，不再切立绘；三处编辑面可读；`tools/ui-verify/drive.js` 驱动层；
  Stack 空时隐藏 / FAB 换 bug 图标 / 快照选择器换项目 Select。
- **U0.1**（`2026-07-26-006`）新设置 `editor.surfaceOpacity`（0–100，默认 100，一个 CSS 变量驱动三处表面、跨窗口实时生效）；
  删除 `speakerNotShown` 诊断。
- **U1**（`2026-07-26-008`）**一条文本基线**：旁白正文、对白正文、说话人名字同一个 x，跨说话人一致
  （compact 419.2 / standard 423.2 / comfortable 431.2，改前是五条边缘且随名字长度浮动）；
  归属导轨 1.27→**4.10:1**，类别条 2.87→**5.35/6.04:1**，头像 24→**28/32/40**；
  `comfortable` 升级为对话块；顺带修了虚拟化测量缓存不随密度失效导致行互相盖印的缺陷。
- **U3a**（`2026-07-26-009`）Icon view 真缩略图（**18 张解码**，改前 0）、表头计数含子树、分组卡片四宫格预览、
  搜索变筛选并跨折叠分组、总览降级为面板内第三视图（`Largest` 每行带缩略图）、分片路径与 hash 折进 `Storage`。
- **引擎**（`2026-07-26-007`）`LiveGame.fastForward` **永不 resolve** 根治：`event:state.player.skip` 是一次性广播、
  无重放，而能响应它的 dialog 要等 React commit 才存在；改为按 ~16ms 重发直到 settle，
  单步超时返回新 reason `"stalled"`。已发 0.17.1。

每张卡都有报告在 `docs/plans/reports/2026-07-26-*`。

## 3. 用户裁决（**不要重新讨论**）

1. **工作区背景图保留**（可选配置）。所以不是"删背景图"，是"开着背景图时正文也可读"，
   **验收必须在背景图开启态下量**。
2. **密度不加档**。develop 上的 `compact|standard|comfortable` 保留；`comfortable` 是结构不同的那一档。
3. **资产管理器做完整版**，拆 U3a（浏览，已完成）/ U3b（管理，触碰写路径，单独验收）。
4. **一条文本基线**：旁白、对白、名字左边缘对齐，**那条共享边缘本身就是层级**；
   区分靠字重/字色/头像/类别条，**永远不靠水平位移**。名牌因此不能行内前置。
5. **`speakerNotShown` 是噪声**，已删——角色不必在台上才能说话。别以任何形式复活它。

一条我自己判的、可推翻：U1 让 compact 组头行 36→44px，一屏可读行数 20→19（约 5%）。
我判"一条基线"优先、判据让位。用户未反对但也未明确认可。

## 4. 共享检出：陷阱与当前基线

**工作树现在是干净的。** 2026-07-26 用户确认无其他 agent 在跑，我把那 9 个未提交文件
按关注点分四次提交并推送，作为新的干净基线（`f4ac3556` dock 分隔线 / `20309da0` 预览浮窗
测量向下取整 / `5fb208e3` 插入槽宿主行提前重测 / `1e10c170` dev 构建并行化 + 补上
`compileWorker.js`）。提交前我读过全部 9 份 diff、跑了 lint + `build:apps:dev`，
并做了真机烟测：三条 dock 分隔线各 1px 同色、一处接缝一条线、布局完好。

**但陷阱本身依然成立，下一任必须继续防**：只要工作树里出现别人的未提交改动，
`yarn dev` 看到的画面就包含它们的效果。

**U1 上真的踩了，代价是一次回退**：执行者把提交的代码适配到当时只存在于未提交改动里的
`.nl-dock-divider` 上。合进 develop 会得到没有宽度/填充/边框的分隔条，而
**lint、测试、执行者的截图全部通过**——因为在他们的 dev 构建里那些样式是活的。

**U3a 执行者给出了正确解法，沿用它**：`git archive HEAD` 到隔离树（node_modules 用 junction），
在**不含未提交改动的树上**跑 tsc + build + ratchet。这是唯一能真正抓住这个失败模式的检查。
每次开卡先 `git status`：**只要有未提交的外来文件，就把清单和这条审计要求写进卡的 §0.1**，
并要求报告里给审计过程，不只给结论。

其余共享检出铁律：逐文件 `git add`（**禁 `git add -A`**）、禁 `git stash`、
**禁止 agent 执行 `git worktree remove`**。

## 5. 验收协议（本轮的核心，别削弱）

1. **判据由 orchestrator 写进卡**，含驱动路径、要截哪几张图、断言哪些量。**执行者不得写 assert/scenario/通过判定**——
   U0 卡就是这么划的边界，写了退回。
2. **执行者的报告与截图不构成验收。** orchestrator 自己 `yarn dev` 拉起、驱动、**亲自读图**、跑自己的断言。
3. **断言脚本在看到实现之前写好**，并先量改前基线，否则会被实现反向定义。
4. **目视 + 断言双绿才合并。** 不接受"测试全绿所以通过"。
5. 判据要可断言：对比度比值（非文本 ≥3:1、正文 ≥7:1，且**合成 alpha 之后**再比）、像素尺寸、
   缩略图存在性、跳转落点行号 == 目标行号。

## 6. 我在验收里犯过的五个错（**这是本文件最有价值的部分**）

全部同一族：**测量工具本身没被验证过**。所以"看图"不是补充手段，是唯一能兜住工具错误的那一层。

1. **选择器抓错元素**——stage 的兜底选到了 1400px 的窗口根 → 假 FAIL；表面选择器测了天然透明的行本身 → 假 FAIL。
2. **恒假表达式**——`cs.position === 'absolute' === false` 永远不成立，导轨永远找不到。
3. **脏会话**——在执行者留下的长寿命实例（跑完过、热重载过）上测，得出"跳转只走 2 行"的结论，
   **干净实例上三次都复现不了**。规矩：**验收必须新起实例。**
4. **坐标漂移**——按坐标点控件，另一个 session 改了布局 → 点空。规矩：**一律按 `aria-label` 找控件。**
5. **空洞通过（最危险）**——资产面板没打开，于是所有断言因"被测对象不在屏幕上"而为真，
   脚本打印 `all checks passed`。规矩：**每个脚本先证明被测对象在屏幕上（setup guard），否则拒绝出报告。**

U2 又添了四个，都是新种类（2026-07-26）：

6. **rect 不等于可达**——持久化会话恢复的浮动 Live Preview 窗压在行上，行的 rect 完全正常，
   点击却落在浮窗上。守卫必须 `document.elementFromPoint(cx,cy)` 反查命中元素是否在目标行内。
   同理 `clickElement` 要求**连续两次 rect 一致**才点（标签条 smooth-scroll 期间会漂）。
7. **验收脚本改脏了夹具**——在对白行上按 Enter 会**提交编辑并插入一行**，demo3 12→13 行；
   另一次我把场景描述写进了真实 demo3。规矩：收尾跑**指纹校验**，写操作先存原值、无论成败都写回。
8. **窗口 `document.hidden` 时一切计时都是假的**——Electron 后台窗口 rAF 挂起、React commit 推迟，
   同一条延迟量出 5.1s；窗口可见时是 **99/10/105ms**。**量时间前先断言 `document.hidden === false`。**
9. **我自己的探针污染了持久化视图状态**——探针跑过之后每个场景都存了选中行，
   于是"无选中"这个状态再也复现不出来。规矩：验收用的 profile 留一份 pristine 副本，每轮拷回。

还有一条不算错但值得记：**断言 FAIL 先怀疑断言**在 U2 兑现了两次——
"跟随选中 0/12" 是我只取了前 4 行文本、根本没取到主语行；"延迟 5.3s" 是我用 CDP 轮询量一个 120ms 的量。
两次的真相都是实现没问题、工具有问题。**判据脚本必须在改前标定成"红"**，这是唯一能证伪空洞判据的手段。

另有三次：**在共享检出上提交前没看分支**，docs commit 落到了执行者的分支上。
规矩：**只要有 agent 在跑，提交前先 `git branch --show-current`。**

## 7. 剩余队列

按依赖顺序。每张卡出卡前**必须在当时的 develop 上重测基线**——develop 会动，上一轮就是死在照过期计划发卡。

- ~~**U2 检查器**~~ —— **已完成并合并**（卡 `2026-07-26-011`，报告 `reports/2026-07-26-U2-report.md`，
  merge `3303c8d6`）。用户裁决：**Properties 吞掉 Inspector**（独立 story-inspector 面板连同
  `panels.show/hide` 显隐机械一并退役）+ **无选中时显示场景级属性**。
  12 条断言全绿（改前标定 9/11 红），目视复核过。**U5 要接的三条尾巴**：
  `Text ID` 仍打印裸 uuid、`Stage name` 仍是内部词汇、资产/角色/UI 检查器仍是透明表面。
  另有一条产品事实：**没有任何手势能取消行选中**（Escape / ctrl-click / 点空白都不行，点场景卡会选中第 1 行），
  所以场景级属性只在"还没点过的场景"里可达。
- **U3b 资产管理层**（触碰写路径，风险最高，单独验收）
  - 就地重命名/删除/移组、批量选择与操作、替换资产内容（保 id 换文件）、标签管理、导入队列
  - **删除必须经 `ReferenceService` 反查并在被引用时明确拦截**——那是玩家侧缺资产的唯一防线
  - 顺手：删掉 `AssetOverviewCommand` 空壳的挂载（在 `WorkspaceLayout.tsx`，**该文件现已提交、可自由改**）
- **U4 Dev Mode 调试台**
  - 时间线与编辑器**共用一套 describe**（删 `storyRuntimeDebugModel.describeStoryBlock` 这套弱实现，
    把编辑器投影提到可共享层）；行要带类别色与说话人
  - `Stack` tab 重做为"执行上下文"（当前场景/容器/分支、循环轮次、并行里谁在跑），无内容时整个 tab 隐藏
  - `Scenes` tab 打开即 fitView，节点字号可读
  - 判据：时间线每行文案与编辑器同一行**一致**（现在是 `character enter · character` vs `Enter Nattou`）
- **U5 语言与空态清扫**
  - 扫 `No * yet` / `No item selected` / `Nothing on *`；扫内部词汇（`setBackground`、`Stage name`、裸 hash）
  - Dashboard 的 8 块数字砖压缩

## 8. 工具

- `tools/ui-verify/drive.js`：机械 CDP 驱动（连接/截图/点击/求值）。
  `NODE_PATH=D:/Dev/org/NarraLeaf/NarraLeaf-Studio/node_modules node tools/ui-verify/drive.js targets`
- `yarn dev` 起（detached Electron，CDP 9222）／`yarn stop --dry-run` 查／`yarn stop` 停
- 启动器点 "Demo" 进工作区；`First Day`（12 行）是本轮所有基线用的夹具
- 视口 1400×902 CSS @ dpr 1.25；截图像素 = CSS × 1.25
- 调试面板是 tween 滑入的，**动画未 settle 时读 rect 会整体偏 380px**——连续两次读数一致再信
- `yarn lint` 只跑 tsc；仓里有 CI style ratchet；win32 vitest 基线 8–9 个失败不是回归
