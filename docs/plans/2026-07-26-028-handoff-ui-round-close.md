---
title: "handoff: 界面专业化一轮收尾 —— 交给下一个 agent 的两张卡与全部尾巴"
type: handoff
date: 2026-07-26
plan: 2026-07-26-004-plan-ui-professionalization.md
supersedes: 2026-07-26-010-handoff-ui-professionalization.md
---

# 交接：界面专业化一轮已收尾，剩两张卡

## 0. 三十秒上手

**这一轮（U0–U5）全部完成、合并、推送，develop `72eb30d7`。** 引擎卡也做完并发布了
（`narraleaf-react@0.19.1` 已上 npm，Studio 依赖已提到 `^0.19.1`）。

你要接的是**两张已经写好、还没开工的卡**，以及一份零碎清单：

| 卡 | 是什么 | 前置 |
|---|---|---|
| `2026-07-26-026` | Dev Mode 面板固定/浮动可切换 | 无 |
| `2026-07-26-027` | 严格门控的文件对话框测试通道 | 无；它解开 U3b 那条从没人验过的判据 |

**先读这三样，再动手**：本文件 → 你要做的那张卡 → `docs/plans/2026-07-26-004-plan-ui-professionalization.md` §11（收尾记录）。

## 1. 这一轮留下的最重要的一件东西

`tools/ui-verify/` —— **验收现在是一条命令，不是一个下午。**

```
tools/ui-verify/
  drive.js                      机械层：连接 / 截图 / 点击 / 求值。不做任何判断
  assert.js                     守卫与测量。每条注释都写着它是被哪次误测逼出来的
  focus.ps1                     把 Electron 窗口抬到前台（没有它 document.hidden 恒为 true）
  scenarios/_drive.js           启动器 → 项目 → 场景 → Dev Mode 的驱动路径
  scenarios/iso-tree.sh         隔离树配方
  scenarios/point-recents-at.js 把 profile 的 recents 指向项目副本
  scenarios/u4-dev-mode-console.js       U4 的 17 条断言
  scenarios/u5-language-and-empty-states.js  U5 的 11 条断言
  fixtures/nesting-lab.js       容器夹具（repeat / parallel / menu / 一行空旁白）
```

跑法：

```bash
NLS_VERIFY_PROJECT=<项目副本> bash tools/ui-verify/scenarios/iso-tree.sh <branch> <isoDir>
# 按它打印的命令 junction node_modules，然后：
cd <isoDir> && NLS_DEV_RELOAD_PORT=<你的端口> node project/app/dev-electron.js --cdp --cdp-port=<你的端口>
NLS_VERIFY_PORT=<cdp> NLS_VERIFY_PID=<electron pid> NLS_VERIFY_PROJECT=<项目副本> \
  node tools/ui-verify/scenarios/u4-dev-mode-console.js
```

**它落地当天就还清了自己**：第一次真跑，在一张 11 小时前刚验收 11/11 的卡上报了 10 红——
别的 session 的合并把 U5 的 48 个文件整体退回了。详见 §3。

## 2. 五条不可协商（沿用，一条都别省）

1. **验收由 orchestrator 亲手做。** 执行者的报告、截图、"lint 绿测试绿"都不算。
   判据由 orchestrator 写进卡，执行者不许写 assert / scenario / 通过判定。
2. **判据必须先在改前的 develop 上标定成红。** 这是唯一能证伪空洞判据的手段。
   U4 标定改写了 4 条判据、U5 改写了 3 条 + 补了一次夹具，**全部是判据错、实现没错**。
   **断言 FAIL 时先怀疑断言，最终以看图为准。**
3. **共享检出。** 开卡前 `git status`；`git commit` 一律带 pathspec；逐文件 `git add`（禁 `-A`）；
   禁 `git stash`；禁让 agent 执行 `git worktree remove`；提交前 `git branch --show-current`。
   **验收必须在只含被测分支的隔离树上做。**
4. **出卡前先在当时的 develop 上重测基线。** 这一轮每张卡都被重测砍过：
   U2/U3b 各砍三分之二，U4 砍掉 U4-4 与半个 U4-2，U5 的空态清单行号全变、4 条已不存在。
5. **每张卡收尾都合并回 develop 并 push**，别停在"已合并未推"。

**新增第 6 条（这一轮血的教训）**：**合并完成后，除了 lint，还要重跑相关卡的 scenario。** 见 §3。

## 3. 这一轮最贵的教训：合并会把别人做完的活悄悄退回去

时间线：U5 合并（`003224ab`）→ 亲验 11/11 → 推送 → 别的 session 合并 `6beaa190`
（`feat/layered-sprite-l3`，**分支切出时间早于 U5**）→ **U5 的 48 个文件回到 U5 之前的内容**。

三个特征让它几乎不可见：

