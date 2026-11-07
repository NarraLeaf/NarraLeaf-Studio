# 蓝图节点：数据 · Data

> 本文件由 NarraLeaf Studio 源码自动生成，请勿手动修改。
> Generated from the NarraLeaf Studio source. Do not edit by hand.

「数据 · Data」分类下的 96 个节点。标题是节点面板里显示的名字（中文 · English）。

The 96 nodes in the "Data" palette category, titled as the node palette shows them.

### 数组拼接 · Array Concat

`blueprint.collection.arrayConcat` · 纯数据节点，没有执行针脚 · Pure: no exec pins

- 可放在 · Allowed in: 应用逻辑 · App logic、页面逻辑 · Page logic、控件逻辑 · Widget logic、控件取值 · Widget value、组件内的控件逻辑 · Widget logic inside a component、故事动作 · Story action
- 输入 · In：A（`a`，array）
- 输入 · In：B（`b`，array）
- 输出 · Out：数组 · Array（`result`，array）

### 数组包含 · Array Contains

`blueprint.collection.arrayContains` · 纯数据节点，没有执行针脚 · Pure: no exec pins

- 可放在 · Allowed in: 应用逻辑 · App logic、页面逻辑 · Page logic、控件逻辑 · Widget logic、控件取值 · Widget value、组件内的控件逻辑 · Widget logic inside a component、故事动作 · Story action
- 输入 · In：数组 · Array（`array`，array）
- 输入 · In：项 · Item（`item`，any）
- 输出 · Out：包含 · Contains（`result`，boolean）

### 数组按键筛选 · Array Filter By Key

`blueprint.collection.arrayFilter` · 纯数据节点，没有执行针脚 · Pure: no exec pins

- 可放在 · Allowed in: 应用逻辑 · App logic、页面逻辑 · Page logic、控件逻辑 · Widget logic、控件取值 · Widget value、组件内的控件逻辑 · Widget logic inside a component、故事动作 · Story action
- 输入 · In：数组 · Array（`array`，array）
- 输入 · In：键 · Key（`key`，string；可直接填值 · accepts a typed value）
- 输入 · In：值 · Value（`value`，any）
- 输出 · Out：数组 · Array（`result`，array）

### 数组按键查找 · Array Find By Key

`blueprint.collection.arrayFind` · 纯数据节点，没有执行针脚 · Pure: no exec pins

- 可放在 · Allowed in: 应用逻辑 · App logic、页面逻辑 · Page logic、控件逻辑 · Widget logic、控件取值 · Widget value、组件内的控件逻辑 · Widget logic inside a component、故事动作 · Story action
- 输入 · In：数组 · Array（`array`，array）
- 输入 · In：键 · Key（`key`，string；可直接填值 · accepts a typed value）
- 输入 · In：值 · Value（`value`，any）
- 输出 · Out：项 · Item（`item`，json）
- 输出 · Out：索引 · Index（`index`，integer）

### 数组首项 · Array First

`blueprint.collection.arrayFirst` · 纯数据节点，没有执行针脚 · Pure: no exec pins

- 可放在 · Allowed in: 应用逻辑 · App logic、页面逻辑 · Page logic、控件逻辑 · Widget logic、控件取值 · Widget value、组件内的控件逻辑 · Widget logic inside a component、故事动作 · Story action
- 输入 · In：数组 · Array（`array`，array）
- 输出 · Out：项 · Item（`item`，json）

### 数组取值 · Array Get

`blueprint.collection.arrayGet` · 纯数据节点，没有执行针脚 · Pure: no exec pins

- 可放在 · Allowed in: 应用逻辑 · App logic、页面逻辑 · Page logic、控件逻辑 · Widget logic、控件取值 · Widget value、组件内的控件逻辑 · Widget logic inside a component、故事动作 · Story action
- 输入 · In：数组 · Array（`array`，array）
- 输入 · In：索引 · Index（`index`，integer；可直接填值 · accepts a typed value）
- 输出 · Out：项 · Item（`item`，json）

### 数组查下标 · Array Index Of

`blueprint.collection.arrayIndexOf` · 纯数据节点，没有执行针脚 · Pure: no exec pins

- 可放在 · Allowed in: 应用逻辑 · App logic、页面逻辑 · Page logic、控件逻辑 · Widget logic、控件取值 · Widget value、组件内的控件逻辑 · Widget logic inside a component、故事动作 · Story action
- 输入 · In：数组 · Array（`array`，array）
- 输入 · In：项 · Item（`item`，any）
- 输出 · Out：索引 · Index（`index`，integer）

### 数组插入 · Array Insert

`blueprint.collection.arrayInsert` · 纯数据节点，没有执行针脚 · Pure: no exec pins

- 可放在 · Allowed in: 应用逻辑 · App logic、页面逻辑 · Page logic、控件逻辑 · Widget logic、控件取值 · Widget value、组件内的控件逻辑 · Widget logic inside a component、故事动作 · Story action
- 输入 · In：数组 · Array（`array`，array）
- 输入 · In：索引 · Index（`index`，integer；可直接填值 · accepts a typed value）
- 输入 · In：项 · Item（`item`，any）
- 输出 · Out：数组 · Array（`result`，array）

### 数组是否为空 · Array Is Empty

`blueprint.collection.arrayIsEmpty` · 纯数据节点，没有执行针脚 · Pure: no exec pins

- 可放在 · Allowed in: 应用逻辑 · App logic、页面逻辑 · Page logic、控件逻辑 · Widget logic、控件取值 · Widget value、组件内的控件逻辑 · Widget logic inside a component、故事动作 · Story action
- 输入 · In：数组 · Array（`array`，array）
- 输出 · Out：为空 · Empty（`result`，boolean）

### 数组连接 · Array Join

`blueprint.collection.arrayJoin` · 纯数据节点，没有执行针脚 · Pure: no exec pins

- 可放在 · Allowed in: 应用逻辑 · App logic、页面逻辑 · Page logic、控件逻辑 · Widget logic、控件取值 · Widget value、组件内的控件逻辑 · Widget logic inside a component、故事动作 · Story action
- 输入 · In：数组 · Array（`array`，array）
- 输入 · In：分隔符 · Separator（`separator`，string；可直接填值 · accepts a typed value）
- 输出 · Out：文本 · Text（`result`，string）

### 数组末项 · Array Last

`blueprint.collection.arrayLast` · 纯数据节点，没有执行针脚 · Pure: no exec pins

- 可放在 · Allowed in: 应用逻辑 · App logic、页面逻辑 · Page logic、控件逻辑 · Widget logic、控件取值 · Widget value、组件内的控件逻辑 · Widget logic inside a component、故事动作 · Story action
- 输入 · In：数组 · Array（`array`，array）
- 输出 · Out：项 · Item（`item`，json）

### 数组长度 · Array Length

`blueprint.collection.arrayLength` · 纯数据节点，没有执行针脚 · Pure: no exec pins

