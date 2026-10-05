# Events 节点

除非额外声明，所有参数均为传出引脚值。事件 Head 节点没有执行入口，统一通过 `then` 执行出口继续后续逻辑。

元素鼠标事件坐标使用当前元素的本地设计坐标系：事件从被点中的子元素冒泡到祖先元素时，祖先上的事件 Head 读到的是同一次按下在该祖先自己框内的坐标，而不是子元素的坐标；Surface 鼠标事件坐标使用当前 Surface 的设计坐标系。Broadcast、Page Event、键盘事件与鼠标事件的传出值均来自当前运行时事件 payload；没有对应 payload 时传出值按 `null` 处理。

键盘事件由运行时窗口级监听派发，不依赖元素焦点。一次按键先交给 Global 蓝图，再交给此刻持有键盘的那一个条目：最上层的模态层；没有模态层时是当前页面；故事占着屏幕、上面没有页面或模态层时，是故事放到舞台上的界面（对话框、选项列表、快捷菜单）。持有键盘的条目里，Surface 蓝图和已挂载控件的私有蓝图都会收到；如果多处都放置事件 Head，它们会分别执行。模态层持有键盘时，它下面的页面一个键也收不到；非模态层从不持有键盘，它下面的页面照常收键。控件私有蓝图的键盘监听随控件挂载注册，控件卸载时自动移除。按住不放时系统重复发出的按键不算新的按下：`On Key Down` 与 `Any Key Down` 每按一次只触发一次。文本框持有焦点时，敲进去的键不触发任何键盘事件 Head，包括这个文本框自己的；文本框只报告自己的 `Value Changed` 与 `Submit`。Surface 完成 prepaint 后，Page 进退场期间键盘事件仍会派发；需要屏蔽时在图里读取 Page 分类的 `Is Surface Entering`、`Is Surface Exiting` 或 `Is Surface Transitioning` 自行分支。

元素事件只从当前元素自己的可交互区域触发；Surface 进退场期间，鼠标与点击类事件默认等到 Surface interaction ready 后才派发。控件处于禁用或文本编辑等不可交互状态时不会派发对应 Events Head。

`Continue Event Bubble` 与 `Stop Event Bubble` 两个节点已经移除：元素的事件 Head 表示「我要这个事件」而不是「这个事件归我」，命中链上声明了该 Head 的元素各自触发，没有可以交出去或吃掉的所有权。唯一仍然可以被蓝图取消的派发是窗口关闭请求，取消它用 App 分类的 `Keep Window Open`（见 `node.page.md`）；该节点只对窗口关闭请求有效，不影响任何其他事件。

在可视化编辑器中，画布右键 Add Node 菜单会按当前 Blueprint owner 和控件类型显示可用 Events Head。图层栏的「添加图层」只问图层名和图层是节点图还是脚本，新建的节点图图层是空的，事件 Head 由作者自己放；蓝图还没有任何图层时，编辑器列出适合它的图层模板，模板通常已经带好事件 Head。

## App Boot

`blueprint.event.head.appBoot` - 应用启动事件

每次启动游戏时触发一次（Dev Mode、预览与打包游戏相同）：游戏打开时的第一个页面完成首帧绘制、或游戏直接从故事开始时舞台显示出来之后，并且总在 `On Game Ready` 执行完之后。界面不等它执行完。Dev Mode 每次重新加载工程后会再触发一次。该节点仅出现在全局蓝图中。
- `then` - 执行出口

## On Game Ready

`blueprint.event.head.gameReady` - NarraLeaf 游戏环境准备就绪事件

当 NarraLeaf React `LiveGame` 对象已经创建并存入 Studio runtime、但 `liveGame.newGame()` 尚未启动第一段剧情前触发。该节点仅出现在全局蓝图中，每个被接受的 NarraLeaf session id 触发一次。

游戏启动时会在 **Surface 系统启动之前** 作为加载项初始化 NarraLeaf React 环境：以「Story 库默认 Story（`storyLibrary.index.defaultStoryId`）的入口场景」的 compiled story 挂载 `Player`（Player `onReady`），此时 `LiveGame` 已创建、默认场景资产开始预热（Player `onPreloadComplete`），但**尚未调用 `liveGame.newGame()`，也不会进入游戏**。因此 `gameReady` 会在启动阶段、首个 Surface（例如主菜单）显示之前触发一次，第一个界面要等它执行完才显示，用于初始化环境并允许全局蓝图加载游戏设置——玩家仍停留在主菜单，游戏并未开始。它执行期间打开的层（例如启动闪屏）会照常画出来。若项目未配置默认 Story，则改为挂载一个空 NarraLeaf React 环境（不含任何场景），`gameReady` 仍会在启动时触发。

