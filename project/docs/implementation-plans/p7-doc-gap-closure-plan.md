---
title: P7 — 文档、验收与剩余缺口收口实现方案
type: refactor
status: completed
date: 2026-04-05
origin: project/docs/agent-milestone-prompts.md
---

# P7 — 文档、验收与剩余缺口收口实现方案

## Overview

- 这份计划用于在 **不重设计整套系统** 的前提下，收口 `P1–P6` 的纸面计划缺口、里程碑与代码漂移、验收矩阵缺失，以及仍残留但规模可控的实现缺口。
- 本轮规划前提不是“P1–P6 已 100% 满足所有验收句”，而是：**相关能力已在仓库中不同程度落地，P7 需要以对照矩阵为准重新判定**。
- 用户已确认本次边界采用：**文档与代码并重**。因此 P7 可以把**高价值、低风险、严格属于既有里程碑范围内**的小缺口列为本次应补代码项；但不允许借机做大重构或重开新系统。

## Problem Frame

- `project/docs/implementation-plans/` 当前只有 `p1-ve-m2a-bp-m2-plan.md`、`p2-bp-m3min-ve-m4lite-plan.md`、`p6-bp-m5-ve-m6-plan.md` 与 `studio-ui-blueprint-master-spec.md`；`p3`、`p4`、`p5` 计划文件缺失。
- `project/docs/visual-editor-milestones.md`、`project/docs/blueprint-system-milestones.md`、`project/docs/visual-editor-implementation-guide.md` 与当前代码实现之间已经出现阶段性漂移：有些文档仍把某些能力描述为“未交付”，而代码已部分实现；也有些文档或计划把阶段标成 `implemented`，但关键验收句仍只能判为 `partial`。
- `project/examples/visual-editor/` 的示例目录与 `visual-editor.md` §4.4 基本一一对应，但示例里的 `uigraphs.json` 仍停留在较早 schema 形态，存在“能对照结构、但未明确说明当前迁移语义”的轻度漂移。
- 当前分支上，`Blueprint M4`、`Blueprint M3-full`、`Blueprint M5`、`Visual Editor M5`、`Visual Editor M6` 都已有明显落地痕迹，但完成度不均匀；其中最典型的残留问题包括：
  - 属性绑定创建仍使用 `window.prompt`
  - 编辑器画布 `UISurfaceEditorTab` 未挂接 `blueprintRuntime`
  - 静态诊断已落地，但“诊断到目标”的交互闭环在 Workspace 中并不统一
  - `p6-bp-m5-ve-m6-plan.md` 已标 `implemented`，但仍自带 follow-up 风险项

## Requirements Trace

- R1. 产出 `project/docs/implementation-plans/p7-doc-gap-closure-plan.md`，并以它作为 P7 的唯一实施计划入口。
- R2. 给出一份 **P1–P6 与里程碑句级的对照矩阵**，每项标明 `done / partial / not-done`，并附证据路径。
- R3. 明确 `p3`、`p4`、`p5` 缺失计划文件的补写策略：纯追溯记录，或“已实现部分 + 剩余待做项”的混合方案。
- R4. 明确列出文档漂移修订清单：路径、章节、建议措辞方向。
- R5. 对 `Visual Editor M3 / M4-full / M5 / M6` 与 `Blueprint M3-full / M4 / M5` 的剩余缺口逐类给出 **现状 / 缺口 / 建议动作 / 验收**。
- R6. 对仍须编码的缺口按优先级排序，并精确到文件。
- R7. 明确非目标，避免 P7 重新发明 Blueprint 系统或重写编辑器。
- R8. 若发现前置阶段关键能力并未真正完成，必须单独标出，并给出是否应先回退到对应 `Px` 的建议。

## Scope Boundaries

- 不在 P7 重新设计 `Blueprint Runtime Contract`、`Host API` 分层、`Dev Mode` 架构或 `Visual Editor` 主路线。
- 不在 P7 引入模板系统、组件系统、运行时任意 UI 树编排、Visual/TS 蓝图互转、断点单步、时光回溯。
- 不把 Workspace 变成第二个 Dev Mode；真实执行、Host API、副作用与深度调试仍以 `Dev Mode` 为主场。
- 不把任何**未列在里程碑或既有计划里的新想法**默认升级为本次必做。若发现仅属“最好有”的增强项，只作为附录建议，不进入本次必做清单。

## Current Baseline Summary

### 已有计划与状态

| 阶段 | 文档现状 | 当前判断 |
|------|----------|----------|
| `P1` | `p1-ve-m2a-bp-m2-plan.md` 已存在，且标注 `Implemented in-repo` | 基本可视为**追溯记录已存在** |
| `P2` | `p2-bp-m3min-ve-m4lite-plan.md` 已存在，且是实施记录 | 基本可视为**追溯记录已存在** |
| `P3` | 文件缺失 | 代码与示例已明显落地，适合补写**追溯性实施记录** |
| `P4` | 文件缺失 | 代码已部分落地，但完整验收未闭合，需补写**混合计划** |
| `P5` | 文件缺失 | 静态诊断与 M3-full 若干能力已落地，但仍有缺口，需补写**混合计划** |
| `P6` | `p6-bp-m5-ve-m6-plan.md` 已存在，frontmatter 为 `implemented` | 不能直接视为全验收完成，需做**二次复核** |

### 关键代码事实

| 主题 | 事实 | 证据路径 |
|------|------|----------|
| 属性绑定创建 | 仍通过 `window.prompt` 创建声明 | `src/renderer/apps/workspace/modules/properties/blueprint/usePropertyBindingState.ts` |
| 编辑器画布 Host | `UISurfaceEditorTab` 的 `hostAdapter` 只有 `host` 与 `effects.runEffect`，未提供 `blueprintRuntime` | `src/renderer/apps/workspace/modules/ui-editor/editors/UISurfaceEditorTab.tsx` |
| 按钮事件派发 | `nl.button` 只有在 `hostAdapter.blueprintRuntime` 存在时才派发 `click` 蓝图事件 | `src/renderer/lib/ui-editor/widget-modules/builtin/button/renderer.tsx` |
| 静态诊断聚合 | 已覆盖 `link`、`stage`、`resource`、`layout`、`interaction` 五类规则 | `src/renderer/lib/ui-editor/diagnostics/collectSurfaceDiagnostics.ts`，`src/renderer/lib/ui-editor/diagnostics/rules/*.ts` |
| 属性面板静态提示 | 已接入 surface 级/元素级静态诊断条带 | `src/renderer/apps/workspace/modules/properties/PropertiesPanel.tsx` |
| 编辑器 Host Adapter 工厂 | `createEditorHostAdapter()` 存在，但当前仓库未见接线 | `src/renderer/lib/ui-editor/runtime/hostAdapters/editorHostAdapter.ts` |
| 示例目录 | `dialog-surface`、`choice-menu`、`notification-toast`、`settings-layer`、`save-load-grid`、`overlay-pause` 六组示例均存在 | `project/examples/visual-editor/` |
| 示例 schema | 示例 `uigraphs.json` 仍使用 `schemaVersion: 2` + `ownerIndex` | `project/examples/visual-editor/dialog-surface/editor/ui/uigraphs.json` |