- 可放在 · Allowed in: 应用逻辑 · App logic、页面逻辑 · Page logic、控件逻辑 · Widget logic、控件取值 · Widget value、组件内的控件逻辑 · Widget logic inside a component、故事动作 · Story action
- 输入 · In：数组 · Array（`array`，array）
- 输出 · Out：长度 · Length（`length`，integer）

### 数组追加 · Array Push

`blueprint.collection.arrayPush` · 纯数据节点，没有执行针脚 · Pure: no exec pins

- 可放在 · Allowed in: 应用逻辑 · App logic、页面逻辑 · Page logic、控件逻辑 · Widget logic、控件取值 · Widget value、组件内的控件逻辑 · Widget logic inside a component、故事动作 · Story action
- 输入 · In：数组 · Array（`array`，array）
- 输入 · In：项 · Item（`item`，any）
- 输出 · Out：数组 · Array（`result`，array）

### 数组序列 · Array Range

`blueprint.collection.arrayRange` · 纯数据节点，没有执行针脚 · Pure: no exec pins

- 可放在 · Allowed in: 应用逻辑 · App logic、页面逻辑 · Page logic、控件逻辑 · Widget logic、控件取值 · Widget value、组件内的控件逻辑 · Widget logic inside a component、故事动作 · Story action
- 输入 · In：开始 · Start（`start`，integer；可直接填值 · accepts a typed value）
- 输入 · In：数量 · Count（`count`，integer；可直接填值 · accepts a typed value）
- 输入 · In：步长 · Step（`step`，integer；可直接填值 · accepts a typed value）
- 输出 · Out：数组 · Array（`result`，array<integer>）

### 数组移除 · Array Remove

`blueprint.collection.arrayRemove` · 纯数据节点，没有执行针脚 · Pure: no exec pins

- 可放在 · Allowed in: 应用逻辑 · App logic、页面逻辑 · Page logic、控件逻辑 · Widget logic、控件取值 · Widget value、组件内的控件逻辑 · Widget logic inside a component、故事动作 · Story action
- 输入 · In：数组 · Array（`array`，array）
- 输入 · In：项 · Item（`item`，any）
- 输出 · Out：数组 · Array（`result`，array）

### 按索引移除数组项 · Array Remove At

`blueprint.collection.arrayRemoveAt` · 纯数据节点，没有执行针脚 · Pure: no exec pins

- 可放在 · Allowed in: 应用逻辑 · App logic、页面逻辑 · Page logic、控件逻辑 · Widget logic、控件取值 · Widget value、组件内的控件逻辑 · Widget logic inside a component、故事动作 · Story action
- 输入 · In：数组 · Array（`array`，array）
- 输入 · In：索引 · Index（`index`，integer；可直接填值 · accepts a typed value）
- 输出 · Out：数组 · Array（`result`，array）

### 数组反转 · Array Reverse

`blueprint.collection.arrayReverse` · 纯数据节点，没有执行针脚 · Pure: no exec pins

- 可放在 · Allowed in: 应用逻辑 · App logic、页面逻辑 · Page logic、控件逻辑 · Widget logic、控件取值 · Widget value、组件内的控件逻辑 · Widget logic inside a component、故事动作 · Story action
- 输入 · In：数组 · Array（`array`，array）
- 输出 · Out：数组 · Array（`result`，array）

### 数组设值 · Array Set

`blueprint.collection.arraySet` · 纯数据节点，没有执行针脚 · Pure: no exec pins

- 可放在 · Allowed in: 应用逻辑 · App logic、页面逻辑 · Page logic、控件逻辑 · Widget logic、控件取值 · Widget value、组件内的控件逻辑 · Widget logic inside a component、故事动作 · Story action
- 输入 · In：数组 · Array（`array`，array）
- 输入 · In：索引 · Index（`index`，integer；可直接填值 · accepts a typed value）
- 输入 · In：项 · Item（`item`，any）
- 输出 · Out：数组 · Array（`result`，array）

### 数组切片 · Array Slice

`blueprint.collection.arraySlice` · 纯数据节点，没有执行针脚 · Pure: no exec pins

- 可放在 · Allowed in: 应用逻辑 · App logic、页面逻辑 · Page logic、控件逻辑 · Widget logic、控件取值 · Widget value、组件内的控件逻辑 · Widget logic inside a component、故事动作 · Story action
- 输入 · In：数组 · Array（`array`，array）
- 输入 · In：开始 · Start（`start`，integer；可直接填值 · accepts a typed value）
- 输入 · In：结束 · End（`end`，integer；可直接填值 · accepts a typed value）
- 输出 · Out：数组 · Array（`result`，array）

### 数组按键排序 · Array Sort By Key

`blueprint.collection.arraySort` · 纯数据节点，没有执行针脚 · Pure: no exec pins

- 可放在 · Allowed in: 应用逻辑 · App logic、页面逻辑 · Page logic、控件逻辑 · Widget logic、控件取值 · Widget value、组件内的控件逻辑 · Widget logic inside a component、故事动作 · Story action
- 输入 · In：数组 · Array（`array`，array）
- 输入 · In：键 · Key（`key`，string；可直接填值 · accepts a typed value）
- 输入 · In：降序 · Descending（`descending`，boolean；可直接填值 · accepts a typed value）
- 输出 · Out：数组 · Array（`result`，array）

### 数组去重 · Array Unique

`blueprint.collection.arrayUnique` · 纯数据节点，没有执行针脚 · Pure: no exec pins

- 可放在 · Allowed in: 应用逻辑 · App logic、页面逻辑 · Page logic、控件逻辑 · Widget logic、控件取值 · Widget value、组件内的控件逻辑 · Widget logic inside a component、故事动作 · Story action
- 输入 · In：数组 · Array（`array`，array）
- 输出 · Out：数组 · Array（`result`，array）

### 布尔值 · Boolean

`blueprint.data.booleanLiteral` · 常量 · Literal · 纯数据节点，没有执行针脚 · Pure: no exec pins

- 可放在 · Allowed in: 应用逻辑 · App logic、页面逻辑 · Page logic、控件逻辑 · Widget logic、控件取值 · Widget value、组件内的控件逻辑 · Widget logic inside a component、故事动作 · Story action
- 输出 · Out：布尔值 · Boolean（`value`，boolean）
- 设置 · Setting：布尔值 · Boolean（`value`：真 · True / 假 · False）

### 拆分矩形 · Break Rect

`blueprint.data.breakRect` · 纯数据节点，没有执行针脚 · Pure: no exec pins

- 可放在 · Allowed in: 应用逻辑 · App logic、页面逻辑 · Page logic、控件逻辑 · Widget logic、控件取值 · Widget value、组件内的控件逻辑 · Widget logic inside a component、故事动作 · Story action
- 输入 · In：矩形 · Rect（`value`，Rect）
- 输出 · Out：X（`x`，float）
- 输出 · Out：Y（`y`，float）
- 输出 · Out：宽度 · Width（`width`，float）
- 输出 · Out：高度 · Height（`height`，float）

