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
**U0 / U0.1 / U1 / U2 / U3a / U3b + 一个引擎根治**，剩 **U4 / U5**。
本轮和上一轮的唯一实质差别是**验收方式**：orchestrator 亲手拉起应用、亲眼读图、跑自己写的断言。
**这条不能软化——它是本轮唯一真正的护栏，且已经四次抓到测试与 lint 看不见的问题。**

## 0.5 给下一任：三十秒上手

1. 读 §5 验收协议 + §6 的九个测量错误（这是本文件最有价值的部分），再读 §8.1 隔离树配方与 §8.2 原生对话框边界。
2. 下一张是 **U4**（见 §7），**出卡前先在当时的 develop 上重测基线**——U2 与 U3b 两次都发现计划描述已过期，
   U3b 更是因此被砍掉三分之二。
3. 开卡前 `git status`：只要有别人的未提交文件，就把清单和隔离树审计要求写进卡的 §0.1。
4. 每张卡收尾**合并回 develop 并 push**，别停在"已合并未推"（用户 2026-07-26 明确要求，是常设规则）。

## 1. 当前状态（2026-07-26 核实）

| | |
|---|---|
| Studio `develop` | `26b16569`，已推送，0 ahead（2026-07-26 收尾）|
| 引擎 `narraleaf-react` | `dev_nomen` @ `1ea5846` = **0.17.1 已由用户发版**，npm latest 0.17.1 |
| Studio 依赖 | `^0.17.1`，node_modules 已是 npm 生产包（无 sourcemap）——旧的"dist 是开发构建"欠账**已闭合** |
| 工作树 | **不干净**——又有别的 session 的未提交改动（launcher / `Modal.tsx` / blueprint / story-motion 等）。**开卡前自己 `git status`**，见 §4 |
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

**⚠ 2026-07-26 收尾时工作树又不干净了**——别的 session 在同一个检出上开工（launcher、`Modal.tsx`、
blueprint-lite、story-motion 等）。下面这段讲的是当时那次清理，**当作历史读**，
你自己开卡时必须重新 `git status`。U3b 那次外来改动里**有两个就落在被改的资产模块里**，
所以隔离树审计不是形式主义。

**（历史）** 2026-07-26 早些时候用户确认无其他 agent 在跑，我把那 9 个未提交文件
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

## 6. 我在验收里犯过的九个错（**这是本文件最有价值的部分**）

全部同一族：**测量工具本身没被验证过**。所以"看图"不是补充手段，是唯一能兜住工具错误的那一层。

1. **选择器抓错元素**——stage 的兜底选到了 1400px 的窗口根 → 假 FAIL；表面选择器测了天然透明的行本身 → 假 FAIL。
2. **恒假表达式**——`cs.position === 'absolute' === false` 永远不成立，导轨永远找不到。
3. **脏会话**——在执行者留下的长寿命实例（跑完过、热重载过）上测，得出"跳转只走 2 行"的结论，
   **干净实例上三次都复现不了**。规矩：**验收必须新起实例。**
4. **坐标漂移**——按坐标点控件，另一个 session 改了布局 → 点空。规矩：**一律按 `aria-label` 找控件。**
5. **空洞通过（最危险）**——资产面板没打开，于是所有断言因"被测对象不在屏幕上"而为真，
   脚本打印 `all checks passed`。规矩：**每个脚本先证明被测对象在屏幕上（setup guard），否则拒绝出报告。**

U2 / U3b 又添了五个，都是新种类（2026-07-26）：

6. **rect 不等于可达**——持久化会话恢复的浮动 Live Preview 窗压在行上，行的 rect 完全正常，
   点击却落在浮窗上。守卫必须 `document.elementFromPoint(cx,cy)` 反查命中元素是否在目标行内。
   同理 `clickElement` 要求**连续两次 rect 一致**才点（标签条 smooth-scroll 期间会漂）。
