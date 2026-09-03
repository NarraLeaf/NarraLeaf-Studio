# NarraLeaf Studio 设计规范

Studio 是**双主题**应用（暗色 / 亮色,由 `ui.themeMode` 设置驱动,默认跟随系统）。本文件是 UI 的**唯一样式事实来源**——写任何组件前先看这里,不要就地发明颜色、圆角或字号。

## 0. 主题机制

**整条链路是纯 CSS,没有一行 JS。**

- 主进程把 `ui.themeMode`（`auto`/`light`/`dark`）映射到 `nativeTheme.themeSource`（[src/main/app/application/theme.ts](../src/main/app/application/theme.ts)）。这是**唯一开关**。
- Electron 据此翻转每个渲染窗口的 `prefers-color-scheme`;`styles.css` 的 `@media (prefers-color-scheme: light)` 块整组覆盖 token。浏览器自己重算,所以**切换实时生效、首帧不闪、跨窗口同步,无需 IPC 广播**（与 `app.language` 的广播机制不同）。
- 窗口背景色（首帧前的 paint-behind）由 `getWindowBackgroundColor()` 在 AppWindow 构造时解析,已开窗口靠 baseApp 里的 `nativeTheme.on("updated")` 跟进。
- **亮色覆盖只作用于带 `.nl-studio` 的文档**,该 class 由 `renderHtml`（[project/build/utils.js](../project/build/utils.js)）按 app 决定。这条 scope 是**游戏 / Studio 隔离的承重墙**：同一份 styles.css 也打进游戏运行时(共用 widget 渲染代码),而**已发布的游戏必须在每台机器上长得一样,不能跟随玩家的 OS 主题**。因此游戏 shell 与 **Dev Mode 窗口**都不带这个 class——Dev Mode 是就地渲染 `GameApp`(不是 webview),带上就会让预览显示出永远不会发布的样子。代价是它自己的调试 chrome 恒为暗色,与其承载的游戏一致;其窗口背景走 `getGameHostWindowBackgroundColor()`(固定暗色)。
- **组件永远写语义 token,不感知主题**。

> ⚠️ **不要用 JS 镜像主题。** Electron 在 `themeSource` 变化时会更新 `matchMedia("(prefers-color-scheme: …)")` 的 **值**,但**不派发 `change` 事件**（已 CDP 实测）。任何基于 matchMedia 监听的 JS 镜像层都会在首次加载后静默失效。CSS 媒体查询不受此影响,是唯一可靠的路径。

少数元素**有意主题不变**(保持深色):媒体缩略图上的遮罩/渐变、模态背板 `bg-black/50`、色板/用户颜色数据、阴影、游戏舞台周围的留黑与游戏预览。这些**保留硬编码是正确的**,不要"顺手"token 化。

## 1. 颜色 token

**只用语义 token,禁止任意 hex(`bg-[#…]`)、裸调色板(`text-gray-400`)、裸 white/black alpha(`bg-white/10`)。**

token 定义在 [tailwind.config.js](../tailwind.config.js),值在 [src/renderer/styles/styles.css](../src/renderer/styles/styles.css)：`:root` 是暗色（默认）,`@media (prefers-color-scheme: light)` 下的 `:root.nl-studio` 整组覆盖(见 §0——**没有 `data-theme` 属性,写它不会有任何效果**)。因此三处都能用同一来源：Tailwind 工具类 (`bg-surface`)、原生 CSS/内联 (`rgb(var(--nl-surface))`)、带透明度 (`bg-primary/20`)。下文表格中的具体色值均指**暗色主题**;亮色值见 styles.css。

### 品牌 / 强调色

`#40a8c4` 是**固定锚点,永不更改,且两个主题下同值**。其余强调色一律"低饱和 + 中亮度 + 仅旋转色相"派生,**禁止鲜艳(高饱和)色**;亮色主题保持同色相同饱和,仅压低亮度,直到作为文字压在自身 `/10` 染色底上时 ≥4.5:1(AA)。

