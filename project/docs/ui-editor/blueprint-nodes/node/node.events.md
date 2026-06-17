# Events 节点

除非额外声明，所有参数均为传出引脚值。

## App Boot

`blueprint.event.head.appBoot` - 应用启动事件

当游戏 UI 运行时完成启动时，一次性触发。

## Surface Init

`blueprint.event.head.surfaceInit` - 当前 Surface 初始化事件

当 Page 或 Game UI 被打开并进入运行时，一次性触发。

## Surface Unmount

`blueprint.event.head.surfaceUnmount` - 当前 Surface 卸载事件

当 Page 或 Game UI 被关闭、替换或从运行时移除时触发。

## Init

`blueprint.event.head.init` - 元素初始化事件

当元素被挂载到文档中，一次性触发。

## Mouse Click

`blueprint.event.head.mouseClick` - 元素鼠标点击事件

当鼠标在元素上完成一次左键点击时触发。
- `x` - 鼠标 X 坐标
- `y` - 鼠标 Y 坐标

## Mouse Double Click

`blueprint.event.head.mouseDoubleClick` - 元素鼠标双击事件

当鼠标在元素上完成一次左键双击时触发。
- `x` - 鼠标 X 坐标
- `y` - 鼠标 Y 坐标

## Mouse Enter

`blueprint.event.head.mouseEnter` - 元素鼠标进入事件

当鼠标进入元素区域时触发。
- `x` - 鼠标 X 坐标
- `y` - 鼠标 Y 坐标

## Mouse Leave

`blueprint.event.head.mouseLeave` - 元素鼠标离开事件

当鼠标离开元素区域时触发。
- `x` - 鼠标 X 坐标
- `y` - 鼠标 Y 坐标

## Mouse Move

`blueprint.event.head.mouseMove` - 元素鼠标移动事件

当鼠标在元素上移动时，每次移动触发。
- `x` - 鼠标 X 坐标
- `y` - 鼠标 Y 坐标

## Mouse Down

`blueprint.event.head.mouseDown` - 元素鼠标按下事件

当鼠标在元素上按下时触发。
- `x` - 鼠标 X 坐标
- `y` - 鼠标 Y 坐标
- `button` - 鼠标按键

## Mouse Up

`blueprint.event.head.mouseUp` - 元素鼠标抬起事件

当鼠标在元素上抬起时触发。
- `x` - 鼠标 X 坐标
- `y` - 鼠标 Y 坐标
- `button` - 鼠标按键

## Mouse Wheel

`blueprint.event.head.mouseWheel` - 元素鼠标滚轮事件

当鼠标滚轮在元素上滚动时触发。
- `x` - 鼠标 X 坐标
- `y` - 鼠标 Y 坐标
- `deltaX` - 横向滚动量
- `deltaY` - 纵向滚动量

## Right Click

`blueprint.event.head.rightClick` - 元素鼠标右键点击事件

当鼠标在元素上完成一次右键点击时触发。
- `x` - 鼠标 X 坐标
- `y` - 鼠标 Y 坐标

## Focus

`blueprint.event.head.focus` - 元素获得焦点事件

当元素获得键盘或手柄焦点时触发。

## Blur

`blueprint.event.head.blur` - 元素失去焦点事件

当元素失去键盘或手柄焦点时触发。

## Scroll

`blueprint.event.head.scroll` - 列表滚动事件

当列表内容发生滚动时触发。
- `offset` - 当前滚动位置
- `maxOffset` - 最大滚动位置
- `progress` - 滚动进度

## OnAnyBroadCast

`blueprint.event.head.onAnyBroadcast` - 任意事件广播事件

当前元素收到任意广播事件时触发。传出：
- `event` - 广播事件
- `data` - 广播数据
- `sender` - 发送广播的元素 ID

## OnBroadcast

`blueprint.event.head.onBroadcast` - 事件广播事件

当前元素收到指定名称的广播事件时触发。传入：
- `event` - 广播事件

传出：
- `data` - 广播数据
- `sender` - 发送广播的元素 ID
