# 蓝图节点：事件 · Events

> 本文件由 NarraLeaf Studio 源码自动生成，请勿手动修改。
> Generated from the NarraLeaf Studio source. Do not edit by hand.

「事件 · Events」分类下的 60 个节点。标题是节点面板里显示的名字（中文 · English）。

The 60 nodes in the "Events" palette category, titled as the node palette shows them.

### 界面进入后 · After Surface Enter

`blueprint.event.head.afterSurfaceEnter` · 事件：一张图从这里开始 · Event: a graph starts here

- 只用于这些控件的蓝图 · Only on: 容器 · Container、文本 · Text、句子 · Sentence、图片 · Image、视频 · Video、Spine / Live2D 模型 · Spine / Live2D Model、按钮 · Button、列表 · List、通知列表 · Notification List、选项列表 · Choice List、NVL 列表 · NVL List、NVL 文本 · NVL Texts、滑块 · Slider、文本输入框 · Text Input、开关 · Switch、页面 · Page
- 可放在 · Allowed in: 页面逻辑 · Page logic、控件逻辑 · Widget logic、组件内的控件逻辑 · Widget logic inside a component
- 输出 · Out：则 · Then（`then`，执行 · exec）

### 任意手柄按下 · Any Gamepad Button Down

`blueprint.event.head.anyGamepadButtonDown` · 事件：一张图从这里开始 · Event: a graph starts here

- 可放在 · Allowed in: 应用逻辑 · App logic、页面逻辑 · Page logic、控件逻辑 · Widget logic
- 输出 · Out：则 · Then（`then`，执行 · exec）
- 输出 · Out：按钮 · Button（`button`，string）

### 任意手柄松开 · Any Gamepad Button Up

`blueprint.event.head.anyGamepadButtonUp` · 事件：一张图从这里开始 · Event: a graph starts here

- 可放在 · Allowed in: 应用逻辑 · App logic、页面逻辑 · Page logic、控件逻辑 · Widget logic
- 输出 · Out：则 · Then（`then`，执行 · exec）
- 输出 · Out：按钮 · Button（`button`，string）

### 任意按键按下 · Any Key Down

`blueprint.event.head.anyKeyDown` · 事件：一张图从这里开始 · Event: a graph starts here

- 可放在 · Allowed in: 应用逻辑 · App logic、页面逻辑 · Page logic、控件逻辑 · Widget logic
- 输出 · Out：则 · Then（`then`，执行 · exec）
- 输出 · Out：键 · Key（`key`，string）
- 输出 · Out：Alt（`altKey`，boolean）
- 输出 · Out：Ctrl（`ctrlKey`，boolean）
- 输出 · Out：Shift（`shiftKey`，boolean）
- 输出 · Out：Meta（`metaKey`，boolean）

### 任意按键抬起 · Any Key Up

`blueprint.event.head.anyKeyUp` · 事件：一张图从这里开始 · Event: a graph starts here

- 可放在 · Allowed in: 应用逻辑 · App logic、页面逻辑 · Page logic、控件逻辑 · Widget logic
- 输出 · Out：则 · Then（`then`，执行 · exec）
- 输出 · Out：键 · Key（`key`，string）
- 输出 · Out：Alt（`altKey`，boolean）
- 输出 · Out：Ctrl（`ctrlKey`，boolean）
- 输出 · Out：Shift（`shiftKey`，boolean）
- 输出 · Out：Meta（`metaKey`，boolean）

### 应用启动 · App Boot

`blueprint.event.head.appBoot` · 事件：一张图从这里开始 · Event: a graph starts here

每次启动游戏时运行一次，在第一个界面显示之后，界面不等它执行完。此时「游戏就绪时」已经运行过。开发模式中每次重新加载后会再次运行

Runs once each time the game starts, after the first screen is showing, and does not hold that screen back. On Game Ready has already run by then. In Dev Mode it runs again after every reload.

- 可放在 · Allowed in: 应用逻辑 · App logic
- 输出 · Out：则 · Then（`then`，执行 · exec）

### 界面退出前 · Before Surface Exit

`blueprint.event.head.beforeSurfaceExit` · 事件：一张图从这里开始 · Event: a graph starts here

- 只用于这些控件的蓝图 · Only on: 容器 · Container、文本 · Text、句子 · Sentence、图片 · Image、视频 · Video、Spine / Live2D 模型 · Spine / Live2D Model、按钮 · Button、列表 · List、通知列表 · Notification List、选项列表 · Choice List、NVL 列表 · NVL List、NVL 文本 · NVL Texts、滑块 · Slider、文本输入框 · Text Input、开关 · Switch、页面 · Page
- 可放在 · Allowed in: 页面逻辑 · Page logic、控件逻辑 · Widget logic、组件内的控件逻辑 · Widget logic inside a component
- 输出 · Out：则 · Then（`then`，执行 · exec）

