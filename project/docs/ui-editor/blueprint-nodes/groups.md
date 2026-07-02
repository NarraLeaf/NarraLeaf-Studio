# 通用节点组

节点组指的是一组节点，当节点组被添加到某个元素的许可列表中时，该元素拥有节点组内所有的节点。节点分类是节点在图形界面中显示的操作类型。

除了被授予的节点组和元素拥有的特殊节点，元素不具有其他任何节点。

所有元素都具有 Common 节点组、Flow 节点组、Data 节点组、Math 节点组和 Debug 节点组。JSON 与 String 节点归入 Data；Boolean 与 Compare 节点归入 Math。

## Common

Common 节点组默认具有：
- `blueprint.event.head.init` - 元素初始化事件；在 Blueprint Value 中也作为初始求值事件

## Blueprint Value

Blueprint Value 节点组只存在于 `widgetValue` 私有蓝图。当前用于 `nl.text` 的 `props.text`、`nl.button` 的 `props.label`、Page 组件 `nl.frame` 的 `props.params` 和 `nl.slider` 的 `props.value` 动态值。

Blueprint Value 可用节点包括：
- `blueprint.event.head.init` - 初始求值事件
- `blueprint.event.head.flush` - 属性刷新求值事件；默认 Dialog Nametag 的普通事件图使用该入口，以支持 Dialog 不重新挂载时随对话推进更新
- `blueprint.data.returnValue` - 返回当前属性值的无尾执行节点
- `blueprint.element.ref` - Same-Surface 元素字面量引用
- Element-targeted Text / Displayable / Slider / List / Widget Property 纯读取节点 - 读取绑定元素属性并记录隐藏刷新依赖

`nl.slider.props.value` 使用 `float` Blueprint Value，返回值表示映射后的值而不是 0-1 normalized 值；运行时会按该 Slider 的 `min` / `max` / `step` clamp 和 snap。

Blueprint Value 只允许安全的数据生产节点：`Init` / `On Flush` Head、安全的非 latent Flow、图内注释、纯 Data / Math、本地变量读写、Element Literal，以及纯读取型 Text / Displayable / Slider / List / Widget Property / Page / Game 节点。Page 纯读取节点包括 `Get Page Props`、`Is Surface Exiting` 与 `Is Surface Entering`；Game 纯读取节点包括 `Get Nametag`、`Is In Game` 与 `Is Game Overlay`。当前核心目录不提供 global state 读写或可变 surface state 读写节点；Blueprint Value 也不允许 `Var` 声明、Widget 改写、Navigation、Persistent 变量读写、Broadcast、latent 节点、`Skip Delay` 这类运行时跳过节点和 TypeScript revision。

## Self 与 Element 方法节点

内建控件方法分为两套节点形态：
- Self 节点作用于当前私有蓝图所属控件，不带 Element/ref 输入，只在对应控件自己的 `widgetMain` 蓝图中出现，并通过 `executionOwner.elementId` 操作自己。
- Element 节点作用于显式连入的 Element 引用，带 typed Element 输入，例如 `element:nl.button`、`element:nl.slider`。它们显示在 `Element` 分类下，包括 `blueprint.element.displayable.*` 这类 Displayable 派生节点。
- Element 节点只有在当前图里已经存在兼容的 `Element`、`Element Flush` 或 `Element Click` 绑定节点时才显示。同一节点类型在创建浮窗中去重为唯一项；若兼容来源唯一，添加时会自动连接到该来源的目标输入，若有多个兼容来源则保留目标输入由作者选择。
- 写入节点通过 Host API 修改运行时或元素属性。值确实发生变化并导致重绘时会排队触发 flush；读取节点、CSS 自动样式和滚动请求不触发 flush。

## Variables

Variables 节点组用于声明和读写当前蓝图可访问的本地变量，以及读写项目级 Persistent 变量。除 Blueprint Value (`widgetValue`) 之外，所有蓝图 owner 都使用图内 `Var` 节点声明 blueprint-level 生命周期变量；这些变量随对应蓝图 owner/runtime scope 存活，并在多条事件链之间复用，直到该 owner 实例被释放或重新挂载。Blueprint Value 不能声明 `Var`，但可通过 `Get Var` / `Set Var` 读写可访问的 Page/Blueprint/Global 变量。旧版 `members.variables` 中的 blueprint-level 变量不会显示在成员栏中，但仍作为兼容 fallback 供 `Get Var` / `Set Var` 选择和运行。

`Get Var` / `Set Var` 的 `value` 引脚类型由当前选择的变量推断，节点卡、连接预览和 graph validation 使用同一份推断结果。变量类型改变后如果已有连线不再兼容，编辑器保留连线并上报类型不匹配诊断，不自动删除 edge。

