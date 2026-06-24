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
- `blueprint.data.returnValue` - 返回当前属性值的无尾执行节点
- `blueprint.element.ref` - Same-Surface 元素字面量引用
- Element-targeted Text / Displayable / Slider / List / Widget Property 纯读取节点 - 读取绑定元素属性并记录隐藏刷新依赖

`nl.slider.props.value` 使用 `float` Blueprint Value，返回值表示映射后的值而不是 0-1 normalized 值；运行时会按该 Slider 的 `min` / `max` / `step` clamp 和 snap。

Blueprint Value 只允许安全的数据生产节点：`Init` Head、非 latent Flow、图内注释、纯 Data / Math、本地变量、`Var` 声明、Element Literal，以及纯读取型 Text / Displayable / Slider / List / Widget Property 节点。当前核心目录不提供 surface/global state 读写节点；Blueprint Value 也不允许 Widget 改写、Navigation、Persistent 变量读写、Broadcast、latent 节点和 TypeScript revision。

## Self 与 Element 方法节点

内建控件方法分为两套节点形态：
- Self 节点作用于当前私有蓝图所属控件，不带 Element/ref 输入，只在对应控件自己的 `widgetMain` 蓝图中出现，并通过 `executionOwner.elementId` 操作自己。
- Element 节点作用于显式连入的 Element 引用，带 typed Element 输入，例如 `element:nl.button`、`element:nl.slider`。它们统一显示在 `Element` 分类下。
- Element 节点只有在当前图里已经存在兼容的 `Element` 或 `Element Flush` 绑定节点时才显示；添加节点不会自动连线，必须手动连接目标输入。
- 写入节点通过 Host API 修改运行时或元素属性。值确实发生变化并导致重绘时会排队触发 flush；读取节点、CSS 自动样式和滚动请求不触发 flush。

## Variables

Variables 节点组用于声明和读写当前蓝图可访问的本地变量，以及读写项目级 Persistent 变量。控件私有蓝图、Blueprint Value 和 shared asset 蓝图使用图内 `Var` 节点声明 blueprint-level 变量；Page / Global 变量仍由左侧成员栏维护。旧版 `members.variables` 中的 blueprint-level 变量不会显示在成员栏中，但仍作为兼容 fallback 供 `Get Var` / `Set Var` 选择和运行。

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
- `blueprint.flow.switchString` - 字符串分流
- `blueprint.flow.forLoop` - 有界整数循环
- `blueprint.flow.forEach` - 遍历 JSON 数组
- `blueprint.flow.while` - 条件循环
- `blueprint.flow.delay` - 延迟执行 latent 节点
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
- `blueprint.event.head.elementFlush` - 绑定目标控件并监听该控件的 flush 事件
- `blueprint.element.text.*` - Text Element 读写节点
- `blueprint.element.displayable.*` - Displayable Element 读取节点
- `blueprint.element.slider.*` - Slider Element 读写节点
- `blueprint.element.list.*` - List Element 读写节点
- `blueprint.element.<widget>.*` - Button / Container / Image / Frame 等 Widget Property Element 节点

Element 派生节点不会按每个绑定控件复制菜单项；每个节点类型在创建浮窗中只出现一次。是否显示由当前图内是否存在兼容 Element 引用决定，目标引用必须由用户手动连线。

`blueprint.element.frame.setTargetPage` 是 Frame Element 形态，显示为 `Set Frame Page`，并和其他派生节点一样显示在 `Element` 分类中。

## Displayable

Displayable 节点组默认具有：
- `blueprint.event.head.mouseClick`
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
- `blueprint.displayable.getPosition` - 获取元素坐标
- `blueprint.displayable.getSize` - 获取元素尺寸
- `blueprint.displayable.getBounds` - 获取元素边界
- `blueprint.displayable.getCenter` - 获取元素中心点
- `blueprint.displayable.getRotation` - 获取元素旋转角度
- `blueprint.displayable.getOpacity` - 获取元素透明度
- `blueprint.displayable.getVisible` - 获取元素可见状态

Displayable Self 节点只读取当前控件自己。Element-targeted Displayable 节点使用 `blueprint.element.displayable.*`，带 generic `element` 输入，显示在 `Element` 分类中，并在当前图内存在任意 Same-Surface Element 引用时出现。

## Widget Property

Widget Property 节点用于运行时读写内建控件的通用属性和控件特有属性。

所有内建控件的 Self 版都提供：
- `blueprint.<widget>.getVisible` / `setVisible`
- `blueprint.<widget>.getEnabled` / `setEnabled`

Element 版使用 `blueprint.element.<widget>.*`，带 typed Element 输入，统一显示在 `Element` 分类中，并只在当前图里存在兼容 Element 引用时出现。`Set Enabled(false)` 会映射到底层禁用交互机制，用户侧不暴露 `interactionDisabled`。