### 失焦 · Blur

`blueprint.event.head.blur` · 事件：一张图从这里开始 · Event: a graph starts here

- 只用于这些控件的蓝图 · Only on: 容器 · Container、文本 · Text、句子 · Sentence、图片 · Image、视频 · Video、Spine / Live2D 模型 · Spine / Live2D Model、按钮 · Button、NVL 文本 · NVL Texts、文本输入框 · Text Input、开关 · Switch
- 可放在 · Allowed in: 控件逻辑 · Widget logic、组件内的控件逻辑 · Widget logic inside a component
- 输出 · Out：则 · Then（`then`，执行 · exec）

### 状态变更 · Changed

`blueprint.event.head.switchChanged` · 事件：一张图从这里开始 · Event: a graph starts here

- 只用于这些控件的蓝图 · Only on: 开关 · Switch
- 可放在 · Allowed in: 控件逻辑 · Widget logic、组件内的控件逻辑 · Widget logic inside a component
- 输出 · Out：则 · Then（`then`，执行 · exec）
- 输出 · Out：开启 · Checked（`checked`，boolean）
- 输出 · Out：上一个开启状态 · Previous Checked（`previousChecked`，boolean）

### 拖拽结束 · Drag End

`blueprint.event.head.sliderDragEnd` · 事件：一张图从这里开始 · Event: a graph starts here

- 只用于这些控件的蓝图 · Only on: 滑块 · Slider
- 可放在 · Allowed in: 控件逻辑 · Widget logic、组件内的控件逻辑 · Widget logic inside a component
- 输出 · Out：则 · Then（`then`，执行 · exec）
- 输出 · Out：值 · Value（`value`，float）

### 拖拽开始 · Drag Start

`blueprint.event.head.sliderDragStart` · 事件：一张图从这里开始 · Event: a graph starts here

- 只用于这些控件的蓝图 · Only on: 滑块 · Slider
- 可放在 · Allowed in: 控件逻辑 · Widget logic、组件内的控件逻辑 · Widget logic inside a component
- 输出 · Out：则 · Then（`then`，执行 · exec）
- 输出 · Out：值 · Value（`value`，float）

### 元素点击 · Element Click

`blueprint.event.head.elementClick` · 控件事件：一张图从这里开始 · Element event: a graph starts here

- 可放在 · Allowed in: 页面逻辑 · Page logic、控件逻辑 · Widget logic
- 输出 · Out：则 · Then（`then`，执行 · exec）
- 输出 · Out：元素 · Element（`element`，element）
- 输出 · Out：X（`x`，float）
- 输出 · Out：Y（`y`，float）
- 输出 · Out：按钮 · Button（`button`，integer）

### 元素刷新 · Element Flush

`blueprint.event.head.elementFlush` · 控件事件：一张图从这里开始 · Element event: a graph starts here

- 可放在 · Allowed in: 页面逻辑 · Page logic、控件逻辑 · Widget logic
- 输出 · Out：则 · Then（`then`，执行 · exec）
- 输出 · Out：元素 · Element（`element`，element）

### 聚焦 · Focus

`blueprint.event.head.focus` · 事件：一张图从这里开始 · Event: a graph starts here

- 只用于这些控件的蓝图 · Only on: 容器 · Container、文本 · Text、句子 · Sentence、图片 · Image、视频 · Video、Spine / Live2D 模型 · Spine / Live2D Model、按钮 · Button、NVL 文本 · NVL Texts、文本输入框 · Text Input、开关 · Switch
- 可放在 · Allowed in: 控件逻辑 · Widget logic、组件内的控件逻辑 · Widget logic inside a component
- 输出 · Out：则 · Then（`then`，执行 · exec）

### 获取监听器数量 · Get Listener Count

`blueprint.broadcast.getListenerCount` · 纯数据节点，没有执行针脚 · Pure: no exec pins

- 可放在 · Allowed in: 页面逻辑 · Page logic、控件逻辑 · Widget logic
- 输入 · In：事件 · Event（`event`，string；可直接填值 · accepts a typed value）
- 输出 · Out：数量 · Count（`count`，integer）

### 初始化 · Init

`blueprint.event.head.init` · 事件：一张图从这里开始 · Event: a graph starts here

