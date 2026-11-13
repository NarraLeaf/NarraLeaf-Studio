# 蓝图节点：图片 · Image

> 本文件由 NarraLeaf Studio 源码自动生成，请勿手动修改。
> Generated from the NarraLeaf Studio source. Do not edit by hand.

「图片 · Image」分类下的 16 个节点。标题是节点面板里显示的名字（中文 · English）。

The 16 nodes in the "Image" palette category, titled as the node palette shows them.

### 清除图片资产 · Clear Image Asset

`blueprint.image.clearImageAsset` · 会等待，完成后才继续 · Latent: waits before continuing

- 只用于这些控件的蓝图 · Only on: 图片 · Image
- 可放在 · Allowed in: 控件逻辑 · Widget logic、组件内的控件逻辑 · Widget logic inside a component
- 输入 · In：进入 · In（`in`，执行 · exec）
- 输出 · Out：下一步 · Next（`next`，执行 · exec）

### 获取启用状态 · Get Enabled

`blueprint.image.getEnabled` · 纯数据节点，没有执行针脚 · Pure: no exec pins

- 只用于这些控件的蓝图 · Only on: 图片 · Image
- 可放在 · Allowed in: 控件逻辑 · Widget logic、组件内的控件逻辑 · Widget logic inside a component
- 输出 · Out：已启用 · Enabled（`enabled`，boolean）

### 获取图片资产 · Get Image Asset

`blueprint.image.getImageAsset` · 纯数据节点，没有执行针脚 · Pure: no exec pins

- 只用于这些控件的蓝图 · Only on: 图片 · Image
- 可放在 · Allowed in: 控件逻辑 · Widget logic、组件内的控件逻辑 · Widget logic inside a component
- 输出 · Out：资产 · Asset（`asset`，ImageAsset|null）

### 获取图片裁剪矩形 · Get Image Crop Rect

`blueprint.image.getCropRect` · 纯数据节点，没有执行针脚 · Pure: no exec pins

- 只用于这些控件的蓝图 · Only on: 图片 · Image
- 可放在 · Allowed in: 控件逻辑 · Widget logic、组件内的控件逻辑 · Widget logic inside a component
- 输出 · Out：左边距 % · Left %（`leftPct`，float）
- 输出 · Out：上边距 % · Top %（`topPct`，float）
- 输出 · Out：宽度 % · Width %（`widthPct`，float）
- 输出 · Out：高度 % · Height %（`heightPct`，float）

### 获取图片适配模式 · Get Image Fit Mode

`blueprint.image.getFitMode` · 纯数据节点，没有执行针脚 · Pure: no exec pins

- 只用于这些控件的蓝图 · Only on: 图片 · Image
- 可放在 · Allowed in: 控件逻辑 · Widget logic、组件内的控件逻辑 · Widget logic inside a component
- 输出 · Out：适配模式 · Fit Mode（`fitMode`，string）

### 获取图片水平翻转 · Get Image Flip X

`blueprint.image.getFlipX` · 纯数据节点，没有执行针脚 · Pure: no exec pins

- 只用于这些控件的蓝图 · Only on: 图片 · Image
- 可放在 · Allowed in: 控件逻辑 · Widget logic、组件内的控件逻辑 · Widget logic inside a component
- 输出 · Out：水平翻转 · Flip X（`flipX`，boolean）

### 获取图片垂直翻转 · Get Image Flip Y

`blueprint.image.getFlipY` · 纯数据节点，没有执行针脚 · Pure: no exec pins

- 只用于这些控件的蓝图 · Only on: 图片 · Image
- 可放在 · Allowed in: 控件逻辑 · Widget logic、组件内的控件逻辑 · Widget logic inside a component
- 输出 · Out：垂直翻转 · Flip Y（`flipY`，boolean）

### 获取可见性 · Get Visible

`blueprint.image.getVisible` · 纯数据节点，没有执行针脚 · Pure: no exec pins

- 只用于这些控件的蓝图 · Only on: 图片 · Image
- 可放在 · Allowed in: 控件逻辑 · Widget logic、组件内的控件逻辑 · Widget logic inside a component
- 输出 · Out：可见 · Visible（`visible`，boolean）

### 图片资产 · Image Asset

`blueprint.image.assetLiteral` · 图片资源 · Image asset · 纯数据节点，没有执行针脚 · Pure: no exec pins

- 可放在 · Allowed in: 应用逻辑 · App logic、页面逻辑 · Page logic、控件逻辑 · Widget logic、组件内的控件逻辑 · Widget logic inside a component
- 输出 · Out：资产 · Asset（`value`，ImageAsset）

