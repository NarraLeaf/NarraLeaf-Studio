# UI Editor Blueprint 节点路线总表

本文汇总 UI Editor 蓝图系统建议提供的节点。列表包含当前已实现、已规划和建议新增的节点；节点按面向视觉小说 UI 制作的使用场景分类。

## Events

| 节点 | 类型 ID 建议 | 说明 |
| --- | --- | --- |
| On App Boot | `blueprint.event.head.appBoot` | 应用 UI 运行时启动时触发。 |
| On Surface Init | `blueprint.event.head.surfaceInit` | Page 或 Game UI surface 初始化时触发。 |
| On Surface Unmount | `blueprint.event.head.surfaceUnmount` | Page 或 Game UI surface 卸载时触发。 |
| On Init | `blueprint.event.head.init` | 当前 widget 初始化时触发。 |
| On Click | `blueprint.event.head.click` | 当前 widget 被点击时触发。 |
| Mouse Click | `blueprint.event.head.mouseClick` | 鼠标左键点击元素时触发。 |
| Mouse Double Click | `blueprint.event.head.mouseDoubleClick` | 鼠标双击元素时触发。 |
| Mouse Enter | `blueprint.event.head.mouseEnter` | 鼠标进入元素区域时触发。 |
| Mouse Leave | `blueprint.event.head.mouseLeave` | 鼠标离开元素区域时触发。 |
| Mouse Move | `blueprint.event.head.mouseMove` | 鼠标在元素上移动时触发。 |
| Mouse Down | `blueprint.event.head.mouseDown` | 鼠标在元素上按下时触发。 |
| Mouse Up | `blueprint.event.head.mouseUp` | 鼠标在元素上抬起时触发。 |
| Mouse Wheel | `blueprint.event.head.mouseWheel` | 鼠标滚轮在元素上滚动时触发。 |
| Right Click | `blueprint.event.head.rightClick` | 鼠标右键点击元素时触发。 |
| Focus | `blueprint.event.head.focus` | 元素获得键盘、鼠标或手柄焦点时触发。 |
| Blur | `blueprint.event.head.blur` | 元素失去焦点时触发。 |
| Scroll | `blueprint.event.head.scroll` | 可滚动元素发生滚动时触发。 |
| On Any Broadcast | `blueprint.event.head.onAnyBroadcast` | 当前元素收到任意广播事件时触发。 |
| On Broadcast | `blueprint.event.head.onBroadcast` | 当前元素收到指定广播事件时触发。 |
| On Item Render | `blueprint.event.head.itemRender` | List 或 Repeater 渲染单个条目时触发。 |
| On Item Click | `blueprint.event.head.itemClick` | List 或 Repeater 条目被点击时触发。 |
| On Item Hover | `blueprint.event.head.itemHover` | List 或 Repeater 条目被悬停时触发。 |
| On Selection Changed | `blueprint.event.head.selectionChanged` | List、选项组或可选择控件的选择项变化时触发。 |
| On Scroll End | `blueprint.event.head.scrollEnd` | 列表或滚动容器滚动到末端时触发。 |
| On Load More | `blueprint.event.head.loadMore` | 列表需要加载更多数据时触发。 |
| On Variable Changed | `blueprint.event.head.variableChanged` | 指定 UI 变量变化时触发。 |
| On Timer | `blueprint.event.head.timer` | 指定计时器触发时执行。 |
| On Modal Result | `blueprint.event.head.modalResult` | 弹窗返回结果时触发。 |

## Flow

| 节点 | 类型 ID 建议 | 说明 |
| --- | --- | --- |
| If | `if` | 根据布尔条件选择 true 或 false 执行出口。 |
| Noop | `blueprint.flow.noop` | 空操作，直接传递执行流。 |
| Sequence | `blueprint.flow.sequence` | 按顺序执行多个出口。 |
| Switch String | `blueprint.flow.switchString` | 根据字符串值进入匹配分支。 |
| Switch Integer | `blueprint.flow.switchInteger` | 根据整数值进入匹配分支。 |
| Switch Boolean | `blueprint.flow.switchBoolean` | 根据布尔值进入 true 或 false 分支。 |
| Branch By Enum | `blueprint.flow.switchEnum` | 根据枚举字符串或枚举值进入匹配分支。 |
| For Loop | `blueprint.flow.forLoop` | 执行有界整数循环。 |
| For Each | `blueprint.flow.forEach` | 遍历 JSON 数组中的每一项。 |
| While | `blueprint.flow.while` | 在条件为真时执行有界循环。 |
| Delay | `blueprint.flow.delay` | 等待指定秒数后继续执行。 |
| Delay Frames | `blueprint.flow.delayFrames` | 等待指定帧数后继续执行。 |
| Wait Until | `blueprint.flow.waitUntil` | 等待条件满足后继续执行。 |
| Do Once | `blueprint.flow.doOnce` | 只允许执行一次，可通过 reset 重新开启。 |
| Do N Times | `blueprint.flow.doNTimes` | 最多执行指定次数。 |
| Gate | `blueprint.flow.gate` | 根据打开或关闭状态决定是否允许执行流通过。 |
| Flip Flop | `blueprint.flow.flipFlop` | 每次进入时在 A/B 两个出口间交替执行。 |
| Early Return | `blueprint.flow.return` | 提前结束当前函数、宏或事件执行链。 |
| Reroute | `blueprint.flow.reroute` | 用于整理图连线的中继节点。 |
| Comment | `blueprint.flow.comment` | 图内说明节点。 |
| Region | `blueprint.flow.region` | 图内区域分组节点。 |
| Debounce | `blueprint.flow.debounce` | 在连续触发停止一段时间后只执行最后一次。 |
| Throttle | `blueprint.flow.throttle` | 限制一段时间内最多执行一次。 |

