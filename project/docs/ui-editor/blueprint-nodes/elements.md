# 所有内建元素

所有可显示元素都拥有 Displayable 节点组。Displayable 包含通用 `Get Property` / `Set Property`、属性动画节点，以及 Appearance Variant 节点。Self 版默认作用于当前蓝图所属元素，并留在 `Displayable` 分类；`blueprint.element.displayable.*` 派生版才通过 `element` 输入作用于传入引用，并显示在 `Element` 分类。

`Get Property` 通过下拉读取 `position`、`size`、`bounds`、`x`、`y`、`width`、`height`、`rotation`、`opacity` 或 `visible`，取代旧的固定 get 节点。`Set Property` 可设置 `x`、`y`、`width`、`height`、`rotation`、`opacity`、`visible`；当 `value` pin 接线时，卡片上的 Value 控件禁用。

`Set Variant` 的卡片在能推断目标元素时以下拉列出该元素已有 Variants，并可选择是否等待 Variant transition；Self 版只在支持 Appearance Variant 的当前控件上出现，派生版只接受支持 Variant 的 Element 引用。Variant UUID 是隐藏持久化细节，节点不提供手动输入或连线。属性动画使用 `Animate Property`，通过卡片下拉选择 `opacity`、`offsetX`、`offsetY`、`scale` 或 `rotation` 并填写动画参数；`opacity` 在卡片中按百分比 `0..100` 输入，Duration / Delay 按秒输入。内建动画序列留给后续节点或宏。

透明度统一为 Displayable 的有效 `opacity`。Appearance Variant 的 `transformOpacity` 会解析到同一个元素透明度，不再与内部 chrome/text 透明度叠乘；`nl.image` Variant 中相对 Default 实际改动过的 `fillOpacity` 也会作为 Displayable opacity 来源，并且不会再写到内部 `<img>` 的 opacity。`nl.image` 的图片内容层 `imageFill` / crop / contain 模式来自 Default，不会被非 Default Variant 切换。`Set Variant` 会清理旧的 runtime opacity override，让 Variant 自己决定透明度；`Animate Property` 的 opacity 在 `hold` 模式下会把最终值写回运行时 Displayable opacity，透明 Variant 后接淡入动画时不会被 Variant 的 0 重新覆盖。

## Container

- `nl.container`

`Container` 元素是一个容器，可以包含其他元素。默认拥有以下节点组：
- Displayable
- Container
- Broadcast

## Text

- `nl.text`

`Text` 元素是一个文本，可以显示文本内容。默认拥有以下节点组：
- Displayable
- Text
- Broadcast

## Image

- `nl.image`

`Image` 元素是一个图片，可以显示图片内容。默认拥有以下节点组：
- Displayable
- Image
- Broadcast

## Button

- `nl.button`

`Button` 元素是一个按钮，可以点击。默认拥有以下节点组：
- Displayable
- Button
- Broadcast

## List

- `nl.list`

`List` 元素是一个列表，可以显示列表内容。默认拥有以下节点组：
- Displayable
- List
- Broadcast

## Slider

- `nl.slider`

`Slider` 元素是一个数值映射滑块。默认拥有以下节点组：
- Displayable
- Slider
- Broadcast

## Page

- `nl.frame`

`Page` 元素用于在当前 Page 中嵌入另一个 Page。默认拥有以下节点组：
- Displayable
- Frame
- Page
- Broadcast
