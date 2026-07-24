---
title: "task: M-VAR — 蓝图 persistent 注册表迁移与合并视图（bible §3.1/3.2 按 §10 裁决）"
type: handoff
status: draft
date: 2026-07-23
parent: 2026-07-22-001-feat-story-editor-overhaul.md
---

# task: M-VAR 变量注册表

你是执行者。前置阅读：bible `2026-07-19-001` §3 全节 + **总计划 `2026-07-22-001` §10 追加裁决（覆盖 bible §3.1 的"持有全部"表述——注册表只收蓝图侧 persistent，故事 `/persis` 声明行不动，消费方读合并视图）**；M3.1 报告的"WI-4 现状核对"（爆炸半径测绘：~27 生产文件+~19 测试、Dispatcher×7/Evaluator/executors 消费链）；M3 卡 §0/§1 纪律铁律原样适用。分支：从 develop（`2e8f615`+）切 `feat/story-mvar-registry`。报告：`docs/plans/reports/2026-07-24-mvar-report.md`。

**启动门（沿 M3.1）**：动手前 `git status` 检查 src/main/**、蓝图模块、`BlueprintDocument` 消费链是否有他人脏文件；有 → 停机报告，不部分启动。
**并行协调（硬性）**：另一执行者做行内表情卡（scene-editor 富文本+编译器 sentence 段+引擎）。story schema 版本预分配：**对方 v8、你 v9**——若你需要 bump 时 v8 尚未在 develop 落地，**停机找 orchestrator 同步**，不要自行取号。蓝图 schema 取当前+1。两卡文件交集应为零；你不碰 `StorySceneEditorRows/RichText*/storyQuickParams/buildSentenceParts`。

## 工作项

- **WI-1 `VariableRegistryService`**：项目级注册表（新项目数据文件），条目 `{id, name, valueType(4 值闭集), defaultValue, storageKey, desc?}`；CRUD+变更事件；undo 进既有 history 通道（bible §3.5 已为声明行铺过注册表逆操作的先例——核实其现状后对齐）。UI：变量面板的蓝图 persistent 区改读注册表（现状先侦察）。
- **WI-2 干净切换**：`BlueprintDocument.persistentVariables` 字段**删除**；全部消费者（Get/Set Persistent 节点、成员树、编译、运行时、stats、搜索索引）改读注册表；蓝图 schema 迁移把既有声明搬进注册表（id 取 storageKey 保稳定）；无双读路径、无兼容垫片（bible"已确认无需考虑现状兼容"）。`/persis` 自此不依赖全局蓝图 owner。
- **WI-3 合并视图**：一个纯函数层合并「注册表条目 + 故事声明行扫描（`declarations.ts` 派生表）」供三处消费：编译器 persistent 校验（M3 已落的四处 warn+skip 改查合并视图）、变量面板、蓝图成员树。同名冲突（注册表 vs 声明行）→ 编译诊断（与既有诊断同族措辞）。
- **WI-4 Ref 对称化**：`StoryVariableRef` persistent 臂 `storageKey` → `variableId`（story schema → **v9**，见并行协调）；迁移按 storageKey 建注册表条目（仅当该 storageKey 无故事声明行对应——声明行的 persistent 不进注册表，其 variableId 即块 id）；`storyVariableRefKey` 化简 `scope:variableId`。旧引用零语义变化用迁移测试锁定。

顺序 1→2→3→4；WI-4 可按裁剪规则顺延（报告注明）。子代理授权同 M3 卡 §0。

## 验证与停机

lint 全绿；vitest 新失败 0，bible"测试全绿为闸门"适用（迁移往返、合并视图冲突诊断、消费链等价行为）；真机：蓝图 Get/Set Persistent 节点在 Dev Mode 正常读写、变量面板两来源并列显示、`/persis` 无蓝图项目不再静默失败。停机：启动门脏；schema 取号冲突；消费链中出现无法等价迁移的用法（报告实例）；单 WI 超预估一倍。
