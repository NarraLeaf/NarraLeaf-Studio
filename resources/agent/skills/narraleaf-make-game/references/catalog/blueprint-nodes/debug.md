# 蓝图节点：调试 · Debug

> 本文件由 NarraLeaf Studio 源码自动生成，请勿手动修改。
> Generated from the NarraLeaf Studio source. Do not edit by hand.

「调试 · Debug」分类下的 2 个节点。标题是节点面板里显示的名字（中文 · English）。

The 2 nodes in the "Debug" palette category, titled as the node palette shows them.

### 注释 · Comment

`blueprint.flow.comment` · 注释 · Comment · 纯数据节点，没有执行针脚 · Pure: no exec pins

- 可放在 · Allowed in: 应用逻辑 · App logic、页面逻辑 · Page logic、控件逻辑 · Widget logic、控件取值 · Widget value、组件内的控件逻辑 · Widget logic inside a component、故事动作 · Story action

### 日志 · Log

`blueprint.log`

- 可放在 · Allowed in: 应用逻辑 · App logic、页面逻辑 · Page logic、控件逻辑 · Widget logic、组件内的控件逻辑 · Widget logic inside a component、故事动作 · Story action
- 输入 · In：进入 · In（`in`，执行 · exec）
- 输出 · Out：下一步 · Next（`next`，执行 · exec）
- 输入 · In：值 · Value（`value`，string；可直接填值 · accepts a typed value）
- 可增加针脚 · Grows pins: 添加值 · Add value