### 强调色的两支墨色

强调色是**用户可改的**（设置 ▸ 外观 ▸ 强调色；五个预设之外还能取任意 hex），所以「拿它画什么」分两种，各有一支派生墨色。两支都由 [`@shared/constants/accent`](../src/shared/constants/accent.ts) 算出、由 `lib/appearance` 写在根元素上。

| Token | Tailwind | 什么时候是它 |
|---|---|---|
| `--nl-on-primary` | `text-on-primary` | 压在**实心强调色上**的字（主按钮、badge）。`accentForeground`：强调色亮过 0.5 就翻成深色墨。实心 `bg-primary` 上不要写 `text-white`。 |
| `--nl-primary-ink` | `text-primary` / `border-primary` / `divide-primary` / `decoration-primary` | 强调色**画在普通表面上**的字与发丝线。`accentInk`：按当前主题把亮度夹到对 `--nl-surface` 至少 AA 4.5:1，**任何强调色、两个主题都不例外**。 |

其余的 `*-primary` 都还是 `--nl-primary` 本身：填充面（`bg-primary`）、焦点圈（`ring-primary` / `outline-primary`）、SVG 的 `fill-` / `stroke-primary`。分界是这一色在干什么——**一块被填满的形状是被看见的，一个字形是要被读的**，只有后者必须保对比度。切换只需改 tailwind.config.js 里 `textColor` / `borderColor` 那两条，不用动调用方。

两个主题的墨色不同，而主题是纯 CSS（§0）、JS 问不到当前是哪一档，所以 `lib/appearance` 把两支都发出来（`--nl-primary-ink-on-dark` / `--nl-primary-ink-on-light`），由 styles.css 的亮色块挑。换主题不需要任何 JS 参与。

> ⚠️ **已知取舍**：夹取的两个边界都是 AA 4.5:1，**没有为预设开的口子**。暗色主题下五个预设本来就在区间内（最暗的 Slate 是 4.97:1），算出来仍是它自己、一像素不动；亮色主题下五个**全部被压暗**——包括品牌锚点。于是在亮色主题里，**色板上的那一格与同一处的文字颜色不是同一个值**。这是有意的：一块被填满的形状是被看见的，一个字形是要被读的，只有后者必须保对比度。锚点在"被看"的地方（`bg-primary`、焦点圈、SVG `fill-`/`stroke-primary`）仍然是 `#40a8c4` 原色。

亮色主题下五个预设的墨色（由 `accentInk` 算出，下表只是给人看；锚点那一行由 `accent.test.ts` 钉住）：

| 预设 | 强调色 | 亮色主题墨色 | 对 `--nl-surface` |
|---|---|---|---|
| Leaf teal | `#40a8c4` | `#2d768a` | 2.42:1 → 4.52:1 |
| Sky | `#5394c6` | `#407299` | 2.87:1 → 4.51:1 |
| Indigo | `#7384ca` | `#5d6aa3` | 3.13:1 → 4.54:1 |
| Rose | `#c46e9c` | `#9c577c` | 3.04:1 → 4.52:1 |
| Slate | `#738596` | `#606f7e` | 3.33:1 → 4.52:1 |

压暗走的是"整体乘一个系数往黑色混"，三个通道同比缩放，所以**色相原样保留**——还是同一个颜色，只是能读了。自定义 hex 走同一条路：一个淡黄从 1.0:1 抬到 4.5:1，一个近黑色在暗色主题下被提亮到 4.5:1。

| Token | 值 | HSL | 用途 |
|---|---|---|---|
| `primary` | `#40a8c4` | H193 S53 L51 | 品牌主色、选中态、焦点、链接 |
| `binding` | `#7e70c2` | H250 S40 L60 | blueprint 绑定态语义色(与选中态区分) |
| `danger` | `#da6958` | H8 S64 L60 | 错误 / 删除 / 破坏性操作 |
| `success` | `#6db094` | H155 S30 L56 | 成功 / 有效状态 |
| `warning` | `#ccaa5c` | H42 S52 L58 | 警告 / 需注意 |

