# UI Editor Blueprint 节点路线总表

本文汇总 UI Editor 蓝图系统建议提供的节点。列表包含当前已实现、已规划和建议新增的节点；节点按面向视觉小说 UI 制作的使用场景分类。

## Events

| 节点 | 类型 ID 建议 | 说明 |
| --- | --- | --- |
| On App Boot | `blueprint.event.head.appBoot` | **已实现**。应用 UI 运行时启动时触发。 |
| On Surface Init | `blueprint.event.head.surfaceInit` | **已实现**。Page 或 Game UI surface 初始化时触发。 |
| On Surface Unmount | `blueprint.event.head.surfaceUnmount` | **已实现**。Page 或 Game UI surface 卸载时触发。 |
| Before Surface Exit | `blueprint.event.head.beforeSurfaceExit` | **已实现**。Surface 退出动画开始之前触发；Surface 蓝图和仍挂载存活的元素私有蓝图可监听。 |
| After Surface Enter | `blueprint.event.head.afterSurfaceEnter` | **已实现**。Surface 进入动画结束之后触发；Surface 蓝图和仍挂载存活的元素私有蓝图可监听。 |
| On Key Down | `blueprint.event.head.keyDown` | **已实现**。运行时窗口指定键按下时触发；卡片 `Key` 字段使用键盘绑定浮窗，显示当前绑定并支持单键或 `Ctrl` / `Alt` / `Shift` / `Meta` 组合键；单键兼容 `KeyboardEvent.key` 大小写不敏感匹配；仅输出 `then`。 |
| On Key Up | `blueprint.event.head.keyUp` | **已实现**。运行时窗口指定键抬起时触发；卡片 `Key` 字段使用键盘绑定浮窗，显示当前绑定并支持单键或 `Ctrl` / `Alt` / `Shift` / `Meta` 组合键；单键兼容 `KeyboardEvent.key` 大小写不敏感匹配；仅输出 `then`。 |
| Any Key Down | `blueprint.event.head.anyKeyDown` | **已实现**。运行时窗口任意键按下时触发；Global 蓝图、当前 active Surface 蓝图和已挂载控件私有蓝图都会收到；输出 `key` 和修改键。 |
| Any Key Up | `blueprint.event.head.anyKeyUp` | **已实现**。运行时窗口任意键抬起时触发；Global 蓝图、当前 active Surface 蓝图和已挂载控件私有蓝图都会收到；输出 `key` 和修改键。 |
| On Init | `blueprint.event.head.init` | **已实现**。当前 widget 初始化时触发。 |
| On Unmount | `blueprint.event.head.unmount` | **已实现**。当前元素从运行时元素树卸载时触发。 |
| Mouse Click | `blueprint.event.head.mouseClick` | **已实现**。鼠标左键点击元素时触发。 |
| Mouse Double Click | `blueprint.event.head.mouseDoubleClick` | **已实现**。鼠标双击元素时触发。 |
| Mouse Enter | `blueprint.event.head.mouseEnter` | **已实现**。鼠标进入元素区域时触发。 |
| Mouse Leave | `blueprint.event.head.mouseLeave` | **已实现**。鼠标离开元素区域时触发。 |
| Mouse Move | `blueprint.event.head.mouseMove` | **已实现**。鼠标在元素上移动时触发。 |
| Mouse Down | `blueprint.event.head.mouseDown` | **已实现**。鼠标在元素上按下时触发。 |
| Mouse Up | `blueprint.event.head.mouseUp` | **已实现**。鼠标在元素上抬起时触发。 |
| Mouse Wheel | `blueprint.event.head.mouseWheel` | **已实现**。鼠标滚轮在元素上滚动时触发。 |
| Right Click | `blueprint.event.head.rightClick` | **已实现**。鼠标右键点击元素或当前 Surface 时触发。 |
| Focus | `blueprint.event.head.focus` | **已实现**。元素获得键盘、鼠标或手柄焦点时触发。 |
| Blur | `blueprint.event.head.blur` | **已实现**。元素失去焦点时触发。 |
| On Flush | `blueprint.event.head.flush` | **已实现**。当前元素被蓝图 Host API 显式更改属性并触发重绘后触发，输出对应 Element 引用；CSS 自动样式不触发。 |
| Element Flush | `blueprint.event.head.elementFlush` | **已实现**。像 Element 节点一样绑定同 Surface 的目标控件，监听该目标控件的 flush 事件并输出目标 Element 引用。 |
| Scroll | `blueprint.event.head.scroll` | **已实现**。可滚动元素发生滚动时触发。 |
| On Any Broadcast | `blueprint.event.head.onAnyBroadcast` | **已实现**。当前元素收到任意广播事件时触发。 |
| On Broadcast | `blueprint.event.head.onBroadcast` | **已实现**。当前元素收到指定广播事件时触发。 |
| On Item Render | `blueprint.event.head.itemRender` | **已实现**。List 或 Repeater 渲染单个条目时触发。 |
| On Item Click | `blueprint.event.head.itemClick` | **已实现**。List 或 Repeater 条目被点击时触发。 |
| On Item Hover | `blueprint.event.head.itemHover` | **已实现**。List 或 Repeater 条目被悬停时触发。 |
| On Selection Changed | `blueprint.event.head.selectionChanged` | **已实现**。List、选项组或可选择控件的选择项变化时触发。 |
| List Item Refresh | `blueprint.event.head.listItemRefresh` | **已实现**。List item template 后代元素收到当前 `props` / `item` / `index` / `count` / `key`。 |
| On Scroll End | `blueprint.event.head.scrollEnd` | **已实现**。列表或滚动容器滚动到末端时触发。 |
| On Preference Changed | `blueprint.event.head.preferenceChanged` | **已实现**。监听当前 `LiveGame` 指定 Game Preference（如 BGM Volume）变化；Inspector `Preference` 选择偏好键；输出 `then` / `value` / `previousValue`；订阅 NarraLeaf React `game.preference.onPreferenceChange`；Global 与 Surface 蓝图可用。 |
| On Any Preference Changed | `blueprint.event.head.anyPreferenceChanged` | **已实现**。监听当前 `LiveGame` 任意 Game Preference 变化；输出 `then` / `key` / `value` / `previousValue`；Global 与 Surface 蓝图可用。 |
| On Interval | `blueprint.event.head.timer` | 指定计时器触发时执行。 |