真正「进入游戏」只发生在玩家触发 `Start Game`（`Start Game` 蓝图节点）或读取存档时：此时才对**同一个已初始化的 `LiveGame`** 调用 `newGame()` / `deserialize()`。当 `Start Game` 的目标就是已预热的默认场景时为「秒开」，直接在同一环境上进入，**不会重复触发 `gameReady`**；仅当 `Start Game` 指定了不同的场景时才会重新挂载环境并再次触发 `gameReady`。

该事件用于初始化需要活动游戏实例的 NarraLeaf Preference，例如 `Set Auto Forward`、`Set Game Speed`、`Set Voice Volume` 或 `Set Sentence Speed`；这些设置会在游戏进入前就绪。`On Game Ready` 在每种宿主里都先于 `App Boot` 执行完，但依赖活动 `LiveGame` 的逻辑仍应放在 `On Game Ready` 中：开始或读取游戏换了环境时，只有它会再次触发。

Global 蓝图里有多个 `On Game Ready` 事件头时（同一图层或不同图层、图或脚本），它们在事件触发时同时开始，彼此不等待；启动等待其中最晚结束的那一个。任何事件都是如此：监听同一事件的所有事件头同时开始。

- `then` - 执行出口

## Surface Init

`blueprint.event.head.surfaceInit` - 当前 Surface 初始化事件

当 Page 或 Game UI Surface 首次进入当前运行时 scope 时触发。顶层 Surface 使用自身 id 作为 scope；Page 组件嵌入的子 Page 使用独立 `runtimeScopeId`，同一个 Page 被多个 Page 组件引用时彼此隔离。
- `then` - 执行出口

## Surface Unmount

`blueprint.event.head.surfaceUnmount` - 当前 Surface 卸载事件

当 Page 或 Game UI Surface 离开当前运行时 scope、被替换，或 Page 组件实例卸载时触发。
- `then` - 执行出口

## Before Surface Exit

`blueprint.event.head.beforeSurfaceExit` - Surface 退出动画开始前事件

当当前 Page 或 Page 组件嵌入的子 Page 即将开始退出动画时触发。该事件可用于 Surface 蓝图；也可用于元素私有蓝图，但只有元素蓝图和对应元素在该时刻已挂载且仍存活时才会收到。
- `then` - 执行出口

## After Surface Enter

`blueprint.event.head.afterSurfaceEnter` - Surface 进入动画结束后事件

当当前 Page 或 Page 组件嵌入的子 Page 完成进入动画后触发。无动画或 reduced motion 时，会在预绘制完成并进入稳定显示状态后触发。该事件可用于 Surface 蓝图；也可用于元素私有蓝图，但只有元素蓝图和对应元素在该时刻已挂载且仍存活时才会收到。
- `then` - 执行出口

## On Key Down

`blueprint.event.head.keyDown` - 指定键按下事件

当运行时窗口收到匹配的键盘按下事件时触发；按住不放只算一次。该节点出现在 Global 蓝图、Surface 蓝图和普通控件私有蓝图中；Global 先收到，然后是持有键盘的条目里的 Surface 蓝图和所有已挂载且拥有该事件 Head 的控件（见本页开头）。

卡片字段：
- `Key` - 键盘绑定按钮。卡片显示当前绑定；点击后在按钮上方显示捕获浮窗，按下任意按键即可绑定，支持 `Ctrl` / `Alt` / `Shift` / `Meta` 组合键。单键绑定按 `KeyboardEvent.key` 大小写不敏感匹配；绑定中包含修饰键时，修饰键状态也必须匹配。空值不会触发，任意键请使用 `Any Key Down`

输出：
- `then` - 执行出口

## On Key Up

`blueprint.event.head.keyUp` - 指定键抬起事件

当运行时窗口收到匹配的键盘抬起事件时触发。该节点出现在 Global 蓝图、Surface 蓝图和普通控件私有蓝图中，派发范围同 `On Key Down`；不要求任何元素处于焦点状态。

