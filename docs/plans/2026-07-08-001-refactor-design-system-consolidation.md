---
title: "refactor: Design System Consolidation"
type: refactor
status: planned
date: 2026-07-08
---

# refactor: Design System Consolidation

## Overview
Studio 的 UI 样式目前高度碎片化：Tailwind 只定义了一个 `primary` token，其余全部依赖任意十六进制值、裸调色板和 white/black 透明度工具类；共享组件库采用率低、自身也硬编码颜色；圆角、字号、交互态各处自行其是。本计划定义一套语义化设计 token 与组件规范，并以"先固本、再补齐、后迁移、终防回归"的顺序分阶段收敛。

## 现状评估（量化，均排除 dist/）

### 颜色
- `tailwind.config.js` 仅有 `primary: '#40a8c4'` 一个自定义颜色 token。
- **309 处任意 hex**（`bg-[#0f1115]` 形式）分布在 130/306 个 tsx 文件中；深色表面色约 60 种近似值并存（`#0f1115`×59、`#1e1f22`×49、`#0b0d12`×45、`#05060a`×10、`#17181c`、`#16191e`、`#101216`…）。
- **1230 处裸灰调色板**，且 `gray`（1001）与 `slate`（229）两种色相混用；文字层级靠 `text-gray-400/500/300/200` 随手取值。
- **839 处 white/black 透明度**：`border-white/10`×343 是事实标准，但同类边框还有 `/5 /15 /20 /22 /25 /30` 等十几档。
- **主题色三种拼法并存**：`primary` token（约 300+ 处）、裸 `cyan-*`（89 处）、字面量 `#40a8c4`（29 处，含组件库内部与 project-wizard）。`Button.tsx` 的 hover 色 `#4fb8d4` 全库仅此一处。
- cyan 同时被用作 blueprint 绑定状态的**语义色**（BindablePropertyField、BlueprintMemberTree 等），与 primary（本身即青色）形成"两个近似 accent"。
- `styles.css` 定义的 `--narraleaf-accent*` CSS 变量只被少数全局 CSS 使用，**组件层零引用**（半死状态）。

### 圆角 / 字号 / 交互态
- 圆角无规则：`rounded`（243）与 `rounded-md`（212）几乎对半分，另有 `rounded-lg`（60）、`rounded-xl`、`rounded-[5px]`、`rounded-[3px]`；`Card` 甚至按 size 换圆角。
- 字号大量任意值：`text-[10px]`×151、`text-[11px]`×140、`text-[9px]`×17，与 `text-xs`×376、`text-sm`×287 并行。
- focus 四种流派：`focus:ring-*`、`focus-visible:ring-*`（/40 /50 /60 皆有）、`focus:border-primary/50`、`focus-visible:outline-*`；blueprint 又用 `ring-cyan-400/*`。
- disabled 透明度分裂：`opacity-50`×27 vs `opacity-40`×16（另有 60/45/25）。
- hover 行高亮存在 ~8 档近似 alpha（`white/10`×130 为主流，另有 `/5 /[0.06] /[0.05] /[0.04] /[0.035] /[0.03] /[0.02] /[0.08]`）。
- 相对健康：间距（`gap-1/2/3` 绝对主导）与动效时长（`duration-150/200`）已经收敛，不需大动。

### 组件库（`src/renderer/lib/components`，16 个文件）
- **采用率低**：裸 `<button>` 出现 339 次（125 个文件），而 `Button` 组件仅被 import 3 次；194 个 app 层 tsx 中只有 58 个引用过 lib/components。
- **库自身硬编码**：Button/Input/Select/Switch/Progress 直接写 `[#40a8c4]`；Modal/ContextMenu/EnhancedInput 面板底色写死 `#1e1e1e`/`#1e1f22`/`#252525`/`#17181c`。
- **API 不一致**：variant 词表冲突（Input 的 `error` vs Button 的 `danger`；Card 的 `elevated/outlined` 自成体系）；Button 默认 `secondary` 而 IconButton 默认 `ghost`；Modal 的 size 语义是 max-width 而非 padding；回调风格 `onCheckedChange`/`onChange(value)`/`onChange(event)` 混杂。
- **无 `cn()` 工具**：全库字符串拼接合并 className，无 clsx/tailwind-merge，外部传入的 `className` 无法可靠覆盖基础工具类。
- **缺失的常用原语**：Tooltip（现状：100% 原生 `title=`，仅 story+ui-editor 就 97 处）、Tabs/TabStrip、Badge/Chip、Checkbox/Radio（现为 styles.css 全局元素样式）、Popover、Toast、Spinner/Skeleton、EmptyState、FieldLabel/FormField、Slider。

