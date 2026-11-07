# 蓝图节点：数学 · Math

> 本文件由 NarraLeaf Studio 源码自动生成，请勿手动修改。
> Generated from the NarraLeaf Studio source. Do not edit by hand.

「数学 · Math」分类下的 25 个节点。标题是节点面板里显示的名字（中文 · English）。

The 25 nodes in the "Math" palette category, titled as the node palette shows them.

### +

`blueprint.math.add` · 纯数据节点，没有执行针脚 · Pure: no exec pins

- 可放在 · Allowed in: 应用逻辑 · App logic、页面逻辑 · Page logic、控件逻辑 · Widget logic、控件取值 · Widget value、组件内的控件逻辑 · Widget logic inside a component、故事动作 · Story action
- 输入 · In：A（`a`，float；可直接填值 · accepts a typed value）
- 输入 · In：B（`b`，float；可直接填值 · accepts a typed value）
- 输出 · Out：结果 · Result（`result`，float）
- 可增加针脚 · Grows pins: in

### +1

`blueprint.math.increment` · 纯数据节点，没有执行针脚 · Pure: no exec pins

- 可放在 · Allowed in: 应用逻辑 · App logic、页面逻辑 · Page logic、控件逻辑 · Widget logic、控件取值 · Widget value、组件内的控件逻辑 · Widget logic inside a component、故事动作 · Story action
- 输入 · In：数字 · Number（`value`，float；可直接填值 · accepts a typed value）
- 输出 · Out：结果 · Result（`result`，float）

### ÷

`blueprint.math.divide` · 纯数据节点，没有执行针脚 · Pure: no exec pins

- 可放在 · Allowed in: 应用逻辑 · App logic、页面逻辑 · Page logic、控件逻辑 · Widget logic、控件取值 · Widget value、组件内的控件逻辑 · Widget logic inside a component、故事动作 · Story action
- 输入 · In：A（`a`，float；可直接填值 · accepts a typed value）
- 输入 · In：B（`b`，float；可直接填值 · accepts a typed value）
- 输出 · Out：结果 · Result（`result`，float）

### ×

`blueprint.math.multiply` · 纯数据节点，没有执行针脚 · Pure: no exec pins

- 可放在 · Allowed in: 应用逻辑 · App logic、页面逻辑 · Page logic、控件逻辑 · Widget logic、控件取值 · Widget value、组件内的控件逻辑 · Widget logic inside a component、故事动作 · Story action
- 输入 · In：A（`a`，float；可直接填值 · accepts a typed value）
- 输入 · In：B（`b`，float；可直接填值 · accepts a typed value）
- 输出 · Out：结果 · Result（`result`，float）

### −

`blueprint.math.subtract` · 纯数据节点，没有执行针脚 · Pure: no exec pins

- 可放在 · Allowed in: 应用逻辑 · App logic、页面逻辑 · Page logic、控件逻辑 · Widget logic、控件取值 · Widget value、组件内的控件逻辑 · Widget logic inside a component、故事动作 · Story action
- 输入 · In：A（`a`，float；可直接填值 · accepts a typed value）
- 输入 · In：B（`b`，float；可直接填值 · accepts a typed value）
- 输出 · Out：结果 · Result（`result`，float）

### −1

`blueprint.math.decrement` · 纯数据节点，没有执行针脚 · Pure: no exec pins

- 可放在 · Allowed in: 应用逻辑 · App logic、页面逻辑 · Page logic、控件逻辑 · Widget logic、控件取值 · Widget value、组件内的控件逻辑 · Widget logic inside a component、故事动作 · Story action
- 输入 · In：数字 · Number（`value`，float；可直接填值 · accepts a typed value）
- 输出 · Out：结果 · Result（`result`，float）

### 绝对值 · Abs

`blueprint.math.abs` · 纯数据节点，没有执行针脚 · Pure: no exec pins