Persistent 变量定义保存在 Blueprint 文档中，运行时值由 Host 管理并按项目隔离。当前核心目录包含：
- `blueprint.local.declareVar` - `Var`，无引脚变量声明节点，卡片上编辑名称、类型和默认值
- `blueprint.local.get` - 读取变量
- `blueprint.local.set` - 写入变量
- `blueprint.persistent.get` - 异步读取 Persistent 变量；缺失已保存值时返回 authored default
- `blueprint.persistent.set` - 异步写入 Persistent 变量

## Flow

Flow 节点组用于控制执行线路。所有支持蓝图的元素、Surface 蓝图和全局蓝图都可以使用 Flow 节点组。

Flow 节点组默认具有：
- `if` - 根据布尔条件选择 True 或 False 执行出口
- `blueprint.flow.ifElse` - 按顺序判断一个或多个 If 条件，匹配时进入对应 Then，否则进入 Else 兜底出口
- `blueprint.flow.noop` - 空操作
- `blueprint.flow.sequence` - 按顺序排队执行 Then 1 到 Then 4 出口
- `blueprint.flow.switchString` - 字符串分流，可追加 Case
- `blueprint.flow.forLoop` - 有界整数循环
- `blueprint.flow.forEach` - 遍历 JSON 数组
- `blueprint.flow.while` - 条件循环
- `blueprint.flow.delay` - 延迟执行 latent 节点，并输出 `Timer` token
- `blueprint.flow.skipDelay` - 传入 Delay 的 `Timer` token，提前完成 pending Delay
- `blueprint.flow.return` - 提前结束当前执行链

## Debug

Debug 节点组用于调试输出和图内说明。所有支持蓝图的元素都可以使用 Debug 节点组；其中 `blueprint.log` 只用于 `event` 和 `macro` 图，图内注释可以用于 `event`、`function` 和 `macro` 图。

Debug 节点组默认具有：
- `blueprint.flow.comment` - 可调整大小、颜色、背景和多行说明的图内注释框；关闭背景后位于其它节点底层，不参与执行链
- `blueprint.log` - 输出调试日志并继续执行

## Element

Element 节点组用于显式引用当前 Surface 内的控件，并放置所有带 Element/ref 输入的派生节点。

Element 节点组默认具有：
- `blueprint.element.ref` - Same-Surface 元素字面量引用，输出 `element` 或 typed `element:<widgetType>`
- `blueprint.element.continueEventBubble` - 在当前 Widget 事件图中把当前事件继续派发给结构父元素，并从 `next` 继续执行
- `blueprint.element.stopEventBubble` - 标记当前事件已处理，阻止后续父级冒泡或键盘事件继续传到背景层，并从 `next` 继续执行
- `blueprint.event.head.elementFlush` - 绑定目标控件并监听该控件的 flush 事件
- `blueprint.event.head.elementClick` - 绑定目标控件并监听该控件的 click 事件
- `blueprint.element.text.*` - Text Element 读写节点
- `blueprint.element.displayable.getDisplay` / `blueprint.element.displayable.setDisplay` - `Get Element Display` / `Set Element Display`，读写显式 Element 引用的运行时 `display` 状态
- `blueprint.element.displayable.*` - Displayable Element `Get Property` / `Set Property`、Variant、属性动画和按 `AnimationToken` 停止动画节点
- `blueprint.element.slider.*` - Slider Element 读写节点
- `blueprint.element.list.*` - List Element 读写节点
- `blueprint.element.<widget>.*` - Button / Container / Image / Frame 等 Widget Property Element 节点

Element 派生节点不会按每个绑定控件复制菜单项；每个节点类型在创建浮窗中只出现一次。是否显示由当前图内是否存在兼容 Element 引用决定，目标引用必须由用户手动连线。

`blueprint.element.frame.setTargetPage` 是 Frame Element 形态，显示为 `Set Frame Page`，并和其他派生节点一样显示在 `Element` 分类中；它的 `Page props` 可选输入会作为目标 Frame 的 `params` 传给被嵌入 Page。

## Displayable