卡片字段：
- `Key` - 键盘绑定按钮。卡片显示当前绑定；点击后在按钮上方显示捕获浮窗，按下任意按键即可绑定，支持 `Ctrl` / `Alt` / `Shift` / `Meta` 组合键。单键绑定按 `KeyboardEvent.key` 大小写不敏感匹配；绑定中包含修饰键时，修饰键状态也必须匹配。空值不会触发，任意键请使用 `Any Key Up`

输出：
- `then` - 执行出口

## Any Key Down

`blueprint.event.head.anyKeyDown` - 任意键按下事件

当运行时窗口收到任意键盘按下事件时触发；按住不放只算一次。该节点出现在 Global 蓝图、Surface 蓝图和普通控件私有蓝图中，派发范围同 `On Key Down`。
- `then` - 执行出口
- `key` - 按键语义值，对应 `KeyboardEvent.key`
- `altKey` - Alt 是否按下
- `ctrlKey` - Ctrl 是否按下
- `shiftKey` - Shift 是否按下
- `metaKey` - Meta / Command / Windows 是否按下

## Any Key Up

`blueprint.event.head.anyKeyUp` - 任意键抬起事件

当运行时窗口收到任意键盘抬起事件时触发。该节点出现在 Global 蓝图、Surface 蓝图和普通控件私有蓝图中，派发范围同 `On Key Down`。
- `then` - 执行出口
- `key` - 按键语义值，对应 `KeyboardEvent.key`
- `altKey` - Alt 是否按下
- `ctrlKey` - Ctrl 是否按下
- `shiftKey` - Shift 是否按下
- `metaKey` - Meta / Command / Windows 是否按下

## Init

`blueprint.event.head.init` - 元素初始化事件

当支持私有蓝图的元素在游戏运行时（Dev Mode、预览与打包游戏）完成首次渲染并挂载后触发一次；它不是渲染前 hook。Dev Mode 重新加载工程导致对应 Surface / 元素 remount 时会再次触发。在 Blueprint Value 中，`init` 作为初始求值入口；后续可以由隐藏的 Element 属性依赖调度，也可以由 `On Flush` 显式刷新入口调度。上一次求值读到的变量被写入时也会重新求值——`Get Var` 读到的全局、页面变量，`Get Saved Var` 读到的存档变量（直接放在 Blueprint Value 里，或在函数体里），以及经 `Call Fn` 在函数体里读到的元素变量与持久变量（`Get Persistent`），无论写入来自哪张图、哪个宿主，还是故事本身。
- `then` - 执行出口

## Unmount

`blueprint.event.head.unmount` - 元素卸载事件

当支持私有蓝图的元素从当前运行时元素树卸载时触发。Surface 关闭或替换、Frame 子 Page 切换、List item 实例移除、元素可见性导致完全不渲染等都会使对应元素实例卸载；运行时 `display: none` 只隐藏并保持挂载，不触发该事件。
- `then` - 执行出口

## Mouse Click

`blueprint.event.head.mouseClick` - 鼠标点击事件

当鼠标在元素上完成一次点击时触发。用于 Surface 蓝图时，表示当前 Surface 内任意鼠标点击，并输出 Surface 设计坐标。Page 控件（`nl.frame`）里显示的页面同样会收到自己的 Surface 点击：点击落在该页面的元素上时，该页面先收到，坐标是它自己的设计坐标，随后放置 Page 控件的 Surface 照常收到这次点击；点击落在该页面的空白处时，只算 Page 控件和外层 Surface 的点击。该节点是当前真实点击事件入口；不要新增旧 Click 别名重复节点。
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

`blueprint.event.head.rightClick` - 鼠标右键点击事件

当鼠标在元素上触发右键菜单事件时触发。用于 Surface 蓝图时，表示当前 Surface 内任意鼠标右键点击，并输出 Surface 设计坐标；Page 控件里显示的页面与 `Mouse Click` 相同，先于外层 Surface 收到自己的右键点击。事件成功派发时，默认上下文菜单会被阻止。
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

当当前蓝图所属元素被蓝图 Host API 显式更改属性并触发重绘时触发。CSS 自动状态样式（例如 hover/focus 变体自动计算）不会触发该事件。事件 payload 返回被刷新的元素引用。在 Blueprint Value 中，`On Flush` 也可作为显式求值入口；骨架工程对话框里名牌的 Blueprint Value 与头像的事件图都通过该入口随对话推进刷新。
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

