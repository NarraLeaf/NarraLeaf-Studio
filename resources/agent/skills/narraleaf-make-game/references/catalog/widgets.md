# 界面控件与属性面板 · Widgets and their properties

> 本文件由 NarraLeaf Studio 源码自动生成，请勿手动修改。
> Generated from the NarraLeaf Studio source. Do not edit by hand.

界面编辑器里可以插入的每种控件：属性面板里有哪些标签页和字段（含字段下方的提示），控件自己的蓝图能用哪些事件开头，以及只对它生效的节点。
节点后面括号里是它在 `blueprint-nodes/` 下所在的文件名。

Every widget the interface editor can insert: the tabs and fields of its properties panel, the events its own blueprint can start from, and the nodes that only work on it. The word in brackets after a node is its file under `blueprint-nodes/`.

## 容器 · Container

元素类型 · Element type：`nl.container`

### 属性面板 · Properties：属性 · Properties

- **子级布局 · Child layout**
  - 模式 · Mode（选项 · options：自由（绝对定位子级） / 堆叠（弹性） / 滚动 · Free (absolute children) / Stack (flex) / Scroll）
  - 滚动轴 · Scroll axis（选项 · options：垂直 / 水平 · Vertical / Horizontal）
  - 方向 · Direction（选项 · options：垂直堆叠 / 水平堆叠 · Vertical stack / Horizontal stack）
  - 换行 · Wrap
  - 对齐（交叉轴） · Align (cross axis)（选项 · options：起始 / 居中 / 末端 · Start / Center / End）
  - 对齐（主轴） · Justify (main axis)（选项 · options：起始 / 居中 / 末端 / 两端对齐 / 环绕对齐 · Start / Center / End / Space between / Space around）
  - 溢出 · Overflow（选项 · options：隐藏 / 可见 · Hidden / Visible）
- **外观 · Appearance**

### 属性面板 · Properties：交互 · Interaction

- 控件逻辑 · Widget logic

### 控件蓝图的事件 · Events on its blueprint

- 界面进入后 · After Surface Enter（events）
- 界面退出前 · Before Surface Exit（events）
- 失焦 · Blur（events）
- 聚焦 · Focus（events）
- 初始化 · Init（events）
- 列表项刷新 · List Item Refresh（events）
- 鼠标点击 · Mouse Click（events）
- 鼠标双击 · Mouse Double Click（events）
- 鼠标按下 · Mouse Down（events）
- 鼠标进入 · Mouse Enter（events）
- 鼠标离开 · Mouse Leave（events）
- 鼠标移动 · Mouse Move（events）
- 鼠标抬起 · Mouse Up（events）
- 鼠标滚轮 · Mouse Wheel（events）
- 刷新时 · On Flush（events）
- 右键点击 · Right Click（events）
- 卸载 · Unmount（events）

### 只对它生效的节点 · Nodes only for this widget

- 动画属性 · Animate Property（displayable）
- 获取中心 · Get Center（displayable）
- 获取内容裁剪 · Get Clip Content（container）
- 获取显示状态 · Get Display（displayable）
- 获取启用状态 · Get Enabled（container）
- 获取实测矩形 · Get Measured Rect（displayable）
- 获取属性 · Get Property（displayable）
- 获取可见性 · Get Visible（container）
- 设置内容裁剪 · Set Clip Content（container）
- 设置显示状态 · Set Display（displayable）
- 设置启用状态 · Set Enabled（container）
- 设置属性 · Set Property（displayable）
- 设置变体 · Set Variant（displayable）
- 设置可见性 · Set Visible（container）
- 停止动画 · Stop Animation（displayable）

## 文本 · Text

元素类型 · Element type：`nl.text`

### 属性面板 · Properties：属性 · Properties

- **内容 · Content**
  - 文本 · Text
