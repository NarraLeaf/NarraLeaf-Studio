# Data 节点

Data 节点用于创建基础常量值，并在严格类型连接规则下提供显式转换路径。

## 常量

- `blueprint.data.stringLiteral` - 输出 `string`
- `blueprint.data.numberLiteral` - 输出 `float`
- `blueprint.data.booleanLiteral` - 输出 `boolean`
- `blueprint.data.nullLiteral` - 输出 `json`
- `blueprint.data.jsonLiteral` - 输出 `json`

## 转换

- `blueprint.data.toFloat` - `any` 转 `float`
- `blueprint.data.toInteger` - `any` 转 `integer`
- `blueprint.data.toBoolean` - `any` 转 `boolean`
- `blueprint.data.toJson` - `any` 显式转 `json`
- `blueprint.data.parseInt` - `string` 解析为 `integer`
- `blueprint.data.parseFloat` - `string` 解析为 `float`
- `blueprint.data.parseJson` - `string` 解析为 `json`
- `blueprint.data.stringifyJson` - `json` 转 `string`

## JSON

- `blueprint.data.jsonLiteral` - 在节点界面中直接编辑 JSON 常量，输出 `json`
- `blueprint.data.parseJson` - 从字符串解析 JSON。解析失败时输出 `null`
- `blueprint.data.stringifyJson` - 将 JSON 序列化为字符串
- `blueprint.data.jsonGet` - 从 JSON 中读取字段。`path` 支持点标记，例如 `user.profile.name`，数组下标可使用 `items.0`
- `blueprint.data.jsonHas` - 判断 JSON 中是否存在指定字段路径


`string` 输入允许直接连接 `integer` / `float` 输出，并会在读取输入时自动转换为字符串。

`json` 不是通配类型。需要把 `float`、`string`、`boolean` 等值接入 JSON 输入时，必须先经过显式转换节点。
