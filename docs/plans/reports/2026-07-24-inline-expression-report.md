# 行内表情报告（B1 收官：TextEvent 的 Studio UI/编译 + 引擎收尾三件）

分支：引擎 `fix/text-event-followups`@`6cd28b2`（worktree `narraleaf-react-inline`，基线 dev_nomen `f93bb6d`，未合并、worktree 留存）；Studio `feat/story-inline-expression`@`4a71f47`（自 develop，未合并/未 push）。

## 状态
WI-0 三件 done · WI-1 v8 文档模型 done · WI-2 统一渲染器 token UI done（含顺手做的 SE 选择器）· WI-3 编译器 done。lint/tsc 全绿，新失败 0。**真机端到端未由我执行**（见末节，交手测硬验收）。

## WI-0 引擎收尾（narraleaf-react-inline）
1. **JSDoc skip 语义**：`TextEvent` 类文档补「跳过/瞬时揭示 = 已越过 token 全部按序落终态、各 SE 各响一次、同 reveal 内重访为 no-op」。
2. **NVL 重挂载重放守卫**：根因＝NVL 列表按 `phase/active` 给条目做 React key，条目每次相位切换（typing→awaitAdvance→idle）都重挂载 → instant-reveal 分支用「每次挂载新建的 fired 集」重放 SE + 回写陈旧表情。修法＝把 fired 守卫上移到长生命周期的 `NvlDialogEntry`（经 `DialogState.config.firedTextEvents` 下传，roll 与 instant 两路共享）：一行的 token 只触发一次，任何重挂载都不重放；载入时 entry 由 `NvlDialogEntryData` 重建、无此运行时字段 → 该说话重评仍会重触发（重放安全保留）。ADV 不受影响（其 DialogState 已按 action memo）。新 `fireInstantRevealEvents` 是缝，缝测锁「同持久集重挂载不重放 SE/不回写表情」+「roll 已触发后 instant 不再触发」。
3. **契约 5c/5d**：5c 经真 helper `fireInstantRevealEvents` 覆盖「越过全部 token 落终态」；5d 新增「说话中途存/读档一致」缝测（走 `Image.toData/fromData` —— 即 `serializeGameState`/`deserialize` 逐元素驱动的同一单元）。**真组件 trySkip / 全 LiveGame 存读档集成维持缝级**：本仓无 React/全游戏无头设施，搭建超预估，按卡内逃生条维持。引擎全量 vitest **262/262**；每步 build:dev + postbuild 拷 Studio，Studio 编译器回归 **102/102**。

## WI-1 文档模型（Studio，schema v7→v8）
`StoryRichRun` 新增 `event` 臂：`StoryInlineEvent = { expression?: { characterId; formName?; variants? }; sound?: { assetId } }`（闭集，零宽）。`value` 纯文本投影不受影响（`richRunsToPlain`/`serializeSegmentSourceText` 均跳过）。迁移＝v8 版本戳无操作（v7 文档无 event run），ladder 注释同步；v7→v8 加法迁移测试。

## WI-2 编辑器 UI（统一渲染器红线）
`richText.ts` 全链路认 event run：`isEventRun` 守卫、warning 色零宽 chip（表情＝笑脸图标 + form 标签，纯 SE＝音符图标），及 round-trip/单位模型各缝（normalizeRuns/renderRunsToElement/domToRuns/isChipElement/markSelectedChips）—— 绝不误路由成 pause run。`RichTextInput` 增 insert/update/remove event + `onEventClick`。工具条加**门控**「表情」按钮（仅对话行有角色时现）。`ExpressionPopover` 复用 `CharacterAppearancePicker`（form/差分）+ 复用资产选择器做可选 SE（`AssetField` 导出复用）；点 chip 重开、插入落默认 form chip 再由选择器细化 —— 与 pause/value 同族「插入后点选编辑」。读/编两态同一 `renderRunsToElement`。

## WI-3 编译器
`buildSentenceParts` 遇 event run → `TextEvent.expression(getImage(角色台名), 差分src, {sound})` / `TextEvent.sound(se)`。差分→资产走共享 `characterVariant` + `resolveCharacterImageUrl`，SE 走 `resolveAsset`。event run 异步预解析（资产 URL）后同步注入，索引与 interpolation 对齐。诊断＝characterId 无效/差分无资产 → 与既有 character 块同族 warning + 略过（周边文本仍编译）。行内表情目标＝角色舞台像（按 characterId，与 `/show` 一致）。翻译态与 pause 同：仅源语言携带 event。集成测试：TextEvent 形状 / 纯 SE / warn+omit / 零宽投影。

## 测试与验证
Studio：`yarn lint`（tsc 全项目）clean；scene-editor + 编译器 + story 定向 **415/415**（含新增 richText 5 例、编译器集成 3 例、v8 迁移 2 例）。`yarn build:dev` esbuild 全绿（真构建通过）。并行协调：**与 M-VAR 文件交集为零**（对方 966c02a 已提交并暂停；本卡未碰 declarations/蓝图/VariableRegistry*）。schema 用 v8（M-VAR 预留 v9），无冲突。

## 已知/风险 · 真机硬验收（待手测）
- 行内表情目标像按 characterId 定名，等同默认 `/show 角色`；若该角色用了自定义 objectName 显示，行内 token 暂不跟随（首版限制）。
- 翻译态丢弃 event（与 pause 同）；SE 在 React 严格模式双挂载下仍可能双响（引擎既有已知项）。
- **真机端到端未由我跑**（差分角色+资产+Dev Mode 打字机时序观测，属手测视觉域）。dist 已构建就绪。手测清单：Dev Mode 一句台词打字机走到 token → 立绘换差分；skip → 终态；说话中途存/读档 → 重放一致；截图存 assets。