7. **验收脚本改脏了夹具**——在对白行上按 Enter 会**提交编辑并插入一行**，demo3 12→13 行；
   另一次我把场景描述写进了真实 demo3。规矩：收尾跑**指纹校验**，写操作先存原值、无论成败都写回。
8. **窗口 `document.hidden` 时一切计时都是假的**——Electron 后台窗口 rAF 挂起、React commit 推迟，
   同一条延迟量出 5.1s；窗口可见时是 **99/10/105ms**。**量时间前先断言 `document.hidden === false`。**
9. **我自己的探针污染了持久化视图状态**——探针跑过之后每个场景都存了选中行，
   于是"无选中"这个状态再也复现不出来。规矩：验收用的 profile 留一份 pristine 副本，每轮拷回。

10. **桩本身造出了假缺陷（U3b）**——我为绕开原生文件对话框，在一次性隔离树里打桩
    `dialog.showOpenDialog`；那次调用挂住、`busy` 卡在 true，屏幕上就是"替换按钮是死的"。
    我差点把它当缺陷退回去，**干净构建上一测按钮是好的**。
    规矩：**桩打在被测调用本身上时，先怀疑桩**；判"功能坏了"之前先在无桩构建上复现一次。
    附带一条：`find | xargs md5sum` 做目录指纹**不可靠**（被别的实例锁住的文件会被静默跳过，
    我因此误判 demo3 被改）——**用 mtime 判定**（`find -newermt`）。

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
- ~~**U3b 资产管理层**~~ —— **已完成并合并**（卡 `2026-07-26-015`，报告 `reports/2026-07-26-U3b-report.md`，
  merge `f37fc04f`）。**发卡前重测基线把这张卡砍掉了三分之二**：重命名/删除/多选/批量删除/
  批量标签/拖拽移组/导入**在 develop 上早就有了**，连引用反查也有且会列出引用位置。
  真缺的四块（替换内容、守卫下沉、导入队列、删空壳）已交付。
  **验收结论**：守卫与按钮层级、空壳、无回归全部亲验绿；替换端到端跑通
  （hash `a039e2b1`→`bdb75262`、709.7KB→2.0MB、故事行缩略图改画新图）。
  **两条没验到**：替换后的引用点只验了 1 处（那个资产只有 1 处引用，不是 3 处）；
  **导入队列的进度与重试至今没有任何人驱动过**——原因见下面 §8 的"原生文件对话框"。
  另booked：`createWorkspaceBlobUrlResolver` 按实例缓存，内嵌场景预览在重建前仍显示旧图。
- **U4 Dev Mode 调试台**（下一张）
  - 时间线与编辑器**共用一套 describe**（删 `storyRuntimeDebugModel.describeStoryBlock` 这套弱实现，
    把编辑器投影提到可共享层）；行要带类别色与说话人
  - `Stack` tab 重做为"执行上下文"（当前场景/容器/分支、循环轮次、并行里谁在跑），无内容时整个 tab 隐藏
  - `Scenes` tab 打开即 fitView，节点字号可读
  - 判据：时间线每行文案与编辑器同一行**一致**（现在是 `character enter · character` vs `Enter Nattou`）
  - **U2 已经把料备好了，出卡前先看**：编辑器侧现成的 block→显示投影是
    `storySceneBlockUtils.ts` 的 `describeBlock` / `getBlockBadgeInfo`（类别色与图标就在后者），
    U2 又新增了 `storySelection.ts` 与 `schemas/storySceneSchema.tsx`。
    "把编辑器投影提到可共享层"多半就是把这两个函数搬到 shared 层再让时间线消费，**不是重写**。
  - 出卡前务必在当时的 develop 上重测：U2/U3b 两次都证明计划里的描述已经过期。

