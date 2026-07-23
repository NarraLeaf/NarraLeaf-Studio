---
title: "task: M1 阅读层 — 对话分组、差分头像、行类视觉、角色色、密度与过滤"
type: handoff
status: draft
date: 2026-07-22
parent: 2026-07-22-001-feat-story-editor-overhaul.md
---

# task: M1 阅读层

你是本任务的执行者。本卡自包含，但动手前**必须先读**（按序）：

1. `docs/plans/2026-07-22-001-feat-story-editor-overhaul.md` 的 §0–§2、§5.1（本卡的产品依据；§8 不做清单同样约束你）
2. `docs/story-editor-interaction-model.md` 全文（交互契约，逐条打磨出来的，任何一条被破坏即验收失败）
3. `docs/plans/2026-07-16-003-handoff-story-row.md` 的 "The rest of the model — already landed, don't renegotiate" 一节

完成后按 §7 写反馈报告。遇到 §8 列出的情形，**停下报告，不要即兴发挥**。

## 0. 分支与提交纪律

- 从 `develop` 切 `feat/story-m1-reading-layer`，全部工作在该分支。
- **每个工作项（WI）一个或几个内聚 commit**，消息风格随仓库惯例（`feat(story): ...` / `feat(characters): ...`）。
- 不合并、不 push 到 master/nightly；分支留在原地，由 orchestrator 验收后处理。
- 本 checkout 可能被多个 session 共享：**禁止 git stash**，工作期间不要切换分支。
- 不新增运行时依赖；若确有必要，停下报告（§8）。

## 1. 风格铁律（每个 WI 验收都含这条）

本项目的界面哲学：**克制、紧凑、复用**。新 UI 必须长得像"本来就在那里"。

- **禁止解释性文本**。不加说明文字、占位提示、教学性 tooltip、空状态文案。界面元素自己解释自己；解释不了就说明设计错了。
- **禁止装饰性元素堆砌**。不引入新的 pill/chip/徽章样式、不加图例、不加分隔卡片、不加阴影层级。表达行类只允许用：既有 badge、类别色、缩进、细导轨线、密度。
- **复用现有组件与手势**：ContextMenu、既有 popover 范式、hover-reveal 按钮（参考 RowActions 的 `opacity-0 → hover/active 显示`）。想加新控件前先找现有的。
- 新增视觉必须同时在明暗主题下成立（用既有 CSS 变量/类别色，不发明新色板）。
- Tailwind 陷阱：narraleaf-react 会注入 Tailwind v4 样式表，杀死 v3 的 `transform` 组合工具类——需要位移/旋转时用独立的 `rotate`/`translate` CSS 属性，不用 `transform` 工具类。
- 文案极少且必须走 i18n：`src/shared/i18n/catalog/en/*.ts` 与 `zh/*.ts` **两份都加**。

## 2. 现状地图（2026-07-22 核实；行号若漂移按符号名重新定位，不要猜）

**行渲染**（全部在 `src/renderer/apps/workspace/modules/story/scene-editor/`）：

- `StorySceneEditorRows.tsx` — `StoryBlockRow`(:66)，grid `[36px_28px_1fr]`=行号/拖拽把手/内容(:143)；`BlockBadge`(:1725) 24px 徽章，对话行取 `character.profile.getThumbnail()` 单图 object-cover（**不随差分**）；narration/note 隐藏徽章(`hideBadge`:126)；`BlockPreview`(:1859) 行摘要；对话名牌 `CharacterSelectTrigger`(:1576)；hover 按钮 `RowActions`(:505)、`RowPlayAction`(:554)；语音指示 `StoryVoiceIndicator`(:262 处渲染)。
- `useStorySceneEditorController.ts` — `visibleRows: VisibleStoryRow[]` 投影（lineNumber/depth），类型在 `storySceneEditorTypes.ts`。
- `StorySceneEditorTab.tsx:997` — 行列表是裸 `map` + dnd-kit（无虚拟化）。
- 类别色唯一来源：`storyActionCommands.ts` 的 `ACTION_COMMAND_CATEGORIES`(:192，icon+iconColor)；行徽章信息走 `storySceneBlockUtils.ts` 的 `getBlockBadgeInfo`。
- 指令 spec：`scene-editor/commands/`（`spec.ts`、`registry.ts`；label i18n key `story.command.<id>.label`）。

**文档类型**：`src/shared/types/story/document.ts` — dialogue payload(:250-267，`characterId?`/`speakerName?`，**无差分字段**)；character action(:286-296，`operation: enter|move|exit|expression`，`formName`/`variants`)；`StoryCharacterVariantSelection`(:554)。**本卡不改故事文档 schema。**