## Key Technical Decisions

- D1. **P7 以“对照矩阵”作为唯一完成判定入口。**  
  不再以文档里单句“已落地”或某计划 frontmatter 的 `implemented` 直接判定完成。

- D2. **缺失计划文件按真实完成度分类补写。**  
  `P3` 补写追溯性记录；`P4/P5` 采用“已实现部分 + 剩余待做项”的混合写法；`P6` 不新建计划，但需在现有计划或 P7 附录内做复核结论。

- D3. **P7 允许补少量代码，但只补“严格属于既有里程碑、且闭环价值高”的小缺口。**  
  典型如：替换 `window.prompt`、补跳转/选择器闭环、补统一文案与空状态、补诊断定位体验。  
  不包含：重写图编辑器、重构运行时、重做 TS 构建系统。

- D4. **P7 对文档漂移采取“先修 canonical，再修衍生文档”的顺序。**  
  先以 `visual-editor.md` / `blueprint-system.md` / milestone 文档 / master spec 对齐事实，再补 `p3/p4/p5` 计划记录，避免重复漂移。

- D5. **任何明显超出原里程碑边界的增强项，只列为可选建议，不进入本次 must-do。**  
  例如把编辑器画布做成完整运行时模拟、把 TS 编辑器强制升级为 Monaco、重做资产系统，都不属于 P7 默认必做。

## Open Questions

### Resolved During Planning

- `P7` 是否只补文档：**否**。用户已确认允许把高价值的小型代码缺口列为本次应补项。
- `p3/p4/p5` 是否统一按追溯记录补写：**否**。需要按阶段真实完成度分别处理。
- `P7` 是否承担整套系统回炉重做：**否**。只做文档、验收、缺口收口。

### Deferred to Implementation

- `P4` 遗留的“声明搜索/选择器”最终 UI 采用何种现有组件承载，只要遵循当前 Properties/Workspace 视觉语言即可。
- `P5`/`P6` 若补代码，是否为静态诊断补统一“跳到目标”交互，还是仅补文案与锚点，需在实施时按现有组件模式决定。
- 示例 `uigraphs.json` 是统一迁移到新 schema，还是在文档中明确“示例会在加载时迁移”，可在实施时二选一，但必须只保留一种真相。

## P1–P6 对照矩阵（摘要）

| Phase | Milestone sentence / criterion | Status | Evidence | P7 action |
|-------|-------------------------------|--------|----------|-----------|
| `P1` | `VE-M2-01` M2-A 四件套可插入、编辑、持久化 | done | `widget-modules/builtin/*`，`p1-ve-m2a-bp-m2-plan.md` | 仅保留现状证据 |
| `P1` | `BP-M2-01` 实例蓝图生命周期与绑定持久化 | done | `p1-ve-m2a-bp-m2-plan.md`，`LocalBlueprintService` | 仅保留现状证据 |
| `P2` | `BP-M3-01` Dev Mode 最小闭环 | done | `p2-bp-m3min-ve-m4lite-plan.md`，`useDevModeBlueprintRuntime.ts` | 仅保留现状证据 |
| `P2` | `VE-M4-01` 真入口 + 只读状态 + 轻量 Tab | done | `blueprint-lite/*`，`ReadonlyBlueprintSection.tsx` | 仅保留现状证据 |
| `P3` | `VE-M2-02` Stack/Scroll/SpacerDivider/ListRepeater | done | `widget-modules/builtin/{stack,scroll,spacerDivider,listRepeater}` | 补追溯计划 |
| `P3` | `VE-M3-01` 官方示例目录与说明一致 | partial | 示例目录齐全，但示例蓝图 schema 仍旧 | 补说明或迁移示例 |
| `P4` | `VE-M4-02` 属性行 `Literal/Bound/Broken` | done | `usePropertyBindingState.ts` | 纳入矩阵，无需重写 |
| `P4` | `BP-M4-01` 搜索声明、就地创建、跳转、解绑、图校验、错误可见 | partial | 已有跳转/解绑/诊断面板；创建仍 `prompt`；搜索选择器不足 | 列为 P7 小缺口主项 |
| `P4` | M4 §8.9 从错误提示跳到节点 | partial | 蓝图编辑器内可跳，Workspace 静态诊断未统一 | 列为 P7 小缺口主项 |
| `P5` | `VE-M5-01` 缺失资源 | done | `resourceDiagnostics.ts` | 仅补文档对齐 |
| `P5` | `VE-M5-01` link 异常 | done | `linkDiagnostics.ts` | 仅补文档对齐 |
| `P5` | `VE-M5-01` Stage/Surface 配置异常 | partial | `stageDiagnostics.ts` 有覆盖，但范围较窄 | 补矩阵与后续项 |
| `P5` | `VE-M5-01` 越界与可见性问题 | partial | `layoutDiagnostics.ts`、`interactionDiagnostics.ts` 有部分覆盖 | 补矩阵与后续项 |
| `P5` | `VE-M5-01` 热点与尺寸检查 | done | `interactionDiagnostics.ts` | 仅补文档对齐 |
| `P5` | `BP-M3-02` `node.enter` / `node.exit` | done | `GraphExecutor.ts`，`debug.ts` | 仅补文档对齐 |
| `P5` | `BP-M3-02` Host API / 多节点族 / 错误定位 | partial | `blueprintM3FullNodes.ts`、`BlueprintHostApiBridge.ts` 已有，但覆盖未完全验收 | 列入缺口表 |
| `P6` | `BP-M5-01` TS 蓝图可编辑、编译、装载执行 | partial | `TypeScriptBlueprintEditorPane.tsx`、`compileProjectBlueprintScripts.ts`、`BlueprintDispatcher.ts` | 复核并补残项 |
| `P6` | `BP-M5-01` 共享蓝图资产可管理并被运行时解析 | partial | `parseSharedBlueprintAsset.ts` 等 | 复核并补残项 |
| `P6` | `VE-M6-01` 插入/搜索/复制复用生产级收口 | partial | `p6` 自身已列 remaining risks | 列为 P7 收口项 |