## Flow

| 节点 | 类型 ID 建议 | 说明 |
| --- | --- | --- |
| If | `if` | **已实现**。根据布尔条件选择 true 或 false 执行出口。 |
| If Else | `blueprint.flow.ifElse` | **已实现**。支持像 Concat 一样追加 If 条件；每个追加条件生成对应 Then 出口，最终固定 Else 作为兜底出口。 |
| Noop | `blueprint.flow.noop` | **已实现**。空操作，直接传递执行流。 |
| Sequence | `blueprint.flow.sequence` | **已实现**。按顺序排队执行多个出口。 |
| Switch String | `blueprint.flow.switchString` | **已实现**。根据字符串值进入匹配分支。 |
| For Loop | `blueprint.flow.forLoop` | **已实现**。执行有界整数循环。 |
| For Each | `blueprint.flow.forEach` | **已实现**。遍历 JSON 数组中的每一项。 |
| While | `blueprint.flow.while` | **已实现**。在条件为真时执行有界循环。 |
| Delay | `blueprint.flow.delay` | **已实现**。等待指定秒数后继续执行。 |
| Early Return | `blueprint.flow.return` | **已实现**。提前结束当前函数、宏或事件执行链。 |

## Variables

| 节点 | 类型 ID 建议 | 说明 |
| --- | --- | --- |
| Get Var | `blueprint.local.get` | **已实现**。读取执行局部变量。 |
| Set Var | `blueprint.local.set` | **已实现**。写入执行局部变量。 |
| Get Persistent | `blueprint.persistent.get` | **已实现**。异步读取项目级 Persistent 变量；缺失已保存值时返回变量默认值。 |
| Set Persistent | `blueprint.persistent.set` | **已实现**。异步写入项目级 Persistent 变量。 |

