# Network 节点

Network 节点用于在游戏运行时访问远程数据，例如在线公告、补丁说明、排行榜。

除非额外声明，所有参数均为传入引脚值；标注（传出引脚）的参数为传出值。

## 前置条件：工程必须允许 HTTP

工程设置里的「允许 HTTP」关闭时，游戏被限制在自身协议内，所有 HTTP 请求都会被取消。此时 Network 节点无法运行，三处会报告这一点：

- 蓝图编辑器：`network/fetch-disallowed` 检查项把节点标为错误。
- 生产构建：构建被拒绝，且该拒绝不受工程检查设置影响。
- 运行时：请求在发出前即被拒绝，节点走 `networkError` 出口。

Web 导出不受该设置约束：Web 构建本身通过 HTTP 提供，没有可施加该限制的机制。构建拒绝仍然适用于 Web 目标。

## 运行时约束

- 请求由主进程发出，不使用渲染进程的 `fetch`。渲染进程的来源是应用协议，直接请求第三方接口会被 CORS 拒绝；超时、响应体上限与协议校验也只有在主进程才能施加。Web 导出没有主进程，使用浏览器自身的 `fetch`，因此**受 CORS 约束**。
- 只接受 `http` 与 `https`。其他协议在发出请求前被拒绝。
- 响应体上限 8 MiB。超出的响应被拒绝而不是截断。
- 不发送 cookie（`credentials: omit`）。
- 首版只覆盖文本与 JSON 响应，不包含 streaming、WebSocket、SSE 或大文件下载。

## Fetch

`blueprint.network.fetch` - 发起请求

向 HTTP 或 HTTPS 地址发送请求。节点等待请求完成后继续执行：2xx 状态码进入 `success`，非 2xx 响应进入 `httpError`，网络失败或权限失败进入 `networkError`，超过超时时间进入 `timeout`。

请求方法作为节点配置，默认值为 `GET`。配置为 `POST`、`PUT`、`PATCH` 时，`Request Body` 作为请求体发送；其他方法忽略该引脚。

- `in` - 执行入口
- `URL` - 请求地址，必须是 http 或 https
- `Headers` - 请求头，JSON 对象。用 `Make JSON Object` 构造
- `Request Body` - 请求体
- `Timeout (s)` - 超时秒数。未设置时为 10 秒，上限 60 秒
- `success` - 状态码为 2xx 时的执行出口
- `httpError` - 请求完成但状态码不是 2xx 时的执行出口
- `networkError` - 网络失败、协议不被允许、响应超出上限，或工程不允许 HTTP 时的执行出口
- `timeout` - 请求超时时的执行出口
- `Response` - 响应句柄，交给读取节点（传出引脚）
- `Status` - HTTP 状态码，没有响应时为 0（传出引脚）
- `Error` - 失败原因，成功时为空（传出引脚）

`httpError` 出口同样带有 `Response`：接口返回 404 时通常在响应体里说明原因。

`Fetch` 是 latent 节点，可用于 `event` 和 `macro` 图，不可用于 `function` 图。

## Response 类型

`Fetch` 的 `Response` 引脚是一个句柄，不是响应内容本身。内容由 `Read Response Text` 或 `Read Response JSON` 读出。

这样拆分有两个作用：没有被读取的响应不必解析；JSON 解析失败可以走独立的执行出口，而不是只能返回一个与「响应本身就是 null」无法区分的 `null`。

**响应在创建它的那一次执行结束时被释放，其他执行链无法访问。** 需要在之后使用的数据，读出后自行存入变量。句柄失效时读取节点会报错。

一次执行最多同时持有 32 个响应。

## Read Response Text

`blueprint.network.readResponseText` - 读取响应文本

把响应读为字符串。

- `in` - 执行入口
- `Response` - 响应句柄
- `next` - 执行出口
- `Text` - 响应文本（传出引脚）

## Read Response JSON

`blueprint.network.readResponseJson` - 读取响应 JSON

把响应解析为 JSON。解析失败时进入 `failed`，例如接口返回了 HTML 错误页。

- `in` - 执行入口
- `Response` - 响应句柄
- `next` - 解析成功时的执行出口
- `failed` - 解析失败时的执行出口
- `Value` - 解析结果（传出引脚）
- `Error` - 解析失败原因，成功时为空（传出引脚）