### 拆分二维向量 · Break Vector2D

`blueprint.data.breakVector2d` · 纯数据节点，没有执行针脚 · Pure: no exec pins

- 可放在 · Allowed in: 应用逻辑 · App logic、页面逻辑 · Page logic、控件逻辑 · Widget logic、控件取值 · Widget value、组件内的控件逻辑 · Widget logic inside a component、故事动作 · Story action
- 输入 · In：二维向量 · Vector2D（`value`，Vector2D）
- 输出 · Out：X（`x`，float）
- 输出 · Out：Y（`y`，float）

### 首字母大写 · Capitalize

`blueprint.string.capitalize` · 纯数据节点，没有执行针脚 · Pure: no exec pins

- 可放在 · Allowed in: 应用逻辑 · App logic、页面逻辑 · Page logic、控件逻辑 · Widget logic、控件取值 · Widget value、组件内的控件逻辑 · Widget logic inside a component、故事动作 · Story action
- 输入 · In：值 · Value（`value`，string；可直接填值 · accepts a typed value）
- 输出 · Out：结果 · Result（`result`，string）

### 取字符 · Char At

`blueprint.string.charAt` · 纯数据节点，没有执行针脚 · Pure: no exec pins

- 可放在 · Allowed in: 应用逻辑 · App logic、页面逻辑 · Page logic、控件逻辑 · Widget logic、控件取值 · Widget value、组件内的控件逻辑 · Widget logic inside a component、故事动作 · Story action
- 输入 · In：值 · Value（`value`，string；可直接填值 · accepts a typed value）
- 输入 · In：索引 · Index（`index`，integer；可直接填值 · accepts a typed value）
- 输出 · Out：字符 · Char（`char`，string）

### 克隆 JSON · Clone JSON

`blueprint.data.jsonClone` · 纯数据节点，没有执行针脚 · Pure: no exec pins

- 可放在 · Allowed in: 应用逻辑 · App logic、页面逻辑 · Page logic、控件逻辑 · Widget logic、控件取值 · Widget value、组件内的控件逻辑 · Widget logic inside a component、故事动作 · Story action
- 输入 · In：JSON（`value`，json）
- 输出 · Out：JSON（`result`，json）

### 颜色 · Color

`blueprint.data.colorLiteral` · 常量 · Literal · 纯数据节点，没有执行针脚 · Pure: no exec pins

- 可放在 · Allowed in: 应用逻辑 · App logic、页面逻辑 · Page logic、控件逻辑 · Widget logic、控件取值 · Widget value、组件内的控件逻辑 · Widget logic inside a component、故事动作 · Story action
- 输出 · Out：颜色 · Color（`value`，RGBAColor）
- 设置 · Setting：颜色 · Color（`value`）

### 拼接 · Concat

`blueprint.string.concat` · 纯数据节点，没有执行针脚 · Pure: no exec pins

- 可放在 · Allowed in: 应用逻辑 · App logic、页面逻辑 · Page logic、控件逻辑 · Widget logic、控件取值 · Widget value、组件内的控件逻辑 · Widget logic inside a component、故事动作 · Story action
- 输入 · In：A（`a`，string；可直接填值 · accepts a typed value）
- 输入 · In：B（`b`，string；可直接填值 · accepts a typed value）
- 输出 · Out：结果 · Result（`result`，string）
- 可增加针脚 · Grows pins: in

### 包含 · Contains

`blueprint.string.contains` · 纯数据节点，没有执行针脚 · Pure: no exec pins

- 可放在 · Allowed in: 应用逻辑 · App logic、页面逻辑 · Page logic、控件逻辑 · Widget logic、控件取值 · Widget value、组件内的控件逻辑 · Widget logic inside a component、故事动作 · Story action
- 输入 · In：值 · Value（`value`，string；可直接填值 · accepts a typed value）
- 输入 · In：查找内容 · Search（`search`，string；可直接填值 · accepts a typed value）
- 输出 · Out：结果 · Result（`result`，boolean）

### 数量 · Count

`blueprint.string.count` · 纯数据节点，没有执行针脚 · Pure: no exec pins

- 可放在 · Allowed in: 应用逻辑 · App logic、页面逻辑 · Page logic、控件逻辑 · Widget logic、控件取值 · Widget value、组件内的控件逻辑 · Widget logic inside a component、故事动作 · Story action
- 输入 · In：值 · Value（`value`，string；可直接填值 · accepts a typed value）
- 输入 · In：查找内容 · Search（`search`，string；可直接填值 · accepts a typed value）
- 输出 · Out：数量 · Count（`count`，integer）

### 以…结尾 · Ends With

`blueprint.string.endsWith` · 纯数据节点，没有执行针脚 · Pure: no exec pins

- 可放在 · Allowed in: 应用逻辑 · App logic、页面逻辑 · Page logic、控件逻辑 · Widget logic、控件取值 · Widget value、组件内的控件逻辑 · Widget logic inside a component、故事动作 · Story action
- 输入 · In：值 · Value（`value`，string；可直接填值 · accepts a typed value）
- 输入 · In：查找内容 · Search（`search`，string；可直接填值 · accepts a typed value）
- 输出 · Out：结果 · Result（`result`，boolean）

### 相等 · Equals

`blueprint.string.equals` · 纯数据节点，没有执行针脚 · Pure: no exec pins

- 可放在 · Allowed in: 应用逻辑 · App logic、页面逻辑 · Page logic、控件逻辑 · Widget logic、控件取值 · Widget value、组件内的控件逻辑 · Widget logic inside a component、故事动作 · Story action
- 输入 · In：A（`a`，string；可直接填值 · accepts a typed value）
- 输入 · In：B（`b`，string；可直接填值 · accepts a typed value）
- 输出 · Out：结果 · Result（`result`，boolean）

### 相等（忽略大小写） · Equals Ignore Case

`blueprint.string.equalsIgnoreCase` · 纯数据节点，没有执行针脚 · Pure: no exec pins

- 可放在 · Allowed in: 应用逻辑 · App logic、页面逻辑 · Page logic、控件逻辑 · Widget logic、控件取值 · Widget value、组件内的控件逻辑 · Widget logic inside a component、故事动作 · Story action
- 输入 · In：A（`a`，string；可直接填值 · accepts a typed value）
- 输入 · In：B（`b`，string；可直接填值 · accepts a typed value）
- 输出 · Out：结果 · Result（`result`，boolean）

### 正则提取 · Extract Regex

`blueprint.string.extractRegex` · 纯数据节点，没有执行针脚 · Pure: no exec pins

- 可放在 · Allowed in: 应用逻辑 · App logic、页面逻辑 · Page logic、控件逻辑 · Widget logic、控件取值 · Widget value、组件内的控件逻辑 · Widget logic inside a component、故事动作 · Story action
- 输入 · In：值 · Value（`value`，string；可直接填值 · accepts a typed value）
- 输入 · In：正则表达式 · Pattern（`pattern`，string；可直接填值 · accepts a typed value）
- 输出 · Out：结果 · Result（`result`，string）

