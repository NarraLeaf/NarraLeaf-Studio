# Events 节点

除非额外声明，所有参数均为传出引脚值。事件 Head 节点没有执行入口，统一通过 `then` 执行出口继续后续逻辑。

鼠标坐标使用当前元素的本地设计坐标系。Broadcast、Page Event 与鼠标事件的传出值均来自当前运行时事件 payload；没有对应 payload 时传出值为 `undefined`。

元素事件只从当前元素自己的可交互区域触发，不会冒泡接管子元素事件；控件处于禁用或文本编辑等不可交互状态时不会派发对应 Events Head。

在可视化编辑器中，画布右键 Add Node 菜单会按当前 Blueprint owner 和 widget event slot 显示可用 Events Head。左侧 `Layers > New` 也提供可选的 Event 字段，默认 `-` 表示只创建空图层；只有显式选择事件时才会自动插入对应 Events Head。

## App Boot

`blueprint.event.head.appBoot` - 应用启动事件

当 Dev Mode UI runtime 完成启动并拥有可执行的全局蓝图时触发一次。该节点仅出现在全局蓝图中。
- `then` - 执行出口

## Surface Init

`blueprint.event.head.surfaceInit` - 当前 Surface 初始化事件

当 Page 或 Game UI Surface 首次进入当前运行时 scope 时触发。顶层 Surface 使用自身 id 作为 scope；Page 组件嵌入的子 Page 使用独立 `runtimeScopeId`，同一个 Page 被多个 Page 组件引用时彼此隔离。
- `then` - 执行出口

## Surface Unmount

`blueprint.event.head.surfaceUnmount` - 当前 Surface 卸载事件

当 Page 或 Game UI Surface 离开当前运行时 scope、被替换，或 Page 组件实例卸载时触发。
- `then` - 执行出口

## Init

`blueprint.event.head.init` - 元素初始化事件

当支持私有蓝图的元素在 Dev Mode runtime 中挂载时触发一次。在 Blueprint Value 中，`init` 也作为初始求值事件，并且总是在 `flush` 之前执行。
- `then` - 执行出口

## Flush

`blueprint.event.head.flush` - Blueprint Value 刷新事件

该节点只出现在 Blueprint Value 图中。运行时会在初始 `init` 后自动尝试执行 `flush`，并在 surface/global state 更新后自动排队重新执行；默认 Blueprint Value 只创建 `Init` layer，不会额外创建 `Flush` layer。
- `then` - 执行出口

## Mouse Click

`blueprint.event.head.mouseClick` - 元素鼠标点击事件

当鼠标在元素上完成一次点击时触发。该节点是当前真实点击事件入口；不要新增旧 Click 别名重复节点。
- `then` - 执行出口
- `x` - 鼠标 X 坐标
- `y` - 鼠标 Y 坐标

## Mouse Double Click

`blueprint.event.head.mouseDoubleClick` - 元素鼠标双击事件

当鼠标在元素上完成一次双击时触发。
- `then` - 执行出口
- `x` - 鼠标 X 坐标
- `y` - 鼠标 Y 坐标

## Mouse Enter

`blueprint.event.head.mouseEnter` - 元素鼠标进入事件

当鼠标进入元素区域时触发。
- `then` - 执行出口
- `x` - 鼠标 X 坐标
- `y` - 鼠标 Y 坐标

## Mouse Leave

`blueprint.event.head.mouseLeave` - 元素鼠标离开事件

当鼠标离开元素区域时触发。
- `then` - 执行出口
- `x` - 鼠标 X 坐标
- `y` - 鼠标 Y 坐标

## Mouse Move

`blueprint.event.head.mouseMove` - 元素鼠标移动事件

当鼠标在元素上移动时触发。
- `then` - 执行出口
- `x` - 鼠标 X 坐标
- `y` - 鼠标 Y 坐标

## Mouse Down

`blueprint.event.head.mouseDown` - 元素鼠标按下事件

当鼠标在元素上按下时触发。
- `then` - 执行出口
- `x` - 鼠标 X 坐标
- `y` - 鼠标 Y 坐标
- `button` - 鼠标按键编号

## Mouse Up

`blueprint.event.head.mouseUp` - 元素鼠标抬起事件

当鼠标在元素上抬起时触发。
- `then` - 执行出口
- `x` - 鼠标 X 坐标
- `y` - 鼠标 Y 坐标
- `button` - 鼠标按键编号

## Mouse Wheel

`blueprint.event.head.mouseWheel` - 元素鼠标滚轮事件