- **排版 · Typography**
  - 字体 · Font
  - 字重 · Weight（选项 · options：常规 / 半粗 / 粗体 · Regular / Semibold / Bold）
  - 换行 · Line wrap（选项 · options：按词 / 按字符 / 不换行 · Words / Characters / No wrap）
  - 自动缩小 · Auto fit：文本超出控件尺寸时缩小字号，下限为最小字号；仍然超出的部分被裁切 · Reduces the font size when the text exceeds the widget's size, down to Smallest size. Text that still exceeds it is clipped.
  - 最小字号 · Smallest size
  - 对齐 · Alignment（选项 · options：左对齐 / 水平居中 / 右对齐 · Align left / Align center / Align right）
  - 垂直对齐 · Vertical alignment（选项 · options：顶端对齐 / 垂直居中 / 底端对齐 · Align top / Align middle / Align bottom）
  - 书写方向 · Writing mode（选项 · options：横排 / 竖排，列从右向左 / 竖排，列从左向右 · Horizontal / Vertical, columns right to left / Vertical, columns left to right）
  - 字形方向 · Glyph orientation（选项 · options：汉字直立，拉丁横倒 / 全部直立 / 全部横倒 · Upright, Latin sideways / All upright / All sideways）
  - 短串直立（縦中横） · Set short runs upright：数字与短拉丁串横向排在一格内 · Numbers and short Latin runs read across the column
  - 直立组合的最大长度 · Longest run set upright
- **外观 · Appearance**

### 属性面板 · Properties：交互 · Interaction

- 控件逻辑 · Widget logic

### 控件蓝图的事件 · Events on its blueprint

- 界面进入后 · After Surface Enter（events）
- 界面退出前 · Before Surface Exit（events）
- 失焦 · Blur（events）
- 聚焦 · Focus（events）
- 初始化 · Init（events）
- 列表项刷新 · List Item Refresh（events）
- 鼠标点击 · Mouse Click（events）
- 鼠标双击 · Mouse Double Click（events）
- 鼠标按下 · Mouse Down（events）
- 鼠标进入 · Mouse Enter（events）
- 鼠标离开 · Mouse Leave（events）
- 鼠标移动 · Mouse Move（events）
- 鼠标抬起 · Mouse Up（events）
- 鼠标滚轮 · Mouse Wheel（events）
- 刷新时 · On Flush（events）
- 右键点击 · Right Click（events）
- 卸载 · Unmount（events）

### 只对它生效的节点 · Nodes only for this widget

- 动画属性 · Animate Property（displayable）
- 追加文本 · Append Text（text）
- 清空文本 · Clear Text（text）
- 获取全部属性 · Get All Properties（text）
- 获取中心 · Get Center（displayable）
- 获取显示状态 · Get Display（displayable）
- 获取特效 · Get Effects（text）
- 获取启用状态 · Get Enabled（text）
- 获取字体 · Get Font（text）
- 获取字号 · Get Font Size（text）
- 获取字重 · Get Font Weight（text）
- 获取行高 · Get Line Height（text）
- 获取实测矩形 · Get Measured Rect（displayable）
- 获取属性 · Get Property（displayable）
- 获取文本 · Get Text（text）
- 获取文本对齐 · Get Text Align（text）
- 获取文本颜色 · Get Text Color（text）
- 获取文本垂直对齐 · Get Text Vertical Align（text）
- 获取可见性 · Get Visible（text）
- 获取换行模式 · Get Wrap Mode（text）
- 设置全部属性 · Set All Properties（text）
- 设置显示状态 · Set Display（displayable）
- 设置特效 · Set Effects（text）
- 设置启用状态 · Set Enabled（text）
- 设置字体 · Set Font（text）
- 设置字号 · Set Font Size（text）
- 设置字重 · Set Font Weight（text）
- 设置行高 · Set Line Height（text）
- 设置属性 · Set Property（displayable）
- 设置文本 · Set Text（text）
- 设置文本对齐 · Set Text Align（text）
- 设置文本颜色 · Set Text Color（text）
- 设置文本垂直对齐 · Set Text Vertical Align（text）
- 设置变体 · Set Variant（displayable）
- 设置可见性 · Set Visible（text）
- 设置换行模式 · Set Wrap Mode（text）
- 停止动画 · Stop Animation（displayable）

## 图片 · Image

元素类型 · Element type：`nl.image`

### 属性面板 · Properties：属性 · Properties

- **外观 · Appearance**

### 属性面板 · Properties：交互 · Interaction

- 控件逻辑 · Widget logic

### 控件蓝图的事件 · Events on its blueprint

- 界面进入后 · After Surface Enter（events）
- 界面退出前 · Before Surface Exit（events）
- 失焦 · Blur（events）
- 聚焦 · Focus（events）
- 初始化 · Init（events）
- 列表项刷新 · List Item Refresh（events）
- 鼠标点击 · Mouse Click（events）
- 鼠标双击 · Mouse Double Click（events）
- 鼠标按下 · Mouse Down（events）
- 鼠标进入 · Mouse Enter（events）
- 鼠标离开 · Mouse Leave（events）
- 鼠标移动 · Mouse Move（events）
- 鼠标抬起 · Mouse Up（events）
- 鼠标滚轮 · Mouse Wheel（events）
- 刷新时 · On Flush（events）
- 右键点击 · Right Click（events）
- 卸载 · Unmount（events）

