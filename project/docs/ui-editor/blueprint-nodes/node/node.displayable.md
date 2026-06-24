# Displayable 节点

除非额外声明，所有参数均为传出引脚值。

Displayable 节点默认读取当前元素。坐标和尺寸均使用当前 Surface 的设计坐标系。

Displayable Self 节点只在可显示控件自己的私有蓝图中出现，创建浮窗中归入 `Displayable` 分类，且没有 Element 输入。

Displayable Element 节点使用 `blueprint.element.displayable.*`，带顶部 generic `element` 输入，创建浮窗中归入 `Element` 分类。它们只有在当前图中已有任意 Same-Surface Element Literal 或 Element Flush 时才会显示；放置后不会自动连线，必须手动连接 `element` 输入。这些读取节点是 pure，可用于 Blueprint Value。

下文列出的 `blueprint.displayable.*` 均有对应 `blueprint.element.displayable.*` Element 版。

## Get Position

`blueprint.displayable.getPosition` - 获取元素坐标

获取当前元素左上角坐标。
- `position` - 元素坐标，`Vector2D`

## Get Size

`blueprint.displayable.getSize` - 获取元素尺寸

获取当前元素尺寸。
- `size` - 元素尺寸，`Vector2D`

## Get Bounds

`blueprint.displayable.getBounds` - 获取元素边界

获取当前元素的矩形边界。
- `bounds` - 元素矩形，JSON object，包含 `x`、`y`、`width`、`height`

## Get Rotation

`blueprint.displayable.getRotation` - 获取元素旋转角度

获取当前元素的旋转角度。
- `rotation` - 旋转角度

## Get Opacity

`blueprint.displayable.getOpacity` - 获取元素透明度

获取当前元素的透明度。
- `opacity` - 透明度

## Get Visible

`blueprint.displayable.getVisible` - 获取元素可见状态

获取当前元素是否可见。
- `visible` - 是否可见
