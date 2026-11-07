# 蓝图节点：框架 · Frame

> 本文件由 NarraLeaf Studio 源码自动生成，请勿手动修改。
> Generated from the NarraLeaf Studio source. Do not edit by hand.

「框架 · Frame」分类下的 8 个节点。标题是节点面板里显示的名字（中文 · English）。

The 8 nodes in the "Frame" palette category, titled as the node palette shows them.

### 获取启用状态 · Get Enabled

`blueprint.frame.getEnabled` · 纯数据节点，没有执行针脚 · Pure: no exec pins

- 只用于这些控件的蓝图 · Only on: 页面 · Page
- 可放在 · Allowed in: 控件逻辑 · Widget logic、组件内的控件逻辑 · Widget logic inside a component
- 输出 · Out：已启用 · Enabled（`enabled`，boolean）

### 获取参数 · Get Params

`blueprint.frameWidget.getParams` · 纯数据节点，没有执行针脚 · Pure: no exec pins

- 只用于这些控件的蓝图 · Only on: 页面 · Page
- 可放在 · Allowed in: 控件逻辑 · Widget logic、组件内的控件逻辑 · Widget logic inside a component
- 输出 · Out：参数 · Params（`params`，json）

### 获取目标页面 · Get Target Page

`blueprint.frameWidget.getTargetPage` · 纯数据节点，没有执行针脚 · Pure: no exec pins

- 只用于这些控件的蓝图 · Only on: 页面 · Page
- 可放在 · Allowed in: 控件逻辑 · Widget logic、组件内的控件逻辑 · Widget logic inside a component
- 输出 · Out：页面 · Page（`targetSurfaceId`，string）

### 获取可见性 · Get Visible

`blueprint.frame.getVisible` · 纯数据节点，没有执行针脚 · Pure: no exec pins

- 只用于这些控件的蓝图 · Only on: 页面 · Page
- 可放在 · Allowed in: 控件逻辑 · Widget logic、组件内的控件逻辑 · Widget logic inside a component
- 输出 · Out：可见 · Visible（`visible`，boolean）

### 设置启用状态 · Set Enabled

`blueprint.frame.setEnabled` · 会等待，完成后才继续 · Latent: waits before continuing

- 只用于这些控件的蓝图 · Only on: 页面 · Page
- 可放在 · Allowed in: 控件逻辑 · Widget logic、组件内的控件逻辑 · Widget logic inside a component
- 输入 · In：进入 · In（`in`，执行 · exec）
- 输出 · Out：下一步 · Next（`next`，执行 · exec）
- 输入 · In：已启用 · Enabled（`enabled`，boolean）

### 设置框架页面 · Set Frame Page

`blueprint.frameWidget.setTargetPage` · 会等待，完成后才继续 · Latent: waits before continuing

- 只用于这些控件的蓝图 · Only on: 页面 · Page
- 可放在 · Allowed in: 控件逻辑 · Widget logic、组件内的控件逻辑 · Widget logic inside a component
- 输入 · In：进入 · In（`in`，执行 · exec）
- 输出 · Out：下一步 · Next（`next`，执行 · exec）
- 输入 · In：页面属性 · Page props（`props`，json；可不连 · optional）
- 设置 · Setting：页面 · Page（`targetSurfaceId`）

### 设置参数 · Set Params

`blueprint.frameWidget.setParams` · 会等待，完成后才继续 · Latent: waits before continuing

- 只用于这些控件的蓝图 · Only on: 页面 · Page
- 可放在 · Allowed in: 控件逻辑 · Widget logic、组件内的控件逻辑 · Widget logic inside a component
- 输入 · In：进入 · In（`in`，执行 · exec）
- 输出 · Out：下一步 · Next（`next`，执行 · exec）
- 输入 · In：参数 · Params（`params`，json）

### 设置可见性 · Set Visible

`blueprint.frame.setVisible` · 会等待，完成后才继续 · Latent: waits before continuing

- 只用于这些控件的蓝图 · Only on: 页面 · Page
- 可放在 · Allowed in: 控件逻辑 · Widget logic、组件内的控件逻辑 · Widget logic inside a component
- 输入 · In：进入 · In（`in`，执行 · exec）
- 输出 · Out：下一步 · Next（`next`，执行 · exec）
- 输入 · In：可见 · Visible（`visible`，boolean）