- 只用于这些控件的蓝图 · Only on: 容器 · Container、文本 · Text、句子 · Sentence、图片 · Image、视频 · Video、Spine / Live2D 模型 · Spine / Live2D Model、按钮 · Button、列表 · List、通知列表 · Notification List、选项列表 · Choice List、NVL 列表 · NVL List、NVL 文本 · NVL Texts、滑块 · Slider、文本输入框 · Text Input、开关 · Switch、页面 · Page
- 可放在 · Allowed in: 控件逻辑 · Widget logic、控件取值 · Widget value、组件内的控件逻辑 · Widget logic inside a component
- 输出 · Out：则 · Then（`then`，执行 · exec）

### 项点击 · Item Click

`blueprint.event.head.itemClick` · 事件：一张图从这里开始 · Event: a graph starts here

- 只用于这些控件的蓝图 · Only on: 列表 · List、通知列表 · Notification List、选项列表 · Choice List、NVL 列表 · NVL List
- 可放在 · Allowed in: 控件逻辑 · Widget logic、组件内的控件逻辑 · Widget logic inside a component
- 输出 · Out：则 · Then（`then`，执行 · exec）
- 输出 · Out：索引 · Index（`index`，integer）
- 输出 · Out：数量 · Count（`count`，integer）
- 输出 · Out：键 · Key（`key`，string）
- 输出 · Out：项 · Item（`item`，json）

### 项悬停 · Item Hover

`blueprint.event.head.itemHover` · 事件：一张图从这里开始 · Event: a graph starts here

- 只用于这些控件的蓝图 · Only on: 列表 · List、通知列表 · Notification List、选项列表 · Choice List、NVL 列表 · NVL List
- 可放在 · Allowed in: 控件逻辑 · Widget logic、组件内的控件逻辑 · Widget logic inside a component
- 输出 · Out：则 · Then（`then`，执行 · exec）
- 输出 · Out：索引 · Index（`index`，integer）
- 输出 · Out：数量 · Count（`count`，integer）
- 输出 · Out：键 · Key（`key`，string）
- 输出 · Out：项 · Item（`item`，json）

### 项渲染 · Item Render

`blueprint.event.head.itemRender` · 事件：一张图从这里开始 · Event: a graph starts here

- 只用于这些控件的蓝图 · Only on: 列表 · List、通知列表 · Notification List、选项列表 · Choice List、NVL 列表 · NVL List
- 可放在 · Allowed in: 控件逻辑 · Widget logic、组件内的控件逻辑 · Widget logic inside a component
- 输出 · Out：则 · Then（`then`，执行 · exec）
- 输出 · Out：索引 · Index（`index`，integer）
- 输出 · Out：数量 · Count（`count`，integer）
- 输出 · Out：键 · Key（`key`，string）
- 输出 · Out：项 · Item（`item`，json）

### 列表项刷新 · List Item Refresh

`blueprint.event.head.listItemRefresh` · 事件：一张图从这里开始 · Event: a graph starts here

- 只用于这些控件的蓝图 · Only on: 容器 · Container、文本 · Text、句子 · Sentence、图片 · Image、按钮 · Button、NVL 文本 · NVL Texts
- 可放在 · Allowed in: 控件逻辑 · Widget logic、组件内的控件逻辑 · Widget logic inside a component
- 输出 · Out：则 · Then（`then`，执行 · exec）
- 输出 · Out：属性 · Props（`props`，json）
- 输出 · Out：项 · Item（`item`，json）
- 输出 · Out：索引 · Index（`index`，integer）
- 输出 · Out：数量 · Count（`count`，integer）
- 输出 · Out：键 · Key（`key`，string）

### 鼠标点击 · Mouse Click

`blueprint.event.head.mouseClick` · 事件：一张图从这里开始 · Event: a graph starts here

- 只用于这些控件的蓝图 · Only on: 容器 · Container、文本 · Text、句子 · Sentence、图片 · Image、视频 · Video、Spine / Live2D 模型 · Spine / Live2D Model、按钮 · Button、NVL 文本 · NVL Texts、开关 · Switch
- 可放在 · Allowed in: 页面逻辑 · Page logic、控件逻辑 · Widget logic、组件内的控件逻辑 · Widget logic inside a component
- 输出 · Out：则 · Then（`then`，执行 · exec）
- 输出 · Out：X（`x`，float）
- 输出 · Out：Y（`y`，float）

### 鼠标双击 · Mouse Double Click

`blueprint.event.head.mouseDoubleClick` · 事件：一张图从这里开始 · Event: a graph starts here