控件特有方法包括：
- `nl.button`：`getLabel` / `setLabel`，以及 `getVariant` / `setVariant`
- `nl.container`：`getClipContent` / `setClipContent`，以及 `getVariant` / `setVariant`
- `nl.image`：`getImageAsset` / `setImageAsset`
- `nl.frame`：`getTargetPage` / `setTargetPage`、`getParams` / `setParams`

Page 导航与通信节点 `blueprint.page.go`、`blueprint.frame.getParam` / `blueprint.frame.emit` 仍属于 Page 节点组；`blueprint.frameWidget.setTargetPage` / `blueprint.element.frame.setTargetPage` 属于 Frame Widget Property。

## Page

Page 节点组用于切换 Page，以及在 Page 组件和被 Page 组件嵌入的子 Page 之间传递参数与事件。`nl.frame` 元素拥有 Page Event；被 Page 组件嵌入的子 Page 可以通过 Host API 读取参数并向父级 Page 组件发出事件。

Page 节点组默认具有：
- `blueprint.event.head.pageEvent` - Page 组件收到子 Page 事件
- `blueprint.event.head.keyDown` - Page 组件实例收到运行时窗口指定键按下事件
- `blueprint.event.head.keyUp` - Page 组件实例收到运行时窗口指定键抬起事件
- `blueprint.event.head.anyKeyDown` - Page 组件实例收到运行时窗口任意键按下事件
- `blueprint.event.head.anyKeyUp` - Page 组件实例收到运行时窗口任意键抬起事件
- `blueprint.page.go` - 切换到指定 Page（尾节点，无执行出口）
- `blueprint.frame.getParam` - 读取父级 Page 组件传入的参数
- `blueprint.frame.emit` - 向父级 Page 组件发送事件

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
- `blueprint.event.head.keyDown` - 当前 active Surface 收到运行时窗口指定键按下事件
- `blueprint.event.head.keyUp` - 当前 active Surface 收到运行时窗口指定键抬起事件
- `blueprint.event.head.anyKeyDown` - 当前 active Surface 收到运行时窗口任意键按下事件
- `blueprint.event.head.anyKeyUp` - 当前 active Surface 收到运行时窗口任意键抬起事件
- Broadcast 节点组

## List

List 节点组用于 `nl.list` 的运行时内容、选中项、滚动和条目上下文。Array / JSON / Object 处理不放入 List，统一放在 Data 分类。

List Self 节点只在 `nl.list` 自己的私有蓝图中出现，创建浮窗中归入 `List` 分类，且没有 `list` 输入。List Element 节点使用 `blueprint.element.list.*`，带 `element:nl.list` 输入，归入 `Element` 分类；当前图中没有绑定到 `nl.list` 的 Element 或 Element Flush 时不会显示。List item context 读取节点只在 item template 后代元素蓝图中出现。

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

Slider Self 节点只在 `nl.slider` 自己的私有蓝图中出现，创建浮窗中归入 `Slider` 分类，且没有 `slider` 输入。Slider Element 节点使用 `blueprint.element.slider.*`，带 `element:nl.slider` 输入，归入 `Element` 分类；当前图中没有绑定到 `nl.slider` 的 Element 或 Element Flush 时不会显示。

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

Image 节点组用于读取和改写 `nl.image` 的界面图片资源。它面向应用界面控件，不处理舞台表演图片、角色立绘或剧情演出资源。

Image Self 节点只在 `nl.image` 自己的私有蓝图中出现，创建浮窗中归入 `Image` 分类，且没有 `image` 输入。Image Element 节点使用 `blueprint.element.image.*`，带 `element:nl.image` 输入，归入 `Image` 分类；当前图中没有绑定到 `nl.image` 的 Element 或 Element Flush 时不会显示。

Image 节点组默认具有：
- `blueprint.image.assetLiteral` - 图片资产字面量卡片，输出 `ImageAsset`
- `blueprint.image.getImageAsset` - 获取当前图片资源，输出 `ImageAsset|null`
- `blueprint.image.setImageAsset` - 设置图片资源，输入 `ImageAsset|null`；未接线时可在节点卡片上展开图片选择器

Element 版对应稳定 ID 为 `blueprint.element.image.getImageAsset` 和 `blueprint.element.image.setImageAsset`。`Set Image Asset` 更新 `imageFill.assetId` 并触发 flush。旧图中字符串 `assetId` 连线仍可执行，但新 UI 推荐使用 `ImageAsset`。

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
- `blueprint.data.isEmptyValue` - 判断值是否为空字符串、空数组、空对象、null 或 undefined
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
