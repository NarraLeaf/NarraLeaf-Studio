# Debug 节点

Debug 节点用于调试输出和图内说明。`blueprint.flow.comment` 的稳定类型 ID 保持不变以兼容已有图，但节点分类显示在 Debug 下。

## Comment

`blueprint.flow.comment` - 图内注释框

用于在图中放置类似 UE 注释框的说明区域。该节点不参与执行链，也不产生数据；节点卡片自身就是可编辑注释，支持多行文本、颜色切换和拖拽调整尺寸。

- `text` - 注释文本
- `color` - 注释框颜色
- `background` - 背景层开关；关闭时注释框背景仍可见，但位于其它节点底层，可用于框选节点
- `width` - 注释框宽度
- `height` - 注释框高度

## Log

`blueprint.log` - 输出调试日志

读取 `value` 输入并输出到运行时 DevTools 日志；如果 Host API 不可用，也会写入浏览器 console。输出后继续执行 `next`。

- `in` - 执行入口
- `value` - 要输出的字符串
- `next` - 执行出口