Displayable 节点组默认具有：
- `blueprint.event.head.mouseClick`
- `blueprint.event.head.beforeSurfaceExit`
- `blueprint.event.head.afterSurfaceEnter`
- `blueprint.event.head.unmount`
- `blueprint.event.head.mouseDoubleClick`
- `blueprint.event.head.mouseEnter`
- `blueprint.event.head.mouseLeave`
- `blueprint.event.head.mouseMove`
- `blueprint.event.head.mouseUp`
- `blueprint.event.head.mouseDown`
- `blueprint.event.head.mouseWheel`
- `blueprint.event.head.rightClick`
- `blueprint.event.head.keyDown`
- `blueprint.event.head.keyUp`
- `blueprint.event.head.anyKeyDown`
- `blueprint.event.head.anyKeyUp`
- `blueprint.event.head.focus`
- `blueprint.event.head.blur`
- `blueprint.displayable.getDisplay` - 读取当前运行时 `display` 状态，返回 boolean
- `blueprint.displayable.setDisplay` - 设置当前运行时 `display` 状态；为 `false` 时元素以 CSS `display: none` 隐藏但保持挂载
- `blueprint.displayable.getProperty` - 使用卡片下拉读取 `position` / `size` / `bounds` / `x` / `y` / `offsetX` / `offsetY` / `width` / `height` / `rotation` / `opacity` / `visible`
- `blueprint.displayable.setProperty` - 使用卡片下拉设置 `x` / `y` / `offsetX` / `offsetY` / `width` / `height` / `rotation` / `opacity` / `visible`；`opacity` 按百分比输入；`value` pin 接线时卡片 Value 控件禁用
- `blueprint.displayable.setVariant` - 通过目标元素已有 Variants 的下拉设置 Appearance Variant，并可选择是否等待 Variant transition；没有 Variant id 输入 pin，目标不支持 Variant 时执行提交错误
- `blueprint.displayable.animateProperty` - 使用卡片下拉选择 `opacity` / `offsetX` / `offsetY` / `x` / `y` / `scale` / `rotation` 并填写 From / To / Duration / Delay / Easing / After；`opacity` 的 From / To 按百分比输入，Duration / Delay 按秒输入；输出当前动画的 `AnimationToken`
- `blueprint.displayable.stopAnimation` - 传入 `AnimationToken`，停止/跳过该 token 对应的 runtime animation；非动画 token 静默 no-op

旧的固定读取节点 `getPosition` / `getSize` / `getBounds` / `getRotation` / `getOpacity` / `getVisible` / `getVariant` 仍兼容旧图，但在创建浮窗中隐藏。Displayable Self 节点操作当前控件自己，显示在 `Displayable` 分类中，且没有 Element 输入。Element-targeted Displayable 派生节点使用 `blueprint.element.displayable.*`，大多数带 generic `element` 输入，显示在 `Element` 分类中，并在当前图内存在兼容 Same-Surface Element 引用时出现；`Stop Element Animation` 只接收 `AnimationToken`，不带 Element 输入。同一节点类型只显示一项；若兼容来源唯一，放置时会自动连接对应目标的 `element` 输入，若有多个兼容来源则需要手动选择/连接目标。

Self `Set Variant` 只在当前控件支持 Appearance Variant 时出现，并默认绑定当前控件。`Get Display` / `Set Display`、`Set Property` / `Animate Property` 同时提供 Self 与 Element 派生版；`Stop Animation` / `Stop Element Animation` 都只接收 `AnimationToken`，不再按目标元素清除全部动画。

`display` 是运行时渲染开关，默认 `true`。`Set Display false` 会让元素在 SurfaceElementTree 中保持挂载，并通过 CSS `display: none` 隐藏元素和子树；`visible` 仍是 authored layout/运行时可见性属性，保留给旧的 Visible 语义和通用属性读写。

透明度只有一套有效 Displayable `opacity`。Appearance Variant 的 `transformOpacity` 会投影到同一个元素透明度；`nl.image` Variant 中相对 Default 实际改动过的 `fillOpacity` 也会投影到这套值，并且不会再写到内部 `<img>` 的 opacity。`nl.image` 的非 Default Variant 不覆盖 Default 的 `imageFill` / crop / contain 模式。`Set Property` / `Animate Property` 操作的也是这套值。`Set Variant` 会清理旧的 runtime opacity override，让 Variant 自己决定透明度；`Animate Property` 的 opacity 在 `hold` 模式下会把最终值写回运行时 patch，因此透明 Variant 后接淡入动画可以稳定停在最终透明度。

## Widget Property

Widget Property 节点用于运行时读写内建控件的通用属性和控件特有属性。

所有内建控件的 Self 版都提供：
- `blueprint.<widget>.getVisible` / `setVisible`
- `blueprint.<widget>.getEnabled` / `setEnabled`

Element 版使用 `blueprint.element.<widget>.*`，带 typed Element 输入，统一显示在 `Element` 分类中，并只在当前图里存在兼容 Element 引用时出现。`Set Enabled(false)` 会映射到底层禁用交互机制，用户侧不暴露 `interactionDisabled`。

控件特有方法包括：
- `nl.button`：`getLabel` / `setLabel`、`setPointer`；`Set Pointer` 在卡片上用带鼠标图标的 Pointer 下拉选择 `auto`、`default`、`pointer` 等按钮指针形态；旧版 `getVariant` / `setVariant` 仅兼容旧图并隐藏，新图使用 Displayable `Set Variant` 下拉
- `nl.container`：`getClipContent` / `setClipContent`；旧版 `getVariant` / `setVariant` 仅兼容旧图并隐藏，新图使用 Displayable `Set Variant` 下拉
- `nl.image`：`getImageAsset` / `setImageAsset` / `clearImageAsset`、`getFitMode` / `setFitMode`、`getCropRect` / `setCropRect`、`getFlipX` / `setFlipX`、`getFlipY` / `setFlipY`
- `nl.frame`：`getTargetPage` / `setTargetPage`（`Set Frame Page` 可选写入 Page props）、`getParams` / `setParams`

