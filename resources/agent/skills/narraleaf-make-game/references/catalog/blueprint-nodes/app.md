# 蓝图节点：应用 · App

> 本文件由 NarraLeaf Studio 源码自动生成，请勿手动修改。
> Generated from the NarraLeaf Studio source. Do not edit by hand.

「应用 · App」分类下的 31 个节点。标题是节点面板里显示的名字（中文 · English）。

The 31 nodes in the "App" palette category, titled as the node palette shows them.

### 关闭全部页面 · Clear Page

`blueprint.page.clear` · 会等待，完成后才继续 · Latent: waits before continuing

- 可放在 · Allowed in: 应用逻辑 · App logic、页面逻辑 · Page logic、控件逻辑 · Widget logic、组件内的控件逻辑 · Widget logic inside a component
- 输入 · In：进入 · In（`in`，执行 · exec）
- 输出 · Out：下一步 · Next（`next`，执行 · exec）

### 关闭本叠加页面 · Close This Layer

`blueprint.layer.closeSelf` · 会等待，完成后才继续 · Latent: waits before continuing

- 可放在 · Allowed in: 应用逻辑 · App logic、页面逻辑 · Page logic、控件逻辑 · Widget logic、组件内的控件逻辑 · Widget logic inside a component
- 输入 · In：进入 · In（`in`，执行 · exec）
- 输出 · Out：下一步 · Next（`next`，执行 · exec）
- 输入 · In：结果 · Result（`result`，json；可不连 · optional）

### 触发页面事件 · Emit Page Event

`blueprint.frame.emit` · 会等待，完成后才继续 · Latent: waits before continuing

- 可放在 · Allowed in: 页面逻辑 · Page logic、控件逻辑 · Widget logic
- 输入 · In：进入 · In（`in`，执行 · exec）
- 输出 · Out：下一步 · Next（`next`，执行 · exec）
- 输入 · In：事件 · Event（`event`，string；可直接填值 · accepts a typed value）
- 输入 · In：数据 · Data（`data`，json）

### 获取全屏状态 · Get Fullscreen

`blueprint.app.getFullscreen` · 会等待，完成后才继续 · Latent: waits before continuing

- 可放在 · Allowed in: 应用逻辑 · App logic、页面逻辑 · Page logic、控件逻辑 · Widget logic、组件内的控件逻辑 · Widget logic inside a component
- 输入 · In：进入 · In（`in`，执行 · exec）
- 输出 · Out：下一步 · Next（`next`，执行 · exec）
- 输出 · Out：是否全屏 · Is Fullscreen（`isFullscreen`，boolean）

### 获取页面参数 · Get Page Param

`blueprint.frame.getParam` · 纯数据节点，没有执行针脚 · Pure: no exec pins

打开页面时为所选参数传入的值；未传入时为参数的默认值。参数在页面属性中声明

The value the page was opened with for the chosen param, or the param's default when it was given none. Params are declared in the page's properties.

- 可放在 · Allowed in: 页面逻辑 · Page logic、控件逻辑 · Widget logic、控件取值 · Widget value
- 输入 · In：键 · Key（`key`，string；可直接填值 · accepts a typed value）
- 输出 · Out：值 · Value（`value`，json）
- 设置 · Setting：参数 · Parameter（`paramId`）

### 获取页面属性 · Get Page Props

`blueprint.page.getProps` · 纯数据节点，没有执行针脚 · Pure: no exec pins

- 可放在 · Allowed in: 页面逻辑 · Page logic、控件逻辑 · Widget logic、控件取值 · Widget value
- 输出 · Out：属性 · Props（`props`，json）

### 获取窗口倍数 · Get Window Scale

`blueprint.app.getWindowScale` · 会等待，完成后才继续 · Latent: waits before continuing

- 可放在 · Allowed in: 应用逻辑 · App logic、页面逻辑 · Page logic、控件逻辑 · Widget logic、组件内的控件逻辑 · Widget logic inside a component
- 输入 · In：进入 · In（`in`，执行 · exec）
- 输出 · Out：下一步 · Next（`next`，执行 · exec）
- 输出 · Out：缩放 · Scale（`scale`，float）

### 获取可选窗口倍数 · Get Window Scale Options

`blueprint.app.getWindowScaleOptions` · 会等待，完成后才继续 · Latent: waits before continuing

- 可放在 · Allowed in: 应用逻辑 · App logic、页面逻辑 · Page logic、控件逻辑 · Widget logic、组件内的控件逻辑 · Widget logic inside a component
- 输入 · In：进入 · In（`in`，执行 · exec）
- 输出 · Out：下一步 · Next（`next`，执行 · exec）
- 输出 · Out：倍数列表 · Scales（`scales`，array<float>）

### 获取窗口尺寸 · Get Window Size

