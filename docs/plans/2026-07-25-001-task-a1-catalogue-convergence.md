---
title: "task: A1 —— 目录收敛：侧栏改由 spec 导出、分类 13→8、指令改名与清理"
type: handoff
status: draft
date: 2026-07-25
parent: 2026-07-24-006-plan-story-action-model-alignment.md
---

# task: A1 · 目录收敛

你是执行者。**这是本轮风险最高的一张卡**：它删掉一份 57 条的目录、重排分类、并且改动的类别色是四处**已上线**功能的唯一色源。请按顺序做，不要跳步。

前置阅读：`docs/plans/2026-07-24-006-plan-story-action-model-alignment.md` 的 **§2（诊断 D1-D6）、§4.1、§4.2、§6、§8-M1、§12 全节**（§12 是编排层裁决，与正文冲突时以它为准）；bible `2026-07-19-001` §1（B1-B11）；M3 卡 `2026-07-23-001` §0 纪律与 §1 风格铁律**原样适用**。

分支：从 develop（`8ac74f4`+）切 `feat/story-a1-catalogue`。报告：`docs/plans/reports/2026-07-25-a1-report.md`（≤60 行，模板同前）。

**共享检出铁律**：逐文件 `git add <path>`，禁 `git add -A`/`.`，禁 `git stash`；**每次提交前 `git branch --show-current` 确认在自己分支上**（别的 session 会随时切走分支，已发生过）；**禁止 `git worktree remove`**——要 worktree 就建、用完留在原地交给 orchestrator（删除会顺 junction 清空主检出，已三次）。

## WI-0 前置核实（先做完再动手，结论写进报告）

§4.2 的整套自动导出机制建立在一个**断言**上：「`targetParam(accepts)` 的数据已经在 spec 里」。核实它：`accepts` 是否存在、是否覆盖所有带目标的指令、值域是否就是主语集合。

- 断言成立 → 照 §4.2 实施。
- 不成立或只覆盖部分 → **补齐 `accepts` 属于本卡范围**（不另立卡），但要在报告写明你核实到的现状与补了什么。
- 若发现 `accepts` 的语义与"这个动词能用于哪些主语"根本不同 → 停机报告，A1 的形状要重估。

## WI-1 类别色消费面盘点（硬前置，§12.3）

`ACTION_COMMAND_CATEGORIES` 的 `icon`/`iconColor` 不只喂侧栏，它是**四处已上线功能的唯一色源**：

1. 行左缘 2px 类别色条 + `BlockBadge` 底色（阅读层）；
2. `/` 空态的分类浏览网格（palette）；
3. spec 派生的指令手册；
4. 演出透镜的容器模式徽标（用 control 类别色）。

先把消费点全部找出来列进报告，再动分类表。8 个新分类必须**各自指派完整的 icon 与色值**，不得留空回退成灰、不得让任一处行视觉退化。这是本卡唯一会被作者一眼看见的风险。

## WI-2 分类 13 → 8（§4.1）

单一切分标准＝**主语**：角色 / 舞台 / 镜头 / 场景 / 声音 / 数据 / 流程 / 工具。原 `effects` 分类解散——displayable 系（`/transform` `/fx`）进「舞台」，全屏系（`/blink` `/vignette`）进「场景」。旁白归「角色」（NLR 的 `Narrator` 就是一个 Character，且与"谁在说话"是同一个选择）。

**`/camera` 必须落进「镜头」分类**——它是 8 分类里唯一空着的一格，A2 已经把指令做完了。

## WI-3 侧栏改由 spec 导出（本卡唯一新机械，§4.2）

归类规则：spec **有** target 参数 → 按 `accepts` 归入**每一个**主语（同一 spec 可出现在多个主语下，这正是解 D1 的关键：`/show` 一条覆盖五个主语，而不是十个入口）；spec **无** target 参数 → 按 `category` 归入分类。`category` 字段保留但语义收窄为"无目标指令的归属"。

侧栏项建块调用 `spec.build({}, ctx)`（bible 保证接受空 args 并返回合法默认块），得到目标未绑定的块，由 inspector 挑目标。`createBlockForCommand` 保留但降级为 spec 内部实现细节，不再是菜单入口。

**删除 `ACTION_COMMANDS`（57 条）整份目录**与 `conditionIf`（与 `condition` 构造器逐字相同）。

## WI-4 收藏夹迁移（§8-M1 的唯一真实迁移风险）

`story.actionCreator.starredActionIds`（设置键，见 `StoryActionCreatorPanel.tsx`）持久化的是 **palette command id**；删掉 `ACTION_COMMANDS` 后全部成为孤儿。必须给一张 `ActionCommandId → spec id` 映射做**一次性迁移**，无对应者（如 `conditionIf`）丢弃。**不要静默清空用户收藏**——这是停机级要求。迁移要有测试：旧 id 集合迁移后条目数不减（除 `conditionIf`）。

## WI-5 改名与别名清理（§3.6）

- `/var` → **`/save`**，`/var` 降为别名；`/persis` → **`/global`**，`/persis` 降为别名。
- `/swap` 删除别名 `setimg` / `settext`（它们在教"对象类型 × 动词"，与 B3 直接矛盾）。
- 改名**不影响已存文档**（文档存 payload 不存 command id），只影响肌肉记忆与 i18n 键——但请用测试确认这一点，别只靠推理。

## WI-6 bible 修订（立法文本，改要改准）

同步 §2 完整签名表里的改名与别名删除。另按 §12.5 写死一条护栏：**`/save` 只用于声明存档作用域变量；触发存档不是故事指令，将来也不会是**（存档是运行时/UI 关注点）——防止后来者占用这个 token。

## WI-7 i18n 退役与跨仓账（§12.4）

`story.actionCommand.<id>.label/detail`（约 114 键 × 语言数）随 `ACTION_COMMANDS` 退役，`story.command.<id>.*` 成为唯一来源。**记账不做**：已发布的插件语言包（`NarraLeaf/Plugins` 的 locales 包是全量覆盖式的）需要重新生成一版——在报告里点名，本卡不做。

## 明确不做

- payload 层把 character/image/text/layer 的 show/hide/transform 收敛进 `displayable`（§9：需 schema 迁移 + 编译器/inspector/快照/透镜全线改动，作者感知为零）。
- 音频 8 条合并、赋值糖合回 `/set`、三个声明合成 `/declare scope=`（§5.9/§5.10）。
- `/vfx` `/label` `/goto` `/rename` `/seek`（A3 与 A2 其余项）。
- 引入"简单/高级"双模式（已裁决否决，且它等于把"两张目录"合法化）。

## 验证与停机

`yarn lint` 全绿；vitest 新失败 0（win32 基线 `src/shared/utils/path.test.ts` 3 条列名即可）。**必须有的三条测试**（§10）：①`accepts` 归类——`/show` 同时出现在五个主语下；②收藏夹迁移——条目数不减；③改名不影响既有文档。

真机：侧栏按 8 分类浏览、`/show` 在多个主语下都能找到、**`/camera` 在「镜头」分类下可达并能建块**（这是 A2 留下的可达性缺口，本卡必须闭合）、行左缘色条与徽章在新分类下颜色正确、`/` 空态分类浏览与指令手册同步更新、收藏夹里的旧条目仍在。截图存 `docs/plans/reports/assets/`。

停机：WI-0 的断言不成立到 A1 形状要重估；类别色在 8 分类下无法既覆盖全部指令又保持行视觉不退化；收藏夹迁移会丢条目；单个 WI 规模超预估一倍。