### 浮点数 · Float

`blueprint.data.floatLiteral` · 常量 · Literal · 纯数据节点，没有执行针脚 · Pure: no exec pins

- 可放在 · Allowed in: 应用逻辑 · App logic、页面逻辑 · Page logic、控件逻辑 · Widget logic、控件取值 · Widget value、组件内的控件逻辑 · Widget logic inside a component、故事动作 · Story action
- 输出 · Out：浮点数 · Float（`value`，float）
- 设置 · Setting：浮点数 · Float（`value`）

### 格式化 · Format

`blueprint.string.format` · 纯数据节点，没有执行针脚 · Pure: no exec pins

把模板中的占位符替换为值：{0}、{1} 等取数组的各项，{name} 取对象中同名的字段；没有对应值的占位符替换为空。翻译过的模板可取自「翻译键文本」

Replaces the placeholders in Template with values: {0}, {1} and so on with the items of an array, {name} with the field of that name in an object. A placeholder with no value becomes empty. A translated template comes from Translation Key Text.

- 可放在 · Allowed in: 应用逻辑 · App logic、页面逻辑 · Page logic、控件逻辑 · Widget logic、控件取值 · Widget value、组件内的控件逻辑 · Widget logic inside a component、故事动作 · Story action
- 输入 · In：模板 · Template（`template`，string；可直接填值 · accepts a typed value）
- 输入 · In：值列表 · Values（`values`，json）
- 输出 · Out：结果 · Result（`result`，string）

### 获取字段 · Get Field

`blueprint.list.getItemField` · 纯数据节点，没有执行针脚 · Pure: no exec pins

读取连接到「对象」的结构中的一个字段，字段从该结构的字段中选择。在列表行中不连接「对象」时，读取当前行。字段未声明的对象用「获取 JSON 字段」读取

One field of the struct wired into Object, picked from that struct's fields. Inside a list row, leave Object unwired to read the row. Use Get JSON Field for an object whose fields are not declared.

- 可放在 · Allowed in: 应用逻辑 · App logic、页面逻辑 · Page logic、控件逻辑 · Widget logic、控件取值 · Widget value、组件内的控件逻辑 · Widget logic inside a component
- 输入 · In：对象 · Object（`object`，struct:*；可不连 · optional）
- 输出 · Out：值 · Value（`value`，any）
- 设置 · Setting：字段 · Field（`field`）

### 获取 JSON 字段 · Get JSON Field

`blueprint.data.jsonGet` · 纯数据节点，没有执行针脚 · Pure: no exec pins

- 可放在 · Allowed in: 应用逻辑 · App logic、页面逻辑 · Page logic、控件逻辑 · Widget logic、控件取值 · Widget value、组件内的控件逻辑 · Widget logic inside a component、故事动作 · Story action
- 输入 · In：JSON（`json`，json）
- 输入 · In：路径 · Path（`path`，string；可直接填值 · accepts a typed value）
- 输出 · Out：值 · Value（`result`，json）

### 是否有 JSON 字段 · Has JSON Field

`blueprint.data.jsonHas` · 纯数据节点，没有执行针脚 · Pure: no exec pins

- 可放在 · Allowed in: 应用逻辑 · App logic、页面逻辑 · Page logic、控件逻辑 · Widget logic、控件取值 · Widget value、组件内的控件逻辑 · Widget logic inside a component、故事动作 · Story action
- 输入 · In：JSON（`json`，json）
- 输入 · In：路径 · Path（`path`，string；可直接填值 · accepts a typed value）
- 输出 · Out：存在 · Exists（`result`，boolean）

### 查找索引 · Index Of

`blueprint.string.indexOf` · 纯数据节点，没有执行针脚 · Pure: no exec pins

- 可放在 · Allowed in: 应用逻辑 · App logic、页面逻辑 · Page logic、控件逻辑 · Widget logic、控件取值 · Widget value、组件内的控件逻辑 · Widget logic inside a component、故事动作 · Story action
- 输入 · In：值 · Value（`value`，string；可直接填值 · accepts a typed value）
- 输入 · In：查找内容 · Search（`search`，string；可直接填值 · accepts a typed value）
- 输入 · In：开始 · Start（`start`，integer；可直接填值 · accepts a typed value）
- 输出 · Out：索引 · Index（`index`，integer）

### 插入 · Insert

`blueprint.string.insert` · 纯数据节点，没有执行针脚 · Pure: no exec pins

- 可放在 · Allowed in: 应用逻辑 · App logic、页面逻辑 · Page logic、控件逻辑 · Widget logic、控件取值 · Widget value、组件内的控件逻辑 · Widget logic inside a component、故事动作 · Story action
- 输入 · In：值 · Value（`value`，string；可直接填值 · accepts a typed value）
- 输入 · In：索引 · Index（`index`，integer；可直接填值 · accepts a typed value）
- 输入 · In：插入内容 · Insert（`insert`，string；可直接填值 · accepts a typed value）
- 输出 · Out：结果 · Result（`result`，string）

### 整数 · Integer

`blueprint.data.integerLiteral` · 常量 · Literal · 纯数据节点，没有执行针脚 · Pure: no exec pins

- 可放在 · Allowed in: 应用逻辑 · App logic、页面逻辑 · Page logic、控件逻辑 · Widget logic、控件取值 · Widget value、组件内的控件逻辑 · Widget logic inside a component、故事动作 · Story action
- 输出 · Out：整数 · Integer（`value`，integer）
- 设置 · Setting：整数 · Integer（`value`）

### 是否为数组 · Is Array

`blueprint.data.isArray` · 纯数据节点，没有执行针脚 · Pure: no exec pins

- 可放在 · Allowed in: 应用逻辑 · App logic、页面逻辑 · Page logic、控件逻辑 · Widget logic、控件取值 · Widget value、组件内的控件逻辑 · Widget logic inside a component、故事动作 · Story action
- 输入 · In：值 · Value（`value`，any）
- 输出 · Out：结果 · Result（`result`，boolean）

### 是否为空白 · Is Blank

`blueprint.string.isBlank` · 纯数据节点，没有执行针脚 · Pure: no exec pins

- 可放在 · Allowed in: 应用逻辑 · App logic、页面逻辑 · Page logic、控件逻辑 · Widget logic、控件取值 · Widget value、组件内的控件逻辑 · Widget logic inside a component、故事动作 · Story action
- 输入 · In：值 · Value（`value`，string；可直接填值 · accepts a typed value）
- 输出 · Out：结果 · Result（`result`，boolean）

### 是否为布尔值 · Is Boolean

`blueprint.data.isBoolean` · 纯数据节点，没有执行针脚 · Pure: no exec pins

- 可放在 · Allowed in: 应用逻辑 · App logic、页面逻辑 · Page logic、控件逻辑 · Widget logic、控件取值 · Widget value、组件内的控件逻辑 · Widget logic inside a component、故事动作 · Story action
- 输入 · In：值 · Value（`value`，any）
- 输出 · Out：结果 · Result（`result`，boolean）

