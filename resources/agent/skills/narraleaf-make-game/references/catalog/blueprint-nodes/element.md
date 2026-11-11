# 蓝图节点：元素 · Element

> 本文件由 NarraLeaf Studio 源码自动生成，请勿手动修改。
> Generated from the NarraLeaf Studio source. Do not edit by hand.

「元素 · Element」分类下的 137 个节点。标题是节点面板里显示的名字（中文 · English）。

The 137 nodes in the "Element" palette category, titled as the node palette shows them.

### 动画元素属性 · Animate Element Property

`blueprint.element.displayable.animateProperty` · 会等待，完成后才继续 · Latent: waits before continuing

- 可放在 · Allowed in: 应用逻辑 · App logic、页面逻辑 · Page logic、控件逻辑 · Widget logic、组件内的控件逻辑 · Widget logic inside a component
- 输入 · In：进入 · In（`in`，执行 · exec）
- 输出 · Out：下一步 · Next（`next`，执行 · exec）
- 输入 · In：元素 · Element（`element`，element）
- 输出 · Out：动画 · Animation（`animation`，AnimationToken）
- 设置 · Setting：属性 · Property（`property`：不透明度 · Opacity / 偏移 X · Offset X / 偏移 Y · Offset Y / X / Y / 缩放 · Scale / 旋转 · Rotation）
- 设置 · Setting：起始 · From（`from`）
- 设置 · Setting：目标 · To（`to`）
- 设置 · Setting：时长（秒） · Duration (s)（`duration`）
- 设置 · Setting：延迟（秒） · Delay (s)（`delay`）
- 设置 · Setting：缓动 · Easing（`easing`：线性 · Linear / 缓入 · Ease In / 缓出 · Ease Out / 缓入缓出 · Ease In Out / 圆弧缓入 · Circ In / 圆弧缓出 · Circ Out / 圆弧缓入缓出 · Circ In Out）
- 设置 · Setting：结束后 · After（`after`：保持最终值 · Hold final value / 动画后重置 · Reset after animation）

### 追加列表项 · Append List Item

`blueprint.element.list.appendItem` · 会等待，完成后才继续 · Latent: waits before continuing

- 可放在 · Allowed in: 应用逻辑 · App logic、页面逻辑 · Page logic、控件逻辑 · Widget logic、组件内的控件逻辑 · Widget logic inside a component
- 输入 · In：进入 · In（`in`，执行 · exec）
- 输出 · Out：下一步 · Next（`next`，执行 · exec）
- 输入 · In：列表 · List（`list`，element:nl.list）
- 输入 · In：项 · Item（`item`，any）

### 追加文本 · Append Text

`blueprint.element.text.appendText` · 会等待，完成后才继续 · Latent: waits before continuing

- 可放在 · Allowed in: 应用逻辑 · App logic、页面逻辑 · Page logic、控件逻辑 · Widget logic、组件内的控件逻辑 · Widget logic inside a component
- 输入 · In：进入 · In（`in`，执行 · exec）
- 输出 · Out：下一步 · Next（`next`，执行 · exec）
- 输入 · In：元素 · Element（`element`，element:nl.text）
- 输入 · In：文本 · Text（`text`，string；可直接填值 · accepts a typed value）

### 清除图片资产 · Clear Image Asset

`blueprint.element.image.clearImageAsset` · 会等待，完成后才继续 · Latent: waits before continuing

- 可放在 · Allowed in: 应用逻辑 · App logic、页面逻辑 · Page logic、控件逻辑 · Widget logic、组件内的控件逻辑 · Widget logic inside a component
- 输入 · In：进入 · In（`in`，执行 · exec）
- 输出 · Out：下一步 · Next（`next`，执行 · exec）
- 输入 · In：图片 · Image（`element`，element:nl.image）

### 清空列表 · Clear List

`blueprint.element.list.clear` · 会等待，完成后才继续 · Latent: waits before continuing

- 可放在 · Allowed in: 应用逻辑 · App logic、页面逻辑 · Page logic、控件逻辑 · Widget logic、组件内的控件逻辑 · Widget logic inside a component
- 输入 · In：进入 · In（`in`，执行 · exec）
- 输出 · Out：下一步 · Next（`next`，执行 · exec）
- 输入 · In：列表 · List（`list`，element:nl.list）

### 清空文本 · Clear Text

`blueprint.element.text.clearText` · 会等待，完成后才继续 · Latent: waits before continuing

- 可放在 · Allowed in: 应用逻辑 · App logic、页面逻辑 · Page logic、控件逻辑 · Widget logic、组件内的控件逻辑 · Widget logic inside a component
- 输入 · In：进入 · In（`in`，执行 · exec）
- 输出 · Out：下一步 · Next（`next`，执行 · exec）
- 输入 · In：元素 · Element（`element`，element:nl.text）

### 清空文本 · Clear Text

`blueprint.element.textInput.clear` · 会等待，完成后才继续 · Latent: waits before continuing

- 可放在 · Allowed in: 应用逻辑 · App logic、页面逻辑 · Page logic、控件逻辑 · Widget logic、组件内的控件逻辑 · Widget logic inside a component
- 输入 · In：进入 · In（`in`，执行 · exec）
- 输出 · Out：下一步 · Next（`next`，执行 · exec）
- 输入 · In：文本输入框 · Text Input（`textInput`，element:nl.textInput）

### 元素 · Element

`blueprint.element.ref` · 控件引用 · Element reference · 纯数据节点，没有执行针脚 · Pure: no exec pins

- 可放在 · Allowed in: 应用逻辑 · App logic、页面逻辑 · Page logic、控件逻辑 · Widget logic、控件取值 · Widget value、组件内的控件逻辑 · Widget logic inside a component
- 输出 · Out：元素 · Element（`element`，element）

### 按字段查找条目 · Find Item By Field

`blueprint.element.list.findItemByField` · 纯数据节点，没有执行针脚 · Pure: no exec pins

- 可放在 · Allowed in: 应用逻辑 · App logic、页面逻辑 · Page logic、控件逻辑 · Widget logic、控件取值 · Widget value、组件内的控件逻辑 · Widget logic inside a component
- 输入 · In：列表 · List（`list`，element:nl.list）
- 输入 · In：值 · Value（`value`，any）
- 输出 · Out：索引 · Index（`index`，integer）
- 输出 · Out：项 · Item（`item`，json）
- 输出 · Out：已找到 · Found（`found`，boolean）
- 设置 · Setting：字段 · Field（`field`）

### 获取全部属性 · Get All Properties

`blueprint.element.text.getAllProperties` · 纯数据节点，没有执行针脚 · Pure: no exec pins

- 可放在 · Allowed in: 应用逻辑 · App logic、页面逻辑 · Page logic、控件逻辑 · Widget logic、控件取值 · Widget value、组件内的控件逻辑 · Widget logic inside a component
- 输入 · In：元素 · Element（`element`，element:nl.text）
- 输出 · Out：文本 · Text（`text`，string）
- 输出 · Out：字体 · Font（`fontAssetId`，string）
- 输出 · Out：字号 · Font Size（`fontSize`，float）
- 输出 · Out：字重 · Font Weight（`fontWeight`，string）
- 输出 · Out：颜色 · Color（`color`，RGBAColor）
- 输出 · Out：文本对齐 · Text Align（`textAlign`，string）
- 输出 · Out：垂直对齐 · Vertical Align（`textVerticalAlign`，string）
- 输出 · Out：行高 · Line Height（`lineHeight`，float）
- 输出 · Out：换行模式 · Wrap Mode（`textWrapMode`，string）
- 输出 · Out：特效 · Effects（`effects`，json）

### 获取按钮启用状态 · Get Button Enabled

`blueprint.element.button.getEnabled` · 纯数据节点，没有执行针脚 · Pure: no exec pins

- 可放在 · Allowed in: 应用逻辑 · App logic、页面逻辑 · Page logic、控件逻辑 · Widget logic、控件取值 · Widget value、组件内的控件逻辑 · Widget logic inside a component
- 输入 · In：按钮 · Button（`element`，element:nl.button）
- 输出 · Out：已启用 · Enabled（`enabled`，boolean）

### 获取按钮标签 · Get Button Label

`blueprint.element.button.getLabel` · 纯数据节点，没有执行针脚 · Pure: no exec pins

- 可放在 · Allowed in: 应用逻辑 · App logic、页面逻辑 · Page logic、控件逻辑 · Widget logic、控件取值 · Widget value、组件内的控件逻辑 · Widget logic inside a component
- 输入 · In：按钮 · Button（`element`，element:nl.button）
- 输出 · Out：标签 · Label（`label`，string）

### 获取按钮可见性 · Get Button Visible

`blueprint.element.button.getVisible` · 纯数据节点，没有执行针脚 · Pure: no exec pins

- 可放在 · Allowed in: 应用逻辑 · App logic、页面逻辑 · Page logic、控件逻辑 · Widget logic、控件取值 · Widget value、组件内的控件逻辑 · Widget logic inside a component
- 输入 · In：按钮 · Button（`element`，element:nl.button）
- 输出 · Out：可见 · Visible（`visible`，boolean）

### 获取容器内容裁剪 · Get Container Clip Content

`blueprint.element.container.getClipContent` · 纯数据节点，没有执行针脚 · Pure: no exec pins

- 可放在 · Allowed in: 应用逻辑 · App logic、页面逻辑 · Page logic、控件逻辑 · Widget logic、控件取值 · Widget value、组件内的控件逻辑 · Widget logic inside a component
- 输入 · In：容器 · Container（`element`，element:nl.container）
- 输出 · Out：裁剪 · Clip（`clipContent`，boolean）

### 获取容器启用状态 · Get Container Enabled

`blueprint.element.container.getEnabled` · 纯数据节点，没有执行针脚 · Pure: no exec pins

- 可放在 · Allowed in: 应用逻辑 · App logic、页面逻辑 · Page logic、控件逻辑 · Widget logic、控件取值 · Widget value、组件内的控件逻辑 · Widget logic inside a component
- 输入 · In：容器 · Container（`element`，element:nl.container）
- 输出 · Out：已启用 · Enabled（`enabled`，boolean）

### 获取容器可见性 · Get Container Visible

`blueprint.element.container.getVisible` · 纯数据节点，没有执行针脚 · Pure: no exec pins

- 可放在 · Allowed in: 应用逻辑 · App logic、页面逻辑 · Page logic、控件逻辑 · Widget logic、控件取值 · Widget value、组件内的控件逻辑 · Widget logic inside a component
- 输入 · In：容器 · Container（`element`，element:nl.container）
- 输出 · Out：可见 · Visible（`visible`，boolean）

