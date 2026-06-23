# 通用节点组

节点组指的是一组节点，当节点组被添加到某个元素的许可列表中时，该元素拥有节点组内所有的节点。节点分类是节点在图形界面中显示的操作类型。

除了被授予的节点组和元素拥有的特殊节点，元素不具有其他任何节点。

所有元素都具有 Common 节点组、Flow 节点组、Data 节点组、Math 节点组和 Debug 节点组。JSON 与 String 节点归入 Data；Boolean 与 Compare 节点归入 Math。

## Common

Common 节点组默认具有：
- `blueprint.event.head.init` - 元素初始化事件；在 Blueprint Value 中也作为初始求值事件

## Blueprint Value

Blueprint Value 节点组只存在于 `widgetValue` 私有蓝图。当前用于 `nl.text` 的 `props.text`、`nl.button` 的 `props.label` 和 Page 组件 `nl.frame` 的 `props.params` 动态值。

Blueprint Value 可用节点包括：
- `blueprint.event.head.init` - 初始求值事件
- `blueprint.event.head.flush` - 自动刷新求值事件
- `blueprint.data.returnValue` - 返回当前属性值的无尾执行节点

Blueprint Value 只允许安全的数据生产节点：事件 Head、非 latent Flow、图内注释、纯 Data / Math 和本地变量。当前核心目录不提供 surface/global state 读写节点；Blueprint Value 也不允许 Widget 改写、Navigation、Persistence 写入、Broadcast、latent 节点和 TypeScript revision。

## Variables

Variables 节点组用于读写当前蓝图可访问的本地变量。当前核心目录只保留：
- `blueprint.local.get` - 读取变量
- `blueprint.local.set` - 写入变量

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
- `blueprint.event.head.focus`
- `blueprint.event.head.blur`
- `blueprint.displayable.getPosition` - 获取元素坐标
- `blueprint.displayable.getSize` - 获取元素尺寸
- `blueprint.displayable.getBounds` - 获取元素边界
- `blueprint.displayable.getCenter` - 获取元素中心点
- `blueprint.displayable.getRotation` - 获取元素旋转角度
- `blueprint.displayable.getOpacity` - 获取元素透明度
- `blueprint.displayable.getVisible` - 获取元素可见状态

## Page

Page 节点组用于 Page 组件和被 Page 组件嵌入的子 Page 之间传递参数与事件。`nl.frame` 元素拥有 Page Event；被 Page 组件嵌入的子 Page 可以通过 Host API 读取参数并向父级 Page 组件发出事件。

Page 节点组默认具有：
- `blueprint.event.head.pageEvent` - Page 组件收到子 Page 事件
- `blueprint.frame.getParam` - 读取父级 Page 组件传入的参数
- `blueprint.frame.emit` - 向父级 Page 组件发送事件

## Global

只有全局蓝图具有 Global 节点组。

Global 节点组默认具有：
- `blueprint.event.head.appBoot` - 应用启动事件（仅全局蓝图具有）

## Surface

只有Surface蓝图（包括Game UI和Page）具有Surface节点组。

Surface 节点组默认具有：
- `blueprint.event.head.surfaceInit` - 当前 Surface 初始化事件（仅Surface蓝图具有）
- `blueprint.event.head.surfaceUnmount` - 当前 Surface 卸载事件（仅Surface蓝图具有）
- Broadcast 节点组

## Collection

Collection 节点组默认具有：
- `blueprint.event.head.scroll` - 列表滚动事件
- `blueprint.event.head.scrollEnd` - 列表滚动到末端事件
- `blueprint.event.head.itemRender` - 列表条目渲染事件
- `blueprint.event.head.itemClick` - 列表条目点击事件
- `blueprint.event.head.itemHover` - 列表条目悬停事件
- `blueprint.event.head.selectionChanged` - 列表选中项变化事件

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
