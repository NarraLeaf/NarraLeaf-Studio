# Element 节点

## Element

`blueprint.element.ref` - Element Literal

创建后卡片使用黄色主色，点击卡片会临时切到同一个 Surface 的界面编辑器。选择一个非 root 元素并确认后，节点写入 `{ surfaceId, elementId, elementType }`，然后返回原 Blueprint tab。

- `element` - 元素引用输出。未绑定时类型为 `element`；绑定后类型为 `element:<widgetType>`，例如 `element:nl.text`。

Element Literal 是纯数据字面量，输出可以 fan out 到多个读取或写入节点。V1 只允许 Same-Surface 引用；跨 Surface 元素不会出现在派生节点菜单中。

绑定后，Add Node 菜单会暴露兼容的 Element 派生节点。大多数派生节点统一归入 `Element` 分类，每个节点类型只显示一次，不再按每个绑定控件复制菜单项：
- Text 元素暴露 `blueprint.element.text.*`，所有节点都有顶部 `element:nl.text` 输入；读取节点可用于 Blueprint Value，写入节点仅用于 event/macro。
- 任意可显示元素暴露 `blueprint.element.displayable.*` 读取节点，用于 position、size、bounds、rotation、opacity 和 visible。
- List 元素暴露 `blueprint.element.list.*` 控件操作节点。只有当前图中已有绑定到 `nl.list` 的 Element Literal 或 Element Flush 时才会显示。
- Slider 元素暴露 `blueprint.element.slider.*` 控件操作节点。只有当前图中已有绑定到 `nl.slider` 的 Element Literal 或 Element Flush 时才会显示。
- Image 元素暴露 `blueprint.element.image.*` 控件操作节点和 `Image Asset` 字面量卡片，并归入 `Image` 分类。
- Button / Container / Frame 等控件暴露 `blueprint.element.<widget>.*` 属性方法节点。

派生菜单项不会自动连线。放置节点后，需要手动把 Element Literal 或 Element Flush 的 `element` 输出接到节点的目标输入。Self 节点是另一套形态：它们没有 Element/ref 输入，只在对应控件自己的私有蓝图分类中出现。

Blueprint Value 会在读取这些 Element-targeted 节点时记录具体属性依赖。后续 document/runtime 同步只在记录的属性变化时重跑对应 value binding。