### 是否为空 · Is Empty

`blueprint.string.isEmpty` · 纯数据节点，没有执行针脚 · Pure: no exec pins

- 可放在 · Allowed in: 应用逻辑 · App logic、页面逻辑 · Page logic、控件逻辑 · Widget logic、控件取值 · Widget value、组件内的控件逻辑 · Widget logic inside a component、故事动作 · Story action
- 输入 · In：值 · Value（`value`，string；可直接填值 · accepts a typed value）
- 输出 · Out：结果 · Result（`result`，boolean）

### 是否为空值 · Is Empty Value

`blueprint.data.isEmptyValue` · 纯数据节点，没有执行针脚 · Pure: no exec pins

- 可放在 · Allowed in: 应用逻辑 · App logic、页面逻辑 · Page logic、控件逻辑 · Widget logic、控件取值 · Widget value、组件内的控件逻辑 · Widget logic inside a component、故事动作 · Story action
- 输入 · In：值 · Value（`value`，any）
- 输出 · Out：结果 · Result（`result`，boolean）

### 是否为 Null · Is Null

`blueprint.data.isNull` · 纯数据节点，没有执行针脚 · Pure: no exec pins

- 可放在 · Allowed in: 应用逻辑 · App logic、页面逻辑 · Page logic、控件逻辑 · Widget logic、控件取值 · Widget value、组件内的控件逻辑 · Widget logic inside a component、故事动作 · Story action
- 输入 · In：值 · Value（`value`，any）
- 输出 · Out：结果 · Result（`result`，boolean）

### 是否为数字 · Is Number

`blueprint.data.isNumber` · 纯数据节点，没有执行针脚 · Pure: no exec pins

- 可放在 · Allowed in: 应用逻辑 · App logic、页面逻辑 · Page logic、控件逻辑 · Widget logic、控件取值 · Widget value、组件内的控件逻辑 · Widget logic inside a component、故事动作 · Story action
- 输入 · In：值 · Value（`value`，any）
- 输出 · Out：结果 · Result（`result`，boolean）

### 是否为对象 · Is Object

`blueprint.data.isObject` · 纯数据节点，没有执行针脚 · Pure: no exec pins

- 可放在 · Allowed in: 应用逻辑 · App logic、页面逻辑 · Page logic、控件逻辑 · Widget logic、控件取值 · Widget value、组件内的控件逻辑 · Widget logic inside a component、故事动作 · Story action
- 输入 · In：值 · Value（`value`，any）
- 输出 · Out：结果 · Result（`result`，boolean）

### 是否为字符串 · Is String

`blueprint.data.isString` · 纯数据节点，没有执行针脚 · Pure: no exec pins

- 可放在 · Allowed in: 应用逻辑 · App logic、页面逻辑 · Page logic、控件逻辑 · Widget logic、控件取值 · Widget value、组件内的控件逻辑 · Widget logic inside a component、故事动作 · Story action
- 输入 · In：值 · Value（`value`，any）
- 输出 · Out：结果 · Result（`result`，boolean）

### 连接 · Join

`blueprint.string.join` · 纯数据节点，没有执行针脚 · Pure: no exec pins

- 可放在 · Allowed in: 应用逻辑 · App logic、页面逻辑 · Page logic、控件逻辑 · Widget logic、控件取值 · Widget value、组件内的控件逻辑 · Widget logic inside a component、故事动作 · Story action
- 输入 · In：值列表 · Values（`values`，json）
- 输入 · In：分隔符 · Separator（`separator`，string；可直接填值 · accepts a typed value）
- 输出 · Out：结果 · Result（`result`，string）

### JSON

`blueprint.data.jsonLiteral` · 常量 · Literal · 纯数据节点，没有执行针脚 · Pure: no exec pins

- 可放在 · Allowed in: 应用逻辑 · App logic、页面逻辑 · Page logic、控件逻辑 · Widget logic、控件取值 · Widget value、组件内的控件逻辑 · Widget logic inside a component、故事动作 · Story action
- 输出 · Out：JSON（`value`，json）
- 设置 · Setting：JSON（`value`）

### 查找最后索引 · Last Index Of

`blueprint.string.lastIndexOf` · 纯数据节点，没有执行针脚 · Pure: no exec pins

- 可放在 · Allowed in: 应用逻辑 · App logic、页面逻辑 · Page logic、控件逻辑 · Widget logic、控件取值 · Widget value、组件内的控件逻辑 · Widget logic inside a component、故事动作 · Story action
- 输入 · In：值 · Value（`value`，string；可直接填值 · accepts a typed value）
- 输入 · In：查找内容 · Search（`search`，string；可直接填值 · accepts a typed value）
- 输出 · Out：索引 · Index（`index`，integer）

### 长度 · Length

`blueprint.string.length` · 纯数据节点，没有执行针脚 · Pure: no exec pins

- 可放在 · Allowed in: 应用逻辑 · App logic、页面逻辑 · Page logic、控件逻辑 · Widget logic、控件取值 · Widget value、组件内的控件逻辑 · Widget logic inside a component、故事动作 · Story action
- 输入 · In：值 · Value（`value`，string；可直接填值 · accepts a typed value）
- 输出 · Out：长度 · Length（`length`，integer）

### 创建数组 · Make Array

`blueprint.data.jsonMakeArray` · 纯数据节点，没有执行针脚 · Pure: no exec pins

- 可放在 · Allowed in: 应用逻辑 · App logic、页面逻辑 · Page logic、控件逻辑 · Widget logic、控件取值 · Widget value、组件内的控件逻辑 · Widget logic inside a component、故事动作 · Story action
- 输出 · Out：数组 · Array（`result`，array）
- 可增加针脚 · Grows pins: item

### 创建对象 · Make Object

`blueprint.data.jsonMakeObject` · 纯数据节点，没有执行针脚 · Pure: no exec pins

- 可放在 · Allowed in: 应用逻辑 · App logic、页面逻辑 · Page logic、控件逻辑 · Widget logic、控件取值 · Widget value、组件内的控件逻辑 · Widget logic inside a component、故事动作 · Story action
- 输出 · Out：对象 · Object（`result`，json）
- 可增加针脚 · Grows pins: field

### 构造矩形 · Make Rect

`blueprint.data.makeRect` · 纯数据节点，没有执行针脚 · Pure: no exec pins

- 可放在 · Allowed in: 应用逻辑 · App logic、页面逻辑 · Page logic、控件逻辑 · Widget logic、控件取值 · Widget value、组件内的控件逻辑 · Widget logic inside a component、故事动作 · Story action
- 输入 · In：X（`x`，float；可直接填值 · accepts a typed value）
- 输入 · In：Y（`y`，float；可直接填值 · accepts a typed value）
- 输入 · In：宽度 · Width（`width`，float；可直接填值 · accepts a typed value）
- 输入 · In：高度 · Height（`height`，float；可直接填值 · accepts a typed value）
- 输出 · Out：矩形 · Rect（`value`，Rect）

