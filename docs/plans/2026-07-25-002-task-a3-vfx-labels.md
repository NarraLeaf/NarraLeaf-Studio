---
title: "task: A3 —— /vfx 氛围特效、/label + /goto，以及 A2 余项（/rename、video 四操作）"
type: handoff
status: draft
date: 2026-07-25
parent: 2026-07-24-006-plan-story-action-model-alignment.md
---

# task: A3 · 新元素与流程

你是执行者。前置阅读：`docs/plans/2026-07-24-006-plan-story-action-model-alignment.md` 的 **§5.5、§5.6、§5.11、§7.2、§7.3、§7.4、§7.5、§8-M3、§12.6、§12.7**；bible `2026-07-19-001` §1（B1-B11）；M3 卡 `2026-07-23-001` §0 纪律与 §1 风格铁律**原样适用**。

分支：从 develop（`2e0d1d7`+）切 `feat/story-a3-vfx-labels`。报告：`docs/plans/reports/2026-07-26-a3-report.md`（≤60 行，模板同前）。

**共享检出铁律**：逐文件 `git add <path>`，禁 `git add -A`/`.`，禁 `git stash`；**每次提交前 `git branch --show-current`**（别的 session 会切走分支，已发生两次）；**禁止 `git worktree remove`**（会顺 junction 清空主检出，已三次）。

**A1 刚落地，你是它的第一个真实检验者**：分类色现在由 `STORY_COMMAND_GROUPS`（`storyCommandCategories.ts`）按分类 id + 主语 id 持有，且**类型系统封闭**——你新增 `vfx` 这个 stage-object kind 时，`tsc` 会先失败，直到你给它建一个带颜色的 group。**这是设计如此，不是障碍**：照做，并在报告确认这条闭环真的咬住了（若它没咬住，那是 A1 的缺陷，报告说明）。同时 A1 的色值现在有钉值测试（`specSidebar.test.ts`），新增 group 要同步补钉值。

## WI-0 A2 余项（先做，都很便宜）

A2 卡只做了 `/camera`，计划 §8-M2 的另外两项留到这里：

1. **`/rename`**（§7.4）：`action.character` 的 `operation` 增加 `"setName"`，带 `displayName: string`，编译落点 `character.setName(name)`。用途是"？？？"→ 真名这类叙事揭示。
2. **video 四操作**（§7.3）：`action.video` 的 `operation` 增加 `pause | resume | stop | seek`（`seek` 带 `timeMs`），并把 `/stop` `/pause` `/resume` 的 `targetParam` accepts 加入 `"video"`；只新增 `/seek` 一个 token，其余靠泛型动词吸收。
   **歧义规则（必做）**：`/pause` 无目标时按 B4 默认 BGM；有目标时按解析出的对象类型分派。ghost 提示要显示将要作用的对象，别让作者以为在操作音频。

## WI-1 `/vfx`（§5.6、§7.2）

`Vfx` 是 0.16.0 的新元素：循环视频做全屏氛围叠加（落花/雨雪/尘埃/光斑），**不是 Displayable**。

- 新 `action: "vfx"`，`operation: create | show | hide | pause | resume | setRate`；字段见 §7.2（`objectName`、`assetId`、`blendMode`、`opacity`、`loop`、`fit`、`zIndex`、`rate`、`durationMs`）。
- 只新增 `/vfx` 一个 token；`/show` `/hide` `/pause` `/resume` `/rate` 靠泛型动词吸收——`create` 要参与 `displayableSourceIdentity` 使目标解析找得到它。
- **`accepts` 必须排除 vfx 于 `/transform` 与 `/fx` 之外**（它不是 Displayable，给它变换是无意义的）。这条要有测试。
- 资产复用视频类型。两条素材路线（true-alpha WebM 用 `normal` 混合、黑底辉光用 `screen`）在检查器里给出选择——**用字段与选项命名表达，不写教程文案**（风格铁律；A2 的"镜头 · 跨场景保留"是同类做法的样板）。

## WI-2 `/label` + `/goto`（§5.11、§7.5、§12.6）

- `control: "label"`（`name`）与 `control: "goto"`（`targetLabel`），编译落点 `Control.label(name)` / `Control.jump(name)`（引擎 0.16.0 已有）。
- **编译期校验（必做）**：`goto` 的目标标签必须存在于**同一场景**，否则引擎构建会失败——Studio 必须在编译期出诊断，不能让作者拿到一个构建失败的产物。同名标签重复声明同样出诊断。诊断措辞与既有同族一致。
- **`/goto` 的标签补全**：按 §12.9 复用 `StoryCommandContext` 的扫描路径（与变量表同构，同一份场景扫描）；不可复用时新建纯函数扫描器——**不要**在 completion 层写指令特例（bible 明令）。
- **与 `/jump` 的区分**：`/jump` 跳场景会卸载并重初始化；`/goto` 只移动播放头。两条指令的说明文案必须互相点名（这属于 spec 的 detail 文案，不是界面上的解释性段落）。

## WI-3 工具连坐（§12.6、§12.7 —— 本卡最容易被漏掉的部分）

1. **演出透镜**：`/vfx` 的 `durationMs` 要进 `deriveBlockTiming`（`storyStagingLens.ts`），否则它在 `/parallel` 里是未知时长的等宽虚条。补投影测试。
2. **Dev Mode 热跳**：`goto` 让**行序 ≠ 执行序**，而时间线热跳按行序判断"目标在当前之后"才用 `fastForward({until:{actionId}})`。既有兜底是 `reachedTarget:false → 静默回落冷跳`。**你必须实证这条兜底在 label 循环下成立**（构造一个 `/label` + `/goto` 往回跳的场景，在 Dev Mode 时间线上点一个"看起来在后面、执行上永远先到不了"的行）。引擎侧另有 `maxSteps` 兜底，不会空转。
3. **场景流程图**：`goto` 是场内跳转，**不进场景图**（与 M6 的边界一致）。不要顺手加。

## 明确不做

- payload 层把 show/hide/transform 收敛进 `displayable`（§9）；`/fx` 的 `backdrop`/`blend`（A4）；`Control.whileLoop`/`breakLoop`（§9：VN 场景罕见）；Vfx 的 wearable 类专业能力。
- 相机姿态进 stage snapshot（既有追踪项，不在本卡）。

## 验证与停机

`yarn lint` 全绿；vitest 新失败 0（win32 基线 `src/shared/utils/path.test.ts` 3 条）。必须有的测试：`vfx` 不出现在 `/transform` `/fx` 的可选目标里；`goto` 指向不存在标签 / 重名标签各出一条诊断；`/pause` 的目标分派（无目标→BGM，有 video 目标→video）；vfx 时长进透镜。

真机：`/vfx` 放一个循环素材看实际叠加与混合模式、`/label` + `/goto` 往回跳在 Dev Mode 里实际生效、`/rename` 改名在对话框显示、video 的 pause/resume/stop/seek 各跑一次、并行容器里 vfx 条形按比例。截图存 `docs/plans/reports/assets/`。

停机：`Control.label`/`jump` 的引擎语义与 §7.5 假设不符；`vfx` 的目标解析与既有 `displayableSourceIdentity` 冲突；A1 的类型闭环没有咬住（说明 A1 有缺陷，报告后我来处理）；单个 WI 规模超预估一倍。