信息态(info)复用 `primary`,不单列。带透明度用斜杠语法：`bg-primary/20`、`border-danger/40`、`text-success`。

### 表面色（5 级层深）

从深到浅,越"浮起"的层越亮：

| Token | 值 | 用途 |
|---|---|---|
| `surface-canvas` | `#05060a` | 最深底(ui-editor 画布等) |
| `surface-sunken` | `#0b0d12` | 下沉区、标题栏、未激活 tab |
| `surface` | `#0f1115` | app / 面板默认背景 |
| `surface-raised` | `#1e1f22` | 卡片、输入框、菜单 |
| `surface-overlay` | `#22242a` | 弹出层、dropdown、popover |

用法：`bg-surface`、`bg-surface-raised`。

### 文字与边框

| Token | 值(暗色) | 用途 |
|---|---|---|
| `fg` | `#eef1f5` | 主文字 |
| `fg-muted` | `#9aa3ae` | 次要文字 |
| `fg-subtle` | `#6b7480` | 辅助 / 占位符 |
| `edge` | `white/10` | 默认边框 |
| `edge-subtle` | `white/5` | 弱分隔线 |
| `edge-strong` | `white/20` | 强调 / hover 边框 |
| `fill` | `white/10` | 半透明**填充**(按钮次要态、hover 底) |
| `fill-strong` | `white/20` | 强填充 |
| `fill-subtle` | `white/5` | 弱填充(输入框底、卡片底) |

用法：`text-fg-muted`、`border-edge`、`divide-edge`、`bg-fill`、`hover:bg-fill`。

**`edge` vs `fill` 的区别**：暗色下值相同(白色叠加),但角色不同——`edge` 只用于 `border-`/`divide-`,`fill` 只用于 `bg-`。不要拿边框 token 当背景色。亮色主题下两组都翻转为墨色叠加(`--nl-edge*`/`--nl-fill*` 完整颜色变量,alpha 内嵌,**不支持 `/alpha` 修饰符**)。

原生控件细节(滚动条、checkbox/radio)另有 `--nl-scrollbar-*`、`--nl-control-*` 变量,只在 styles.css 内部使用。

**滚动条默认不画滑块**,只在滚动时出现,停下约 0.8 秒后消失(规则在 styles.css,"正在滚动"这个状态由
`styles/scrollbarAutoHide.ts` 打在滚动容器上的 `data-nl-scrollbar` 提供)。8px 槽位**始终占位**,
所以滑块显示与否不改变布局。浮层里的选择列表(节点选择框、命令候选菜单这类)连槽位都不要,加 `.nl-no-scrollbar`。
**横向的窄条外壳**(编辑器标签栏这类,整条只有一行高)也加:8px 槽位在这种高度上是明显的一条,而横滑块几乎
和条一样宽,说不出什么。这类条子改用「被裁掉的那一侧画一段 24px 渐隐」提示还有内容——渐隐要画在滚动容器
**外面**的定位父级上,画在里面会跟着内容一起滑走。

## 2. 圆角

| 场景 | 类 |
|---|---|
| 控件（按钮 / 输入 / 菜单项 / badge） | `rounded-md` |
| 容器（卡片 / 面板 / 弹层） | `rounded-lg` |
| pill / 开关 / 头像 | `rounded-full` |

**禁用裸 `rounded`（不带尺寸）与任意值 `rounded-[Npx]`。**

`rounded-lg` 只给**浮起的覆盖层**（模态、dropdown / popover——即 `bg-surface-overlay` 那一层）。带边框的卡片 / 区块面板走 `rounded-md`，与共享组件 `Card` / `SectionCard` 一致；**嵌套盒子的圆角不得大于父容器**（属性编辑器里 `bg-surface` 预览框套在 `rounded-md` 面板内，就只能是 `md`）。

`rounded-sm`（2px）不在上表里，但**允许**用于尺寸小到 `rounded-md` 会失真的地方：**checkbox 一律 `rounded-sm`**（12–16px 的方框配 6px 圆角就变成圆点，读起来像 radio），缩略图内框、8px 的 resize 角标同理。