Page 导航、状态与通信节点 `blueprint.page.go`、`blueprint.page.getProps`、`blueprint.page.isSurfaceExiting`、`blueprint.page.isSurfaceEntering`、`blueprint.frame.emit` 仍属于 Page 节点组；`blueprint.frameWidget.setTargetPage` / `blueprint.element.frame.setTargetPage` 属于 Frame Widget Property，即使它们带有 `Page props` 输入。旧图中的 `blueprint.frame.getParam` 仍兼容执行，但新增节点面板不再显示。

## Page

Page 节点组用于切换 Page，以及在 Page 组件和被 Page 组件嵌入的子 Page 之间传递 props 与事件。`nl.frame` 元素拥有 Page Event；被 Page 组件嵌入的子 Page 可以通过 Host API 读取 props 并向父级 Page 组件发出事件。

Page 节点组默认具有：
- `blueprint.event.head.pageEvent` - Page 组件收到子 Page 事件
- `blueprint.event.head.keyDown` - Page 组件实例收到运行时窗口指定键按下事件
- `blueprint.event.head.keyUp` - Page 组件实例收到运行时窗口指定键抬起事件
- `blueprint.event.head.anyKeyDown` - Page 组件实例收到运行时窗口任意键按下事件
- `blueprint.event.head.anyKeyUp` - Page 组件实例收到运行时窗口任意键抬起事件
- `blueprint.page.go` - 切换到指定 Page，可选传入 Page props；选择 `None` 时清除当前顶层 Page 叠层（尾节点，无执行出口）
- `blueprint.page.getProps` - 读取当前 Page props；可用于 Blueprint Value；Global 蓝图不可用
- `blueprint.page.isSurfaceExiting` - 读取当前 Surface 是否处于退出动画状态；可用于 Blueprint Value；Global 蓝图不可用
- `blueprint.page.isSurfaceEntering` - 读取当前 Surface 是否处于进入动画状态；可用于 Blueprint Value；Global 蓝图不可用
- `blueprint.page.quit` - 退出当前应用运行时；Studio Dev Mode 中停止 Dev Mode 会话（尾节点，无执行出口）
- `blueprint.frame.emit` - 向父级 Page 组件发送事件

## Game

Game 节点组用于控制当前 NarraLeaf 游戏运行时、Dialog 推进，以及访问当前 Studio 项目隔离的本地普通存档。Game 节点通过 Host API 执行；`Get Nametag`、`Is In Game` 与 `Is Game Overlay` 为 pure 读取节点，可用于 Blueprint Value；执行节点均为异步 latent 节点，只用于 `event` 和 `macro` 图。进入游戏状态后当前普通 Page 栈会作为底层隐藏；此时继续调用 `Go Page` 会把目标 Page 叠加在游戏舞台上，选择 `None` 会关闭顶层 Page 叠层并露出游戏舞台。要退出游戏并返回普通 Page，使用 `Quit Game` 的 Page 下拉选择返回目标。

Game 节点组默认具有：
- `blueprint.game.startStory` - 启动指定 Story / Scene（尾节点，无执行出口）
- `blueprint.game.getNametag` - 读取当前 Dialog 说话人名字；没有说话人时返回 `null`；pure 节点，可用于 Blueprint Value
- `blueprint.game.isInGame` - 读取当前是否处于 NarraLeaf 游戏状态；pure 节点，可用于 Blueprint Value
- `blueprint.game.isGameOverlay` - 读取当前 Page / Game UI Surface 是否以游戏上方 UI 叠层身份运行；pure 节点，可用于 Blueprint Value
- `blueprint.game.quit` - 退出当前 NarraLeaf 游戏状态并打开指定返回 Page（尾节点，无执行出口）
- `blueprint.game.next` - 触发当前 NarraLeaf live game 的 virtual click 路径；默认 Dialog 模板在 Dialog Content 蓝图中用 Content 点击、绑定 Interaction Layer / Panel / 子控件的 Element Click 和 Space `keyUp` 调用
- `blueprint.game.skip` - 调用 NarraLeaf `LiveGame.skipDialog()` 跳过当前 dialog
- `blueprint.game.showDialog` / `blueprint.game.hideDialog` / `blueprint.game.toggleDialogDisplay` - 通过 NarraLeaf React `showDialog` preference 显示、隐藏或切换 Dialog 显示状态
- `blueprint.game.setSentenceSpeed` - 通过 NarraLeaf Preference API 写入 `cps` preference key
- `blueprint.game.save.write` - 保存当前 live game；`id` 为可 inline literal 的 `string` 输入，同 id 覆盖旧存档；`metadata` 为可选蓝图通用 `json` 输入；可选 `Capture` boolean 输入为 `true` 时写入 PNG 预览截图
- `blueprint.game.save.load` - 读取存档并放弃当前游戏进度（尾节点，无执行出口）
- `blueprint.game.save.delete` - 删除指定项目本地普通存档；存档不存在时也继续执行
- `blueprint.game.save.listIds` - 列出当前项目本地普通存档 id，输出契约为 `Array<String>` / `string[]`，顺序不保证稳定
- `blueprint.game.save.getMetadata` - 读取存档用户 metadata，输出蓝图通用 `json`
- `blueprint.game.save.getPreview` - 读取存档预览图，输出 `ImageAsset|null`；预览图为当前 Dev Mode 会话内临时图片，不导入项目资源