### 获取特效 · Get Effects

`blueprint.element.text.getEffects` · 纯数据节点，没有执行针脚 · Pure: no exec pins

- 可放在 · Allowed in: 应用逻辑 · App logic、页面逻辑 · Page logic、控件逻辑 · Widget logic、控件取值 · Widget value、组件内的控件逻辑 · Widget logic inside a component
- 输入 · In：元素 · Element（`element`，element:nl.text）
- 输出 · Out：特效 · Effects（`effects`，json）

### 获取元素中心 · Get Element Center

`blueprint.element.displayable.getCenter` · 纯数据节点，没有执行针脚 · Pure: no exec pins

- 可放在 · Allowed in: 应用逻辑 · App logic、页面逻辑 · Page logic、控件逻辑 · Widget logic、控件取值 · Widget value、组件内的控件逻辑 · Widget logic inside a component
- 输入 · In：元素 · Element（`element`，element）
- 输出 · Out：中心 · Center（`center`，Vector2D）

### 获取元素显示状态 · Get Element Display

`blueprint.element.displayable.getDisplay` · 纯数据节点，没有执行针脚 · Pure: no exec pins

- 可放在 · Allowed in: 应用逻辑 · App logic、页面逻辑 · Page logic、控件逻辑 · Widget logic、控件取值 · Widget value、组件内的控件逻辑 · Widget logic inside a component
- 输入 · In：元素 · Element（`element`，element）
- 输出 · Out：显示状态 · Display（`display`，boolean）

### 获取元素实测矩形 · Get Element Measured Rect

`blueprint.element.displayable.getMeasuredRect` · 纯数据节点，没有执行针脚 · Pure: no exec pins

- 可放在 · Allowed in: 应用逻辑 · App logic、页面逻辑 · Page logic、控件逻辑 · Widget logic、控件取值 · Widget value、组件内的控件逻辑 · Widget logic inside a component
- 输入 · In：元素 · Element（`element`，element）
- 输出 · Out：矩形 · Rect（`rect`，Rect）

### 获取元素属性 · Get Element Property

`blueprint.element.displayable.getProperty` · 纯数据节点，没有执行针脚 · Pure: no exec pins

- 可放在 · Allowed in: 应用逻辑 · App logic、页面逻辑 · Page logic、控件逻辑 · Widget logic、控件取值 · Widget value、组件内的控件逻辑 · Widget logic inside a component
- 输入 · In：元素 · Element（`element`，element）
- 输出 · Out：值 · Value（`value`，any）
- 设置 · Setting：属性 · Property（`property`：位置 · Position / 尺寸 · Size / 边界 · Bounds / X / Y / 偏移 X · Offset X / 偏移 Y · Offset Y / 宽度 · Width / 高度 · Height / 旋转 · Rotation / 不透明度 · Opacity / 可见 · Visible）

### 获取字体 · Get Font

`blueprint.element.text.getFont` · 纯数据节点，没有执行针脚 · Pure: no exec pins

- 可放在 · Allowed in: 应用逻辑 · App logic、页面逻辑 · Page logic、控件逻辑 · Widget logic、控件取值 · Widget value、组件内的控件逻辑 · Widget logic inside a component
- 输入 · In：元素 · Element（`element`，element:nl.text）
- 输出 · Out：字体 · Font（`fontAssetId`，string）

### 获取字号 · Get Font Size

`blueprint.element.text.getFontSize` · 纯数据节点，没有执行针脚 · Pure: no exec pins

- 可放在 · Allowed in: 应用逻辑 · App logic、页面逻辑 · Page logic、控件逻辑 · Widget logic、控件取值 · Widget value、组件内的控件逻辑 · Widget logic inside a component
- 输入 · In：元素 · Element（`element`，element:nl.text）
- 输出 · Out：字号 · Font Size（`fontSize`，float）

### 获取字重 · Get Font Weight

`blueprint.element.text.getFontWeight` · 纯数据节点，没有执行针脚 · Pure: no exec pins

- 可放在 · Allowed in: 应用逻辑 · App logic、页面逻辑 · Page logic、控件逻辑 · Widget logic、控件取值 · Widget value、组件内的控件逻辑 · Widget logic inside a component
- 输入 · In：元素 · Element（`element`，element:nl.text）
- 输出 · Out：字重 · Font Weight（`fontWeight`，string）

### 获取框架启用状态 · Get Frame Enabled

`blueprint.element.frame.getEnabled` · 纯数据节点，没有执行针脚 · Pure: no exec pins

- 可放在 · Allowed in: 应用逻辑 · App logic、页面逻辑 · Page logic、控件逻辑 · Widget logic、控件取值 · Widget value、组件内的控件逻辑 · Widget logic inside a component
- 输入 · In：框架 · Frame（`element`，element:nl.frame）
- 输出 · Out：已启用 · Enabled（`enabled`，boolean）

### 获取框架参数 · Get Frame Params

`blueprint.element.frame.getParams` · 纯数据节点，没有执行针脚 · Pure: no exec pins

- 可放在 · Allowed in: 应用逻辑 · App logic、页面逻辑 · Page logic、控件逻辑 · Widget logic、控件取值 · Widget value、组件内的控件逻辑 · Widget logic inside a component
- 输入 · In：框架 · Frame（`element`，element:nl.frame）
- 输出 · Out：参数 · Params（`params`，json）

### 获取框架目标页面 · Get Frame Target Page

`blueprint.element.frame.getTargetPage` · 纯数据节点，没有执行针脚 · Pure: no exec pins

- 可放在 · Allowed in: 应用逻辑 · App logic、页面逻辑 · Page logic、控件逻辑 · Widget logic、控件取值 · Widget value、组件内的控件逻辑 · Widget logic inside a component
- 输入 · In：框架 · Frame（`element`，element:nl.frame）
- 输出 · Out：页面 · Page（`targetSurfaceId`，string）

### 获取框架可见性 · Get Frame Visible

`blueprint.element.frame.getVisible` · 纯数据节点，没有执行针脚 · Pure: no exec pins

- 可放在 · Allowed in: 应用逻辑 · App logic、页面逻辑 · Page logic、控件逻辑 · Widget logic、控件取值 · Widget value、组件内的控件逻辑 · Widget logic inside a component
- 输入 · In：框架 · Frame（`element`，element:nl.frame）
- 输出 · Out：可见 · Visible（`visible`，boolean）

### 获取图片资产 · Get Image Asset

`blueprint.element.image.getImageAsset` · 纯数据节点，没有执行针脚 · Pure: no exec pins

- 可放在 · Allowed in: 应用逻辑 · App logic、页面逻辑 · Page logic、控件逻辑 · Widget logic、控件取值 · Widget value、组件内的控件逻辑 · Widget logic inside a component
- 输入 · In：图片 · Image（`element`，element:nl.image）
- 输出 · Out：资产 · Asset（`asset`，ImageAsset|null）

### 获取图片裁剪矩形 · Get Image Crop Rect

`blueprint.element.image.getCropRect` · 纯数据节点，没有执行针脚 · Pure: no exec pins

- 可放在 · Allowed in: 应用逻辑 · App logic、页面逻辑 · Page logic、控件逻辑 · Widget logic、控件取值 · Widget value、组件内的控件逻辑 · Widget logic inside a component
- 输入 · In：图片 · Image（`element`，element:nl.image）
- 输出 · Out：左边距 % · Left %（`leftPct`，float）
- 输出 · Out：上边距 % · Top %（`topPct`，float）
- 输出 · Out：宽度 % · Width %（`widthPct`，float）
- 输出 · Out：高度 % · Height %（`heightPct`，float）

### 获取图片启用状态 · Get Image Enabled

`blueprint.element.image.getEnabled` · 纯数据节点，没有执行针脚 · Pure: no exec pins

- 可放在 · Allowed in: 应用逻辑 · App logic、页面逻辑 · Page logic、控件逻辑 · Widget logic、控件取值 · Widget value、组件内的控件逻辑 · Widget logic inside a component
- 输入 · In：图片 · Image（`element`，element:nl.image）
- 输出 · Out：已启用 · Enabled（`enabled`，boolean）

### 获取图片适配模式 · Get Image Fit Mode

`blueprint.element.image.getFitMode` · 纯数据节点，没有执行针脚 · Pure: no exec pins

- 可放在 · Allowed in: 应用逻辑 · App logic、页面逻辑 · Page logic、控件逻辑 · Widget logic、控件取值 · Widget value、组件内的控件逻辑 · Widget logic inside a component
- 输入 · In：图片 · Image（`element`，element:nl.image）
- 输出 · Out：适配模式 · Fit Mode（`fitMode`，string）

### 获取图片水平翻转 · Get Image Flip X

`blueprint.element.image.getFlipX` · 纯数据节点，没有执行针脚 · Pure: no exec pins

- 可放在 · Allowed in: 应用逻辑 · App logic、页面逻辑 · Page logic、控件逻辑 · Widget logic、控件取值 · Widget value、组件内的控件逻辑 · Widget logic inside a component
- 输入 · In：图片 · Image（`element`，element:nl.image）
- 输出 · Out：水平翻转 · Flip X（`flipX`，boolean）

### 获取图片垂直翻转 · Get Image Flip Y

`blueprint.element.image.getFlipY` · 纯数据节点，没有执行针脚 · Pure: no exec pins

- 可放在 · Allowed in: 应用逻辑 · App logic、页面逻辑 · Page logic、控件逻辑 · Widget logic、控件取值 · Widget value、组件内的控件逻辑 · Widget logic inside a component
- 输入 · In：图片 · Image（`element`，element:nl.image）
- 输出 · Out：垂直翻转 · Flip Y（`flipY`，boolean）

### 获取图片可见性 · Get Image Visible

`blueprint.element.image.getVisible` · 纯数据节点，没有执行针脚 · Pure: no exec pins

- 可放在 · Allowed in: 应用逻辑 · App logic、页面逻辑 · Page logic、控件逻辑 · Widget logic、控件取值 · Widget value、组件内的控件逻辑 · Widget logic inside a component
- 输入 · In：图片 · Image（`element`，element:nl.image）
- 输出 · Out：可见 · Visible（`visible`，boolean）

### 取指定条目 · Get Item At

`blueprint.element.list.getItemAt` · 纯数据节点，没有执行针脚 · Pure: no exec pins

