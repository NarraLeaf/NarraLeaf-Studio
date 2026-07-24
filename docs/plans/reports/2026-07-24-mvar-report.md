---
title: "report: M-VAR — 蓝图 persistent 注册表迁移与合并视图"
type: report
status: done
date: 2026-07-24
parent: 2026-07-23-007-task-mvar-registry.md
---

# M-VAR 报告（WI-1/2/3/4 全部完成）

分支：`feat/story-mvar-registry`，rebase 到 `feat/story-inline-expression`（含对方 v8）之上。
commits（`@` 前缀已 filter-branch 清理）：
- `fbe350a` WI-1 · `6701dea` WI-2 · `a2f0282` WI-3 · `93da1e0` WI-4
- `841b289` 过程报告（WI-1 阶段，本文件历史版本）
未合并未 push。

## 状态总览

| WI | 内容 | 状态 |
|---|---|---|
| WI-1 | `VariableRegistryService`（项目级注册表 `editor/variables.json`） | **done** |
| WI-2 | 删 `BlueprintDocument.persistentVariables`，蓝图 schema v8→v9，全消费链改读注册表 | **done** |
| WI-3 | 合并视图纯函数 + 编译冲突诊断，供编译器/命令上下文/变量面板 | **done** |
| WI-4 | `StoryVariableRef` persistent 臂 `storageKey`→`variableId`，story schema **v9** | **done** |

## 启动门与并行协调

- 动手前 `git status` 干净（门通过）。工作期间共享树被并行 inline-expression session 污染，波及 WI-2/3 必改文件（storyCompiler.ts / StorySceneActionInspector.tsx / story/document.ts v8）→ WI-1 完成后**暂停**（用户裁决），待对方工作落地。
- 对方 inline-expression **完成并提交**后（用户告知），rebase 本分支到 `feat/story-inline-expression`（WI-1 commits 无冲突重放），绿基线恢复，续做 WI-2/3/4。
- **story schema v9 取号**：卡面预分配「你 v9」；对方 v8 已提交（在本分支 base，尚未落 develop）。按卡面「不要自行取号，停机找 orchestrator」，**已与 orchestrator 确认取 v9**，方实施 WI-4。orchestrator 于最终合并时将 v8→develop 与本分支 v9 一并 reconcile。
- 蓝图 schema 取当前+1 = **v9**（本人独占，无需协调）。

## WI-1 VariableRegistryService

新增 `src/shared/types/variables/registry.ts`（entry 对齐故事变量：`{id,name,valueType(4值),defaultValue,storageKey,description?}`，`PersistentVariableRuntimeTable`，`VARIABLE_REGISTRY_SCHEMA_VERSION=1`）、`src/shared/variables/variableRegistryModel.ts`（+`.test`：4 值归一、seed-from-blueprint（**id 取 storageKey 保稳定** + 节点参数 remap 表）、迁移、运行时表投影）、`src/renderer/lib/workspace/services/variables/VariableRegistryService.ts`（镜像 `UIGraphService`）。CRUD 委派进注册表；`BlueprintEditorHistorySnapshot` 扩 `registry` 字段，persistent CRUD **自此可 Ctrl+Z**（此前快照不含该字段 → before==after → 空转，实际不可撤销；这是「核实其现状后对齐」的结果）。成员树/面板改读注册表。

## WI-2 干净切换（爆炸半径 ~48 文件）

- 删 `BlueprintDocument.persistentVariables`（`BlueprintPersistentVariable` 类型保留为迁移输入）。蓝图 schema **v8→v9**：`migrateBlueprintDocument` 剥离字段 + 节点参数 `persistentVariableId` 按 idRemap 重映射（id===storageKey 时为 no-op）。`documentValidation` 去硬断言，`blueprintFactories` 去初值，`ensurePersistentVariables` 删。
- 运行时：`PersistentVariableRuntimeTable` 灌入 bundle（`bundleAssembler` 读 `editor/variables.json`，缺失则从旧字段 seed），经**新 `persistentVariables` 选项**穿透到中心缝 `BehaviorNodeExecutionContext.persistentVariables`——`GraphExecutor`/`executeGraphSync`、`BlueprintDispatcher`×7、`BlueprintValueEvaluator`、`storyActionBlueprint`×3，及全部调用方（`GameApp`、`devModeBlueprintHostAdapter`、`SurfaceLifecycleBoundary`/`StageSlotSurfaceShell`/`AppSurfaceLayer`、`BlueprintValueRuntimeStore`/`SurfaceElementTree`、预览 `useStoryPreviewGameUi`）。
- 编译器/编著消费方改读注册表：`collectPersistentKeys`、`storyCommandContext`、`graphValidation`（options.persistentVariables）、`searchIndexModel`、`projectStatsSnapshot`、蓝图选择器（`BlueprintEntryTab` + 注册表变更订阅）、`StorySceneActionInspector`。
- 无双读、无兼容垫片。测试：迁移剥离 + 节点参数 remap（含分歧 id）；全部 fixture/调用点更新。

