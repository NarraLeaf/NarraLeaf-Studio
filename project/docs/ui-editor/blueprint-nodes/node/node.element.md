# Element 节点

## Element

`blueprint.element.ref` - Element Literal

创建后卡片使用黄色主色，点击卡片会临时切到同一个 Surface 的界面编辑器。选择一个非 root 元素并确认后，节点写入 `{ surfaceId, elementId, elementType }`，然后返回原 Blueprint tab。

- `element` - 元素引用输出。未绑定时类型为 `element`；绑定后类型为 `element:<widgetType>`，例如 `element:nl.text`。

Element Literal 是纯数据字面量，输出可以 fan out 到多个读取或写入节点。V1 只允许 Same-Surface 引用；跨 Surface 元素不会出现在派生节点菜单中。

绑定后，Add Node 菜单会暴露兼容的 Element 派生节点。同一种节点类型只显示一项；若兼容的 Element Literal / Element Flush / Element Click 来源唯一，放置时会自动连接到该来源，若有多个兼容来源则保留目标输入由作者手动选择/连接：
- Text 元素暴露 `blueprint.element.text.*`，所有节点都有顶部 `element:nl.text` 输入；读取节点可用于 Blueprint Value，写入节点仅用于 event/macro。
- 任意可显示元素暴露 `blueprint.element.displayable.*` 派生节点，并归入 `Element` 分类：这些节点通过 `element` 输入作用于传入引用。使用 `Get Property` 读取 position / size / bounds / x / y / width / height / rotation / opacity / visible，使用 `Set Property` 写入 x / y / width / height / rotation / opacity / visible（opacity 按百分比输入，`value` pin 接线时卡片 Value 控件禁用）；`Set Variant` 通过目标元素已有 Variants 的下拉设置 Variant，可选择是否等待 Variant transition，节点不提供 Variant id 输入 pin，并只接受支持 Variant 的元素引用；所有可显示元素都可使用 `Animate Property` / `Stop Animation`，其中 opacity 的 From / To 按百分比输入，Duration / Delay 按秒输入。Appearance Variant 的 `transformOpacity` 和这些节点操作的是同一套 Displayable opacity；`nl.image` Variant 中相对 Default 实际改动过的 `fillOpacity` 也会投影到这套值，并且不会再写到内部 `<img>` 的 opacity。`nl.image` 的非 Default Variant 不覆盖 Default 的 `imageFill` / crop / contain 模式。
- List 元素暴露 `blueprint.element.list.*` 控件操作节点。只有当前图中已有绑定到 `nl.list` 的 Element Literal、Element Flush 或 Element Click 时才会显示。
- Slider 元素暴露 `blueprint.element.slider.*` 控件操作节点。只有当前图中已有绑定到 `nl.slider` 的 Element Literal、Element Flush 或 Element Click 时才会显示。
- Image 元素暴露 `blueprint.element.image.*` 控件操作节点和 `Image Asset` 字面量卡片，并归入 `Image` 分类。
- Button / Container / Frame 等控件暴露 `blueprint.element.<widget>.*` 属性方法节点。

Self 节点是另一套形态：它们没有 Element/ref 输入，只在对应控件自己的私有蓝图分类中出现。

Blueprint Value 会在读取这些 Element-targeted 节点时记录具体属性依赖。后续 document/runtime 同步只在记录的属性变化时重跑对应 value binding。