### 构造二维向量 · Make Vector2D

`blueprint.data.makeVector2d` · 纯数据节点，没有执行针脚 · Pure: no exec pins

- 可放在 · Allowed in: 应用逻辑 · App logic、页面逻辑 · Page logic、控件逻辑 · Widget logic、控件取值 · Widget value、组件内的控件逻辑 · Widget logic inside a component、故事动作 · Story action
- 输入 · In：X（`x`，float；可直接填值 · accepts a typed value）
- 输入 · In：Y（`y`，float；可直接填值 · accepts a typed value）
- 输出 · Out：二维向量 · Vector2D（`value`，Vector2D）

### 正则匹配 · Matches Regex

`blueprint.string.matchesRegex` · 纯数据节点，没有执行针脚 · Pure: no exec pins

- 可放在 · Allowed in: 应用逻辑 · App logic、页面逻辑 · Page logic、控件逻辑 · Widget logic、控件取值 · Widget value、组件内的控件逻辑 · Widget logic inside a component、故事动作 · Story action
- 输入 · In：值 · Value（`value`，string；可直接填值 · accepts a typed value）
- 输入 · In：正则表达式 · Pattern（`pattern`，string；可直接填值 · accepts a typed value）
- 输出 · Out：结果 · Result（`result`，boolean）

### 暂存 · Memo

`blueprint.data.memo`

- 可放在 · Allowed in: 应用逻辑 · App logic、页面逻辑 · Page logic、控件逻辑 · Widget logic、控件取值 · Widget value、组件内的控件逻辑 · Widget logic inside a component、故事动作 · Story action
- 输入 · In：进入 · In（`in`，执行 · exec）
- 输入 · In：值 · Value（`value`，any）
- 输出 · Out：下一步 · Next（`next`，执行 · exec）
- 输出 · Out：值 · Value（`result`，any）

### 规范化换行符 · Normalize Line Breaks

`blueprint.string.normalizeLineBreaks` · 纯数据节点，没有执行针脚 · Pure: no exec pins

- 可放在 · Allowed in: 应用逻辑 · App logic、页面逻辑 · Page logic、控件逻辑 · Widget logic、控件取值 · Widget value、组件内的控件逻辑 · Widget logic inside a component、故事动作 · Story action
- 输入 · In：值 · Value（`value`，string；可直接填值 · accepts a typed value）
- 输出 · Out：结果 · Result（`result`，string）

### 非 Null · Not Null

`blueprint.data.notNull` · 纯数据节点，没有执行针脚 · Pure: no exec pins

- 可放在 · Allowed in: 应用逻辑 · App logic、页面逻辑 · Page logic、控件逻辑 · Widget logic、控件取值 · Widget value、组件内的控件逻辑 · Widget logic inside a component、故事动作 · Story action
- 输入 · In：值 · Value（`value`，any）
- 输出 · Out：结果 · Result（`result`，boolean）

### Null

`blueprint.data.nullLiteral` · 常量 · Literal · 纯数据节点，没有执行针脚 · Pure: no exec pins

- 可放在 · Allowed in: 应用逻辑 · App logic、页面逻辑 · Page logic、控件逻辑 · Widget logic、控件取值 · Widget value、组件内的控件逻辑 · Widget logic inside a component、故事动作 · Story action
- 输出 · Out：空值 · Null（`value`，json）

### 对象键 · Object Keys

`blueprint.collection.objectKeys` · 纯数据节点，没有执行针脚 · Pure: no exec pins

- 可放在 · Allowed in: 应用逻辑 · App logic、页面逻辑 · Page logic、控件逻辑 · Widget logic、控件取值 · Widget value、组件内的控件逻辑 · Widget logic inside a component、故事动作 · Story action
- 输入 · In：对象 · Object（`object`，json）
- 输出 · Out：键列表 · Keys（`result`，array<string>）

### 对象合并 · Object Merge

`blueprint.collection.objectMerge` · 纯数据节点，没有执行针脚 · Pure: no exec pins

- 可放在 · Allowed in: 应用逻辑 · App logic、页面逻辑 · Page logic、控件逻辑 · Widget logic、控件取值 · Widget value、组件内的控件逻辑 · Widget logic inside a component、故事动作 · Story action
- 输入 · In：A（`a`，json）
- 输入 · In：B（`b`，json）
- 输出 · Out：对象 · Object（`result`，json）

### 对象值 · Object Values

`blueprint.collection.objectValues` · 纯数据节点，没有执行针脚 · Pure: no exec pins

- 可放在 · Allowed in: 应用逻辑 · App logic、页面逻辑 · Page logic、控件逻辑 · Widget logic、控件取值 · Widget value、组件内的控件逻辑 · Widget logic inside a component、故事动作 · Story action
- 输入 · In：对象 · Object（`object`，json）
- 输出 · Out：值列表 · Values（`result`，array）

### 尾部填充 · Pad End

`blueprint.string.padEnd` · 纯数据节点，没有执行针脚 · Pure: no exec pins

- 可放在 · Allowed in: 应用逻辑 · App logic、页面逻辑 · Page logic、控件逻辑 · Widget logic、控件取值 · Widget value、组件内的控件逻辑 · Widget logic inside a component、故事动作 · Story action
- 输入 · In：值 · Value（`value`，string；可直接填值 · accepts a typed value）
- 输入 · In：长度 · Length（`length`，integer；可直接填值 · accepts a typed value）
- 输入 · In：填充字符 · Pad（`pad`，string；可直接填值 · accepts a typed value）
- 输出 · Out：结果 · Result（`result`，string）

### 头部填充 · Pad Start

`blueprint.string.padStart` · 纯数据节点，没有执行针脚 · Pure: no exec pins

- 可放在 · Allowed in: 应用逻辑 · App logic、页面逻辑 · Page logic、控件逻辑 · Widget logic、控件取值 · Widget value、组件内的控件逻辑 · Widget logic inside a component、故事动作 · Story action
- 输入 · In：值 · Value（`value`，string；可直接填值 · accepts a typed value）
- 输入 · In：长度 · Length（`length`，integer；可直接填值 · accepts a typed value）
- 输入 · In：填充字符 · Pad（`pad`，string；可直接填值 · accepts a typed value）
- 输出 · Out：结果 · Result（`result`，string）

### 解析浮点数 · Parse Float

`blueprint.data.parseFloat` · 纯数据节点，没有执行针脚 · Pure: no exec pins

- 可放在 · Allowed in: 应用逻辑 · App logic、页面逻辑 · Page logic、控件逻辑 · Widget logic、控件取值 · Widget value、组件内的控件逻辑 · Widget logic inside a component、故事动作 · Story action
- 输入 · In：文本 · Text（`value`，string；可直接填值 · accepts a typed value）
- 输出 · Out：浮点数 · Float（`result`，float）

### 解析整数 · Parse Int