Dialog 推进、Dialog 显示切换、速度设置、退出游戏、写入存档和载入存档依赖当前 Dev Mode 中存在活动 NarraLeaf live game 或游戏状态；缺失 runtime、缺失存档或损坏存档会作为蓝图执行错误抛出。`List Saves`、`Get Save Metadata`、`Get Save Preview` 和 `Delete Save` 只依赖项目存档命名空间；`Delete Save` 对缺失目标保持幂等完成。

## Global

只有全局蓝图具有 Global 节点组。

Global 节点组默认具有：
- `blueprint.event.head.appBoot` - 应用启动事件（仅全局蓝图具有）
- `blueprint.event.head.keyDown` - 运行时窗口指定键按下事件
- `blueprint.event.head.keyUp` - 运行时窗口指定键抬起事件
- `blueprint.event.head.anyKeyDown` - 运行时窗口任意键按下事件
- `blueprint.event.head.anyKeyUp` - 运行时窗口任意键抬起事件

## Surface

只有Surface蓝图（包括Game UI和Page）具有Surface节点组。

Surface 节点组默认具有：
- `blueprint.event.head.surfaceInit` - 当前 Surface 初始化事件（仅Surface蓝图具有）
- `blueprint.event.head.surfaceUnmount` - 当前 Surface 卸载事件（仅Surface蓝图具有）
- `blueprint.event.head.beforeSurfaceExit` - 当前 Surface 退出动画开始前事件
- `blueprint.event.head.afterSurfaceEnter` - 当前 Surface 进入动画结束后事件
- `blueprint.event.head.mouseClick` - 当前 Surface 内任意鼠标点击事件，输出 Surface 设计坐标 `x` / `y`
- `blueprint.event.head.rightClick` - 当前 Surface 内任意鼠标右键点击事件，输出 Surface 设计坐标 `x` / `y`
- `blueprint.event.head.keyDown` - 当前 active Surface 收到运行时窗口指定键按下事件
- `blueprint.event.head.keyUp` - 当前 active Surface 收到运行时窗口指定键抬起事件
- `blueprint.event.head.anyKeyDown` - 当前 active Surface 收到运行时窗口任意键按下事件
- `blueprint.event.head.anyKeyUp` - 当前 active Surface 收到运行时窗口任意键抬起事件
- Broadcast 节点组

## List

List 节点组用于 `nl.list` 的运行时内容、选中项、滚动和条目上下文。Array / JSON / Object 处理不放入 List，统一放在 Data 分类。

List Self 节点只在 `nl.list` 自己的私有蓝图中出现，创建浮窗中归入 `List` 分类，且没有 `list` 输入。List Element 节点使用 `blueprint.element.list.*`，带 `element:nl.list` 输入，归入 `Element` 分类；当前图中没有绑定到 `nl.list` 的 Element、Element Flush 或 Element Click 时不会显示。List item context 读取节点只在 item template 后代元素蓝图中出现。

List 节点组默认具有：
- `blueprint.event.head.scroll` - 列表滚动事件
- `blueprint.event.head.scrollEnd` - 列表滚动到末端事件
- `blueprint.event.head.itemRender` - 列表条目渲染事件
- `blueprint.event.head.itemClick` - 列表条目点击事件
- `blueprint.event.head.itemHover` - 列表条目悬停事件
- `blueprint.event.head.selectionChanged` - 列表选中项变化事件
- `blueprint.event.head.keyDown` - List 组件实例收到运行时窗口指定键按下事件
- `blueprint.event.head.keyUp` - List 组件实例收到运行时窗口指定键抬起事件
- `blueprint.event.head.anyKeyDown` - List 组件实例收到运行时窗口任意键按下事件
- `blueprint.event.head.anyKeyUp` - List 组件实例收到运行时窗口任意键抬起事件