该事件头和 `Element Flush` 一样先绑定同 Surface 的目标控件，然后监听该目标控件自己的 `mouseClick` 事件。目标控件收到真实点击后，当前蓝图中的该事件头会执行；事件不会依赖点击穿透或父子冒泡。骨架工程的对话框不靠它推进：对话框回答项目的「推进」操作（`On Action`），点击、空格与回车都绑定在这个操作上。
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

## Drag Start

`blueprint.event.head.sliderDragStart` - 滑块开始拖动事件

只出现在 Slider（`nl.slider`）的私有蓝图中。玩家在滑块上按下指针时触发；按下的位置已经把值移过去，`value` 是移过去之后的值。
- `then` - 执行出口
- `value` - 当前值，`float`

## Value Changed（Slider）

`blueprint.event.head.sliderValueChanged` - 滑块值变化事件

只出现在 Slider 的私有蓝图中。玩家按下或拖动改变了值时触发。拖动期间按帧合并：同一帧里的多次移动只触发一次，`previousValue` 是这一批移动之前的值；上一次触发的图还没跑完时，新的变化会等它跑完再合并派发。蓝图用 `Set Slider Value` 等节点写值不会触发它。
- `then` - 执行出口
- `value` - 变化后的值，`float`
- `previousValue` - 变化前的值，`float`

## Drag End

`blueprint.event.head.sliderDragEnd` - 滑块结束拖动事件

只出现在 Slider 的私有蓝图中。玩家松开指针（或指针被系统取消）时触发。
- `then` - 执行出口
- `value` - 松开时的值，`float`

## Changed

`blueprint.event.head.switchChanged` - 开关状态变化事件

只出现在 Switch（`nl.switch`）的私有蓝图中。玩家拨动开关、状态真的变了时触发；随后再触发 `Turned On` 或 `Turned Off` 之一。上一次拨动触发的图跑完之前，新的拨动被忽略。蓝图写入开关状态不会触发它。
- `then` - 执行出口
- `checked` - 变化后的状态，`boolean`
- `previousChecked` - 变化前的状态，`boolean`

## Turned On

`blueprint.event.head.switchTurnedOn` - 开关被打开事件

只出现在 Switch 的私有蓝图中。玩家把开关拨到开时，在 `Changed` 之后触发。
- `then` - 执行出口

## Turned Off

`blueprint.event.head.switchTurnedOff` - 开关被关闭事件

只出现在 Switch 的私有蓝图中。玩家把开关拨到关时，在 `Changed` 之后触发。
- `then` - 执行出口

## Value Changed（Text Input）

`blueprint.event.head.textInputValueChanged` - 文本框内容变化事件

只出现在 Text Input（`nl.textInput`）的私有蓝图中。玩家输入改变了文本框内容时触发，按帧合并，规则同 Slider 的 `Value Changed`。被最大长度或输入模式拒绝、内容没有变的按键不触发。
- `then` - 执行出口
- `value` - 变化后的文本，`string`
- `previousValue` - 变化前的文本，`string`

## Submit

`blueprint.event.head.textInputSubmit` - 文本框提交事件

只出现在 Text Input 的私有蓝图中。玩家在文本框里按回车时触发；用输入法选字时确认候选的那次回车不算提交。
- `then` - 执行出口
- `value` - 提交时的文本，`string`

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

## On Preference Changed

`blueprint.event.head.preferenceChanged` - 指定 Game Preference 变化事件

当当前活动 NarraLeaf `LiveGame` 的指定 Game Preference 字段变化时触发。节点通过 Inspector 参数 `Preference` 选择要监听的偏好键，底层订阅 NarraLeaf React `game.preference.onPreferenceChange`。该节点出现在 Global 蓝图和 Surface 蓝图中：Global 先触发，然后是每个正在显示的 Surface——活动页面、叠在它上面的层（从最上层开始）、Frame 里显示的页面、故事放到舞台上的界面；层在完成首帧绘制之前不会收到。`On Fullscreen Changed`、`On Window Focus Changed`、`On Window Close Requested` 按同一顺序派发，其中 `On Window Close Requested` 在某个界面执行 `Keep Window Open` 后不再派发给它下面的界面。典型用途是设置 Page 的 Surface 蓝图里随 `BGM Volume`、`Voice Volume`、`Game Speed` 等偏好实时更新 Slider、文本或图标显示（控件层用 Element 分类节点写回目标控件）。

