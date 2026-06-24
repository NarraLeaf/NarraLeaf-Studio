# Data 节点

Data 节点用于创建基础常量值，并在严格类型连接规则下提供显式转换路径。

## 常量

- `blueprint.data.stringLiteral` - `String` 常量，输出 `string`
- `blueprint.data.integerLiteral` - 输出 `integer`
- `blueprint.data.floatLiteral` - 输出 `float`
- `blueprint.data.numberLiteral` - 输出 `float`；旧版 Number 常量，保留兼容旧图，新建时隐藏
- `blueprint.data.booleanLiteral` - 输出 `boolean`
- `blueprint.data.nullLiteral` - 输出 `json`
- `blueprint.data.colorLiteral` - 输出 `RGBAColor`，节点卡片上使用颜色选择器编辑，并以 8 位 RGBA hex 显示
- `blueprint.data.vector2dLiteral` - 输出 `Vector2D`，值为固定 `{ x: number, y: number }` schema，JSON Raw 编辑也会校验字段和类型
- `blueprint.data.rectLiteral` - 输出 `json`，值为固定 `{ x: number, y: number, width: number, height: number }` schema，JSON Raw 编辑也会校验字段和类型

## Collection

Collection 节点归入 Data 分类，用于处理 `array` 与 JSON object。`array` 是独立 pin/变量类型；`array` 输出可以连接到 `json` 输入，Collection 与 List 的数组输入会接受 `array` 或 JSON array，非数组归一为空数组。

- `blueprint.collection.arrayLength` - 输出数组长度
- `blueprint.collection.arrayGet` - 读取指定下标的数组项；越界输出 `null`
- `blueprint.collection.arraySet` - 写入指定下标并输出新数组
- `blueprint.collection.arrayPush` - 在末尾追加项并输出新数组
- `blueprint.collection.arrayInsert` - 在指定下标插入项并输出新数组
- `blueprint.collection.arrayRemove` - 移除第一个 JSON 等价的项
- `blueprint.collection.arrayRemoveAt` - 移除指定下标的项
- `blueprint.collection.arrayContains` - 判断数组是否包含 JSON 等价项
- `blueprint.collection.arraySlice` - 截取数组片段
- `blueprint.collection.arrayJoin` - 将数组项转为字符串并连接
- `blueprint.collection.objectKeys` - 输出对象字段名数组
- `blueprint.collection.objectValues` - 输出对象字段值数组
- `blueprint.collection.objectMerge` - 浅合并两个 object
- `blueprint.collection.objectSetField` - 写入 object 字段并输出新 object
- `blueprint.collection.objectRemoveField` - 移除 object 字段并输出新 object

`blueprint.collection.arrayFind`、`arrayFilter`、`arrayMap`、`arraySort` 只保留稳定常量和 planned/disabled 文档；回调/谓词图模型未完成前不注册到 palette/runtime。

## Return Value

`blueprint.data.returnValue` 只出现在 Blueprint Value 图中，用于把当前执行线路产出的值作为属性动态值返回。它有一个执行入口 `in` 和一个数据入口 `value`，没有后续执行出口。

如果一次 Blueprint Value 求值没有执行到 `returnValue`，运行时会保留上一次解析值；没有上一次解析值时回退到 UIDocument 中的字面 props。`string` 绑定会把返回结果转换为字符串，`null` / `undefined` 会变成空字符串；Page `params` 这类 `json` 绑定应返回 JSON object，非 object 结果会回退为空对象。

## 转换

- `blueprint.data.toFloat` - `any` 转 `float`
- `blueprint.data.toInteger` - `any` 转 `integer`
- `blueprint.data.toBoolean` - `any` 转 `boolean`
- `blueprint.data.toJson` - `any` 转 JSON-safe 值；对象和数组会递归复制，无法序列化的值会变为 `null`
- `blueprint.data.parseInt` - `string` 解析为 `integer`
- `blueprint.data.parseFloat` - `string` 解析为 `float`

## 类型判断

- `blueprint.data.isString` - 判断 `any` 是否为 `string`
- `blueprint.data.isNumber` - 判断 `any` 是否为有限数字
- `blueprint.data.isBoolean` - 判断 `any` 是否为 `boolean`
- `blueprint.data.isArray` - 判断 `any` 是否为数组
- `blueprint.data.isObject` - 判断 `any` 是否为非数组对象
- `blueprint.data.isNull` - 判断 `any` 是否为 `null`
- `blueprint.data.isEmptyValue` - 判断 `any` 是否为空字符串、空数组、空对象、`null` 或 `undefined`


`integer` 输出允许直接连接 `float` 输入。`string` 输入允许直接连接 `integer` / `float` 输出，并会在读取输入时自动转换为字符串。
