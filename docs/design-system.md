# NarraLeaf Studio 设计规范

Studio 是纯深色应用。本文件是 UI 的**唯一样式事实来源**——写任何组件前先看这里,不要就地发明颜色、圆角或字号。

配套：分阶段收敛计划见 [plans/2026-07-08-001-refactor-design-system-consolidation.md](plans/2026-07-08-001-refactor-design-system-consolidation.md)。

## 1. 颜色 token

**只用语义 token,禁止任意 hex(`bg-[#…]`)、裸调色板(`text-gray-400`)、裸 white/black alpha(`bg-white/10`)。**

token 定义在 [tailwind.config.js](../tailwind.config.js),通道值(RGB)在 [src/renderer/styles/styles.css](../src/renderer/styles/styles.css) 的 `:root`。因此三处都能用同一来源：Tailwind 工具类 (`bg-surface`)、原生 CSS/内联 (`rgb(var(--nl-surface))`)、带透明度 (`bg-primary/20`)。

### 品牌 / 强调色

`#40a8c4` 是**固定锚点,永不更改**。其余强调色一律"低饱和 + 中亮度 + 仅旋转色相"派生,**禁止鲜艳(高饱和)色**。

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

| Token | 值 | 用途 |
|---|---|---|
| `fg` | `#eef1f5` | 主文字 |
| `fg-muted` | `#9aa3ae` | 次要文字 |
| `fg-subtle` | `#6b7480` | 辅助 / 占位符 |
| `edge` | `white/10` | 默认边框 |
| `edge-subtle` | `white/5` | 弱分隔线 |
| `edge-strong` | `white/20` | 强调 / hover 边框 |

用法：`text-fg-muted`、`border-edge`、`divide-edge`。

## 2. 圆角

| 场景 | 类 |
|---|---|
| 控件（按钮 / 输入 / 菜单项 / badge） | `rounded-md` |
| 容器（卡片 / 面板 / 弹层） | `rounded-lg` |
| pill / 开关 / 头像 | `rounded-full` |

**禁用裸 `rounded`（不带尺寸）与任意值 `rounded-[Npx]`。**

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
- 优先复用 `src/renderer/lib/components` 下的共享组件,不要重新手写 `<button>` / tab / badge / 空状态。缺什么组件按收敛计划的 Phase 2 补齐后再用。

## 7. 防回归

[scripts/style-ratchet.mjs](../scripts/style-ratchet.mjs) 统计任意 hex、裸调色板、任意 px 字号、裸圆角等"债务"计数,基线存在 `scripts/style-ratchet.baseline.json`。CI / 本地跑 `yarn style:ratchet`——计数只准降不准升。修完一批后跑 `yarn style:ratchet --save` 收紧基线。
