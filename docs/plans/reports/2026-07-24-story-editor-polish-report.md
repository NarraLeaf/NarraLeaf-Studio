---
title: "report: Story 编辑器打磨"
type: report
date: 2026-07-24
parent: 2026-07-24-009-plan-story-editor-polish.md
---

# report: Story 编辑器打磨

计划卡 `docs/plans/2026-07-24-009-plan-story-editor-polish.md` 的全部条目已实现。分支 `feat/story-editor-polish`，9 个提交，从 `1aecb95e`（develop）切出。

`yarn lint` 全绿；vitest **244 文件 / 2140 通过 / 7 跳过**，新失败 0（新增 24 条断言：密度表 6、find/replace 12、行诊断 6，外加 specs 的 3 条示例断言）。

## 1. 做了什么

| 批 | 提交 | 内容 |
|---|---|---|
| A | `cea6a84c` | 密度盒高对齐；Assets 去 items；Asset Overview 隐藏 Packaging；行动作图标化；行号列自适应 |
| B | `52cf78d9` | 行 memo + 稳定动作上下文；`SortableContext.items` memo；打字与列表解耦 |
| C | `51dd9442` | 背景行改右侧缩略条、去 `backdrop-filter`；hover 簇按需挂载；reduceMotion 降级；删死设置 `ui.compactMode` |
| D | `e4f0f52d` | Actions 边栏 → 指令手册（列表+详情、参数表、示例、去重）；模态 Command reference 退役 |
| E | `83fea6f1` | 三档密度下拉；空场景引导 |
| P3 | `3e1d3ac8` + `0c2e88b2` | 行列表虚拟化（`@tanstack/react-virtual`）+ scrollMargin 偏移修正 |
| X5 | `815ac53c` | 滚动上下文条（说话人 / 容器） |
| X6 | `c7e04f35` | 场景内查找替换（Mod+F） |
| X7 | `15d94238` | 行级诊断标记 |

## 2. 性能：数字与它们的诚实读法

样本：400 行纯对白场景（demo2 副本，`The Forest`）。

### 2.1 dev build（React development，同机）

| 交互 | 前 | 后 |
|---|---|---|
| 点一行 → 重渲染的行体 | **400** | **0** |
| 四次点行的长任务 | 7 条 / 合计 1024ms | 1 条 / 57ms |
| 打字（每键） | ~100ms 长任务 | 11 键 **0 条长任务** |
| 打开场景 | 340ms 一帧卡死 | 61ms |
| 编辑器 DOM 节点 | 12 099（30.2/行） | 642 |
| CPU profile 空闲占比 | 21% | 67% |

### 2.2 production build（`yarn build` + `electron dist/main`，同机，前后各重建一次）

| 指标 | 前（`1aecb95e`） | 后（`15d94238`） |
|---|---|---|
| 挂载的行 | 402 | **45** |
| 编辑器 DOM 节点 | 12 127 | **1 377** |
| 点击→重绘（8 次中位数） | 36.6ms | 33.3ms |
| 打开场景 / 点行 / 打字的长任务 | 0 | 0 |

**这张表要这样读**：在这台 M 系 Mac 上，生产构建下 400 行**本来就已经在一两帧之内**，所以"点击→重绘"这个指标被两帧的调度地板（~33ms）吃满了，前后几乎无差别，长任务两边都是 0。**不要拿它当"提升 10%"来宣传**——它只说明"这台机器上 400 行不是瓶颈"。

真正被改掉的是**复杂度**，而复杂度在两个地方仍然可见且不受地板影响：DOM 规模 8.8×，以及 dev build 那张表（dev 的同一份工作贵 2–3 倍，正好是"低配机器"的合理替身）。用户关心的是低配电脑和 1500 行的章节；那两个方向上，改动前是 O(场景长度)，改动后是 O(一屏)。

**未验证**：真实低端机器上的绝对数字。手上没有这样的机器，上面所有数字都来自同一台 M 系 Mac。

### 2.3 一条被证伪的路（省掉后来人的弯路）

`content-visibility: auto` + `contain-intrinsic-size` 对点击成本**几乎无效**（100ms → 95ms，dev build 实测）。成本在 React 协调，不在布局绘制。别再试 `will-change` / `translateZ(0)` 这类偏方。

## 3. 密度对齐：修之前与之后

舒适密度下的实测（同一行、同一档）：

| | 前 | 后 |
|---|---|---|
| 行高 | 46px | 46px |
| 文本中心相对行中心 | **−5.4px** | **0** |
| 行号中心 | −5.4px | **0** |
| 拖拽把手中心 | 0（对齐行，不对齐文字） | **0** |
| 文字下方死白 | **10.8px** | 0 |

紧凑档顺带变整齐了：对白行因为名牌的 `min-h-[28px]` 一直比旁白行高 1px，现在两者同为 36px。