- `blueprint.event.head.listItemRefresh` - List item template 后代元素接收条目上下文刷新事件
- `blueprint.list.setItems` / `blueprint.list.getItems` / `blueprint.list.clear` - 读写运行时内容
- `blueprint.list.appendItem` / `blueprint.list.insertItem` / `blueprint.list.removeItem` / `blueprint.list.removeItemAt` - 改写运行时内容
- `blueprint.list.getSelectedItem` / `blueprint.list.setSelectedItem` / `blueprint.list.getSelectedIndex` / `blueprint.list.setSelectedIndex` - 读写运行时选中项
- `blueprint.list.refreshItems` / `blueprint.list.scrollToIndex` / `blueprint.list.scrollToTop` / `blueprint.list.scrollToBottom` - 刷新与滚动控制
- `blueprint.list.getItemProps` / `blueprint.list.getItemIndex` / `blueprint.list.getItemCount` / `blueprint.list.getItemKey` - 读取当前条目上下文

Element 版对应稳定 ID 使用 `blueprint.element.list.*`，方法目录与 Self 版一致。滚动请求类节点不触发 flush；内容和选中项发生变化时触发 flush。

## Slider

Slider 节点组用于读取和改写 `nl.slider` 的运行时映射值与范围。`props.value`、Blueprint Value、事件 payload 和 `Get Value` / Set Value 节点都表示映射后的值；0-1 normalized 值只通过专用读节点取得。

Slider Self 节点只在 `nl.slider` 自己的私有蓝图中出现，创建浮窗中归入 `Slider` 分类，且没有 `slider` 输入。Slider Element 节点使用 `blueprint.element.slider.*`，带 `element:nl.slider` 输入，归入 `Element` 分类；当前图中没有绑定到 `nl.slider` 的 Element、Element Flush 或 Element Click 时不会显示。

Slider 节点组默认具有：
- `blueprint.event.head.sliderDragStart` - 滑块拖拽开始事件，输出映射值 `value`
- `blueprint.event.head.sliderValueChanged` - 滑块值变化事件，输出映射值 `value` 和 `previousValue`
- `blueprint.event.head.sliderDragEnd` - 滑块拖拽结束事件，输出映射值 `value`
- `blueprint.event.head.keyDown` - Slider 组件实例收到运行时窗口指定键按下事件
- `blueprint.event.head.keyUp` - Slider 组件实例收到运行时窗口指定键抬起事件
- `blueprint.event.head.anyKeyDown` - Slider 组件实例收到运行时窗口任意键按下事件
- `blueprint.event.head.anyKeyUp` - Slider 组件实例收到运行时窗口任意键抬起事件
- `blueprint.slider.getValue` / `Get Value` - 获取映射值
- `blueprint.slider.getNormalizedValue` - 获取 0-1 normalized 值
- `blueprint.slider.getRange` - 获取 `min`、`max`、`step`
- `blueprint.slider.setValue` - 设置映射值，并按范围和步进规范化
- `blueprint.slider.setRange` - 设置 `min`、`max`、`step`，并重新规范化当前运行时值

Element 版对应稳定 ID 使用 `blueprint.element.slider.*`，方法目录与 Self 版一致。`Set Slider Value` 与 `Set Slider Range` 只更新运行时状态，不自动派发 Slider 事件，也不写回 UIDocument；值变化会触发 flush。

## Image

Image 节点组用于读取和改写 `nl.image` 的界面图片资源、填充模式、裁剪区域和翻转状态。它面向应用界面控件，不处理舞台表演图片、角色立绘或剧情演出资源。

Image Self 节点只在 `nl.image` 自己的私有蓝图中出现，创建浮窗中归入 `Image` 分类，且没有 `image` 输入。Image Element 节点使用 `blueprint.element.image.*`，带 `element:nl.image` 输入，归入 `Element` 分类；当前图中没有绑定到 `nl.image` 的 Element、Element Flush 或 Element Click 时不会显示。

Image 节点组默认具有：
- `blueprint.image.assetLiteral` - 图片资产字面量卡片，输出 `ImageAsset`
- `blueprint.image.getImageAsset` - 获取当前图片资源，输出 `ImageAsset|null`
- `blueprint.image.setImageAsset` - 设置图片资源，输入 `ImageAsset|null`；未接线时可在节点卡片上展开图片选择器
- `blueprint.image.clearImageAsset` - 清除图片资源
- `blueprint.image.getFitMode` / `blueprint.image.setFitMode` - 读取或设置 `imageFill.mode`
- `blueprint.image.getCropRect` / `blueprint.image.setCropRect` - 读取或设置裁剪百分比区域；设置时切换为 `crop`
- `blueprint.image.getFlipX` / `blueprint.image.setFlipX` - 读取或设置水平翻转
- `blueprint.image.getFlipY` / `blueprint.image.setFlipY` - 读取或设置垂直翻转

Element 版对应稳定 ID 使用 `blueprint.element.image.*`，方法目录与 Self 版一致，并通过 `element:nl.image` 输入接收 Element Ref。Image 写节点更新 `imageFill` / `imageFlipX` / `imageFlipY` 并触发 flush。旧图中字符串 `assetId` 连线仍可执行，但新 UI 推荐使用 `ImageAsset`。

## Broadcast

