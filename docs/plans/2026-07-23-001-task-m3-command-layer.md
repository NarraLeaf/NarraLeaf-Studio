---
title: "task: M3 指令层 — bible M3-M5 收尾、palette 升级、组头站位、M2 尾款"
type: handoff
status: draft
date: 2026-07-23
parent: 2026-07-22-001-feat-story-editor-overhaul.md
---

# task: M3 指令层

你是本任务的执行者。动手前**必须先读**（按序）：

1. `docs/plans/2026-07-19-001-refactor-story-command-bible.md` **全文**——它是 WI-1/2/3 的唯一权威规格（其 §6 里程碑：bible-M1 架构换底与 bible-M2 签名立法已落地；剩 **M3 交互修订、M4 变量统一、M5 概览投影**，即本卡核心）。本卡不复述它，冲突时以它为准。
2. `docs/plans/2026-07-22-001-feat-story-editor-overhaul.md` §3.2（palette）、§4.2（站位）、§8（不做清单）
3. `docs/story-editor-interaction-model.md`（交互契约；bible §4 对其的修订属于本卡工作内容——除 bible §4 明文修订的条款外，其余一条不许变）
4. `docs/plans/reports/2026-07-23-M2-report.md`（上一棒交付）＋本卡 §2 尾款清单

完成后按 §7 交报告。遇到 §8 情形停下报告。

## 0. 分支、纪律与子代理授权

- 从 `develop`（含 M2 合并 `a25decf`）切 `feat/story-m3-command-layer`。
- **共享工作树警告（长期有效）**：`git status` 里所有不是你改出来的脏文件/未跟踪文件都是另一活跃 session 的 WIP（已知区域：状态栏/actions/Dev Mode 入口、`src/main/**`、`project/app/**`、`package.json`、i18n `actions`/`workspace`、`hooks/`）。铁律：**逐文件 `git add <path>`，禁止 `git add -A` / `git add .`**；不动它们；若你必须编辑的文件已带别人的未提交改动 → 停下报告。禁止 stash，工作期间不切分支。
- **子代理授权（本卡新增）**：允许你 spawn 子代理并行处理**小而独立**的修复（§2 尾款、i18n 词条、单测补齐一类）。约束：①子代理产出的 diff 由你逐行过目后才 commit（你对整个分支负责）；②同一文件同一时间只允许一个写者；③子代理同样受本卡全部铁律约束（把相关章节复制进它的 prompt）；④主线大活（bible M3/M4/M5）不拆给子代理——那是你自己的。
- 每个 WI 一到几个内聚 commit。不合并不 push。9223 是 debug 服务器保留端口；CDP 用 9224+。

## 1. 风格铁律（每个 WI 验收都含这条）

- 禁止解释性文本/教学 tooltip/空状态文案；禁止新 pill/chip/徽章/图例；复用现有组件与手势（hover-reveal、既有 popover、ContextMenu）。
- bible 里明文规定的反馈形态（如声明成功的 ghost 区 `✓ var gold…` 短暂显示、草稿行琥珀色）按 bible 执行——它已经替你做过"不张扬"的取舍。
- 明暗主题同时成立；只用既有 CSS 变量与类别色；`rotate`/`translate` 独立属性，不用 v3 `transform` 工具类。
- 新文案全走 i18n，en+zh 两份。

## 2. M2 尾款（WI-0，先行；子代理友好）

来自 M2 验收双 review。逐条修，报告里逐条标注：

1. **quickParam 标签错位**：setBackground 的 token 显示 "t" 但编辑的是 `d=`（`storyQuickParams.tsx` ~:78 与 `specs/scene.ts` 对照）。一行修。
2. **检查器 dead-Enter 边缘**：手动隐藏面板后 inspector→inspector 切换（未经过 idle）不再 `panels.show`（`StorySceneEditorTab.tsx` ~:688 的 `inspectorPanelShownRef` 门控）。修：inspector 态之间切换也重新 show。
3. **插入槽隐形边缘**：insert-above 槽开着时目标行被过滤/折叠隐藏 → 编辑器停在不可见的插入态。修：目标行离开 visibleRows 时关槽。
4. **badge 缓存无失败重试**：加载失败后在全部订阅者卸载前永远 icon（`storyBadgeImageCache.ts` ~:114x）。修：失败条目下次订阅时重试。
5. **badge 缓存不随资产替换失效**：行挂载期间替换资产内容 → 头像陈旧。修：订阅 assets 变更事件失效对应条目。
6. **语音试听无 teardown**：tab 停用/项目关闭后音频播完为止。修：tab deactivate 时 stop。
7. **检查器桥每击键重发布**：`storyInspectorBridge` 依赖含 `editor.scene`，面板逐键重渲染。修：发布态 memo/按需。
8. **禁用声明行语义定案**（orchestrator 已裁决）：声明行 disabled 时变量**仍然**声明+播种（声明是词法表，避免全篇引用连锁报错）——这是有意语义。要做的：`declarations.ts` 或 document.ts 加一句注释说明 + 一条断言该行为的测试，防止未来被当 bug "修"掉。
9. **statusText 硬编码英文**（`useStorySceneEditorController.ts` ~:1891；state 只写不读）：要么 i18n 要么删掉死状态，二选一。

另有两项**顺延的人工验收**（用户推迟了手测，验证责任落到你的真机环节 §6）：差分头像视觉确认（对话行/表情成员行显示立绘头部取景而非缩略图/图标）；M2 五个功能面的快速过一遍（检查器/快编/右键/禁用/试听）。

## 3. 主线：bible M3 → M5 → M4（WI-1/2/3）