## Variables

| 节点 | 类型 ID 建议 | 说明 |
| --- | --- | --- |
| Get Var | `blueprint.local.get` | 读取执行局部变量。 |
| Set Var | `blueprint.local.set` | 写入执行局部变量。 |
| Get Local Var | `blueprint.variable.getLocal` | 读取图执行局部变量。 |
| Set Local Var | `blueprint.variable.setLocal` | 写入图执行局部变量。 |
| Get Blueprint Var | `blueprint.variable.getBlueprint` | 读取当前 blueprint 成员变量。 |
| Set Blueprint Var | `blueprint.variable.setBlueprint` | 写入当前 blueprint 成员变量。 |
| Get Surface Var | `blueprint.variable.getSurface` | 读取当前 Page 或 Game UI surface 状态变量。 |
| Set Surface Var | `blueprint.variable.setSurface` | 写入当前 Page 或 Game UI surface 状态变量。 |
| Get Global UI Var | `blueprint.variable.getGlobalUi` | 读取 UI runtime 全局变量。 |
| Set Global UI Var | `blueprint.variable.setGlobalUi` | 写入 UI runtime 全局变量。 |
| Watch Var Changed | `blueprint.variable.watchChanged` | 监听变量变化并触发后续逻辑。 |
| Reset Var | `blueprint.variable.reset` | 将变量恢复为默认值。 |
| Has Var | `blueprint.variable.has` | 判断指定变量是否存在。 |

## Data

| 节点 | 类型 ID 建议 | 说明 |
| --- | --- | --- |
| Boolean Literal | `blueprint.data.booleanLiteral` | 输出布尔常量。 |
| Integer Literal | `blueprint.data.integerLiteral` | 输出整数常量。 |
| Float Literal | `blueprint.data.floatLiteral` | 输出浮点数常量。 |
| String Literal | `blueprint.data.stringLiteral` | 输出字符串常量。 |
| Color Literal | `blueprint.data.colorLiteral` | 输出颜色常量。 |
| Vector2 Literal | `blueprint.data.vector2Literal` | 输出二维向量常量。 |
| Rect Literal | `blueprint.data.rectLiteral` | 输出矩形常量。 |
| Null | `blueprint.data.null` | 输出 null。 |
| Undefined / Empty | `blueprint.data.empty` | 输出空值。 |
| Is String | `blueprint.data.isString` | 判断值是否为字符串。 |
| Is Number | `blueprint.data.isNumber` | 判断值是否为数字。 |
| Is Boolean | `blueprint.data.isBoolean` | 判断值是否为布尔值。 |
| Is Array | `blueprint.data.isArray` | 判断值是否为数组。 |
| Is Object | `blueprint.data.isObject` | 判断值是否为对象。 |
| Is Null | `blueprint.data.isNull` | 判断值是否为 null。 |
| Is Empty Value | `blueprint.data.isEmptyValue` | 判断值是否为空字符串、空数组、空对象、null 或 undefined。 |
| To Boolean | `blueprint.data.toBoolean` | 将值转换为布尔值。 |
| To Integer | `blueprint.data.toInteger` | 将值转换为整数。 |
| To Float | `blueprint.data.toFloat` | 将值转换为浮点数。 |
| To String | `blueprint.data.toString` | 将值转换为字符串。 |
| To Color | `blueprint.data.toColor` | 将值转换为颜色。 |
| To JSON | `blueprint.data.toJson` | 将值转换为 JSON-safe 值。 |
| Parse Number | `blueprint.data.parseNumber` | 从字符串解析数字。 |
| Clamp Number | `blueprint.data.clampNumber` | 将数字限制在最小值和最大值之间。 |
| Map Range | `blueprint.data.mapRange` | 将数字从一个范围映射到另一个范围。 |
| Select Boolean | `blueprint.data.selectBoolean` | 根据条件在两个布尔值之间选择。 |
| Select String | `blueprint.data.selectString` | 根据条件在两个字符串之间选择。 |
| Select Number | `blueprint.data.selectNumber` | 根据条件在两个数字之间选择。 |
| Select JSON | `blueprint.data.selectJson` | 根据条件在两个 JSON 值之间选择。 |
| Fallback / Coalesce | `blueprint.data.coalesce` | 当主值为空时返回备用值。 |

## Boolean / Compare