## 缺口分类与建议动作

### 1. 缺失的实施计划文件

| 文件 | 现状 | 缺口 | 建议动作 | 验收 |
|------|------|------|----------|------|
| `project/docs/implementation-plans/p3-ve-m2b-ve-m3-plan.md` | 文件缺失；对应 widget 与示例目录已基本落地 | 缺少可追溯的实施记录与文件索引 | 补写为**追溯性实施记录**，内容聚焦：已交付范围、示例目录、文件锚点、与 `M3` 示例说明的核对结果 | 文档存在；能独立回答“P3 做了什么、落在哪些文件、哪些仍是示例/说明类轻漂移” |
| `project/docs/implementation-plans/p4-bp-m4-ve-m4full-plan.md` | 文件缺失；代码已出现 `blueprint-lite`、绑定状态、诊断面板等 | `M4-full` 明显未 100% 验收，不能只写成“已完成” | 补写为**混合计划**：先追溯已落地能力，再拆出剩余小缺口（绑定选择器、去掉 `prompt`、错误/节点跳转闭环等） | 文档能区分“已做”与“待做”；不再把 P4 误判成纯 done |
| `project/docs/implementation-plans/p5-ve-m5-bp-m3full-plan.md` | 文件缺失；静态诊断与 M3-full 若干能力已落地 | `M5/M3-full` 仍有范围不均与验收未齐 | 补写为**混合计划**：追溯已实现静态诊断与 runtime 扩展，再拆剩余 Host API / 诊断闭环 / 错误定位项 | 文档能指导后续只补剩余差额，而不是重做 P5 |

### 2. 里程碑文档与代码的漂移

| 文档/章节 | 现状 | 缺口 | 建议动作 | 验收 |
|-----------|------|------|----------|------|
| `project/docs/visual-editor-milestones.md` §7 `M4` | 文档仍将 `M4-full` 视为未来整体块 | 未准确区分“已实现的 M4-lite / 已部分实现的 M4-full / 未完成的剩余项” | 修订为分层表述：`M4-lite done`，`M4-full partial`，列明已实现能力与未完成验收句 | 阅读该节即可知道当前阶段是真入口 + 部分完整绑定工作流，而非纯 placeholder |
| `project/docs/visual-editor-milestones.md` §8 `M5` | 文档按推荐交付罗列项 | 与现有静态诊断实现未建立逐项状态映射 | 在每项后增加状态说明或在附录中建立状态表：`done / partial / not-done` | 该节能与 `diagnostics/rules/*.ts` 一一对照 |
| `project/docs/visual-editor-milestones.md` §9 `M6` | 文档描述生产级收口目标 | 与当前 `p6` 标 `implemented` 的状态存在偏差 | 调整措辞为“已完成部分收口，仍有插入搜索、复制 remap UI 等余量” | 文档不再误导为 M6 已满额完成 |
| `project/docs/blueprint-system-milestones.md` §8 `M4` | 文档目标完整 | 代码已实现部分 Visual 编辑器与绑定工作流，但搜索声明/创建声明/错误跳转未齐 | 把该节拆成“已实现 / 剩余项”或在验收段补充当前仓库状态说明 | 文档不再把所有 M4 能力一刀切地表述为“未做”或“已做” |
| `project/docs/blueprint-system-milestones.md` §7 `M3` / §7.13 `M3-min` | M3-min 与 M3-full 已有实现基础 | `node.enter/exit`、Host API、多节点族、错误定位的完成度未在文档中细化到当前仓库事实 | 增补当前仓库注记：哪些已落地，哪些仍属 M3-full 差额 | M3 章节可直接支撑 P7 验收矩阵 |
| `project/docs/blueprint-system-milestones.md` §9 `M5` | 已有仓库衔接说明，但语义偏“计划已实现” | `p6` 标记与实际体验仍有落差 | 将仓库说明改为“当前分支已具备 X/Y/Z，但仍存在 A/B/C residual risks” | `M5` 章节与 `p6` follow-up 一致 |
| `project/docs/visual-editor-implementation-guide.md` §3.2 / §7.2 / §10 | 仍保留部分“Blueprint 入口还是占位”“关键缺口”式旧表述 | 与当前 `M4-lite`/部分 `M4-full` 实现不一致 | 按当前基线重写为“已做入口与摘要，未做完整绑定选择器/编辑器闭环” | 实现指南不再把已落地部分回退成旧现状 |

### 3. `Visual Editor M3` 与官方示例

| 检查项 | 现状 | 缺口 | 建议动作 | 验收 |
|--------|------|------|----------|------|
| 示例目录命名与 `visual-editor.md` §4.4 对应 | `dialog-surface`、`choice-menu`、`notification-toast`、`settings-layer`、`save-load-grid`、`overlay-pause` 六组目录齐全，名称一致 | **无缺口** | 在 P7 矩阵中明确标记为 `done`，并引用示例目录清单作为依据 | 文档与目录名称保持一一对应 |
| 示例覆盖是否缺项 | 与 §4.4 列举项一致 | **无缺口** | 无需新增示例目录；只需保留对照索引 | 不需要为了 P7 增加新示例 |
| 示例蓝图 schema 与当前文档说明 | 示例 `uigraphs.json` 仍为 `schemaVersion: 2` + `ownerIndex` | 文档未明确“示例加载后将迁移”或“示例需升级” | 二选一：统一迁移示例文件到当前 schema；或在 `visual-editor.md` / `p3` 追溯计划中明确 auto-migration 语义 | 示例不会让读者误以为旧 schema 仍是当前推荐写法 |

