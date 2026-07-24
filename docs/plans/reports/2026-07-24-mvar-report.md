---
title: "report: M-VAR — 蓝图 persistent 注册表迁移与合并视图"
type: report
status: in-progress (paused)
date: 2026-07-23
parent: 2026-07-23-007-task-mvar-registry.md
---

# M-VAR 报告（WI-1 完成；WI-2/3/4 暂停待共享树同步）

分支：`feat/story-mvar-registry`（从 develop `7e61949` 切）。
commits：`95d6666`（WI-1）。未合并未 push。

## 状态

- **WI-1 `VariableRegistryService`：done**（见下「文件」「验证」）。
- **WI-2 干净切换：BLOCKED**（共享树碰撞，见「停机裁决」）。
- **WI-3 合并视图：BLOCKED**（同 WI-2）。
- **WI-4 Ref 对称化：HALTED**（story schema v9 需 v8 先落 develop；对方 v8 目前是共享树里的未提交 WIP，未落地——命中卡面「若需要 bump 时 v8 尚未在 develop 落地，停机找 orchestrator」）。

用户裁决（2026-07-23）：**暂停待对方工作落地**。对方把 inline-expression（storyCompiler.ts / StorySceneActionInspector.tsx / story/document.ts v8）提交进 develop、工作树转干净后，rebase 续做 WI-2→WI-3→WI-4。

## 启动门

动手前 `git status` **干净**（src/main、蓝图模块、BlueprintDocument 消费链无他人脏文件）。门通过，开始 WI-1。

**工作期间共享树被并行 session 污染**（非启动时状态）：inline-expression 执行者的未提交改动陆续出现在共享检出，波及我 WI-2/WI-3 必改文件。详见「停机裁决」。

## WI-1 文件（本次交付）

新增：
- `src/shared/types/variables/registry.ts` — `VariableRegistryEntry`/`VariableRegistry`/`PersistentVariableRuntimeTable`，`VARIABLE_REGISTRY_SCHEMA_VERSION=1`（独立于 story/blueprint 版本）。entry 形状对齐故事变量（`{id,name,valueType(4值),defaultValue,storageKey,description?}`）。
- `src/shared/variables/variableRegistryModel.ts`（+`.test.ts`，9 测试）— 纯操作：`normalizePersistentValueType`（收敛 4 值闭集）、`registryEntryFromBlueprintPersistent`/`seedRegistryEntriesFromBlueprintPersistent`（**id 取 storageKey 保稳定** + 分歧 id 的节点参数 remap 表）、`migrateVariableRegistryToLatest`、`listRegistryEntries`、`buildPersistentRuntimeTable`。
- `src/renderer/lib/workspace/services/variables/VariableRegistryService.ts` — 镜像 `UIGraphService`（拥有 `editor/variables.json`、迁移-on-load、revision+去抖自动保存、变更事件）。CRUD（create/rename/setValueType/setDefault/setDescription/delete）+ `getRegistry`/`listEntries`/`applyRegistryMutation`/`replaceRegistry`（供历史恢复）。首次打开 pre-M-VAR 项目时从 `uiGraphService.consumeLegacyPersistentVariables()` 播种。

改：
- `nameConvention.ts` — 新增 `EditorVariableRegistry: ["editor","variables.json"]`（editor 根，跨切面 blueprint+story，不打包）。
- `services.ts` — `Services.VariableRegistry` 枚举 + `IVariableRegistryService` 接口 + 导出；`IUIGraphService.consumeLegacyPersistentVariables`；`ILocalBlueprintService.createPersistentVariable` 返回 `VariableRegistryEntry`。
- `serviceRegistry.ts` — 注册 `VariableRegistryService`。
- `UIGraphService.ts` — 在 `migrateIfNeeded` 读原始（迁移前）`persistentVariables` 存入一次性 `legacyPersistentVariables`，`consumeLegacyPersistentVariables()` 取用即清（读原始对象，字段脱离类型后仍可读，供 WI-2）。
- `LocalBlueprintService.ts` — persistent CRUD 改为「历史事务包裹 + 委派注册表」；`BlueprintEditorHistorySnapshot` 扩 `registry` 字段，capture/restore 纳入注册表快照，**persistent 变更自此可 Ctrl+Z**（此前不可撤销——快照不含该字段，before==after，`recordBlueprintHistory` 空转）。`listPersistentVariables()` 读注册表。
- `BlueprintMemberTree.tsx` — persistent 区改读注册表；因注册表变更不 bump 蓝图 revision，加 `onRegistryChanged` 订阅驱动重渲染。

`listPersistentVariables()` 返回类型 `BlueprintPersistentVariable[]`→`VariableRegistryEntry[]`：四处消费方（StoryVariablesPanel/StorySnapshotPanel/StorySceneEditorRows/ConditionEditor）均以 `?? "string"` 或 `as` 兜底，非可选 4 值 `valueType` 兼容，**无需改动**（含禁改文件 StorySceneEditorRows）。

## WI-1 undo 现状核对与对齐（卡面要求）