- 可放在 · Allowed in: 应用逻辑 · App logic、页面逻辑 · Page logic、控件逻辑 · Widget logic、控件取值 · Widget value、组件内的控件逻辑 · Widget logic inside a component、故事动作 · Story action
- 输入 · In：数字 · Number（`value`，float；可直接填值 · accepts a typed value）
- 输出 · Out：结果 · Result（`result`，float）

### 与 · And

`blueprint.boolean.and` · 纯数据节点，没有执行针脚 · Pure: no exec pins

- 可放在 · Allowed in: 应用逻辑 · App logic、页面逻辑 · Page logic、控件逻辑 · Widget logic、控件取值 · Widget value、组件内的控件逻辑 · Widget logic inside a component、故事动作 · Story action
- 输入 · In：A（`a`，boolean）
- 输入 · In：B（`b`，boolean）
- 输出 · Out：结果 · Result（`result`，boolean）

### 向上取整 · Ceil

`blueprint.math.ceil` · 纯数据节点，没有执行针脚 · Pure: no exec pins

- 可放在 · Allowed in: 应用逻辑 · App logic、页面逻辑 · Page logic、控件逻辑 · Widget logic、控件取值 · Widget value、组件内的控件逻辑 · Widget logic inside a component、故事动作 · Story action
- 输入 · In：数字 · Number（`value`，float；可直接填值 · accepts a typed value）
- 输出 · Out：结果 · Result（`result`，integer）

### 等于 · Equal

`blueprint.compare.equal` · 纯数据节点，没有执行针脚 · Pure: no exec pins

A 与 B 类型相同且值相同时为真。列表与对象比较其中的内容，元素比较是否为同一个元素。数字 1 与文本“1”不相等；未连接的输入视为空值

True when A and B are the same value of the same type. Lists and objects are compared by their contents, an element by which element it is. The number 1 and the text "1" are not equal; an input left unconnected counts as Null.

- 可放在 · Allowed in: 应用逻辑 · App logic、页面逻辑 · Page logic、控件逻辑 · Widget logic、控件取值 · Widget value、组件内的控件逻辑 · Widget logic inside a component、故事动作 · Story action
- 输入 · In：A（`a`，any）
- 输入 · In：B（`b`，any）
- 输出 · Out：结果 · Result（`result`，boolean）

### 向下取整 · Floor

`blueprint.math.floor` · 纯数据节点，没有执行针脚 · Pure: no exec pins

- 可放在 · Allowed in: 应用逻辑 · App logic、页面逻辑 · Page logic、控件逻辑 · Widget logic、控件取值 · Widget value、组件内的控件逻辑 · Widget logic inside a component、故事动作 · Story action
- 输入 · In：数字 · Number（`value`，float；可直接填值 · accepts a typed value）
- 输出 · Out：结果 · Result（`result`，integer）

### 大于 · Greater Than

`blueprint.compare.greaterThan` · 纯数据节点，没有执行针脚 · Pure: no exec pins

A 大于 B 时为真。两边按数字比较；任一边无法读作数字时结果为假

True when A is greater than B. Both sides are compared as numbers; a side that cannot be read as a number gives false.

- 可放在 · Allowed in: 应用逻辑 · App logic、页面逻辑 · Page logic、控件逻辑 · Widget logic、控件取值 · Widget value、组件内的控件逻辑 · Widget logic inside a component、故事动作 · Story action
- 输入 · In：A（`a`，float；可直接填值 · accepts a typed value）
- 输入 · In：B（`b`，float；可直接填值 · accepts a typed value）
- 输出 · Out：结果 · Result（`result`，boolean）

### 大于或等于 · Greater Than Or Equal

`blueprint.compare.greaterThanOrEqual` · 纯数据节点，没有执行针脚 · Pure: no exec pins

A 大于或等于 B 时为真。两边按数字比较；任一边无法读作数字时结果为假

True when A is greater than or equal to B. Both sides are compared as numbers; a side that cannot be read as a number gives false.

