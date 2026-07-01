# Widget Property 节点

Widget Property 节点用于读取和改写内建控件的运行时属性。它们分为 Self 版和 Element 版。

Self 版只在对应控件自己的私有蓝图中出现，创建浮窗中归入控件分类，例如 `Button`、`Container`、`Image`、`Frame`、`Slider`、`List`、`Text`。Self 节点没有 Element/ref 输入，运行时通过当前执行 owner 操作自己。

Element 版使用 `blueprint.element.<widget>.*`，带 typed Element 输入，创建浮窗中归入 `Element` 分类。它们只有在当前图中已有兼容的 Element Literal、Element Flush 或 Element Click 时才会显示；同一节点类型只显示一项。若兼容来源唯一，放置时会自动连接目标输入；若有多个兼容来源，则保留目标输入由作者手动选择/连接。

写入节点只在 `event` / `macro` 图中可用。属性值实际变化并导致重绘时会触发 flush；读取节点不触发 flush。`Set Enabled(false)` 会映射到底层交互禁用机制，节点语义只暴露 `Enabled`，不暴露 `interactionDisabled`。

## Common

所有内建控件提供：
- `blueprint.<widget>.getVisible` / `blueprint.element.<widget>.getVisible` - 读取可见状态
- `blueprint.<widget>.setVisible` / `blueprint.element.<widget>.setVisible` - 设置可见状态
- `blueprint.<widget>.getEnabled` / `blueprint.element.<widget>.getEnabled` - 读取可交互状态
- `blueprint.<widget>.setEnabled` / `blueprint.element.<widget>.setEnabled` - 设置可交互状态

当前 `<widget>` 包括 `container`、`text`、`image`、`button`、`slider`、`list`、`frame`。

## Variant

通用 Appearance Variant 推荐使用 Displayable 节点：
- `blueprint.displayable.setVariant` / `blueprint.element.displayable.setVariant`

`Set Variant` 节点统一显示在 `Displayable` 分类中。Self 版默认绑定当前蓝图所属控件，只有当前控件支持 Appearance Variant 时出现；派生版 `Set Element Variant` 才通过 Element 引用目标控件。卡片会在能推断目标元素时列出该元素已有 Variants，并提供是否等待 Variant transition 的下拉。Variant UUID 不作为数据 pin 或手输参数暴露给作者。

以下旧版控件专用 Variant 节点仅保留兼容旧图，并在创建浮窗中隐藏；新图不再提供读取或手动传入 Variant UUID 的入口：
- `blueprint.button.getVariant` / `blueprint.button.setVariant`
- `blueprint.container.getVariant` / `blueprint.container.setVariant`
- `blueprint.element.button.getVariant` / `blueprint.element.button.setVariant`
- `blueprint.element.container.getVariant` / `blueprint.element.container.setVariant`

旧的 Displayable `getVariant` 节点同样只兼容旧图并隐藏。作者从卡片中选择 Variant 名称，UUID 仅作为内部持久化值保存。

Appearance Variant 的 `transformOpacity` 会投影到同一套 Displayable `opacity`，不会和内部控件透明度叠乘；`nl.image` Variant 中相对 Default 实际改动过的 `fillOpacity` 也会投影到这套值，并且不会再写到内部 `<img>` 的 opacity。`nl.image` 的图片内容层 `imageFill` / crop / contain 模式来自 Default，不由非 Default Variant 切换。Displayable `Set Property` / `Animate Property` 对 opacity 的操作也作用于这同一个有效透明度。

## Button

`nl.button` 提供：
- `blueprint.button.getLabel` / `blueprint.element.button.getLabel` - 读取按钮文本
- `blueprint.button.setLabel` / `blueprint.element.button.setLabel` - 设置按钮文本
- Common Visible / Enabled
- Variant 使用 Displayable `Set Variant`

## Container

`nl.container` 提供：
- `blueprint.container.getClipContent` / `blueprint.element.container.getClipContent` - 读取内容裁剪状态
- `blueprint.container.setClipContent` / `blueprint.element.container.setClipContent` - 设置内容裁剪状态
- Common Visible / Enabled
- Variant 使用 Displayable `Set Variant`

## Image

`nl.image` 提供：
- `blueprint.image.getImageAsset` / `blueprint.element.image.getImageAsset` - 读取 `ImageAsset|null`
- `blueprint.image.setImageAsset` / `blueprint.element.image.setImageAsset` - 设置 `ImageAsset|null`；`null` 清除图片资源，未接线时可使用节点内图片选择卡片
- `blueprint.image.assetLiteral` - 图片资产字面量卡片，输出 `ImageAsset`
- Common Visible / Enabled

旧图中直接传入字符串 `assetId` 的连线仍可运行，但新 UI 只推荐使用 `ImageAsset` 数据类型。

## Text

`nl.text` 除 Text 节点外，还提供 Common Visible / Enabled。文本内容、字体、颜色、对齐、换行和 Effects 方法见 `node.text.md`。

## Slider

`nl.slider` 除 Slider 节点外，还提供 Common Visible / Enabled。滑块数值和范围方法见 `node.slider.md`。

## List

`nl.list` 除 List 节点外，还提供 Common Visible / Enabled。列表内容、选中项、滚动和 item context 方法见 `node.list.md`。

## Frame

Frame Widget Property 用于操作 `nl.frame` 组件自身的目标 Page 和参数：
- `blueprint.frameWidget.getTargetPage` / `blueprint.element.frame.getTargetPage` - 读取目标 Page surface id
- `blueprint.frameWidget.setTargetPage` / `blueprint.element.frame.setTargetPage` - `Set Frame Page`，设置目标 Page surface id；卡片内的 `Page` 参数使用 Page 下拉选择，空选项清除目标。Self 形态只在 `nl.frame` 私有蓝图中出现；Element 形态可从绑定到 `nl.frame` 的 Element Literal / Element Flush / Element Click 派生，调用目标就是该 Frame 引用。切换后由 Frame 控件走现有进场/出场动画。
- `blueprint.frameWidget.getParams` / `blueprint.element.frame.getParams` - 读取传给目标 Page 的参数 object
- `blueprint.frameWidget.setParams` / `blueprint.element.frame.setParams` - 设置传给目标 Page 的参数 object；非 object 值会归一为空 object
- Common Visible / Enabled

Page 导航和嵌入通信节点 `blueprint.page.go`、`blueprint.frame.getParam` / `blueprint.frame.emit` 记录在 `node.page.md`。
