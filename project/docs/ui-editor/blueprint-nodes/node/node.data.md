# Data 节点

Data 节点用于创建基础常量值，并在严格类型连接规则下提供显式转换路径。

## 常量

- `blueprint.data.stringLiteral` - 输出 `string`
- `blueprint.data.numberLiteral` - 输出 `float`
- `blueprint.data.booleanLiteral` - 输出 `boolean`
- `blueprint.data.nullLiteral` - 输出 `json`

## 转换

- `blueprint.data.toFloat` - `any` 转 `float`
- `blueprint.data.toInteger` - `any` 转 `integer`
- `blueprint.data.toBoolean` - `any` 转 `boolean`
- `blueprint.data.parseInt` - `string` 解析为 `integer`
- `blueprint.data.parseFloat` - `string` 解析为 `float`


`string` 输入允许直接连接 `integer` / `float` 输出，并会在读取输入时自动转换为字符串。
