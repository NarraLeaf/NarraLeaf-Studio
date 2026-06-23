# JSON 节点

JSON 节点用于创建、组合、转换和读取结构化 JSON 值，创建浮窗中归入 Data 分类。`json` 不是通配类型；需要把 `float`、`string`、`boolean` 等值接入 JSON 输入时，优先使用显式 JSON 节点。

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

`path` 使用与 Get JSON Field 相同的点标记规则。

## Set JSON Field

`blueprint.data.jsonSet` - 按路径写入 JSON 字段并输出新 JSON

`json` 是输入 JSON；`path` 支持点标记和数组下标；`value` 是要写入的任意值。节点会复制输入并写入 JSON-safe 值，不会原地修改输入对象。空路径会用 `value` 替换整个 JSON。

## Remove JSON Field

`blueprint.data.jsonRemove` - 按路径移除 JSON 字段并输出新 JSON

`json` 是输入 JSON；`path` 支持点标记和数组下标。Object 字段会被删除；Array 下标会移除对应条目。路径不存在时输出复制后的原 JSON。

## Make JSON Object

`blueprint.data.jsonMakeObject` - 由命名输入创建 JSON Object

节点使用动态输入引脚。新建节点会自带一组 `Name` / `Value` 初始字段；每次在节点卡片上继续添加字段都会再生成一对输入引脚：`Name`（`string`，可内联输入或接入字符串输出）和 `Value`（`any`）。运行时按字段顺序读取 `Name` 作为输出 object 的字段名，再把对应 `Value` 写入该字段；字段名为空或与前面字段重复时会跳过该字段。

## Make JSON Array

`blueprint.data.jsonMakeArray` - 由顺序输入创建 JSON Array

节点使用动态输入引脚，并按引脚顺序生成数组条目。

## JSON Array Length

`blueprint.data.jsonArrayLength` - 获取 JSON Array 长度

输入不是数组时输出 `0`。

## Merge JSON Object

`blueprint.data.jsonMergeObject` - 合并两个 JSON Object

`a` 和 `b` 都按 JSON Object 处理，非 object 输入按空 object 处理。输出是浅合并后的新 object；同名字段以 `b` 的值为准。

## Clone JSON

`blueprint.data.jsonClone` - 深拷贝 JSON 值

输出输入值的 JSON-safe 深拷贝。`undefined` 会变成 `null`，不可序列化值会转换为安全值。