- 只用于这些控件的蓝图 · Only on: 容器 · Container、文本 · Text、句子 · Sentence、图片 · Image、视频 · Video、Spine / Live2D 模型 · Spine / Live2D Model、按钮 · Button、NVL 文本 · NVL Texts、开关 · Switch
- 可放在 · Allowed in: 控件逻辑 · Widget logic、组件内的控件逻辑 · Widget logic inside a component
- 输出 · Out：则 · Then（`then`，执行 · exec）
- 输出 · Out：X（`x`，float）
- 输出 · Out：Y（`y`，float）

### 鼠标按下 · Mouse Down

`blueprint.event.head.mouseDown` · 事件：一张图从这里开始 · Event: a graph starts here

- 只用于这些控件的蓝图 · Only on: 容器 · Container、文本 · Text、句子 · Sentence、图片 · Image、视频 · Video、Spine / Live2D 模型 · Spine / Live2D Model、按钮 · Button、NVL 文本 · NVL Texts、开关 · Switch
- 可放在 · Allowed in: 控件逻辑 · Widget logic、组件内的控件逻辑 · Widget logic inside a component
- 输出 · Out：则 · Then（`then`，执行 · exec）
- 输出 · Out：X（`x`，float）
- 输出 · Out：Y（`y`，float）
- 输出 · Out：按钮 · Button（`button`，integer）

### 鼠标进入 · Mouse Enter

`blueprint.event.head.mouseEnter` · 事件：一张图从这里开始 · Event: a graph starts here

- 只用于这些控件的蓝图 · Only on: 容器 · Container、文本 · Text、句子 · Sentence、图片 · Image、视频 · Video、Spine / Live2D 模型 · Spine / Live2D Model、按钮 · Button、NVL 文本 · NVL Texts、开关 · Switch
- 可放在 · Allowed in: 控件逻辑 · Widget logic、组件内的控件逻辑 · Widget logic inside a component
- 输出 · Out：则 · Then（`then`，执行 · exec）
- 输出 · Out：X（`x`，float）
- 输出 · Out：Y（`y`，float）

### 鼠标离开 · Mouse Leave

`blueprint.event.head.mouseLeave` · 事件：一张图从这里开始 · Event: a graph starts here

- 只用于这些控件的蓝图 · Only on: 容器 · Container、文本 · Text、句子 · Sentence、图片 · Image、视频 · Video、Spine / Live2D 模型 · Spine / Live2D Model、按钮 · Button、NVL 文本 · NVL Texts、开关 · Switch
- 可放在 · Allowed in: 控件逻辑 · Widget logic、组件内的控件逻辑 · Widget logic inside a component
- 输出 · Out：则 · Then（`then`，执行 · exec）
- 输出 · Out：X（`x`，float）
- 输出 · Out：Y（`y`，float）

### 鼠标移动 · Mouse Move

`blueprint.event.head.mouseMove` · 事件：一张图从这里开始 · Event: a graph starts here

- 只用于这些控件的蓝图 · Only on: 容器 · Container、文本 · Text、句子 · Sentence、图片 · Image、视频 · Video、Spine / Live2D 模型 · Spine / Live2D Model、按钮 · Button、NVL 文本 · NVL Texts、开关 · Switch
- 可放在 · Allowed in: 控件逻辑 · Widget logic、组件内的控件逻辑 · Widget logic inside a component
- 输出 · Out：则 · Then（`then`，执行 · exec）
- 输出 · Out：X（`x`，float）
- 输出 · Out：Y（`y`，float）

### 鼠标抬起 · Mouse Up

`blueprint.event.head.mouseUp` · 事件：一张图从这里开始 · Event: a graph starts here

- 只用于这些控件的蓝图 · Only on: 容器 · Container、文本 · Text、句子 · Sentence、图片 · Image、视频 · Video、Spine / Live2D 模型 · Spine / Live2D Model、按钮 · Button、NVL 文本 · NVL Texts、开关 · Switch
- 可放在 · Allowed in: 控件逻辑 · Widget logic、组件内的控件逻辑 · Widget logic inside a component
- 输出 · Out：则 · Then（`then`，执行 · exec）
- 输出 · Out：X（`x`，float）
- 输出 · Out：Y（`y`，float）
- 输出 · Out：按钮 · Button（`button`，integer）

### 鼠标滚轮 · Mouse Wheel

`blueprint.event.head.mouseWheel` · 事件：一张图从这里开始 · Event: a graph starts here

