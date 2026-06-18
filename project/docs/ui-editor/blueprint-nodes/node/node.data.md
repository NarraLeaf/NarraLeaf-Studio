# Data 节点

Data 节点用于创建基础常量值，并在严格类型连接规则下提供显式转换路径。

## 常量

- `blueprint.data.stringLiteral` - 输出 `string`
- `blueprint.data.numberLiteral` - 输出 `float`
- `blueprint.data.booleanLiteral` - 输出 `boolean`
- `blueprint.data.nullLiteral` - 输出 `json`

## Return Value

`blueprint.data.returnValue` 只出现在 Blueprint Value 图中，用于把当前执行线路产出的值作为属性动态值返回。它有一个执行入口 `in` 和一个数据入口 `value`，没有后续执行出口。

如果一次 Blueprint Value 求值没有执行到 `returnValue`，运行时会保留上一次解析值；没有上一次解析值时回退到 UIDocument 中的字面 props。`string` 绑定会把返回结果转换为字符串，`null` / `undefined` 会变成空字符串；Page `params` 这类 `json` 绑定应返回 JSON object，非 object 结果会回退为空对象。

## 转换

- `blueprint.data.toFloat` - `any` 转 `float`
- `blueprint.data.toInteger` - `any` 转 `integer`
- `blueprint.data.toBoolean` - `any` 转 `boolean`
- `blueprint.data.parseInt` - `string` 解析为 `integer`
- `blueprint.data.parseFloat` - `string` 解析为 `float`


`string` 输入允许直接连接 `integer` / `float` 输出，并会在读取输入时自动转换为字符串。