## Data（Palette: Data，包含 String / JSON）

| 节点 | 类型 ID 建议 | 说明 |
| --- | --- | --- |
| Boolean Literal | `blueprint.data.booleanLiteral` | **已实现**。输出布尔常量。 |
| Integer Literal | `blueprint.data.integerLiteral` | **已实现**。输出整数常量。 |
| Float Literal | `blueprint.data.floatLiteral` | **已实现**。输出浮点数常量。 |
| String Literal | `blueprint.data.stringLiteral` | **已实现**。输出字符串常量。 |
| Color Literal | `blueprint.data.colorLiteral` | **已实现**。输出颜色常量。 |
| Rect Literal | `blueprint.data.rectLiteral` | **已实现**。输出矩形常量。 |
| Null | `blueprint.data.nullLiteral` | **已实现**。输出 null。 |
| Is String | `blueprint.data.isString` | **已实现**。判断值是否为字符串。 |
| Is Number | `blueprint.data.isNumber` | **已实现**。判断值是否为数字。 |
| Is Boolean | `blueprint.data.isBoolean` | **已实现**。判断值是否为布尔值。 |
| Is Array | `blueprint.data.isArray` | **已实现**。判断值是否为数组。 |
| Is Object | `blueprint.data.isObject` | **已实现**。判断值是否为对象。 |
| Is Null | `blueprint.data.isNull` | **已实现**。判断值是否为 null。 |
| Is Empty Value | `blueprint.data.isEmptyValue` | **已实现**。判断值是否为空字符串、空数组、空对象、null 或 undefined。 |
| To Boolean | `blueprint.data.toBoolean` | **已实现**。将值转换为布尔值。 |
| To Integer | `blueprint.data.toInteger` | **已实现**。将值转换为整数。 |
| To Float | `blueprint.data.toFloat` | **已实现**。将值转换为浮点数。 |
| To JSON | `blueprint.data.toJson` | **已实现**。将值转换为 JSON-safe 值。 |

## Boolean / Compare（Palette: Math）

| 节点 | 类型 ID 建议 | 说明 |
| --- | --- | --- |
| And | `blueprint.boolean.and` | **已实现**。布尔与。 |
| Or | `blueprint.boolean.or` | **已实现**。布尔或。 |
| Not | `blueprint.boolean.not` | **已实现**。布尔取反。 |
| Xor | `blueprint.boolean.xor` | **已实现**。布尔异或。 |
| Equal | `blueprint.compare.equal` | **已实现**。严格相等，使用 JavaScript `===`。 |
| Not Equal | `blueprint.compare.notEqual` | **已实现**。严格不相等，使用 JavaScript `!==`。 |
| Greater Than | `blueprint.compare.greaterThan` | **已实现**。判断 a 是否大于 b。 |
| Greater Than Or Equal | `blueprint.compare.greaterThanOrEqual` | **已实现**。判断 a 是否大于等于 b。 |
| Less Than | `blueprint.compare.lessThan` | **已实现**。判断 a 是否小于 b。 |
| Less Than Or Equal | `blueprint.compare.lessThanOrEqual` | **已实现**。判断 a 是否小于等于 b。 |

## Math（Palette: Math）

| 节点 | 类型 ID 建议 | 说明 |
| --- | --- | --- |
| Add | `blueprint.math.add` | **已实现**。数字相加。 |
| Subtract | `blueprint.math.subtract` | **已实现**。数字相减。 |
| Multiply | `blueprint.math.multiply` | **已实现**。数字相乘。 |
| Divide | `blueprint.math.divide` | **已实现**。数字相除。 |
| Modulo | `blueprint.math.modulo` | **已实现**。取余。 |
| Increment | `blueprint.math.increment` | **已实现**。数字加 1。 |
| Decrement | `blueprint.math.decrement` | **已实现**。数字减 1。 |
| Abs | `blueprint.math.abs` | **已实现**。绝对值。 |
| Min | `blueprint.math.min` | **已实现**。返回最小值；支持动态输入。 |
| Max | `blueprint.math.max` | **已实现**。返回最大值；支持动态输入。 |
| Round | `blueprint.math.round` | **已实现**。四舍五入并输出整数。 |
| Floor | `blueprint.math.floor` | **已实现**。向下取整并输出整数。 |
| Ceil | `blueprint.math.ceil` | **已实现**。向上取整并输出整数。 |
| Random Float | `blueprint.math.randomFloat` | **已实现**。输出指定范围内的随机浮点数。 |
| Random Integer | `blueprint.math.randomInteger` | **已实现**。输出指定范围内的随机整数。 |

