---
title: "task: M2 操作层 — M1 尾款、右栏检查器、行内快编、右键菜单与行禁用"
type: handoff
status: draft
date: 2026-07-22
parent: 2026-07-22-001-feat-story-editor-overhaul.md
---

# task: M2 操作层

你是本任务的执行者。动手前**必须先读**（按序）：

1. `docs/plans/2026-07-22-001-feat-story-editor-overhaul.md` §2.4、§5.2、§5.3（产品依据）与 §8（不做清单）
2. `docs/story-editor-interaction-model.md` 全文（交互契约；本卡把检查器从行内搬到右栏，契约语义一条都不许变）
3. `docs/plans/reports/2026-07-22-M1-report.md`（上一棒的交付与偏离）
4. 本卡 §2 的 M1 验收发现（你要修的缺陷的完整根因在这里）

完成后按 §7 交报告。遇到 §8 情形停下报告，不要即兴发挥。

## 0. 分支、提交纪律与共享工作树警告

- 从 `develop`（含 M1 合并 `8129e16`）切 `feat/story-m2-operation-layer`，全部工作在该分支。
- **共享工作树上有另一个活跃 session 的未提交 WIP**（状态栏 Dev Mode 入口、`src/main/app/application/managers/debug/`、`project/app/` 工具链、`ipcEvents.ts`、i18n `actions`/`workspace` 等约 20 个文件）。铁律：
  - **永远逐文件 `git add <path>`，禁止 `git add -A` / `git add .`**；
  - 不 revert、不"顺手修"那些文件；M2 不需要动其中任何一个（i18n 你只动 `story.ts` / `characters.ts`）；
  - 若你必须编辑的文件已带别人的未提交改动 → 停下报告（§8）；
  - 禁止 `git stash`；工作期间不切分支。
- 每个 WI 一到几个内聚 commit（`feat(story): ...` / `fix(story): ...`）。不合并不 push，分支留给 orchestrator 验收。
- 跑应用注意：若 5588 被占（`yarn dev` 会自己报），说明另一 session 的 dev 在跑——别抢；可直接 `node_modules\.bin\electron dist\main\index.js --dev --cdp --cdp-port=9224` 起构建好的 dist。**9223 是 dev 调试日志服务器的保留端口**（`/console`、`/devtools` 可拉运行日志，CLI 见 `project/app/debug.js`，若存在），CDP 别用 9223。

## 1. 风格铁律（每个 WI 验收都含这条）

- **禁止解释性文本**：不加说明文字、占位提示、教学 tooltip、空状态文案。
- **禁止装饰元素堆砌**：不发明新的 pill/chip/徽章样式、不加图例、不加卡片分层。右栏检查器就是把现有 `ActionInspector` 的内容放进现有右栏面板容器——不是重新设计一遍。
- **复用现有组件与手势**：ContextMenu、既有 popover 范式、hover-reveal（`RowActions` 的 `opacity-0 → hover/active`）、右栏面板注册（下 §2 有三个现成先例）。
- 明暗主题同时成立；只用既有 CSS 变量与类别色。
- Tailwind 陷阱：需要位移/旋转用独立 `rotate`/`translate` 属性，不用 v3 `transform` 工具类。
- 所有新文案走 i18n，`en`+`zh` 两份都加。

## 2. 现状地图（2026-07-22 验收后核实；行号会漂移，按符号定位）

**WI-0 要修的缺陷（M1 验收实锤，阻断已被用户降级为随 M2 修）**：

- 症状：对话行/表情成员行的差分头像不渲染，落到图标兜底；缩略图路径（无差分角色）正常。
- 根因：`StorySceneEditorRows.tssx` 文件内的 `useServiceAssetObjectUrl` 用 **`ServiceAssetsService.readRaw`** 读图；它的存储是 `editor/assets/`（角色缩略图在这）。而 `BlockBadge`/`GroupExpressionMember` 经 `resolveCharacterBadgeImage` 解析出的差分立绘 id 属于**项目资产库**（`assets/assets.metadata.image.json`，`CharacterForm.variantAssets[*].data.id`）。`readRaw` 对项目资产 id 返回 `ok:false`（静默），URL 恒 null → icon。
- 证据（实项目 demo3）：缩略图 id `31925655…` 是 `editor/assets/` 下的文件；差分 id `99553d15…` 在 `assets.metadata.image.json`。DOM 里差分行徽章无 `<img>`。
- 修法约束：按 id 归属路由到正确的读取服务（项目资产的正确加载先例就在 characters 模块——`PreviewPanel` 能渲染立绘，找到它用的加载器并复用；assets 模块也有资产读取路径）。**顺带解决性能问题（P1，同一处代码）**：当前每行独立 `readRaw` 全尺寸立绘 + 每行独立 headCrop 剪影分析（blob URL 每行唯一 → headCrop 的 URL 键缓存永不命中）。要求：资产 id 键的共享 object-URL/裁剪缓存（模块级或 context），revoke 生命周期明确；同一资产在 N 行只读一次、只分析一次。
- 复验脚本（orchestrator 验收会重跑同样内容）：给某角色配 form+variant+立绘资产，`/show` 该角色带差分 → 其后对话行头像应显示按 portrait rect（或自动取景）裁剪的立绘；`/face` 行头像同理。

