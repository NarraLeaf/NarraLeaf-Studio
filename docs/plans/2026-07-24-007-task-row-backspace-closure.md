---
title: "task: 行回格闭环 — 选中动作行按回格清空为空行，再按回格退回上一行"
type: handoff
status: draft
date: 2026-07-24
parent: 2026-07-22-001-feat-story-editor-overhaul.md
---

# task: 行回格闭环（小卡）

你是执行者。这是一条**交互契约补全**：需求方指出故事编辑器缺了一个文本编辑器里天经地义的闭环，补上后行为与 VS Code 一致。

前置阅读：`docs/story-editor-interaction-model.md` **全文**（它是契约，本卡要修订它——修订属于交付物）；`docs/plans/2026-07-16-003-handoff-story-row.md` 的 "The rest of the model — already landed, don't renegotiate"；M3 卡 `2026-07-23-001` §0 纪律与 §1 风格铁律**原样适用**（逐文件 `git add`，共享检出有他人 WIP，禁 `git add -A`、禁 stash）。

分支：从 develop 切 `feat/story-row-backspace-closure`。报告：`docs/plans/reports/2026-07-24-row-backspace-report.md`（≤40 行，模板同前）。

**并行提示**：另有执行者在做 0.16.1 采纳（编译器/转场）与 M6（资源总览/流程图），与本卡文件交集小但同处 scene-editor 周边——遇到你要改的文件带着别人的未提交改动，停下报告。

## 目标行为

**选中一个非文本行（未在编辑态）按 `Backspace`：该行被替换为一个空行，光标进入其中。**此后一切沿用既有规则，不发明新状态：

- `Escape` 离开编辑 → 空行**保留**（行仍在，处于选中态）。这与"Escape 从不销毁"一致。
- 失焦 → 按既有的"纯文本失焦落旁白"规则提交，空行保留。
- **再按一次 `Backspace`**（此时是一个空文本行）→ 走**既有的空行回格行为**（回到上一行 / 降级为插入槽，现状是什么就是什么）——**不要**为此发明第二套路径。

一句话：动作行在两次回格里退化成"空行 → 没有"，与作者对文本编辑器的肌肉记忆一致。

## 约束与边界（逐条自验）

1. **一步 undo**：动作块 → 空行是**一个** history 条目，`Mod+Z` 一次即完整恢复原动作块（含其 payload）。这是本卡最重要的正确性要求。
2. **只在单行选中时生效**。多行选中的 `Backspace` 保持现状（不要把它改成逐行替换）。
3. **只对叶子行生效**。带子块的容器行（condition/parallel/race/sequence/repeat、choice 及其选项）**排除**——把容器换成空行会静默摧毁整棵子树。容器行的 `Backspace` 保持现状。若容器**无子块**，可以按叶子处理（自行判断，报告说明取舍）。
4. **`Delete` 键语义不变**（直接删除行）。回格与删除是两条不同的路径，不要合并。
5. 替换出来的空行是**普通空文本行**（旁白），不是插入槽、不是草稿行、不是 invalid 行——它必须是一个真实存在、可被保留的块。
6. 行号、选择、拖拽、右栏检查器联动等既有语义不受影响；替换发生后检查器应随之更新（原动作行的检查器内容不能滞留）。
7. **与演出透镜（M7）的互动**：透镜内的条形轨按本规则被替换成文本行后，会自动回落到普通行渲染（M7 已有 `lensTrackRendersBar` 判定）——确认这条链路顺畅，不需要额外代码，但要实测一次。
8. 风格铁律照旧：不加任何提示文案/动画/新样式。

## 交付物

- 实现（落点大概率在 `useStorySceneEditorController.ts` 的键盘路由 + 一个 StoryService/history 侧的"替换块"操作；`StorySceneEditorRows.tsx` 视情况）。
- **`docs/story-editor-interaction-model.md` 的修订**：把这条闭环写进键位表与相应叙述（它现在只描述了编辑态内的 Backspace 与空插入槽的 Backspace，缺"选中行"这一格）。
- 单测：一步 undo 还原原 payload、多选不触发、容器行不触发、替换后行数不变（是替换不是删除）。

## 验证与停机

`yarn lint` 全绿；vitest 新失败 0 + 上述新增测试。真机：选中一个 `/show` 行连按两次回格，观察"变空行 → 退回上一行"；中途 Escape 确认空行保留；`Mod+Z` 一次还原原动作行；在 `/parallel` 容器的透镜视图里重复一次。截图/短录屏存 `docs/plans/reports/assets/`。

停机：一步 undo 无法做到（history 通道不支持替换语义时，报告方案而不是拆成两步——两步 undo 会让作者按一次 `Mod+Z` 得到一个空行，那比不做还糟）；或与既有空行回格行为冲突到需要改动后者（那属于契约变更，交 orchestrator）。
