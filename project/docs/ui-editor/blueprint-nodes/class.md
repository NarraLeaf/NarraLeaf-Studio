# 节点分类

节点分类是节点在图形界面中显示的操作分类，并能够在创建浮窗中导航。

Self 节点和 Element 节点使用不同分类：
- Self 节点操作当前私有蓝图所属控件，不带 Element/ref 输入，显示在对应控件分类中，例如 `Button`、`Slider`、`List`。
- Element 节点操作显式传入的 Element 引用，带 typed Element 输入，统一显示在 `Element` 分类中。
- Element 节点只有在当前图里已有兼容的 `Element` 或 `Element Flush` 绑定节点时才会出现在创建浮窗中；创建后不会自动连线。

## Events

Events分类具有：
- Events节点，包括生命周期、元素交互、列表/滑块事件、Page Event，以及 Global / Surface / 控件的 On Key / Any Key 键盘事件
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
- 当前控件自己的 Displayable 读取节点

## Page

Page分类具有：
- Page节点

## Data

Data 分类同时包含 Collection 节点；Array / JSON / Object 处理都保留在 Data 分类下。

Data分类具有：
- Data节点
- JSON节点
- String节点

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
- Element Flush 事件节点
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
- 由 `nl.image` Element Literal / Element Flush 派生的 Image 节点

## Button / Container / Frame

这些控件私有分类具有对应控件自己的属性方法节点，例如 `Set Enabled`、`Set Label`、`Set Target Page`。同类型派生节点不放入这些分类，而是放入 `Element` 分类。
