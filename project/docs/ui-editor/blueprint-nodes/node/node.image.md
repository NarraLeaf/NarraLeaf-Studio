# Image 节点

Image 节点用于读取和改写界面图片控件 `nl.image` 的图片资源、填充模式、裁剪区域和翻转状态。它只处理应用界面的图片控件，不表示舞台表演图片、角色立绘或剧情演出资源。

Self 版节点只在 `nl.image` 自己的私有蓝图中出现，没有 Element 输入。由绑定的 `nl.image` Element Literal / Element Flush / Element Click 派生时，节点类型使用 `blueprint.element.image.*`，创建浮窗中归入 `Element` 分类，并带有 `element:nl.image` 输入，可通过 Element Ref 操控同一 Surface 上的其他 Image 控件。

## Image Asset

`blueprint.image.assetLiteral` - Image Asset

专用图片资产字面量卡片。卡片显示当前图片缩略图、资产名或 missing 状态；点击卡片打开图片资产选择器。

- `value` - 输出 `ImageAsset`。运行时值为 `{ kind: "imageAsset", assetId }`。

未选择图片时输出为空值；连接到 `ImageAsset|null` 输入时等价于清空或未设置。

## Get Image Asset

`blueprint.image.getImageAsset` - Get Image Asset

读取当前 `nl.image` 控件正在使用的图片资源。

- `asset` - 输出 `ImageAsset|null`。控件没有图片时为 `null`。

Element 版为 `blueprint.element.image.getImageAsset`。

## Set Image Asset

`blueprint.image.setImageAsset` - Set Image Asset

设置当前 `nl.image` 控件的图片资源并触发 Element Flush。

- `in` - 执行输入
- `next` - 执行输出
- `asset` - 输入 `ImageAsset|null`

`asset` 输入未接线时，可以像 Concat 节点的 inline literal 一样在节点卡片上展开为图片预览选择器。选择图片会写入节点参数；清空会写入 `null`。如果 `asset` pin 已接线，运行时优先使用连线值。

Element 版为 `blueprint.element.image.setImageAsset`。

旧图中使用字符串 `assetId` 的连线仍可执行，但新节点 UI 不再推荐直接编辑 asset id 字符串。

## Clear Image Asset

`blueprint.image.clearImageAsset` - Clear Image Asset

清除当前 `nl.image` 控件的图片资源，等价于把 `Set Image Asset` 的 `asset` 输入设为 `null`，并触发 Element Flush。

- `in` - 执行输入
- `next` - 执行输出

Element 版为 `blueprint.element.image.clearImageAsset`。

## Get Image Fit Mode

`blueprint.image.getFitMode` - Get Image Fit Mode

读取 `imageFill.mode`。

- `fitMode` - 输出字符串：`cover`、`contain`、`stretch`、`crop` 或 `tile`

Element 版为 `blueprint.element.image.getFitMode`。

## Set Image Fit Mode

`blueprint.image.setFitMode` - Set Image Fit Mode

设置 `imageFill.mode` 并保留当前图片资源和裁剪区域。非法或空字符串会回退到当前模式。

- `in` - 执行输入
- `next` - 执行输出
- `fitMode` - 输入字符串：`cover`、`contain`、`stretch`、`crop` 或 `tile`

Element 版为 `blueprint.element.image.setFitMode`。

## Get Image Crop Rect

`blueprint.image.getCropRect` - Get Image Crop Rect

读取 `imageFill.cropPlacement`。没有显式裁剪区域时输出默认全图区域。

- `leftPct` - 输出左侧百分比
- `topPct` - 输出顶部百分比
- `widthPct` - 输出宽度百分比
- `heightPct` - 输出高度百分比

Element 版为 `blueprint.element.image.getCropRect`。

## Set Image Crop Rect

`blueprint.image.setCropRect` - Set Image Crop Rect

设置 `imageFill.cropPlacement`，同时把 `fitMode` 切换为 `crop`。

- `in` - 执行输入
- `next` - 执行输出
- `leftPct` - 输入左侧百分比
- `topPct` - 输入顶部百分比
- `widthPct` - 输入宽度百分比
- `heightPct` - 输入高度百分比

Element 版为 `blueprint.element.image.setCropRect`。

## Get Image Flip X / Y

`blueprint.image.getFlipX` - Get Image Flip X

`blueprint.image.getFlipY` - Get Image Flip Y

读取图片内容层的水平或垂直翻转状态。

- `flipX` / `flipY` - 输出 boolean

Element 版分别为 `blueprint.element.image.getFlipX` 和 `blueprint.element.image.getFlipY`。

## Set Image Flip X / Y

`blueprint.image.setFlipX` - Set Image Flip X

`blueprint.image.setFlipY` - Set Image Flip Y

设置图片内容层的水平或垂直翻转状态。

- `in` - 执行输入
- `next` - 执行输出
- `flipX` / `flipY` - 输入 boolean

Element 版分别为 `blueprint.element.image.setFlipX` 和 `blueprint.element.image.setFlipY`。
