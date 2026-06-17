# Network 节点

Network 节点用于访问远程数据、在线配置、Web API、补丁公告和云存档等运行时网络能力。本文件为 vNext 规划规格，不表示节点已经注册到当前运行时 catalog。

除非额外声明，所有参数均为传入引脚值；标注（传出引脚）的参数为传出值。`in` 为执行入口，`success`、`httpError`、`networkError`、`timeout` 为执行出口。

vNext 运行时约束：
- Network 节点不直接调用全局 `fetch`，必须通过 Host API `network.fetch` 执行。
- Host API 负责项目网络权限、域名 allowlist、请求超时、响应体大小限制、credentials 默认关闭、Dev Mode 与导出游戏的一致行为，以及调试事件。
- Surface 卸载或 runtime reload 时，必须取消未完成请求，并且不再触发后续执行出口。
- 首版只覆盖文本和 JSON 响应，不包含 streaming、WebSocket、SSE 或大文件下载。

## Fetch

`blueprint.network.fetch` - HTTP 请求（vNext）

向允许的 HTTP 或 HTTPS 地址发送请求。节点会等待请求完成后继续执行：2xx 状态码进入 `success`，非 2xx HTTP 响应进入 `httpError`，网络失败或权限失败进入 `networkError`，超过超时时间进入 `timeout`。

请求方法作为节点配置，默认值为 `GET`。当配置为 `POST`、`PUT`、`PATCH` 等可携带请求体的方法时，`body` 会作为请求体发送。

- `in` - 执行入口
- `url` - 请求 URL
- `headers` - 请求头 JSON
- `body` - 请求体
- `success` - 请求成功且 HTTP 状态码为 2xx 时的执行出口
- `httpError` - 请求完成但 HTTP 状态码不是 2xx 时的执行出口
- `networkError` - 网络失败、权限失败或请求被运行时拒绝时的执行出口
- `timeout` - 请求超时时的执行出口
- `status` - HTTP 状态码（传出引脚）
- `ok` - HTTP 状态码是否为 2xx（传出引脚）
- `responseText` - 响应文本（传出引脚）
- `responseJson` - 解析后的 JSON 响应；解析失败时为 `null`（传出引脚）
- `error` - 错误信息（传出引脚）

`Fetch` 节点是 latent 节点，可用于 `event` 和 `macro` 图，不可用于 `function` 图。
