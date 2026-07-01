# Events 节点

除非额外声明，所有参数均为传出引脚值。事件 Head 节点没有执行入口，统一通过 `then` 执行出口继续后续逻辑。

鼠标坐标使用当前元素的本地设计坐标系。Broadcast、Page Event、键盘事件与鼠标事件的传出值均来自当前运行时事件 payload；没有对应 payload 时传出值按 `null` 处理。

键盘事件由运行时窗口级监听派发，不依赖元素焦点。Global 蓝图、当前 active Surface 蓝图，以及已挂载控件的私有蓝图都会收到对应键盘事件；如果多处都放置事件 Head，它们会分别执行。控件私有蓝图的键盘监听随控件挂载注册，控件卸载时自动移除。

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

## On Key Down

`blueprint.event.head.keyDown` - 指定键按下事件

当运行时窗口收到匹配的键盘按下事件时触发。该节点出现在 Global 蓝图、Surface 蓝图和普通控件私有蓝图中；当前 active Surface 和所有已挂载且拥有该事件 Head 的控件都会收到同一次窗口事件。

卡片字段：
- `Key` - 键盘绑定按钮。卡片显示当前绑定；点击后在按钮上方显示捕获浮窗，按下任意按键即可绑定，支持 `Ctrl` / `Alt` / `Shift` / `Meta` 组合键。单键绑定按 `KeyboardEvent.key` 大小写不敏感匹配；绑定中包含修饰键时，修饰键状态也必须匹配。空值不会触发，任意键请使用 `Any Key Down`

输出：
- `then` - 执行出口

## On Key Up

`blueprint.event.head.keyUp` - 指定键抬起事件

当运行时窗口收到匹配的键盘抬起事件时触发。该节点出现在 Global 蓝图、Surface 蓝图和普通控件私有蓝图中；不要求任何元素处于焦点状态。

卡片字段：
- `Key` - 键盘绑定按钮。卡片显示当前绑定；点击后在按钮上方显示捕获浮窗，按下任意按键即可绑定，支持 `Ctrl` / `Alt` / `Shift` / `Meta` 组合键。单键绑定按 `KeyboardEvent.key` 大小写不敏感匹配；绑定中包含修饰键时，修饰键状态也必须匹配。空值不会触发，任意键请使用 `Any Key Up`

输出：
- `then` - 执行出口

## Any Key Down

`blueprint.event.head.anyKeyDown` - 任意键按下事件

当运行时窗口收到任意键盘按下事件时触发。该节点出现在 Global 蓝图、Surface 蓝图和普通控件私有蓝图中。
- `then` - 执行出口
- `key` - 按键语义值，对应 `KeyboardEvent.key`
- `altKey` - Alt 是否按下
- `ctrlKey` - Ctrl 是否按下
- `shiftKey` - Shift 是否按下
- `metaKey` - Meta / Command / Windows 是否按下

## Any Key Up

`blueprint.event.head.anyKeyUp` - 任意键抬起事件

当运行时窗口收到任意键盘抬起事件时触发。该节点出现在 Global 蓝图、Surface 蓝图和普通控件私有蓝图中。
- `then` - 执行出口
- `key` - 按键语义值，对应 `KeyboardEvent.key`
- `altKey` - Alt 是否按下
- `ctrlKey` - Ctrl 是否按下
- `shiftKey` - Shift 是否按下
- `metaKey` - Meta / Command / Windows 是否按下

## Init

`blueprint.event.head.init` - 元素初始化事件

当支持私有蓝图的元素在 Dev Mode runtime 中挂载时触发一次。在 Blueprint Value 中，`init` 作为初始求值入口；后续可以由隐藏的 Element 属性依赖调度，也可以由 `On Flush` 显式刷新入口调度。
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

## On Flush

`blueprint.event.head.flush` - 当前元素刷新事件

当当前蓝图所属元素被蓝图 Host API 显式更改属性并触发重绘时触发。CSS 自动状态样式（例如 hover/focus 变体自动计算）不会触发该事件。事件 payload 返回被刷新的元素引用。在 Blueprint Value 中，`On Flush` 也可作为显式求值入口；默认 Dialog Nametag 的普通 widgetMain 事件图也通过该入口随对话推进刷新。
- `then` - 执行出口
- `element` - 被刷新的元素引用

Flush 是属性提交后的批处理通知。运行时会按帧合并同一元素的 flush；flush 处理器内部再次改写元素属性时，新的 flush 会进入下一帧批次，避免同步重入。

## Element Flush

`blueprint.event.head.elementFlush` - 绑定元素刷新事件

该事件头和 `Element` 节点一样先绑定同 Surface 的目标控件，然后监听该目标控件的 flush 事件。目标控件被蓝图 Host API 显式更改属性并触发重绘后，当前蓝图中的该事件头会执行。它的 `element` 输出也可以手动连接到 Element 派生节点的目标输入。
- `then` - 执行出口
- `element` - 被刷新的绑定元素引用

## Element Click

`blueprint.event.head.elementClick` - 绑定元素点击事件

该事件头和 `Element Flush` 一样先绑定同 Surface 的目标控件，然后监听该目标控件自己的 `mouseClick` 事件。目标控件收到真实点击后，当前蓝图中的该事件头会执行；事件不会依赖点击穿透或父子冒泡。默认 Dialog 模板把推进逻辑集中在 Dialog Content 蓝图中：Content 自己用 `Mouse Click`，同时用 `Element Click` 绑定全屏透明 Dialog Interaction Layer、可见 Dialog Panel 和默认内容子控件，这些入口连到同一个 Game `Next`。
- `then` - 执行出口
- `element` - 被点击的绑定元素引用
- `x` - 鼠标 X 坐标，使用目标元素本地设计坐标
- `y` - 鼠标 Y 坐标，使用目标元素本地设计坐标
- `button` - 鼠标按键编号

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

## List Item Refresh

`blueprint.event.head.listItemRefresh` - List 条目上下文刷新事件

当 `nl.list` 渲染或刷新某个条目时，会向 item template 后代元素的私有蓝图派发。该事件用于让模板子元素读取当前条目的 `props`，并且每个重复条目实例使用独立 `instanceKey` / `listItemScope`，不会和相同 element id 的其他条目共享 locals。
- `then` - 执行出口
- `props` - 当 `item` 是 object 时为 `item` 本身，否则为 `{ value: item }`
- `item` - 当前条目数据
- `index` - 条目索引
- `count` - 本次渲染条目总数
- `key` - 条目 key

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