### 4. `Visual Editor M4-full` / `Blueprint System M4` 的余量

| 子项 | 现状 | 缺口 | 建议动作 | 验收 |
|------|------|------|----------|------|
| 属性行 `Literal / Bound / Broken` | 已有状态机 | **无缺口** | 在矩阵中标记 `done` | 属性面板可稳定展示三态 |
| 绑定到已有声明 / 搜索声明 | 当前主路径不足；未形成明确声明选择器工作流 | 属于 `M4` 核心验收缺口 | 在 `properties/blueprint/` 下补现有风格的声明选择/搜索 UI；避免新增异质弹窗体系 | 用户可搜索已有声明并完成绑定，不再只能新建 |
| 就地创建声明 | 已支持，但通过 `window.prompt` | 交互仍属临时实现 | 用现有 Properties/Workspace 风格替换 `prompt`，保留直接创建能力 | 不再出现浏览器原生 `prompt` |
| 解除绑定 / 跳转声明 | 已有 | **无缺口** | 仅补文档对齐 | 可从属性行跳转并解绑 |
| 图校验与诊断展示 | Blueprint 编辑器内已有诊断面板 | Workspace 整体闭环不统一 | 明确边界：图诊断留在 Blueprint Tab；必要时补“从外部入口打开并聚焦诊断目标” | 可从蓝图诊断聚焦到声明或节点 |
| 从错误跳到节点 | Blueprint Tab 内已有 `onDiagnosticPick`，但 Workspace 静态诊断未统一 | 部分完成 | 将“蓝图错误 -> 打开对应 tab 并聚焦目标”纳入 P7 小缺口；静态 surface 诊断只在属 UI 元素时跳到画布/层级 | 至少蓝图错误与 surface 静态错误各有统一跳转路径 |
| 编辑器画布内真实蓝图交互 | `UISurfaceEditorTab` 未接 `blueprintRuntime` | 若将其视为 M4-full 验收则当前不满足；但按主文档边界，真实执行仍应在 Dev Mode | **不作为 P7 默认必做**。仅在矩阵里标注为“按当前边界不纳入 M4-full must-have，若产品要求编辑器内可点测，应单开回到 P4/P5” | P7 不误把它包装成已完成，也不擅自扩大范围 |

### 5. `Visual Editor M5` 静态创作反馈

| 检查项 | 状态 | 依据 | 缺口 / 建议动作 | 验收 |
|--------|------|------|-----------------|------|
| 缺失资源提示 | 已实现 | `resourceDiagnostics.ts` | 仅需文档对齐 | 图片/矩形图片填充缺资源时可见 warning |
| link 异常提示 | 已实现 | `linkDiagnostics.ts` | 仅需文档对齐 | 自链、缺失目标、非 appSurface 目标均可见 |
| Stage/Surface 配置异常 | 部分实现 | `stageDiagnostics.ts` | 当前仅覆盖 `slot none + appSurface link`；在 P7 矩阵中标 `partial`，如需补代码应只补与里程碑强相关的缺失规则 | M5 表述不再误写成 fully done |
| 元素越界 | 已实现 | `layoutDiagnostics.ts` | 仅需文档对齐 | 超出 Surface 设计边界可见 |
| 可见性问题 | 部分实现 | `interactionDiagnostics.ts` | 已覆盖“不可见/几乎不可见但仍有交互”；若要扩展到更多视觉可见性规则，应回到 P5 范围，不默认纳入 P7 | 至少当前已实现项能被矩阵正确反映 |
| 热点与尺寸检查 | 已实现 | `interactionDiagnostics.ts` | 仅需文档对齐 | 交互元素过小可见 warning |
| 面向 Dev Mode 的清晰入口 | 已实现 | `UISurfaceEditorTab.tsx` 的 `Play` 入口与静态提示文案 | 仅需文档对齐 | 用户能从编辑器打开 Dev Mode，并理解职责边界 |

### 6. `Blueprint System M3-full`

| 子项 | 现状 | 缺口 | 建议动作 | 验收 |
|------|------|------|----------|------|
| `node.enter` / `node.exit` | 已实现 | **无缺口** | 在矩阵中标 `done` | 调试协议与执行器都可见该事件 |
| 调试桥 | 已实现 | **无缺口** | 在矩阵中标 `done` | Dev Mode 面板可读事件流 |
| 错误定位 | 已有 `execution.error` 与图诊断能力 | 运行时错误到编辑器上下文的统一闭环仍偏弱 | 作为 P7 小缺口：梳理错误来源与跳转说明；必要时补最小“打开对应 blueprint target”能力 | 用户能知道错误属于哪个 blueprint / graph / node 范围 |
| 节点族 | `blueprintM3MinNodes.ts` + `blueprintM3FullNodes.ts` 已存在 | 需逐项核对里程碑 §7.7 与当前注册节点是否一致 | 在 `p5` 混合计划中建立节点族对照附录；对缺失节点标明“延后”或“纳入待办” | 能回答哪些 M3-full 节点已做、哪些没做 |
| Host API | `BlueprintHostApiBridge.ts`、`devModeBlueprintHostAdapter.ts` 已存在 | 覆盖度未按 milestone 六大家族逐项验收；Workspace 侧也未接统一 host | 在 `p5` 混合计划中按家族建立对照表；只把明显短板列为后续项，不在 P7 做大扩容 | M3-full 不再处于“有代码但无验收表”的状态 |
| Scope / state bridge | 已有 `ScopeStoreBridge.ts` | 多作用域完成度需与里程碑逐项对照 | 在 `p5` 混合计划与 P7 矩阵中标 `partial/done`，不凭名称直接判满 | 作用域能力与文档表述一致 |

### 7. `Blueprint System M5` + `Visual Editor M6`（相对 `p6` 计划）