- 只用于这些控件的蓝图 · Only on: 容器 · Container、文本 · Text、句子 · Sentence、图片 · Image、视频 · Video、Spine / Live2D 模型 · Spine / Live2D Model、按钮 · Button、NVL 文本 · NVL Texts、开关 · Switch
- 可放在 · Allowed in: 控件逻辑 · Widget logic、组件内的控件逻辑 · Widget logic inside a component
- 输出 · Out：则 · Then（`then`，执行 · exec）
- 输出 · Out：X（`x`，float）
- 输出 · Out：Y（`y`，float）
- 输出 · Out：增量 X · Delta X（`deltaX`，float）
- 输出 · Out：增量 Y · Delta Y（`deltaY`，float）

### 意图触发时 · On Action

`blueprint.event.head.action` · 事件：一张图从这里开始 · Event: a graph starts here

- 可放在 · Allowed in: 应用逻辑 · App logic、页面逻辑 · Page logic
- 输出 · Out：则 · Then（`then`，执行 · exec）
- 输出 · Out：来源 · Source（`source`，string）
- 输出 · Out：X（`x`，float）
- 输出 · Out：Y（`y`，float）
- 设置 · Setting：意图 · Action（`actionId`）

### 任意广播时 · On Any Broadcast

`blueprint.event.head.onAnyBroadcast` · 事件：一张图从这里开始 · Event: a graph starts here

- 可放在 · Allowed in: 页面逻辑 · Page logic、控件逻辑 · Widget logic
- 输出 · Out：则 · Then（`then`，执行 · exec）
- 输出 · Out：事件 · Event（`event`，string）
- 输出 · Out：数据 · Data（`data`，json）
- 输出 · Out：发送者 · Sender（`sender`，string）

### 任意偏好变更时 · On Any Preference Changed

`blueprint.event.head.anyPreferenceChanged` · 事件：一张图从这里开始 · Event: a graph starts here

- 可放在 · Allowed in: 应用逻辑 · App logic、页面逻辑 · Page logic
- 输出 · Out：则 · Then（`then`，执行 · exec）
- 输出 · Out：键 · Key（`key`，string）
- 输出 · Out：值 · Value（`value`，json）
- 输出 · Out：上一个值 · Previous Value（`previousValue`，json）

### 广播时 · On Broadcast

`blueprint.event.head.onBroadcast` · 事件：一张图从这里开始 · Event: a graph starts here

- 可放在 · Allowed in: 页面逻辑 · Page logic、控件逻辑 · Widget logic
- 输出 · Out：则 · Then（`then`，执行 · exec）
- 输出 · Out：数据 · Data（`data`，json）
- 输出 · Out：发送者 · Sender（`sender`，string）
- 设置 · Setting：事件 · Event（`event`）

### 被调用时 · On Call

`blueprint.event.head.onCall` · 事件：一张图从这里开始 · Event: a graph starts here

- 可放在 · Allowed in: 故事动作 · Story action
- 输出 · Out：则 · Then（`then`，执行 · exec）

### 刷新时 · On Flush

`blueprint.event.head.flush` · 事件：一张图从这里开始 · Event: a graph starts here

- 只用于这些控件的蓝图 · Only on: 容器 · Container、文本 · Text、句子 · Sentence、图片 · Image、视频 · Video、Spine / Live2D 模型 · Spine / Live2D Model、按钮 · Button、列表 · List、通知列表 · Notification List、选项列表 · Choice List、NVL 列表 · NVL List、NVL 文本 · NVL Texts、滑块 · Slider、文本输入框 · Text Input、开关 · Switch、页面 · Page
- 可放在 · Allowed in: 控件逻辑 · Widget logic、控件取值 · Widget value、组件内的控件逻辑 · Widget logic inside a component
- 输出 · Out：则 · Then（`then`，执行 · exec）
- 输出 · Out：元素 · Element（`element`，element）

### 全屏状态变更时 · On Fullscreen Changed

`blueprint.event.head.fullscreenChanged` · 事件：一张图从这里开始 · Event: a graph starts here

- 可放在 · Allowed in: 应用逻辑 · App logic、页面逻辑 · Page logic、控件逻辑 · Widget logic
- 输出 · Out：则 · Then（`then`，执行 · exec）
- 输出 · Out：是否全屏 · Is Fullscreen（`isFullscreen`，boolean）

### 游戏就绪时 · On Game Ready

`blueprint.event.head.gameReady` · 事件：一张图从这里开始 · Event: a graph starts here

游戏准备就绪时运行，早于任何故事开始，也早于第一个界面显示；界面会等它执行完。先于「应用启动」运行，开始或读取游戏时可能再次运行

Runs when the game is ready, before any story starts and before the first screen shows; the screen waits for it to finish. Runs before App Boot, and can run again when a game is started or loaded.