- **U5 语言与空态清扫**（收尾）
  - 已经攒下的尾巴（都是我亲测确认还在的）：
    1. 检查器的 `Text ID` 字段仍直接打印裸 uuid（U2 只治了标题行）
    2. `Stage name` 仍是内部词汇（值是 `character`）
    3. 资产 / 角色 / UI 元素的检查器**仍是透明表面**——U2 只给故事内容那块挂了 `.nl-editor-surface`
    4. 资产面板分类表头的导入按钮**没有 aria-label**（我验收时按可访问名找不到它）
  - 空态文案清单（Explore 已扫过，**不必重扫**，`src/shared/i18n/catalog/en/`）：
    `storyInspector.ts:4` / `properties.ts:125,152,156` / `characters.ts:84,98,116,156,157` /
    `storySnapshot.ts:4` / `storyVars.ts:19,24` / `story.ts:81` / `uiEditor.ts:13,14,128` /
    `workspace.ts:11,208` / `launcher.ts:15` / `motion.ts:58` / `blueprint.ts:65` /
    `console.ts:18` / `dashboard.ts:71,10` / `widgetChrome.ts:66`。
    `properties.panel.noSelection` 与 `.noSelectionHint` **已在 U2 删除**。
  - Dashboard 的 8 块数字砖压缩
  - i18n en/zh key 集合一致性测试必须保持绿

## 8. 工具

- `tools/ui-verify/drive.js`：机械 CDP 驱动（连接/截图/点击/求值）。
  `NODE_PATH=D:/Dev/org/NarraLeaf/NarraLeaf-Studio/node_modules node tools/ui-verify/drive.js targets`
- `yarn dev` 起（detached Electron，CDP 9222）／`yarn stop --dry-run` 查／`yarn stop` 停
- 启动器点 "Demo" 进工作区；`First Day`（12 行）是本轮所有基线用的夹具
- 视口 1400×902 CSS @ dpr 1.25；截图像素 = CSS × 1.25
- 调试面板是 tween 滑入的，**动画未 settle 时读 rect 会整体偏 380px**——连续两次读数一致再信
- `yarn lint` 只跑 tsc；仓里有 CI style ratchet；win32 vitest 基线 8–9 个失败不是回归

### 8.1 隔离树验收（U2/U3b 用的标准做法，建议沿用）

共享检出里别人的未提交改动会进你的 `yarn dev` 画面（U1 就是这么栽的）。所以验收在**只含被测分支**的树上做：

```
git archive <branch> | tar -x -C <isoDir>
cp yarn.lock <isoDir>/                     # 被 gitignore，yarn 4 没它会拒绝跑
mklink /J <isoDir>\node_modules <repo>\node_modules
cp -r .dev/temp/userData-dev <isoDir>/.dev/temp/     # 再另存一份 pristine，每轮拷回
NLS_DEV_RELOAD_PORT=<p2> node project/app/dev-electron.js --cdp --cdp-port=<p1>
```

停实例**必须带同一个 `NLS_DEV_RELOAD_PORT`**，否则 stop-dev 找不到会话、下次启动报端口占用。
别人的实例在 9222/5588，**不要 `yarn stop`**。
写路径的卡（U3b 这种）还要把 profile 的 `app.recentProjects` 改成只指向**你自己的项目副本**，
demo3 从 recents 里删掉——这样你连误写 demo3 的可能都没有。

### 8.2 原生文件对话框：验收的硬边界（U3b 实测）

`fs.selectFile` 走的是 Electron 原生对话框，**两条自动化路径都够不到**：
- 渲染进程侧 `window.__NLS_RENDERER_INTERFACE__` 是 **non-writable / non-configurable 的 window 属性、
  对象与 `fs` 都 frozen、`selectFile` 不可重定义**——CDP 里无法打桩；
- dev 构建不是已安装应用，`request_access` 解析不到，**桌面自动化也指不了它**。

我试过在**一次性隔离树**里打桩 `dialog.showOpenDialog`，结果那次调用挂住、`busy` 卡在 true，
于是"替换按钮是死的"——**这是桩自己造出来的假象**，我在干净构建上推翻了它。
教训：**打桩打在被测调用本身上时，先怀疑桩**。最终替换是**请用户点了一次选择器**才验成的。
凡是走这个对话框的判据（替换、导入队列），要么排进用户手测，要么在卡里写明"没人验过"。