## String（Palette: Data）

| 节点 | 类型 ID 建议 | 说明 |
| --- | --- | --- |
| To String | `blueprint.string.toString` | **已实现**。将任意值转换为字符串。 |
| Concat | `blueprint.string.concat` | **已实现**。拼接多个字符串。 |
| Format | `blueprint.string.format` | **已实现**。使用数据替换模板占位符。 |
| Length | `blueprint.string.length` | **已实现**。获取字符串长度。 |
| Is Empty | `blueprint.string.isEmpty` | **已实现**。判断字符串是否为空。 |
| Is Blank | `blueprint.string.isBlank` | **已实现**。判断字符串是否为空白。 |
| Trim | `blueprint.string.trim` | **已实现**。移除两端空白。 |
| Trim Start | `blueprint.string.trimStart` | **已实现**。移除开头空白。 |
| Trim End | `blueprint.string.trimEnd` | **已实现**。移除结尾空白。 |
| To Upper Case | `blueprint.string.toUpperCase` | **已实现**。转换为大写。 |
| To Lower Case | `blueprint.string.toLowerCase` | **已实现**。转换为小写。 |
| Capitalize | `blueprint.string.capitalize` | **已实现**。首字母大写。 |
| Contains | `blueprint.string.contains` | **已实现**。判断是否包含子字符串。 |
| Starts With | `blueprint.string.startsWith` | **已实现**。判断是否以指定字符串开头。 |
| Ends With | `blueprint.string.endsWith` | **已实现**。判断是否以指定字符串结尾。 |
| Equals | `blueprint.string.equals` | **已实现**。判断字符串是否相等。 |
| Equals Ignore Case | `blueprint.string.equalsIgnoreCase` | **已实现**。忽略大小写判断字符串是否相等。 |
| Index Of | `blueprint.string.indexOf` | **已实现**。查找子字符串首次出现位置。 |
| Last Index Of | `blueprint.string.lastIndexOf` | **已实现**。查找子字符串最后出现位置。 |
| Count | `blueprint.string.count` | **已实现**。统计子字符串出现次数。 |
| Char At | `blueprint.string.charAt` | **已实现**。获取指定位置字符。 |
| Substring | `blueprint.string.substring` | **已实现**。截取字符串。 |
| Insert | `blueprint.string.insert` | **已实现**。在指定位置插入字符串。 |
| Replace | `blueprint.string.replace` | **已实现**。替换第一个匹配字符串。 |
| Replace All | `blueprint.string.replaceAll` | **已实现**。替换所有匹配字符串。 |
| Split | `blueprint.string.split` | **已实现**。按分隔符拆分字符串。 |
| Join | `blueprint.string.join` | **已实现**。将字符串数组连接为字符串。 |
| Repeat | `blueprint.string.repeat` | **已实现**。重复字符串。 |
| Pad Start | `blueprint.string.padStart` | **已实现**。在开头填充字符串到指定长度。 |
| Pad End | `blueprint.string.padEnd` | **已实现**。在结尾填充字符串到指定长度。 |
| Matches Regex | `blueprint.string.matchesRegex` | **已实现**。判断字符串是否匹配正则。 |
| Extract Regex | `blueprint.string.extractRegex` | **已实现**。提取正则匹配结果。 |
| Normalize Line Breaks | `blueprint.string.normalizeLineBreaks` | **已实现**。统一换行符格式。 |