`blueprint.app.getWindowSize` · 会等待，完成后才继续 · Latent: waits before continuing

- 可放在 · Allowed in: 应用逻辑 · App logic、页面逻辑 · Page logic、控件逻辑 · Widget logic、组件内的控件逻辑 · Widget logic inside a component
- 输入 · In：进入 · In（`in`，执行 · exec）
- 输出 · Out：下一步 · Next（`next`，执行 · exec）
- 输出 · Out：宽度 · Width（`width`，float）
- 输出 · Out：高度 · Height（`height`，float）

### 返回上一页 · Go back

`blueprint.page.back` · 会等待，完成后才继续 · Latent: waits before continuing

关闭当前页面，回到它下面的页面；已在最底层的页面上时不执行任何操作

Closes the current page and returns to the page beneath it. On the bottom page it does nothing.

- 可放在 · Allowed in: 应用逻辑 · App logic、页面逻辑 · Page logic、控件逻辑 · Widget logic、组件内的控件逻辑 · Widget logic inside a component
- 输入 · In：进入 · In（`in`，执行 · exec）
- 输出 · Out：下一步 · Next（`next`，执行 · exec）

### 前往页面 · Go Page

`blueprint.page.go` · 会等待，完成后才继续 · Latent: waits before continuing

- 可放在 · Allowed in: 应用逻辑 · App logic、页面逻辑 · Page logic、控件逻辑 · Widget logic、组件内的控件逻辑 · Widget logic inside a component
- 输入 · In：进入 · In（`in`，执行 · exec）
- 输入 · In：页面 · Page（`surfaceId`，string；可不连 · optional）
- 输入 · In：页面属性 · Page props（`props`，json；可不连 · optional）
- 设置 · Setting：页面 · Page（`surfaceId`）

### 移除叠加页面 · Hide Layer

`blueprint.layer.hide` · 会等待，完成后才继续 · Latent: waits before continuing

- 可放在 · Allowed in: 应用逻辑 · App logic、页面逻辑 · Page logic、控件逻辑 · Widget logic、组件内的控件逻辑 · Widget logic inside a component
- 输入 · In：进入 · In（`in`，执行 · exec）
- 输出 · Out：下一步 · Next（`next`，执行 · exec）
- 输入 · In：层 · Layer（`layer`，string）

### 叠加页面是否在场 · Is Layer Mounted

`blueprint.layer.isMounted` · 纯数据节点，没有执行针脚 · Pure: no exec pins

- 可放在 · Allowed in: 应用逻辑 · App logic、页面逻辑 · Page logic、控件逻辑 · Widget logic、组件内的控件逻辑 · Widget logic inside a component
- 输入 · In：层 · Layer（`layer`，string）
- 输出 · Out：是否在场 · Is Mounted（`mounted`，boolean）

### 界面是否进入中 · Is Surface Entering

`blueprint.page.isSurfaceEntering` · 纯数据节点，没有执行针脚 · Pure: no exec pins

- 可放在 · Allowed in: 页面逻辑 · Page logic、控件逻辑 · Widget logic、控件取值 · Widget value
- 输出 · Out：进入中 · Is Entering（`isEntering`，boolean）

### 界面是否退出中 · Is Surface Exiting

`blueprint.page.isSurfaceExiting` · 纯数据节点，没有执行针脚 · Pure: no exec pins

- 可放在 · Allowed in: 页面逻辑 · Page logic、控件逻辑 · Widget logic、控件取值 · Widget value
- 输出 · Out：退出中 · Is Exiting（`isExiting`，boolean）

### 界面是否过渡中 · Is Surface Transitioning

`blueprint.page.isSurfaceTransitioning` · 纯数据节点，没有执行针脚 · Pure: no exec pins

- 可放在 · Allowed in: 页面逻辑 · Page logic、控件逻辑 · Widget logic、控件取值 · Widget value
- 输出 · Out：过渡中 · Is Transitioning（`isTransitioning`，boolean）

### 窗口是否聚焦 · Is Window Focused

`blueprint.app.isWindowFocused` · 会等待，完成后才继续 · Latent: waits before continuing

- 可放在 · Allowed in: 应用逻辑 · App logic、页面逻辑 · Page logic、控件逻辑 · Widget logic、组件内的控件逻辑 · Widget logic inside a component
- 输入 · In：进入 · In（`in`，执行 · exec）
- 输出 · Out：下一步 · Next（`next`，执行 · exec）
- 输出 · Out：是否聚焦 · Is Focused（`isFocused`，boolean）

### 保持窗口打开 · Keep Window Open

`blueprint.app.keepWindowOpen`

- 可放在 · Allowed in: 应用逻辑 · App logic、页面逻辑 · Page logic
- 输入 · In：进入 · In（`in`，执行 · exec）
- 输出 · Out：下一步 · Next（`next`，执行 · exec）