### App 层重复手写模式（消重收益最大的清单）
1. **工具栏图标按钮**（20+ 处）：`grid h-? w-? place-items-center rounded* text-gray/slate-* hover:bg-white/10` 各处 size（h-6/7/8/9）、圆角、边框、文字色全不同。ui-editor 已抽出 `controlButtonClass()`（`widget-modules/shared/chrome/constants.tsx`），但 PropertiesPanel 等处又把同一字符串重新内联。
2. **Tab 条**：4 套独立实现（StorySceneEditorRows / ConsolePanel / BlueprintRuntimeDebugPanel / EditorGroup），active 背景 `#151922`/`#12151c`/`bg-primary/[0.15]` 各异,下划线有 `/70` 有 `/100` 有上有下。
3. **面板头部行**：`border-b border-white/10 px-3` + 高度 44/36/48px 或 `py-2/3` 各异（5+ 处）。
4. **小节标签（eyebrow）**：`text-[10px]|[11px] font-medium tracking-wide text-slate/gray-500`；`FIELD_LABEL_CLASS` 常量在 3 个文件字节级复制。
5. **Badge/chip**：5+ 处各自手写 `rounded px-1.5 py-0.5 text-[10px]`。
6. **空状态**：无共享组件,字号颜色不一（同一文件内都有 text-xs/text-sm 混用）。
7. **搜索框**：assets 模块的 `SearchBox` 是唯一抽出的原子,其余 7+ 处裸 `<input>` 重写。
8. **列表选中态**：三种竞争习语——左侧竖条（`border-l-2 border-primary bg-primary/20`）、填充（`bg-primary/15|/20`）、描边卡片（`border-primary/60 bg-primary/10`）。
9. **区块卡片**：`rounded-md border border-white/10 bg-white/[0.02~0.03]` 四种近似 fill,均未使用 `<Card>`。
10. **同为"面板底色"，各模块 hex 不同**：workspace 壳 `#0f1115`、story 内层 `#1e1f22`/`#16191e`、ui-editor `#17181c`、project 页 `#101114`。

## 根因
1. token 层缺失——没有语义色可用时,每个开发点只能就地发明 hex/alpha。
2. 组件库自身不达标且能力不足（无 cn()、无 Tooltip/Tabs/Badge 等）,用了反而受限,于是绕过。
3. 没有书面规范与机器约束,风格全靠个人记忆,复制粘贴造成方言分化。

## 目标规范（提案）

### 颜色 token（Tailwind v3：CSS 变量 + config 映射,保留 alpha 语法）
styles.css `:root` 定义 RGB 通道变量,`tailwind.config.js` 以 `rgb(var(--x) / <alpha-value>)` 接入：

| Token | 值（提案） | 收敛对象 |
|---|---|---|
| `surface-canvas` | `#05060a` | ui-editor 画布、最深底 |
| `surface-sunken` | `#0b0d12` | 标题栏、inactive tab、下沉区 |
| `surface` (DEFAULT) | `#0f1115` | app/panel 背景（`#101114`/`#101216`/`#111315` 等长尾并入） |
| `surface-raised` | `#1e1f22` | 卡片、输入框、菜单（`#16191e`/`#17181c`/`#16181d` 并入） |
| `surface-overlay` | `#22242a`（新定,统一 `#252525`/`#1e1e1e`/`#181b20`） | 弹出层、dropdown、popover |
| `fg` | gray-100 | 主文字 |
| `fg-muted` | gray-400 | 次要文字（gray-300/slate-400 并入） |
| `fg-subtle` | gray-500 | 辅助/占位（slate-500 并入） |
| `edge` (border DEFAULT) | white/10 | 默认边框（`/15 /22` 等长尾并入） |
| `edge-strong` | white/20 | 强调边框（`/25 /30` 并入） |
| `edge-subtle` | white/5 | 弱分隔 |
| `primary` | `#40a8c4`（**固定锚点,不可改**；H193 S53 L51） | 吸收全部 `[#40a8c4]`、`cyan-*` 装饰用法；hover 用 `primary/80` 替代 `#4fb8d4` |
| `binding` | `#7e70c2`（H250 S40 L60,低饱和藕荷/长春花色） | blueprint 绑定语义色（现 cyan-400/500）；换冷色相与 primary 拉开,又不撞 warning |
| `danger` | `#d1786b`（H8 S53 L62,低饱和珊瑚红） | red-4xx/3xx 收敛,`error`→`danger` 统一命名 |
| `success` | `#6db094`（H155 S30 L56,低饱和海沫绿） | emerald/green 收敛,偏青以呼应 primary |
| `warning` | `#ccaa5c`（H42 S52 L58,低饱和琥珀） | amber/yellow 收敛 |
| `info` | = `primary` 别名 | 不单列,信息态复用 primary |