- 可放在 · Allowed in: 应用逻辑 · App logic、页面逻辑 · Page logic、控件逻辑 · Widget logic、控件取值 · Widget value、组件内的控件逻辑 · Widget logic inside a component
- 输入 · In：列表 · List（`list`，element:nl.list）
- 输入 · In：索引 · Index（`index`，integer；可直接填值 · accepts a typed value）
- 输出 · Out：项 · Item（`item`，json）

### 获取行高 · Get Line Height

`blueprint.element.text.getLineHeight` · 纯数据节点，没有执行针脚 · Pure: no exec pins

- 可放在 · Allowed in: 应用逻辑 · App logic、页面逻辑 · Page logic、控件逻辑 · Widget logic、控件取值 · Widget value、组件内的控件逻辑 · Widget logic inside a component
- 输入 · In：元素 · Element（`element`，element:nl.text）
- 输出 · Out：行高 · Line Height（`lineHeight`，float）

### 获取列表内容 · Get List Content

`blueprint.element.list.getItems` · 纯数据节点，没有执行针脚 · Pure: no exec pins

- 可放在 · Allowed in: 应用逻辑 · App logic、页面逻辑 · Page logic、控件逻辑 · Widget logic、控件取值 · Widget value、组件内的控件逻辑 · Widget logic inside a component
- 输入 · In：列表 · List（`list`，element:nl.list）
- 输出 · Out：项列表 · Items（`items`，array）

### 获取列表启用状态 · Get List Enabled

`blueprint.element.list.getEnabled` · 纯数据节点，没有执行针脚 · Pure: no exec pins

- 可放在 · Allowed in: 应用逻辑 · App logic、页面逻辑 · Page logic、控件逻辑 · Widget logic、控件取值 · Widget value、组件内的控件逻辑 · Widget logic inside a component
- 输入 · In：列表 · List（`element`，element:nl.list）
- 输出 · Out：已启用 · Enabled（`enabled`，boolean）

### 获取列表长度 · Get List Length

`blueprint.element.list.getLength` · 纯数据节点，没有执行针脚 · Pure: no exec pins

- 可放在 · Allowed in: 应用逻辑 · App logic、页面逻辑 · Page logic、控件逻辑 · Widget logic、控件取值 · Widget value、组件内的控件逻辑 · Widget logic inside a component
- 输入 · In：列表 · List（`list`，element:nl.list）
- 输出 · Out：长度 · Length（`length`，integer）

### 获取列表可见性 · Get List Visible

`blueprint.element.list.getVisible` · 纯数据节点，没有执行针脚 · Pure: no exec pins

- 可放在 · Allowed in: 应用逻辑 · App logic、页面逻辑 · Page logic、控件逻辑 · Widget logic、控件取值 · Widget value、组件内的控件逻辑 · Widget logic inside a component
- 输入 · In：列表 · List（`element`，element:nl.list）
- 输出 · Out：可见 · Visible（`visible`，boolean）

### 获取滚动位置 · Get Scroll Offset

`blueprint.element.list.getScrollOffset` · 纯数据节点，没有执行针脚 · Pure: no exec pins

- 可放在 · Allowed in: 应用逻辑 · App logic、页面逻辑 · Page logic、控件逻辑 · Widget logic、控件取值 · Widget value、组件内的控件逻辑 · Widget logic inside a component
- 输入 · In：列表 · List（`list`，element:nl.list）
- 输出 · Out：偏移 · Offset（`offset`，float）
- 输出 · Out：最大偏移 · Max Offset（`maxOffset`，float）

### 获取滚动进度 · Get Scroll Progress

`blueprint.element.list.getScrollProgress` · 纯数据节点，没有执行针脚 · Pure: no exec pins

- 可放在 · Allowed in: 应用逻辑 · App logic、页面逻辑 · Page logic、控件逻辑 · Widget logic、控件取值 · Widget value、组件内的控件逻辑 · Widget logic inside a component
- 输入 · In：列表 · List（`list`，element:nl.list）
- 输出 · Out：进度 · Progress（`progress`，float）

### 获取选中索引 · Get Selected Index

`blueprint.element.list.getSelectedIndex` · 纯数据节点，没有执行针脚 · Pure: no exec pins

- 可放在 · Allowed in: 应用逻辑 · App logic、页面逻辑 · Page logic、控件逻辑 · Widget logic、控件取值 · Widget value、组件内的控件逻辑 · Widget logic inside a component
- 输入 · In：列表 · List（`list`，element:nl.list）
- 输出 · Out：索引 · Index（`index`，integer）

### 获取选中项 · Get Selected Item

`blueprint.element.list.getSelectedItem` · 纯数据节点，没有执行针脚 · Pure: no exec pins

- 可放在 · Allowed in: 应用逻辑 · App logic、页面逻辑 · Page logic、控件逻辑 · Widget logic、控件取值 · Widget value、组件内的控件逻辑 · Widget logic inside a component
- 输入 · In：列表 · List（`list`，element:nl.list）
- 输出 · Out：项 · Item（`item`，json）

### 获取滑块启用状态 · Get Slider Enabled

`blueprint.element.slider.getEnabled` · 纯数据节点，没有执行针脚 · Pure: no exec pins

- 可放在 · Allowed in: 应用逻辑 · App logic、页面逻辑 · Page logic、控件逻辑 · Widget logic、控件取值 · Widget value、组件内的控件逻辑 · Widget logic inside a component
- 输入 · In：滑块 · Slider（`element`，element:nl.slider）
- 输出 · Out：已启用 · Enabled（`enabled`，boolean）

### 获取滑块归一化值 · Get Slider Normalized Value

`blueprint.element.slider.getNormalizedValue` · 纯数据节点，没有执行针脚 · Pure: no exec pins

- 可放在 · Allowed in: 应用逻辑 · App logic、页面逻辑 · Page logic、控件逻辑 · Widget logic、控件取值 · Widget value、组件内的控件逻辑 · Widget logic inside a component
- 输入 · In：滑块 · Slider（`slider`，element:nl.slider）
- 输出 · Out：归一化值 · Normalized（`normalizedValue`，float）

### 获取滑块范围 · Get Slider Range

`blueprint.element.slider.getRange` · 纯数据节点，没有执行针脚 · Pure: no exec pins

- 可放在 · Allowed in: 应用逻辑 · App logic、页面逻辑 · Page logic、控件逻辑 · Widget logic、控件取值 · Widget value、组件内的控件逻辑 · Widget logic inside a component
- 输入 · In：滑块 · Slider（`slider`，element:nl.slider）
- 输出 · Out：最小值 · Min（`min`，float）
- 输出 · Out：最大值 · Max（`max`，float）
- 输出 · Out：步长 · Step（`step`，float）

### 获取滑块值 · Get Slider Value

`blueprint.element.slider.getValue` · 纯数据节点，没有执行针脚 · Pure: no exec pins

- 可放在 · Allowed in: 应用逻辑 · App logic、页面逻辑 · Page logic、控件逻辑 · Widget logic、控件取值 · Widget value、组件内的控件逻辑 · Widget logic inside a component
- 输入 · In：滑块 · Slider（`slider`，element:nl.slider）
- 输出 · Out：值 · Value（`value`，float）

### 获取滑块可见性 · Get Slider Visible

`blueprint.element.slider.getVisible` · 纯数据节点，没有执行针脚 · Pure: no exec pins

- 可放在 · Allowed in: 应用逻辑 · App logic、页面逻辑 · Page logic、控件逻辑 · Widget logic、控件取值 · Widget value、组件内的控件逻辑 · Widget logic inside a component
- 输入 · In：滑块 · Slider（`element`，element:nl.slider）
- 输出 · Out：可见 · Visible（`visible`，boolean）

### 获取开关状态 · Get Switch Checked

`blueprint.element.switch.getChecked` · 纯数据节点，没有执行针脚 · Pure: no exec pins

- 可放在 · Allowed in: 应用逻辑 · App logic、页面逻辑 · Page logic、控件逻辑 · Widget logic、控件取值 · Widget value、组件内的控件逻辑 · Widget logic inside a component
- 输入 · In：开关 · Switch（`switch`，element:nl.switch）
- 输出 · Out：开启 · Checked（`checked`，boolean）

### 获取开关启用状态 · Get Switch Enabled

`blueprint.element.switch.getEnabled` · 纯数据节点，没有执行针脚 · Pure: no exec pins

- 可放在 · Allowed in: 应用逻辑 · App logic、页面逻辑 · Page logic、控件逻辑 · Widget logic、控件取值 · Widget value、组件内的控件逻辑 · Widget logic inside a component
- 输入 · In：开关 · Switch（`element`，element:nl.switch）
- 输出 · Out：已启用 · Enabled（`enabled`，boolean）

### 获取开关可见性 · Get Switch Visible

`blueprint.element.switch.getVisible` · 纯数据节点，没有执行针脚 · Pure: no exec pins

- 可放在 · Allowed in: 应用逻辑 · App logic、页面逻辑 · Page logic、控件逻辑 · Widget logic、控件取值 · Widget value、组件内的控件逻辑 · Widget logic inside a component
- 输入 · In：开关 · Switch（`element`，element:nl.switch）
- 输出 · Out：可见 · Visible（`visible`，boolean）

### 获取文本 · Get Text

`blueprint.element.text.getText` · 纯数据节点，没有执行针脚 · Pure: no exec pins

- 可放在 · Allowed in: 应用逻辑 · App logic、页面逻辑 · Page logic、控件逻辑 · Widget logic、控件取值 · Widget value、组件内的控件逻辑 · Widget logic inside a component
- 输入 · In：元素 · Element（`element`，element:nl.text）
- 输出 · Out：文本 · Text（`text`，string）

### 获取文本 · Get Text

`blueprint.element.textInput.getValue` · 纯数据节点，没有执行针脚 · Pure: no exec pins

- 可放在 · Allowed in: 应用逻辑 · App logic、页面逻辑 · Page logic、控件逻辑 · Widget logic、控件取值 · Widget value、组件内的控件逻辑 · Widget logic inside a component
- 输入 · In：文本输入框 · Text Input（`textInput`，element:nl.textInput）
- 输出 · Out：值 · Value（`value`，string）
- 输出 · Out：长度 · Length（`length`，float）

### 获取文本对齐 · Get Text Align

`blueprint.element.text.getTextAlign` · 纯数据节点，没有执行针脚 · Pure: no exec pins

- 可放在 · Allowed in: 应用逻辑 · App logic、页面逻辑 · Page logic、控件逻辑 · Widget logic、控件取值 · Widget value、组件内的控件逻辑 · Widget logic inside a component
- 输入 · In：元素 · Element（`element`，element:nl.text）
- 输出 · Out：文本对齐 · Text Align（`textAlign`，string）

