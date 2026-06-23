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

以下旧版 Math 比较节点保留在 Math 分类中，输出 `boolean`。`blueprint.compare.*` 严格比较节点也归入 Math 分类。

- `blueprint.math.equal` - 数值相等
- `blueprint.math.notEqual` - 数值不相等
- `blueprint.math.less` - 小于
- `blueprint.math.lessOrEqual` - 小于等于
- `blueprint.math.greater` - 大于
- `blueprint.math.greaterOrEqual` - 大于等于