### 设置启用状态 · Set Enabled

`blueprint.image.setEnabled` · 会等待，完成后才继续 · Latent: waits before continuing

- 只用于这些控件的蓝图 · Only on: 图片 · Image
- 可放在 · Allowed in: 控件逻辑 · Widget logic、组件内的控件逻辑 · Widget logic inside a component
- 输入 · In：进入 · In（`in`，执行 · exec）
- 输出 · Out：下一步 · Next（`next`，执行 · exec）
- 输入 · In：已启用 · Enabled（`enabled`，boolean）

### 设置图片资产 · Set Image Asset

`blueprint.image.setImageAsset` · 会等待，完成后才继续 · Latent: waits before continuing

- 只用于这些控件的蓝图 · Only on: 图片 · Image
- 可放在 · Allowed in: 控件逻辑 · Widget logic、组件内的控件逻辑 · Widget logic inside a component
- 输入 · In：进入 · In（`in`，执行 · exec）
- 输出 · Out：下一步 · Next（`next`，执行 · exec）
- 输入 · In：资产 · Asset（`asset`，ImageAsset|null；可直接填值 · accepts a typed value）

### 设置图片裁剪矩形 · Set Image Crop Rect

`blueprint.image.setCropRect` · 会等待，完成后才继续 · Latent: waits before continuing

- 只用于这些控件的蓝图 · Only on: 图片 · Image
- 可放在 · Allowed in: 控件逻辑 · Widget logic、组件内的控件逻辑 · Widget logic inside a component
- 输入 · In：进入 · In（`in`，执行 · exec）
- 输出 · Out：下一步 · Next（`next`，执行 · exec）
- 输入 · In：左边距 % · Left %（`leftPct`，float；可直接填值 · accepts a typed value）
- 输入 · In：上边距 % · Top %（`topPct`，float；可直接填值 · accepts a typed value）
- 输入 · In：宽度 % · Width %（`widthPct`，float；可直接填值 · accepts a typed value）
- 输入 · In：高度 % · Height %（`heightPct`，float；可直接填值 · accepts a typed value）

### 设置图片适配模式 · Set Image Fit Mode

`blueprint.image.setFitMode` · 会等待，完成后才继续 · Latent: waits before continuing

- 只用于这些控件的蓝图 · Only on: 图片 · Image
- 可放在 · Allowed in: 控件逻辑 · Widget logic、组件内的控件逻辑 · Widget logic inside a component
- 输入 · In：进入 · In（`in`，执行 · exec）
- 输出 · Out：下一步 · Next（`next`，执行 · exec）
- 输入 · In：适配模式 · Fit Mode（`fitMode`，string；可直接填值 · accepts a typed value）

### 设置图片水平翻转 · Set Image Flip X

`blueprint.image.setFlipX` · 会等待，完成后才继续 · Latent: waits before continuing

- 只用于这些控件的蓝图 · Only on: 图片 · Image
- 可放在 · Allowed in: 控件逻辑 · Widget logic、组件内的控件逻辑 · Widget logic inside a component
- 输入 · In：进入 · In（`in`，执行 · exec）
- 输出 · Out：下一步 · Next（`next`，执行 · exec）
- 输入 · In：水平翻转 · Flip X（`flipX`，boolean）

### 设置图片垂直翻转 · Set Image Flip Y

`blueprint.image.setFlipY` · 会等待，完成后才继续 · Latent: waits before continuing

- 只用于这些控件的蓝图 · Only on: 图片 · Image
- 可放在 · Allowed in: 控件逻辑 · Widget logic、组件内的控件逻辑 · Widget logic inside a component
- 输入 · In：进入 · In（`in`，执行 · exec）
- 输出 · Out：下一步 · Next（`next`，执行 · exec）
- 输入 · In：垂直翻转 · Flip Y（`flipY`，boolean）

### 设置可见性 · Set Visible

`blueprint.image.setVisible` · 会等待，完成后才继续 · Latent: waits before continuing

- 只用于这些控件的蓝图 · Only on: 图片 · Image
- 可放在 · Allowed in: 控件逻辑 · Widget logic、组件内的控件逻辑 · Widget logic inside a component
- 输入 · In：进入 · In（`in`，执行 · exec）
- 输出 · Out：下一步 · Next（`next`，执行 · exec）
- 输入 · In：可见 · Visible（`visible`，boolean）
