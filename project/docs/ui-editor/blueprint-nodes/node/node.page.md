# Page 节点

除非额外声明，所有参数均为传入引脚值；标注（传出引脚）的参数为传出值。

Page 节点用于切换 Page，以及 Page 组件和被嵌入 Page 之间的通信。当前 Page 可以读取自己的 Page props 和 Surface 进退场状态；没有传入 props 时读取 `{}`，读取缺失字段时得到 `null`。顶层 Page 没有父级 Page 组件时，发送事件不会触发父级事件。

Page 可以在自己的属性面板「参数」里声明打开它时传入的值（`UIAppSurface.params`，每个参数有 id、名称、类型 `string` / `text` / `number` / `boolean` / `list` / `json` 和默认值；`list` 另有行结构 `struct`，没有默认值）。`text` 是玩家读到的文字：在引脚上是字符串，默认值会进译表，页面上的文本可在「页面参数」中直接绑定它（`pageParam` 值绑定），不经蓝图。`list` 的输入和 `Get Page Param` 的输出带行结构类型（`array<struct:<id>>`）。名称就是该值在 Page props 里的键；id 供蓝图引用，改名不影响已连好的线。Page 的宿主在建立时把传入的 props 叠在声明的默认值之上，并把声明过的键转成声明的类型，所以 `Get Page Props`、`Get Page Param`、按 Page 属性绑定的列表和脚本读到的是同一份值。

`blueprint.page.go` 面向运行时 Page 导航并可传入 Page props；`blueprint.page.getProps` 读取当前 Page props；`blueprint.page.isSurfaceExiting` / `blueprint.page.isSurfaceEntering` / `blueprint.page.isSurfaceTransitioning` 读取当前 Surface 过渡状态；`blueprint.page.quit` 退出当前应用运行时；`blueprint.app.keepWindowOpen` 取消玩家发出的窗口关闭请求；`blueprint.frame.emit` 面向被嵌入 Page 的通信上下文；`nl.frame` 组件自己的目标 Page 和 params 读写方法记录在 `node.widget.md`。

## Go Page

`blueprint.page.go` - 切换到 Page

通过 Host navigation 打开节点参数中选择的目标 Page，使用运行时的页面切换流程。`Page` 下拉可以选择 `None`，此时会关闭当前顶层 Page 叠层，用于清除正在展示的 Page。未进入游戏时，它切换 Dev Mode 的应用 Page；`Start Game` 或 `Load Save` 进入游戏状态后，它会把目标 Page 作为 UI 叠层打开在游戏舞台之上，并继续使用同一套 Page 进退场动画、Surface 生命周期和控件蓝图运行时。它是执行尾节点，没有后续执行出口。
- `in` - 执行入口
- `Page` - 节点参数，目标 Page surface id；选择 `None` 时清除当前顶层 Page 叠层
- `param_<id>` - 所选 Page 声明的每个参数各一个可选输入，类型按声明，位于 `props` 之前；未连接也未填写时不传，目标 Page 读到默认值。只属于下拉所选的 Page：`Page` 引脚连线时卡片上不显示这些输入，连线给出的 Page 只收到 `props`
- `props` - 可选 `json` 输入，作为目标 Page 的 Page props；已声明参数的输入按名称覆盖其中同名字段；都未给出时传入 `{}`

`Replace Page`、`Show Layer` 与 `Set Frame Page` 以同样方式长出参数输入。

## Quit

`blueprint.page.quit` - 退出应用运行时

通过 Host navigation 请求退出当前应用运行时。在 Studio Dev Mode 中，该节点会停止 Dev Mode 会话并返回 Studio 编辑环境，不会终止 Studio 主进程。它是执行尾节点，没有后续执行出口。
- `in` - 执行入口

## Keep Window Open

`blueprint.app.keepWindowOpen` - 留住窗口，取消这次关闭

玩家点关闭按钮或按下 Alt+F4 时，主进程会先把关闭挂起、派发 `On Window Close Requested`，等蓝图跑完再真正关窗；除非有人取消。这个节点就是那个取消。想在退出前问一句「真的要退出吗」，就先执行它把窗口留住，再弹出自己的确认页面，玩家确认后调用 `Quit Application`。

