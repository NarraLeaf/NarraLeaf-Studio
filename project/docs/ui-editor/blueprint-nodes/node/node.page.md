# Page 节点

除非额外声明，所有参数均为传入引脚值；标注（传出引脚）的参数为传出值。

Page 节点用于切换 Page，以及 Page 组件和被嵌入 Page 之间的通信。当前 Page 可以读取自己的 Page props；没有传入 props 时读取 `{}`，读取缺失字段时得到 `null`。顶层 Page 没有父级 Page 组件时，发送事件不会触发父级事件。

`blueprint.page.go` 面向运行时 Page 导航并可传入 Page props；`blueprint.page.getProps` / `blueprint.frame.getParam` 读取当前 Page props；`blueprint.page.quit` 退出当前应用运行时；`blueprint.frame.emit` 面向被嵌入 Page 的通信上下文；`nl.frame` 组件自己的目标 Page 和 params 读写方法记录在 `node.widget.md`。

## Go Page

`blueprint.page.go` - 切换到 Page

通过 Host navigation 打开节点参数中选择的目标 Page，使用运行时的页面切换流程。未进入游戏时，它切换 Dev Mode 的应用 Page；`Start Game` 或 `Load Save` 进入游戏状态后，它会把目标 Page 作为 UI 叠层打开在游戏舞台之上，并继续使用同一套 Page 进退场动画、Surface 生命周期和控件蓝图运行时。它是执行尾节点，没有后续执行出口。
- `in` - 执行入口
- `Page` - 节点参数，目标 Page surface id
- `props` - 可选 `json` 输入，作为目标 Page 的 Page props；未连接时传入 `{}`

## Quit

`blueprint.page.quit` - 退出应用运行时

通过 Host navigation 请求退出当前应用运行时。在 Studio Dev Mode 中，该节点会停止 Dev Mode 会话并返回 Studio 编辑环境，不会终止 Studio 主进程。它是执行尾节点，没有后续执行出口。
- `in` - 执行入口

## Get Page Props

`blueprint.page.getProps` - 读取 Page props

读取当前 Page runtime scope 的完整 props 对象。通过 `Go Page` 打开的顶层 Page 会读取 `Go Page` 的 `Page props` 输入；通过 `nl.frame` 嵌入的子 Page 会读取 frame 的 `params` 对象，`Set Frame Page` 的可选 `Page props` 输入也会写入这份 `params`。该节点可用于 Page、Widget 和 Blueprint Value 运行上下文，Global 蓝图内无法使用。
- `props` - 当前 Page props（传出引脚）

## Get Page Param

`blueprint.frame.getParam` - 读取 Page 参数

按 key 读取当前 Page props 中的单个字段。通过 `nl.frame` 嵌入时，frame `params` 就是该子 Page 的 props；通过 `Go Page` 打开时，`Page props` 输入就是目标 Page 的 props。
- `key` - 参数名
- `value` - 参数值（传出引脚）

## Emit Page Event

`blueprint.frame.emit` - 发送 Page 事件

向父级 Page 组件实例发送事件。父级 `nl.frame` 元素的私有蓝图可以通过 `Page Event` 事件 Head 接收。
- `in` - 执行入口
- `event` - 事件名
- `data` - 事件数据
- `next` - 执行出口
