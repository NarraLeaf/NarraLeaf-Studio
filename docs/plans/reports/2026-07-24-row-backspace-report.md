# 行回格闭环 报告
分支/commits: feat/story-row-backspace-closure @ 1aadd1f（1 commit + 本报告，基于 develop a93c0d0）

## 状态
实现 done · 交互契约文档修订 done · 单测 +9 done · 真机 7 项 done

## 文件
- `storySceneBlockUtils.ts`: 新增 `planRowBackspaceReplacement(scene, ids)`（纯判定，返回 `{replaceBlockId, target}` 或 null）+ 私有 `acceptsPlainRows(parent)`。
- `useStorySceneEditorController.ts`: 新增 `replaceRowWithBlankLine(): boolean`，复用既有 `insertBlock(..., {target, replaceBlockId})`（先插后删、**一次** `recordHistory`），随后 `setEditorMode({kind:"text"})` 把光标落进新空行。
- `StorySceneEditorTab.tsx`: `backspace` 键位先试闭环，返回 false 再落到原来的 `deleteSelection({confirmMultiple:true})`。`delete` 键位一字未动。
- `docs/story-editor-interaction-model.md`: 键位表加 `Backspace` 一行（idle/编辑态/插入槽三列）+ 新章节「The Backspace ladder」（两级阶梯、三条排除、Delete 是另一条路）。
- 测试 `storySceneBlockUtils.test.ts` +9：单行动作行出计划、保父级与位置、多选/空选返回 null、有子块容器 null、无子块容器按叶子、文本行 null、条件分支（结构子）null、块不存在 null，以及用 `insertBlockInScene`+`deleteBlockFromScene` 施加计划断言「行数不变、位置不变、快照仍带原 payload」。

## 偏离与决策
- **排除面比卡片多一条**：除「有子块的容器」外，还排除**父级只收自己那种孩子**的行（条件的分支、菜单的选项）——把它们换成旁白行会造出非法树；且 `insertBlockInScene` 的父级校验会直接抛错。判定用 `acceptsPlainRows` 表达，比 `canAcceptChildren` 严：condition 与 choice 作父级不收普通行，`nvl` 同理（本模块视为容器，但 storyModel 的插入校验不认）。
- **无子块的容器按叶子处理**（卡片允许自裁）：空 `/parallel` 这类容器换成空行不摧毁任何东西，与既有空行回格的 `childrenIds.length > 0` 门槛同源。
- **文本行不进这条路**：`isTextEditableBlock` 为真的行（旁白/对话/选项/注释/choice prompt）本来就有自己的空行阶梯，回格语义不变。`invalid` 行按非文本行走闭环（它不是文本块）。
- 第二次回格**没有写任何新代码**：新空行是普通旁白文本行，落在既有 `handleBackspaceAtEmptyStart` 上。
- 无新文案/动画/样式，故**无 i18n 改动**。

## 验证
- lint: 隔离工作树 `npx tsc --project src/{shared,main,renderer,runtime}/tsconfig.json --noEmit` 四项全绿。共享检出上 `yarn lint` 有 2 个 `camera.effect` 报错，来自邻座未提交的 A2 相机 WIP，**不是本卡**（同一命令在只含本卡的工作树上 exit 0）。
- vitest: `storySceneBlockUtils.test.ts` 40 例全过（含新增 9）；story 范围 367 例仅 1 失败＝`storyCommandGhost` 的 `/camera` hint key 缺失，同为邻座 WIP 所致，新失败 0。
- 真机（隔离工作树 D:/Temp/nls-bs + CDP 9333 + demo3 副本，场景内手工塞了一个 `/parallel` 容器）：①选中 `Enter Nattou` 行回格 → 原位变空旁白行、光标在内、行数 16 不变（assets/…-01）；②Escape → 空行保留、行仍在（…-02）；③一次 `Mod+Z` → 动作行回来，存盘后与原始 storydoc **payload 逐字节相同**（…-03）；④再按一次回格 → 行消失、光标退回上一行（现有空行行为）；⑤有子块的 `/parallel` 回格 → 仍是整棵删除、无替换，undo 还原；⑥多选两行回格 → 弹「Delete 2 selected rows?」确认框，未替换（…-04）；⑦透镜（Timeline view）里把条形轨 `Move Nattou` 回格 → 自动回落成普通文本行、邻轨条形不变，零额外代码（…-05）；另：检查器开着时替换 → 卡片随之消失，无滞留（…-06）。`Delete` 键单独复核：仍是直接删行，一次 undo 还原。

## 风险与已知
- 检查器**取得焦点**时（Enter 开卡后焦点在右栏）回格不触发——键位作用域 `whenEditorFocused` 使然，与改动前的 Delete/Backspace 行为一致，非本卡引入。点回行上即正常。
- 判定层是纯函数、有测试；控制器接线（选区来源、编辑态守卫）只有真机覆盖。

## 重点验收（2 处）
1. `Mod+Z` 一次还原**含 payload**（报告 ③，已用磁盘 storydoc 对比原始工程，非仅看行标签）。
2. 排除面：容器/多选/结构子行三类都不走替换（⑤⑥ + 单测），确认这条比卡片严的边界符合裁决。

## ⚠ 共享检出冲突（需 orchestrator 处理）
本卡工作期间，另一 session 在**同一检出**上把 HEAD 切到了 `feat/story-a2-camera`，并在我正在改的 `storySceneBlockUtils.ts` 里加了相机图标/描述改动。处理：我只暂存了自己的 hunk（`git apply --cached` 单 hunk）提交，随后把提交移到本卡分支并把对方分支 `git reset` 回原位，**未动对方任何未提交内容**；后续文档/资产提交改在隔离工作树 `D:/Temp/nls-bs`（本卡分支）完成。共享检出当前 HEAD 仍是 `feat/story-a2-camera`。`D:/Temp/nls-bs` 与其 `node_modules` junction 按纪律**不由我删除**，留给 orchestrator（先 `rmdir` junction 再 `worktree remove`）。
