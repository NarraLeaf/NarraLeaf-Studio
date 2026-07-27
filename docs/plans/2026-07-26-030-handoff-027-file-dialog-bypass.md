---
title: "handoff: 卡 -027（文件对话框测试通道）交给下一个 orchestrator"
type: handoff
date: 2026-07-27
plan: 2026-07-26-004-plan-ui-professionalization.md
supersedes: 2026-07-26-028-handoff-ui-round-close.md
---

# 交接：只剩卡 `-027` 了

## 0. 三十秒上手

界面专业化这一轮**除 `-027` 外全部完成**。`-026`（Dev Mode 面板固定/浮动）已验收合并推送。
develop `580536e3`，远端只剩 `develop` / `master` / `nightly` 三条分支。
引擎 `narraleaf-react` 已提到 **0.19.2**。

**你只需要做一张卡**：`docs/plans/2026-07-26-027-task-test-only-file-dialog-bypass.md`。
它的 §4 判据我已经写好了但**标注为草案、尚未改前标定**——标定是你的第一件事，
而且照本仓的记录，标定大概率会改写判据（到目前为止**每一次都是判据错、实现没错**）。

先读：本文件 → 那张卡 → `docs/plans/2026-07-26-004-plan-ui-professionalization.md` §11。

## 1. 六条不可协商（原样沿用，一条都别省）

1. **验收由 orchestrator 亲手做。** 执行者的报告、截图、"lint 绿测试绿"都不算。
   判据由 orchestrator 写进卡，**执行者不许写 assert / scenario / 通过判定**。
2. **判据先写好，并在改前的 develop 上标定成红。** 断言 FAIL 时先怀疑断言，最终以看图为准。
3. **验收脚本会骗你。** 工具已经在 `tools/ui-verify/`，别重写。控件按可访问名找不按坐标；
   每个脚本先加 setup guard 证明被测对象可达；验收必须新起实例；量时间前先断言
   `document.hidden === false`；按条件推进剧情，不要按固定点击次数。
4. **共享检出。** 开卡前 `git status`；`git commit` 一律带 pathspec；逐文件 `git add`（禁 `-A`）；
   禁 `git stash`；禁让 agent 执行 `git worktree remove`；提交前 `git branch --show-current`。
5. **出卡前先在当时的 develop 上重测基线。**
6. **每次合并完成后，除了 lint 还要重跑相关卡的 scenario，再 push。**

## 2. 这一轮我自己踩到的三个"绿得不算数"（都是判据/夹具错，不是实现错）

写在最前面，因为它们是**同一种错**：守卫证明了"能量到东西"，没证明"量的是对的东西"。

1. **第一次 16 绿是对着启动菜单量出来的。** `driveToDevMode` 点完 New Game 只固定睡 4 秒，
   冷树上不够；而它原来的写法是「看一眼找不到 `New Game` 就 `return`」——
   把"菜单还没渲染"当成了"已经过了菜单"。整套几何于是量的是主菜单：每个数都合理，
   没有一个是关于运行中场景的。**已修**（轮询到故事真上台，够不到就报错）。
2. **一条判据可能是假绿。** D-6b 声称"浮动模式扛过了 session 重挂载"，
   但如果时间线跳转根本没跳成，模式当然不变。**已修**（跳转后必须看到播放头落在被点的行）。
3. **短路会制造"从没绿过"的判据。** 初版一发现没有切换控件就把所有模式相关判据短路成红，
   于是固定模式那两条是"因为短路而红"而不是"量过之后红"。
   **一条从没绿过的断言等于没被证明能量到东西。** 已改成不依赖被测控件的那半永远真量。

## 3. 工具现状

```
tools/ui-verify/
  drive.js       机械层。新增 drag()：真实指针输入、分步移动（一步跳到终点会被阈值忽略）
  assert.js      守卫与测量
  focus.ps1      抬窗口
  scenarios/_drive.js        启动器→项目→场景→Dev Mode 的驱动路径（已修上面第 1 条）
  scenarios/goto-devmode.js  新增。u4/u5 都假设实例已被驱动到 Dev Mode，自己却不驱动，
                             全新实例上会死于 `clickNamed timed out for "^First Day"`
  scenarios/iso-tree.sh      隔离树。已补 `.yarn/install-state.gz`（否则树里跑不了 yarn）
  scenarios/u4-dev-mode-console.js            17 条
  scenarios/u5-language-and-empty-states.js   11 条
  scenarios/u026-dev-mode-panel-dock-float.js 16 条
  fixtures/nesting-lab.js    容器夹具
```

跑法（**注意先 goto-devmode**）：

```bash
NLS_VERIFY_PROJECT=<项目副本> bash tools/ui-verify/scenarios/iso-tree.sh <branch> <isoDir>
# 按它打印的命令 junction node_modules，然后：
cd <isoDir> && NLS_DEV_RELOAD_PORT=<reload> node project/app/dev-electron.js --cdp --cdp-port=<cdp>
NLS_VERIFY_PORT=<cdp> NLS_VERIFY_PID=<pid> NLS_VERIFY_PROJECT=<项目副本> \
  node tools/ui-verify/scenarios/goto-devmode.js
# 再跑具体 scenario
```