### 只对它生效的节点 · Nodes only for this widget

- 动画属性 · Animate Property（displayable）
- 清除图片资产 · Clear Image Asset（image）
- 获取中心 · Get Center（displayable）
- 获取显示状态 · Get Display（displayable）
- 获取启用状态 · Get Enabled（image）
- 获取图片资产 · Get Image Asset（image）
- 获取图片裁剪矩形 · Get Image Crop Rect（image）
- 获取图片适配模式 · Get Image Fit Mode（image）
- 获取图片水平翻转 · Get Image Flip X（image）
- 获取图片垂直翻转 · Get Image Flip Y（image）
- 获取实测矩形 · Get Measured Rect（displayable）
- 获取属性 · Get Property（displayable）
- 获取可见性 · Get Visible（image）
- 设置显示状态 · Set Display（displayable）
- 设置启用状态 · Set Enabled（image）
- 设置图片资产 · Set Image Asset（image）
- 设置图片裁剪矩形 · Set Image Crop Rect（image）
- 设置图片适配模式 · Set Image Fit Mode（image）
- 设置图片水平翻转 · Set Image Flip X（image）
- 设置图片垂直翻转 · Set Image Flip Y（image）
- 设置属性 · Set Property（displayable）
- 设置变体 · Set Variant（displayable）
- 设置可见性 · Set Visible（image）
- 停止动画 · Stop Animation（displayable）

## 按钮 · Button

元素类型 · Element type：`nl.button`

### 属性面板 · Properties：属性 · Properties

- **文本 · Text**
  - **内容 · Content**
    - 文本 · Text
  - **排版 · Typography**
    - 字体 · Font
    - 字重 · Weight（选项 · options：常规 / 半粗 / 粗体 · Regular / Semibold / Bold）
    - 换行 · Line wrap（选项 · options：按词 / 按字符 / 不换行 · Words / Characters / No wrap）
    - 对齐 · Alignment（选项 · options：左对齐 / 水平居中 / 右对齐 · Align left / Align center / Align right）
    - 垂直对齐 · Vertical alignment（选项 · options：顶端对齐 / 垂直居中 / 底端对齐 · Align top / Align middle / Align bottom）
  - **颜色 · Color**
- **外观 · Appearance**
- **行为 · Behavior**
  - 禁用交互 · Interaction disabled

### 属性面板 · Properties：交互 · Interaction

- 控件逻辑 · Widget logic

### 控件蓝图的事件 · Events on its blueprint

- 界面进入后 · After Surface Enter（events）
- 界面退出前 · Before Surface Exit（events）
- 失焦 · Blur（events）
- 聚焦 · Focus（events）
- 初始化 · Init（events）
- 列表项刷新 · List Item Refresh（events）
- 鼠标点击 · Mouse Click（events）
- 鼠标双击 · Mouse Double Click（events）
- 鼠标按下 · Mouse Down（events）
- 鼠标进入 · Mouse Enter（events）
- 鼠标离开 · Mouse Leave（events）
- 鼠标移动 · Mouse Move（events）
- 鼠标抬起 · Mouse Up（events）
- 鼠标滚轮 · Mouse Wheel（events）
- 刷新时 · On Flush（events）
- 右键点击 · Right Click（events）
- 卸载 · Unmount（events）

### 只对它生效的节点 · Nodes only for this widget

- 动画属性 · Animate Property（displayable）
- 获取中心 · Get Center（displayable）
- 获取显示状态 · Get Display（displayable）
- 获取启用状态 · Get Enabled（button）
- 获取标签 · Get Label（button）
- 获取实测矩形 · Get Measured Rect（displayable）
- 获取属性 · Get Property（displayable）
- 获取可见性 · Get Visible（button）
- 设置显示状态 · Set Display（displayable）
- 设置启用状态 · Set Enabled（button）
- 设置标签 · Set Label（button）
- 设置指针 · Set Pointer（button）
- 设置属性 · Set Property（displayable）
- 设置变体 · Set Variant（displayable）
- 设置可见性 · Set Visible（button）
- 停止动画 · Stop Animation（displayable）

