# 蓝图节点：流程 · Flow

> 本文件由 NarraLeaf Studio 源码自动生成，请勿手动修改。
> Generated from the NarraLeaf Studio source. Do not edit by hand.

「流程 · Flow」分类下的 13 个节点。标题是节点面板里显示的名字（中文 · English）。

The 13 nodes in the "Flow" palette category, titled as the node palette shows them.

### 延迟 · Delay

`blueprint.flow.delay` · 会等待，完成后才继续 · Latent: waits before continuing

- 可放在 · Allowed in: 应用逻辑 · App logic、页面逻辑 · Page logic、控件逻辑 · Widget logic、组件内的控件逻辑 · Widget logic inside a component、故事动作 · Story action
- 输入 · In：进入 · In（`in`，执行 · exec）
- 输出 · Out：已完成 · Completed（`completed`，执行 · exec）
- 输入 · In：时长（秒） · Duration (s)（`duration`，float；可直接填值 · accepts a typed value）
- 输出 · Out：令牌 · Token（`token`，Timer）

### 遍历 · For Each

`blueprint.flow.forEach`

- 可放在 · Allowed in: 应用逻辑 · App logic、页面逻辑 · Page logic、控件逻辑 · Widget logic、控件取值 · Widget value、组件内的控件逻辑 · Widget logic inside a component、故事动作 · Story action
- 输入 · In：进入 · In（`in`，执行 · exec）
- 输出 · Out：循环 · Loop（`loop`，执行 · exec）
- 输出 · Out：已完成 · Completed（`completed`，执行 · exec）
- 输入 · In：项列表 · Items（`items`，json）
- 输入 · In：最大迭代次数 · Max iterations（`maxIterations`，integer；可直接填值 · accepts a typed value）
- 输出 · Out：项 · Item（`item`，json）
- 输出 · Out：索引 · Index（`index`，integer）

### For 循环 · For Loop

`blueprint.flow.forLoop`

- 可放在 · Allowed in: 应用逻辑 · App logic、页面逻辑 · Page logic、控件逻辑 · Widget logic、控件取值 · Widget value、组件内的控件逻辑 · Widget logic inside a component、故事动作 · Story action
- 输入 · In：进入 · In（`in`，执行 · exec）
- 输出 · Out：循环 · Loop（`loop`，执行 · exec）
- 输出 · Out：已完成 · Completed（`completed`，执行 · exec）
- 输入 · In：开始 · Start（`start`，integer；可直接填值 · accepts a typed value）
- 输入 · In：结束 · End（`end`，integer；可直接填值 · accepts a typed value）
- 输入 · In：步长 · Step（`step`，integer；可直接填值 · accepts a typed value）
- 输入 · In：最大迭代次数 · Max iterations（`maxIterations`，integer；可直接填值 · accepts a typed value）
- 输出 · Out：索引 · Index（`index`，integer）

### 函数入口 · Function entry

`blueprint.function.entry` · 函数入口 · Function entry · 纯数据节点，没有执行针脚 · Pure: no exec pins

- 可放在 · Allowed in: 应用逻辑 · App logic、页面逻辑 · Page logic、控件逻辑 · Widget logic、控件取值 · Widget value、组件内的控件逻辑 · Widget logic inside a component、故事动作 · Story action
- 输入 · In：进入 · In（`in`，执行 · exec）
- 输出 · Out：则 · Then（`then`，执行 · exec）

### 如果 · If

`if`

- 可放在 · Allowed in: 应用逻辑 · App logic、页面逻辑 · Page logic、控件逻辑 · Widget logic、控件取值 · Widget value、组件内的控件逻辑 · Widget logic inside a component、故事动作 · Story action
- 输入 · In：进入 · In（`in`，执行 · exec）
- 输出 · Out：真 · True（`true`，执行 · exec）
- 输出 · Out：假 · False（`false`，执行 · exec）
- 输入 · In：条件 · Condition（`condition`，boolean）

### 如果否则 · If Else

`blueprint.flow.ifElse`

- 可放在 · Allowed in: 应用逻辑 · App logic、页面逻辑 · Page logic、控件逻辑 · Widget logic、控件取值 · Widget value、组件内的控件逻辑 · Widget logic inside a component、故事动作 · Story action
- 输入 · In：进入 · In（`in`，执行 · exec）
- 输出 · Out：则 · Then（`then`，执行 · exec）
- 输出 · Out：否则 · Else（`else`，执行 · exec）
- 输入 · In：条件 · Condition（`condition`，boolean）
- 可增加针脚 · Grows pins: 添加 If 条件 · Add If condition

