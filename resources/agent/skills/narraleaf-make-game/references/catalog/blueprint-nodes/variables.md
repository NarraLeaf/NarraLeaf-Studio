# 蓝图节点：变量 · Variables

> 本文件由 NarraLeaf Studio 源码自动生成，请勿手动修改。
> Generated from the NarraLeaf Studio source. Do not edit by hand.

「变量 · Variables」分类下的 9 个节点。标题是节点面板里显示的名字（中文 · English）。

The 9 nodes in the "Variables" palette category, titled as the node palette shows them.

### 获取持久变量 · Get Persistent

`blueprint.persistent.get` · 会等待，完成后才继续 · Latent: waits before continuing

- 可放在 · Allowed in: 应用逻辑 · App logic、页面逻辑 · Page logic、控件逻辑 · Widget logic、控件取值 · Widget value、组件内的控件逻辑 · Widget logic inside a component、故事动作 · Story action
- 输入 · In：进入 · In（`in`，执行 · exec）
- 输出 · Out：下一步 · Next（`next`，执行 · exec）
- 输出 · Out：值 · Value（`value`，any）
- 设置 · Setting：持久 · Persistent（`persistentVariableId`）

### 获取存档变量 · Get Saved Var

`blueprint.saved.get`

- 可放在 · Allowed in: 应用逻辑 · App logic、页面逻辑 · Page logic、控件逻辑 · Widget logic、控件取值 · Widget value、组件内的控件逻辑 · Widget logic inside a component、故事动作 · Story action
- 输入 · In：进入 · In（`in`，执行 · exec）
- 输出 · Out：下一步 · Next（`next`，执行 · exec）
- 输出 · Out：值 · Value（`value`，any）
- 输出 · Out：已找到 · Found（`found`，boolean）
- 设置 · Setting：存档变量 · Saved variable（`savedVariableId`）

### 获取场景变量 · Get Scene Var

`blueprint.scene.get`

- 可放在 · Allowed in: 故事动作 · Story action
- 输入 · In：进入 · In（`in`，执行 · exec）
- 输出 · Out：下一步 · Next（`next`，执行 · exec）
- 输出 · Out：值 · Value（`value`，any）
- 设置 · Setting：场景变量 · Scene variable（`sceneVariableId`）

### 获取变量 · Get Var

`blueprint.local.get` · 纯数据节点，没有执行针脚 · Pure: no exec pins

- 可放在 · Allowed in: 应用逻辑 · App logic、页面逻辑 · Page logic、控件逻辑 · Widget logic、控件取值 · Widget value、组件内的控件逻辑 · Widget logic inside a component、故事动作 · Story action
- 输出 · Out：值 · Value（`value`，any）
- 设置 · Setting：变量 · Variable（`variableId`）

### 设置持久变量 · Set Persistent

`blueprint.persistent.set` · 会等待，完成后才继续 · Latent: waits before continuing

- 可放在 · Allowed in: 应用逻辑 · App logic、页面逻辑 · Page logic、控件逻辑 · Widget logic、组件内的控件逻辑 · Widget logic inside a component、故事动作 · Story action
- 输入 · In：进入 · In（`in`，执行 · exec）
- 输出 · Out：下一步 · Next（`next`，执行 · exec）
- 输入 · In：值 · Value（`value`，any）
- 设置 · Setting：持久 · Persistent（`persistentVariableId`）

### 设置存档变量 · Set Saved Var

`blueprint.saved.set`

- 可放在 · Allowed in: 应用逻辑 · App logic、页面逻辑 · Page logic、控件逻辑 · Widget logic、组件内的控件逻辑 · Widget logic inside a component、故事动作 · Story action
- 输入 · In：进入 · In（`in`，执行 · exec）
- 输出 · Out：下一步 · Next（`next`，执行 · exec）
- 输入 · In：值 · Value（`value`，any）
- 设置 · Setting：存档变量 · Saved variable（`savedVariableId`）

### 设置场景变量 · Set Scene Var

`blueprint.scene.set`

- 可放在 · Allowed in: 故事动作 · Story action
- 输入 · In：进入 · In（`in`，执行 · exec）
- 输出 · Out：下一步 · Next（`next`，执行 · exec）
- 输入 · In：值 · Value（`value`，any）
- 设置 · Setting：场景变量 · Scene variable（`sceneVariableId`）

### 设置变量 · Set Var

`blueprint.local.set`

- 可放在 · Allowed in: 应用逻辑 · App logic、页面逻辑 · Page logic、控件逻辑 · Widget logic、控件取值 · Widget value、组件内的控件逻辑 · Widget logic inside a component、故事动作 · Story action
- 输入 · In：进入 · In（`in`，执行 · exec）
- 输出 · Out：下一步 · Next（`next`，执行 · exec）
- 输入 · In：值 · Value（`value`，any）
- 设置 · Setting：变量 · Variable（`variableId`）

### 变量 · Var

`blueprint.local.declareVar` · 纯数据节点，没有执行针脚 · Pure: no exec pins

- 可放在 · Allowed in: 应用逻辑 · App logic、页面逻辑 · Page logic、控件逻辑 · Widget logic、组件内的控件逻辑 · Widget logic inside a component、故事动作 · Story action
- 设置 · Setting：名称 · Name（`name`）
- 设置 · Setting：数据类型 · Data type（`valueType`：字符串 · String / 整数 · Integer / 浮点数 · Float / 布尔值 · Boolean / JSON / 数组 · Array / 计时器 · Timer / 动画令牌 · AnimationToken / 任意 · Any）
- 设置 · Setting：默认值 · Default（`defaultValue`）