监听目标是当前活动 `LiveGame` 的 preference 派发器：没有活动 game runtime 时不会订阅，也不会触发；`On Game Ready` 之后运行时会在新的 `LiveGame` 上重新建立订阅。通过 Preference Setter（如 `Set BGM Volume`）或 NarraLeaf 内部写入偏好都会触发该事件；`onPreferenceChange` 不保证对相同值去重，写入相同值时也可能再次触发。为提供 `previousValue`，运行时在订阅时用 `getPreferences()` 播种快照并缓存该键上一次已知值。避免在监听某偏好的图里再写入同一偏好，以免自触发循环。

卡片字段：
- `Preference` - 要监听的 Game Preference 键（Inspector 参数），下拉可选值对应 Game 分类每一对 Getter / Setter 的 Preference key，包括由 Studio 而不是引擎保管的几个：`autoForward`、`autoForwardDelay`、`skip`、`skipping`、`skipReadText`、`muteOnWindowBlur`、`showDialog`、`gameSpeed`、`cps`、`textRevealDuration`、`voiceVolume`、`voiceFadeDuration`、`voiceEndMode`、`bgmVolume`、`soundVolume`、`globalVolume`、`skipDelay`、`skipInterval`。空值不会订阅，任意键请使用 `On Any Preference Changed`

输出：
- `then` - 执行出口
- `value` - 变化后的新值；蓝图引脚类型为通用 `json`，实际运行时类型由所选偏好键决定（`autoForward` / `skip` / `skipping` / `skipReadText` / `muteOnWindowBlur` / `showDialog` 为 boolean，`voiceEndMode` 为 string，其余为 number）。需要强类型时用 `To Float` / `To Boolean` 转换后再接入 `Set Slider Value` 等节点
- `previousValue` - 变化前运行时缓存的旧值，类型同 `value`；本次会话首次订阅后没有更早快照时为 `null`

## On Any Preference Changed

`blueprint.event.head.anyPreferenceChanged` - 任意 Game Preference 变化事件

当当前活动 NarraLeaf `LiveGame` 的任意 Game Preference 字段变化时触发，底层订阅 NarraLeaf React `game.preference.onPreferenceChange(listener)`（对应 `event:game.preference.change`）。该节点出现在 Global 蓝图和 Surface 蓝图中，派发范围与顺序同 `On Preference Changed`；用于集中处理设置变更，例如统一持久化当前设置或一次性刷新整个设置面板。

没有活动 game runtime 时不会订阅，也不会触发；`On Game Ready` 之后在新的 `LiveGame` 上重新订阅。触发与去重语义、以及 `previousValue` 缓存方式与 `On Preference Changed` 一致。

- `then` - 执行出口
- `key` - 发生变化的 Game Preference 键，`string`，取值为规范键名（如 `bgmVolume`）
- `value` - 变化后的新值，通用 `json`，实际类型由 `key` 决定
- `previousValue` - 变化前运行时缓存的旧值，类型同 `value`；没有更早快照时为 `null`

## On Fullscreen Changed

`blueprint.event.head.fullscreenChanged` - 窗口全屏状态变化事件

游戏窗口进入或退出全屏时触发，不论是谁切换的（`Set Fullscreen` 节点、快捷键，还是游戏之外的操作）：消息来自主进程的窗口本身。出现在 Global 蓝图、Surface 蓝图和控件私有蓝图中。派发顺序同 `On Preference Changed`：Global，然后每个正在显示的 Surface；每个 Surface 的蓝图执行完之后，再派发给该 Surface 上放了这个事件 Head 的控件。
- `then` - 执行出口
- `isFullscreen` - 变化后是否全屏，`boolean`

## On Window Focus Changed

`blueprint.event.head.windowFocusChanged` - 窗口焦点变化事件

玩家切到别的窗口、或切回游戏时触发。桌面版听的是游戏窗口本身，所以被游戏看不见的东西推到后面时也会触发；网页导出听的是页面自己的可见性与焦点。它和控件的 `Focus` / `Blur` 不是一回事：那两个说的是页面上哪个控件持有键盘，窗口好好地在前台时也会触发。出现位置与派发顺序同 `On Fullscreen Changed`。
- `then` - 执行出口
- `isFocused` - 变化后窗口是否在前台，`boolean`

## On Window Close Requested

`blueprint.event.head.windowCloseRequested` - 窗口关闭请求事件