- 可放在 · Allowed in: 应用逻辑 · App logic
- 输出 · Out：则 · Then（`then`，执行 · exec）

### 手柄按下时 · On Gamepad Button Down

`blueprint.event.head.gamepadButtonDown` · 事件：一张图从这里开始 · Event: a graph starts here

- 可放在 · Allowed in: 应用逻辑 · App logic、页面逻辑 · Page logic、控件逻辑 · Widget logic
- 输出 · Out：则 · Then（`then`，执行 · exec）
- 设置 · Setting：按钮 · Button（`button`：A / B / X / Y / LB / RB / LT / RT / Back / 开始 · Start / L3 / R3 / D-pad Up / D-pad Down / D-pad Left / D-pad Right / Home / Left Stick Up / Left Stick Down / Left Stick Left / Left Stick Right）

### 手柄松开时 · On Gamepad Button Up

`blueprint.event.head.gamepadButtonUp` · 事件：一张图从这里开始 · Event: a graph starts here

- 可放在 · Allowed in: 应用逻辑 · App logic、页面逻辑 · Page logic、控件逻辑 · Widget logic
- 输出 · Out：则 · Then（`then`，执行 · exec）
- 设置 · Setting：按钮 · Button（`button`：A / B / X / Y / LB / RB / LT / RT / Back / 开始 · Start / L3 / R3 / D-pad Up / D-pad Down / D-pad Left / D-pad Right / Home / Left Stick Up / Left Stick Down / Left Stick Left / Left Stick Right）

### 按键按下时 · On Key Down

`blueprint.event.head.keyDown` · 事件：一张图从这里开始 · Event: a graph starts here

- 可放在 · Allowed in: 应用逻辑 · App logic、页面逻辑 · Page logic、控件逻辑 · Widget logic
- 输出 · Out：则 · Then（`then`，执行 · exec）
- 设置 · Setting：键 · Key（`key`）

### 按键抬起时 · On Key Up

`blueprint.event.head.keyUp` · 事件：一张图从这里开始 · Event: a graph starts here

- 可放在 · Allowed in: 应用逻辑 · App logic、页面逻辑 · Page logic、控件逻辑 · Widget logic
- 输出 · Out：则 · Then（`then`，执行 · exec）
- 设置 · Setting：键 · Key（`key`）

### 持久变量变化时 · On Persistent Changed

`blueprint.event.head.persistentVariableChanged` · 事件：一张图从这里开始 · Event: a graph starts here

- 可放在 · Allowed in: 应用逻辑 · App logic、页面逻辑 · Page logic、控件逻辑 · Widget logic
- 输出 · Out：则 · Then（`then`，执行 · exec）
- 输出 · Out：值 · Value（`value`，any）
- 设置 · Setting：持久 · Persistent（`persistentVariableId`）

### 偏好变更时 · On Preference Changed

`blueprint.event.head.preferenceChanged` · 事件：一张图从这里开始 · Event: a graph starts here

- 可放在 · Allowed in: 应用逻辑 · App logic、页面逻辑 · Page logic
- 输出 · Out：则 · Then（`then`，执行 · exec）
- 输出 · Out：值 · Value（`value`，json）
- 输出 · Out：上一个值 · Previous Value（`previousValue`，json）
- 设置 · Setting：偏好设置 · Preference（`preferenceKey`：自动前进 · Auto Forward / 自动前进延迟 · Auto Forward Delay / 跳过 · Skip / 持续跳过 · Skipping / 跳过已读文本 · Skip Read Text / 失去焦点时静音 · Mute When Unfocused / 显示对话框 · Show Dialog / 游戏速度 · Game Speed / 文字速度（CPS） · Sentence Speed (CPS) / 文字渐入 · Text Fade In / 语音音量 · Voice Volume / 语音淡出 · Voice Fade / 语音结束模式 · Voice End Mode / 音乐音量 · BGM Volume / 音效音量 · Sound Volume / 总音量 · Global Volume / 跳过延迟 · Skip Delay / 跳过间隔 · Skip Interval）

### 存档变量变化时 · On Saved Var Changed

`blueprint.event.head.savedVariableChanged` · 事件：一张图从这里开始 · Event: a graph starts here

- 可放在 · Allowed in: 应用逻辑 · App logic、页面逻辑 · Page logic、控件逻辑 · Widget logic
- 输出 · Out：则 · Then（`then`，执行 · exec）
- 输出 · Out：值 · Value（`value`，any）
- 设置 · Setting：存档变量 · Saved variable（`savedVariableId`）

