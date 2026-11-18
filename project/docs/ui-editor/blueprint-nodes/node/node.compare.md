# Compare 节点

Compare 节点用于纯值比较，可用于 `event`、`function` 和 `macro` 图。所有节点都通过 `result` 输出 `boolean`。创建浮窗中这些节点归入 Math 分类。

## Equal

`blueprint.compare.equal` - 按值相等

数字和文本分别按值比较，列表逐项比较，对象按字段内容比较，不受字段顺序影响。
不同类型不会自动转换：例如数字 `1` 和字符串 `"1"` 不相等。未连接的输入和非有限数按 Null 比较。

- `a` - 第一个值
- `b` - 第二个值
- `result` - 两个值的内容相同时为真（传出引脚）

## Not Equal

`blueprint.compare.notEqual` - 按值不相等

使用与 Equal 相同的值比较规则，结果取反。

- `a` - 第一个值
- `b` - 第二个值
- `result` - 两个值的内容不同时为真（传出引脚）

## 数值比较

数值比较节点的 `a` / `b` 输入为 `float`，支持卡片内联数字。输入不能解析为有限数字时，比较结果为 `false`。

- `blueprint.compare.greaterThan` - `a` 大于 `b`
- `blueprint.compare.greaterThanOrEqual` - `a` 大于等于 `b`
- `blueprint.compare.lessThan` - `a` 小于 `b`
- `blueprint.compare.lessThanOrEqual` - `a` 小于等于 `b`