**角色模型**：`src/renderer/lib/workspace/services/character/` — `types.ts`：`CharacterEditorProfile`(:10，含 `thumbnail`，**无 color、无 portrait**)；`CharacterForm{name,groups,variantAssets}`(:59)、`CharacterVariantGroup`(:53)、`variantAssets: Record<variantName,{data:Asset<Image>}>`(:65)。`CharacterProfile.ts` `getThumbnail`(:136)。头部取景工具 `src/renderer/lib/utils/headCrop.ts`（`characters/editors/components/HeadThumbnail.tsx` 在用）。角色编辑器在 `modules/characters/editors/`。
**差分→资产选择逻辑**（要抽共享）：`src/renderer/lib/ui-editor/runtime/game/storyCompiler.ts` `selectCharacterVariantNames`(:2636)、`resolveCharacterImageUrl`(:2609)。
资产 URL：`useServiceAssetObjectUrl`（`StorySceneEditorRows.tsx:1754` 用法可参考）。

**校验基线**：`yarn lint` 只是 tsc（过 lint 只证明类型）；vitest 在本机 win32 有 8–9 个**既有**失败，不是你造成的回归——报告里区分即可。

## 3. 工作项（按序执行，每项完成即 commit）

### WI-1 角色颜色

- `CharacterEditorProfile` 加可选 `color?: string`（hex）。加载路径必须容忍旧数据缺字段（核实序列化处，追加式字段应零迁移）。
- 角色编辑器基础信息区加一个颜色选择入口——复用项目现有取色组件（`modules/properties/framework/` 有 `ColorPickerField`，或角色编辑器已有的等价物），无新文案（字段标签走既有惯例 + i18n）。
- 消费点（仅编辑器侧，**不下沉运行时**）：对话行名牌、WI-5 组头名字。未设置时保持现状颜色。
- 验收：设色后名牌变色、明暗主题可读；删字段/旧项目打开不炸。

### WI-2 行类视觉系统

- 让每个 action/control/jump 行都能从 `getBlockBadgeInfo` 解析出 `{icon, color}`（来源统一为 `ACTION_COMMAND_CATEGORIES`，不新增色板）。
- 行渲染：非对话、非旁白的行加**左缘 2px 类别色条**（低调、可用透明度压暗），徽章底色沿用类别色。narration/note 保持零 chrome，对话行不受影响。
- `BlockPreview` 动作行摘要统一为「本地化 label + 关键参数」纯文本形态（label 用 `story.command.<id>.label`）。只修不一致和最难读的样例，**不重写摘要体系**。
- 验收：混合行的场景中一眼可按颜色区分 场景/角色/声音/流程 类；截图对比。

### WI-3 portrait 选区 + 差分头像解析

- 数据（角色服务，非故事文档）：`portrait?: { x, y, w, h }`（相对 0–1）挂 profile；`CharacterForm` 允许同形状覆盖；变体组级覆盖可选，若实现成本高则 form 级为止（报告里说明）。
- 抽共享工具：把 `selectCharacterVariantNames` + `variantAssets` 查找抽成 UI 与编译器都能用的纯函数（放置位置自选，约束：无循环依赖、runtime target 构建不受影响、**编译行为零变化**）。
- `BlockBadge` 变为差分感知：
  - character action 行（enter/expression）：用行自身 payload 的 form/variants 解析资产；
  - dialogue 行：控制器投影单趟累积「每角色当前外观」（该角色最近一次 enter/expression 生效，exit 复位默认），行上取用；
  - 解析失败回退 `thumbnail`，再回退现状图标。
- 渲染取景：有 rect 用 rect（CSS objectPosition/缩放，参考 `headCrop.ts` 手法），无 rect 回退 headCrop 启发式。**不做位图烘焙**。对象 URL 沿用现有缓存 hook。
- 验收：同一角色 换差分行 之后的对话行头像随之变化；无 rect 的角色不劣化于现状。

### WI-4 裁剪拖拽编辑（最小）

- 位置：角色编辑器立绘预览上叠一个可拖动/可缩放的矩形（操作对象为当前选中 form；未覆盖时编辑的是 profile 级 rect）。
- 复用现有覆盖层/手柄样式惯例；提供一个 hover-reveal 的重置（清除 rect 回自动取景）。**无任何说明文字。**
- 验收：拖框后故事行头像立即用新选区；重置后回自动取景。

### WI-5 对话分组（纯渲染投影）