| 节点 | 类型 ID 建议 | 说明 |
| --- | --- | --- |
| And | `blueprint.boolean.and` | 布尔与。 |
| Or | `blueprint.boolean.or` | 布尔或。 |
| Not | `blueprint.boolean.not` | 布尔取反。 |
| Xor | `blueprint.boolean.xor` | 布尔异或。 |
| Equal | `blueprint.compare.equal` | 判断两个值是否相等。 |
| Not Equal | `blueprint.compare.notEqual` | 判断两个值是否不相等。 |
| Greater Than | `blueprint.compare.greaterThan` | 判断 a 是否大于 b。 |
| Greater Than Or Equal | `blueprint.compare.greaterThanOrEqual` | 判断 a 是否大于等于 b。 |
| Less Than | `blueprint.compare.lessThan` | 判断 a 是否小于 b。 |
| Less Than Or Equal | `blueprint.compare.lessThanOrEqual` | 判断 a 是否小于等于 b。 |
| In Range | `blueprint.compare.inRange` | 判断数字是否位于指定范围内。 |
| Is Between | `blueprint.compare.isBetween` | 判断数字是否介于两个边界之间。 |
| Is One Of | `blueprint.compare.isOneOf` | 判断值是否属于候选集合。 |
| Compare String | `blueprint.compare.string` | 比较两个字符串。 |
| Compare Number | `blueprint.compare.number` | 比较两个数字并输出比较结果。 |

## Math

| 节点 | 类型 ID 建议 | 说明 |
| --- | --- | --- |
| Add | `blueprint.math.add` | 数字相加。 |
| Subtract | `blueprint.math.subtract` | 数字相减。 |
| Multiply | `blueprint.math.multiply` | 数字相乘。 |
| Divide | `blueprint.math.divide` | 数字相除。 |
| Modulo | `blueprint.math.modulo` | 取余。 |
| Increment | `blueprint.math.increment` | 数字加 1。 |
| Decrement | `blueprint.math.decrement` | 数字减 1。 |
| Abs | `blueprint.math.abs` | 绝对值。 |
| Min | `blueprint.math.min` | 返回较小值。 |
| Max | `blueprint.math.max` | 返回较大值。 |
| Clamp | `blueprint.math.clamp` | 限制数值范围。 |
| Round | `blueprint.math.round` | 四舍五入。 |
| Floor | `blueprint.math.floor` | 向下取整。 |
| Ceil | `blueprint.math.ceil` | 向上取整。 |
| Random Float | `blueprint.math.randomFloat` | 输出指定范围内的随机浮点数。 |
| Random Integer | `blueprint.math.randomInteger` | 输出指定范围内的随机整数。 |
| Lerp | `blueprint.math.lerp` | 线性插值。 |
| Map Range Clamped | `blueprint.math.mapRangeClamped` | 将数值映射到目标范围并限制边界。 |

## String

| 节点 | 类型 ID 建议 | 说明 |
| --- | --- | --- |
| To String | `blueprint.string.toString` | 将任意值转换为字符串。 |
| Concat | `blueprint.string.concat` | 拼接多个字符串。 |
| Format | `blueprint.string.format` | 使用数据替换模板占位符。 |
| Length | `blueprint.string.length` | 获取字符串长度。 |
| Is Empty | `blueprint.string.isEmpty` | 判断字符串是否为空。 |
| Is Blank | `blueprint.string.isBlank` | 判断字符串是否为空白。 |
| Trim | `blueprint.string.trim` | 移除两端空白。 |
| Trim Start | `blueprint.string.trimStart` | 移除开头空白。 |
| Trim End | `blueprint.string.trimEnd` | 移除结尾空白。 |
| To Upper Case | `blueprint.string.toUpperCase` | 转换为大写。 |
| To Lower Case | `blueprint.string.toLowerCase` | 转换为小写。 |
| Capitalize | `blueprint.string.capitalize` | 首字母大写。 |
| Contains | `blueprint.string.contains` | 判断是否包含子字符串。 |
| Starts With | `blueprint.string.startsWith` | 判断是否以指定字符串开头。 |
| Ends With | `blueprint.string.endsWith` | 判断是否以指定字符串结尾。 |
| Equals | `blueprint.string.equals` | 判断字符串是否相等。 |
| Equals Ignore Case | `blueprint.string.equalsIgnoreCase` | 忽略大小写判断字符串是否相等。 |
| Index Of | `blueprint.string.indexOf` | 查找子字符串首次出现位置。 |
| Last Index Of | `blueprint.string.lastIndexOf` | 查找子字符串最后出现位置。 |
| Count | `blueprint.string.count` | 统计子字符串出现次数。 |
| Char At | `blueprint.string.charAt` | 获取指定位置字符。 |
| Substring | `blueprint.string.substring` | 截取字符串。 |
| Insert | `blueprint.string.insert` | 在指定位置插入字符串。 |
| Replace | `blueprint.string.replace` | 替换第一个匹配字符串。 |
| Replace All | `blueprint.string.replaceAll` | 替换所有匹配字符串。 |
| Split | `blueprint.string.split` | 按分隔符拆分字符串。 |
| Join | `blueprint.string.join` | 将字符串数组连接为字符串。 |
| Repeat | `blueprint.string.repeat` | 重复字符串。 |
| Pad Start | `blueprint.string.padStart` | 在开头填充字符串到指定长度。 |
| Pad End | `blueprint.string.padEnd` | 在结尾填充字符串到指定长度。 |
| Matches Regex | `blueprint.string.matchesRegex` | 判断字符串是否匹配正则。 |
| Extract Regex | `blueprint.string.extractRegex` | 提取正则匹配结果。 |
| Normalize Line Breaks | `blueprint.string.normalizeLineBreaks` | 统一换行符格式。 |