### 获取文本颜色 · Get Text Color

`blueprint.element.text.getTextColor` · 纯数据节点，没有执行针脚 · Pure: no exec pins

- 可放在 · Allowed in: 应用逻辑 · App logic、页面逻辑 · Page logic、控件逻辑 · Widget logic、控件取值 · Widget value、组件内的控件逻辑 · Widget logic inside a component
- 输入 · In：元素 · Element（`element`，element:nl.text）
- 输出 · Out：颜色 · Color（`color`，RGBAColor）

### 获取文本启用状态 · Get Text Enabled

`blueprint.element.text.getEnabled` · 纯数据节点，没有执行针脚 · Pure: no exec pins

- 可放在 · Allowed in: 应用逻辑 · App logic、页面逻辑 · Page logic、控件逻辑 · Widget logic、控件取值 · Widget value、组件内的控件逻辑 · Widget logic inside a component
- 输入 · In：文本 · Text（`element`，element:nl.text）
- 输出 · Out：已启用 · Enabled（`enabled`，boolean）

### 获取文本垂直对齐 · Get Text Vertical Align

`blueprint.element.text.getTextVerticalAlign` · 纯数据节点，没有执行针脚 · Pure: no exec pins

- 可放在 · Allowed in: 应用逻辑 · App logic、页面逻辑 · Page logic、控件逻辑 · Widget logic、控件取值 · Widget value、组件内的控件逻辑 · Widget logic inside a component
- 输入 · In：元素 · Element（`element`，element:nl.text）
- 输出 · Out：垂直对齐 · Vertical Align（`textVerticalAlign`，string）

### 获取文本可见性 · Get Text Visible

`blueprint.element.text.getVisible` · 纯数据节点，没有执行针脚 · Pure: no exec pins

- 可放在 · Allowed in: 应用逻辑 · App logic、页面逻辑 · Page logic、控件逻辑 · Widget logic、控件取值 · Widget value、组件内的控件逻辑 · Widget logic inside a component
- 输入 · In：文本 · Text（`element`，element:nl.text）
- 输出 · Out：可见 · Visible（`visible`，boolean）

### 获取视频时长 · Get Video Duration

`blueprint.element.video.getDuration` · 纯数据节点，没有执行针脚 · Pure: no exec pins

视频文件的时长，单位为秒；加载完成前为 0

How long the clip is, in seconds. 0 until the clip has loaded.

- 可放在 · Allowed in: 应用逻辑 · App logic、页面逻辑 · Page logic、控件逻辑 · Widget logic、控件取值 · Widget value、组件内的控件逻辑 · Widget logic inside a component
- 输入 · In：视频 · Video（`video`，element:nl.video）
- 输出 · Out：时长（秒） · Duration (s)（`duration`，float）

### 获取视频播放位置 · Get Video Time

`blueprint.element.video.getTime` · 纯数据节点，没有执行针脚 · Pure: no exec pins

视频当前的播放位置，为从视频开头计的秒数；画面上没有视频时为 0

Where the video is, in seconds from the start of the clip. 0 while there is no clip on screen.

- 可放在 · Allowed in: 应用逻辑 · App logic、页面逻辑 · Page logic、控件逻辑 · Widget logic、控件取值 · Widget value、组件内的控件逻辑 · Widget logic inside a component
- 输入 · In：视频 · Video（`video`，element:nl.video）
- 输出 · Out：时间（秒） · Time (s)（`time`，float）

### 获取视频音量 · Get Video Volume

`blueprint.element.video.getVolume` · 纯数据节点，没有执行针脚 · Pure: no exec pins

视频的音量（0 到 1），即控件上设置的或「设置视频音量」设置的值，不含玩家的音量设置

The video's volume, from 0 to 1: the one set on the widget, or by Set Video Volume. The player's volume settings are not included.

- 可放在 · Allowed in: 应用逻辑 · App logic、页面逻辑 · Page logic、控件逻辑 · Widget logic、控件取值 · Widget value、组件内的控件逻辑 · Widget logic inside a component
- 输入 · In：视频 · Video（`video`，element:nl.video）
- 输出 · Out：音量 · Volume（`volume`，float）

### 获取换行模式 · Get Wrap Mode

`blueprint.element.text.getWrapMode` · 纯数据节点，没有执行针脚 · Pure: no exec pins

- 可放在 · Allowed in: 应用逻辑 · App logic、页面逻辑 · Page logic、控件逻辑 · Widget logic、控件取值 · Widget value、组件内的控件逻辑 · Widget logic inside a component
- 输入 · In：元素 · Element（`element`，element:nl.text）
- 输出 · Out：换行模式 · Wrap Mode（`textWrapMode`，string）

### 插入列表项 · Insert List Item

`blueprint.element.list.insertItem` · 会等待，完成后才继续 · Latent: waits before continuing

- 可放在 · Allowed in: 应用逻辑 · App logic、页面逻辑 · Page logic、控件逻辑 · Widget logic、组件内的控件逻辑 · Widget logic inside a component
- 输入 · In：进入 · In（`in`，执行 · exec）
- 输出 · Out：下一步 · Next（`next`，执行 · exec）
- 输入 · In：列表 · List（`list`，element:nl.list）
- 输入 · In：索引 · Index（`index`，integer；可直接填值 · accepts a typed value）
- 输入 · In：项 · Item（`item`，any）

### 是否已到末尾 · Is Scrolled To End

`blueprint.element.list.isScrolledToEnd` · 纯数据节点，没有执行针脚 · Pure: no exec pins

- 可放在 · Allowed in: 应用逻辑 · App logic、页面逻辑 · Page logic、控件逻辑 · Widget logic、控件取值 · Widget value、组件内的控件逻辑 · Widget logic inside a component
- 输入 · In：列表 · List（`list`，element:nl.list）
- 输出 · Out：已到末尾 · At End（`atEnd`，boolean）

### 是否已到开头 · Is Scrolled To Start

`blueprint.element.list.isScrolledToStart` · 纯数据节点，没有执行针脚 · Pure: no exec pins

- 可放在 · Allowed in: 应用逻辑 · App logic、页面逻辑 · Page logic、控件逻辑 · Widget logic、控件取值 · Widget value、组件内的控件逻辑 · Widget logic inside a component
- 输入 · In：列表 · List（`list`，element:nl.list）
- 输出 · Out：已到开头 · At Start（`atStart`，boolean）

### 视频是否已播完 · Is Video Ended

`blueprint.element.video.isEnded` · 纯数据节点，没有执行针脚 · Pure: no exec pins

视频播放到结尾后为真，直到再次播放或跳转位置。开启「循环」时始终为假

True once the clip has played to its end, until it is played or moved again. Never true while Loop is on.

- 可放在 · Allowed in: 应用逻辑 · App logic、页面逻辑 · Page logic、控件逻辑 · Widget logic、控件取值 · Widget value、组件内的控件逻辑 · Widget logic inside a component
- 输入 · In：视频 · Video（`video`，element:nl.video）
- 输出 · Out：已播完 · Is Ended（`isEnded`，boolean）

### 视频是否静音 · Is Video Muted

`blueprint.element.video.isMuted` · 纯数据节点，没有执行针脚 · Pure: no exec pins

视频处于静音时为真

True while the video is muted.

- 可放在 · Allowed in: 应用逻辑 · App logic、页面逻辑 · Page logic、控件逻辑 · Widget logic、控件取值 · Widget value、组件内的控件逻辑 · Widget logic inside a component
- 输入 · In：视频 · Video（`video`，element:nl.video）
- 输出 · Out：静音 · Muted（`muted`，boolean）

### 视频是否在播放 · Is Video Playing

`blueprint.element.video.isPlaying` · 纯数据节点，没有执行针脚 · Pure: no exec pins

视频正在播放时为真；暂停、停止、已播完以及画面上没有视频时为假

True while the video is playing. False while it is paused, stopped or at its end, and while there is no clip on screen.

- 可放在 · Allowed in: 应用逻辑 · App logic、页面逻辑 · Page logic、控件逻辑 · Widget logic、控件取值 · Widget value、组件内的控件逻辑 · Widget logic inside a component
- 输入 · In：视频 · Video（`video`，element:nl.video）
- 输出 · Out：播放中 · Is Playing（`isPlaying`，boolean）

### 暂停视频 · Pause Video

`blueprint.element.video.pause` · 会等待，完成后才继续 · Latent: waits before continuing

在当前位置暂停视频；「播放视频」从该位置继续播放

Pauses the video where it is. Play Video resumes it from there.

- 可放在 · Allowed in: 应用逻辑 · App logic、页面逻辑 · Page logic、控件逻辑 · Widget logic、组件内的控件逻辑 · Widget logic inside a component
- 输入 · In：进入 · In（`in`，执行 · exec）
- 输出 · Out：下一步 · Next（`next`，执行 · exec）
- 输入 · In：视频 · Video（`video`，element:nl.video）

### 播放视频 · Play Video

`blueprint.element.video.play` · 会等待，完成后才继续 · Latent: waits before continuing

开始播放视频，或从暂停处继续播放；视频已播完时从头重新播放。音量与「自动播放」相同，受玩家的音量设置影响。视频文件尚未加载完成时，加载完成后开始播放

Starts the video, or resumes it from where it was paused. After the clip has ended, plays it again from the start. Plays at the volume the player has set, as Autoplay does. A clip that has not loaded yet starts once it has.

- 可放在 · Allowed in: 应用逻辑 · App logic、页面逻辑 · Page logic、控件逻辑 · Widget logic、组件内的控件逻辑 · Widget logic inside a component
- 输入 · In：进入 · In（`in`，执行 · exec）
- 输出 · Out：下一步 · Next（`next`，执行 · exec）
- 输入 · In：视频 · Video（`video`，element:nl.video）

### 刷新列表项 · Refresh List Items

`blueprint.element.list.refreshItems` · 会等待，完成后才继续 · Latent: waits before continuing

- 可放在 · Allowed in: 应用逻辑 · App logic、页面逻辑 · Page logic、控件逻辑 · Widget logic、组件内的控件逻辑 · Widget logic inside a component
- 输入 · In：进入 · In（`in`，执行 · exec）
- 输出 · Out：下一步 · Next（`next`，执行 · exec）
- 输入 · In：列表 · List（`list`，element:nl.list）

### 移除列表项 · Remove List Item

`blueprint.element.list.removeItem` · 会等待，完成后才继续 · Latent: waits before continuing