- 投影：`visibleRows` 增加分组派生字段（组首/组内）。规则：**连续 dialogue 行、说话者同一**（`characterId` 相同；无 characterId 时 `speakerName` 严格相等）。**同角色的 `character/expression` 行不打断分组**，其余任何 kind（含 note，v1）打断。
- 组首：portrait 头像 + 角色色名字（既有名牌组件着色）。组内行：不再渲染徽章与名牌，改为左侧细导轨线 + 文本对齐缩进。**grid 三列结构不动**（行号列、把手列保留，点击/拖拽/选择热区不得位移）。
- 组内的 expression 行：紧凑渲染为「小差分头像 + 差分名」一行，弱化（muted）。它仍是普通行：可选中、可拖、Enter 行为照旧。不引入新样式语言（§1）。
- 行语义零变化清单（逐条自验）：行号连续性、单击选行/双击进编辑、跨行拖选、拖拽重排（拖出/拖入组即时重新分组）、`Enter` 继承说话人、`Escape` 阶梯、RowActions/RowPlayAction/语音指示照常出现。
- 投影必须 memo；粗测 500+ 行文档滚动无明显退化（无需虚拟化，见 §8）。
- 验收：图 3 式读感——同角色多行一个头像、表情变化处有弱化标注；上述语义清单全绿。

### WI-6 密度与「只看叙事」过滤

- 两个视图开关，放在故事编辑器 tab 既有 chrome 内（不加浮动工具栏）：
  - 密度：紧凑（现状）/ 舒适（行距、字号、旁白留白放大——一组 CSS 变量或容器 class，不逐组件改样式）。
  - 只看叙事：投影层隐藏 action/control/jump/declaration 行（expression 行也隐藏），保留 narration/dialogue/choice/choiceOption/note。行号保持原值，**不重编号**——行号断档即隐藏指示，不加任何"N 行已隐藏"文案。过滤开启时插入槽随隐藏行收起；可见行编辑照常。
- 两个状态按项目既有偏好持久化惯例保存（参考资产面板 list/icons 视图态的存法）。
- 验收：切换即时生效、持久化生效；过滤态下选择/编辑可见行无异常。

## 4. 明确不做（出现冲动即停）

- 不改故事文档 schema（`disabled` 字段属 M2）；不动 `ActionInspector`、语音绑定、InsertRow/palette（M2/M3）。
- 不做虚拟化；不做位图烘焙；不做游戏内（运行时）名牌颜色。
- 不改编译器行为（WI-3 只允许无行为差异的抽取重构）。
- 不动交互契约与 `RichTextView`/`renderRunsToElement` 的统一渲染结构。
- 不新增依赖、不引入新配色、不加解释性 UI。

## 5. 验证要求（报告里逐项给结果)

1. `yarn lint`（tsc）全绿。
2. vitest 相关范围（story / character）——新失败为零；既有 win32 基线失败列出即可。
3. `yarn dev` 启动 Studio，打开测试项目实际验证每个 WI 的验收条目；关键界面截图（分组前后对比、行类色条、裁剪编辑、密度/过滤）存 `docs/plans/reports/assets/` 并在报告引用。
4. Dev Mode 启动一次任意场景，确认预览/编译无回归（WI-3 抽取的红线）。

## 6. 判断与自由度

规格没写死的（组头行高、导轨线颜色取值、舒适档具体参数），按 §1 铁律自行决策并在报告"偏离与决策"一栏记录。规格写死的（分组规则、grid 不动、行语义清单、不做清单）没有自由度。

## 7. 反馈报告（必交）

写入 `docs/plans/reports/2026-07-22-M1-report.md` 并把全文回贴给用户（用户会转交 orchestrator）。**总长 ≤60 行**，模板：

```
# M1 报告
分支/commits: feat/story-m1-reading-layer @ <首..尾 sha>
## 状态
WI-1..WI-6: done | partial(差什么) | skipped(为什么)
## 文件
<按 WI 分组的改动文件清单，一行一文件>
## 偏离与决策
<与卡不一致的每一处：做了什么、为什么；无则写"无">
## i18n
<新增 key 列表>
## 验证
lint: ; vitest: <新失败 0；基线失败 N 个（列名）>; 应用实测: <逐 WI 一句话>; 截图: <路径>
## 风险与已知问题
<...>
## 需要 orchestrator 重点验收的点
<你最没把握的 2-3 处>
```

## 8. 何时必须停下来报告（而不是继续）

- 任何实现路径要求违反 §4 或交互契约。
- 发现现状地图与真实代码结构性不符（不只是行号漂移）。
- 需要新依赖、需要改故事文档 schema、需要动编译器行为。
- 单个 WI 的实际规模超出预估约一倍以上。
- 500 行文档出现肉眼可感的渲染退化（这会触发虚拟化决策，属 orchestrator 层）。

停下时：提交已完成的 WI，写报告（标注 partial），交回。