### 窗口关闭请求时 · On Window Close Requested

`blueprint.event.head.windowCloseRequested` · 事件：一张图从这里开始 · Event: a graph starts here

- 可放在 · Allowed in: 应用逻辑 · App logic、页面逻辑 · Page logic
- 输出 · Out：则 · Then（`then`，执行 · exec）

### 窗口焦点变更时 · On Window Focus Changed

`blueprint.event.head.windowFocusChanged` · 事件：一张图从这里开始 · Event: a graph starts here

- 可放在 · Allowed in: 应用逻辑 · App logic、页面逻辑 · Page logic、控件逻辑 · Widget logic
- 输出 · Out：则 · Then（`then`，执行 · exec）
- 输出 · Out：是否聚焦 · Is Focused（`isFocused`，boolean）

### 页面事件 · Page Event

`blueprint.event.head.pageEvent` · 事件：一张图从这里开始 · Event: a graph starts here

- 只用于这些控件的蓝图 · Only on: 页面 · Page
- 可放在 · Allowed in: 控件逻辑 · Widget logic、组件内的控件逻辑 · Widget logic inside a component
- 输出 · Out：则 · Then（`then`，执行 · exec）
- 输出 · Out：事件 · Event（`event`，string）
- 输出 · Out：数据 · Data（`data`，json）

### 播放结束 · Playback Ended

`blueprint.event.head.videoEnded` · 事件：一张图从这里开始 · Event: a graph starts here

视频每次播放到结尾时运行。开启「循环」时、更换视频文件时、以及页面在播完前关闭时不运行

Runs each time the clip plays to its end. Does not run while Loop is on, when the clip is replaced, or when the page closes before the end.

- 只用于这些控件的蓝图 · Only on: 视频 · Video
- 可放在 · Allowed in: 控件逻辑 · Widget logic、组件内的控件逻辑 · Widget logic inside a component
- 输出 · Out：则 · Then（`then`，执行 · exec）

### 右键点击 · Right Click

`blueprint.event.head.rightClick` · 事件：一张图从这里开始 · Event: a graph starts here

- 只用于这些控件的蓝图 · Only on: 容器 · Container、文本 · Text、句子 · Sentence、图片 · Image、视频 · Video、Spine / Live2D 模型 · Spine / Live2D Model、按钮 · Button、NVL 文本 · NVL Texts、开关 · Switch
- 可放在 · Allowed in: 页面逻辑 · Page logic、控件逻辑 · Widget logic、组件内的控件逻辑 · Widget logic inside a component
- 输出 · Out：则 · Then（`then`，执行 · exec）
- 输出 · Out：X（`x`，float）
- 输出 · Out：Y（`y`，float）

### 滚动 · Scroll

`blueprint.event.head.scroll` · 事件：一张图从这里开始 · Event: a graph starts here

- 只用于这些控件的蓝图 · Only on: 列表 · List、通知列表 · Notification List、选项列表 · Choice List、NVL 列表 · NVL List
- 可放在 · Allowed in: 控件逻辑 · Widget logic、组件内的控件逻辑 · Widget logic inside a component
- 输出 · Out：则 · Then（`then`，执行 · exec）
- 输出 · Out：偏移 · Offset（`offset`，float）
- 输出 · Out：最大偏移 · Max Offset（`maxOffset`，float）
- 输出 · Out：进度 · Progress（`progress`，float）

### 滚动结束 · Scroll End

`blueprint.event.head.scrollEnd` · 事件：一张图从这里开始 · Event: a graph starts here

- 只用于这些控件的蓝图 · Only on: 列表 · List、通知列表 · Notification List、选项列表 · Choice List、NVL 列表 · NVL List
- 可放在 · Allowed in: 控件逻辑 · Widget logic、组件内的控件逻辑 · Widget logic inside a component
- 输出 · Out：则 · Then（`then`，执行 · exec）
- 输出 · Out：偏移 · Offset（`offset`，float）
- 输出 · Out：最大偏移 · Max Offset（`maxOffset`，float）
- 输出 · Out：进度 · Progress（`progress`，float）

### 选择变更 · Selection Changed

`blueprint.event.head.selectionChanged` · 事件：一张图从这里开始 · Event: a graph starts here

- 只用于这些控件的蓝图 · Only on: 列表 · List、通知列表 · Notification List、选项列表 · Choice List、NVL 列表 · NVL List
- 可放在 · Allowed in: 控件逻辑 · Widget logic、组件内的控件逻辑 · Widget logic inside a component
- 输出 · Out：则 · Then（`then`，执行 · exec）
- 输出 · Out：索引 · Index（`index`，integer）
- 输出 · Out：上一个索引 · Previous Index（`previousIndex`，integer）
- 输出 · Out：数量 · Count（`count`，integer）
- 输出 · Out：键 · Key（`key`，string）
- 输出 · Out：项 · Item（`item`，json）

