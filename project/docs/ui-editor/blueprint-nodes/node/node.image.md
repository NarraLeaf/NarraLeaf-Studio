# Image 节点

Image 节点用于界面图片控件 `nl.image` 的图片资源读写。它只处理应用界面的图片控件，不表示舞台表演图片、角色立绘或剧情演出资源。

## Image Asset

`blueprint.image.assetLiteral` - Image Asset

专用图片资产字面量卡片。卡片显示当前图片缩略图、资产名或 missing 状态；点击卡片打开图片资产选择器。

- `value` - 输出 `ImageAsset`。运行时值为 `{ kind: "imageAsset", assetId }`。

未选择图片时输出为空值；连接到 `ImageAsset|null` 输入时等价于清空或未设置。

## Get Image Asset

`blueprint.image.getImageAsset` - Get Image Asset

读取当前 `nl.image` 控件正在使用的图片资源。

- `asset` - 输出 `ImageAsset|null`。控件没有图片时为 `null`。

由绑定的 `nl.image` Element Literal / Element Flush / Element Click 派生时，节点类型为 `blueprint.element.image.getImageAsset`，并带有 `element:nl.image` 输入。

## Set Image Asset

`blueprint.image.setImageAsset` - Set Image Asset

设置当前 `nl.image` 控件的图片资源并触发 Element Flush。

- `in` - 执行输入
- `next` - 执行输出
- `asset` - 输入 `ImageAsset|null`

`asset` 输入未接线时，可以像 Concat 节点的 inline literal 一样在节点卡片上展开为图片预览选择器。选择图片会写入节点参数；清空会写入 `null`。如果 `asset` pin 已接线，运行时优先使用连线值。

由绑定的 `nl.image` Element Literal / Element Flush / Element Click 派生时，节点类型为 `blueprint.element.image.setImageAsset`，并带有 `element:nl.image` 输入。

旧图中使用字符串 `assetId` 的连线仍可执行，但新节点 UI 不再推荐直接编辑 asset id 字符串。