## JSON（Palette: Data）

| 节点 | 类型 ID 建议 | 说明 |
| --- | --- | --- |
| JSON Literal | `blueprint.data.jsonLiteral` | **已实现**。输出 JSON 常量。 |
| To JSON | `blueprint.data.toJson` | **已实现**。将任意值转换为 JSON。 |
| Parse JSON | `blueprint.data.parseJson` | **已实现**。将字符串解析为 JSON。 |
| Stringify JSON | `blueprint.data.stringifyJson` | **已实现**。将 JSON 转换为字符串。 |
| Get JSON Field | `blueprint.data.jsonGet` | **已实现**。按路径读取 JSON 字段。 |
| Has JSON Field | `blueprint.data.jsonHas` | **已实现**。判断 JSON 路径是否存在。 |
| Set JSON Field | `blueprint.data.jsonSet` | **已实现**。按路径写入 JSON 字段并输出新 JSON。 |
| Remove JSON Field | `blueprint.data.jsonRemove` | **已实现**。按路径移除 JSON 字段并输出新 JSON。 |
| Make JSON Object | `blueprint.data.jsonMakeObject` | **已实现**。由动态命名输入创建 JSON Object。 |
| Make JSON Array | `blueprint.data.jsonMakeArray` | **已实现**。由动态输入创建 JSON Array。 |
| JSON Array Length | `blueprint.data.jsonArrayLength` | **已实现**。获取 JSON Array 长度。 |
| Merge JSON Object | `blueprint.data.jsonMergeObject` | **已实现**。合并两个 JSON Object。 |
| Clone JSON | `blueprint.data.jsonClone` | **已实现**。深拷贝 JSON 值。 |

## Collection

