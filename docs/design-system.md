# NarraLeaf Studio 设计规范

Studio 是**双主题**应用（暗色 / 亮色,由 `ui.themeMode` 设置驱动,默认跟随系统）。本文件是 UI 的**唯一样式事实来源**——写任何组件前先看这里,不要就地发明颜色、圆角或字号。

配套：分阶段收敛计划见 [plans/2026-07-08-001-refactor-design-system-consolidation.md](plans/2026-07-08-001-refactor-design-system-consolidation.md)。

## 0. 主题机制

**整条链路是纯 CSS,没有一行 JS。**

- 主进程把 `ui.themeMode`（`auto`/`light`/`dark`）映射到 `nativeTheme.themeSource`（[src/main/app/application/theme.ts](../src/main/app/application/theme.ts)）。这是**唯一开关**。
- Electron 据此翻转每个渲染窗口的 `prefers-color-scheme`;`styles.css` 的 `@media (prefers-color-scheme: light)` 块整组覆盖 token。浏览器自己重算,所以**切换实时生效、首帧不闪、跨窗口同步,无需 IPC 广播**（与 `app.language` 的广播机制不同）。
- 窗口背景色（首帧前的 paint-behind）由 `getWindowBackgroundColor()` 在 AppWindow 构造时解析,已开窗口靠 baseApp 里的 `nativeTheme.on("updated")` 跟进。
- **亮色覆盖只作用于带 `.nl-studio` 的文档**,该 class 由 `renderHtml`（[project/build/utils.js](../project/build/utils.js)）按 app 决定。这条 scope 是**游戏 / Studio 隔离的承重墙**：同一份 styles.css 也打进游戏运行时(共用 widget 渲染代码),而**已发布的游戏必须在每台机器上长得一样,不能跟随玩家的 OS 主题**。因此游戏 shell 与 **Dev Mode 窗口**都不带这个 class——Dev Mode 是就地渲染 `GameApp`(不是 webview),带上就会让预览显示出永远不会发布的样子。代价是它自己的调试 chrome 恒为暗色,与其承载的游戏一致;其窗口背景走 `getGameHostWindowBackgroundColor()`(固定暗色)。
- **组件永远写语义 token,不感知主题**。

> ⚠️ **不要用 JS 镜像主题。** Electron 在 `themeSource` 变化时会更新 `matchMedia("(prefers-color-scheme: …)")` 的 **值**,但**不派发 `change` 事件**（已 CDP 实测）。任何基于 matchMedia 监听的 JS 镜像层都会在首次加载后静默失效。CSS 媒体查询不受此影响,是唯一可靠的路径。

少数元素**有意主题不变**(保持深色):媒体缩略图上的遮罩/渐变、模态背板 `bg-black/50`、accent 底上的 `text-white`、色板/用户颜色数据、阴影、游戏舞台周围的留黑与游戏预览。这些**保留硬编码是正确的**,不要"顺手"token 化。

## 1. 颜色 token

**只用语义 token,禁止任意 hex(`bg-[#…]`)、裸调色板(`text-gray-400`)、裸 white/black alpha(`bg-white/10`)。**

token 定义在 [tailwind.config.js](../tailwind.config.js),值在 [src/renderer/styles/styles.css](../src/renderer/styles/styles.css)：`:root` 是暗色（默认）,`@media (prefers-color-scheme: light)` 下的 `:root.nl-studio` 整组覆盖(见 §0——**没有 `data-theme` 属性,写它不会有任何效果**)。因此三处都能用同一来源：Tailwind 工具类 (`bg-surface`)、原生 CSS/内联 (`rgb(var(--nl-surface))`)、带透明度 (`bg-primary/20`)。下文表格中的具体色值均指**暗色主题**;亮色值见 styles.css。

### 品牌 / 强调色

`#40a8c4` 是**固定锚点,永不更改,且两个主题下同值**。其余强调色一律"低饱和 + 中亮度 + 仅旋转色相"派生,**禁止鲜艳(高饱和)色**;亮色主题保持同色相同饱和,仅压低亮度,直到作为文字压在自身 `/10` 染色底上时 ≥4.5:1(AA)。

> ⚠️ **已知取舍**:`text-primary` 在亮色主题下对比度约 **2.4:1**(品牌青压在浅底上),低于 AA。因为品牌锚点不可更改、且 `primary` 在 tailwind config 里是字面 hex(不是通道变量,见 Phase 0 决策),此处未动。如需修正,要么给亮色主题单独派生一个更深的 `primary`(需把它改成通道变量并处理 `--narraleaf-accent` 的 `theme()` 依赖),要么新增一个 `primary-text` token。`bg-primary` + `text-white`(2.76:1)是两个主题共有的既有状况,与本次改动无关。

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

## 2. 圆角

| 场景 | 类 |
|---|---|
| 控件（按钮 / 输入 / 菜单项 / badge） | `rounded-md` |
| 容器（卡片 / 面板 / 弹层） | `rounded-lg` |
| pill / 开关 / 头像 | `rounded-full` |

