# Page 节点

除非额外声明，所有参数均为传入引脚值；标注（传出引脚）的参数为传出值。

Page 节点用于 Page 组件和被嵌入 Page 之间的通信。顶层 Page 没有父级 Page 组件时，读取参数会得到空值，发送事件不会触发父级事件。

这些节点不同于 Frame Widget Property。`blueprint.frame.getParam` / `blueprint.frame.emit` 面向被嵌入 Page 的通信上下文；`nl.frame` 组件自己的目标 Page 和 params 读写方法记录在 `node.widget.md`。

## Get Page Param

`blueprint.frame.getParam` - 读取 Page 参数

读取父级 Page 组件传入当前嵌入 Page runtime scope 的参数值。
- `key` - 参数名
- `value` - 参数值（传出引脚）

## Emit Page Event

`blueprint.frame.emit` - 发送 Page 事件

向父级 Page 组件实例发送事件。父级 `nl.frame` 元素的私有蓝图可以通过 `Page Event` 事件 Head 接收。
- `in` - 执行入口
- `event` - 事件名
- `data` - 事件数据
- `next` - 执行出口