**色板原则（已定）**：品牌主色 `#40a8c4` 是**唯一固定锚点**;其余强调色一律以"低饱和(S≈40–53)+ 中亮度(L≈51–62)+ 仅旋转色相"的方式派生,保持 Studio 一贯的低饱和克制风格,**禁止使用鲜艳(高饱和)色**。灰阶/表面色沿用既有值收敛,不引入新色相。

同步把半死的 `--narraleaf-accent*` 系列并入该体系（selecto/moveable 等全局 CSS 已引用,保留变量名做别名或统一迁移）。

### 非颜色规则
- **圆角**：控件（按钮/输入/菜单项）`rounded-md`；容器（卡片/面板/弹层）`rounded-lg`；pill/开关 `rounded-full`；**禁用裸 `rounded` 与任意值**。
- **字号**：`fontSize` 只新增**单档** `2xs: 11px`（行高配套）;`text-[9px]/[10px]/[11px]` 全部合并到此档;迁移后禁 `text-[Npx]`。（9/10px→11px 会让密集区文字略微变大,属可接受的可读性提升,Phase 3 迁移时逐模块过目 blueprint pin 等紧凑布局。）
- **focus**：统一 `focus-visible:ring-1 ring-primary/50`（容器型输入用 `focus-within` 变体）；禁 `focus:border-*` 流派与裸 hex ring。
- **disabled**：统一 `disabled:opacity-50 disabled:cursor-not-allowed`。
- **hover**：行/图标按钮 hover 统一两档——弱 `hover:bg-white/5`、强 `hover:bg-white/10`,长尾 alpha 并入。
- **选中态**：全局统一为"填充式" `bg-primary/15 text-white`（列表行可加 `border-l-2 border-primary` 作为导航类列表的第二形态）；Tab active 统一下划线 `bg-primary`。

## 分阶段计划

### Phase 0 — 地基（无视觉变化）✅ 已落地 2026-07-08
1. ✅ 引入 `clsx@2.1.1` + `tailwind-merge@3.6.0`,新建 [`src/renderer/lib/utils/cn.ts`](../../src/renderer/lib/utils/cn.ts);`extendTailwindMerge` 已注册全部自定义 `color` token 与 `text-2xs`,保证 `cn()` 冲突解析 last-wins。
2. ✅ token 落地。**接线方式（实施时定的架构）**：
   - `primary` 保持 hex `#40a8c4` 不动——因为 `styles.css` 里 `--narraleaf-accent: theme("colors.primary")` 依赖它,改成通道语法会让 `<alpha-value>` 占位符泄漏进原生 CSS。Tailwind v3 对 hex 自动支持 `/alpha`,故 `bg-primary/20` 照常工作。
   - `surface*`/`fg*`/`binding`/`danger`/`success`/`warning` 用 CSS 通道变量(`--nl-*` 在 `styles.css :root`,空格分隔 RGB)+ config 里 `rgb(var(--nl-x) / <alpha-value>)`,单一事实来源,原生 CSS/内联样式也能用 `rgb(var(--nl-x))`。
   - `edge`/`edge-subtle`/`edge-strong` 为固定白色 alpha(`rgb(255 255 255 / 0.05|0.1|0.2)`)。
   - 已用真实 config 编译验证：`bg-surface`、`text-fg-muted`、`bg-binding/10`、`border-warning/40`、`text-2xs` 均生成正确 CSS。
