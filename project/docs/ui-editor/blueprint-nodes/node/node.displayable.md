# Displayable 节点

除非额外声明，所有参数均为传出引脚值。

Displayable 节点默认读取当前元素。坐标和尺寸均使用当前 Surface 的设计坐标系。

Element-targeted magic variants use `blueprint.element.displayable.*` and add a separated top `element` input. These read nodes can target any Same-Surface Element Literal and are pure, so they are available to Blueprint Value graphs.

## Get Position

`blueprint.displayable.getPosition` - 获取元素坐标

获取当前元素左上角坐标。
- `x` - 元素 X 坐标
- `y` - 元素 Y 坐标

## Get Size

`blueprint.displayable.getSize` - 获取元素尺寸

获取当前元素尺寸。
- `width` - 元素宽度
- `height` - 元素高度

## Get Bounds

`blueprint.displayable.getBounds` - 获取元素边界

获取当前元素的矩形边界。
- `x` - 元素 X 坐标
- `y` - 元素 Y 坐标
- `width` - 元素宽度
- `height` - 元素高度
- `left` - 左边界
- `top` - 上边界
- `right` - 右边界
- `bottom` - 下边界

## Get Center

`blueprint.displayable.getCenter` - 获取元素中心点

获取当前元素的中心点坐标。
- `centerX` - 中心点 X 坐标
- `centerY` - 中心点 Y 坐标

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