| 子项 | 现状 | 缺口 | 建议动作 | 验收 |
|------|------|------|----------|------|
| TS 编辑器 | 已有 `TypeScriptBlueprintEditorPane.tsx` | 仍偏简化，未达到 `Monaco` 级体验 | 在 `P7` 中标 `partial`；不把“必须上 Monaco”当默认必做，除非另开回到 `P6` | `BP-M5-01` 不再被误判为 full done |
| TS 编译装载链 | Dev Mode 主进程链路已存在 | `Workspace` 内实时 Build Service、`editor/generated/blueprints/` manifest 未落地 | 在 P7 里作为 `P6 residual risk` 保留；若用户要关满 P6，应回到 `P6` 而非 P7 小补洞 | 文档明确这是 `partial` 而非 full done |
| 共享蓝图资产 | 解析与部分运行链已存在 | 资产管理/引用体验与验收尚未逐项复核 | 在 P7 矩阵中按“创建/搜索/打开/引用/运行时解析”拆项复核 | 能明确哪些共享资产能力已可用 |
| DevTools | 已有运行时 debug 面板 | 距离 `p6` 计划里的完整多面板 DevTools 仍有余量 | 在 `p6` 文档或 P7 附录中回写 residual risks | `M5` 文档不再写得比实现更满 |
| 插入/搜索复用入口 | `p6` 计划自述未实现 `InsertSearchPopover` | 属于 `VE-M6-01` 实际缺口 | 作为 P7 可选小代码项之一；若不补代码，也必须在矩阵中标 `partial` | 用户可清楚知道 M6 没有完全关满 |
| 复制蓝图 remap UI | `blueprintCopyRemap` 仍是纯函数预备层 | 属于 `VE-M6-01` 实际缺口 | 作为 P7 可选小代码项之一；若超出小补洞范围，则回到 `P6` | 不再把“数据层已预留”误写成“用户工作流已完成” |
| 属性面板与只读 Blueprint 文案统一 | 已有明显进展 | 仍需统一细节与空状态 | 可作为 P7 小代码项之一 | 文案与产品语言统一 |

## 文档修订清单

| 优先级 | 路径 | 章节 | 修订目标 |
|--------|------|------|----------|
| P0 | `project/docs/visual-editor-milestones.md` | §7、§8、§9 | 把 `M4-lite / M4-full / M5 / M6` 改成与当前实现一致的状态表达 |
| P0 | `project/docs/blueprint-system-milestones.md` | §7、§8、§9 | 把 `M3-full / M4 / M5` 改成与当前实现一致的状态表达 |
| P0 | `project/docs/visual-editor-implementation-guide.md` | §3.2、§7.2、§10 | 移除仍把 Blueprint 入口视为 placeholder 的旧表述 |
| P1 | `project/docs/implementation-plans/p3-ve-m2b-ve-m3-plan.md` | 全文 | 新建追溯性实施记录 |
| P1 | `project/docs/implementation-plans/p4-bp-m4-ve-m4full-plan.md` | 全文 | 新建混合计划：已实现 + 待做 |
| P1 | `project/docs/implementation-plans/p5-ve-m5-bp-m3full-plan.md` | 全文 | 新建混合计划：已实现 + 待做 |
| P1 | `project/docs/implementation-plans/p6-bp-m5-ve-m6-plan.md` | `Implementation record` / `Remaining risks` 附近 | 根据矩阵补一句“实施已推进，但验收仍有 partial 项” |
| P2 | `project/docs/visual-editor.md` | §4.4 及示例说明邻近段落 | 明确示例目录对照与示例蓝图 schema 语义 |
| P2 | `project/docs/implementation-plans/studio-ui-blueprint-master-spec.md` | §11、§12、§14 | 在 P7 完成后同步验收矩阵状态与计划索引 |

## 仍须编码的缺口清单（按优先级）

### P0：优先在 P7 内补的“小缺口”

| 项 | 目标文件 | 原因 | 对应验收 |
|----|----------|------|----------|
| 用正式 UI 替换属性绑定里的 `window.prompt` | `src/renderer/apps/workspace/modules/properties/blueprint/usePropertyBindingState.ts` 及同目录新增/修改选择器组件 | 这是 `M4` 当前最明显的临时交互 | `BP-M4-01`，`VE-M4-02` |
| 补“绑定到已有声明 / 搜索声明”最小闭环 | `src/renderer/apps/workspace/modules/properties/blueprint/*`，必要时 `blueprint-lite/hooks/useOpenBlueprintTarget.ts` | 这是 `M4` 文档与代码差距最大的核心项 | `BP-M4-01` |
| 统一蓝图诊断/静态诊断的跳转说明与最小目标定位 | `src/renderer/apps/workspace/modules/blueprint-lite/components/BlueprintDiagnosticsPanel.tsx`，`src/renderer/apps/workspace/modules/properties/PropertiesPanel.tsx`，必要时 `src/renderer/apps/workspace/modules/blueprint-lite/state/useBlueprintEditorState.ts` | 当前诊断可见但闭环不一致 | M4 §8.8、§8.9，`VE-M5-01` |

### P1：若精力允许，可在 P7 一并补的小收口

| 项 | 目标文件 | 原因 | 对应验收 |
|----|----------|------|----------|
| 统一 M6 相关 Blueprint 文案、空状态、badge 表达 | `src/renderer/apps/workspace/modules/properties/PropertiesPanel.tsx`，`src/renderer/lib/ui-editor/widget-modules/shared/blueprint/ReadonlyBlueprintSection.tsx`，`src/renderer/apps/workspace/modules/properties/blueprint/SurfaceBlueprintEntrySection.tsx` | 属于低风险体验收口 | `VE-M6-01` |
| 示例蓝图 schema 语义对齐 | `project/examples/visual-editor/*/editor/ui/uigraphs.json` 或相关文档 | 防止示例与当前真相分叉 | `VE-M3-01` |

### P2：不建议在 P7 直接吞下，应回到对应 Px

| 项 | 建议回退阶段 | 原因 |
|----|--------------|------|
| 为 `UISurfaceEditorTab` 正式挂接编辑器侧 `blueprintRuntime`，并决定编辑器内点击是否执行蓝图 | `P4` 或 `P5` | 这会触及“Workspace 是否模拟运行时”的产品边界，不是 P7 小补洞 |
| 建立完整 Workspace `BlueprintBuildService`、`editor/generated/blueprints/` manifest、TS 全链路实时诊断 | `P6` | 超出 P7 低风险收口范围 |
| 完整实现 `InsertSearchPopover`、剪贴板 remap UI、统一插入搜索系统 | `P6` | 仍是明显的 `M6` 正式能力，不应伪装成纯文档收口 |

## 前置风险与是否应先回退到对应 Px

### 风险 A：`P4` 并未真正闭合

