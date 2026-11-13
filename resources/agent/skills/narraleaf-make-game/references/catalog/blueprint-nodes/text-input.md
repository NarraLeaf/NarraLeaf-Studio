# 蓝图节点：文本输入 · Text Input

> 本文件由 NarraLeaf Studio 源码自动生成，请勿手动修改。
> Generated from the NarraLeaf Studio source. Do not edit by hand.

「文本输入 · Text Input」分类下的 3 个节点。标题是节点面板里显示的名字（中文 · English）。

The 3 nodes in the "Text Input" palette category, titled as the node palette shows them.

### 清空文本 · Clear Text

`blueprint.textInput.clear` · 会等待，完成后才继续 · Latent: waits before continuing

- 只用于这些控件的蓝图 · Only on: 文本输入框 · Text Input
- 可放在 · Allowed in: 控件逻辑 · Widget logic、组件内的控件逻辑 · Widget logic inside a component
- 输入 · In：进入 · In（`in`，执行 · exec）
- 输出 · Out：下一步 · Next（`next`，执行 · exec）

### 获取文本 · Get Text

`blueprint.textInput.getValue` · 纯数据节点，没有执行针脚 · Pure: no exec pins

- 只用于这些控件的蓝图 · Only on: 文本输入框 · Text Input
- 可放在 · Allowed in: 控件逻辑 · Widget logic、组件内的控件逻辑 · Widget logic inside a component
- 输出 · Out：值 · Value（`value`，string）
- 输出 · Out：长度 · Length（`length`，float）

### 设置文本 · Set Text

`blueprint.textInput.setValue` · 会等待，完成后才继续 · Latent: waits before continuing

- 只用于这些控件的蓝图 · Only on: 文本输入框 · Text Input
- 可放在 · Allowed in: 控件逻辑 · Widget logic、组件内的控件逻辑 · Widget logic inside a component
- 输入 · In：进入 · In（`in`，执行 · exec）
- 输出 · Out：下一步 · Next（`next`，执行 · exec）
- 输入 · In：值 · Value（`value`，string；可直接填值 · accepts a typed value）