- 可放在 · Allowed in: 应用逻辑 · App logic、页面逻辑 · Page logic、控件逻辑 · Widget logic、组件内的控件逻辑 · Widget logic inside a component
- 输入 · In：进入 · In（`in`，执行 · exec）
- 输出 · Out：下一步 · Next（`next`，执行 · exec）
- 输入 · In：列表 · List（`list`，element:nl.list）
- 输入 · In：项 · Item（`item`，any）

### 按索引移除列表项 · Remove List Item At

`blueprint.element.list.removeItemAt` · 会等待，完成后才继续 · Latent: waits before continuing

- 可放在 · Allowed in: 应用逻辑 · App logic、页面逻辑 · Page logic、控件逻辑 · Widget logic、组件内的控件逻辑 · Widget logic inside a component
- 输入 · In：进入 · In（`in`，执行 · exec）
- 输出 · Out：下一步 · Next（`next`，执行 · exec）
- 输入 · In：列表 · List（`list`，element:nl.list）
- 输入 · In：索引 · Index（`index`，integer；可直接填值 · accepts a typed value）

### 滚动到底部 · Scroll To Bottom

`blueprint.element.list.scrollToBottom` · 会等待，完成后才继续 · Latent: waits before continuing

- 可放在 · Allowed in: 应用逻辑 · App logic、页面逻辑 · Page logic、控件逻辑 · Widget logic、组件内的控件逻辑 · Widget logic inside a component
- 输入 · In：进入 · In（`in`，执行 · exec）
- 输出 · Out：下一步 · Next（`next`，执行 · exec）
- 输入 · In：列表 · List（`list`，element:nl.list）

### 滚动到索引 · Scroll To Index

`blueprint.element.list.scrollToIndex` · 会等待，完成后才继续 · Latent: waits before continuing

- 可放在 · Allowed in: 应用逻辑 · App logic、页面逻辑 · Page logic、控件逻辑 · Widget logic、组件内的控件逻辑 · Widget logic inside a component
- 输入 · In：进入 · In（`in`，执行 · exec）
- 输出 · Out：下一步 · Next（`next`，执行 · exec）
- 输入 · In：列表 · List（`list`，element:nl.list）
- 输入 · In：索引 · Index（`index`，integer；可直接填值 · accepts a typed value）

### 滚动到顶部 · Scroll To Top

`blueprint.element.list.scrollToTop` · 会等待，完成后才继续 · Latent: waits before continuing

- 可放在 · Allowed in: 应用逻辑 · App logic、页面逻辑 · Page logic、控件逻辑 · Widget logic、组件内的控件逻辑 · Widget logic inside a component
- 输入 · In：进入 · In（`in`，执行 · exec）
- 输出 · Out：下一步 · Next（`next`，执行 · exec）
- 输入 · In：列表 · List（`list`，element:nl.list）

### 跳转视频播放位置 · Seek Video

`blueprint.element.video.seek` · 会等待，完成后才继续 · Latent: waits before continuing

把视频移到「时间（秒）」处，从视频开头计时。超过结尾的时间移到结尾，负数移到开头。播放或暂停状态不变：正在播放的视频移到结尾时运行「播放结束」，暂停中的视频停在结尾

Moves the video to Time, in seconds from the start of the clip. A time past the end moves it to the end, and a negative time to the start. A playing video keeps playing and a paused one stays paused. A playing video moved to its end runs Playback Ended.

- 可放在 · Allowed in: 应用逻辑 · App logic、页面逻辑 · Page logic、控件逻辑 · Widget logic、组件内的控件逻辑 · Widget logic inside a component
- 输入 · In：进入 · In（`in`，执行 · exec）
- 输出 · Out：下一步 · Next（`next`，执行 · exec）
- 输入 · In：视频 · Video（`video`，element:nl.video）
- 输入 · In：时间（秒） · Time (s)（`time`，float；可直接填值 · accepts a typed value）

### 设置全部属性 · Set All Properties

`blueprint.element.text.setAllProperties` · 会等待，完成后才继续 · Latent: waits before continuing

- 可放在 · Allowed in: 应用逻辑 · App logic、页面逻辑 · Page logic、控件逻辑 · Widget logic、组件内的控件逻辑 · Widget logic inside a component
- 输入 · In：进入 · In（`in`，执行 · exec）
- 输出 · Out：下一步 · Next（`next`，执行 · exec）
- 输入 · In：元素 · Element（`element`，element:nl.text）
- 输入 · In：文本 · Text（`text`，string；可直接填值 · accepts a typed value）
- 输入 · In：字体 · Font（`fontAssetId`，string；可直接填值 · accepts a typed value）
- 输入 · In：字号 · Font Size（`fontSize`，float；可直接填值 · accepts a typed value）
- 输入 · In：字重 · Font Weight（`fontWeight`，string；可直接填值 · accepts a typed value）
- 输入 · In：颜色 · Color（`color`，RGBAColor）
- 输入 · In：文本对齐 · Text Align（`textAlign`，string；可直接填值 · accepts a typed value）
- 输入 · In：垂直对齐 · Vertical Align（`textVerticalAlign`，string；可直接填值 · accepts a typed value）
- 输入 · In：行高 · Line Height（`lineHeight`，float；可直接填值 · accepts a typed value）
- 输入 · In：换行模式 · Wrap Mode（`textWrapMode`，string；可直接填值 · accepts a typed value）
- 输入 · In：特效 · Effects（`effects`，json）

### 设置按钮启用状态 · Set Button Enabled

`blueprint.element.button.setEnabled` · 会等待，完成后才继续 · Latent: waits before continuing

- 可放在 · Allowed in: 应用逻辑 · App logic、页面逻辑 · Page logic、控件逻辑 · Widget logic、组件内的控件逻辑 · Widget logic inside a component
- 输入 · In：进入 · In（`in`，执行 · exec）
- 输出 · Out：下一步 · Next（`next`，执行 · exec）
- 输入 · In：按钮 · Button（`element`，element:nl.button）
- 输入 · In：已启用 · Enabled（`enabled`，boolean）

### 设置按钮标签 · Set Button Label

`blueprint.element.button.setLabel` · 会等待，完成后才继续 · Latent: waits before continuing

- 可放在 · Allowed in: 应用逻辑 · App logic、页面逻辑 · Page logic、控件逻辑 · Widget logic、组件内的控件逻辑 · Widget logic inside a component
- 输入 · In：进入 · In（`in`，执行 · exec）
- 输出 · Out：下一步 · Next（`next`，执行 · exec）
- 输入 · In：按钮 · Button（`element`，element:nl.button）
- 输入 · In：标签 · Label（`label`，string；可直接填值 · accepts a typed value）

### 设置按钮指针 · Set Button Pointer

`blueprint.element.button.setPointer` · 会等待，完成后才继续 · Latent: waits before continuing

- 可放在 · Allowed in: 应用逻辑 · App logic、页面逻辑 · Page logic、控件逻辑 · Widget logic、组件内的控件逻辑 · Widget logic inside a component
- 输入 · In：进入 · In（`in`，执行 · exec）
- 输出 · Out：下一步 · Next（`next`，执行 · exec）
- 输入 · In：按钮 · Button（`element`，element:nl.button）
- 设置 · Setting：指针 · Pointer（`cursor`）

### 设置按钮可见性 · Set Button Visible

`blueprint.element.button.setVisible` · 会等待，完成后才继续 · Latent: waits before continuing

- 可放在 · Allowed in: 应用逻辑 · App logic、页面逻辑 · Page logic、控件逻辑 · Widget logic、组件内的控件逻辑 · Widget logic inside a component
- 输入 · In：进入 · In（`in`，执行 · exec）
- 输出 · Out：下一步 · Next（`next`，执行 · exec）
- 输入 · In：按钮 · Button（`element`，element:nl.button）
- 输入 · In：可见 · Visible（`visible`，boolean）

### 设置容器内容裁剪 · Set Container Clip Content

`blueprint.element.container.setClipContent` · 会等待，完成后才继续 · Latent: waits before continuing

- 可放在 · Allowed in: 应用逻辑 · App logic、页面逻辑 · Page logic、控件逻辑 · Widget logic、组件内的控件逻辑 · Widget logic inside a component
- 输入 · In：进入 · In（`in`，执行 · exec）
- 输出 · Out：下一步 · Next（`next`，执行 · exec）
- 输入 · In：容器 · Container（`element`，element:nl.container）
- 输入 · In：裁剪 · Clip（`clipContent`，boolean）

### 设置容器启用状态 · Set Container Enabled

`blueprint.element.container.setEnabled` · 会等待，完成后才继续 · Latent: waits before continuing

- 可放在 · Allowed in: 应用逻辑 · App logic、页面逻辑 · Page logic、控件逻辑 · Widget logic、组件内的控件逻辑 · Widget logic inside a component
- 输入 · In：进入 · In（`in`，执行 · exec）
- 输出 · Out：下一步 · Next（`next`，执行 · exec）
- 输入 · In：容器 · Container（`element`，element:nl.container）
- 输入 · In：已启用 · Enabled（`enabled`，boolean）

### 设置容器可见性 · Set Container Visible

`blueprint.element.container.setVisible` · 会等待，完成后才继续 · Latent: waits before continuing

- 可放在 · Allowed in: 应用逻辑 · App logic、页面逻辑 · Page logic、控件逻辑 · Widget logic、组件内的控件逻辑 · Widget logic inside a component
- 输入 · In：进入 · In（`in`，执行 · exec）
- 输出 · Out：下一步 · Next（`next`，执行 · exec）
- 输入 · In：容器 · Container（`element`，element:nl.container）
- 输入 · In：可见 · Visible（`visible`，boolean）

### 设置特效 · Set Effects

`blueprint.element.text.setEffects` · 会等待，完成后才继续 · Latent: waits before continuing

- 可放在 · Allowed in: 应用逻辑 · App logic、页面逻辑 · Page logic、控件逻辑 · Widget logic、组件内的控件逻辑 · Widget logic inside a component
- 输入 · In：进入 · In（`in`，执行 · exec）
- 输出 · Out：下一步 · Next（`next`，执行 · exec）
- 输入 · In：元素 · Element（`element`，element:nl.text）
- 输入 · In：特效 · Effects（`effects`，json）

### 设置元素显示状态 · Set Element Display

`blueprint.element.displayable.setDisplay` · 会等待，完成后才继续 · Latent: waits before continuing

- 可放在 · Allowed in: 应用逻辑 · App logic、页面逻辑 · Page logic、控件逻辑 · Widget logic、组件内的控件逻辑 · Widget logic inside a component
- 输入 · In：进入 · In（`in`，执行 · exec）
- 输出 · Out：下一步 · Next（`next`，执行 · exec）
- 输入 · In：元素 · Element（`element`，element）
- 输入 · In：显示状态 · Display（`display`，boolean）

