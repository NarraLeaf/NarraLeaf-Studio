# Flow 节点

Flow 节点用于控制事件图或宏图中的执行线路。

## If

`if` - 条件分支

根据布尔条件选择后续执行出口。

- `in` - 执行入口
- `condition` - 布尔条件
- `true` - 条件为真时的执行出口
- `false` - 条件为假时的执行出口

`If` 节点可用于 `event` 和 `macro` 图，不可用于 `function` 图。
