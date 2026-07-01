# 节点分类

节点分类是节点在图形界面中显示的操作分类，并能够在创建浮窗中导航。

Self 节点和 Element 节点通常使用不同分类：
- Self 节点操作当前私有蓝图所属控件，不带 Element/ref 输入，显示在对应控件分类中，例如 `Button`、`Slider`、`List`。
- Element 节点操作显式传入的 Element 引用，带 typed Element 输入，统一显示在 `Element` 分类中。
- Element 节点只有在当前图里已有兼容的 `Element`、`Element Flush` 或 `Element Click` 绑定节点时才会出现在创建浮窗中。同一节点类型在创建浮窗中只显示一项；若兼容来源唯一，创建时会自动连到该来源，若有多个兼容来源则保留目标输入由作者选择。

## Events

Events分类具有：
- Events节点，包括生命周期、元素交互、Surface 点击、列表/滑块事件、Page Event，以及 Global / Surface / 控件的 On Key / Any Key 键盘事件
- Broadcast节点

## Flow

Flow分类具有：
- Flow节点

## Debug

Debug分类具有：
- Debug节点
- 图内注释节点

## Network

Network分类具有：
- Network节点

## Displayable

Displayable分类具有：
- 当前控件自己的 Displayable `Get Property` / `Set Property`
- Appearance Variant 节点：Self `Set Variant` 默认绑定当前控件；派生 `Set Element Variant` 才通过 Element 引用目标控件
- 属性动画节点：`Animate Property` / `Stop Animation`

带 Element 输入的 Displayable 派生节点属于 `Element` 分类；`Displayable` 分类只放当前控件自己的 Self 节点。

Displayable 透明度只有一套有效 `opacity`。Appearance Variant 的 `transformOpacity` 会投影到这套值；`nl.image` Variant 中相对 Default 实际改动过的 `fillOpacity` 也会投影到这套值，并且不会再写到内部 `<img>` 的 opacity。`nl.image` 的非 Default Variant 不覆盖 Default 的 `imageFill` / crop / contain 模式。`Set Property` / `Animate Property` 的 opacity 也操作同一份透明度。

## Page

Page分类具有：
- Page节点
- `Go Page` 页面导航尾节点

## Game

Game 分类具有：
- `Start Game` 游戏启动尾节点
- Dialog 节点：`Get Nametag`、`Next`、`Skip`、`Set Sentence Speed`
- 本地存档节点：`Write Save`、`Load Save`、`List Saves`、`Get Save Preview`

## Data

Data 分类同时包含 Collection 节点；Array / JSON / Object 处理都保留在 Data 分类下。

Data分类具有：
- Data节点
- JSON节点
- String节点

## Variables

Variables 分类具有：
- `Var` 图内变量声明节点
- `Get Var` / `Set Var` 本地变量读写节点
- `Get Persistent` / `Set Persistent` 项目级持久变量读写节点

## Math

Math分类具有：
- Math节点
- Boolean节点
- Compare节点

## Text

Text分类具有：
- 当前 `nl.text` 自己的 Text 节点

## Element

Element 分类具有：
- Element Literal 节点
- Element Flush / Element Click 事件节点
- 所有带 Element/ref 输入的派生控件方法节点
- Element-targeted Text、Displayable、List、Slider 和通用 Widget Property 节点

## List

List 分类具有：
- 当前 `nl.list` 自己的 List 节点
- List item context 节点

## Slider

Slider分类具有：
- 当前 `nl.slider` 自己的 Slider 节点

## Image

Image分类具有：
- ImageAsset 字面量卡片
- 当前 `nl.image` 自己的 Image 节点
- 由 `nl.image` Element Literal / Element Flush / Element Click 派生的 Image 节点

## Button / Container / Frame

这些控件私有分类具有对应控件自己的属性方法节点，例如 `Set Enabled`、`Set Label`。`nl.frame` Self 形态的 `Set Frame Page` 属于 `Frame` 分类；派生 Element 形态和其他派生节点一样属于 `Element` 分类。