### 设置元素属性 · Set Element Property

`blueprint.element.displayable.setProperty` · 会等待，完成后才继续 · Latent: waits before continuing

- 可放在 · Allowed in: 应用逻辑 · App logic、页面逻辑 · Page logic、控件逻辑 · Widget logic、组件内的控件逻辑 · Widget logic inside a component
- 输入 · In：进入 · In（`in`，执行 · exec）
- 输出 · Out：下一步 · Next（`next`，执行 · exec）
- 输入 · In：元素 · Element（`element`，element）
- 输入 · In：值 · Value（`value`，any）
- 设置 · Setting：属性 · Property（`property`：X / Y / 偏移 X · Offset X / 偏移 Y · Offset Y / 宽度 · Width / 高度 · Height / 旋转 · Rotation / 不透明度 · Opacity / 可见 · Visible）
- 设置 · Setting：值 · Value（`value`）

### 设置元素变体 · Set Element Variant

`blueprint.element.displayable.setVariant` · 会等待，完成后才继续 · Latent: waits before continuing

- 可放在 · Allowed in: 应用逻辑 · App logic、页面逻辑 · Page logic、控件逻辑 · Widget logic、组件内的控件逻辑 · Widget logic inside a component
- 输入 · In：进入 · In（`in`，执行 · exec）
- 输出 · Out：下一步 · Next（`next`，执行 · exec）
- 输入 · In：元素 · Element（`element`，element）

### 设置字体 · Set Font

`blueprint.element.text.setFont` · 会等待，完成后才继续 · Latent: waits before continuing

- 可放在 · Allowed in: 应用逻辑 · App logic、页面逻辑 · Page logic、控件逻辑 · Widget logic、组件内的控件逻辑 · Widget logic inside a component
- 输入 · In：进入 · In（`in`，执行 · exec）
- 输出 · Out：下一步 · Next（`next`，执行 · exec）
- 输入 · In：元素 · Element（`element`，element:nl.text）
- 输入 · In：字体 · Font（`fontAssetId`，string；可直接填值 · accepts a typed value）

### 设置字号 · Set Font Size

`blueprint.element.text.setFontSize` · 会等待，完成后才继续 · Latent: waits before continuing

- 可放在 · Allowed in: 应用逻辑 · App logic、页面逻辑 · Page logic、控件逻辑 · Widget logic、组件内的控件逻辑 · Widget logic inside a component
- 输入 · In：进入 · In（`in`，执行 · exec）
- 输出 · Out：下一步 · Next（`next`，执行 · exec）
- 输入 · In：元素 · Element（`element`，element:nl.text）
- 输入 · In：字号 · Font Size（`fontSize`，float；可直接填值 · accepts a typed value）

### 设置字重 · Set Font Weight

`blueprint.element.text.setFontWeight` · 会等待，完成后才继续 · Latent: waits before continuing

- 可放在 · Allowed in: 应用逻辑 · App logic、页面逻辑 · Page logic、控件逻辑 · Widget logic、组件内的控件逻辑 · Widget logic inside a component
- 输入 · In：进入 · In（`in`，执行 · exec）
- 输出 · Out：下一步 · Next（`next`，执行 · exec）
- 输入 · In：元素 · Element（`element`，element:nl.text）
- 输入 · In：字重 · Font Weight（`fontWeight`，string；可直接填值 · accepts a typed value）

### 设置框架启用状态 · Set Frame Enabled

`blueprint.element.frame.setEnabled` · 会等待，完成后才继续 · Latent: waits before continuing

- 可放在 · Allowed in: 应用逻辑 · App logic、页面逻辑 · Page logic、控件逻辑 · Widget logic、组件内的控件逻辑 · Widget logic inside a component
- 输入 · In：进入 · In（`in`，执行 · exec）
- 输出 · Out：下一步 · Next（`next`，执行 · exec）
- 输入 · In：框架 · Frame（`element`，element:nl.frame）
- 输入 · In：已启用 · Enabled（`enabled`，boolean）

### 设置框架页面 · Set Frame Page

`blueprint.element.frame.setTargetPage` · 会等待，完成后才继续 · Latent: waits before continuing

- 可放在 · Allowed in: 应用逻辑 · App logic、页面逻辑 · Page logic、控件逻辑 · Widget logic、组件内的控件逻辑 · Widget logic inside a component
- 输入 · In：进入 · In（`in`，执行 · exec）
- 输出 · Out：下一步 · Next（`next`，执行 · exec）
- 输入 · In：框架 · Frame（`element`，element:nl.frame）
- 输入 · In：页面属性 · Page props（`props`，json；可不连 · optional）
- 设置 · Setting：页面 · Page（`targetSurfaceId`）

### 设置框架参数 · Set Frame Params

`blueprint.element.frame.setParams` · 会等待，完成后才继续 · Latent: waits before continuing

- 可放在 · Allowed in: 应用逻辑 · App logic、页面逻辑 · Page logic、控件逻辑 · Widget logic、组件内的控件逻辑 · Widget logic inside a component
- 输入 · In：进入 · In（`in`，执行 · exec）
- 输出 · Out：下一步 · Next（`next`，执行 · exec）
- 输入 · In：框架 · Frame（`element`，element:nl.frame）
- 输入 · In：参数 · Params（`params`，json）

### 设置框架可见性 · Set Frame Visible

`blueprint.element.frame.setVisible` · 会等待，完成后才继续 · Latent: waits before continuing

- 可放在 · Allowed in: 应用逻辑 · App logic、页面逻辑 · Page logic、控件逻辑 · Widget logic、组件内的控件逻辑 · Widget logic inside a component
- 输入 · In：进入 · In（`in`，执行 · exec）
- 输出 · Out：下一步 · Next（`next`，执行 · exec）
- 输入 · In：框架 · Frame（`element`，element:nl.frame）
- 输入 · In：可见 · Visible（`visible`，boolean）

### 设置图片资产 · Set Image Asset

`blueprint.element.image.setImageAsset` · 会等待，完成后才继续 · Latent: waits before continuing

- 可放在 · Allowed in: 应用逻辑 · App logic、页面逻辑 · Page logic、控件逻辑 · Widget logic、组件内的控件逻辑 · Widget logic inside a component
- 输入 · In：进入 · In（`in`，执行 · exec）
- 输出 · Out：下一步 · Next（`next`，执行 · exec）
- 输入 · In：图片 · Image（`element`，element:nl.image）
- 输入 · In：资产 · Asset（`asset`，ImageAsset|null；可直接填值 · accepts a typed value）

### 设置图片裁剪矩形 · Set Image Crop Rect

`blueprint.element.image.setCropRect` · 会等待，完成后才继续 · Latent: waits before continuing

- 可放在 · Allowed in: 应用逻辑 · App logic、页面逻辑 · Page logic、控件逻辑 · Widget logic、组件内的控件逻辑 · Widget logic inside a component
- 输入 · In：进入 · In（`in`，执行 · exec）
- 输出 · Out：下一步 · Next（`next`，执行 · exec）
- 输入 · In：图片 · Image（`element`，element:nl.image）
- 输入 · In：左边距 % · Left %（`leftPct`，float；可直接填值 · accepts a typed value）
- 输入 · In：上边距 % · Top %（`topPct`，float；可直接填值 · accepts a typed value）
- 输入 · In：宽度 % · Width %（`widthPct`，float；可直接填值 · accepts a typed value）
- 输入 · In：高度 % · Height %（`heightPct`，float；可直接填值 · accepts a typed value）

### 设置图片启用状态 · Set Image Enabled

`blueprint.element.image.setEnabled` · 会等待，完成后才继续 · Latent: waits before continuing

- 可放在 · Allowed in: 应用逻辑 · App logic、页面逻辑 · Page logic、控件逻辑 · Widget logic、组件内的控件逻辑 · Widget logic inside a component
- 输入 · In：进入 · In（`in`，执行 · exec）
- 输出 · Out：下一步 · Next（`next`，执行 · exec）
- 输入 · In：图片 · Image（`element`，element:nl.image）
- 输入 · In：已启用 · Enabled（`enabled`，boolean）

### 设置图片适配模式 · Set Image Fit Mode

`blueprint.element.image.setFitMode` · 会等待，完成后才继续 · Latent: waits before continuing

- 可放在 · Allowed in: 应用逻辑 · App logic、页面逻辑 · Page logic、控件逻辑 · Widget logic、组件内的控件逻辑 · Widget logic inside a component
- 输入 · In：进入 · In（`in`，执行 · exec）
- 输出 · Out：下一步 · Next（`next`，执行 · exec）
- 输入 · In：图片 · Image（`element`，element:nl.image）
- 输入 · In：适配模式 · Fit Mode（`fitMode`，string；可直接填值 · accepts a typed value）

### 设置图片水平翻转 · Set Image Flip X

`blueprint.element.image.setFlipX` · 会等待，完成后才继续 · Latent: waits before continuing

- 可放在 · Allowed in: 应用逻辑 · App logic、页面逻辑 · Page logic、控件逻辑 · Widget logic、组件内的控件逻辑 · Widget logic inside a component
- 输入 · In：进入 · In（`in`，执行 · exec）
- 输出 · Out：下一步 · Next（`next`，执行 · exec）
- 输入 · In：图片 · Image（`element`，element:nl.image）
- 输入 · In：水平翻转 · Flip X（`flipX`，boolean）

### 设置图片垂直翻转 · Set Image Flip Y

`blueprint.element.image.setFlipY` · 会等待，完成后才继续 · Latent: waits before continuing

- 可放在 · Allowed in: 应用逻辑 · App logic、页面逻辑 · Page logic、控件逻辑 · Widget logic、组件内的控件逻辑 · Widget logic inside a component
- 输入 · In：进入 · In（`in`，执行 · exec）
- 输出 · Out：下一步 · Next（`next`，执行 · exec）
- 输入 · In：图片 · Image（`element`，element:nl.image）
- 输入 · In：垂直翻转 · Flip Y（`flipY`，boolean）

### 设置图片可见性 · Set Image Visible

`blueprint.element.image.setVisible` · 会等待，完成后才继续 · Latent: waits before continuing

