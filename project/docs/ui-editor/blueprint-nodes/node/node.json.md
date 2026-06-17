# JSON 节点

JSON 节点用于创建、组合、转换和读取结构化 JSON 值。`json` 不是通配类型；需要把 `float`、`string`、`boolean` 等值接入 JSON 输入时，优先使用显式 JSON 节点。

## JSON Literal

`blueprint.data.jsonLiteral` - 输出 `json`

节点卡片显示 JSON 根类型和摘要，编辑时使用树形表单。Object 支持命名字段，Array 支持顺序条目，所有编辑结果都会写入 JSON-safe 值。

## To JSON

`blueprint.data.toJson` - `any` 显式转 `json`

字符串会尝试按 JSON 解析；解析失败时保留原字符串。非 JSON-safe 值会转换为可序列化值。

## Parse JSON

`blueprint.data.parseJson` - `string` 解析为 `json`

解析失败时输出 `null`。

## Stringify JSON

`blueprint.data.stringifyJson` - `json` 转 `string`

## Get JSON Field

`blueprint.data.jsonGet` - 从 JSON 中读取字段

`path` 支持点标记，例如 `user.profile.name`，数组下标可使用 `items.0`。路径不存在时输出 `null`。

## Has JSON Field

`blueprint.data.jsonHas` - 判断 JSON 中是否存在指定字段路径

## Make JSON Object

`blueprint.data.jsonMakeObject` - 由命名输入创建 JSON Object

节点使用动态输入引脚。每个输入引脚的显示名会作为输出 object 的字段名，字段名必须非空且同级唯一。

## Make JSON Array

`blueprint.data.jsonMakeArray` - 由顺序输入创建 JSON Array

节点使用动态输入引脚，并按引脚顺序生成数组条目。

## JSON Array Length

`blueprint.data.jsonArrayLength` - 获取 JSON Array 长度

输入不是数组时输出 `0`。
