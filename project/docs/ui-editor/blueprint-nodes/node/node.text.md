# Text 节点

除非额外声明，所有参数均为传入引脚值；标注（传出引脚）的参数为传出值。

Text 节点默认作用于当前 Text 元素。

Text Self 节点只在 `nl.text` 自己的私有蓝图中出现，创建浮窗中归入 `Text` 分类，且没有 Element 输入。

Text Element 节点使用同一属性目录下的 `blueprint.element.text.*`，带顶部 `element:nl.text` 输入，创建浮窗中归入 `Element` 分类。它们只有在当前图中已有绑定到 `nl.text` 的 Element Literal、Element Flush 或 Element Click 时才会显示；同一节点类型只显示一项。若兼容来源唯一，放置时会自动连接 `element` 输入；若有多个兼容来源，则保留 `element` 输入由作者手动选择/连接。读取节点是 pure，可用于 Blueprint Value；写入节点只用于 event/macro。

下文列出的 `blueprint.text.*` 均有对应 `blueprint.element.text.*` Element 版。

## Get Text

`blueprint.text.getText` - 获取文本内容

获取当前文本内容。
- `text` - 文本内容（传出引脚）

## Set Text

`blueprint.text.setText` - 设置文本内容

设置当前文本内容。
- `text` - 文本内容

## Append Text

`blueprint.text.appendText` - 追加文本内容

在当前文本末尾追加内容。
- `text` - 要追加的文本

## Clear Text

`blueprint.text.clearText` - 清空文本内容

清空当前文本内容。

## Get Font

`blueprint.text.getFont` - 获取字体

获取当前文本使用的字体资源。
- `fontAssetId` - 字体资源 ID（传出引脚）

## Set Font

`blueprint.text.setFont` - 设置字体

设置当前文本使用的字体资源。
- `fontAssetId` - 字体资源 ID

## Get Font Size

`blueprint.text.getFontSize` - 获取字号

获取当前文本字号。
- `fontSize` - 字号（传出引脚）

## Set Font Size

`blueprint.text.setFontSize` - 设置字号

设置当前文本字号。
- `fontSize` - 字号

## Get Font Weight

`blueprint.text.getFontWeight` - 获取字重

获取当前文本字重。
- `fontWeight` - 字重（传出引脚）

## Set Font Weight

`blueprint.text.setFontWeight` - 设置字重

设置当前文本字重。
- `fontWeight` - 字重，可选值：`normal`、`600`、`bold`

## Get Text Color

`blueprint.text.getTextColor` - 获取文本颜色

获取当前文本颜色。
- `color` - 文本颜色（传出引脚，`RGBAColor`）

## Set Text Color

`blueprint.text.setTextColor` - 设置文本颜色

设置当前文本颜色。
- `color` - 文本颜色（`RGBAColor`）

## Get Text Align

`blueprint.text.getTextAlign` - 获取文本横向对齐

获取当前文本横向对齐方式。
- `textAlign` - 横向对齐方式（传出引脚）

## Set Text Align

`blueprint.text.setTextAlign` - 设置文本横向对齐

设置当前文本横向对齐方式。
- `textAlign` - 横向对齐方式，可选值：`left`、`center`、`right`

## Get Text Vertical Align

`blueprint.text.getTextVerticalAlign` - 获取文本纵向对齐

获取当前文本纵向对齐方式。
- `textVerticalAlign` - 纵向对齐方式（传出引脚）

## Set Text Vertical Align

`blueprint.text.setTextVerticalAlign` - 设置文本纵向对齐

设置当前文本纵向对齐方式。
- `textVerticalAlign` - 纵向对齐方式，可选值：`start`、`center`、`end`

## Get Line Height

`blueprint.text.getLineHeight` - 获取行高

获取当前文本行高。
- `lineHeight` - 行高（传出引脚）

## Set Line Height

`blueprint.text.setLineHeight` - 设置行高

设置当前文本行高。
- `lineHeight` - 行高

## Get Wrap Mode

`blueprint.text.getWrapMode` - 获取换行模式

获取当前文本换行模式。
- `textWrapMode` - 换行模式（传出引脚）

## Set Wrap Mode

`blueprint.text.setWrapMode` - 设置换行模式

设置当前文本换行模式。
- `textWrapMode` - 换行模式，可选值：`word`、`character`、`nowrap`

## Get Effects

`blueprint.text.getEffects` - 获取文本静态效果

获取当前文本静态效果。
- `effects` - 文本静态效果（传出引脚）

## Set Effects

`blueprint.text.setEffects` - 设置文本静态效果

设置当前文本静态效果。
- `effects` - 文本静态效果

## Get All Properties

`blueprint.text.getAllProperties` - 获取全部文本属性

获取当前文本元素的全部文本属性。
- `text` - 文本内容（传出引脚）
- `fontAssetId` - 字体资源 ID（传出引脚）
- `fontSize` - 字号（传出引脚）
- `fontWeight` - 字重（传出引脚）
- `color` - 文本颜色（传出引脚，`RGBAColor`）
- `textAlign` - 横向对齐方式（传出引脚）
- `textVerticalAlign` - 纵向对齐方式（传出引脚）
- `lineHeight` - 行高（传出引脚）
- `textWrapMode` - 换行模式（传出引脚）
- `effects` - 文本静态效果（传出引脚）

## Set All Properties

`blueprint.text.setAllProperties` - 设置全部文本属性

一次性设置当前文本元素的全部文本属性。
- `text` - 文本内容
- `fontAssetId` - 字体资源 ID
- `fontSize` - 字号
- `fontWeight` - 字重
- `color` - 文本颜色（`RGBAColor`）
- `textAlign` - 横向对齐方式
- `textVerticalAlign` - 纵向对齐方式
- `lineHeight` - 行高
- `textWrapMode` - 换行模式
- `effects` - 文本静态效果