3. ✅ 规范文档 [`docs/design-system.md`](../design-system.md)。
4. ✅ 防回归 ratchet：[`scripts/style-ratchet.mjs`](../../scripts/style-ratchet.mjs) + 基线 `scripts/style-ratchet.baseline.json`;`yarn style:ratchet` 比较,`--save` 收紧。**首个基线(债务快照)**：任意 hex 309、裸中性色板 1176、white/black alpha 795、任意 px 字号 312、裸/任意圆角 225、裸 accent(#40a8c4+cyan) 127。

### Phase 1 — 组件库自治（先让"源头"合规）
1. 全库接入 `cn()`,替换字符串拼接。
2. `[#40a8c4]`→`primary`、`#4fb8d4`→`primary/80`（hover 略变亮→略变透,需过目）;面板底色→`surface-raised`/`surface-overlay`;灰字→`fg-*`。
3. 统一 variant 词表（`error`→`danger`）、size 三元组（`sm/md/lg` = `px-2 py-1 text-xs / px-3 py-1.5 text-sm / px-4 py-2 text-base`）、focus/disabled 规则;Button 与 IconButton 默认 variant 对齐并写入文档。
4. Checkbox/Radio 从 styles.css 全局元素样式迁为组件（保留全局样式一段时间兼容存量裸 input）。

### Phase 2 — 补齐缺失原语（按消重收益排序）
1. `IconButton`（toolbar 变体,吸收 A1 的 20+ 处；以 ui-editor `controlButtonClass` 为蓝本升格进 lib）。
2. `TabStrip`（吸收 4 套实现,含 EditorGroup 文档 tab 的 4 态样式作为变体）。
3. `Badge`、`EmptyState`、`FieldLabel`（吸收 3 处字节级复制的 `FIELD_LABEL_CLASS`）、`SectionCard`/`PanelHeader`。
4. `SearchBox` 从 assets 模块升格到 lib。
5. `Tooltip`（替换原生 `title=`,优先 story/ui-editor 高频区）。
6. 数字输入三件套（DeferredNumberInput/EnhancedInput/NumericDraftEnhancedInput）整合出一个 canonical `NumberInput` 入口（保留旧组件为薄包装,避免大改调用点）。

### Phase 3 — 机械迁移（codemod/批量替换,按风险分批）
按"同值替换零风险 → 近似值合并需过目"排序：
1. 零风险：`[#40a8c4]`→`primary`;`focus:ring-[#40a8c4]/30`→规范 focus;`text-[10px]/[11px]`→`text-3xs/2xs`。
2. 低风险：`slate-*`→对应 `fg-*`/gray（同明度映射表）;裸 `rounded`→`rounded-md`(控件)/`rounded-lg`(容器),按文件过目。
3. 需视觉确认：~60 种表面 hex 按映射表归并到 5 档 `surface-*`;边框/hover 长尾 alpha 归并;逐模块提交,每模块跑一遍界面对照。

### Phase 4 — 逐模块组件化改造（长期,结合日常开发）
优先级按改动频率与债务密度：story/scene-editor → workspace 壳（EditorGroup/面板）→ properties + blueprint-lite → assets/characters → launcher/settings/project-wizard（wizard 的 `[#40a8c4]` 硬编码集中）→ ui-editor。
执行方式：每模块一个 PR,替换裸 `<button>`/手写 tab/badge/空状态为共享组件;新代码一律走组件（boy-scout 规则,靠 Phase 0 的 ratchet 兜底)。

### Phase 5 — 收口
1. ratchet 基线降到 0 后,把对应规则转为硬性 lint 错误（`no-restricted-syntax` 或 eslint-plugin-tailwindcss 的 `no-arbitrary-value` 定向开启）。
2. 删除 styles.css 中的兼容样式与死变量;`docs/design-system.md` 标记为稳定。

## 已定决策（2026-07-08 拍板）
1. **binding 色** → 采用独立 `binding` token = `#7e70c2`（低饱和藕荷色）。不并入 primary（绑定态需与选中态区分）,也不用鲜艳的 violet/amber——遵循"低饱和 + 仅旋转色相"原则,冷色相与 primary 区隔且不撞 warning。品牌主色 `#40a8c4` 固定不动。
2. **10px/11px** → **合并为单档** `2xs: 11px`,`text-[9px]` 一并并入。后续如需微调易改。
3. **`surface-raised` 的归一值** → 取现最高频的 `#1e1f22`。

## Key Files
- token/配置：`tailwind.config.js`、`src/renderer/styles/styles.css`
- 工具：`src/renderer/lib/utils/cn.ts`（新）、`scripts/style-ratchet.*`（新）
- 组件库：`src/renderer/lib/components/**`
- 升格来源：`lib/ui-editor/widget-modules/shared/chrome/constants.tsx`（controlButtonClass）、`apps/workspace/modules/assets/components/SearchBox.tsx`
- 复制粘贴热点（Phase 2 吸收对象）：`StoryLayerField.tsx`/`StorySceneActionInspector.tsx`/`DisplayableTargetField.tsx` 的 `FIELD_LABEL_CLASS`;`StoryMotionPicker.tsx`/`MotionSelector.tsx` 的 `TOOL_BUTTON_CLASS`;`ThumbnailField.tsx`/`CharacterPropertiesEditor.tsx` 的 `secondaryGhostButtonClass`
