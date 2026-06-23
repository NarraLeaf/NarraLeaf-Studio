# Boolean 节点

Boolean 节点用于纯布尔逻辑，可用于 `event`、`function` 和 `macro` 图。输入为 `boolean`，`result` 为传出 `boolean`。创建浮窗中这些节点归入 Math 分类。

## And

`blueprint.boolean.and` - 布尔与

- `a` - 第一个布尔值
- `b` - 第二个布尔值
- `result` - 两者都为真时为真（传出引脚）

## Or

`blueprint.boolean.or` - 布尔或

- `a` - 第一个布尔值
- `b` - 第二个布尔值
- `result` - 任意一个为真时为真（传出引脚）

## Not

`blueprint.boolean.not` - 布尔取反

- `a` - 要取反的布尔值
- `result` - 取反结果（传出引脚）

## Xor

`blueprint.boolean.xor` - 布尔异或

- `a` - 第一个布尔值
- `b` - 第二个布尔值
- `result` - 只有一个输入为真时为真（传出引脚）