## 3. 控件尺寸

**同一 `size` 的按钮、输入框、下拉框,高度必须相同。** 刻度只有一处来源——[`lib/components/elements/controlSize.ts`](../src/renderer/lib/components/elements/controlSize.ts),组件不再各自从 padding 里推。

| size | 高度 | 用在哪 |
|---|---|---|
| `sm` | 28px（`min-h-7`） | 面板、工具条、检查器行——Studio 的常用档 |
| `md` | 36px（`min-h-9`） | 对话框与表单（也是组件默认值） |
| `lg` | 40px（`min-h-10`） | 少数占满一行的主操作 |

`ToolbarButton` / `IconButton` 的 `sm`/`md`/`lg` 是同一刻度的**正方形**;`ToolbarButton` 另有一个更密的 `xs`（24px），是刻度之外的一档。

**为什么是 `min-h-*` 而不是 `h-*`**：单行控件的内容永远矮于这条地板,于是地板就是高度——带边框的输入框和不带边框的按钮因此像素级相等,不会再出现"同 `size` 差 2px"。文案换行时（窄的整行按钮遇上长译文）控件会长高,而不是把字挤出去。

一排控件传同一个 `size` 就够了,**不要再自己钉 `h-9` / `min-h-[34px]`**——那些数字散在各处正是高度长歪的原因。确实要偏离刻度的地方（蓝图节点里被缩放的密集输入）显式写 `min-h-0` 再给自己的高度,让偏离是看得见的。

手写控件（不走共享组件）从 barrel 取 `CONTROL_SIZE_CLASS` / `CONTROL_SQUARE_CLASS` / `CONTROL_HEIGHT_CLASS`,不要重抄数字;属性面板的字段另有 `modules/properties/fieldControlClass.ts`,图标按钮另有 `controlButtonClass()`。

## 4. 字号

小字**只用单档** `text-2xs`（11px）——收敛原先的 `text-[9px]/[10px]/[11px]`。常规层级用 `text-xs`(12px)、`text-sm`(14px)、`text-base`(16px)。**禁用 `text-[Npx]` 任意值。**

## 5. 交互态（统一写法）

- **hover**：行 / 图标按钮一律 `hover:bg-fill`——共享 `Button` 的 ghost 变体内部就是它,手写行照抄这一档才与组件对齐;要更轻一档(密集列表、已有底色上再叠一层)用 `hover:bg-fill-subtle`。**hover 底不写 `edge` 系**:`edge` 只给 `border-`/`divide-`(见 §1),本条早先误写成 `hover:bg-edge-subtle` / `hover:bg-edge`,全仓没有一处是照它写的。
- **focus**：统一 `focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-primary/50`;容器型输入用 `focus-within:` 变体。禁止 `focus:border-*` 与裸 hex ring。
- **selected / active**：填充式 `bg-primary/15 text-fg`;导航类列表可加左竖条 `border-l-2 border-primary`;tab 用底部下划线 `bg-primary`。
- **disabled**：统一 `disabled:opacity-50 disabled:cursor-not-allowed`。

> ⚠️ **focus 那条在原生控件上是够不着的。** `styles.css` 里 `input:focus, textarea:focus, button:focus, select:focus { outline: none !important; box-shadow: none !important }` 会把 Tailwind 的 `focus:ring-*` / `focus-visible:ring-*` 整个吃掉（ring 就是 box-shadow）。所以 `<button>` / `<input>` / `<select>` 上写 ring 是**静默无效**的死代码,共享组件里改用 `focus:border-primary`（border-color 不受那条规则管）。真要给某个控件一个可见焦点圈,用 `.nl-focus-ring`（同样 `!important` 的 outline）。非原生控件（`<div>` / `<span role="button">`）不受影响,ring 照常生效。

## 6. 间距与动效