### 空操作 · Noop

`blueprint.flow.noop`

- 可放在 · Allowed in: 应用逻辑 · App logic、页面逻辑 · Page logic、控件逻辑 · Widget logic、控件取值 · Widget value、组件内的控件逻辑 · Widget logic inside a component、故事动作 · Story action
- 输入 · In：进入 · In（`in`，执行 · exec）
- 输出 · Out：下一步 · Next（`next`，执行 · exec）

### 返回 · Return

`blueprint.flow.return`

在此结束本次执行，之后的节点都不再运行，包括「顺序执行」尚未执行的输出。不交出任何值；需要交出值时用「返回值」，函数中用「函数返回」

Stops the current run here. Nothing after it runs, including the remaining outputs of a Sequence. Gives back no value; to give one back, use Return Value, or Fn Return inside a function.

- 可放在 · Allowed in: 应用逻辑 · App logic、页面逻辑 · Page logic、控件逻辑 · Widget logic、控件取值 · Widget value、组件内的控件逻辑 · Widget logic inside a component、故事动作 · Story action
- 输入 · In：进入 · In（`in`，执行 · exec）

### 返回值 · Return Value

`blueprint.data.returnValue` · 返回值 · Value return

交出该值作为结果，并结束本次执行。用于需要产出值的蓝图，如蓝图值

Gives the value back as the result and ends the run. Used where a blueprint has to produce a value, such as a Blueprint Value.

- 可放在 · Allowed in: 控件取值 · Widget value、故事动作 · Story action
- 输入 · In：进入 · In（`in`，执行 · exec）
- 输入 · In：值 · Value（`value`，any）

### 顺序执行 · Sequence

`blueprint.flow.sequence`

- 可放在 · Allowed in: 应用逻辑 · App logic、页面逻辑 · Page logic、控件逻辑 · Widget logic、控件取值 · Widget value、组件内的控件逻辑 · Widget logic inside a component、故事动作 · Story action
- 输入 · In：进入 · In（`in`，执行 · exec）
- 输出 · Out：则 1 · Then 1（`then0`，执行 · exec）
- 输出 · Out：则 2 · Then 2（`then1`，执行 · exec）
- 输出 · Out：则 3 · Then 3（`then2`，执行 · exec）
- 输出 · Out：则 4 · Then 4（`then3`，执行 · exec）

### 跳过延迟 · Skip Delay

`blueprint.flow.skipDelay`

- 可放在 · Allowed in: 应用逻辑 · App logic、页面逻辑 · Page logic、控件逻辑 · Widget logic、组件内的控件逻辑 · Widget logic inside a component、故事动作 · Story action
- 输入 · In：进入 · In（`in`，执行 · exec）
- 输出 · Out：下一步 · Next（`next`，执行 · exec）
- 输入 · In：计时器 · Timer（`timer`，Timer）

### 字符串分支 · Switch String

`blueprint.flow.switchString`

- 可放在 · Allowed in: 应用逻辑 · App logic、页面逻辑 · Page logic、控件逻辑 · Widget logic、控件取值 · Widget value、组件内的控件逻辑 · Widget logic inside a component、故事动作 · Story action
- 输入 · In：进入 · In（`in`，执行 · exec）
- 输出 · Out：分支 0 · Case 0（`case0`，执行 · exec）
- 输出 · Out：分支 1 · Case 1（`case1`，执行 · exec）
- 输出 · Out：默认值 · Default（`default`，执行 · exec）
- 输入 · In：值 · Value（`value`，string；可直接填值 · accepts a typed value）
- 输入 · In：分支 0 · Case 0（`case0Value`，string；可直接填值 · accepts a typed value）
- 输入 · In：分支 1 · Case 1（`case1Value`，string；可直接填值 · accepts a typed value）
- 可增加针脚 · Grows pins: 添加分支 · Add Case

### While 循环 · While

`blueprint.flow.while`

- 可放在 · Allowed in: 应用逻辑 · App logic、页面逻辑 · Page logic、控件逻辑 · Widget logic、控件取值 · Widget value、组件内的控件逻辑 · Widget logic inside a component、故事动作 · Story action
- 输入 · In：进入 · In（`in`，执行 · exec）
- 输出 · Out：循环 · Loop（`loop`，执行 · exec）
- 输出 · Out：已完成 · Completed（`completed`，执行 · exec）
- 输入 · In：条件 · Condition（`condition`，boolean）
- 输入 · In：最大迭代次数 · Max iterations（`maxIterations`，integer；可直接填值 · accepts a typed value）