- 现状：`M4-full` 已有大量代码，但“绑定到已有声明 / 搜索声明 / 去掉 `prompt` / 错误跳转闭环”仍未齐。
- 建议：  
  如果本轮目标是“把 `P4` 在文档上改成 fully done”，应先回退到 **`P4`** 做最小补洞，再由 P7 回写文档。  
  如果本轮目标只是“先把文档与验收真相对齐，再补少量小缺口”，则可继续由 P7 处理。

### 风险 B：`P5` 只完成了“有实现”，未完成“有验收”

- 现状：静态诊断规则已经存在，`M3-full` 也有节点与 Host API 扩展，但没有系统化对照表。
- 建议：  
  P7 可以先补齐矩阵与混合计划；若用户要求 Host API 家族与节点族全量对齐 milestone，应另回到 **`P5`**。

### 风险 C：`P6` 的 `implemented` 不能直接等价于“完成”

- 现状：`p6-bp-m5-ve-m6-plan.md` 自带 remaining risks，且若干关键体验仍未达到计划原文目标。
- 建议：  
  P7 不应把 `P6` 重新标成“未做”，但必须把它改写成“已实现主要骨架，仍有 residual gaps”；若要把 `M5/M6` 全量关满，应回到 **`P6`**。

## Implementation Units

- [x] **Unit 1: 建立 P7 对照矩阵与事实基线**

**Goal:** 把 `P1–P6`、master spec、两份 milestone 文档与当前代码事实对齐到同一张矩阵。

**Requirements:** R1, R2, R8

**Dependencies:** None

**Files:**
- Modify: `project/docs/implementation-plans/p7-doc-gap-closure-plan.md`
- Modify: `project/docs/implementation-plans/studio-ui-blueprint-master-spec.md`

**Approach:**
- 以本计划附录矩阵为骨架，逐项补全状态、证据路径、备注。
- 所有结论都以代码锚点或现有实施记录为依据，不直接引用模糊口头状态。

**Test scenarios:**
- Happy path: 任一 `VE-Mx-xx` / `BP-Mx-xx` 条目都能追到至少一个代码或计划证据。
- Edge case: 某能力“有代码但无验收文档”时，应标 `partial` 而不是直接 `done`.

**Verification:**
- P7 执行结束时，评审者无需重新通读所有文档，也能理解每个阶段真实完成度。

- [x] **Unit 2: 补齐 `p3` / `p4` / `p5` 计划文件**

**Goal:** 让缺失的阶段计划文件回到仓库内，消除计划索引断层。

**Requirements:** R3

**Dependencies:** Unit 1

**Files:**
- Create: `project/docs/implementation-plans/p3-ve-m2b-ve-m3-plan.md`
- Create: `project/docs/implementation-plans/p4-bp-m4-ve-m4full-plan.md`
- Create: `project/docs/implementation-plans/p5-ve-m5-bp-m3full-plan.md`

**Approach:**
- `p3` 用追溯性实施记录写法。
- `p4`、`p5` 用“已实现范围 + 剩余缺口 + 对应文件”的混合计划写法。

**Test scenarios:**
- Happy path: 新文件能回答该阶段的范围、现状、缺口、文件锚点与验收。
- Edge case: 若某阶段只部分实现，新文件必须明确 `partial` 与剩余任务，不可伪造 fully done。

**Verification:**
- `implementation-plans/` 重新具备连续的 `p1` 到 `p7` 文档链。

- [x] **Unit 3: 修订 milestone / guide / overview 文档漂移**

**Goal:** 把阶段性叙述改成与仓库事实一致的版本。

**Requirements:** R4, R5

**Dependencies:** Unit 1

**Files:**
- Modify: `project/docs/visual-editor-milestones.md`
- Modify: `project/docs/blueprint-system-milestones.md`
- Modify: `project/docs/visual-editor-implementation-guide.md`
- Modify: `project/docs/visual-editor.md`

**Approach:**
- 优先修阶段状态与验收句，不重写架构大段。
- 只修“已做/未做/部分”的事实表达与示例说明。

**Test scenarios:**
- Happy path: 文档中不再出现与代码明显矛盾的阶段状态。
- Edge case: 对 partial 能力使用“已实现部分 + 剩余项”表述，而不是简单改成 done。

**Verification:**
- 同一能力在 `milestones`、`implementation-guide`、`visual-editor.md` 之间不再互相打架。

- [x] **Unit 4: 完成 P7 范围内的小型代码补洞**

**Goal:** 关闭最影响验收判断、且风险可控的小缺口。

**Requirements:** R5, R6

**Dependencies:** Unit 1

**Files:**
- Modify: `src/renderer/apps/workspace/modules/properties/blueprint/usePropertyBindingState.ts`
- Modify/Create: `src/renderer/apps/workspace/modules/properties/blueprint/*`
- Modify: `src/renderer/apps/workspace/modules/blueprint-lite/components/BlueprintDiagnosticsPanel.tsx`
- Modify: `src/renderer/apps/workspace/modules/properties/PropertiesPanel.tsx`
- Modify: `src/renderer/lib/ui-editor/widget-modules/shared/blueprint/ReadonlyBlueprintSection.tsx`
- Modify: `src/renderer/apps/workspace/modules/properties/blueprint/SurfaceBlueprintEntrySection.tsx`

**Approach:**
- 先做 `prompt -> 正式 UI` 与“绑定已有声明”闭环。
- 再做诊断跳转/说明统一。
- 只补当前 milestone 明确要求的小功能，不扩大到运行时重构。

**Test scenarios:**
- Happy path: 从属性面板可搜索或创建声明并完成绑定。
- Happy path: 从蓝图诊断或属性提示能跳到对应目标。
- Edge case: 无声明、broken binding、空诊断时有清晰空状态与下一步动作。

**Verification:**
- `P4` 与 `P7` 共享的核心小缺口被关闭，且界面风格与现有项目一致。

- [x] **Unit 5: 最终回写实施状态与附录**

**Goal:** 在 P7 落地后，把计划、索引、矩阵和剩余风险同步到仓库文档。

**Requirements:** R1, R2, R6, R8

**Dependencies:** Unit 2, Unit 3, Unit 4

**Files:**
- Modify: `project/docs/implementation-plans/p7-doc-gap-closure-plan.md`
- Modify: `project/docs/implementation-plans/p6-bp-m5-ve-m6-plan.md`
- Modify: `project/docs/implementation-plans/studio-ui-blueprint-master-spec.md`

