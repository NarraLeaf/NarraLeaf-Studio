# 蓝图节点：滑块 · Slider

> 本文件由 NarraLeaf Studio 源码自动生成，请勿手动修改。
> Generated from the NarraLeaf Studio source. Do not edit by hand.

「滑块 · Slider」分类下的 9 个节点。标题是节点面板里显示的名字（中文 · English）。

The 9 nodes in the "Slider" palette category, titled as the node palette shows them.

### 获取启用状态 · Get Enabled

`blueprint.slider.getEnabled` · 纯数据节点，没有执行针脚 · Pure: no exec pins

- 只用于这些控件的蓝图 · Only on: 滑块 · Slider
- 可放在 · Allowed in: 控件逻辑 · Widget logic、组件内的控件逻辑 · Widget logic inside a component
- 输出 · Out：已启用 · Enabled（`enabled`，boolean）

### 获取归一化值 · Get Normalized Value

`blueprint.slider.getNormalizedValue` · 纯数据节点，没有执行针脚 · Pure: no exec pins

- 只用于这些控件的蓝图 · Only on: 滑块 · Slider
- 可放在 · Allowed in: 控件逻辑 · Widget logic、组件内的控件逻辑 · Widget logic inside a component
- 输出 · Out：归一化值 · Normalized（`normalizedValue`，float）

### 获取滑块范围 · Get Slider Range

`blueprint.slider.getRange` · 纯数据节点，没有执行针脚 · Pure: no exec pins

- 只用于这些控件的蓝图 · Only on: 滑块 · Slider
- 可放在 · Allowed in: 控件逻辑 · Widget logic、组件内的控件逻辑 · Widget logic inside a component
- 输出 · Out：最小值 · Min（`min`，float）
- 输出 · Out：最大值 · Max（`max`，float）
- 输出 · Out：步长 · Step（`step`，float）

### 获取值 · Get Value

`blueprint.slider.getValue` · 纯数据节点，没有执行针脚 · Pure: no exec pins

- 只用于这些控件的蓝图 · Only on: 滑块 · Slider
- 可放在 · Allowed in: 控件逻辑 · Widget logic、组件内的控件逻辑 · Widget logic inside a component
- 输出 · Out：值 · Value（`value`，float）

### 获取可见性 · Get Visible

`blueprint.slider.getVisible` · 纯数据节点，没有执行针脚 · Pure: no exec pins

- 只用于这些控件的蓝图 · Only on: 滑块 · Slider
- 可放在 · Allowed in: 控件逻辑 · Widget logic、组件内的控件逻辑 · Widget logic inside a component
- 输出 · Out：可见 · Visible（`visible`，boolean）

### 设置启用状态 · Set Enabled

`blueprint.slider.setEnabled` · 会等待，完成后才继续 · Latent: waits before continuing

- 只用于这些控件的蓝图 · Only on: 滑块 · Slider
- 可放在 · Allowed in: 控件逻辑 · Widget logic、组件内的控件逻辑 · Widget logic inside a component
- 输入 · In：进入 · In（`in`，执行 · exec）
- 输出 · Out：下一步 · Next（`next`，执行 · exec）
- 输入 · In：已启用 · Enabled（`enabled`，boolean）

### 设置滑块范围 · Set Slider Range

`blueprint.slider.setRange` · 会等待，完成后才继续 · Latent: waits before continuing

- 只用于这些控件的蓝图 · Only on: 滑块 · Slider
- 可放在 · Allowed in: 控件逻辑 · Widget logic、组件内的控件逻辑 · Widget logic inside a component
- 输入 · In：进入 · In（`in`，执行 · exec）
- 输出 · Out：下一步 · Next（`next`，执行 · exec）
- 输入 · In：最小值 · Min（`min`，float；可直接填值 · accepts a typed value）
- 输入 · In：最大值 · Max（`max`，float；可直接填值 · accepts a typed value）
- 输入 · In：步长 · Step（`step`，float；可直接填值 · accepts a typed value）

### 设置滑块值 · Set Slider Value

`blueprint.slider.setValue` · 会等待，完成后才继续 · Latent: waits before continuing

- 只用于这些控件的蓝图 · Only on: 滑块 · Slider
- 可放在 · Allowed in: 控件逻辑 · Widget logic、组件内的控件逻辑 · Widget logic inside a component
- 输入 · In：进入 · In（`in`，执行 · exec）
- 输出 · Out：下一步 · Next（`next`，执行 · exec）
- 输入 · In：值 · Value（`value`，float；可直接填值 · accepts a typed value）

### 设置可见性 · Set Visible

`blueprint.slider.setVisible` · 会等待，完成后才继续 · Latent: waits before continuing

- 只用于这些控件的蓝图 · Only on: 滑块 · Slider
- 可放在 · Allowed in: 控件逻辑 · Widget logic、组件内的控件逻辑 · Widget logic inside a component
- 输入 · In：进入 · In（`in`，执行 · exec）
- 输出 · Out：下一步 · Next（`next`，执行 · exec）
- 输入 · In：可见 · Visible（`visible`，boolean）