## JSON

| 节点 | 类型 ID 建议 | 说明 |
| --- | --- | --- |
| JSON Literal | `blueprint.data.jsonLiteral` | 输出 JSON 常量。 |
| To JSON | `blueprint.data.toJson` | 将任意值转换为 JSON。 |
| Parse JSON | `blueprint.data.parseJson` | 将字符串解析为 JSON。 |
| Stringify JSON | `blueprint.data.stringifyJson` | 将 JSON 转换为字符串。 |
| Get JSON Field | `blueprint.data.jsonGet` | 按路径读取 JSON 字段。 |
| Has JSON Field | `blueprint.data.jsonHas` | 判断 JSON 路径是否存在。 |
| Set JSON Field | `blueprint.data.jsonSet` | 按路径写入 JSON 字段并输出新 JSON。 |
| Remove JSON Field | `blueprint.data.jsonRemove` | 按路径移除 JSON 字段并输出新 JSON。 |
| Make JSON Object | `blueprint.data.jsonMakeObject` | 由动态命名输入创建 JSON Object。 |
| Make JSON Array | `blueprint.data.jsonMakeArray` | 由动态输入创建 JSON Array。 |
| JSON Array Length | `blueprint.data.jsonArrayLength` | 获取 JSON Array 长度。 |
| Merge JSON Object | `blueprint.data.jsonMergeObject` | 合并两个 JSON Object。 |
| Clone JSON | `blueprint.data.jsonClone` | 深拷贝 JSON 值。 |

## Collection

| 节点 | 类型 ID 建议 | 说明 |
| --- | --- | --- |
| Array Length | `blueprint.collection.arrayLength` | 获取数组长度。 |
| Array Get | `blueprint.collection.arrayGet` | 读取指定下标的数组项。 |
| Array Set | `blueprint.collection.arraySet` | 写入指定下标的数组项并输出新数组。 |
| Array Push | `blueprint.collection.arrayPush` | 在数组末尾追加项。 |
| Array Insert | `blueprint.collection.arrayInsert` | 在指定下标插入项。 |
| Array Remove | `blueprint.collection.arrayRemove` | 移除指定值。 |
| Array Remove At | `blueprint.collection.arrayRemoveAt` | 移除指定下标的项。 |
| Array Contains | `blueprint.collection.arrayContains` | 判断数组是否包含指定值。 |
| Array Find | `blueprint.collection.arrayFind` | 查找匹配项。 |
| Array Filter | `blueprint.collection.arrayFilter` | 过滤数组项。 |
| Array Map | `blueprint.collection.arrayMap` | 映射数组项。 |
| Array Sort | `blueprint.collection.arraySort` | 对数组排序。 |
| Array Slice | `blueprint.collection.arraySlice` | 截取数组片段。 |
| Array Join | `blueprint.collection.arrayJoin` | 将数组连接为字符串。 |
| Object Keys | `blueprint.collection.objectKeys` | 获取对象字段名数组。 |
| Object Values | `blueprint.collection.objectValues` | 获取对象值数组。 |
| Object Merge | `blueprint.collection.objectMerge` | 合并对象。 |
| Object Set Field | `blueprint.collection.objectSetField` | 写入对象字段并输出新对象。 |
| Object Remove Field | `blueprint.collection.objectRemoveField` | 移除对象字段并输出新对象。 |

## Displayable / Widget