| 节点 | 类型 ID 建议 | 说明 |
| --- | --- | --- |
| Array Length | `blueprint.collection.arrayLength` | **已实现**。获取数组长度。 |
| Array Get | `blueprint.collection.arrayGet` | **已实现**。读取指定下标的数组项。 |
| Array Set | `blueprint.collection.arraySet` | **已实现**。写入指定下标的数组项并输出新数组。 |
| Array Push | `blueprint.collection.arrayPush` | **已实现**。在数组末尾追加项。 |
| Array Insert | `blueprint.collection.arrayInsert` | **已实现**。在指定下标插入项。 |
| Array Remove | `blueprint.collection.arrayRemove` | **已实现**。移除指定值。 |
| Array Remove At | `blueprint.collection.arrayRemoveAt` | **已实现**。移除指定下标的项。 |
| Array Contains | `blueprint.collection.arrayContains` | **已实现**。判断数组是否包含指定值。 |
| Array Find | `blueprint.collection.arrayFind` | **planned/disabled**。保留稳定 ID，回调/谓词图模型后续设计，不注册 palette/runtime。 |
| Array Filter | `blueprint.collection.arrayFilter` | **planned/disabled**。保留稳定 ID，回调/谓词图模型后续设计，不注册 palette/runtime。 |
| Array Map | `blueprint.collection.arrayMap` | **planned/disabled**。保留稳定 ID，回调/谓词图模型后续设计，不注册 palette/runtime。 |
| Array Sort | `blueprint.collection.arraySort` | **planned/disabled**。保留稳定 ID，比较器图模型后续设计，不注册 palette/runtime。 |
| Array Slice | `blueprint.collection.arraySlice` | **已实现**。截取数组片段。 |
| Array Join | `blueprint.collection.arrayJoin` | **已实现**。将数组连接为字符串。 |
| Object Keys | `blueprint.collection.objectKeys` | **已实现**。获取对象字段名数组。 |
| Object Values | `blueprint.collection.objectValues` | **已实现**。获取对象值数组。 |
| Object Merge | `blueprint.collection.objectMerge` | **已实现**。合并对象。 |
| Object Set Field | `blueprint.collection.objectSetField` | **已实现**。写入对象字段并输出新对象。 |
| Object Remove Field | `blueprint.collection.objectRemoveField` | **已实现**。移除对象字段并输出新对象。 |

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
| Get Text | `blueprint.text.getText` | **已实现**。获取文本内容。 |
| Set Text | `blueprint.text.setText` | **已实现**。设置文本内容。 |
| Append Text | `blueprint.text.appendText` | **已实现**。在文本末尾追加内容。 |
| Clear Text | `blueprint.text.clearText` | **已实现**。清空文本内容。 |
| Get Font | `blueprint.text.getFont` | **已实现**。获取字体资源 ID。 |
| Set Font | `blueprint.text.setFont` | **已实现**。设置字体资源 ID。 |
| Get Font Size | `blueprint.text.getFontSize` | **已实现**。获取字号。 |
| Set Font Size | `blueprint.text.setFontSize` | **已实现**。设置字号。 |
| Get Font Weight | `blueprint.text.getFontWeight` | **已实现**。获取字重。 |
| Set Font Weight | `blueprint.text.setFontWeight` | **已实现**。设置字重。 |
| Get Text Color | `blueprint.text.getTextColor` | **已实现**。获取文本颜色。 |
| Set Text Color | `blueprint.text.setTextColor` | **已实现**。设置文本颜色。 |
| Get Text Align | `blueprint.text.getTextAlign` | **已实现**。获取横向对齐。 |
| Set Text Align | `blueprint.text.setTextAlign` | **已实现**。设置横向对齐。 |
| Get Text Vertical Align | `blueprint.text.getTextVerticalAlign` | **已实现**。获取纵向对齐。 |
| Set Text Vertical Align | `blueprint.text.setTextVerticalAlign` | **已实现**。设置纵向对齐。 |
| Get Line Height | `blueprint.text.getLineHeight` | **已实现**。获取行高。 |
| Set Line Height | `blueprint.text.setLineHeight` | **已实现**。设置行高。 |
| Get Wrap Mode | `blueprint.text.getWrapMode` | **已实现**。获取换行模式。 |
| Set Wrap Mode | `blueprint.text.setWrapMode` | **已实现**。设置换行模式。 |
| Get Effects | `blueprint.text.getEffects` | **已实现**。获取文本静态效果。 |
| Set Effects | `blueprint.text.setEffects` | **已实现**。设置文本静态效果。 |
| Get All Properties | `blueprint.text.getAllProperties` | **已实现**。一次性获取文本元素全部属性。 |
| Set All Properties | `blueprint.text.setAllProperties` | **已实现**。一次性设置文本元素全部属性。 |

## Slider

| 节点 | 类型 ID 建议 | 说明 |
| --- | --- | --- |
| Get Value | `blueprint.slider.getValue` | **已实现**。Slider 分类下读取 `nl.slider` 当前运行时映射值；由绑定 Slider 派生时显示为 `Slider:Get Value`。输出的是 `min` / `max` / `step` 映射后的值，不是 0-1 normalized 值。 |
| Get Normalized Value | `blueprint.slider.getNormalizedValue` | **已实现**。读取当前运行时 0-1 normalized 值。 |
| Get Slider Range | `blueprint.slider.getRange` | **已实现**。读取当前运行时 `min`、`max`、`step`。 |
| Set Slider Value | `blueprint.slider.setValue` | **已实现**。设置运行时映射值，并按范围和步进规范化。 |
| Set Slider Range | `blueprint.slider.setRange` | **已实现**。设置运行时 `min`、`max`、`step`，并重新规范化当前值。 |

Slider/List 的 Element 派生条目只负责创建菜单分类和标签，不自动连线；放置后需要手动连接 Element Literal 或 Element Flush 的 `element` 输出到目标输入。

## Image

| 节点 | 类型 ID 建议 | 说明 |
| --- | --- | --- |
| Get Source | `blueprint.image.getSource` | 获取图片来源。 |
| Set Source | `blueprint.image.setSource` | 设置图片来源。 |
| Clear Source | `blueprint.image.clearSource` | 清空图片来源。 |
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
| Set Pointer | `blueprint.button.setPointer` | **已实现**。通过卡片上的带鼠标图标下拉框设置按钮默认指针形态。 |
| Set Button Variant | `blueprint.button.setVariant` | 设置按钮视觉状态。 |
| Click Button | `blueprint.button.click` | 主动触发按钮点击逻辑。 |