换行的长台词仍然**首行对齐**（`items-start` 是有意保留的），把手也跟着首行而不是飘到行的中点。

## 4. 与计划的偏离

1. **计划说给 S1 加一条 jsdom 断言"内容盒中心偏移 = 0"——做不到，改了口径。** jsdom 没有布局引擎，`getBoundingClientRect` 全是 0，这条断言在一个彻底坏掉的样式表上也会通过，是**假的保障**。改成：密度表本身的单测（每个档位都有 metrics、compact 保持无 lineHeight、盒高单调递增、两个 CSS 变量都被发布），对齐本身用真机测量（§3）。
2. **Asset Overview 的 Packaging 只停渲染，数据层保留**（按用户裁决）。`AssetOverviewSummary.packaging` 仍然计算，"裁剪功能是否保留"是另一个决定。
3. **`ui.compactMode` 直接删了**——声明在 `globalState.ts`，全仓零消费者，设置面板也没暴露。
4. **`story.sceneEditor.actionsPanel` / `story.view.comfortableDensity` 两个 i18n 键随其 UI 一起删除**。
5. **X5 从"粘性组头"改成"滚动上下文条"**。虚拟化后的行是绝对定位的窗口，没有可供 `position: sticky` 附着的祖先；一个钉在滚动区顶端的条既做到了同一件事，又不依赖 DOM 结构。

## 5. 已知限制与未做

- **查找替换的范围是 `visibleRows`**：被折叠容器藏起来的行搜不到。这是有意的——作者折叠它就是把它收起来了，在看不见的地方替换是危险的。若以后要改成全场景，需要一并解决"跳过去时展开祖先"。
- **拖拽的落点在虚拟化下没有做逐像素回归**：视口内拖放、边缘自动滚动（滚动中持续挂载新行）都在真机验证过；`SortableContext` 拿的是完整 id 列表，dnd-kit 对未测量的 rect 全程有 guard（`verticalListSortingStrategy` / `getItemGap` 都判空），所以不会崩。**没验证**的是超长距离拖拽的落点精度是否与改动前逐行一致。
- **`yarn style:ratchet` 在本分支是红的，但不是本分支造成的**：`origin/develop` 自身就超基线（`raw-white-black-alpha` 62/53、`arbitrary-px-font` 8/3、`bare-or-arbitrary-rounded` 306/224、`raw-accent` 22/16），本分支 diff 对六个指标的净贡献**全部为 0**（逐行核过增删）。没有 `--save`，那会把别人的债洗进这次提交。已开一张独立任务处理基线与接入 CI。
- **诊断只有两条**（说话未入场、资产缺失）。语音状态已有自己的指示器，invalid 行已有自己的样式，都没有重复。问题面板的形态仍然是总计划 §9 的开放问题，本轮没有建。

## 6. 真机验收记录

全部在运行中的 Studio 上用 CDP 驱动验证：

- 密度：紧凑/舒适两档下三列中心偏移均为 0；换行行首行对齐。
- memo：一次点行触发的行体渲染数 = 0（临时探针计数，已移除）。
- 打字：插入槽 11 键，0 长任务；`/` 菜单、取补全（`/bg` → `/bg `，不提交）、Enter 提交并续行、两段 Escape 全部照旧。
- 虚拟化：402 行滚动无空洞无重叠；键盘下行 20 次跟随滚动且选中行在视口内；拖拽重排生效；拖到边缘自动滚动（8740 → 10604）并持续挂载新行。
- 指令手册：分类 chip 换行不再切半；`/show` 只在"角色"下出现一次，其余主题在详情里；详情含签名、别名、适用对象、参数表（含枚举全表、`Number ≥ 0`、必填/可选、参数别名）、示例、插入按钮。
- 查找替换：`Mod+F` 打开并聚焦；400 处匹配；Enter 逐个跳转并滚动；全部替换生效；**一次 `Mod+Z` 撤销整批**。
- 诊断：`First Day` 里 YouKi（未 `/show` 就说话）有警告，Nattou（第 10 行入场）没有。
- 背景行：满幅美术 → 右侧 180px 缩略条，文字恢复可读。

## 7. 给下一个人的三条

1. **行的 props 只能是数据。** 任何新回调都要走 `StoryRowActionsContext`，否则 memo 当场失效，整份文档回到每次交互全渲染。
2. **`SortableContext` 的 `items` 必须 memo。** dnd-kit 把它列进 context 的依赖，新数组 = 新 context = 所有 `useSortable` 消费者重渲染，`memo` 拦不住。
3. **虚拟化之后，"按 id 查 DOM 再 scrollIntoView"这个写法是坏的。** 行可能根本不在 DOM 里。用 `scrollRowIntoView(blockId)`（按 index 找虚拟化器），它返回 `false` 表示"这行根本不在可见集合里"，那才是旧的静默跳过。