## 文本输入框 · Text Input

元素类型 · Element type：`nl.textInput`

### 属性面板 · Properties：属性 · Properties

- **内容 · Content**
  - 值 · Value：初始文本；玩家输入的内容由运行中的游戏保存，不会写回本文档 · Starting text. What the player types is held by the running game, not by this document.
  - 占位文本 · Placeholder
- **行为 · Behavior**
  - 输入模式 · Input mode（选项 · options：文本 / 密码 / 数字 · Text / Password / Number）
  - 最大长度 · Max length：0 表示不限制 · 0 means unlimited.
  - 只读 · Read only
  - 禁用 · Disabled
- **排版 · Typography**
  - 字体 · Font
  - 字重 · Weight（选项 · options：常规 / 半粗 / 粗体 · Regular / Semibold / Bold）
  - 对齐 · Alignment（选项 · options：左对齐 / 水平居中 / 右对齐 · Align left / Align center / Align right）
  - 颜色 · Color
- **外观 · Appearance**

### 属性面板 · Properties：交互 · Interaction

- 控件逻辑 · Widget logic

### 控件蓝图的事件 · Events on its blueprint

- 界面进入后 · After Surface Enter（events）
- 界面退出前 · Before Surface Exit（events）
- 失焦 · Blur（events）
- 聚焦 · Focus（events）
- 初始化 · Init（events）
- 刷新时 · On Flush（events）
- 提交 · Submit（events）
- 卸载 · Unmount（events）
- 值变更 · Value Changed（events）

### 只对它生效的节点 · Nodes only for this widget

- 动画属性 · Animate Property（displayable）
- 清空文本 · Clear Text（text-input）
- 获取中心 · Get Center（displayable）
- 获取显示状态 · Get Display（displayable）
- 获取实测矩形 · Get Measured Rect（displayable）
- 获取属性 · Get Property（displayable）
- 获取文本 · Get Text（text-input）
- 设置显示状态 · Set Display（displayable）
- 设置属性 · Set Property（displayable）
- 设置文本 · Set Text（text-input）
- 停止动画 · Stop Animation（displayable）

## 开关 · Switch

元素类型 · Element type：`nl.switch`

### 属性面板 · Properties：交互 · Interaction

- 控件逻辑 · Widget logic

### 控件蓝图的事件 · Events on its blueprint

- 界面进入后 · After Surface Enter（events）
- 界面退出前 · Before Surface Exit（events）
- 失焦 · Blur（events）
- 状态变更 · Changed（events）
- 聚焦 · Focus（events）
- 初始化 · Init（events）
- 鼠标点击 · Mouse Click（events）
- 鼠标双击 · Mouse Double Click（events）
- 鼠标按下 · Mouse Down（events）
- 鼠标进入 · Mouse Enter（events）
- 鼠标离开 · Mouse Leave（events）
- 鼠标移动 · Mouse Move（events）
- 鼠标抬起 · Mouse Up（events）
- 鼠标滚轮 · Mouse Wheel（events）
- 刷新时 · On Flush（events）
- 右键点击 · Right Click（events）
- 已关闭 · Turned Off（events）
- 已打开 · Turned On（events）
- 卸载 · Unmount（events）

### 只对它生效的节点 · Nodes only for this widget

- 动画属性 · Animate Property（displayable）
- 获取中心 · Get Center（displayable）
- 获取状态 · Get Checked（switch）
- 获取显示状态 · Get Display（displayable）
- 获取启用状态 · Get Enabled（switch）
- 获取实测矩形 · Get Measured Rect（displayable）
- 获取属性 · Get Property（displayable）
- 获取可见性 · Get Visible（switch）
- 设置状态 · Set Checked（switch）
- 设置显示状态 · Set Display（displayable）
- 设置启用状态 · Set Enabled（switch）
- 设置属性 · Set Property（displayable）
- 设置可见性 · Set Visible（switch）
- 停止动画 · Stop Animation（displayable）
- 切换 · Toggle（switch）
- 关闭 · Turn Off（switch）
- 打开 · Turn On（switch）

## 视频 · Video

元素类型 · Element type：`nl.video`

### 属性面板 · Properties：属性 · Properties

- **来源 · Source**
  - 填充 · Fit（选项 · options：包含 / 覆盖 / 拉伸 / 原始尺寸 · Contain / Cover / Stretch / Original size）：画面如何填满外框 · How the picture fills the box