- 可放在 · Allowed in: 应用逻辑 · App logic、页面逻辑 · Page logic、控件逻辑 · Widget logic、控件取值 · Widget value、组件内的控件逻辑 · Widget logic inside a component、故事动作 · Story action
- 输入 · In：A（`a`，float；可直接填值 · accepts a typed value）
- 输入 · In：B（`b`，float；可直接填值 · accepts a typed value）
- 输出 · Out：结果 · Result（`result`，boolean）

### 小于 · Less Than

`blueprint.compare.lessThan` · 纯数据节点，没有执行针脚 · Pure: no exec pins

A 小于 B 时为真。两边按数字比较；任一边无法读作数字时结果为假

True when A is less than B. Both sides are compared as numbers; a side that cannot be read as a number gives false.

- 可放在 · Allowed in: 应用逻辑 · App logic、页面逻辑 · Page logic、控件逻辑 · Widget logic、控件取值 · Widget value、组件内的控件逻辑 · Widget logic inside a component、故事动作 · Story action
- 输入 · In：A（`a`，float；可直接填值 · accepts a typed value）
- 输入 · In：B（`b`，float；可直接填值 · accepts a typed value）
- 输出 · Out：结果 · Result（`result`，boolean）

### 小于或等于 · Less Than Or Equal

`blueprint.compare.lessThanOrEqual` · 纯数据节点，没有执行针脚 · Pure: no exec pins

A 小于或等于 B 时为真。两边按数字比较；任一边无法读作数字时结果为假

True when A is less than or equal to B. Both sides are compared as numbers; a side that cannot be read as a number gives false.

- 可放在 · Allowed in: 应用逻辑 · App logic、页面逻辑 · Page logic、控件逻辑 · Widget logic、控件取值 · Widget value、组件内的控件逻辑 · Widget logic inside a component、故事动作 · Story action
- 输入 · In：A（`a`，float；可直接填值 · accepts a typed value）
- 输入 · In：B（`b`，float；可直接填值 · accepts a typed value）
- 输出 · Out：结果 · Result（`result`，boolean）

### 最大值 · Max

`blueprint.math.max` · 纯数据节点，没有执行针脚 · Pure: no exec pins

- 可放在 · Allowed in: 应用逻辑 · App logic、页面逻辑 · Page logic、控件逻辑 · Widget logic、控件取值 · Widget value、组件内的控件逻辑 · Widget logic inside a component、故事动作 · Story action
- 输入 · In：A（`a`，float；可直接填值 · accepts a typed value）
- 输入 · In：B（`b`，float；可直接填值 · accepts a typed value）
- 输出 · Out：结果 · Result（`result`，float）
- 可增加针脚 · Grows pins: in

### 最小值 · Min

`blueprint.math.min` · 纯数据节点，没有执行针脚 · Pure: no exec pins

- 可放在 · Allowed in: 应用逻辑 · App logic、页面逻辑 · Page logic、控件逻辑 · Widget logic、控件取值 · Widget value、组件内的控件逻辑 · Widget logic inside a component、故事动作 · Story action
- 输入 · In：A（`a`，float；可直接填值 · accepts a typed value）
- 输入 · In：B（`b`，float；可直接填值 · accepts a typed value）
- 输出 · Out：结果 · Result（`result`，float）
- 可增加针脚 · Grows pins: in

### 取模 · Modulo

`blueprint.math.modulo` · 纯数据节点，没有执行针脚 · Pure: no exec pins

- 可放在 · Allowed in: 应用逻辑 · App logic、页面逻辑 · Page logic、控件逻辑 · Widget logic、控件取值 · Widget value、组件内的控件逻辑 · Widget logic inside a component、故事动作 · Story action
- 输入 · In：A（`a`，float；可直接填值 · accepts a typed value）
- 输入 · In：B（`b`，float；可直接填值 · accepts a typed value）
- 输出 · Out：结果 · Result（`result`，float）

### 非 · Not

`blueprint.boolean.not` · 纯数据节点，没有执行针脚 · Pure: no exec pins