| 节点 | 类型 ID 建议 | 说明 |
| --- | --- | --- |
| Get Position | `blueprint.displayable.getPosition` | 获取元素位置。 |
| Set Position | `blueprint.displayable.setPosition` | 设置元素位置。 |
| Get X | `blueprint.displayable.getX` | 获取元素 X 坐标。 |
| Set X | `blueprint.displayable.setX` | 设置元素 X 坐标。 |
| Get Y | `blueprint.displayable.getY` | 获取元素 Y 坐标。 |
| Set Y | `blueprint.displayable.setY` | 设置元素 Y 坐标。 |
| Get Size | `blueprint.displayable.getSize` | 获取元素尺寸。 |
| Set Size | `blueprint.displayable.setSize` | 设置元素尺寸。 |
| Get Width | `blueprint.displayable.getWidth` | 获取元素宽度。 |
| Set Width | `blueprint.displayable.setWidth` | 设置元素宽度。 |
| Get Height | `blueprint.displayable.getHeight` | 获取元素高度。 |
| Set Height | `blueprint.displayable.setHeight` | 设置元素高度。 |
| Get Bounds | `blueprint.displayable.getBounds` | 获取元素边界矩形。 |
| Get Center | `blueprint.displayable.getCenter` | 获取元素中心点。 |
| Center In Parent | `blueprint.displayable.centerInParent` | 将元素居中到父级。 |
| Fit To Parent | `blueprint.displayable.fitToParent` | 将元素尺寸适配父级。 |
| Get Rotation | `blueprint.displayable.getRotation` | 获取元素旋转角度。 |
| Set Rotation | `blueprint.displayable.setRotation` | 设置元素旋转角度。 |
| Get Scale | `blueprint.displayable.getScale` | 获取元素缩放。 |
| Set Scale | `blueprint.displayable.setScale` | 设置元素缩放。 |
| Get Opacity | `blueprint.displayable.getOpacity` | 获取元素透明度。 |
| Set Opacity | `blueprint.displayable.setOpacity` | 设置元素透明度。 |
| Get Visible | `blueprint.displayable.getVisible` | 获取元素可见状态。 |
| Set Visible | `blueprint.displayable.setVisible` | 设置元素可见状态。 |
| Show | `blueprint.displayable.show` | 显示元素。 |
| Hide | `blueprint.displayable.hide` | 隐藏元素。 |
| Toggle Visible | `blueprint.displayable.toggleVisible` | 切换元素可见状态。 |
| Get Enabled | `blueprint.displayable.getEnabled` | 获取元素启用状态。 |
| Set Enabled | `blueprint.displayable.setEnabled` | 设置元素启用状态。 |
| Enable | `blueprint.displayable.enable` | 启用元素。 |
| Disable | `blueprint.displayable.disable` | 禁用元素。 |
| Get Variant | `blueprint.displayable.getVariant` | 获取元素 variant。 |
| Set Variant | `blueprint.displayable.setVariant` | 设置元素 variant。 |
| Get Z Index | `blueprint.displayable.getZIndex` | 获取元素层级。 |
| Set Z Index | `blueprint.displayable.setZIndex` | 设置元素层级。 |
| Move By | `blueprint.displayable.moveBy` | 按偏移移动元素。 |
| Resize By | `blueprint.displayable.resizeBy` | 按偏移调整元素尺寸。 |
| Reset Transform | `blueprint.displayable.resetTransform` | 重置位置、旋转、缩放等变换。 |
| Find Element By Id | `blueprint.widget.findById` | 按元素 ID 查找元素引用。 |
| Find Element By Name | `blueprint.widget.findByName` | 按名称查找元素引用。 |
| Find Elements By Tag | `blueprint.widget.findByTag` | 按标签查找元素引用数组。 |
| Get Focused Element | `blueprint.widget.getFocusedElement` | 获取当前焦点元素。 |
| Focus Element | `blueprint.widget.focusElement` | 将焦点移动到指定元素。 |
| Blur Element | `blueprint.widget.blurElement` | 取消指定元素焦点。 |
| Set Style | `blueprint.widget.setStyle` | 设置元素样式字段。 |
| Add Class / Tag | `blueprint.widget.addTag` | 为元素添加标签或样式类。 |
| Remove Class / Tag | `blueprint.widget.removeTag` | 移除元素标签或样式类。 |
| Has Class / Tag | `blueprint.widget.hasTag` | 判断元素是否拥有标签或样式类。 |

## Container / Layout

| 节点 | 类型 ID 建议 | 说明 |
| --- | --- | --- |
| Get Children | `blueprint.container.getChildren` | 获取容器子元素引用数组。 |
| Get Child Count | `blueprint.container.getChildCount` | 获取容器子元素数量。 |
| Get Child At | `blueprint.container.getChildAt` | 获取指定下标的子元素。 |
| Find Child By Name | `blueprint.container.findChildByName` | 在容器内按名称查找子元素。 |
| Find Child By Tag | `blueprint.container.findChildByTag` | 在容器内按标签查找子元素。 |
| Set Layout Direction | `blueprint.container.setLayoutDirection` | 设置布局方向。 |
| Set Gap | `blueprint.container.setGap` | 设置子元素间距。 |
| Set Padding | `blueprint.container.setPadding` | 设置容器内边距。 |
| Set Align | `blueprint.container.setAlign` | 设置交叉轴对齐。 |
| Set Justify | `blueprint.container.setJustify` | 设置主轴分布。 |
| Refresh Layout | `blueprint.container.refreshLayout` | 重新计算容器布局。 |

## Text

