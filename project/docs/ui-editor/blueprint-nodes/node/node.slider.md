# Slider 节点

Slider 节点用于读取和改写 `nl.slider` 的运行时数值。

Slider Self 节点只在 `nl.slider` 自己的私有蓝图中出现，创建浮窗中归入 `Slider` 分类，且没有 `slider` 输入。运行时通过当前执行 owner 操作自己。

Slider Element 节点使用 `blueprint.element.slider.*`，带 `slider: element:nl.slider` 输入，创建浮窗中归入 `Element` 分类。它们只有在当前图中已有绑定到 `nl.slider` 的 Element Literal 或 Element Flush 时才会显示；同一节点类型只显示一项。若兼容来源唯一，放置时会自动连接 `slider` 输入；若有多个兼容来源，则保留 `slider` 输入由作者手动选择/连接。

## 值

- `blueprint.slider.getValue` / `blueprint.element.slider.getValue` - 读取当前运行时映射值。该值已经按 Slider 的 `min` / `max` / `step` 映射、clamp 和 snap，不是 0-1 normalized 值
- `blueprint.slider.getNormalizedValue` - 读取当前运行时 0-1 normalized 值
- `blueprint.slider.setValue` - 设置运行时映射值，并按范围和步进规范化

## 范围

- `blueprint.slider.getRange` - 读取当前运行时 `min`、`max`、`step`
- `blueprint.slider.setRange` - 设置运行时 `min`、`max`、`step`，并重新规范化当前运行时值

Element 版对应稳定 ID 使用 `blueprint.element.slider.getNormalizedValue`、`blueprint.element.slider.getRange`、`blueprint.element.slider.setValue`、`blueprint.element.slider.setRange`。

`Set Slider Value` 与 `Set Slider Range` 只更新运行时状态，不自动派发 Slider `valueChanged` / `dragStart` / `dragEnd` 事件，也不写回 UIDocument。值变化会排队触发 flush。
