# 蓝图节点：网络 · Network

> 本文件由 NarraLeaf Studio 源码自动生成，请勿手动修改。
> Generated from the NarraLeaf Studio source. Do not edit by hand.

「网络 · Network」分类下的 3 个节点。标题是节点面板里显示的名字（中文 · English）。

The 3 nodes in the "Network" palette category, titled as the node palette shows them.

### 发起请求 · Fetch

`blueprint.network.fetch` · 会等待，完成后才继续 · Latent: waits before continuing

- 可放在 · Allowed in: 应用逻辑 · App logic、页面逻辑 · Page logic、控件逻辑 · Widget logic、组件内的控件逻辑 · Widget logic inside a component
- 输入 · In：进入 · In（`in`，执行 · exec）
- 输入 · In：URL（`url`，string；可直接填值 · accepts a typed value）
- 输入 · In：请求头 · Headers（`headers`，json；可不连 · optional）
- 输入 · In：请求体 · Request Body（`body`，string；可不连 · optional；可直接填值 · accepts a typed value）
- 输入 · In：超时（秒） · Timeout (s)（`timeoutSeconds`，float；可不连 · optional；可直接填值 · accepts a typed value）
- 输出 · Out：成功 · Success（`success`，执行 · exec）
- 输出 · Out：HTTP 错误 · HTTP Error（`httpError`，执行 · exec）
- 输出 · Out：网络错误 · Network Error（`networkError`，执行 · exec）
- 输出 · Out：超时 · Timeout（`timeout`，执行 · exec）
- 输出 · Out：响应 · Response（`response`，ResponseBody）
- 输出 · Out：状态码 · Status（`status`，integer）
- 输出 · Out：错误 · Error（`error`，string）
- 设置 · Setting：请求方法 · Method（`networkMethod`：GET / POST / PUT / PATCH / DELETE / HEAD）

### 读取响应 JSON · Read Response JSON

`blueprint.network.readResponseJson`

- 可放在 · Allowed in: 应用逻辑 · App logic、页面逻辑 · Page logic、控件逻辑 · Widget logic、组件内的控件逻辑 · Widget logic inside a component
- 输入 · In：进入 · In（`in`，执行 · exec）
- 输入 · In：响应 · Response（`response`，ResponseBody）
- 输出 · Out：下一步 · Next（`next`，执行 · exec）
- 输出 · Out：失败 · Failed（`failed`，执行 · exec）
- 输出 · Out：值 · Value（`value`，json）
- 输出 · Out：错误 · Error（`error`，string）

### 读取响应文本 · Read Response Text

`blueprint.network.readResponseText`

- 可放在 · Allowed in: 应用逻辑 · App logic、页面逻辑 · Page logic、控件逻辑 · Widget logic、组件内的控件逻辑 · Widget logic inside a component
- 输入 · In：进入 · In（`in`，执行 · exec）
- 输入 · In：响应 · Response（`response`，ResponseBody）
- 输出 · Out：下一步 · Next（`next`，执行 · exec）
- 输出 · Out：文本 · Text（`text`，string）
