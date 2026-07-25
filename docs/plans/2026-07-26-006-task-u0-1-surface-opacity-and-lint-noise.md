---
title: "task: U0.1 编辑面不透明度改为可配置 + 撤掉 speakerNotShown 噪声"
type: task
status: ready
date: 2026-07-26
plan: 2026-07-26-004-plan-ui-professionalization.md
branch: feat/ui-u0-1-surface-opacity
---

# task: U0.1 尾款

U0 已并入 develop（`c87efba8`）。用户在验收后给了两条修正，本卡处理这两条，**不扩面**。

## 0. 分支与提交纪律

- 从 `develop`（`c87efba8`）切 `feat/ui-u0-1-surface-opacity`。
- 逐文件 `git add`，**禁止 `git add -A`**（共享检出）。每个 WI 完成即 commit。不合并、不 push。
- 禁止 `git worktree remove`、禁止 `git stash`。

## 1. 风格铁律

- 复用既有组件与既有设置机械。**UI 里不要解释性文本**。不新增依赖、不引入新配色。

## 2. WI-1 编辑面不透明度改为可配置

**用户原话**：「关于故事编辑器背景不透明，应该能够在设置的编辑器配置中配置，而不是强制不透明造成割裂感。
因为背景图是可选配置功能。」

U0 的 WI-4 把三处表面钉死成 `bg-surface-sunken`。问题是：工作区壁纸开着时，中间正文成了一块硬邦邦的
不透明矩形，四周却是半透明的——**接缝比壁纸本身更难看**。壁纸是可选功能，不透明度也该是。

- **新设置 `editor.surfaceOpacity`**：加进 `src/renderer/lib/settings/appSettings.ts` 的声明表，
  `category: "editor"`、`scope: Global`、`type: Integer`、`min: 0`、`max: 100`、`step: 5`、`unit: "%"`。
  **照抄 `zoomPercent` 那一条的形状**（它已经是 Integer + `unit: "%"`），零新机械、零新控件。
- **默认值 100**（=当前行为）。理由写进注释：没设壁纸的用户看不到任何差别，这个设置对他们是惰性的；
  设了壁纸的用户现在有了旋钮，可以自己调到不割裂的位置。**默认值不许改成别的，除非 orchestrator 另行指示。**
- **消费点**：U0 改动过的三处表面（故事编辑器正文滚动区、右栏检查器字段区、Dev Mode 调试面板体）。
  实现走**一个 CSS 变量**（沿用 `storyEditorTextStyle.tsx` 已有的 `STORY_ROW_BOX_VAR` 那套 CSS 变量惯例），
  不要在三个组件里各写一份读设置的逻辑。读取沿用 `getGlobalState` + window focus 重读的既有范式
  （`storyEditorTextStyle.tsx` 里就是这么读 `editor.fontSize` 的）。
- **0% 必须真的是完全透明**（回到 U0 之前的样子），**100% 必须真的是完全不透明**（alpha 严格等于 1，
  不是 0.99）——orchestrator 会在两端各量一次。
- i18n：`settings.items.editorSurfaceOpacity.label` / `.description`，en + zh 都要加
  （仓里有 en/zh key 对齐测试，缺一边会挂）。

**判据（orchestrator 亲验，壁纸开启态下）**：
- 设置面板 editor 分类下出现该项，拖动即时生效、重启后保持；
- 100% 时正文背板 alpha == 1 且正文对比度 ≥ 7:1；
- 0% 时正文背板无不透明祖先（回到旧行为）；
- 三处表面同步变化，不是只有故事编辑器变。

## 3. WI-2 撤掉 `speakerNotShown` 诊断

**用户原话**：「那个角色不在舞台上的警告是噪声，因为角色不一定需要在舞台上才说话。」

判断成立：画外音、电话、隔壁房间、旁白式角色——不入场就说话是视觉小说的常规写法，不是错误。
实测 demo3 `First Day` 12 行里有 **5 行**挂着这个黄三角，信噪比已经翻转。

- 删除 `storyRowDiagnostics.ts` 的 `speakerNotShown`：类型联合成员、`diagnoseRow` 里那段判断、
  以及它需要的 `appearance` 入参（若删干净后 `StoryRowDiagnosticInput.appearance` 无消费者就一并删）。
- 删对应的 i18n key（en + zh 两边）与它的单测用例。
- **`missingAsset` 保留**——指向已不存在的资产是无歧义的错误，与本条无关。
- 不要改成"默认关闭的设置项"、不要留 dead code、不要在别处补一个"提示"。**删掉就是删掉。**

**判据（orchestrator 亲验）**：打开 demo3 `First Day`，**12 行里的黄三角数量为 0**
（该场景没有缺失资产）；构造一个指向已删资产的行，`missingAsset` 仍然出现。

## 4. 明确不做

- 不动 U0 已验收的其余部分（跳转、面板挤压布局、Dev Mode chrome）。
- 不动故事编辑器的行结构、密度、头像、导轨（U1）；不动资产面板（U3）；不动时间线投影（U4）。
- 不给 `speakerNotShown` 找替代呈现方式。
- 不改壁纸功能本身（加载、设置、渲染路径一律不碰）。

## 5. 自验要求（报告里逐项给结果）

1. `yarn lint`（tsc）全绿。
2. vitest 相关范围新失败为零（含 i18n key 对齐测试与 `storyRowDiagnostics.test.ts`）。
3. `yarn build:apps:dev` 全绿。
4. 自己用 `tools/ui-verify/drive.js` 走一遍两个 WI 的路径。**你的截图不构成验收。**

## 6. 反馈报告

`docs/plans/reports/2026-07-26-U0-1-report.md`，**≤40 行**，模板同 U0 卡 §7。

## 7. 何时必须停下来报告

- `editor.surfaceOpacity` 无法用一个 CSS 变量覆盖三处表面（说明 U0 的实现分散了，要先讲清楚再动）。
- 删 `speakerNotShown` 牵出 `buildDialogueAppearances` 的其他消费者。
- 触碰区有其他 session 的未提交改动。