**WI-0 一并清掉的 P2 清单**（均为 M1 验收发现，小而机械；逐条修，逐条在报告标注）：

1. 「只看叙事」过滤态：空对话行 Backspace 降级为插入槽时锚点可能是隐藏行 → 槽开了但不可见。修：锚定最近**可见**兄弟，或该场景下直接不降级。
2. 过滤开启时选区里残留隐藏行 → Delete 会删看不见的行。修：开启过滤时把选区裁剪到可见行。
3. `revealBlock` / 搜索跳转到被过滤隐藏的行 → 隐形选中。修：跳转优先，自动关闭过滤（跳转赢过滤）。
4. 分组跨容器边界：`annotateDialogueGroups` 只看相邻性，选项体末行会与容器外同角色行成组。修：同组要求同 `parentId`/同 depth。
5. 名牌颜色无对比度守卫、且不让位选中态。修：相对亮度检查不可读则回退默认 ink；选中/激活态样式优先于角色色。
6. form 级 portrait 覆盖在 UI 不可新建（`writePortrait` 只在已存在时走 form 分支）——给最小入口或砍掉死分支，二选一并在报告说明。
7. 舒适密度下插入槽 `min-h` 与行不一致（35 vs 46px）。对齐。
8. `HeadThumbnail` frame 从有到无时 img 可能永久 `opacity-0`（缓存命中跳过渲染同步）。加守卫。
9. 补测试：note 断组、exit 断组、characterId-vs-speakerName 混合不成组、filter→group 顺序（行号保持原值）、以及本卡新增行为（disabled 编译跳过、schema v7 迁移、选区裁剪）。

**WI-1 检查器迁移的地基**：

- 行内展开：`ActionInspector`（`StorySceneActionInspector.tsx`，~2100 行）当前渲染在行内（`StorySceneEditorRows.tsx` 中 `inspectorOpen` 分支）。这是滚动偏移的病根，迁移后**删除行内展开路径**。
- 右栏面板注册先例：`StorySceneEditorTab.tsx` 在 tab 激活期动态 `uiService.panels.register(...)` 了三个 Right 面板（Action Creator / Variables / Snapshots）——检查器照抄这个模式做第 4 个。面板体系：`registry/types.ts` 的 `PanelPosition.Right`、`components/layout/RightSidebar.tsx`。
- 迁移策略：**先整体搬、后逐步框架化**。把 ActionInspector 组件原样挂进右栏面板容器，跑通选中行→面板内容联动；`modules/properties/framework/` 的 PropertyEditor 体系是后续演进方向，本卡不强制改写。
- **交互契约不变式**（逐条自验）：`Enter` on action row → 打开检查器（位置变为右栏）；Escape 阶梯保留"关闭检查器、行保持选中"一档；card-less 行为不变（条件容器等 `hasInspector` 为假的行，Enter 语义照旧）；行内既有 popover（Condition/Interpolation/Pause/CharacterAppearancePicker）不受影响。
- 检查器随选中行切换；无选中时显示空态（**不写文案**，参考 Properties 面板现状）。多选时显示首行或空态，报告里说明取舍。

**WI-2 行内快编（quickParams）**：

- spec 层：`scene-editor/commands/spec.ts` 的 `StoryCommandSpec` 增加可选 `quickParams` 声明（参数 key 子集）。首批覆盖：wait 的时长（含 200/500/1000/2000/3000 预设）、`setBackground`/character enter/exit 的 `t=`/`d=`、audio 的 `vol=`/`loop`、jump 的目标场景。
- 行渲染：committed 行摘要中这些参数变为**可点击的既有样式 token**（不发明新 chip——沿用摘要文本样式加 hover 下划线/背景即可），点击开小 popover 原位编辑（`PausePopover` 是现成范式）。编辑提交走既有 history 路径（可 undo）。
- 目的：高频微调不再需要打开检查器（bible B10 的"行内高频"半边）。

**WI-3 右键菜单 + 行禁用**：