当鼠标滚轮在元素上滚动时触发。
- `then` - 执行出口
- `x` - 鼠标 X 坐标
- `y` - 鼠标 Y 坐标
- `deltaX` - 横向滚动量
- `deltaY` - 纵向滚动量

## Right Click

`blueprint.event.head.rightClick` - 元素鼠标右键点击事件

当鼠标在元素上触发右键菜单事件时触发。事件成功派发时，默认上下文菜单会被阻止。
- `then` - 执行出口
- `x` - 鼠标 X 坐标
- `y` - 鼠标 Y 坐标

## Focus

`blueprint.event.head.focus` - 元素获得焦点事件

当元素获得键盘、鼠标或手柄焦点时触发。
- `then` - 执行出口

## Blur

`blueprint.event.head.blur` - 元素失去焦点事件

当元素失去键盘、鼠标或手柄焦点时触发。
- `then` - 执行出口

## Scroll

`blueprint.event.head.scroll` - 列表滚动事件

当 List 元素的滚动容器发生滚动时触发。
- `then` - 执行出口
- `offset` - 当前滚动位置
- `maxOffset` - 最大滚动位置
- `progress` - 滚动进度，范围通常为 `0` 到 `1`

## Scroll End

`blueprint.event.head.scrollEnd` - 列表滚动末端事件

当 List 元素的滚动容器从非末端滚动到末端时触发。该事件不会在已经停留在末端时因为后续相同滚动事件重复触发；离开末端后再次滚动到末端会重新触发。
- `then` - 执行出口
- `offset` - 当前滚动位置
- `maxOffset` - 最大滚动位置
- `progress` - 滚动进度，范围通常为 `0` 到 `1`

## Item Render

`blueprint.event.head.itemRender` - 列表条目渲染事件

当 List 根据绑定数据、预览数据或预览数量渲染单个条目实例时触发。事件 payload 来自该条目的 `UIListItemScope`。
- `then` - 执行出口
- `index` - 条目索引
- `count` - 本次渲染的条目总数
- `key` - 条目 key，优先来自 List 的 `itemKeyPath`
- `item` - 当前条目的 JSON 数据

## Item Click

`blueprint.event.head.itemClick` - 列表条目点击事件

当 List 的某个条目容器收到点击时触发。点击条目模板内的子元素也会归属到对应条目。
- `then` - 执行出口
- `index` - 条目索引
- `count` - 本次渲染的条目总数
- `key` - 条目 key，优先来自 List 的 `itemKeyPath`
- `item` - 当前条目的 JSON 数据

## Item Hover

`blueprint.event.head.itemHover` - 列表条目悬停事件

当鼠标或指针进入 List 的某个条目容器时触发。
- `then` - 执行出口
- `index` - 条目索引
- `count` - 本次渲染的条目总数
- `key` - 条目 key，优先来自 List 的 `itemKeyPath`
- `item` - 当前条目的 JSON 数据

## Selection Changed

`blueprint.event.head.selectionChanged` - 列表选中项变化事件

当 List 条目点击导致运行时选中索引变化时触发。List 会以 `selectedIndex` 属性作为初始选中值；同一运行时实例内重复点击当前选中条目不会重复触发变化事件。
- `then` - 执行出口
- `index` - 新选中条目索引
- `previousIndex` - 变化前的选中条目索引；没有选中项时为 `-1`
- `count` - 本次渲染的条目总数
- `key` - 新选中条目的 key，优先来自 List 的 `itemKeyPath`
- `item` - 新选中条目的 JSON 数据

## On Any Broadcast

`blueprint.event.head.onAnyBroadcast` - 任意广播接收事件

当前 Surface 蓝图或元素私有蓝图收到任意广播事件时触发。
- `then` - 执行出口
- `event` - 广播事件名
- `data` - 广播数据
- `sender` - 发送广播的元素 ID；没有发送者时为空字符串

## On Broadcast

`blueprint.event.head.onBroadcast` - 指定广播接收事件

当前 Surface 蓝图或元素私有蓝图收到指定名称的广播事件时触发。该节点通过 Inspector 参数选择事件名。
- `event` - 要监听的广播事件名（Inspector 参数）
- `then` - 执行出口
- `data` - 广播数据
- `sender` - 发送广播的元素 ID；没有发送者时为空字符串

## Page Event

`blueprint.event.head.pageEvent` - Page 组件事件

当嵌入在 Page 组件中的子 Page 调用 `Emit Page Event` 时，在父级 `nl.frame` 元素的私有蓝图中触发。
- `then` - 执行出口
- `event` - 子 Page 发出的事件名
- `data` - 子 Page 发出的事件数据