**Approach:**
- 更新每个阶段的最终状态与 residual risks。
- 在 master spec 中同步计划索引与验收矩阵。

**Test scenarios:**
- Happy path: 评审者只看 P7 文档与 master spec，就能知道哪些项已关、哪些项延后。
- Edge case: 若 Unit 4 有未完成项，文档必须保留 `partial` 与 follow-up，不可强行写成 done。

**Verification:**
- P7 文档成为下一次实施与验收的稳定入口。

## Non-goals

- 在 P7 重写 `BlueprintDispatcher`、`GraphExecutor`、`Dev Mode` 或 `LocalBlueprintService` 的主架构。
- 在 P7 引入新的蓝图前端、模板系统、组件系统或共享继承模型。
- 在 P7 把编辑器画布升级为真实运行时模拟器。
- 在 P7 强行把所有 `M5/M6` 目标一次性补满。

## Appendix A — 句级对照矩阵（详细版）

| Phase | Ref | Milestone sentence | Status | Evidence path(s) | Notes |
|-------|-----|--------------------|--------|------------------|-------|
| `P1` | `VE-M2-01` | Text/Image/Button/Container 可插入、编辑、持久化 | done | `project/docs/implementation-plans/p1-ve-m2a-bp-m2-plan.md`，`src/renderer/lib/ui-editor/widget-modules/builtin/` | 已有追溯记录 |
| `P1` | `BP-M2-01` | `widgetMain`、事件图、绑定持久化、owner 生命周期 | done | `project/docs/implementation-plans/p1-ve-m2a-bp-m2-plan.md` | 已有追溯记录 |
| `P2` | `BP-M3-01` | 点击 -> 事件图 -> 状态 -> 绑定 -> UI -> 调试流 | done | `project/docs/implementation-plans/p2-bp-m3min-ve-m4lite-plan.md`，`src/renderer/apps/dev-mode/hooks/useDevModeBlueprintRuntime.ts` | 为 M3-min 完成，不代表 M3-full 完成 |
| `P2` | `VE-M4-01` | 真入口 + 只读摘要 + 跳转轻量 Tab | done | `src/renderer/apps/workspace/modules/blueprint-lite/`，`src/renderer/lib/ui-editor/widget-modules/shared/blueprint/ReadonlyBlueprintSection.tsx` | 与文档一致 |
| `P3` | `VE-M2-02-A` | `nl.stack` 已交付 | done | `src/renderer/lib/ui-editor/widget-modules/builtin/stack/` | 应补追溯计划 |
| `P3` | `VE-M2-02-B` | `nl.scroll` 已交付 | done | `src/renderer/lib/ui-editor/widget-modules/builtin/scroll/` | 应补追溯计划 |
| `P3` | `VE-M2-02-C` | `nl.spacerDivider` 已交付 | done | `src/renderer/lib/ui-editor/widget-modules/builtin/spacerDivider/` | 应补追溯计划 |
| `P3` | `VE-M2-02-D` | `nl.listRepeater` 已交付 | done | `src/renderer/lib/ui-editor/widget-modules/builtin/listRepeater/` | 应补追溯计划 |
| `P3` | `VE-M3-01-A` | 六个官方示例目录存在且命名一致 | done | `project/examples/visual-editor/` | 无目录级缺口 |
| `P3` | `VE-M3-01-B` | 示例蓝图说明与当前 schema 语义一致 | partial | `project/examples/visual-editor/*/editor/ui/uigraphs.json`，`project/docs/visual-editor.md` | 需说明或迁移 |
| `P4` | `VE-M4-02-A` | 属性行 `Literal / Bound / Broken` | done | `src/renderer/apps/workspace/modules/properties/blueprint/usePropertyBindingState.ts` | 当前已满足 |
| `P4` | `BP-M4-01-A` | 打开蓝图编辑器 | done | `src/renderer/apps/workspace/modules/blueprint-lite/hooks/useOpenBlueprintTarget.ts` | 当前已满足 |
| `P4` | `BP-M4-01-B` | 搜索已有声明成员 | partial | `src/renderer/apps/workspace/modules/properties/blueprint/` | 当前主路径不足 |
| `P4` | `BP-M4-01-C` | 就地创建声明成员 | partial | `usePropertyBindingState.ts` | 已有，但仍是 `prompt` |
| `P4` | `BP-M4-01-D` | 解除绑定 | done | `usePropertyBindingState.ts` | 当前已满足 |
| `P4` | `BP-M4-01-E` | 从属性绑定跳到声明成员 | done | `usePropertyBindingState.ts` | 当前已满足 |
| `P4` | `BP-M4-01-F` | 图级校验与错误展示 | done | `src/renderer/apps/workspace/modules/blueprint-lite/components/BlueprintDiagnosticsPanel.tsx` | Blueprint Tab 内已满足 |
| `P4` | `BP-M4-01-G` | 从错误提示跳到节点 | partial | `BlueprintEntryTab.tsx`，`useBlueprintEditorState.ts` | 蓝图 Tab 内较好，Workspace 侧不统一 |
| `P5` | `VE-M5-01-A` | 缺失资源提示 | done | `src/renderer/lib/ui-editor/diagnostics/rules/resourceDiagnostics.ts` | 当前已满足 |
| `P5` | `VE-M5-01-B` | link 异常提示 | done | `src/renderer/lib/ui-editor/diagnostics/rules/linkDiagnostics.ts` | 当前已满足 |
| `P5` | `VE-M5-01-C` | Surface / Stage 配置异常提示 | partial | `src/renderer/lib/ui-editor/diagnostics/rules/stageDiagnostics.ts` | 规则仍偏窄 |
| `P5` | `VE-M5-01-D` | 越界与可见性问题提示 | partial | `layoutDiagnostics.ts`，`interactionDiagnostics.ts` | 已覆盖部分核心问题 |
| `P5` | `VE-M5-01-E` | 热点与尺寸检查 | done | `interactionDiagnostics.ts` | 当前已满足 |
| `P5` | `VE-M5-01-F` | 面向 Dev Mode 的清晰预览入口 | done | `UISurfaceEditorTab.tsx` | 当前已满足 |
| `P5` | `BP-M3-02-A` | `node.enter` / `node.exit` | done | `src/renderer/lib/ui-editor/behavior-graph/GraphExecutor.ts`，`src/shared/types/blueprint/debug.ts` | 当前已满足 |
| `P5` | `BP-M3-02-B` | M3-full 节点族扩展 | partial | `src/renderer/lib/ui-editor/behavior-graph/blueprintM3FullNodes.ts` | 需附录核对 |
| `P5` | `BP-M3-02-C` | Host API 扩展 | partial | `src/renderer/lib/ui-editor/blueprint-runtime/BlueprintHostApiBridge.ts` | 需按家族复核 |
| `P5` | `BP-M3-02-D` | 错误定位与调试桥 | partial | `debug.ts`，Dev Mode debug panel | 事件已到位，闭环仍偏弱 |
| `P6` | `BP-M5-01-A` | TS Blueprint 可编辑 | partial | `src/renderer/apps/workspace/modules/blueprint-lite/ts/TypeScriptBlueprintEditorPane.tsx` | 有编辑器，但体验未达标 |
| `P6` | `BP-M5-01-B` | TS 编译并装载执行 | partial | `src/main/app/application/managers/devMode/compiler/blueprint/compileProjectBlueprintScripts.ts`，`src/renderer/lib/ui-editor/blueprint-runtime/BlueprintDispatcher.ts` | Dev Mode 主路径可用，Workspace BuildService 未齐 |
| `P6` | `BP-M5-01-C` | 共享蓝图资产可创建/被引用/被解析 | partial | `src/shared/blueprint/parseSharedBlueprintAsset.ts` | 需细化复核 |
| `P6` | `BP-M5-01-D` | DevTools 可读可用 | partial | `src/renderer/apps/dev-mode/components/BlueprintRuntimeDebugPanel.tsx` | 仍与 `p6` 目标有差距 |
| `P6` | `VE-M6-01-A` | 插入/搜索入口顺手 | partial | `project/docs/implementation-plans/p6-bp-m5-ve-m6-plan.md` | 计划自述仍缺 |
| `P6` | `VE-M6-01-B` | 复制复用入口顺手 | partial | `blueprintCopyRemap` 仅数据层 | 仍缺 UI |
| `P6` | `VE-M6-01-C` | 属性面板体验一致 | partial | `ReadonlyBlueprintSection.tsx`，`SurfaceBlueprintEntrySection.tsx` | 已有进展，仍需收口 |