- 菜单：复用 `lib/components/elements/ContextMenu.tsx`（`StoryPanel.tsx` 有完整用法先例）。条目：上方插入、下方插入、复制行、禁用/启用、从此行播放（复用 `onPlayFromRow`）、打开检查器、删除。作用于选区（右键行在选区内时对整个选区生效，`selectRange` 语义沿用）。
- `disabled` 一等字段：`src/shared/types/story/document.ts` 的 `StoryBlockBase` 增 `disabled?: boolean`；`STORY_DOCUMENT_SCHEMA_VERSION` 6→7；迁移在 `storyModel.ts` 的 `migrateStoryDocumentToLatest`（v7 迁移＝无操作，只认版本号）。
- 编译：`storyCompiler.ts` 的 `compileBlock` 对 `disabled` 块（含其子树——容器禁用即整支跳过）不产出、**不报错**；与 `invalid`（错误、构建拒绝）、`note`（注释）三分。构建（`collectInvalidBlocks` 门）不拦 disabled。
- 渲染：禁用行整体降不透明度 + 摘要/文本弱化（muted），不加删除线以外的新装饰；行号保留。Dev Mode/预览里行为=不存在。

**WI-4 语音试听 + 检查器语音区**：

- 行上：对话行 hover-reveal 播放键，仅当该行 `text.textId` 在主语音 locale 有 take 时出现（`StoryVoiceIndicator` 已做 take 查询，别重复查询逻辑，抽出共享）。播放/停止复用 `modules/voice/VoiceRows.tsx` 的 audition 实现；全局同刻只有一个在播（开新的停旧的）。
- 检查器语音区：当前 take 状态（有/无/stale）、试听按钮、跳转 voice 表（`createVoiceEditorTab`）。**不做行内指派**（绑定仍走 voice 表的 import-first 模型），不复活 `dialogue.voiceAssetId`。

## 3. 工作项顺序

WI-0（尾款，先行——它触碰的文件后续 WI 也要动，先修干净再叠新功能）→ WI-1 检查器 → WI-2 快编 → WI-3 菜单/禁用 → WI-4 语音。每项完成即 commit。

## 4. 明确不做

- 不动 InsertRow / 补全 / palette / 指令词表（M3）；不做组头声明式站位控件（M3）。
- 不做语音行内指派；不动 Dev Mode；不做虚拟化。
- schema v7 只加 `disabled`，不夹带其他字段。
- 不新增依赖；不引入新配色与新组件样式语言。
- 不触碰共享树上另一 session 的 WIP 文件（§0 列表）。

## 5. 验证要求（报告逐项给结果）

1. `yarn lint`（tsc，5 项目）全绿。
2. vitest：新增测试（§2 WI-0 第 9 条 + disabled/v7）全绿；相关范围无新失败（win32 基线 8-9 个既有失败列名即可）。
3. 真机（起 dist 或 `yarn dev`，见 §0 端口注意）逐 WI 验收：差分头像在对话行/表情成员行正确渲染（这是 WI-0 的硬验收，orchestrator 会用文件侧种子内容复验）；检查器在右栏联动、行内展开已删除、Enter/Escape 契约在位；quickParams 点击改值可 undo；右键菜单全条目可用；禁用行预览中被跳过；语音试听可播可停。
4. Dev Mode 启动一次含 disabled 行的场景确认编译跳过且无错。
5. 关键界面截图存 `docs/plans/reports/assets/`（检查器右栏、快编 popover、右键菜单、禁用行、修复后的差分头像行）。

## 6. 判断与自由度

未写死处（检查器面板宽度/分区顺序、快编 popover 布局、禁用行的具体弱化值）按 §1 铁律自行决策并在报告记录。写死处（契约不变式、逐文件 add、schema 范围、三分语义、audition 复用）没有自由度。

## 7. 反馈报告（必交）

写入 `docs/plans/reports/2026-07-23-M2-report.md` 并回贴全文。**≤60 行**，模板同 M1（状态/文件/偏离与决策/i18n/验证/风险/需要 orchestrator 重点验收的 2-3 处）。WI-0 的 P2 九条逐条标注 done/skipped(为什么)。

## 8. 何时必须停下来报告

- 任何实现路径要求违反交互契约或 §4。
- 要编辑的文件带着另一 session 的未提交改动。
- 检查器迁移中发现行内展开承载了无法在右栏复现的行为（如依赖行内布局的定位逻辑）。
- schema v7 之外的文档模型改动冲动；需要新依赖；WI 规模超预估一倍。
- 停下时：提交已完成 WI，报告标 partial，交回。
