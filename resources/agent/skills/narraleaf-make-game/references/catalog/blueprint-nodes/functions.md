# 蓝图节点：函数 · Functions

> 本文件由 NarraLeaf Studio 源码自动生成，请勿手动修改。
> Generated from the NarraLeaf Studio source. Do not edit by hand.

「函数 · Functions」分类下的 3 个节点。标题是节点面板里显示的名字（中文 · English）。

The 3 nodes in the "Functions" palette category, titled as the node palette shows them.

### 调用函数 · Call Fn

`blueprint.fn.call` · 会等待，完成后才继续 · Latent: waits before continuing

- 可放在 · Allowed in: 应用逻辑 · App logic、页面逻辑 · Page logic、控件逻辑 · Widget logic、控件取值 · Widget value、组件内的控件逻辑 · Widget logic inside a component、故事动作 · Story action
- 输入 · In：进入 · In（`in`，执行 · exec）
- 输出 · Out：下一步 · Next（`next`，执行 · exec）
- 设置 · Setting：函数 · Function（`fnRef`）

### 函数 · Fn

`blueprint.fn.head` · 函数开头 · Function head

- 可放在 · Allowed in: 应用逻辑 · App logic、页面逻辑 · Page logic、控件逻辑 · Widget logic、组件内的控件逻辑 · Widget logic inside a component、故事动作 · Story action
- 输出 · Out：主体 · Body（`then`，执行 · exec）
- 设置 · Setting：函数名 · Fn Name（`name`）
- 可增加针脚 · Grows pins: 添加参数 · Add parameter

### 函数返回 · Fn Return

`blueprint.fn.return`

- 可放在 · Allowed in: 应用逻辑 · App logic、页面逻辑 · Page logic、控件逻辑 · Widget logic、组件内的控件逻辑 · Widget logic inside a component、故事动作 · Story action
- 输入 · In：进入 · In（`in`，执行 · exec）
- 可增加针脚 · Grows pins: 添加返回值 · Add return value