**禁用裸 `rounded`（不带尺寸）与任意值 `rounded-[Npx]`。**

`rounded-lg` 只给**浮起的覆盖层**（模态、dropdown / popover——即 `bg-surface-overlay` 那一层）。带边框的卡片 / 区块面板走 `rounded-md`，与共享组件 `Card` / `SectionCard` 一致；**嵌套盒子的圆角不得大于父容器**（属性编辑器里 `bg-surface` 预览框套在 `rounded-md` 面板内，就只能是 `md`）。

`rounded-sm`（2px）不在上表里，但**允许**用于尺寸小到 `rounded-md` 会失真的地方：**checkbox 一律 `rounded-sm`**（12–16px 的方框配 6px 圆角就变成圆点，读起来像 radio），缩略图内框、8px 的 resize 角标同理。

## 3. 字号

小字**只用单档** `text-2xs`（11px）——收敛原先的 `text-[9px]/[10px]/[11px]`。常规层级用 `text-xs`(12px)、`text-sm`(14px)、`text-base`(16px)。**禁用 `text-[Npx]` 任意值。**

## 4. 交互态（统一写法）

- **hover**：行 / 图标按钮用两档——弱 `hover:bg-edge-subtle`、强 `hover:bg-edge`。
- **focus**：统一 `focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-primary/50`;容器型输入用 `focus-within:` 变体。禁止 `focus:border-*` 与裸 hex ring。
- **selected / active**：填充式 `bg-primary/15 text-fg`;导航类列表可加左竖条 `border-l-2 border-primary`;tab 用底部下划线 `bg-primary`。
- **disabled**：统一 `disabled:opacity-50 disabled:cursor-not-allowed`。

## 5. 间距与动效

间距沿用 Tailwind 标准刻度(`gap-1/2/3`、`p-2/3/4`),已较收敛,无需自定义。动效时长统一 `duration-150`(小交互)/ `duration-200`(浮层)。

## 6. 组件与 `cn()`

- 合并 className **一律用** [`cn()`](../src/renderer/lib/utils/cn.ts)(`clsx` + `tailwind-merge`),不要字符串拼接——这样调用方传入的 `className` 才能可靠覆盖组件基础样式。
- 优先复用 `src/renderer/lib/components/elements` 下的共享组件,不要重新手写 `<button>` / tab / badge / 空状态。

### 组件清单（`lib/components/elements`）

已有:`Button` / `IconButton`、`Input` / `TextArea` / `SearchInput` / `InputGroup`、`Select` / `Combobox`、`Modal`(+ `ConfirmModal` / `AlertModal`)、`Card`、`Switch`、`Progress`、`Accordion`、`ContextMenu`。

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
| `Tooltip` | 替换原生 `title=`(轻量 CSS 版,overflow-hidden 容器内慎用) |

## 7. 防回归

[scripts/style-ratchet.mjs](../scripts/style-ratchet.mjs) 统计任意 hex、裸调色板、任意 px 字号、裸圆角等"债务"计数,基线存在 `scripts/style-ratchet.baseline.json`。**CI 的 `verify` job 会跑 `yarn style:ratchet`**（[.github/workflows/ci.yml](../.github/workflows/ci.yml)),本地同样命令——计数只准降不准升。修完一批后跑 `yarn style:ratchet --save` 收紧基线。

扫描范围见 [scripts/style-scan.mjs](../scripts/style-scan.mjs)：**只数字符串字面量,跳过测试文件、注释内容与标识符**。这不是图省事——组件库的 JSDoc 里写着它取代的手写模式（`Badge` 的注释就含 `rounded px-1.5 …`）,把注释算进债务等于让组件库为它消灭的债务背锅,唯一"修法"是删文档。标识符同理：类名只有进了字符串才到得了 DOM,所以一个**以类名命名的声明**不输出任何 CSS。`PluginInstallPermissions` 有个开关 `rounded-md` 的 `rounded?: boolean` prop,把它的每次出现都算成裸圆角债务,等于让门禁要求为迁就正则而改 prop 名。

**三个指标有"合法地板",不可能降到 0**,升了要按 §0 逐条核对是不是真的属于这些豁免：

| 指标 | 地板来自 |
|---|---|
| `raw-white-black-alpha` | 模态 / 浮层背板、媒体缩略图遮罩、阴影、游戏舞台留黑与预览 |
| `raw-accent` | `var(--narraleaf-accent, #40a8c4)` 这类 CSS 变量兜底、canvas 读色兜底、调色板与角色颜色等用户数据 |
| `arbitrary-hex` | 长尾近黑舞台色（判断密集,[scripts/style-codemod.mjs](../scripts/style-codemod.mjs) 有意不自动化） |

⚠️ 每加一个模态背板,`raw-white-black-alpha` 就会 +1 并让 ratchet 变红。这是**设计如此**：它逼你确认这一笔真的属于 §0 豁免,而不是顺手写的裸 `bg-black/40`。确认了就带理由 `--save`。