`blueprint.data.parseInt` · 纯数据节点，没有执行针脚 · Pure: no exec pins

- 可放在 · Allowed in: 应用逻辑 · App logic、页面逻辑 · Page logic、控件逻辑 · Widget logic、控件取值 · Widget value、组件内的控件逻辑 · Widget logic inside a component、故事动作 · Story action
- 输入 · In：文本 · Text（`value`，string；可直接填值 · accepts a typed value）
- 输出 · Out：整数 · Integer（`result`，integer）

### 解析 JSON · Parse JSON

`blueprint.data.parseJson` · 纯数据节点，没有执行针脚 · Pure: no exec pins

- 可放在 · Allowed in: 应用逻辑 · App logic、页面逻辑 · Page logic、控件逻辑 · Widget logic、控件取值 · Widget value、组件内的控件逻辑 · Widget logic inside a component、故事动作 · Story action
- 输入 · In：文本 · Text（`value`，string；可直接填值 · accepts a typed value）
- 输出 · Out：JSON（`result`，json）

### 矩形 · Rect

`blueprint.data.rectLiteral` · 常量 · Literal · 纯数据节点，没有执行针脚 · Pure: no exec pins

- 可放在 · Allowed in: 应用逻辑 · App logic、页面逻辑 · Page logic、控件逻辑 · Widget logic、控件取值 · Widget value、组件内的控件逻辑 · Widget logic inside a component、故事动作 · Story action
- 输出 · Out：矩形 · Rect（`value`，Rect）
- 设置 · Setting：矩形 · Rect（`value`）

### 矩形中心 · Rect Center

`blueprint.data.rectCenter` · 纯数据节点，没有执行针脚 · Pure: no exec pins

- 可放在 · Allowed in: 应用逻辑 · App logic、页面逻辑 · Page logic、控件逻辑 · Widget logic、控件取值 · Widget value、组件内的控件逻辑 · Widget logic inside a component、故事动作 · Story action
- 输入 · In：矩形 · Rect（`value`，Rect）
- 输出 · Out：中心 · Center（`center`，Vector2D）

### 移除 JSON 字段 · Remove JSON Field

`blueprint.data.jsonRemove` · 纯数据节点，没有执行针脚 · Pure: no exec pins

- 可放在 · Allowed in: 应用逻辑 · App logic、页面逻辑 · Page logic、控件逻辑 · Widget logic、控件取值 · Widget value、组件内的控件逻辑 · Widget logic inside a component、故事动作 · Story action
- 输入 · In：JSON（`json`，json）
- 输入 · In：路径 · Path（`path`，string；可直接填值 · accepts a typed value）
- 输出 · Out：JSON（`result`，json）

### 重复 · Repeat

`blueprint.string.repeat` · 纯数据节点，没有执行针脚 · Pure: no exec pins

- 可放在 · Allowed in: 应用逻辑 · App logic、页面逻辑 · Page logic、控件逻辑 · Widget logic、控件取值 · Widget value、组件内的控件逻辑 · Widget logic inside a component、故事动作 · Story action
- 输入 · In：值 · Value（`value`，string；可直接填值 · accepts a typed value）
- 输入 · In：数量 · Count（`count`，integer；可直接填值 · accepts a typed value）
- 输出 · Out：结果 · Result（`result`，string）

### 替换 · Replace

`blueprint.string.replace` · 纯数据节点，没有执行针脚 · Pure: no exec pins

- 可放在 · Allowed in: 应用逻辑 · App logic、页面逻辑 · Page logic、控件逻辑 · Widget logic、控件取值 · Widget value、组件内的控件逻辑 · Widget logic inside a component、故事动作 · Story action
- 输入 · In：值 · Value（`value`，string；可直接填值 · accepts a typed value）
- 输入 · In：查找内容 · Search（`search`，string；可直接填值 · accepts a typed value）
- 输入 · In：替换内容 · Replacement（`replacement`，string；可直接填值 · accepts a typed value）
- 输出 · Out：结果 · Result（`result`，string）

### 全部替换 · Replace All

`blueprint.string.replaceAll` · 纯数据节点，没有执行针脚 · Pure: no exec pins

- 可放在 · Allowed in: 应用逻辑 · App logic、页面逻辑 · Page logic、控件逻辑 · Widget logic、控件取值 · Widget value、组件内的控件逻辑 · Widget logic inside a component、故事动作 · Story action
- 输入 · In：值 · Value（`value`，string；可直接填值 · accepts a typed value）
- 输入 · In：查找内容 · Search（`search`，string；可直接填值 · accepts a typed value）
- 输入 · In：替换内容 · Replacement（`replacement`，string；可直接填值 · accepts a typed value）
- 输出 · Out：结果 · Result（`result`，string）

### 设置 JSON 字段 · Set JSON Field

`blueprint.data.jsonSet` · 纯数据节点，没有执行针脚 · Pure: no exec pins

- 可放在 · Allowed in: 应用逻辑 · App logic、页面逻辑 · Page logic、控件逻辑 · Widget logic、控件取值 · Widget value、组件内的控件逻辑 · Widget logic inside a component、故事动作 · Story action
- 输入 · In：JSON（`json`，json）
- 输入 · In：路径 · Path（`path`，string；可直接填值 · accepts a typed value）
- 输入 · In：值 · Value（`value`，any）
- 输出 · Out：JSON（`result`，json）

### 分割 · Split

`blueprint.string.split` · 纯数据节点，没有执行针脚 · Pure: no exec pins

- 可放在 · Allowed in: 应用逻辑 · App logic、页面逻辑 · Page logic、控件逻辑 · Widget logic、控件取值 · Widget value、组件内的控件逻辑 · Widget logic inside a component、故事动作 · Story action
- 输入 · In：值 · Value（`value`，string；可直接填值 · accepts a typed value）
- 输入 · In：分隔符 · Separator（`separator`，string；可直接填值 · accepts a typed value）
- 输出 · Out：结果 · Result（`result`，array<string>）

### 以…开头 · Starts With

`blueprint.string.startsWith` · 纯数据节点，没有执行针脚 · Pure: no exec pins

- 可放在 · Allowed in: 应用逻辑 · App logic、页面逻辑 · Page logic、控件逻辑 · Widget logic、控件取值 · Widget value、组件内的控件逻辑 · Widget logic inside a component、故事动作 · Story action
- 输入 · In：值 · Value（`value`，string；可直接填值 · accepts a typed value）
- 输入 · In：查找内容 · Search（`search`，string；可直接填值 · accepts a typed value）
- 输出 · Out：结果 · Result（`result`，boolean）

### 字符串 · String

`blueprint.data.stringLiteral` · 常量 · Literal · 纯数据节点，没有执行针脚 · Pure: no exec pins

- 可放在 · Allowed in: 应用逻辑 · App logic、页面逻辑 · Page logic、控件逻辑 · Widget logic、控件取值 · Widget value、组件内的控件逻辑 · Widget logic inside a component、故事动作 · Story action
- 输出 · Out：字符串 · String（`value`，string）
- 设置 · Setting：字符串 · String（`value`）