- **播放 · Playback**
  - 自动播放 · Autoplay：仅在游戏中生效；编辑画布始终暂停，预览使用工具条 · Applies in the game. The editor canvas stays paused; use the toolbar to preview.
  - 循环 · Loop
  - 静音 · Muted
  - 音量 · Volume：0 到 1；运行时蓝图的音量引脚会覆盖此值 · 0 to 1. A blueprint volume pin overrides this at runtime.
  - 速度 · Speed
  - 原生控件 · Native controls：在画面上显示浏览器自带的播放条 · Shows the browser's own play bar over the clip.
  - 预加载 · Preload（选项 · options：不预加载 / 仅元数据 / 自动 · None / Metadata / Auto）：播放前预取的数据量；画布始终加载元数据，以便显示一帧画面 · How much to fetch before playback. The canvas always loads metadata so that it can show a frame.
- **外框 · Box**
  - 背景色 · Backdrop：视频比例填不满外框时露出的部分 · Seen wherever the clip's aspect does not fill the box.
  - 圆角半径 · Corner Radius
  - 边框 · Border
  - 边框样式 · Border Style

### 属性面板 · Properties：交互 · Interaction

- 控件逻辑 · Widget logic

### 控件蓝图的事件 · Events on its blueprint

- 界面进入后 · After Surface Enter（events）
- 界面退出前 · Before Surface Exit（events）
- 失焦 · Blur（events）
- 聚焦 · Focus（events）
- 初始化 · Init（events）
- 鼠标点击 · Mouse Click（events）
- 鼠标双击 · Mouse Double Click（events）
- 鼠标按下 · Mouse Down（events）
- 鼠标进入 · Mouse Enter（events）
- 鼠标离开 · Mouse Leave（events）
- 鼠标移动 · Mouse Move（events）
- 鼠标抬起 · Mouse Up（events）
- 鼠标滚轮 · Mouse Wheel（events）
- 刷新时 · On Flush（events）
- 播放结束 · Playback Ended（events）
- 右键点击 · Right Click（events）
- 卸载 · Unmount（events）

### 只对它生效的节点 · Nodes only for this widget

- 动画属性 · Animate Property（displayable）
- 获取中心 · Get Center（displayable）
- 获取显示状态 · Get Display（displayable）
- 获取实测矩形 · Get Measured Rect（displayable）
- 获取属性 · Get Property（displayable）
- 获取视频时长 · Get Video Duration（video）
- 获取视频播放位置 · Get Video Time（video）
- 获取视频音量 · Get Video Volume（video）
- 视频是否已播完 · Is Video Ended（video）
- 视频是否静音 · Is Video Muted（video）
- 视频是否在播放 · Is Video Playing（video）
- 暂停视频 · Pause Video（video）
- 播放视频 · Play Video（video）
- 跳转视频播放位置 · Seek Video（video）
- 设置显示状态 · Set Display（displayable）
- 设置属性 · Set Property（displayable）
- 设置视频循环 · Set Video Loop（video）
- 设置视频静音 · Set Video Muted（video）
- 设置视频速度 · Set Video Speed（video）
- 设置视频音量 · Set Video Volume（video）
- 停止动画 · Stop Animation（displayable）
- 停止视频 · Stop Video（video）

## Spine / Live2D 模型 · Spine / Live2D Model

元素类型 · Element type：`nl.puppet`

### 属性面板 · Properties：属性 · Properties

- **模型 · Model**
- **姿态 · Pose**
- **外框 · Box**
  - 背景色 · Backdrop：画在模型后面；默认关闭，让画面本身透出来 · Drawn behind the model. Off by default so the Surface shows through.
  - 圆角半径 · Corner Radius
  - 边框 · Border
  - 边框样式 · Border Style

### 属性面板 · Properties：交互 · Interaction

- 控件逻辑 · Widget logic

### 控件蓝图的事件 · Events on its blueprint

- 界面进入后 · After Surface Enter（events）
- 界面退出前 · Before Surface Exit（events）
- 失焦 · Blur（events）
- 聚焦 · Focus（events）
- 初始化 · Init（events）
- 鼠标点击 · Mouse Click（events）
- 鼠标双击 · Mouse Double Click（events）
- 鼠标按下 · Mouse Down（events）
- 鼠标进入 · Mouse Enter（events）
- 鼠标离开 · Mouse Leave（events）
- 鼠标移动 · Mouse Move（events）
- 鼠标抬起 · Mouse Up（events）
- 鼠标滚轮 · Mouse Wheel（events）
- 刷新时 · On Flush（events）
- 右键点击 · Right Click（events）
- 卸载 · Unmount（events）

