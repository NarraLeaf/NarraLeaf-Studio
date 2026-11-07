# 蓝图节点：可显示对象 · Displayable

> 本文件由 NarraLeaf Studio 源码自动生成，请勿手动修改。
> Generated from the NarraLeaf Studio source. Do not edit by hand.

「可显示对象 · Displayable」分类下的 9 个节点。标题是节点面板里显示的名字（中文 · English）。

The 9 nodes in the "Displayable" palette category, titled as the node palette shows them.

### 动画属性 · Animate Property

`blueprint.displayable.animateProperty` · 会等待，完成后才继续 · Latent: waits before continuing

- 只用于这些控件的蓝图 · Only on: 容器 · Container、文本 · Text、句子 · Sentence、通知列表 · Notification List、选项列表 · Choice List、NVL 列表 · NVL List、NVL 文本 · NVL Texts、图片 · Image、按钮 · Button、文本输入框 · Text Input、开关 · Switch、视频 · Video、Spine / Live2D 模型 · Spine / Live2D Model、滑块 · Slider、列表 · List、页面 · Page、操作提示栏 · Input Hints
- 可放在 · Allowed in: 控件逻辑 · Widget logic、组件内的控件逻辑 · Widget logic inside a component
- 输入 · In：进入 · In（`in`，执行 · exec）
- 输出 · Out：下一步 · Next（`next`，执行 · exec）
- 输出 · Out：动画 · Animation（`animation`，AnimationToken）
- 设置 · Setting：属性 · Property（`property`：不透明度 · Opacity / 偏移 X · Offset X / 偏移 Y · Offset Y / X / Y / 缩放 · Scale / 旋转 · Rotation）
- 设置 · Setting：起始 · From（`from`）
- 设置 · Setting：目标 · To（`to`）
- 设置 · Setting：时长（秒） · Duration (s)（`duration`）
- 设置 · Setting：延迟（秒） · Delay (s)（`delay`）
- 设置 · Setting：缓动 · Easing（`easing`：线性 · Linear / 缓入 · Ease In / 缓出 · Ease Out / 缓入缓出 · Ease In Out / 圆弧缓入 · Circ In / 圆弧缓出 · Circ Out / 圆弧缓入缓出 · Circ In Out）
- 设置 · Setting：结束后 · After（`after`：保持最终值 · Hold final value / 动画后重置 · Reset after animation）

### 获取中心 · Get Center

`blueprint.displayable.getCenter` · 纯数据节点，没有执行针脚 · Pure: no exec pins

- 只用于这些控件的蓝图 · Only on: 容器 · Container、文本 · Text、句子 · Sentence、通知列表 · Notification List、选项列表 · Choice List、NVL 列表 · NVL List、NVL 文本 · NVL Texts、图片 · Image、按钮 · Button、文本输入框 · Text Input、开关 · Switch、视频 · Video、Spine / Live2D 模型 · Spine / Live2D Model、滑块 · Slider、列表 · List、页面 · Page、操作提示栏 · Input Hints
- 可放在 · Allowed in: 控件逻辑 · Widget logic、组件内的控件逻辑 · Widget logic inside a component
- 输出 · Out：中心 · Center（`center`，Vector2D）

### 获取显示状态 · Get Display

`blueprint.displayable.getDisplay` · 纯数据节点，没有执行针脚 · Pure: no exec pins

- 只用于这些控件的蓝图 · Only on: 容器 · Container、文本 · Text、句子 · Sentence、通知列表 · Notification List、选项列表 · Choice List、NVL 列表 · NVL List、NVL 文本 · NVL Texts、图片 · Image、按钮 · Button、文本输入框 · Text Input、开关 · Switch、视频 · Video、Spine / Live2D 模型 · Spine / Live2D Model、滑块 · Slider、列表 · List、页面 · Page、操作提示栏 · Input Hints
- 可放在 · Allowed in: 控件逻辑 · Widget logic、组件内的控件逻辑 · Widget logic inside a component
- 输出 · Out：显示状态 · Display（`display`，boolean）

### 获取实测矩形 · Get Measured Rect

`blueprint.displayable.getMeasuredRect` · 纯数据节点，没有执行针脚 · Pure: no exec pins

- 只用于这些控件的蓝图 · Only on: 容器 · Container、文本 · Text、句子 · Sentence、通知列表 · Notification List、选项列表 · Choice List、NVL 列表 · NVL List、NVL 文本 · NVL Texts、图片 · Image、按钮 · Button、文本输入框 · Text Input、开关 · Switch、视频 · Video、Spine / Live2D 模型 · Spine / Live2D Model、滑块 · Slider、列表 · List、页面 · Page、操作提示栏 · Input Hints
- 可放在 · Allowed in: 控件逻辑 · Widget logic、组件内的控件逻辑 · Widget logic inside a component
- 输出 · Out：矩形 · Rect（`rect`，Rect）