### 移动鼠标到 · Move Mouse To

`blueprint.app.movePointerTo` · 会等待，完成后才继续 · Latent: waits before continuing

- 可放在 · Allowed in: 应用逻辑 · App logic、页面逻辑 · Page logic、控件逻辑 · Widget logic、组件内的控件逻辑 · Widget logic inside a component
- 输入 · In：进入 · In（`in`，执行 · exec）
- 输入 · In：点 · Point（`point`，Vector2D）
- 输出 · Out：下一步 · Next（`next`，执行 · exec）
- 输出 · Out：失败 · Failed（`failed`，执行 · exec）
- 输出 · Out：错误 · Error（`error`，string）
- 设置 · Setting：时长（秒） · Duration (s)（`duration`）
- 设置 · Setting：缓动 · Easing（`easing`：线性 · Linear / 缓入 · Ease In / 缓出 · Ease Out / 缓入缓出 · Ease In Out）

### 移动鼠标到元素 · Move Mouse To Element

`blueprint.app.movePointerToElement` · 会等待，完成后才继续 · Latent: waits before continuing

- 可放在 · Allowed in: 应用逻辑 · App logic、页面逻辑 · Page logic、控件逻辑 · Widget logic、组件内的控件逻辑 · Widget logic inside a component
- 输入 · In：进入 · In（`in`，执行 · exec）
- 输入 · In：元素 · Element（`element`，element）
- 输出 · Out：下一步 · Next（`next`，执行 · exec）
- 输出 · Out：失败 · Failed（`failed`，执行 · exec）
- 输出 · Out：错误 · Error（`error`，string）
- 设置 · Setting：时长（秒） · Duration (s)（`duration`）
- 设置 · Setting：缓动 · Easing（`easing`：线性 · Linear / 缓入 · Ease In / 缓出 · Ease Out / 缓入缓出 · Ease In Out）

### 打开链接 · Open Link

`blueprint.app.openExternal` · 会等待，完成后才继续 · Latent: waits before continuing

- 可放在 · Allowed in: 应用逻辑 · App logic、页面逻辑 · Page logic、控件逻辑 · Widget logic、组件内的控件逻辑 · Widget logic inside a component
- 输入 · In：进入 · In（`in`，执行 · exec）
- 输入 · In：URL（`url`，string）
- 输出 · Out：下一步 · Next（`next`，执行 · exec）
- 输出 · Out：失败 · Failed（`failed`，执行 · exec）
- 输出 · Out：错误 · Error（`error`，string）
- 设置 · Setting：URL（`url`）

### 打开截图文件夹 · Open Screenshots Folder

`blueprint.app.openScreenshotsFolder` · 会等待，完成后才继续 · Latent: waits before continuing

- 可放在 · Allowed in: 应用逻辑 · App logic、页面逻辑 · Page logic、控件逻辑 · Widget logic、组件内的控件逻辑 · Widget logic inside a component
- 输入 · In：进入 · In（`in`，执行 · exec）
- 输出 · Out：下一步 · Next（`next`，执行 · exec）
- 输出 · Out：失败 · Failed（`failed`，执行 · exec）
- 输出 · Out：路径 · Path（`path`，string）
- 输出 · Out：错误 · Error（`error`，string）

### 退出应用程序 · Quit Application

`blueprint.page.quit` · 会等待，完成后才继续 · Latent: waits before continuing

- 可放在 · Allowed in: 应用逻辑 · App logic、页面逻辑 · Page logic、控件逻辑 · Widget logic、组件内的控件逻辑 · Widget logic inside a component
- 输入 · In：进入 · In（`in`，执行 · exec）

### 替换页面 · Replace Page

`blueprint.page.replace` · 会等待，完成后才继续 · Latent: waits before continuing

打开页面以代替当前页面，并关闭当前页面；「返回上一页」与页面为「无」的「前往页面」都不会回到该页面

Opens a page in place of the current page, and closes the current page. Go back and Go Page set to None do not return to it.

- 可放在 · Allowed in: 应用逻辑 · App logic、页面逻辑 · Page logic、控件逻辑 · Widget logic、组件内的控件逻辑 · Widget logic inside a component
- 输入 · In：进入 · In（`in`，执行 · exec）
- 输入 · In：页面 · Page（`surfaceId`，string；可不连 · optional）
- 输入 · In：页面属性 · Page props（`props`，json；可不连 · optional）
- 设置 · Setting：页面 · Page（`surfaceId`）

### 保存截图 · Save Screenshot

`blueprint.app.saveScreenshot` · 会等待，完成后才继续 · Latent: waits before continuing