## WI-3 合并视图 + 冲突诊断

新增 `src/shared/variables/mergedPersistentView.ts`（+`.test`）：`buildMergedPersistentView(registry, storyDefs)` 按 storageKey 并两来源、`source` 打标，**同名跨来源 → collision**。三处消费：
1. **编译器**：`collectPersistentView` → 校验键取合并视图；每个跨来源同名 collision 产**编译诊断**（与既有 persistent 警告同族，warning）。完整编译 + 预览编译两条路径都发。
2. **storyCommandContext**：persistent 作用域命令补全读合并视图。
3. **变量面板 `StoryVariablesPanel`**：persistent 段改显合并视图（此前仅注册表，故事 `/persis` 行不显）。

诊断措辞：`Persistent variable "<name>" is declared in both the variable registry and a story row; references are ambiguous.`
测试：合并视图单测（并集 + collision + 同源不误报）+ 编译器 collision 集成测试。

**偏离说明（蓝图成员树）**：卡面列「蓝图成员树」为第三消费方。成员树保持只显**可编辑的注册表子集**（蓝图侧 persistent）——在蓝图编辑器里铺陈**全部故事文档**的 `/persis` 行属跨域、低价值（persistent 是全局作用域，需扫所有故事）；真正的风险（作者建重名）由编译 collision 诊断兜住。三处**功能承重**消费方（编译校验、命令上下文、变量面板）均已读合并视图。

## WI-4 Ref 对称化（story schema v9）

- `StoryVariableRef` persistent 臂 `{storageKey}`→`{variableId}`，与 scene/saved 对称。persistent 变量的 variableId 恒等于其 storageKey（注册表 id / 声明块 id），故**值不变、旧引用零语义变化**。
- `storyVariableRefKey` 化简为 `${scope}:${variableId}`（persistent 键串与 v8 逐字相同 → 场景快照值表 / 去重集跨 bump 稳定）。
- v8→v9 迁移：通用深走改写每个 persistent ref 臂（setVariable target、条件、表达式 var 节点、行内插值）；guard（`scope:"persistent"` + `storageKey`，无声明载荷 `name`/`valueType`）区分 ref 臂与 `/persis` 声明载荷（后者保留 storageKey）。
- 消费方：编译器 `resolveVariableSlot`/读点、`ConditionEditor`/`InterpolationPopover`/`StorySceneActionInspector` 助手、`storyCommandContext`、`storyInterpolation`、`storySceneBlockUtils`。
- 测试：v8→v9 迁移往返（重命名、零语义变化、声明载荷不动）+ 版本梯扩至 v8。

## 验证

- `yarn lint`（5 tsc project）：**全绿 exit 0**（生产 + 测试）。
- `vitest` 全量：**1983 通过 / 8 失败 = win32 基线原样**（path×3, runtimeProtocol×2, storageManager, GameBuildManager, mobileSigningIdentity；均 POSIX/权限），**新失败 0**。通过数较基线上升（新增测试：注册表模型 9、合并视图 4、蓝图迁移 5、v8→v9 往返 + 梯、collision 集成、persistent CRUD undo 等）。
- 真机：按既定验收分工顺延用户手测——重点：蓝图 Get/Set Persistent 节点在 Dev Mode 正常读写、变量面板两来源并列、`/persis` 无蓝图项目不再静默失败、persistent CRUD 可 Ctrl+Z。逻辑由 tsc + 单测 + 集成测试覆盖。

## 交给 orchestrator 的要点

1. 最终合并需把 `feat/story-inline-expression`（story v8）与本分支（story v9、蓝图 v9）一并落 develop；v9 取号已确认。
2. 蓝图成员树的合并视图显示按上文「偏离说明」裁剪——若需成员树也显故事 `/persis` 行（read-only），是独立小跟进（需成员树接入 StoryService 扫全故事）。
3. WI-4 之前的 3 个 commit 主题曾带 `@` 前缀（Bash 工具里误用 PowerShell here-string），已 filter-branch 清理，SHA 已变。