| 节点 | 类型 ID 建议 | 说明 |
| --- | --- | --- |
| Get Text | `blueprint.text.getText` | 获取文本内容。 |
| Set Text | `blueprint.text.setText` | 设置文本内容。 |
| Append Text | `blueprint.text.appendText` | 在文本末尾追加内容。 |
| Clear Text | `blueprint.text.clearText` | 清空文本内容。 |
| Get Font | `blueprint.text.getFont` | 获取字体资源 ID。 |
| Set Font | `blueprint.text.setFont` | 设置字体资源 ID。 |
| Get Font Size | `blueprint.text.getFontSize` | 获取字号。 |
| Set Font Size | `blueprint.text.setFontSize` | 设置字号。 |
| Get Font Weight | `blueprint.text.getFontWeight` | 获取字重。 |
| Set Font Weight | `blueprint.text.setFontWeight` | 设置字重。 |
| Get Text Color | `blueprint.text.getTextColor` | 获取文本颜色。 |
| Set Text Color | `blueprint.text.setTextColor` | 设置文本颜色。 |
| Get Text Align | `blueprint.text.getTextAlign` | 获取横向对齐。 |
| Set Text Align | `blueprint.text.setTextAlign` | 设置横向对齐。 |
| Get Text Vertical Align | `blueprint.text.getTextVerticalAlign` | 获取纵向对齐。 |
| Set Text Vertical Align | `blueprint.text.setTextVerticalAlign` | 设置纵向对齐。 |
| Get Line Height | `blueprint.text.getLineHeight` | 获取行高。 |
| Set Line Height | `blueprint.text.setLineHeight` | 设置行高。 |
| Get Wrap Mode | `blueprint.text.getWrapMode` | 获取换行模式。 |
| Set Wrap Mode | `blueprint.text.setWrapMode` | 设置换行模式。 |
| Get Effects | `blueprint.text.getEffects` | 获取文本静态效果。 |
| Set Effects | `blueprint.text.setEffects` | 设置文本静态效果。 |
| Get All Properties | `blueprint.text.getAllProperties` | 一次性获取文本元素全部属性。 |
| Set All Properties | `blueprint.text.setAllProperties` | 一次性设置文本元素全部属性。 |
| Typewriter Text | `blueprint.text.typewriter` | 按打字机效果逐步显示文本。 |

## Image

| 节点 | 类型 ID 建议 | 说明 |
| --- | --- | --- |
| Get Source | `blueprint.image.getSource` | 获取图片来源。 |
| Set Source | `blueprint.image.setSource` | 设置图片来源。 |
| Clear Source | `blueprint.image.clearSource` | 清空图片来源。 |
| Set Sprite / Asset | `blueprint.image.setAsset` | 通过资源 ID 设置图片。 |
| Set Fit Mode | `blueprint.image.setFitMode` | 设置图片适配模式。 |
| Set Tint | `blueprint.image.setTint` | 设置图片染色。 |
| Set Crop Rect | `blueprint.image.setCropRect` | 设置图片裁切矩形。 |
| Set Nine Slice | `blueprint.image.setNineSlice` | 设置九宫格切片参数。 |
| Get Natural Size | `blueprint.image.getNaturalSize` | 获取图片原始尺寸。 |
| Set Image By Key | `blueprint.image.setByKey` | 按业务 key 设置图片资源。 |
| Preload Image | `blueprint.image.preload` | 预加载图片资源。 |

## Button

| 节点 | 类型 ID 建议 | 说明 |
| --- | --- | --- |
| Get Label | `blueprint.button.getLabel` | 获取按钮文本。 |
| Set Label | `blueprint.button.setLabel` | 设置按钮文本。 |
| Set Button Variant | `blueprint.button.setVariant` | 设置按钮视觉状态。 |
| Set Pressed | `blueprint.button.setPressed` | 设置按钮 pressed 状态。 |
| Set Loading | `blueprint.button.setLoading` | 设置按钮 loading 状态。 |
| Set Disabled Reason | `blueprint.button.setDisabledReason` | 设置按钮禁用原因文本。 |
| Click Button | `blueprint.button.click` | 主动触发按钮点击逻辑。 |
| Focus Button | `blueprint.button.focus` | 将焦点移动到按钮。 |

## List / Repeater

| 节点 | 类型 ID 建议 | 说明 |
| --- | --- | --- |
| Set List Items | `blueprint.list.setItems` | 设置列表数据源。 |
| Get List Items | `blueprint.list.getItems` | 获取列表数据源。 |
| Clear List | `blueprint.list.clear` | 清空列表数据。 |
| Append List Item | `blueprint.list.appendItem` | 在列表末尾追加数据项。 |
| Insert List Item | `blueprint.list.insertItem` | 在指定下标插入数据项。 |
| Remove List Item | `blueprint.list.removeItem` | 移除指定数据项。 |
| Remove List Item At | `blueprint.list.removeItemAt` | 移除指定下标的数据项。 |
| Get Selected Item | `blueprint.list.getSelectedItem` | 获取当前选中数据项。 |
| Set Selected Item | `blueprint.list.setSelectedItem` | 设置当前选中数据项。 |
| Get Selected Index | `blueprint.list.getSelectedIndex` | 获取当前选中下标。 |
| Set Selected Index | `blueprint.list.setSelectedIndex` | 设置当前选中下标。 |
| Refresh Items | `blueprint.list.refreshItems` | 刷新列表条目渲染。 |
| Scroll To Index | `blueprint.list.scrollToIndex` | 滚动到指定条目。 |
| Scroll To Top | `blueprint.list.scrollToTop` | 滚动到顶部。 |
| Scroll To Bottom | `blueprint.list.scrollToBottom` | 滚动到底部。 |

## Page