- 可放在 · Allowed in: 应用逻辑 · App logic、页面逻辑 · Page logic、控件逻辑 · Widget logic、组件内的控件逻辑 · Widget logic inside a component
- 输入 · In：进入 · In（`in`，执行 · exec）
- 输出 · Out：下一步 · Next（`next`，执行 · exec）
- 输入 · In：图片 · Image（`element`，element:nl.image）
- 输入 · In：可见 · Visible（`visible`，boolean）

### 设置条目字段 · Set Item Field At

`blueprint.element.list.setItemFieldAt` · 会等待，完成后才继续 · Latent: waits before continuing

- 可放在 · Allowed in: 应用逻辑 · App logic、页面逻辑 · Page logic、控件逻辑 · Widget logic、组件内的控件逻辑 · Widget logic inside a component
- 输入 · In：进入 · In（`in`，执行 · exec）
- 输出 · Out：下一步 · Next（`next`，执行 · exec）
- 输入 · In：列表 · List（`list`，element:nl.list）
- 输入 · In：索引 · Index（`index`，integer；可直接填值 · accepts a typed value）
- 输入 · In：值 · Value（`value`，any）
- 设置 · Setting：字段 · Field（`field`）

### 设置行高 · Set Line Height

`blueprint.element.text.setLineHeight` · 会等待，完成后才继续 · Latent: waits before continuing

- 可放在 · Allowed in: 应用逻辑 · App logic、页面逻辑 · Page logic、控件逻辑 · Widget logic、组件内的控件逻辑 · Widget logic inside a component
- 输入 · In：进入 · In（`in`，执行 · exec）
- 输出 · Out：下一步 · Next（`next`，执行 · exec）
- 输入 · In：元素 · Element（`element`，element:nl.text）
- 输入 · In：行高 · Line Height（`lineHeight`，float；可直接填值 · accepts a typed value）

### 设置列表内容 · Set List Content

`blueprint.element.list.setItems` · 会等待，完成后才继续 · Latent: waits before continuing

- 可放在 · Allowed in: 应用逻辑 · App logic、页面逻辑 · Page logic、控件逻辑 · Widget logic、组件内的控件逻辑 · Widget logic inside a component
- 输入 · In：进入 · In（`in`，执行 · exec）
- 输出 · Out：下一步 · Next（`next`，执行 · exec）
- 输入 · In：列表 · List（`list`，element:nl.list）
- 输入 · In：项列表 · Items（`items`，array）

### 设置列表启用状态 · Set List Enabled

`blueprint.element.list.setEnabled` · 会等待，完成后才继续 · Latent: waits before continuing

- 可放在 · Allowed in: 应用逻辑 · App logic、页面逻辑 · Page logic、控件逻辑 · Widget logic、组件内的控件逻辑 · Widget logic inside a component
- 输入 · In：进入 · In（`in`，执行 · exec）
- 输出 · Out：下一步 · Next（`next`，执行 · exec）
- 输入 · In：列表 · List（`element`，element:nl.list）
- 输入 · In：已启用 · Enabled（`enabled`，boolean）

### 设置列表可见性 · Set List Visible

`blueprint.element.list.setVisible` · 会等待，完成后才继续 · Latent: waits before continuing

- 可放在 · Allowed in: 应用逻辑 · App logic、页面逻辑 · Page logic、控件逻辑 · Widget logic、组件内的控件逻辑 · Widget logic inside a component
- 输入 · In：进入 · In（`in`，执行 · exec）
- 输出 · Out：下一步 · Next（`next`，执行 · exec）
- 输入 · In：列表 · List（`element`，element:nl.list）
- 输入 · In：可见 · Visible（`visible`，boolean）

### 设置选中索引 · Set Selected Index

`blueprint.element.list.setSelectedIndex` · 会等待，完成后才继续 · Latent: waits before continuing

- 可放在 · Allowed in: 应用逻辑 · App logic、页面逻辑 · Page logic、控件逻辑 · Widget logic、组件内的控件逻辑 · Widget logic inside a component
- 输入 · In：进入 · In（`in`，执行 · exec）
- 输出 · Out：下一步 · Next（`next`，执行 · exec）
- 输入 · In：列表 · List（`list`，element:nl.list）
- 输入 · In：索引 · Index（`index`，integer；可直接填值 · accepts a typed value）

### 设置选中项 · Set Selected Item

`blueprint.element.list.setSelectedItem` · 会等待，完成后才继续 · Latent: waits before continuing

- 可放在 · Allowed in: 应用逻辑 · App logic、页面逻辑 · Page logic、控件逻辑 · Widget logic、组件内的控件逻辑 · Widget logic inside a component
- 输入 · In：进入 · In（`in`，执行 · exec）
- 输出 · Out：下一步 · Next（`next`，执行 · exec）
- 输入 · In：列表 · List（`list`，element:nl.list）
- 输入 · In：项 · Item（`item`，any）

### 设置滑块启用状态 · Set Slider Enabled

`blueprint.element.slider.setEnabled` · 会等待，完成后才继续 · Latent: waits before continuing

- 可放在 · Allowed in: 应用逻辑 · App logic、页面逻辑 · Page logic、控件逻辑 · Widget logic、组件内的控件逻辑 · Widget logic inside a component
- 输入 · In：进入 · In（`in`，执行 · exec）
- 输出 · Out：下一步 · Next（`next`，执行 · exec）
- 输入 · In：滑块 · Slider（`element`，element:nl.slider）
- 输入 · In：已启用 · Enabled（`enabled`，boolean）

### 设置滑块范围 · Set Slider Range

`blueprint.element.slider.setRange` · 会等待，完成后才继续 · Latent: waits before continuing

- 可放在 · Allowed in: 应用逻辑 · App logic、页面逻辑 · Page logic、控件逻辑 · Widget logic、组件内的控件逻辑 · Widget logic inside a component
- 输入 · In：进入 · In（`in`，执行 · exec）
- 输出 · Out：下一步 · Next（`next`，执行 · exec）
- 输入 · In：滑块 · Slider（`slider`，element:nl.slider）
- 输入 · In：最小值 · Min（`min`，float；可直接填值 · accepts a typed value）
- 输入 · In：最大值 · Max（`max`，float；可直接填值 · accepts a typed value）
- 输入 · In：步长 · Step（`step`，float；可直接填值 · accepts a typed value）

### 设置滑块值 · Set Slider Value

`blueprint.element.slider.setValue` · 会等待，完成后才继续 · Latent: waits before continuing

- 可放在 · Allowed in: 应用逻辑 · App logic、页面逻辑 · Page logic、控件逻辑 · Widget logic、组件内的控件逻辑 · Widget logic inside a component
- 输入 · In：进入 · In（`in`，执行 · exec）
- 输出 · Out：下一步 · Next（`next`，执行 · exec）
- 输入 · In：滑块 · Slider（`slider`，element:nl.slider）
- 输入 · In：值 · Value（`value`，float；可直接填值 · accepts a typed value）

### 设置滑块可见性 · Set Slider Visible

`blueprint.element.slider.setVisible` · 会等待，完成后才继续 · Latent: waits before continuing

- 可放在 · Allowed in: 应用逻辑 · App logic、页面逻辑 · Page logic、控件逻辑 · Widget logic、组件内的控件逻辑 · Widget logic inside a component
- 输入 · In：进入 · In（`in`，执行 · exec）
- 输出 · Out：下一步 · Next（`next`，执行 · exec）
- 输入 · In：滑块 · Slider（`element`，element:nl.slider）
- 输入 · In：可见 · Visible（`visible`，boolean）

### 设置开关状态 · Set Switch Checked

`blueprint.element.switch.setChecked` · 会等待，完成后才继续 · Latent: waits before continuing

- 可放在 · Allowed in: 应用逻辑 · App logic、页面逻辑 · Page logic、控件逻辑 · Widget logic、组件内的控件逻辑 · Widget logic inside a component
- 输入 · In：进入 · In（`in`，执行 · exec）
- 输出 · Out：下一步 · Next（`next`，执行 · exec）
- 输入 · In：开关 · Switch（`switch`，element:nl.switch）
- 输入 · In：开启 · Checked（`checked`，boolean；可直接填值 · accepts a typed value）

### 设置开关启用状态 · Set Switch Enabled

`blueprint.element.switch.setEnabled` · 会等待，完成后才继续 · Latent: waits before continuing

- 可放在 · Allowed in: 应用逻辑 · App logic、页面逻辑 · Page logic、控件逻辑 · Widget logic、组件内的控件逻辑 · Widget logic inside a component
- 输入 · In：进入 · In（`in`，执行 · exec）
- 输出 · Out：下一步 · Next（`next`，执行 · exec）
- 输入 · In：开关 · Switch（`element`，element:nl.switch）
- 输入 · In：已启用 · Enabled（`enabled`，boolean）

### 设置开关可见性 · Set Switch Visible

`blueprint.element.switch.setVisible` · 会等待，完成后才继续 · Latent: waits before continuing

- 可放在 · Allowed in: 应用逻辑 · App logic、页面逻辑 · Page logic、控件逻辑 · Widget logic、组件内的控件逻辑 · Widget logic inside a component
- 输入 · In：进入 · In（`in`，执行 · exec）
- 输出 · Out：下一步 · Next（`next`，执行 · exec）
- 输入 · In：开关 · Switch（`element`，element:nl.switch）
- 输入 · In：可见 · Visible（`visible`，boolean）

### 设置文本 · Set Text

`blueprint.element.text.setText` · 会等待，完成后才继续 · Latent: waits before continuing

- 可放在 · Allowed in: 应用逻辑 · App logic、页面逻辑 · Page logic、控件逻辑 · Widget logic、组件内的控件逻辑 · Widget logic inside a component
- 输入 · In：进入 · In（`in`，执行 · exec）
- 输出 · Out：下一步 · Next（`next`，执行 · exec）
- 输入 · In：元素 · Element（`element`，element:nl.text）
- 输入 · In：文本 · Text（`text`，string；可直接填值 · accepts a typed value）

### 设置文本 · Set Text

`blueprint.element.textInput.setValue` · 会等待，完成后才继续 · Latent: waits before continuing

- 可放在 · Allowed in: 应用逻辑 · App logic、页面逻辑 · Page logic、控件逻辑 · Widget logic、组件内的控件逻辑 · Widget logic inside a component
- 输入 · In：进入 · In（`in`，执行 · exec）
- 输出 · Out：下一步 · Next（`next`，执行 · exec）
- 输入 · In：文本输入框 · Text Input（`textInput`，element:nl.textInput）
- 输入 · In：值 · Value（`value`，string；可直接填值 · accepts a typed value）

### 设置文本对齐 · Set Text Align

`blueprint.element.text.setTextAlign` · 会等待，完成后才继续 · Latent: waits before continuing