## Appendix B — P7 实施记录（落地摘要，2026-04-05）

### 文档

- **`visual-editor-milestones.md`**：§7 拆为 M4-lite **done** / M4-full **partial**；§8.2 增加静态诊断状态表；§9 标明 M6 **partial** 与 `p6` 残余关系。
- **`blueprint-system-milestones.md`**：新增 §7.14（M3-full 仓库注记）、§8.0（M4 分层）、§9.10 P7 复核措辞。
- **`visual-editor-implementation-guide.md`**：§3.2、§7.2、§10 与当前实现对齐，去除“Blueprint 仍仅占位”式旧判断。
- **`visual-editor.md`**：§4.4 增加示例 `uigraphs.json` 与 Studio 加载迁移的单一真相说明。
- **`implementation-plans/p3|p4|p5-*.md`**：新建追溯/混合计划。
- **`implementation-plans/p6-bp-m5-ve-m6-plan.md`**：增加 **P7 cross-check**，澄清 `implemented` ≠ 全句验收。
- **`implementation-plans/studio-ui-blueprint-master-spec.md`**：§11 增加 P7 快照索引表、§12 计划链补全、§14 修订策略补充。

### 代码（P0 小缺口）

- **`usePropertyBindingState.ts`**：移除 `window.prompt`；暴露 `declarationCandidates`、`bindToExistingDeclaration`、`createAndBindWithName`。
- **`BindablePropertyField.tsx`**：内联绑定选择器（搜索已有声明、Create & bind）。
- **`PropertiesPanel.tsx`**：静态诊断条带按项展示；带 `elementId` 的可点击并 **选中画布元素**。
- **`BlueprintDiagnosticsPanel.tsx`**：空状态与页脚说明与 Workspace 职责对齐。

### 刻意延后（非 P7）

- **`UISurfaceEditorTab`** 挂接编辑器侧 `blueprintRuntime`、Workspace `BlueprintBuildService`、完整 `InsertSearchPopover` / remap UI、示例 JSON 批量手改升 schema — 见上文 **Non-goals** 与 **P2 不建议在 P7 吞下** 表。

## Sources & References

- `project/docs/agent-milestone-prompts.md`
- `project/docs/visual-editor-milestones.md`
- `project/docs/visual-editor.md`
- `project/docs/visual-editor-implementation-guide.md`
- `project/docs/blueprint-system-milestones.md`
- `project/docs/blueprint-system.md`
- `project/docs/dev-mode.md`
- `project/docs/implementation-plans/p1-ve-m2a-bp-m2-plan.md`
- `project/docs/implementation-plans/p2-bp-m3min-ve-m4lite-plan.md`
- `project/docs/implementation-plans/p6-bp-m5-ve-m6-plan.md`
- `project/docs/implementation-plans/studio-ui-blueprint-master-spec.md`
- `project/examples/visual-editor/*`
- `src/renderer/apps/workspace/modules/properties/blueprint/usePropertyBindingState.ts`
- `src/renderer/apps/workspace/modules/ui-editor/editors/UISurfaceEditorTab.tsx`
- `src/renderer/lib/ui-editor/widget-modules/builtin/button/renderer.tsx`
- `src/renderer/lib/ui-editor/diagnostics/collectSurfaceDiagnostics.ts`
- `src/renderer/lib/ui-editor/diagnostics/rules/resourceDiagnostics.ts`
- `src/renderer/lib/ui-editor/diagnostics/rules/linkDiagnostics.ts`
- `src/renderer/lib/ui-editor/diagnostics/rules/stageDiagnostics.ts`
- `src/renderer/lib/ui-editor/diagnostics/rules/layoutDiagnostics.ts`
- `src/renderer/lib/ui-editor/diagnostics/rules/interactionDiagnostics.ts`
- `src/renderer/lib/ui-editor/runtime/hostAdapters/editorHostAdapter.ts`
