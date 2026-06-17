# 通用节点组

节点组指的是一组节点，当节点组被添加到某个元素的许可列表中时，该元素拥有节点组内所有的节点。节点分类是节点在图形界面中显示的操作类型。

除了被授予的节点组和元素拥有的特殊节点，元素不具有其他任何节点。

所有元素都具有Common节点组、Flow节点组、String节点组和Data节点组。

## Common

Common 节点组默认具有：
- `blueprint.event.head.init` - 元素初始化事件

## Flow

Flow 节点组用于控制执行线路。所有支持蓝图的元素、Surface 蓝图和全局蓝图都可以使用 Flow 节点组。

Flow 节点组默认具有：
- `if` - 根据布尔条件选择 True 或 False 执行出口

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

## Broadcast

Broadcast 节点组用于在页面和元素之间发送、接收广播事件。Surface 蓝图和所有支持蓝图的元素都可以使用 Broadcast 节点组。

Broadcast 节点组默认具有：
- `blueprint.event.head.onAnyBroadcast` - 任意事件广播事件
- `blueprint.event.head.onBroadcast` - 事件广播事件
- `blueprint.broadcast.send` - 发送广播事件
- `blueprint.broadcast.getListenerCount` - 获取注册的监听器数量

## Data

Data 节点组用于创建常量值和进行显式类型转换。所有支持蓝图的元素都可以使用 Data 节点组。

Data 节点组默认具有：
- `blueprint.data.stringLiteral` - 文本常量
- `blueprint.data.numberLiteral` - 浮点数常量
- `blueprint.data.booleanLiteral` - 布尔常量
- `blueprint.data.nullLiteral` - Null 常量
- `blueprint.data.toFloat` - 转换为 Float
- `blueprint.data.toInteger` - 转换为 Integer
- `blueprint.data.toBoolean` - 转换为 Boolean
- `blueprint.data.parseInt` - 从字符串解析 Integer
- `blueprint.data.parseFloat` - 从字符串解析 Float
- `blueprint.data.parseJson` - 从字符串解析 JSON
- `blueprint.data.stringifyJson` - 将 JSON 转换为字符串
- `blueprint.data.jsonGet` - 使用点路径读取 JSON 字段
- `blueprint.data.jsonHas` - 判断 JSON 字段路径是否存在

## String

String 节点组用于处理和生成字符串。所有支持蓝图的元素都可以使用 String 节点组。

String 节点组默认具有：
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