Broadcast 节点组用于在页面和元素之间发送、接收广播事件。Surface 蓝图和所有支持蓝图的元素都可以使用 Broadcast 节点组。

Broadcast 节点组默认具有：
- `blueprint.event.head.onAnyBroadcast` - 任意事件广播事件
- `blueprint.event.head.onBroadcast` - 事件广播事件
- `blueprint.broadcast.send` - 发送广播事件
- `blueprint.broadcast.getListenerCount` - 获取注册的监听器数量

## Network

Network 节点组用于访问远程数据、在线配置、Web API、补丁公告和云存档等专业视觉小说游戏引擎运行时能力。具备项目网络权限的全局蓝图、Surface 蓝图和支持蓝图的元素可以使用 Network 节点组。

Network 节点组默认具有以下 vNext 规划节点。Network 节点不表示已经注册到当前运行时 catalog，并且必须通过 Host API 与项目权限控制访问网络：
- `blueprint.network.fetch` - 发送 HTTP 请求（vNext）

## Data

Data 节点组用于创建常量值、进行显式类型转换、处理字符串和读写结构化 JSON。所有支持蓝图的元素都可以使用 Data 节点组。

Data 节点组默认具有：
- `blueprint.data.stringLiteral` - String 常量
- `blueprint.data.integerLiteral` - 整数常量
- `blueprint.data.floatLiteral` - 浮点数常量
- `blueprint.data.numberLiteral` - 旧版 Number 常量；保留兼容旧图，新建时隐藏
- `blueprint.data.booleanLiteral` - 布尔常量
- `blueprint.data.nullLiteral` - Null 常量
- `blueprint.data.colorLiteral` - 颜色常量，输出 `RGBAColor`
- `blueprint.data.rectLiteral` - 矩形常量，使用固定 `x` / `y` / `width` / `height` 数值 schema
- `blueprint.data.returnValue` - 返回 Blueprint Value 的值（仅 Blueprint Value 具有）
- `blueprint.data.toFloat` - 转换为 Float
- `blueprint.data.toInteger` - 转换为 Integer
- `blueprint.data.toBoolean` - 转换为 Boolean
- `blueprint.data.parseInt` - 从字符串解析 Integer
- `blueprint.data.parseFloat` - 从字符串解析 Float
- `blueprint.data.isString` - 判断值是否为字符串
- `blueprint.data.isNumber` - 判断值是否为数字
- `blueprint.data.isBoolean` - 判断值是否为布尔值
- `blueprint.data.isArray` - 判断值是否为数组
- `blueprint.data.isObject` - 判断值是否为对象
- `blueprint.data.isNull` - 判断值是否为 null
- `blueprint.data.notNull` - 判断值是否不是 null
- `blueprint.data.isEmptyValue` - 判断值是否为空字符串、空数组、空对象或 null
- `blueprint.data.jsonLiteral` - JSON 常量
- `blueprint.data.toJson` - 显式转换为 JSON
- `blueprint.data.parseJson` - 从字符串解析 JSON
- `blueprint.data.stringifyJson` - 将 JSON 转换为字符串
- `blueprint.data.jsonGet` - 使用点路径读取 JSON 字段
- `blueprint.data.jsonHas` - 判断 JSON 字段路径是否存在
- `blueprint.data.jsonSet` - 使用点路径写入 JSON 字段并输出新 JSON
- `blueprint.data.jsonRemove` - 使用点路径移除 JSON 字段并输出新 JSON
- `blueprint.data.jsonMakeObject` - 由动态 `Name` / `Value` 输入对创建 JSON Object
- `blueprint.data.jsonMakeArray` - 由顺序输入创建 JSON Array
- `blueprint.data.jsonArrayLength` - 获取 JSON Array 长度
- `blueprint.data.jsonMergeObject` - 合并两个 JSON Object
- `blueprint.data.jsonClone` - 深拷贝 JSON 值
- `blueprint.string.toString` - 转换为字符串
- `blueprint.string.concat` - 拼接字符串
- `blueprint.string.format` - 格式化字符串
- `blueprint.string.length` - 获取字符串长度
- `blueprint.string.isEmpty` - 判断字符串是否为空
- `blueprint.string.isBlank` - 判断字符串是否为空白
- `blueprint.string.trim` - 移除两端空白
- `blueprint.string.trimStart` - 移除开头空白
- `blueprint.string.trimEnd` - 移除结尾空白
- `blueprint.string.toUpperCase` - 转换为大写
- `blueprint.string.toLowerCase` - 转换为小写
- `blueprint.string.capitalize` - 首字母大写
- `blueprint.string.contains` - 判断是否包含字符串
- `blueprint.string.startsWith` - 判断是否以字符串开头
- `blueprint.string.endsWith` - 判断是否以字符串结尾
- `blueprint.string.equals` - 判断字符串是否相等
- `blueprint.string.equalsIgnoreCase` - 忽略大小写判断字符串是否相等
- `blueprint.string.indexOf` - 查找字符串位置
- `blueprint.string.lastIndexOf` - 从后查找字符串位置
- `blueprint.string.count` - 统计字符串出现次数
- `blueprint.string.charAt` - 获取指定位置字符
- `blueprint.string.substring` - 截取字符串
- `blueprint.string.insert` - 插入字符串
- `blueprint.string.replace` - 替换第一个匹配字符串
- `blueprint.string.replaceAll` - 替换所有匹配字符串
- `blueprint.string.split` - 分割字符串
- `blueprint.string.join` - 合并字符串数组
- `blueprint.string.repeat` - 重复字符串
- `blueprint.string.padStart` - 在开头补齐字符串
- `blueprint.string.padEnd` - 在结尾补齐字符串
- `blueprint.string.matchesRegex` - 判断是否匹配正则表达式
- `blueprint.string.extractRegex` - 提取正则匹配内容
- `blueprint.string.normalizeLineBreaks` - 统一换行符