1. **不是冲突。** 那条分支从没修改过这些文件，只是携带旧版本，合并解析取了它那一侧。
2. **`git log -- <路径>` 什么都查不到。** 退回发生在 merge 内部，对路径没有独立提交。
3. **退回是逐字节的**（48 个文件与 U5 前版本 md5 完全相同）——这反而让恢复变成机械操作。

**lint 绿、测试绿、history 干净。唯一发现它的手段是重跑 scenario。**

检查脚本（合并后跑一次，`<merge>` 是那张卡的合并提交，`<pre>` 是它的第一父）：

```bash
for f in $(git diff --name-only <pre> <merge>); do
  [ -e "$f" ] || continue
  h=$(git show HEAD:"$f" | md5sum); p=$(git show <pre>:"$f" | md5sum)
  [ "$h" = "$p" ] && echo "REVERTED: $f"
done
```

## 4. 两张卡的补充说明

### `-026` Dev Mode 面板固定/浮动

用户裁决：**固定模式占据空间**（就是 U0-2 做的挤压布局），浮动模式浮在舞台上、舞台恢复整幅，
模式要记住。卡里有判据方向，**具体断言由你标定时定稿**。

注意：`DevModeContent.tsx` 这一轮被上游 revert 过一轮，动手前先看它现在长什么样。
回归护栏是 `u4-assert` / `u5-assert` 两套 scenario 全绿。

### `-027` 文件对话框测试通道

用户授权：**仅 Studio 开发模式 + 调试端口已开 + 一个默认关的显式开关，三条同时成立**才启用。

卡里把判据重心放在**三条门的负例**上，不是"能用"。另有一条硬要求：经通道导入 20 个文件的结果，
必须和人手选同样 20 个文件**逐项相同**——因为上一轮给同一个对话框打桩时，**桩自己造出过一个假缺陷**。
人手那一半需要用户配合跑一次。

**这道墙我自己撞过一次**：`tools/ui-verify/scenarios/_drive.js` 里 `^Open ` 曾匹配到启动器工具栏的
"Open Folder"，打开一个原生文件夹对话框——模态、DOM 里看不见、之后所有点击全被吞掉，
而报错只说"workspace 窗口没出现"。我是在 OS 层枚举窗口才看见它的。已修（改成按项目名锚定），
但它正好演示了这张卡要拆掉的是什么。

## 5. 零碎清单（都确认过还在）

| 项 | 说明 |
|---|---|
| Dashboard tab 正文仍透明 | U5 的 WI-4 只点了右栏；同一条理由适用于正文。一行的事 |
| `emptyStory` 漏网 | 同族的 `emptyUi` 删了。因为我按**正则**而不是按**界面**划范围 |
| `displayable/transform` | 最后一处编辑器/时间线分歧（编辑器 `Transform <name> · <asset>`，投影 `<operation> <label>`） |
| Scenes 字号缩放上限 1.6 | 场景多到把 fit 压到 zoom ≈0.6 以下时，A-11 的 11px 会再破。夹具四节点量到 11.5px，余量不大 |
| 菜单/选项容器链 | 没人验过。CDP 合成点击选不中菜单选项（点击确实落在选项上、`elementFromPoint` 也确认命中） |
| 导入队列进度与重试 | 从 U3b 至今**无人验过**。`-027` 解锁 |
| 替换资产的引用点 | 只验了 1 处（那个资产恰好只有 1 处引用），卡里写的是 3 处 |
| blob url resolver | 按实例缓存，内嵌场景预览在重建前显示旧图 |
| 无法取消行选中 | Escape / ctrl-click / 点空白都不行，所以"无选中时的场景级属性"只在没点过的场景里可达 |

## 6. 谁验的什么（别把别人的记录当自己的）

- **U0 / U0.1 / U1 / U2 / U3a / U3b**：上一任 orchestrator 验的。本任只复验了它们留下的尾巴。
  **`U1 的导轨对比度 ≥3:1` 这类判据本任未复量**，采信交接记录。
- **U4 / U5 / 引擎卡**：本任亲验，scenario + 亲自读图。

## 7. 环境备忘

- **端口**：这台机器同时跑多个 session 的 Studio。9222 / 9228 / 9333 都被用过，
  **开工前先问用户要一个端口**，并且 `stop-dev.js` 必须带**启动时同一个** `NLS_DEV_RELOAD_PORT`，
  否则会杀掉别人的实例。
- **项目夹具**：永远用副本。`D:/Temp/nls-u4-proj/demo3` 是本轮用的那份（含 `Nesting Lab`）。
  **不要碰 `D:/Dev/test/nlstudio/demo3`**。
- **窗口抬升**：`focus.ps1`，原理与三个坑记在 memory `cdp-acceptance-window-focus`。
- **引擎**：`narraleaf-react` 在 `D:/Dev/org/NarraLeaf/narraleaf-react`，活跃分支 `dev_nomen`
  （不是 master），当前 `0.19.1` 已发布。改引擎必须写 CHANGELOG。
