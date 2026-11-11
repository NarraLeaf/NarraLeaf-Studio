# 蓝图节点：按钮 · Button

> 本文件由 NarraLeaf Studio 源码自动生成，请勿手动修改。
> Generated from the NarraLeaf Studio source. Do not edit by hand.

「按钮 · Button」分类下的 7 个节点。标题是节点面板里显示的名字（中文 · English）。

The 7 nodes in the "Button" palette category, titled as the node palette shows them.

### 获取启用状态 · Get Enabled

`blueprint.button.getEnabled` · 纯数据节点，没有执行针脚 · Pure: no exec pins

- 只用于这些控件的蓝图 · Only on: 按钮 · Button
- 可放在 · Allowed in: 控件逻辑 · Widget logic、组件内的控件逻辑 · Widget logic inside a component
- 输出 · Out：已启用 · Enabled（`enabled`，boolean）

### 获取标签 · Get Label

`blueprint.button.getLabel` · 纯数据节点，没有执行针脚 · Pure: no exec pins

- 只用于这些控件的蓝图 · Only on: 按钮 · Button
- 可放在 · Allowed in: 控件逻辑 · Widget logic、组件内的控件逻辑 · Widget logic inside a component
- 输出 · Out：标签 · Label（`label`，string）

### 获取可见性 · Get Visible

`blueprint.button.getVisible` · 纯数据节点，没有执行针脚 · Pure: no exec pins

- 只用于这些控件的蓝图 · Only on: 按钮 · Button
- 可放在 · Allowed in: 控件逻辑 · Widget logic、组件内的控件逻辑 · Widget logic inside a component
- 输出 · Out：可见 · Visible（`visible`，boolean）

### 设置启用状态 · Set Enabled

`blueprint.button.setEnabled` · 会等待，完成后才继续 · Latent: waits before continuing

- 只用于这些控件的蓝图 · Only on: 按钮 · Button
- 可放在 · Allowed in: 控件逻辑 · Widget logic、组件内的控件逻辑 · Widget logic inside a component
- 输入 · In：进入 · In（`in`，执行 · exec）
- 输出 · Out：下一步 · Next（`next`，执行 · exec）
- 输入 · In：已启用 · Enabled（`enabled`，boolean）

### 设置标签 · Set Label

`blueprint.button.setLabel` · 会等待，完成后才继续 · Latent: waits before continuing

- 只用于这些控件的蓝图 · Only on: 按钮 · Button
- 可放在 · Allowed in: 控件逻辑 · Widget logic、组件内的控件逻辑 · Widget logic inside a component
- 输入 · In：进入 · In（`in`，执行 · exec）
- 输出 · Out：下一步 · Next（`next`，执行 · exec）
- 输入 · In：标签 · Label（`label`，string；可直接填值 · accepts a typed value）

### 设置指针 · Set Pointer

`blueprint.button.setPointer` · 会等待，完成后才继续 · Latent: waits before continuing

- 只用于这些控件的蓝图 · Only on: 按钮 · Button
- 可放在 · Allowed in: 控件逻辑 · Widget logic、组件内的控件逻辑 · Widget logic inside a component
- 输入 · In：进入 · In（`in`，执行 · exec）
- 输出 · Out：下一步 · Next（`next`，执行 · exec）
- 设置 · Setting：指针 · Pointer（`cursor`）

### 设置可见性 · Set Visible

`blueprint.button.setVisible` · 会等待，完成后才继续 · Latent: waits before continuing

- 只用于这些控件的蓝图 · Only on: 按钮 · Button
- 可放在 · Allowed in: 控件逻辑 · Widget logic、组件内的控件逻辑 · Widget logic inside a component
- 输入 · In：进入 · In（`in`，执行 · exec）
- 输出 · Out：下一步 · Next（`next`，执行 · exec）
- 输入 · In：可见 · Visible（`visible`，boolean）