- 可放在 · Allowed in: 应用逻辑 · App logic、页面逻辑 · Page logic、控件逻辑 · Widget logic、组件内的控件逻辑 · Widget logic inside a component
- 输入 · In：进入 · In（`in`，执行 · exec）
- 输出 · Out：下一步 · Next（`next`，执行 · exec）
- 输入 · In：元素 · Element（`element`，element:nl.text）
- 输入 · In：文本对齐 · Text Align（`textAlign`，string；可直接填值 · accepts a typed value）

### 设置文本颜色 · Set Text Color

`blueprint.element.text.setTextColor` · 会等待，完成后才继续 · Latent: waits before continuing

- 可放在 · Allowed in: 应用逻辑 · App logic、页面逻辑 · Page logic、控件逻辑 · Widget logic、组件内的控件逻辑 · Widget logic inside a component
- 输入 · In：进入 · In（`in`，执行 · exec）
- 输出 · Out：下一步 · Next（`next`，执行 · exec）
- 输入 · In：元素 · Element（`element`，element:nl.text）
- 输入 · In：颜色 · Color（`color`，RGBAColor）

### 设置文本启用状态 · Set Text Enabled

`blueprint.element.text.setEnabled` · 会等待，完成后才继续 · Latent: waits before continuing

- 可放在 · Allowed in: 应用逻辑 · App logic、页面逻辑 · Page logic、控件逻辑 · Widget logic、组件内的控件逻辑 · Widget logic inside a component
- 输入 · In：进入 · In（`in`，执行 · exec）
- 输出 · Out：下一步 · Next（`next`，执行 · exec）
- 输入 · In：文本 · Text（`element`，element:nl.text）
- 输入 · In：已启用 · Enabled（`enabled`，boolean）

### 设置文本垂直对齐 · Set Text Vertical Align

`blueprint.element.text.setTextVerticalAlign` · 会等待，完成后才继续 · Latent: waits before continuing

- 可放在 · Allowed in: 应用逻辑 · App logic、页面逻辑 · Page logic、控件逻辑 · Widget logic、组件内的控件逻辑 · Widget logic inside a component
- 输入 · In：进入 · In（`in`，执行 · exec）
- 输出 · Out：下一步 · Next（`next`，执行 · exec）
- 输入 · In：元素 · Element（`element`，element:nl.text）
- 输入 · In：垂直对齐 · Vertical Align（`textVerticalAlign`，string；可直接填值 · accepts a typed value）

### 设置文本可见性 · Set Text Visible

`blueprint.element.text.setVisible` · 会等待，完成后才继续 · Latent: waits before continuing

- 可放在 · Allowed in: 应用逻辑 · App logic、页面逻辑 · Page logic、控件逻辑 · Widget logic、组件内的控件逻辑 · Widget logic inside a component
- 输入 · In：进入 · In（`in`，执行 · exec）
- 输出 · Out：下一步 · Next（`next`，执行 · exec）
- 输入 · In：文本 · Text（`element`，element:nl.text）
- 输入 · In：可见 · Visible（`visible`，boolean）

### 设置视频循环 · Set Video Loop

`blueprint.element.video.setLoop` · 会等待，完成后才继续 · Latent: waits before continuing

开启或关闭「循环」。开启时视频播到结尾后从头继续，「播放结束」不运行

Turns Loop on or off. While Loop is on, the clip starts over at its end and Playback Ended does not run.

- 可放在 · Allowed in: 应用逻辑 · App logic、页面逻辑 · Page logic、控件逻辑 · Widget logic、组件内的控件逻辑 · Widget logic inside a component
- 输入 · In：进入 · In（`in`，执行 · exec）
- 输出 · Out：下一步 · Next（`next`，执行 · exec）
- 输入 · In：视频 · Video（`video`，element:nl.video）
- 输入 · In：循环 · Loop（`loop`，boolean；可直接填值 · accepts a typed value）

### 设置视频静音 · Set Video Muted

`blueprint.element.video.setMuted` · 会等待，完成后才继续 · Latent: waits before continuing

将视频设为静音或取消静音。静音时不输出声音，不受音量影响

Mutes or unmutes the video. A muted video plays silently at any volume.

- 可放在 · Allowed in: 应用逻辑 · App logic、页面逻辑 · Page logic、控件逻辑 · Widget logic、组件内的控件逻辑 · Widget logic inside a component
- 输入 · In：进入 · In（`in`，执行 · exec）
- 输出 · Out：下一步 · Next（`next`，执行 · exec）
- 输入 · In：视频 · Video（`video`，element:nl.video）
- 输入 · In：静音 · Muted（`muted`，boolean；可直接填值 · accepts a typed value）

### 设置视频速度 · Set Video Speed

`blueprint.element.video.setPlaybackRate` · 会等待，完成后才继续 · Latent: waits before continuing

设置视频的播放速度：1 为正常速度，2 为两倍速，0.5 为半速。范围为 0.0625 到 16

Sets how fast the video plays: 1 is normal speed, 2 twice as fast, 0.5 half as fast. Kept between 0.0625 and 16.

- 可放在 · Allowed in: 应用逻辑 · App logic、页面逻辑 · Page logic、控件逻辑 · Widget logic、组件内的控件逻辑 · Widget logic inside a component
- 输入 · In：进入 · In（`in`，执行 · exec）
- 输出 · Out：下一步 · Next（`next`，执行 · exec）
- 输入 · In：视频 · Video（`video`，element:nl.video）
- 输入 · In：速度 · Speed（`speed`，float；可直接填值 · accepts a typed value）

### 设置视频音量 · Set Video Volume

`blueprint.element.video.setVolume` · 会等待，完成后才继续 · Latent: waits before continuing

设置视频的音量（0 到 1），代替控件上设置的音量。玩家的音量设置与音轨仍在此基础上生效

Sets the video's volume, from 0 to 1, in place of the volume set on the widget. The player's volume settings and the audio track still apply on top.

- 可放在 · Allowed in: 应用逻辑 · App logic、页面逻辑 · Page logic、控件逻辑 · Widget logic、组件内的控件逻辑 · Widget logic inside a component
- 输入 · In：进入 · In（`in`，执行 · exec）
- 输出 · Out：下一步 · Next（`next`，执行 · exec）
- 输入 · In：视频 · Video（`video`，element:nl.video）
- 输入 · In：音量 · Volume（`volume`，float；可直接填值 · accepts a typed value）

### 设置换行模式 · Set Wrap Mode

`blueprint.element.text.setWrapMode` · 会等待，完成后才继续 · Latent: waits before continuing

- 可放在 · Allowed in: 应用逻辑 · App logic、页面逻辑 · Page logic、控件逻辑 · Widget logic、组件内的控件逻辑 · Widget logic inside a component
- 输入 · In：进入 · In（`in`，执行 · exec）
- 输出 · Out：下一步 · Next（`next`，执行 · exec）
- 输入 · In：元素 · Element（`element`，element:nl.text）
- 输入 · In：换行模式 · Wrap Mode（`textWrapMode`，string；可直接填值 · accepts a typed value）

### 按字段排序列表 · Sort List By Field

`blueprint.element.list.sortByField` · 会等待，完成后才继续 · Latent: waits before continuing

- 可放在 · Allowed in: 应用逻辑 · App logic、页面逻辑 · Page logic、控件逻辑 · Widget logic、组件内的控件逻辑 · Widget logic inside a component
- 输入 · In：进入 · In（`in`，执行 · exec）
- 输出 · Out：下一步 · Next（`next`，执行 · exec）
- 输入 · In：列表 · List（`list`，element:nl.list）
- 设置 · Setting：字段 · Field（`field`）
- 设置 · Setting：顺序 · Direction（`direction`：升序 · Ascending / 降序 · Descending）

### 停止元素动画 · Stop Element Animation

`blueprint.element.displayable.stopAnimation` · 会等待，完成后才继续 · Latent: waits before continuing

- 可放在 · Allowed in: 应用逻辑 · App logic、页面逻辑 · Page logic、控件逻辑 · Widget logic、组件内的控件逻辑 · Widget logic inside a component
- 输入 · In：进入 · In（`in`，执行 · exec）
- 输出 · Out：下一步 · Next（`next`，执行 · exec）
- 输入 · In：动画 · Animation（`animation`，AnimationToken）

### 停止视频 · Stop Video

`blueprint.element.video.stop` · 会等待，完成后才继续 · Latent: waits before continuing

暂停视频并回到视频开头

Pauses the video and returns it to the start of the clip.

- 可放在 · Allowed in: 应用逻辑 · App logic、页面逻辑 · Page logic、控件逻辑 · Widget logic、组件内的控件逻辑 · Widget logic inside a component
- 输入 · In：进入 · In（`in`，执行 · exec）
- 输出 · Out：下一步 · Next（`next`，执行 · exec）
- 输入 · In：视频 · Video（`video`，element:nl.video）

### 切换开关 · Toggle Switch

`blueprint.element.switch.toggle` · 会等待，完成后才继续 · Latent: waits before continuing

- 可放在 · Allowed in: 应用逻辑 · App logic、页面逻辑 · Page logic、控件逻辑 · Widget logic、组件内的控件逻辑 · Widget logic inside a component
- 输入 · In：进入 · In（`in`，执行 · exec）
- 输出 · Out：下一步 · Next（`next`，执行 · exec）
- 输入 · In：开关 · Switch（`switch`，element:nl.switch）
- 输出 · Out：开启 · Checked（`checked`，boolean）

### 关闭开关 · Turn Switch Off

`blueprint.element.switch.turnOff` · 会等待，完成后才继续 · Latent: waits before continuing

- 可放在 · Allowed in: 应用逻辑 · App logic、页面逻辑 · Page logic、控件逻辑 · Widget logic、组件内的控件逻辑 · Widget logic inside a component
- 输入 · In：进入 · In（`in`，执行 · exec）
- 输出 · Out：下一步 · Next（`next`，执行 · exec）
- 输入 · In：开关 · Switch（`switch`，element:nl.switch）

### 打开开关 · Turn Switch On

`blueprint.element.switch.turnOn` · 会等待，完成后才继续 · Latent: waits before continuing

- 可放在 · Allowed in: 应用逻辑 · App logic、页面逻辑 · Page logic、控件逻辑 · Widget logic、组件内的控件逻辑 · Widget logic inside a component
- 输入 · In：进入 · In（`in`，执行 · exec）
- 输出 · Out：下一步 · Next（`next`，执行 · exec）
- 输入 · In：开关 · Switch（`switch`，element:nl.switch）