- 可放在 · Allowed in: 应用逻辑 · App logic、页面逻辑 · Page logic、控件逻辑 · Widget logic、组件内的控件逻辑 · Widget logic inside a component
- 输入 · In：进入 · In（`in`，执行 · exec）
- 输出 · Out：下一步 · Next（`next`，执行 · exec）
- 输出 · Out：失败 · Failed（`failed`，执行 · exec）
- 输出 · Out：路径 · Path（`path`，string）
- 输出 · Out：错误 · Error（`error`，string）

### 设置全屏状态 · Set Fullscreen

`blueprint.app.setFullscreen` · 会等待，完成后才继续 · Latent: waits before continuing

- 可放在 · Allowed in: 应用逻辑 · App logic、页面逻辑 · Page logic、控件逻辑 · Widget logic、组件内的控件逻辑 · Widget logic inside a component
- 输入 · In：进入 · In（`in`，执行 · exec）
- 输出 · Out：下一步 · Next（`next`，执行 · exec）
- 设置 · Setting：模式 · Mode（`mode`：进入全屏 · Enter Fullscreen / 退出全屏 · Exit Fullscreen / 切换全屏 · Toggle Fullscreen）

### 设置窗口倍数 · Set Window Scale

`blueprint.app.setWindowScale` · 会等待，完成后才继续 · Latent: waits before continuing

- 可放在 · Allowed in: 应用逻辑 · App logic、页面逻辑 · Page logic、控件逻辑 · Widget logic、组件内的控件逻辑 · Widget logic inside a component
- 输入 · In：进入 · In（`in`，执行 · exec）
- 输出 · Out：下一步 · Next（`next`，执行 · exec）
- 输入 · In：缩放 · Scale（`scale`，float）

### 设置窗口尺寸 · Set Window Size

`blueprint.app.setWindowSize` · 会等待，完成后才继续 · Latent: waits before continuing

- 可放在 · Allowed in: 应用逻辑 · App logic、页面逻辑 · Page logic、控件逻辑 · Widget logic、组件内的控件逻辑 · Widget logic inside a component
- 输入 · In：进入 · In（`in`，执行 · exec）
- 输出 · Out：下一步 · Next（`next`，执行 · exec）
- 输入 · In：宽度 · Width（`width`，float）
- 输入 · In：高度 · Height（`height`，float）

### 询问确认 · Show Confirm

`blueprint.layer.confirm` · 会等待，完成后才继续 · Latent: waits before continuing

- 可放在 · Allowed in: 应用逻辑 · App logic、页面逻辑 · Page logic、控件逻辑 · Widget logic、组件内的控件逻辑 · Widget logic inside a component
- 输入 · In：进入 · In（`in`，执行 · exec）
- 输入 · In：消息 · Message（`message`，string；可直接填值 · accepts a typed value）
- 输入 · In：标记 · Tag（`tag`，string；可不连 · optional；可直接填值 · accepts a typed value）
- 输入 · In：数据 · Data（`data`，json；可不连 · optional）
- 输出 · Out：已关闭 · Dismissed（`dismissed`，执行 · exec）
- 输出 · Out：索引 · Index（`index`，integer）
- 输出 · Out：标签 · Label（`label`，string）
- 设置 · Setting：页面 · Page（`surfaceId`）
- 可增加针脚 · Grows pins: 添加按钮 · Add Button

### 叠加页面 · Show Layer

`blueprint.layer.show` · 会等待，完成后才继续 · Latent: waits before continuing

- 可放在 · Allowed in: 应用逻辑 · App logic、页面逻辑 · Page logic、控件逻辑 · Widget logic、组件内的控件逻辑 · Widget logic inside a component
- 输入 · In：进入 · In（`in`，执行 · exec）
- 输出 · Out：下一步 · Next（`next`，执行 · exec）
- 输入 · In：页面属性 · Page props（`props`，json；可不连 · optional）
- 输入 · In：模态 · Modal（`modal`，boolean；可直接填值 · accepts a typed value）
- 输入 · In：可关闭 · Dismissible（`dismissible`，boolean；可直接填值 · accepts a typed value）
- 输入 · In：分组 · Group（`group`，string；可不连 · optional；可直接填值 · accepts a typed value）
- 输出 · Out：层 · Layer（`layer`，string）
- 设置 · Setting：页面 · Page（`surfaceId`）

### 等待叠加页面 · Wait For Layer

`blueprint.layer.wait` · 会等待，完成后才继续 · Latent: waits before continuing

- 可放在 · Allowed in: 应用逻辑 · App logic、页面逻辑 · Page logic、控件逻辑 · Widget logic、组件内的控件逻辑 · Widget logic inside a component
- 输入 · In：进入 · In（`in`，执行 · exec）
- 输出 · Out：下一步 · Next（`next`，执行 · exec）
- 输入 · In：层 · Layer（`layer`，string）
- 输出 · Out：结果 · Result（`result`，json）