**回归护栏**：`u4` 17/17、`u5` 11/11、`u026` 16/16。注意 **u4 的 A-6 与 A-14 是 skip 不是绿**
（前者缺存档基线，后者需先打开工作区 Scene Flow 页）。

## 4. `-027` 具体怎么下手

卡里 §4 已定的接口契约（验收脚本会按它写，别改）：

- 开关 = 环境变量 `NLS_DEV_FILE_DIALOG_BYPASS`，值为 JSON 清单文件绝对路径，不存在即关；
- 主进程**每次调用重新读盘**（验收要在两次导入之间改写清单）；
- 每次真的绕过要留日志行；**启动时无条件留一行** armed/disarmed 并写明是哪条门没过。

已勘明的落点：

- 资产导入走 `useAssetActions.ts:355` 的 `fs.selectFile` → `FsSelectFileHandler`
  （`src/main/app/application/managers/window/handlers/fsAction.ts`，约 480 行）。
  全仓 `dialog.showOpenDialog` 有 13 处、9 个文件，但本卡只需要这一处。
- 导入队列在 `useImportQueue.ts` + `components/ImportQueueStrip.tsx`：
  运行时显示 `basename(current)` 与 `completed / total` 加进度条；
  结束有失败项时列出 basename 并给 Retry。
- **失败项的构造是确定可复现的**：`LocalAssetsManager.importFromPaths` 是严格 1:1 顺序循环，
  逐条 `importLocalAsset`。注入 20 条里放一条**扩展名合法但文件不存在**的路径，
  就只挂那一条；Retry 之前把那个文件创建出来，重试即成功。

**三条门的负例不接受"日志说它拒绝了"**——那是实现替自己作证。证据是 OS 层枚举到**真的**
原生对话框。交接文档记过一次：`^Open ` 曾匹配到启动器的 "Open Folder"，弹出一个模态原生
对话框——DOM 里看不见、之后所有点击全被吞掉，报错只说"workspace 窗口没出现"，
最后是**在 OS 层枚举窗口**才看见它的。

**人工对比那一半**：用户说本机有桌面自动化途径可以代替人手点系统对话框（`mcp__computer-use__*`）；
想连续工作就用它，想要真实人手就在那一步把要选的 20 个文件告诉用户。

## 5. 环境备忘（有几条和上一版不同）

- **端口**：上一轮用的是 CDP 9228 / reload 9229。**开工前重新问用户要**。
- **停实例：杀 `electron.exe` 不够。** 起实例的 `node project/app/dev-electron.js` 父进程会活下来，
  **它才是占着 reload 端口的那个**，而且它的 cwd 会把整棵隔离树锁住
  （`rm -rf` 报 "Device or resource busy"）。而且它的命令行里**不含**隔离树路径，
  只按路径过滤抓不到它。补一刀：
  `Get-NetTCPConnection -LocalPort <reload> -State Listen | % { Stop-Process -Id $_.OwningProcess -Force }`
- **主检出的 `node_modules` 曾被清空**（只剩一个空目录），原因不明；我实测排除了
  "iso-tree.sh 的 rm -rf 跟着 junction 删穿"这个猜想——这里的 `rm -rf` **不跟** junction。
  隔离树 junction 到一份自建的 node_modules 即可，别依赖主检出那份。
- **项目夹具永远用副本**：`D:/Temp/nls-u4-proj/demo3`（含 Nesting Lab）。
  **不要碰 `D:/Dev/test/nlstudio/demo3`。**
- **引擎**：`D:/Dev/org/NarraLeaf/narraleaf-react`，活跃分支 `dev_nomen`，当前 0.19.2 已发布。
  改引擎必须写 CHANGELOG。

## 6. 还开着的（不属于 `-027`）

- **主检出有一批未提交的 ui-verify 改进**（另一个 session 的，约 +240 行）：
  `--disable-features=CalculateNativeWinOcclusion` 让被遮挡的窗口仍报
  `document.hidden === false`（实测：不带该开关约 2.1s 翻转），于是验收**再也不用抢前台**；
  配套的 `focus.ps1` 重写成默认不激活、只反最小化，并加 `-Off` 在退出时解除置顶。
  **但那份工作树基于更早的 develop**（`narraleaf-react: ^0.18.0`），整体提交会把
  引擎版本、`_drive.js` 的 New Game 轮询、`iso-tree.sh` 的 install-state 一起退回去。
  要取就得挑着取。**这是本轮最值得抢救的一件东西。**
- `worktree-fix+preview-gate-sidecar-and-offthread-seal` 分支未合并，但它的两个修复
  （gate.js sidecar、封包 off-main-thread）**内容都已在 develop 上**，合它反而会往回压。
- 零碎清单见 `2026-07-26-028` §5，仍然成立：Dashboard 正文透明、`emptyStory` 漏网、
  `displayable/transform` 分歧、Scenes 字号 1.6 上限、菜单/选项容器链没人验过、
  替换资产引用点只验了 1 处、blob url resolver 缓存、无法取消行选中。
