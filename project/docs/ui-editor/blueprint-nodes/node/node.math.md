# Math 节点

Math 节点用于纯数值计算、布尔逻辑和值比较。除非额外声明，数值输入引脚均接受 `float` 并支持卡片内联数字；`result` 为传出值。`integer` 输出可以直接连接到 `float` 输入。

## 四则与取余

- `blueprint.math.add` - `a` + `b`，输出 `float`；支持动态增加更多输入
- `blueprint.math.subtract` - `a` - `b`，输出 `float`
- `blueprint.math.multiply` - `a` * `b`，输出 `float`
- `blueprint.math.divide` - `a` / `b`，输出 `float`
- `blueprint.math.modulo` - `a` % `b`，输出 `float`

## 单值计算

- `blueprint.math.increment` - `value` + 1，输出 `float`
- `blueprint.math.decrement` - `value` - 1，输出 `float`
- `blueprint.math.abs` - `value` 的绝对值，输出 `float`
- `blueprint.math.round` - 四舍五入，输出 `integer`
- `blueprint.math.floor` - 向下取整，输出 `integer`
- `blueprint.math.ceil` - 向上取整，输出 `integer`

## 范围

- `blueprint.math.min` - 返回最小值，输出 `float`；支持动态增加更多输入
- `blueprint.math.max` - 返回最大值，输出 `float`；支持动态增加更多输入

## 随机

- `blueprint.math.randomFloat` - 在 `min` / `max` 范围内输出随机 `float`
- `blueprint.math.randomInteger` - 在 `min` / `max` 范围内输出随机 `integer`

## 兼容比较

以下旧版 Math 比较节点仍然注册，已有的图照常加载和运行，但添加节点面板不再列出它们；新图使用 `blueprint.compare.*`（见 [Compare 节点](node.compare.md)），在面板中搜索 `>`、`<=`、`≠` 这类符号即可找到。两组节点只有相等判断不同：这里的 `=` / `≠` 先把两边读作数字，所以文本 `"1"` 等于数字 `1`；`Equal` / `Not Equal` 是严格比较。四个大小比较的行为两组完全相同。输出均为 `boolean`。

- `blueprint.math.equal` - 数值相等
- `blueprint.math.notEqual` - 数值不相等
- `blueprint.math.less` - 小于
- `blueprint.math.lessOrEqual` - 小于等于
- `blueprint.math.greater` - 大于
- `blueprint.math.greaterOrEqual` - 大于等于