规格全在 bible 文档，此处只给落点与顺序理由：

- **WI-1 = bible M3 交互修订**：B9 提交分级（Enter 永远有可见结果：核心齐全落行，否则草稿行）；草稿行从 error 红重定位为 draft 琥珀（构建门不变，仍拒绝）；草稿行重开的补全修复（删除 `chooser`/`chooserDismissed` 存储态，菜单开合由 (text, caret) 派生——这同时了结 2026-07-16-003 交接文档里"blur 卡死候选"的旧账）；声明成功的清槽+ghost 确认+undo 携带注册表逆操作。落点：InsertRow 状态机（`StorySceneEditorRows.tsx`）、`storyCommandCandidates/Ghost/Cursor`、controller、history。
- **WI-2 = bible M5 概览投影**：规格增 `overview()`，committed 行渲染 `[动词徽标][目标名][关键修饰]` 结构化投影，`describeBlock` 降为缺省回落；与 M1 的类别色/M2 的 quickParams token 融合（quickParams 的可点 token 应该就是 overview 片段的一部分，别做成两层叠加）。先于 M4 做，因为它和 WI-1 的草稿行视觉同处一片代码。
- **WI-3 = bible M4 变量统一**：项目级 persistent 注册表（`VariableRegistryService`）+ 蓝图 `persistentVariables` 字段删除改读注册表 + 编译器五项修复（bible §3.3：Local 播种、persistent 回落默认、编译期校验、结构相等、场景重名诊断）。**注意 schema 现为 v7**：bible 写的"v5→v6 迁移"已发生，本 WI 若需迁移用 v7→v8，只做 bible §3.1/3.2 中尚未落地的部分——动手前先核对现状（`declarations.ts` 已在，声明行已是 v6 产物；persistent 注册表大概率未建，蓝图字段大概率还在——以代码为准，报告里写清你核对到的现状）。

## 4. palette 与站位（WI-4/5，可被裁剪）

- **WI-4 palette 升级**：`/` 空态从空列表改为**分类浏览**（用 `ACTION_COMMAND_CATEGORIES` 的色+图标分组列出指令，输入即过滤——复用 `ActionCommandMenu`/`StoryActionCreatorPanel` 的现成渲染，不做新组件）；搜索域=token+aliases+本地化 label（`localizedTokenMap` 已有）+**拼音**（静态生成表：为 zh label 生成一份 build 期/常量拼音映射，**不引入运行时依赖**；生成脚本一次性，产物入库）；指令参考面板：从 spec registry 自动生成可搜索指令手册（签名/别名/说明），挂现有帮助入口，纯派生零手维护。
- **WI-5 组头站位下拉**：分组头（M1）加 hover-reveal 站位下拉（left/center/right，bible `at=` 词表）。语义=P3 原则的样板：读=向上扫描该角色最近 enter/move 的 `at=`（复用 `buildDialogueAppearances` 的累积模式扩展 position）；写=改写该最近行的 `at=`，无则在组头上方插入一行 `/move <角色> at=<pos>`。全走 history 可 undo。文档里永远是命令行，UI 只是声明式外壳。
- **裁剪规则**：若 WI-1..3 规模超预估（bible M4 尤其可能），WI-4/5 允许整体顺延到 M3.1——在报告里明说即可，不要为赶量牺牲主线质量。

## 5. 明确不做

- 引擎侧一切（M4 里程碑卡的事：行内表情 token、换行、until:actionId 等）。
- 检查器"跟随选中 vs 按激活打开"语义**不动**（用户拍板 pending，维持 M2 现状）。
- 不新增运行时依赖（拼音=静态表）；不做虚拟化；不碰另一 session 的 WIP 文件。

## 6. 验证要求（报告逐项）

1. `yarn lint` 全绿；vitest 相关范围新失败 0（win32 基线 8-9 个列名即可），bible 各 WI 按其"测试全绿为闸门"的要求补测试。
2. 真机逐项：①M2 顺延项——差分头像视觉 + 检查器/快编/右键/禁用/试听快速过面；②WI-1——Enter 分级（残缺输入落草稿行琥珀显示、重开有完整补全、Escape 一次性）；③WI-2——若干代表性指令的 overview 投影 + 草稿行视觉；④WI-3——persistent 声明/引用/编译校验 + Dev Mode 预览播种一致性；⑤WI-4——`/` 空态分类浏览、拼音搜索命中、指令手册；⑥WI-5——组头站位读/写/undo。
3. 关键截图存 `docs/plans/reports/assets/`（草稿行、overview 行、palette 空态、指令手册、站位下拉）。

## 7. 反馈报告（必交）

`docs/plans/reports/2026-07-23-M3-report.md` 并回贴全文，**≤60 行**，模板同前（状态/文件/偏离与决策/i18n/验证/风险/重点验收 2-3 处）。附加两节：①尾款九条逐条 done/skipped；②bible M4 现状核对结论（哪些已在、哪些是你建的）。若行使了 §4 裁剪规则或 §0 子代理授权，各用一行说明（子代理做了什么、你如何复核）。

## 8. 何时必须停下来报告

- 实现要求违反交互契约中 bible §4 未修订的条款，或 §5 不做清单。
- bible 文档与代码现状冲突到无法判断"哪边是真相"（尤其 WI-3 的变量现状核对）。
- 要编辑的文件带着另一 session 的未提交改动；需要新运行时依赖；schema 需要 v8 之外的改动。
- 单个 WI 规模超预估一倍（先行使 §4 裁剪规则，裁无可裁再停）。
- 停下时：提交已完成 WI，报告标 partial，交回。