间距沿用 Tailwind 标准刻度(`gap-1/2/3`、`p-2/3/4`),已较收敛,无需自定义。动效时长统一 `duration-150`(小交互)/ `duration-200`(浮层)。

## 7. 组件与 `cn()`

- 合并 className **一律用** [`cn()`](../src/renderer/lib/utils/cn.ts)(`clsx` + `tailwind-merge`),不要字符串拼接——这样调用方传入的 `className` 才能可靠覆盖组件基础样式。
- 优先复用 `src/renderer/lib/components/elements` 下的共享组件,不要重新手写 `<button>` / tab / badge / 空状态。

### 布尔值：开关还是勾选框

**设置和属性一律 `Switch`**（设置页、部件检视器、故事动作检视器都是它）；
**`Checkbox` 只用于「这一项在不在集合里」和「同意」**——选哪些日志级别、导入哪些模型、
某个变体声明哪些场景、勾一条许可协议。一个是你打开之后就不管的东西，一个是你逐项去勾的东西。

**不要再手写 `<input type="checkbox">`**：外观全部由 `styles.css` 的全局
`input[type="checkbox"]` 规则给（16px、`--nl-control-*` 边框、选中的主色与勾、禁用变淡），
`Checkbox` 只负责配对与那只**箭头光标**（`cursor-default`；被它取代的十二处里有五处写着
`cursor-pointer`）。`Checkbox.test.tsx` 会扫 `src/renderer`，**全仓只准存在一处
`type="checkbox"`**，就是这个组件自己。

### 组件清单（`lib/components/elements`）

已有:`Button` / `IconButton`、`Input` / `TextArea` / `SearchInput` / `InputGroup`、`Select` / `Combobox`、`Modal`(+ `ConfirmModal` / `AlertModal`)、`Card`、`Switch` / `Checkbox`、`Progress`、`Accordion`、`ContextMenu`。

Phase 2 新增(用来替换各处手写模式):

| 组件 | 替换的手写模式 |
|---|---|
| `ToolbarButton` | 工具栏方形图标按钮(`grid place-items-center …`,原 20+ 处;size xs/sm/md/lg + `active`/`bordered`) |
| `TabStrip` | tab 条 + 下划线(原 4 套实现) |
| `Badge` | 状态 pill(tone: neutral/primary/binding/danger/success/warning) |
| `EmptyState` | 居中空状态占位 |
| `FieldLabel` | eyebrow 小标签(原 `FIELD_LABEL_CLASS` 复制) |
| `SectionCard` | 带边框的区块卡片 |
| `PanelHeader` | 面板 / 编辑器头部行(size sm/md/lg) |
| `Tooltip` | 给取不到属性的目标用的包裹式提示（首选属性写法,见 §7.1） |
| `AnchoredPanel` | 手写的「portal 到 body + fixed 定位 + 躲开视口边缘」浮层（`HintPopover` 与拼写建议面板共用它;对话框仍走 `Modal` / overlay host） |

## 7.1 提示（tooltip）

**原生 `title=` 已经全仓下线,新写的一律用 `data-tip`。** Chromium 画的那个气泡不跟主题、要等约一秒、还盖住正在瞄准的像素；
`noNativeTooltips.test.ts` 会拦下任何写回 DOM 元素上的 `title`。

- **一个控件**：`data-tip="重新加载"`。共享组件（`Button` / `ToolbarButton` / `Input` …）把 rest props 铺到 DOM,所以属性直接穿过去,不用改组件签名。
- **一排控件**：把这排原有的 wrapper 换成 `<TooltipGroup className="…">`（[lib/tooltip](../src/renderer/lib/tooltip)）。组内**延迟只付一次**——第一条等满延迟,之后指针移到组内任何一个都立即出,离开这排就冷却。**不要在既有 wrapper 外面再套一层**,那正是属性写法要避免的多余盒子。
- **纯图标控件**：`data-tip` 不再是可访问名的兜底,自己写 `aria-label`。已有可见文字的控件**不要**再补 `aria-label`（会盖掉可见名）。
- **禁用控件**：照写 `data-tip`。指针事件根本到不了禁用控件,提示是靠命中测试解析出来的。
- 延迟是**一个全局值**（设置 → 外观 → 提示延迟,默认 500ms）。「立即」只由 `TooltipGroup` 的热链给出,没有逐处的 instant 开关。
- **方向**：默认向上、没地方就翻下面。贴边的一条轨（侧栏图标列）要**朝里开**——左轨 `side="right"`、右轨 `side="left"`、底轨 `side="top"`,在 `TooltipGroup` 上写一次,组内所有控件继承；单个控件可写 `data-tip-side`。方向是意向不是保证,那一侧放不下就翻到对面。