## List

| 节点 | 类型 ID 建议 | 说明 |
| --- | --- | --- |
| Set List Content | `blueprint.list.setItems` | **已实现**。设置 List 实例运行时内容；输入为 `array`。 |
| Get List Content | `blueprint.list.getItems` | **已实现**。获取当前运行时内容，未设置时 fallback 到 `itemsBinding` / 预览数据。 |
| Clear List | `blueprint.list.clear` | **已实现**。将运行时内容设置为空数组。 |
| Append List Item | `blueprint.list.appendItem` | **已实现**。在列表末尾追加数据项。 |
| Insert List Item | `blueprint.list.insertItem` | **已实现**。在指定下标插入数据项。 |
| Remove List Item | `blueprint.list.removeItem` | **已实现**。移除第一个 JSON 等价数据项。 |
| Remove List Item At | `blueprint.list.removeItemAt` | **已实现**。移除指定下标的数据项。 |
| Get Selected Item | `blueprint.list.getSelectedItem` | **已实现**。获取当前选中数据项。 |
| Set Selected Item | `blueprint.list.setSelectedItem` | **已实现**。按 JSON 等价项设置当前选中数据项。 |
| Get Selected Index | `blueprint.list.getSelectedIndex` | **已实现**。获取当前选中下标。 |
| Set Selected Index | `blueprint.list.setSelectedIndex` | **已实现**。设置当前选中下标。 |
| Refresh Items | `blueprint.list.refreshItems` | **已实现**。重新写入当前运行时内容并触发条目刷新。 |
| Scroll To Index | `blueprint.list.scrollToIndex` | **已实现**。滚动到指定条目。 |
| Scroll To Top | `blueprint.list.scrollToTop` | **已实现**。滚动到顶部。 |
| Scroll To Bottom | `blueprint.list.scrollToBottom` | **已实现**。滚动到底部。 |
| Get List Item Props | `blueprint.list.getItemProps` | **已实现**。读取当前 List item `props`。 |
| Get List Item Index | `blueprint.list.getItemIndex` | **已实现**。读取当前 List item 下标。 |
| Get List Item Count | `blueprint.list.getItemCount` | **已实现**。读取当前 List item 总数。 |
| Get List Item Key | `blueprint.list.getItemKey` | **已实现**。读取当前 List item key。 |

## Page

| 节点 | 类型 ID 建议 | 说明 |
| --- | --- | --- |
| Open Page | `blueprint.page.open` | 打开指定 Page。 |
| Close Page | `blueprint.page.close` | 关闭当前或指定 Page。 |
| Replace Page | `blueprint.page.replace` | 使用指定 Page 替换当前 Page。 |
| Back | `blueprint.page.back` | 返回上一 Page。 |
| Can Go Back | `blueprint.page.canGoBack` | 判断是否可以返回上一 Page。 |
| Get Current Page | `blueprint.page.getCurrent` | 获取当前 Page ID。 |
| Is Surface Exiting | `blueprint.page.isSurfaceExiting` | **已实现**。读取当前 Surface 是否处于退出动画状态。 |
| Is Surface Entering | `blueprint.page.isSurfaceEntering` | **已实现**。读取当前 Surface 是否处于进入动画状态。 |
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
| Send Broadcast | `blueprint.broadcast.send` | **已实现**。向指定范围广播事件和数据。 |
| Get Listener Count | `blueprint.broadcast.getListenerCount` | **已实现**。获取指定广播事件的监听者数量。 |

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
| Comment | `blueprint.flow.comment` | **已实现**。Debug 分类下的图内注释框；稳定类型 ID 保持不变，支持多行文本、颜色、背景和尺寸编辑，关闭背景后可作为底层框选区域，不参与执行。 |
| Log | `blueprint.log` | **已实现**。输出字符串调试日志并继续执行。 |
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