| 节点 | 类型 ID 建议 | 说明 |
| --- | --- | --- |
| Open Page | `blueprint.page.open` | 打开指定 Page。 |
| Close Page | `blueprint.page.close` | 关闭当前或指定 Page。 |
| Replace Page | `blueprint.page.replace` | 使用指定 Page 替换当前 Page。 |
| Back | `blueprint.page.back` | 返回上一 Page。 |
| Can Go Back | `blueprint.page.canGoBack` | 判断是否可以返回上一 Page。 |
| Get Current Page | `blueprint.page.getCurrent` | 获取当前 Page ID。 |
| Is Page Open | `blueprint.page.isOpen` | 判断指定 Page 是否处于打开状态。 |
| Preload Page | `blueprint.page.preload` | 预加载指定 Page。 |
| Unload Page | `blueprint.page.unload` | 卸载指定 Page 资源。 |

## Modal / Popup / Toast

| 节点 | 类型 ID 建议 | 说明 |
| --- | --- | --- |
| Open Modal | `blueprint.modal.open` | 打开指定弹窗。 |
| Close Modal | `blueprint.modal.close` | 关闭当前或指定弹窗。 |
| Close All Modals | `blueprint.modal.closeAll` | 关闭全部弹窗。 |
| Show Confirm | `blueprint.modal.showConfirm` | 显示确认弹窗并返回用户选择。 |
| Show Alert | `blueprint.modal.showAlert` | 显示提示弹窗。 |
| Show Toast | `blueprint.toast.show` | 显示短暂通知。 |
| Set Modal Result | `blueprint.modal.setResult` | 设置弹窗返回值。 |
| Wait Modal Result | `blueprint.modal.waitResult` | 等待弹窗返回值后继续执行。 |

## Layer

| 节点 | 类型 ID 建议 | 说明 |
| --- | --- | --- |
| Show Layer | `blueprint.layer.show` | 显示 UI 层。 |
| Hide Layer | `blueprint.layer.hide` | 隐藏 UI 层。 |
| Toggle Layer | `blueprint.layer.toggle` | 切换 UI 层显示状态。 |
| Bring Layer To Front | `blueprint.layer.bringToFront` | 将 UI 层置顶。 |
| Send Layer To Back | `blueprint.layer.sendToBack` | 将 UI 层置底。 |
| Set Layer Order | `blueprint.layer.setOrder` | 设置 UI 层排序。 |
| Is Layer Visible | `blueprint.layer.isVisible` | 判断 UI 层是否可见。 |

## Animation / Tween

| 节点 | 类型 ID 建议 | 说明 |
| --- | --- | --- |
| Tween Position | `blueprint.animation.tweenPosition` | 对元素位置做补间动画。 |
| Tween X | `blueprint.animation.tweenX` | 对元素 X 坐标做补间动画。 |
| Tween Y | `blueprint.animation.tweenY` | 对元素 Y 坐标做补间动画。 |
| Tween Size | `blueprint.animation.tweenSize` | 对元素尺寸做补间动画。 |
| Tween Scale | `blueprint.animation.tweenScale` | 对元素缩放做补间动画。 |
| Tween Rotation | `blueprint.animation.tweenRotation` | 对元素旋转做补间动画。 |
| Tween Opacity | `blueprint.animation.tweenOpacity` | 对元素透明度做补间动画。 |
| Tween Color | `blueprint.animation.tweenColor` | 对颜色值做补间动画。 |
| Tween Number | `blueprint.animation.tweenNumber` | 对数字值做补间动画并输出每帧值。 |
| Stop Tween | `blueprint.animation.stopTween` | 停止指定补间动画。 |
| Stop All Tweens | `blueprint.animation.stopAllTweens` | 停止目标元素上的全部补间动画。 |
| Is Tween Playing | `blueprint.animation.isTweenPlaying` | 判断补间动画是否正在播放。 |
| Fade In | `blueprint.animation.fadeIn` | 淡入元素。 |
| Fade Out | `blueprint.animation.fadeOut` | 淡出元素。 |
| Slide In | `blueprint.animation.slideIn` | 滑入元素。 |
| Slide Out | `blueprint.animation.slideOut` | 滑出元素。 |
| Pop In | `blueprint.animation.popIn` | 弹入元素。 |
| Pop Out | `blueprint.animation.popOut` | 弹出元素。 |
| Shake | `blueprint.animation.shake` | 抖动元素。 |
| Pulse | `blueprint.animation.pulse` | 脉冲缩放元素。 |
| Blink | `blueprint.animation.blink` | 闪烁元素。 |
| Flash | `blueprint.animation.flash` | 闪光提示元素。 |
| Count Number To | `blueprint.animation.countNumberTo` | 将数字显示从起始值递增或递减到目标值。 |
| Timeline | `blueprint.animation.timeline` | 按时间轴执行多个关键帧或事件。 |

## Timer