- 可放在 · Allowed in: 应用逻辑 · App logic、页面逻辑 · Page logic、控件逻辑 · Widget logic、控件取值 · Widget value、组件内的控件逻辑 · Widget logic inside a component、故事动作 · Story action
- 输入 · In：值 · Value（`a`，boolean）
- 输出 · Out：结果 · Result（`result`，boolean）

### 不等于 · Not Equal

`blueprint.compare.notEqual` · 纯数据节点，没有执行针脚 · Pure: no exec pins

A 与 B 的值或类型不同时为真，判断方式与「等于」相同。数字 1 与文本“1”视为不同

True when A and B differ in value or in type, judged as Equal judges them. The number 1 and the text "1" count as different.

- 可放在 · Allowed in: 应用逻辑 · App logic、页面逻辑 · Page logic、控件逻辑 · Widget logic、控件取值 · Widget value、组件内的控件逻辑 · Widget logic inside a component、故事动作 · Story action
- 输入 · In：A（`a`，any）
- 输入 · In：B（`b`，any）
- 输出 · Out：结果 · Result（`result`，boolean）

### 或 · Or

`blueprint.boolean.or` · 纯数据节点，没有执行针脚 · Pure: no exec pins

- 可放在 · Allowed in: 应用逻辑 · App logic、页面逻辑 · Page logic、控件逻辑 · Widget logic、控件取值 · Widget value、组件内的控件逻辑 · Widget logic inside a component、故事动作 · Story action
- 输入 · In：A（`a`，boolean）
- 输入 · In：B（`b`，boolean）
- 输出 · Out：结果 · Result（`result`，boolean）

### 随机浮点数 · Random Float

`blueprint.math.randomFloat` · 纯数据节点，没有执行针脚 · Pure: no exec pins

- 可放在 · Allowed in: 应用逻辑 · App logic、页面逻辑 · Page logic、控件逻辑 · Widget logic、控件取值 · Widget value、组件内的控件逻辑 · Widget logic inside a component、故事动作 · Story action
- 输入 · In：最小值 · Min（`min`，float；可直接填值 · accepts a typed value）
- 输入 · In：最大值 · Max（`max`，float；可直接填值 · accepts a typed value）
- 输出 · Out：结果 · Result（`result`，float）

### 随机整数 · Random Integer

`blueprint.math.randomInteger` · 纯数据节点，没有执行针脚 · Pure: no exec pins

- 可放在 · Allowed in: 应用逻辑 · App logic、页面逻辑 · Page logic、控件逻辑 · Widget logic、控件取值 · Widget value、组件内的控件逻辑 · Widget logic inside a component、故事动作 · Story action
- 输入 · In：最小值 · Min（`min`，integer；可直接填值 · accepts a typed value）
- 输入 · In：最大值 · Max（`max`，integer；可直接填值 · accepts a typed value）
- 输出 · Out：结果 · Result（`result`，integer）

### 四舍五入 · Round

`blueprint.math.round` · 纯数据节点，没有执行针脚 · Pure: no exec pins

- 可放在 · Allowed in: 应用逻辑 · App logic、页面逻辑 · Page logic、控件逻辑 · Widget logic、控件取值 · Widget value、组件内的控件逻辑 · Widget logic inside a component、故事动作 · Story action
- 输入 · In：数字 · Number（`value`，float；可直接填值 · accepts a typed value）
- 输出 · Out：结果 · Result（`result`，integer）

### 异或 · Xor

`blueprint.boolean.xor` · 纯数据节点，没有执行针脚 · Pure: no exec pins

- 可放在 · Allowed in: 应用逻辑 · App logic、页面逻辑 · Page logic、控件逻辑 · Widget logic、控件取值 · Widget value、组件内的控件逻辑 · Widget logic inside a component、故事动作 · Story action
- 输入 · In：A（`a`，boolean）
- 输入 · In：B（`b`，boolean）
- 输出 · Out：结果 · Result（`result`，boolean）