Data 分类还包含 Collection 节点：
- `blueprint.collection.arrayLength` / `arrayGet` / `arraySet` / `arrayPush` / `arrayInsert` / `arrayRemove` / `arrayRemoveAt` / `arrayContains` / `arraySlice` / `arrayJoin`
- `blueprint.collection.objectKeys` / `objectValues` / `objectMerge` / `objectSetField` / `objectRemoveField`
- `blueprint.collection.arrayFind` / `arrayFilter` / `arrayMap` / `arraySort` 仅保留 planned/disabled 稳定 ID，不注册 palette/runtime

## Math

Math 节点组用于数值计算、取整、最小/最大值、随机数、布尔逻辑和值比较。所有支持蓝图的元素都可以使用 Math 节点组。

Math 节点组默认具有：
- `blueprint.math.add` - 数字相加；支持动态输入
- `blueprint.math.subtract` - 数字相减
- `blueprint.math.multiply` - 数字相乘
- `blueprint.math.divide` - 数字相除
- `blueprint.math.modulo` - 取余
- `blueprint.math.increment` - 数字加 1
- `blueprint.math.decrement` - 数字减 1
- `blueprint.math.abs` - 绝对值
- `blueprint.math.min` - 返回最小值；支持动态输入
- `blueprint.math.max` - 返回最大值；支持动态输入
- `blueprint.math.round` - 四舍五入为整数
- `blueprint.math.floor` - 向下取整
- `blueprint.math.ceil` - 向上取整
- `blueprint.math.randomFloat` - 输出范围内随机浮点数
- `blueprint.math.randomInteger` - 输出范围内随机整数
- `blueprint.boolean.and` - 布尔与
- `blueprint.boolean.or` - 布尔或
- `blueprint.boolean.not` - 布尔取反
- `blueprint.boolean.xor` - 布尔异或
- `blueprint.compare.equal` - 严格相等，使用 JavaScript `===`
- `blueprint.compare.notEqual` - 严格不相等，使用 JavaScript `!==`
- `blueprint.compare.greaterThan` - 数值大于
- `blueprint.compare.greaterThanOrEqual` - 数值大于等于
- `blueprint.compare.lessThan` - 数值小于
- `blueprint.compare.lessThanOrEqual` - 数值小于等于

## Text

Text 节点组用于设置和获取文本元素的内容、字体、排版、颜色和静态效果。只有 Text 元素具有 Text 节点组。

Text 节点组默认具有：
- `blueprint.text.getText` - 获取文本内容
- `blueprint.text.setText` - 设置文本内容
- `blueprint.text.appendText` - 追加文本内容
- `blueprint.text.clearText` - 清空文本内容
- `blueprint.text.getFont` - 获取字体
- `blueprint.text.setFont` - 设置字体
- `blueprint.text.getFontSize` - 获取字号
- `blueprint.text.setFontSize` - 设置字号
- `blueprint.text.getFontWeight` - 获取字重
- `blueprint.text.setFontWeight` - 设置字重
- `blueprint.text.getTextColor` - 获取文本颜色
- `blueprint.text.setTextColor` - 设置文本颜色
- `blueprint.text.getTextAlign` - 获取文本横向对齐
- `blueprint.text.setTextAlign` - 设置文本横向对齐
- `blueprint.text.getTextVerticalAlign` - 获取文本纵向对齐
- `blueprint.text.setTextVerticalAlign` - 设置文本纵向对齐
- `blueprint.text.getLineHeight` - 获取行高
- `blueprint.text.setLineHeight` - 设置行高
- `blueprint.text.getWrapMode` - 获取换行模式
- `blueprint.text.setWrapMode` - 设置换行模式
- `blueprint.text.getEffects` - 获取文本静态效果
- `blueprint.text.setEffects` - 设置文本静态效果
- `blueprint.text.getAllProperties` - 获取全部文本属性
- `blueprint.text.setAllProperties` - 设置全部文本属性
