# List 节点

List 节点用于读取和改写 `nl.list` 的运行时内容、选中项和滚动位置。创建浮窗中归入 `List` 分类；数组与对象处理仍归入 `Data` 分类。

List 节点的 `list` 输入是可选的 `element:nl.list`。未连接时，节点默认作用于当前 `nl.list` 私有蓝图所在的 List 实例；连接后可以覆盖目标 List。

`Set List Content` 写入的是 List 实例运行时 items。该内容只存在于当前运行时实例中，List 组件完全卸载后会清空；作者需要恢复内容时应自行从变量、状态或其他数据源重新写入。`itemsBinding` 只在没有运行时 items 时作为读取 fallback。

## 内容

- `blueprint.list.setItems` - 设置运行时内容；`items` 输入为 `array`，非数组按空数组处理
- `blueprint.list.getItems` - 获取当前运行时内容；没有运行时内容时读取 `itemsBinding` / 预览数据 fallback
- `blueprint.list.clear` - 将运行时内容设置为空数组
- `blueprint.list.appendItem` - 在末尾追加一项
- `blueprint.list.insertItem` - 在指定下标插入一项，下标会夹到有效范围
- `blueprint.list.removeItem` - 移除第一个 JSON 等价的项
- `blueprint.list.removeItemAt` - 移除指定下标的项
- `blueprint.list.refreshItems` - 以当前内容重新写入一次，触发条目刷新

## 选中

- `blueprint.list.getSelectedItem` - 获取当前选中项；没有有效选中项时输出 `null`
- `blueprint.list.setSelectedItem` - 按 JSON 等价查找并设置当前选中项
- `blueprint.list.getSelectedIndex` - 获取当前选中下标
- `blueprint.list.setSelectedIndex` - 设置当前选中下标

## 滚动

- `blueprint.list.scrollToIndex` - 滚动到指定条目
- `blueprint.list.scrollToTop` - 滚动到顶部
- `blueprint.list.scrollToBottom` - 滚动到底部

## 条目上下文

List 渲染每个条目时，会为 item template 后代元素提供独立的 List Item Context。上下文包含：

- `props` - 当 `item` 是 object 时为 `item` 本身，否则为 `{ value: item }`
- `item` - 当前条目原始 JSON-safe 数据
- `index` - 当前条目下标
- `count` - 本次渲染条目总数
- `key` - 条目 key，优先来自 `itemKeyPath`

子元素私有蓝图可以通过 `blueprint.event.head.listItemRefresh` 接收刷新事件，也可以在事件图和 Blueprint Value 图中用以下纯节点读取当前条目上下文：

- `blueprint.list.getItemProps` - 输出当前条目的 `props`
- `blueprint.list.getItemIndex` - 输出当前条目下标；没有上下文时为 `-1`
- `blueprint.list.getItemCount` - 输出条目总数；没有上下文时为 `0`
- `blueprint.list.getItemKey` - 输出条目 key；没有上下文时为空字符串

重复渲染的 item template 子元素会使用 `instanceKey` / `listItemScope` 隔离事件 locals 与 Blueprint Value 运行时值，因此相同 element id 的不同条目不会共享解析结果。
