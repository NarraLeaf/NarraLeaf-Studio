# 蓝图节点：输入 · Input

> 本文件由 NarraLeaf Studio 源码自动生成，请勿手动修改。
> Generated from the NarraLeaf Studio source. Do not edit by hand.

「输入 · Input」分类下的 5 个节点。标题是节点面板里显示的名字（中文 · English）。

The 5 nodes in the "Input" palette category, titled as the node palette shows them.

### 获取手柄轴向 · Get Gamepad Axis

`blueprint.input.getGamepadAxis` · 纯数据节点，没有执行针脚 · Pure: no exec pins

- 可放在 · Allowed in: 应用逻辑 · App logic、页面逻辑 · Page logic、控件逻辑 · Widget logic、组件内的控件逻辑 · Widget logic inside a component、故事动作 · Story action
- 输出 · Out：值 · Value（`value`，float）
- 设置 · Setting：轴向 · Axis（`axis`：LeftX / LeftY / RightX / RightY）

### 获取输入设备 · Get Input Device

`blueprint.input.getDevice` · 纯数据节点，没有执行针脚 · Pure: no exec pins

- 可放在 · Allowed in: 应用逻辑 · App logic、页面逻辑 · Page logic、控件逻辑 · Widget logic、组件内的控件逻辑 · Widget logic inside a component、故事动作 · Story action
- 输出 · Out：设备 · Device（`device`，string）

### 意图是否按住 · Is Action Held

`blueprint.input.isActionHeld` · 纯数据节点，没有执行针脚 · Pure: no exec pins

- 可放在 · Allowed in: 应用逻辑 · App logic、页面逻辑 · Page logic、控件逻辑 · Widget logic、组件内的控件逻辑 · Widget logic inside a component、故事动作 · Story action
- 输出 · Out：按住中 · Held（`held`，boolean）
- 设置 · Setting：意图 · Action（`actionId`）

### 手柄按键是否按住 · Is Gamepad Button Held

`blueprint.input.isGamepadButtonHeld` · 纯数据节点，没有执行针脚 · Pure: no exec pins

- 可放在 · Allowed in: 应用逻辑 · App logic、页面逻辑 · Page logic、控件逻辑 · Widget logic、组件内的控件逻辑 · Widget logic inside a component、故事动作 · Story action
- 输出 · Out：按住中 · Held（`held`，boolean）
- 设置 · Setting：按钮 · Button（`button`：A / B / X / Y / LB / RB / LT / RT / Back / 开始 · Start / L3 / R3 / D-pad Up / D-pad Down / D-pad Left / D-pad Right / Home / Left Stick Up / Left Stick Down / Left Stick Left / Left Stick Right）

### 手柄是否连接 · Is Gamepad Connected

`blueprint.input.isGamepadConnected` · 纯数据节点，没有执行针脚 · Pure: no exec pins

- 可放在 · Allowed in: 应用逻辑 · App logic、页面逻辑 · Page logic、控件逻辑 · Widget logic、组件内的控件逻辑 · Widget logic inside a component、故事动作 · Story action
- 输出 · Out：已连接 · Connected（`connected`，boolean）