### 发送广播 · Send Broadcast

`blueprint.broadcast.send` · 会等待，完成后才继续 · Latent: waits before continuing

- 可放在 · Allowed in: 页面逻辑 · Page logic、控件逻辑 · Widget logic
- 输入 · In：进入 · In（`in`，执行 · exec）
- 输出 · Out：下一步 · Next（`next`，执行 · exec）
- 输入 · In：事件 · Event（`event`，string；可直接填值 · accepts a typed value）
- 输入 · In：数据 · Data（`data`，json）

### 提交 · Submit

`blueprint.event.head.textInputSubmit` · 事件：一张图从这里开始 · Event: a graph starts here

- 只用于这些控件的蓝图 · Only on: 文本输入框 · Text Input
- 可放在 · Allowed in: 控件逻辑 · Widget logic、组件内的控件逻辑 · Widget logic inside a component
- 输出 · Out：则 · Then（`then`，执行 · exec）
- 输出 · Out：值 · Value（`value`，string）

### 界面初始化 · Surface Init

`blueprint.event.head.surfaceInit` · 事件：一张图从这里开始 · Event: a graph starts here

- 可放在 · Allowed in: 页面逻辑 · Page logic
- 输出 · Out：则 · Then（`then`，执行 · exec）

### 界面卸载 · Surface Unmount

`blueprint.event.head.surfaceUnmount` · 事件：一张图从这里开始 · Event: a graph starts here

- 可放在 · Allowed in: 页面逻辑 · Page logic
- 输出 · Out：则 · Then（`then`，执行 · exec）

### 已关闭 · Turned Off

`blueprint.event.head.switchTurnedOff` · 事件：一张图从这里开始 · Event: a graph starts here

- 只用于这些控件的蓝图 · Only on: 开关 · Switch
- 可放在 · Allowed in: 控件逻辑 · Widget logic、组件内的控件逻辑 · Widget logic inside a component
- 输出 · Out：则 · Then（`then`，执行 · exec）

### 已打开 · Turned On

`blueprint.event.head.switchTurnedOn` · 事件：一张图从这里开始 · Event: a graph starts here

- 只用于这些控件的蓝图 · Only on: 开关 · Switch
- 可放在 · Allowed in: 控件逻辑 · Widget logic、组件内的控件逻辑 · Widget logic inside a component
- 输出 · Out：则 · Then（`then`，执行 · exec）

### 卸载 · Unmount

`blueprint.event.head.unmount` · 事件：一张图从这里开始 · Event: a graph starts here

- 只用于这些控件的蓝图 · Only on: 容器 · Container、文本 · Text、句子 · Sentence、图片 · Image、视频 · Video、Spine / Live2D 模型 · Spine / Live2D Model、按钮 · Button、列表 · List、通知列表 · Notification List、选项列表 · Choice List、NVL 列表 · NVL List、NVL 文本 · NVL Texts、滑块 · Slider、文本输入框 · Text Input、开关 · Switch、页面 · Page
- 可放在 · Allowed in: 控件逻辑 · Widget logic、组件内的控件逻辑 · Widget logic inside a component
- 输出 · Out：则 · Then（`then`，执行 · exec）

### 值变更 · Value Changed

`blueprint.event.head.sliderValueChanged` · 事件：一张图从这里开始 · Event: a graph starts here

- 只用于这些控件的蓝图 · Only on: 滑块 · Slider
- 可放在 · Allowed in: 控件逻辑 · Widget logic、组件内的控件逻辑 · Widget logic inside a component
- 输出 · Out：则 · Then（`then`，执行 · exec）
- 输出 · Out：值 · Value（`value`，float）
- 输出 · Out：上一个值 · Previous Value（`previousValue`，float）

### 值变更 · Value Changed

`blueprint.event.head.textInputValueChanged` · 事件：一张图从这里开始 · Event: a graph starts here

- 只用于这些控件的蓝图 · Only on: 文本输入框 · Text Input
- 可放在 · Allowed in: 控件逻辑 · Widget logic、组件内的控件逻辑 · Widget logic inside a component
- 输出 · Out：则 · Then（`then`，执行 · exec）
- 输出 · Out：值 · Value（`value`，string）
- 输出 · Out：上一个值 · Previous Value（`previousValue`，string）