| 节点 | 类型 ID 建议 | 说明 |
| --- | --- | --- |
| Set Timer | `blueprint.timer.setTimer` | 设置一次性计时器。 |
| Clear Timer | `blueprint.timer.clearTimer` | 清除一次性计时器。 |
| Set Interval | `blueprint.timer.setInterval` | 设置重复计时器。 |
| Clear Interval | `blueprint.timer.clearInterval` | 清除重复计时器。 |
| Get Time | `blueprint.timer.getTime` | 获取当前 UI runtime 时间。 |
| Get Delta Time | `blueprint.timer.getDeltaTime` | 获取上一帧到当前帧的时间差。 |
| Wait Seconds | `blueprint.timer.waitSeconds` | 等待指定秒数后继续执行。 |
| Wait Frames | `blueprint.timer.waitFrames` | 等待指定帧数后继续执行。 |

## Broadcast

| 节点 | 类型 ID 建议 | 说明 |
| --- | --- | --- |
| Send Broadcast | `blueprint.broadcast.send` | 向指定范围广播事件和数据。 |
| Get Listener Count | `blueprint.broadcast.getListenerCount` | 获取指定广播事件的监听者数量。 |

## Network

| 节点 | 类型 ID 建议 | 说明 |
| --- | --- | --- |
| Fetch | `blueprint.network.fetch` | 通过 Host API 发起 HTTP 请求并按结果分支。 |

## Function / Macro / Shared Blueprint

| 节点 | 类型 ID 建议 | 说明 |
| --- | --- | --- |
| Function Entry | `blueprint.function.entry` | 函数图入口。 |
| Function Return | `blueprint.function.return` | 函数图返回值出口。 |
| Macro Entry | `blueprint.macro.entry` | 宏图入口。 |
| Macro Output | `blueprint.macro.output` | 宏图出口。 |
| Call Function | `blueprint.function.call` | 调用当前 blueprint 内函数。 |
| Call Macro | `blueprint.macro.call` | 调用当前 blueprint 内宏。 |
| Call Shared Blueprint | `blueprint.shared.call` | 调用共享 blueprint asset。 |

## Asset / Resource

| 节点 | 类型 ID 建议 | 说明 |
| --- | --- | --- |
| Preload Asset | `blueprint.asset.preload` | 预加载指定资源。 |
| Release Asset | `blueprint.asset.release` | 释放指定资源引用。 |
| Is Asset Loaded | `blueprint.asset.isLoaded` | 判断指定资源是否已加载。 |
| Get Asset Url | `blueprint.asset.getUrl` | 获取资源运行时 URL。 |
| Cache Asset | `blueprint.asset.cache` | 将资源加入运行时缓存。 |

## Localization

| 节点 | 类型 ID 建议 | 说明 |
| --- | --- | --- |
| Get Localized Text | `blueprint.localization.getText` | 按 key 获取本地化文本。 |
| Format Localized Text | `blueprint.localization.formatText` | 获取本地化文本并格式化占位符。 |
| Get Current Language | `blueprint.localization.getCurrentLanguage` | 获取当前语言。 |
| Set Preview Language | `blueprint.localization.setPreviewLanguage` | 在 UI 预览或 Dev Mode 中切换预览语言。 |
| Has Localized Text | `blueprint.localization.hasText` | 判断本地化 key 是否存在。 |

## Theme

| 节点 | 类型 ID 建议 | 说明 |
| --- | --- | --- |
| Get Theme Token | `blueprint.theme.getToken` | 读取主题 token。 |
| Set Theme Token | `blueprint.theme.setToken` | 设置主题 token。 |
| Apply Theme | `blueprint.theme.apply` | 应用指定主题。 |
| Get Current Theme | `blueprint.theme.getCurrent` | 获取当前主题 ID。 |

## Debug

| 节点 | 类型 ID 建议 | 说明 |
| --- | --- | --- |
| Print | `blueprint.debug.print` | 输出调试日志。 |
| Print Warning | `blueprint.debug.warning` | 输出警告日志。 |
| Print Error | `blueprint.debug.error` | 输出错误日志。 |
| Log JSON | `blueprint.debug.logJson` | 格式化输出 JSON。 |
| Assert | `blueprint.debug.assert` | 条件不满足时输出断言错误。 |
| Breakpoint | `blueprint.debug.breakpoint` | 在 Dev Mode 调试器中暂停执行。 |
| Trace | `blueprint.debug.trace` | 输出当前执行链路信息。 |
| Measure Time | `blueprint.debug.measureTime` | 测量一段逻辑执行耗时。 |
| Draw Debug Bounds | `blueprint.debug.drawBounds` | 在 Dev Mode 中绘制元素调试边界。 |
| Flash Element | `blueprint.debug.flashElement` | 在 Dev Mode 中短暂高亮元素。 |

## Error Handling

| 节点 | 类型 ID 建议 | 说明 |
| --- | --- | --- |
| Try | `blueprint.error.try` | 执行可能失败的逻辑并将错误导向 catch。 |
| Catch | `blueprint.error.catch` | 捕获错误并继续执行错误处理分支。 |
| Throw Error | `blueprint.error.throw` | 主动抛出错误。 |
| Is Error | `blueprint.error.isError` | 判断值是否为错误对象。 |
| Get Error Message | `blueprint.error.getMessage` | 获取错误消息。 |
| Fallback On Error | `blueprint.error.fallback` | 发生错误时返回备用值。 |