### 只对它生效的节点 · Nodes only for this widget

- 动画属性 · Animate Property（displayable）
- 获取中心 · Get Center（displayable）
- 获取显示状态 · Get Display（displayable）
- 获取实测矩形 · Get Measured Rect（displayable）
- 获取属性 · Get Property（displayable）
- 设置显示状态 · Set Display（displayable）
- 设置属性 · Set Property（displayable）
- 停止动画 · Stop Animation（displayable）

## 滑块 · Slider

元素类型 · Element type：`nl.slider`

### 属性面板 · Properties：交互 · Interaction

- 控件逻辑 · Widget logic

### 控件蓝图的事件 · Events on its blueprint

- 界面进入后 · After Surface Enter（events）
- 界面退出前 · Before Surface Exit（events）
- 拖拽结束 · Drag End（events）
- 拖拽开始 · Drag Start（events）
- 初始化 · Init（events）
- 刷新时 · On Flush（events）
- 卸载 · Unmount（events）
- 值变更 · Value Changed（events）

### 只对它生效的节点 · Nodes only for this widget

- 动画属性 · Animate Property（displayable）
- 获取中心 · Get Center（displayable）
- 获取显示状态 · Get Display（displayable）
- 获取启用状态 · Get Enabled（slider）
- 获取实测矩形 · Get Measured Rect（displayable）
- 获取归一化值 · Get Normalized Value（slider）
- 获取属性 · Get Property（displayable）
- 获取滑块范围 · Get Slider Range（slider）
- 获取值 · Get Value（slider）
- 获取可见性 · Get Visible（slider）
- 设置显示状态 · Set Display（displayable）
- 设置启用状态 · Set Enabled（slider）
- 设置属性 · Set Property（displayable）
- 设置滑块范围 · Set Slider Range（slider）
- 设置滑块值 · Set Slider Value（slider）
- 设置可见性 · Set Visible（slider）
- 停止动画 · Stop Animation（displayable）

## 列表 · List

元素类型 · Element type：`nl.list`

### 属性面板 · Properties：属性 · Properties

- **内容 · Content**
  - 行标识 · Row key
  - 运行时项 · Runtime items（选项 · options：列表内容 / 页面状态数组 / 应用状态数组 / 页面属性数组 · List content / Page state array / App state array / Page props array）
  - 状态键 · State key
  - 参数 · Param
  - 属性名 · Prop name
  - 占位行数 · Placeholder rows
- **布局 · Layout**
- **行动效 · Row animation**
- **项模板 · Item template**
- **滚动条 · Scrollbar**
  - 轨道颜色 · Track color
  - 轨道图片 · Track image
  - 滑块颜色 · Thumb color
  - 滑块图片 · Thumb image
- **效果 · Effects**

### 属性面板 · Properties：交互 · Interaction

- 控件逻辑 · Widget logic

### 控件蓝图的事件 · Events on its blueprint

- 界面进入后 · After Surface Enter（events）
- 界面退出前 · Before Surface Exit（events）
- 初始化 · Init（events）
- 项点击 · Item Click（events）
- 项悬停 · Item Hover（events）
- 项渲染 · Item Render（events）
- 刷新时 · On Flush（events）
- 滚动 · Scroll（events）
- 滚动结束 · Scroll End（events）
- 选择变更 · Selection Changed（events）
- 卸载 · Unmount（events）

### 只对它生效的节点 · Nodes only for this widget