### 获取属性 · Get Property

`blueprint.displayable.getProperty` · 纯数据节点，没有执行针脚 · Pure: no exec pins

- 只用于这些控件的蓝图 · Only on: 容器 · Container、文本 · Text、句子 · Sentence、通知列表 · Notification List、选项列表 · Choice List、NVL 列表 · NVL List、NVL 文本 · NVL Texts、图片 · Image、按钮 · Button、文本输入框 · Text Input、开关 · Switch、视频 · Video、Spine / Live2D 模型 · Spine / Live2D Model、滑块 · Slider、列表 · List、页面 · Page、操作提示栏 · Input Hints
- 可放在 · Allowed in: 控件逻辑 · Widget logic、组件内的控件逻辑 · Widget logic inside a component
- 输出 · Out：值 · Value（`value`，any）
- 设置 · Setting：属性 · Property（`property`：位置 · Position / 尺寸 · Size / 边界 · Bounds / X / Y / 偏移 X · Offset X / 偏移 Y · Offset Y / 宽度 · Width / 高度 · Height / 旋转 · Rotation / 不透明度 · Opacity / 可见 · Visible）

### 设置显示状态 · Set Display

`blueprint.displayable.setDisplay` · 会等待，完成后才继续 · Latent: waits before continuing

- 只用于这些控件的蓝图 · Only on: 容器 · Container、文本 · Text、句子 · Sentence、通知列表 · Notification List、选项列表 · Choice List、NVL 列表 · NVL List、NVL 文本 · NVL Texts、图片 · Image、按钮 · Button、文本输入框 · Text Input、开关 · Switch、视频 · Video、Spine / Live2D 模型 · Spine / Live2D Model、滑块 · Slider、列表 · List、页面 · Page、操作提示栏 · Input Hints
- 可放在 · Allowed in: 控件逻辑 · Widget logic、组件内的控件逻辑 · Widget logic inside a component
- 输入 · In：进入 · In（`in`，执行 · exec）
- 输出 · Out：下一步 · Next（`next`，执行 · exec）
- 输入 · In：显示状态 · Display（`display`，boolean）

### 设置属性 · Set Property

`blueprint.displayable.setProperty` · 会等待，完成后才继续 · Latent: waits before continuing

- 只用于这些控件的蓝图 · Only on: 容器 · Container、文本 · Text、句子 · Sentence、通知列表 · Notification List、选项列表 · Choice List、NVL 列表 · NVL List、NVL 文本 · NVL Texts、图片 · Image、按钮 · Button、文本输入框 · Text Input、开关 · Switch、视频 · Video、Spine / Live2D 模型 · Spine / Live2D Model、滑块 · Slider、列表 · List、页面 · Page、操作提示栏 · Input Hints
- 可放在 · Allowed in: 控件逻辑 · Widget logic、组件内的控件逻辑 · Widget logic inside a component
- 输入 · In：进入 · In（`in`，执行 · exec）
- 输出 · Out：下一步 · Next（`next`，执行 · exec）
- 输入 · In：值 · Value（`value`，any）
- 设置 · Setting：属性 · Property（`property`：X / Y / 偏移 X · Offset X / 偏移 Y · Offset Y / 宽度 · Width / 高度 · Height / 旋转 · Rotation / 不透明度 · Opacity / 可见 · Visible）
- 设置 · Setting：值 · Value（`value`）

### 设置变体 · Set Variant

`blueprint.displayable.setVariant` · 会等待，完成后才继续 · Latent: waits before continuing

- 只用于这些控件的蓝图 · Only on: 容器 · Container、文本 · Text、图片 · Image、按钮 · Button
- 可放在 · Allowed in: 控件逻辑 · Widget logic、组件内的控件逻辑 · Widget logic inside a component
- 输入 · In：进入 · In（`in`，执行 · exec）
- 输出 · Out：下一步 · Next（`next`，执行 · exec）

### 停止动画 · Stop Animation

`blueprint.displayable.stopAnimation` · 会等待，完成后才继续 · Latent: waits before continuing

- 只用于这些控件的蓝图 · Only on: 容器 · Container、文本 · Text、句子 · Sentence、通知列表 · Notification List、选项列表 · Choice List、NVL 列表 · NVL List、NVL 文本 · NVL Texts、图片 · Image、按钮 · Button、文本输入框 · Text Input、开关 · Switch、视频 · Video、Spine / Live2D 模型 · Spine / Live2D Model、滑块 · Slider、列表 · List、页面 · Page、操作提示栏 · Input Hints
- 可放在 · Allowed in: 控件逻辑 · Widget logic、组件内的控件逻辑 · Widget logic inside a component
- 输入 · In：进入 · In（`in`，执行 · exec）
- 输出 · Out：下一步 · Next（`next`，执行 · exec）
- 输入 · In：动画 · Animation（`animation`，AnimationToken）