### 序列化 JSON · Stringify JSON

`blueprint.data.stringifyJson` · 纯数据节点，没有执行针脚 · Pure: no exec pins

- 可放在 · Allowed in: 应用逻辑 · App logic、页面逻辑 · Page logic、控件逻辑 · Widget logic、控件取值 · Widget value、组件内的控件逻辑 · Widget logic inside a component、故事动作 · Story action
- 输入 · In：JSON（`value`，json）
- 输出 · Out：文本 · Text（`result`，string）

### 子字符串 · Substring

`blueprint.string.substring` · 纯数据节点，没有执行针脚 · Pure: no exec pins

- 可放在 · Allowed in: 应用逻辑 · App logic、页面逻辑 · Page logic、控件逻辑 · Widget logic、控件取值 · Widget value、组件内的控件逻辑 · Widget logic inside a component、故事动作 · Story action
- 输入 · In：值 · Value（`value`，string；可直接填值 · accepts a typed value）
- 输入 · In：开始 · Start（`start`，integer；可直接填值 · accepts a typed value）
- 输入 · In：长度 · Length（`length`，integer；可直接填值 · accepts a typed value）
- 输出 · Out：结果 · Result（`result`，string）

### 转为布尔值 · To Boolean

`blueprint.data.toBoolean` · 纯数据节点，没有执行针脚 · Pure: no exec pins

- 可放在 · Allowed in: 应用逻辑 · App logic、页面逻辑 · Page logic、控件逻辑 · Widget logic、控件取值 · Widget value、组件内的控件逻辑 · Widget logic inside a component、故事动作 · Story action
- 输入 · In：值 · Value（`value`，any）
- 输出 · Out：布尔值 · Boolean（`result`，boolean）

### 转为浮点数 · To Float

`blueprint.data.toFloat` · 纯数据节点，没有执行针脚 · Pure: no exec pins

- 可放在 · Allowed in: 应用逻辑 · App logic、页面逻辑 · Page logic、控件逻辑 · Widget logic、控件取值 · Widget value、组件内的控件逻辑 · Widget logic inside a component、故事动作 · Story action
- 输入 · In：值 · Value（`value`，any）
- 输出 · Out：浮点数 · Float（`result`，float）

### 转为整数 · To Integer

`blueprint.data.toInteger` · 纯数据节点，没有执行针脚 · Pure: no exec pins

- 可放在 · Allowed in: 应用逻辑 · App logic、页面逻辑 · Page logic、控件逻辑 · Widget logic、控件取值 · Widget value、组件内的控件逻辑 · Widget logic inside a component、故事动作 · Story action
- 输入 · In：值 · Value（`value`，any）
- 输出 · Out：整数 · Integer（`result`，integer）

### 转为 JSON · To JSON

`blueprint.data.toJson` · 纯数据节点，没有执行针脚 · Pure: no exec pins

- 可放在 · Allowed in: 应用逻辑 · App logic、页面逻辑 · Page logic、控件逻辑 · Widget logic、控件取值 · Widget value、组件内的控件逻辑 · Widget logic inside a component、故事动作 · Story action
- 输入 · In：值 · Value（`value`，any）
- 输出 · Out：JSON（`result`，json）

### 转为小写 · To Lower Case

`blueprint.string.toLowerCase` · 纯数据节点，没有执行针脚 · Pure: no exec pins

- 可放在 · Allowed in: 应用逻辑 · App logic、页面逻辑 · Page logic、控件逻辑 · Widget logic、控件取值 · Widget value、组件内的控件逻辑 · Widget logic inside a component、故事动作 · Story action
- 输入 · In：值 · Value（`value`，string；可直接填值 · accepts a typed value）
- 输出 · Out：结果 · Result（`result`，string）

### 转为字符串 · To String

`blueprint.string.toString` · 纯数据节点，没有执行针脚 · Pure: no exec pins

- 可放在 · Allowed in: 应用逻辑 · App logic、页面逻辑 · Page logic、控件逻辑 · Widget logic、控件取值 · Widget value、组件内的控件逻辑 · Widget logic inside a component、故事动作 · Story action
- 输入 · In：值 · Value（`value`，any）
- 输出 · Out：结果 · Result（`result`，string）

### 转为大写 · To Upper Case

`blueprint.string.toUpperCase` · 纯数据节点，没有执行针脚 · Pure: no exec pins

- 可放在 · Allowed in: 应用逻辑 · App logic、页面逻辑 · Page logic、控件逻辑 · Widget logic、控件取值 · Widget value、组件内的控件逻辑 · Widget logic inside a component、故事动作 · Story action
- 输入 · In：值 · Value（`value`，string；可直接填值 · accepts a typed value）
- 输出 · Out：结果 · Result（`result`，string）

### 去除首尾空白 · Trim

`blueprint.string.trim` · 纯数据节点，没有执行针脚 · Pure: no exec pins

- 可放在 · Allowed in: 应用逻辑 · App logic、页面逻辑 · Page logic、控件逻辑 · Widget logic、控件取值 · Widget value、组件内的控件逻辑 · Widget logic inside a component、故事动作 · Story action
- 输入 · In：值 · Value（`value`，string；可直接填值 · accepts a typed value）
- 输出 · Out：结果 · Result（`result`，string）

### 去除尾部空白 · Trim End

`blueprint.string.trimEnd` · 纯数据节点，没有执行针脚 · Pure: no exec pins

- 可放在 · Allowed in: 应用逻辑 · App logic、页面逻辑 · Page logic、控件逻辑 · Widget logic、控件取值 · Widget value、组件内的控件逻辑 · Widget logic inside a component、故事动作 · Story action
- 输入 · In：值 · Value（`value`，string；可直接填值 · accepts a typed value）
- 输出 · Out：结果 · Result（`result`，string）

### 去除首部空白 · Trim Start

`blueprint.string.trimStart` · 纯数据节点，没有执行针脚 · Pure: no exec pins

- 可放在 · Allowed in: 应用逻辑 · App logic、页面逻辑 · Page logic、控件逻辑 · Widget logic、控件取值 · Widget value、组件内的控件逻辑 · Widget logic inside a component、故事动作 · Story action
- 输入 · In：值 · Value（`value`，string；可直接填值 · accepts a typed value）
- 输出 · Out：结果 · Result（`result`，string）

### 二维向量 · Vector2D

`blueprint.data.vector2dLiteral` · 常量 · Literal · 纯数据节点，没有执行针脚 · Pure: no exec pins

- 可放在 · Allowed in: 应用逻辑 · App logic、页面逻辑 · Page logic、控件逻辑 · Widget logic、控件取值 · Widget value、组件内的控件逻辑 · Widget logic inside a component、故事动作 · Story action
- 输出 · Out：二维向量 · Vector2D（`value`，Vector2D）
- 设置 · Setting：二维向量 · Vector2D（`value`）