- 动画属性 · Animate Property（displayable）
- 追加列表项 · Append List Item（list）
- 清空列表 · Clear List（list）
- 按字段查找条目 · Find Item By Field（list）
- 获取中心 · Get Center（displayable）
- 获取显示状态 · Get Display（displayable）
- 获取启用状态 · Get Enabled（list）
- 取指定条目 · Get Item At（list）
- 获取列表内容 · Get List Content（list）
- 获取列表长度 · Get List Length（list）
- 获取实测矩形 · Get Measured Rect（displayable）
- 获取属性 · Get Property（displayable）
- 获取滚动位置 · Get Scroll Offset（list）
- 获取滚动进度 · Get Scroll Progress（list）
- 获取选中索引 · Get Selected Index（list）
- 获取选中项 · Get Selected Item（list）
- 获取可见性 · Get Visible（list）
- 插入列表项 · Insert List Item（list）
- 是否已到末尾 · Is Scrolled To End（list）
- 是否已到开头 · Is Scrolled To Start（list）
- 刷新列表项 · Refresh List Items（list）
- 移除列表项 · Remove List Item（list）
- 按索引移除列表项 · Remove List Item At（list）
- 滚动到底部 · Scroll To Bottom（list）
- 滚动到索引 · Scroll To Index（list）
- 滚动到顶部 · Scroll To Top（list）
- 设置显示状态 · Set Display（displayable）
- 设置启用状态 · Set Enabled（list）
- 设置条目字段 · Set Item Field At（list）
- 设置列表内容 · Set List Content（list）
- 设置属性 · Set Property（displayable）
- 设置选中索引 · Set Selected Index（list）
- 设置选中项 · Set Selected Item（list）
- 设置可见性 · Set Visible（list）
- 按字段排序列表 · Sort List By Field（list）
- 停止动画 · Stop Animation（displayable）

## 操作提示栏 · Input Hints

元素类型 · Element type：`nl.inputHints`

### 属性面板 · Properties：属性 · Properties

- **内容 · Content**
  - 显示于 · Show for（选项 · options：键盘与手柄 / 仅手柄 / 所有设备 · Keyboard and gamepad / Gamepad only / Every device）：显示提示的输入设备。使用其他输入设备时不显示提示 · The inputs the bar shows hints for. While any other input is in use, it shows none.
  - 按键图标 · Button glyphs（选项 · options：跟随已连接的手柄 / Xbox / PlayStation / Nintendo · Match the connected controller / Xbox / PlayStation / Nintendo）
- **样式 · Style**
  - 对齐 · Alignment（选项 · options：起始 / 居中 / 末尾 · Start / Center / End）
  - 字号 · Font size
  - 间距 · Spacing
  - 文字颜色 · Text color
  - 图标底色 · Glyph fill
  - 图标文字 · Glyph text
- **文字 · Words**
  - 选择 · Select：留空时使用 Studio 内置词语，并随玩家语言切换。项目声明的意图使用其自身名称 · Left empty, each hint uses Studio's own word in the player's language. Actions the project declares are named by their own names.
  - 确认 · Confirm
  - 返回 · Back
  - 推进 · Advance
  - 快捷菜单 · Quick menu

### 只对它生效的节点 · Nodes only for this widget

- 动画属性 · Animate Property（displayable）
- 获取中心 · Get Center（displayable）
- 获取显示状态 · Get Display（displayable）
- 获取实测矩形 · Get Measured Rect（displayable）
- 获取属性 · Get Property（displayable）
- 设置显示状态 · Set Display（displayable）
- 设置属性 · Set Property（displayable）
- 停止动画 · Stop Animation（displayable）

## 页面 · Page

元素类型 · Element type：`nl.frame`

### 属性面板 · Properties：属性 · Properties

- 页面 · Page
- 参数 · Params
- 参数 · Props
- **动画 · Animation**
- 页面组件逻辑 · Page component logic

### 控件蓝图的事件 · Events on its blueprint

- 界面进入后 · After Surface Enter（events）
- 界面退出前 · Before Surface Exit（events）
- 初始化 · Init（events）
- 刷新时 · On Flush（events）
- 页面事件 · Page Event（events）
- 卸载 · Unmount（events）

### 只对它生效的节点 · Nodes only for this widget

- 动画属性 · Animate Property（displayable）
- 获取中心 · Get Center（displayable）
- 获取显示状态 · Get Display（displayable）
- 获取启用状态 · Get Enabled（frame）
- 获取实测矩形 · Get Measured Rect（displayable）
- 获取参数 · Get Params（frame）
- 获取属性 · Get Property（displayable）
- 获取目标页面 · Get Target Page（frame）
- 获取可见性 · Get Visible（frame）
- 设置显示状态 · Set Display（displayable）
- 设置启用状态 · Set Enabled（frame）
- 设置框架页面 · Set Frame Page（frame）
- 设置参数 · Set Params（frame）
- 设置属性 · Set Property（displayable）
- 设置可见性 · Set Visible（frame）
- 停止动画 · Stop Animation（displayable）