浮层样式：`bg-surface-overlay` + `border-edge` + `rounded-md` + `text-2xs`,`max-w-[240px]` 折行,提示文本里的换行符照排,不吃指针事件。

## 8. 防回归

[scripts/style-ratchet.mjs](../scripts/style-ratchet.mjs) 统计任意 hex、裸调色板、任意 px 字号、裸圆角等"债务"计数,基线存在 `scripts/style-ratchet.baseline.json`。**CI 的 `verify` job 会跑 `yarn style:ratchet`**（[.github/workflows/ci.yml](../.github/workflows/ci.yml)),本地同样命令——计数只准降不准升。修完一批后跑 `yarn style:ratchet --save` 收紧基线。

扫描范围见 [scripts/style-scan.mjs](../scripts/style-scan.mjs)：**只数字符串字面量,跳过测试文件、注释内容与标识符**。这不是图省事——组件库的 JSDoc 里写着它取代的手写模式（`Badge` 的注释就含 `rounded px-1.5 …`）,把注释算进债务等于让组件库为它消灭的债务背锅,唯一"修法"是删文档。标识符同理：类名只有进了字符串才到得了 DOM,所以一个**以类名命名的声明**不输出任何 CSS。`PluginInstallPermissions` 有个开关 `rounded-md` 的 `rounded?: boolean` prop,把它的每次出现都算成裸圆角债务,等于让门禁要求为迁就正则而改 prop 名。

**三个指标有"合法地板",不可能降到 0**,升了要按 §0 逐条核对是不是真的属于这些豁免：

| 指标 | 地板来自 |
|---|---|
| `raw-white-black-alpha` | 模态 / 浮层背板、媒体缩略图遮罩、阴影、游戏舞台留黑与预览 |
| `raw-accent` | `var(--narraleaf-accent, #40a8c4)` 这类 CSS 变量兜底、canvas 读色兜底、调色板与角色颜色等用户数据 |
| `arbitrary-hex` | 长尾近黑舞台色（判断密集,[scripts/style-codemod.mjs](../scripts/style-codemod.mjs) 有意不自动化） |

⚠️ 每加一个模态背板,`raw-white-black-alpha` 就会 +1 并让 ratchet 变红。这是**设计如此**：它逼你确认这一笔真的属于 §0 豁免,而不是顺手写的裸 `bg-black/40`。确认了就带理由 `--save`。

## 9. 文案

**像素看这份文件,字看 [help-system.md](help-system.md)。** 那份是界面文案的**唯一事实来源**,地位与本文件对等;
写任何标签、提示、确认或帮助条目前先读它。尤其是 §3(什么话一律不得出现)、§3a(语域)、§3b(形状)、
§3c(三种语言)。

一句话的规矩：**界面只说当前状态、作者该做什么、做完会得到什么。不说机制,不说路线图,不跟人聊天。**

两条可以直接跑的检查,与 §8 的门禁一样是机械的：

```sh
grep -nE '"[^"]*(—|——)[^"]*"' src/shared/i18n/catalog/*/*.ts
grep -nE '"[^"]*(the engine|internally|because |which means)' src/shared/i18n/catalog/*/*.ts
```

第一条命中的破折号**只在格式示例里合法**,别处一律拆成两句;第二条命中即是这条字符串在描述自己的
实现,删掉那半句,不要改写。