它只做这一件事：不会吞掉按键，不会阻止 Page 或叠层关闭，也不会影响元素事件的派发。窗口关闭请求之外没有任何可取消的东西，所以在别的派发里执行会抛出蓝图执行错误，而不是静默通过——静默通过的图看起来和能用的图一模一样。可用于 Global 与 Surface 蓝图。
- `in` - 执行入口
- `next` - 执行出口；取消关闭不是终点，后面通常接确认页面

## Get Page Props

`blueprint.page.getProps` - 读取 Page props

读取当前 Page runtime scope 的完整 props 对象。通过 `Go Page` 打开的顶层 Page 会读取 `Go Page` 的 `Page props` 输入；通过 `nl.frame` 嵌入的子 Page 会读取 frame 的 `params` 对象，`Set Frame Page` 的可选 `Page props` 输入也会写入这份 `params`。该节点可用于 Page、Widget 和 Blueprint Value 运行上下文，Global 蓝图内无法使用。
- `props` - 当前 Page props（传出引脚）

## Is Surface Exiting

`blueprint.page.isSurfaceExiting` - 读取当前 Surface 是否正在退出

读取当前 Page runtime scope 对应 Surface 的退出状态。当 Surface 已触发 `Before Surface Exit`、退出动画已经开始且还未卸载时返回 `true`；其他时候返回 `false`。该节点是 pure 节点，可用于 Page、Widget 和 Blueprint Value 运行上下文，Global 蓝图内无法使用。没有动画层运行时状态的环境会返回 `false`。
- `isExiting` - 是否正在退出（传出引脚）

## Is Surface Entering

`blueprint.page.isSurfaceEntering` - 读取当前 Surface 是否正在进入

读取当前 Page runtime scope 对应 Surface 的进入状态。Surface runtime scope 挂载后、进入动画结束前返回 `true`；触发 `After Surface Enter` 前会更新为 `false`，因此该事件内读取会得到已进入完成的状态。该节点是 pure 节点，可用于 Page、Widget 和 Blueprint Value 运行上下文，Global 蓝图内无法使用。没有动画层运行时状态的环境会返回 `false`。
- `isEntering` - 是否正在进入（传出引脚）

## Is Surface Transitioning

`blueprint.page.isSurfaceTransitioning` - 读取当前 Surface 是否正在过渡

读取当前 Page runtime scope 对应 Surface 的综合过渡状态。当 `Is Surface Entering` 或 `Is Surface Exiting` 为 `true` 时返回 `true`；其他时候返回 `false`。该节点是 pure 节点，可用于 Page、Widget 和 Blueprint Value 运行上下文，Global 蓝图内无法使用。没有动画层运行时状态的环境会返回 `false`。
- `isTransitioning` - 是否正在进入或退出（传出引脚）

## Get Page Param

`blueprint.frame.getParam` - 读取 Page 参数

从下拉中选择蓝图所属 Page 声明的参数，按参数当前的名称读取，并按声明的类型输出；打开 Page 时没有传入该参数时输出默认值。所选参数已不在 Page 的声明中时输出 `null`，画布显示 `node.page_param_missing`，项目检查报告 `blueprint/page-param-missing`。通过 `nl.frame` 嵌入时读取 frame 的 `params`。该节点是 pure 节点，可用于 Page、Widget 和 Blueprint Value 运行上下文。

`text` 参数读到的是传入的文字，未传入时是默认值的原文（不翻译）；要按玩家语言显示，在文本的「页面参数」中直接绑定该参数。

未选择参数时显示旧的 `key` 输入，按 key 读取单个字段，兼容声明参数之前写的图；选择参数后 `key` 输入不再出现。
- `Param` - 节点参数，参数 id
- `key` - 未选择参数时的参数名
- `value` - 参数值（传出引脚）

## Emit Page Event

`blueprint.frame.emit` - 发送 Page 事件

向父级 Page 组件实例发送事件。父级 `nl.frame` 元素的私有蓝图可以通过 `Page Event` 事件 Head 接收。
- `in` - 执行入口
- `event` - 事件名
- `data` - 事件数据
- `next` - 执行出口