玩家点关闭按钮或按 Alt+F4 时触发。主进程先把关闭挂起，等这次派发跑完：没有人取消就关窗，执行了 App 分类的 `Keep Window Open` 就把窗口留住（见 `node.page.md`）。Dev Mode 里它管的是 Dev Mode 窗口，预览与打包游戏里管的是游戏窗口。只出现在 Global 蓝图和 Surface 蓝图中，控件私有蓝图里没有它。派发顺序同 `On Preference Changed`，自上而下：某个界面执行了 `Keep Window Open` 之后，它下面的界面不再收到这次请求。
- `then` - 执行出口

## On Action

`blueprint.event.head.action` - 项目声明的输入操作被触发事件

面板级手势的落点。什么东西触发它不写在节点上：项目给手势起名字并给出默认绑定，Surface 说自己回答哪几个、以及回答之后输入是否到此为止，运行时按名字把操作抛给蓝图。指针下有可操作控件（按钮、开关、滑块、文本框、列表，以及开了原生控制条的视频）时，这次输入归控件，操作不触发，也没有设置可以改；唯一的例外是滚动：可滚动的控件已经滚到头、朝这个方向再也走不动时，滚动手势才交给操作。作者把「推进」从单击改成空格，改的是词表里的一行。

出现在 Global 蓝图和 Surface 蓝图中。控件私有蓝图里没有它——控件想要原始手势，用自己的 `Mouse Click` 等事件头；「在这个控件上点一下等于推进」正是这套词表要替换掉的写法。

两处的触发范围不同：

- **Surface 蓝图**只收到该 Surface 在输入区里响应的那些操作。按键归当前持有键盘的条目（活动页面，或压在它上面的模态层）；指针手势归落点所在的那一条 lane。
- **Global 蓝图**收到词表里的**全部**操作，不需要在任何地方开启：按键在游戏收得到按键的任何时候（与 Global 的 `On Key Down` 同一道门——文本框持有焦点时不触发，事件已被停止传播时不触发），不论持有键盘的是页面还是模态层；指针手势在它落到的第一条 lane 上，没有落在任何 lane 上（页面空白处会穿透到舞台，舞台上可能什么都没有）时由游戏的绘制根接住；每次物理输入只触发一次，落在可操作控件上（含运行时插件画的浮层）时与 Surface 同样让位。
- **Global 先于界面**。同一次输入，Global 的图执行完之后，持有键盘的条目（或指针落到的 lane）才开始响应；两边都响应同一个操作时两边都会执行。Global 没有「拦截冒泡」选项——那是 Surface 对身后 lane 的回答；Global 的处理器要让界面听不到这次输入，只能停止传播（脚本里的 `ctx.stopPropagation()`），与 Global 按键事件头相同。
- Global 响应过的滚动手势与触屏手势视为已被消耗：惯性尾巴与抬指后合成的那次点击不再触发任何东西。

一次派发携带整个词表，具体由卡片上的 `Action` 过滤。没有通配写法：`Action` 留空的卡片什么都不监听，和未配置的 `On Preference Changed` 一样。

卡片字段：
- `Action` - 要监听的输入操作（Inspector 参数），下拉从当前项目的操作词表填充。存的是操作 id，所以改名不会让图失去目标

输出：
- `then` - 执行出口
- `source` - 触发这次操作的输入族，`string`，取值 `pointer` / `key` / `gamepad` / `touch`
- `x` / `y` - 手势落点，`float`，与鼠标事件头同一套 Surface 设计坐标。鼠标与触屏的绑定都有落点，键盘和手柄绑定没有，此时不要读这两个引脚。判据是 `source` 为 `key` 或 `gamepad`，不是「是不是 `pointer`」

## On Call

`blueprint.event.head.onCall` - 故事行调用事件

只出现在故事行的蓝图（`storyAction` owner）中，是这种蓝图唯一的事件 Head。故事走到这一行时执行：

- **动作行**：故事等这张图执行完（包括其中的异步节点）才走下一行；玩家回退越过这一行、或在它执行期间读档，会中止这次执行。图里出错只记日志，故事照常继续。在等待期间存的档读回来会把这一行重新执行一遍。
- **行内取值与条件**：在显示文字或判断分支的那一刻同步求值，用 `Return Value` 交回结果；这两种蓝图里不能放异步节点。

行的蓝图里，`Var` 每次执行都从声明的默认值开始，不跨执行保留——要跨行、跨存档记住的值用 Scene Var 或 Saved Var。项目蓝图（Global）的 `Var` 读写的是界面也在用的同一份运行时值。
- `then` - 执行出口