核实：并行前，蓝图 persistent CRUD 走 `applyBlueprintEdit`，但历史快照**不含** persistentVariables → before/after 相等 → `recordBlueprintHistory` 提前返回 → **实际不可撤销**（既有缺陷）。对齐动作：扩快照纳入注册表，persistent CRUD 走 `runBlueprintHistoryTransaction`，改为**可撤销**（严格改进，非回归）。测试锁定（create/rename/delete → undo/redo）。

## 验证（WI-1）

- `tsc`（shared + renderer）：我的 WI-1 面**零错误**。残余错误全属并行执行者未提交 WIP（shared: `localizationText.ts`；renderer: `RichTextInput/View.tsx`）——非我引入，见下。
- vitest：`variableRegistryModel.test.ts`（9）+ `LocalBlueprintService.test.ts`（10，含新 persistent CRUD undo/redo）全过；ui-editor services 目录 110 全过。
- 全绿 `yarn lint` 当前**不可达**：并行执行者的未提交非编译 WIP 在共享树里，污染整树 tsc。这不是我的代码问题。
- 真机：WI-1 无独立真机验收项（卡面真机项属 WI-2/3 完成后）。

## 停机裁决（WI-2/3/4）

并行 inline-expression 执行者在**同一共享检出**里 live 编辑，未提交改动工作期间不断扩散，命中我 WI-2/WI-3 **必改**文件：

| 文件 | 我为何需要 | WI |
|---|---|---|
| `runtime/game/storyCompiler.ts` | `collectPersistentKeys:156` 读将删的字段；四处 warn+skip 校验点 | WI-2/WI-3 |
| `scene-editor/StorySceneActionInspector.tsx` | persistent 选择器 `useStoryVariableOptions`/`refVariableId`/`makeVariableRef` 读将删字段 | WI-2/WI-3 |
| `types/story/document.ts` | `StoryVariableRef` persistent 臂；对方已 bump `STORY_DOCUMENT_SCHEMA_VERSION` 7→8 | WI-4 |

删 `BlueprintDocument.persistentVariables` 是原子操作（一次性打断所有消费方），故 WI-2 无法在不改这两个脏文件的前提下编译通过。命中 M3 §0 铁律「必须编辑的文件已带别人未提交改动 → 停下报告」+ 启动门对 BlueprintDocument 消费链的看护。共享树单份文件副本，硬改有覆盖对方未提交工作之险。→ **停机**，用户裁决暂停待落地。

**已就绪的干净文件**（对方未碰，续做即可快速推进）：`blueprint/document.ts`（删字段）、`shared/blueprint/migrateBlueprintDocument.ts`（v8→v9 迁移 + 节点参数 remap）、运行时派发（`BlueprintDispatcher`×7 / `BlueprintValueEvaluator` / `storyActionBlueprint`×3 / `GameApp`/`StageSlotSurfaceShell` ~30 处 `bundle.ui.localBlueprints` 旁挂）、`behavior-graph`（`BehaviorNodeExecutionContext.persistentVariables` 中心缝 + `GraphExecutor`/`executeGraphSync`）、`devModeBlueprintHostAdapter`、`bundleAssembler`（+ game pack 编译器，读 `variables.json` 灌入 bundle）、`documentValidation`（去硬断言）、`graphValidation`/`graphVariableTypeInference`、`blueprintFactories`（去 `persistentVariables:{}` 初值）、`BlueprintEntryTab`/flow 选择器、`searchIndexModel`、`projectStatsSnapshot`、`storyCommandContext`（WI-3 合并点）。

## 续做清单（tree 干净后）

1. rebase 到含对方 v8 的 develop。
2. WI-2：删字段 → `migrateBlueprintDocumentToLatest` v8→v9 剥离 + 节点参数 remap（`seedRegistryEntriesFromBlueprintPersistent` 的 idRemap）；bundle/pack 从注册表灌 `PersistentVariableRuntimeTable`，10 处派发改读新选项（中心缝 `BehaviorNodeExecutionContext.persistentVariables`）；`bundleAssembler`/game pack 读 `variables.json`；`documentValidation` 去硬断言；search/stats 改读注册表或合并视图。
3. WI-3：纯函数合并视图（注册表 + `storyPersistentDefs` 扫描），供 `collectPersistentKeys`（四处 warn+skip 改查合并视图）、`storyCommandContext.variableEntries`、蓝图成员树；同名冲突产编译诊断（与既有同族措辞）。
4. WI-4：**取号需与 orchestrator 确认 v9**（v8 落 develop 后）；`StoryVariableRef` persistent 臂 `storageKey`→`variableId`（story v9）；`storyVariableRefKey`（`expression.ts:134-136`，唯一机械缝）化简 `scope:variableId`；迁移仅对「无故事声明行对应的 storageKey」建注册表条目；往返测试锁旧引用零语义变化。

诊断措辞留档（WI-3 复用，storyCompiler 现四处）：
- 插值：`"Persistent variable not found; interpolation skipped."`
- 赋值（表达式读/字面 /set）：`"Persistent variable not found; the assignment was skipped."`
- 条件 /if：`"Persistent variable not found; condition evaluates false."`
