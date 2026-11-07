# 蓝图节点：时间 · Time

> 本文件由 NarraLeaf Studio 源码自动生成，请勿手动修改。
> Generated from the NarraLeaf Studio source. Do not edit by hand.

「时间 · Time」分类下的 15 个节点。标题是节点面板里显示的名字（中文 · English）。

The 15 nodes in the "Time" palette category, titled as the node palette shows them.

### 时间偏移 · Add Time

`blueprint.time.add` · 纯数据节点，没有执行针脚 · Pure: no exec pins

- 可放在 · Allowed in: 应用逻辑 · App logic、页面逻辑 · Page logic、控件逻辑 · Widget logic、控件取值 · Widget value、组件内的控件逻辑 · Widget logic inside a component、故事动作 · Story action
- 输入 · In：时间戳 · Timestamp（`timestamp`，float；可直接填值 · accepts a typed value）
- 输入 · In：数量 · Amount（`amount`，float；可直接填值 · accepts a typed value）
- 输出 · Out：结果 · Result（`result`，float）
- 设置 · Setting：单位 · Unit（`unit`：毫秒 · Milliseconds / 秒 · Seconds / 分钟 · Minutes / 小时 · Hours / 天 · Days / 周 · Weeks / 月 · Months / 年 · Years）

### 格式化时长 · Format Duration

`blueprint.time.formatDuration` · 纯数据节点，没有执行针脚 · Pure: no exec pins

- 可放在 · Allowed in: 应用逻辑 · App logic、页面逻辑 · Page logic、控件逻辑 · Widget logic、控件取值 · Widget value、组件内的控件逻辑 · Widget logic inside a component、故事动作 · Story action
- 输入 · In：毫秒 · Milliseconds（`milliseconds`，float；可直接填值 · accepts a typed value）
- 输出 · Out：结果 · Result（`result`，string）
- 设置 · Setting：排布 · Layout（`style`：自动 · Auto / 时分秒 · Hours Minutes Seconds / 分秒 · Minutes Seconds）

### 格式化相对时间 · Format Relative Time

`blueprint.time.formatRelative` · 纯数据节点，没有执行针脚 · Pure: no exec pins

- 可放在 · Allowed in: 应用逻辑 · App logic、页面逻辑 · Page logic、控件逻辑 · Widget logic、控件取值 · Widget value、组件内的控件逻辑 · Widget logic inside a component、故事动作 · Story action
- 输入 · In：起始 · From（`from`，float；可直接填值 · accepts a typed value）
- 输入 · In：目标 · To（`to`，float；可直接填值 · accepts a typed value）
- 输入 · In：语言 · Locale（`locale`，string；可不连 · optional；可直接填值 · accepts a typed value）
- 输出 · Out：结果 · Result（`result`，string）
- 设置 · Setting：措辞 · Wording（`style`：自动 · Auto / 始终用数字 · Always Numeric）

### 格式化时间 · Format Time

`blueprint.time.format` · 纯数据节点，没有执行针脚 · Pure: no exec pins

- 可放在 · Allowed in: 应用逻辑 · App logic、页面逻辑 · Page logic、控件逻辑 · Widget logic、控件取值 · Widget value、组件内的控件逻辑 · Widget logic inside a component、故事动作 · Story action
- 输入 · In：时间戳 · Timestamp（`timestamp`，float；可直接填值 · accepts a typed value）
- 输入 · In：正则表达式 · Pattern（`pattern`，string；可直接填值 · accepts a typed value）
- 输出 · Out：结果 · Result（`result`，string）

### 按语言格式化时间 · Format Time Localized

`blueprint.time.formatLocalized` · 纯数据节点，没有执行针脚 · Pure: no exec pins

- 可放在 · Allowed in: 应用逻辑 · App logic、页面逻辑 · Page logic、控件逻辑 · Widget logic、控件取值 · Widget value、组件内的控件逻辑 · Widget logic inside a component、故事动作 · Story action
- 输入 · In：时间戳 · Timestamp（`timestamp`，float；可直接填值 · accepts a typed value）
- 输入 · In：语言 · Locale（`locale`，string；可不连 · optional；可直接填值 · accepts a typed value）
- 输出 · Out：结果 · Result（`result`，string）
- 设置 · Setting：日期样式 · Date Style（`dateStyle`：无 · None / 短 · Short / 中 · Medium / 长 · Long / 完整 · Full）
- 设置 · Setting：时间样式 · Time Style（`timeStyle`：无 · None / 短 · Short / 中 · Medium / 长 · Long / 完整 · Full）

### 获取时长分量 · Get Duration Parts

`blueprint.time.durationParts` · 纯数据节点，没有执行针脚 · Pure: no exec pins

- 可放在 · Allowed in: 应用逻辑 · App logic、页面逻辑 · Page logic、控件逻辑 · Widget logic、控件取值 · Widget value、组件内的控件逻辑 · Widget logic inside a component、故事动作 · Story action
- 输入 · In：毫秒 · Milliseconds（`milliseconds`，float；可直接填值 · accepts a typed value）
- 输出 · Out：天 · Days（`days`，integer）
- 输出 · Out：小时 · Hours（`hours`，integer）
- 输出 · Out：分钟 · Minutes（`minutes`，integer）
- 输出 · Out：秒 · Seconds（`seconds`，integer）
- 输出 · Out：剩余毫秒 · Remaining Milliseconds（`remainingMilliseconds`，integer）
- 输出 · Out：总小时数 · Total Hours（`totalHours`，integer）
- 输出 · Out：总分钟数 · Total Minutes（`totalMinutes`，integer）
- 输出 · Out：总秒数 · Total Seconds（`totalSeconds`，integer）
- 输出 · Out：为负 · Negative（`negative`，boolean）

### 获取时间分量 · Get Time Parts

`blueprint.time.parts` · 纯数据节点，没有执行针脚 · Pure: no exec pins

- 可放在 · Allowed in: 应用逻辑 · App logic、页面逻辑 · Page logic、控件逻辑 · Widget logic、控件取值 · Widget value、组件内的控件逻辑 · Widget logic inside a component、故事动作 · Story action
- 输入 · In：时间戳 · Timestamp（`timestamp`，float；可直接填值 · accepts a typed value）
- 输出 · Out：年 · Year（`year`，integer）
- 输出 · Out：月 · Month（`month`，integer）
- 输出 · Out：日 · Day（`day`，integer）
- 输出 · Out：时 · Hour（`hour`，integer）
- 输出 · Out：分 · Minute（`minute`，integer）
- 输出 · Out：秒 · Second（`second`，integer）
- 输出 · Out：毫秒 · Millisecond（`millisecond`，integer）
- 输出 · Out：星期 · Weekday（`weekday`，integer）
- 输出 · Out：年内第几天 · Day Of Year（`dayOfYear`，integer）

### 获取时区 · Get Time Zone

`blueprint.time.zoneOffset` · 纯数据节点，没有执行针脚 · Pure: no exec pins

- 可放在 · Allowed in: 应用逻辑 · App logic、页面逻辑 · Page logic、控件逻辑 · Widget logic、控件取值 · Widget value、组件内的控件逻辑 · Widget logic inside a component、故事动作 · Story action
- 输入 · In：时间戳 · Timestamp（`timestamp`，float；可直接填值 · accepts a typed value）
- 输出 · Out：偏移分钟数 · Offset Minutes（`offsetMinutes`，float）
- 输出 · Out：名称 · Name（`name`，string）

### 是否同一天 · Is Same Day

`blueprint.time.isSameDay` · 纯数据节点，没有执行针脚 · Pure: no exec pins

- 可放在 · Allowed in: 应用逻辑 · App logic、页面逻辑 · Page logic、控件逻辑 · Widget logic、控件取值 · Widget value、组件内的控件逻辑 · Widget logic inside a component、故事动作 · Story action
- 输入 · In：A（`a`，float；可直接填值 · accepts a typed value）
- 输入 · In：B（`b`，float；可直接填值 · accepts a typed value）
- 输出 · Out：结果 · Result（`result`，boolean）

### 构建时间 · Make Time

`blueprint.time.make` · 纯数据节点，没有执行针脚 · Pure: no exec pins

- 可放在 · Allowed in: 应用逻辑 · App logic、页面逻辑 · Page logic、控件逻辑 · Widget logic、控件取值 · Widget value、组件内的控件逻辑 · Widget logic inside a component、故事动作 · Story action
- 输入 · In：年 · Year（`year`，integer；可直接填值 · accepts a typed value）
- 输入 · In：月 · Month（`month`，integer；可直接填值 · accepts a typed value）
- 输入 · In：日 · Day（`day`，integer；可直接填值 · accepts a typed value）
- 输入 · In：时 · Hour（`hour`，integer；可直接填值 · accepts a typed value）
- 输入 · In：分 · Minute（`minute`，integer；可直接填值 · accepts a typed value）
- 输入 · In：秒 · Second（`second`，integer；可直接填值 · accepts a typed value）
- 输入 · In：毫秒 · Millisecond（`millisecond`，integer；可直接填值 · accepts a typed value）
- 输出 · Out：时间戳 · Timestamp（`timestamp`，float）

### 当前时间 · Now

`blueprint.time.now` · 纯数据节点，没有执行针脚 · Pure: no exec pins

- 可放在 · Allowed in: 应用逻辑 · App logic、页面逻辑 · Page logic、控件逻辑 · Widget logic、控件取值 · Widget value、组件内的控件逻辑 · Widget logic inside a component、故事动作 · Story action
- 输出 · Out：时间戳 · Timestamp（`timestamp`，float）

### 解析时间 · Parse Time

`blueprint.time.parse` · 纯数据节点，没有执行针脚 · Pure: no exec pins

- 可放在 · Allowed in: 应用逻辑 · App logic、页面逻辑 · Page logic、控件逻辑 · Widget logic、控件取值 · Widget value、组件内的控件逻辑 · Widget logic inside a component、故事动作 · Story action
- 输入 · In：值 · Value（`value`，string；可直接填值 · accepts a typed value）
- 输出 · Out：时间戳 · Timestamp（`timestamp`，float）
- 输出 · Out：成功 · Ok（`ok`，boolean）

### 当天零点 · Start Of Day

`blueprint.time.startOfDay` · 纯数据节点，没有执行针脚 · Pure: no exec pins

- 可放在 · Allowed in: 应用逻辑 · App logic、页面逻辑 · Page logic、控件逻辑 · Widget logic、控件取值 · Widget value、组件内的控件逻辑 · Widget logic inside a component、故事动作 · Story action
- 输入 · In：时间戳 · Timestamp（`timestamp`，float；可直接填值 · accepts a typed value）
- 输出 · Out：结果 · Result（`result`，float）

### 时间差 · Time Difference

`blueprint.time.difference` · 纯数据节点，没有执行针脚 · Pure: no exec pins

- 可放在 · Allowed in: 应用逻辑 · App logic、页面逻辑 · Page logic、控件逻辑 · Widget logic、控件取值 · Widget value、组件内的控件逻辑 · Widget logic inside a component、故事动作 · Story action
- 输入 · In：起始 · From（`from`，float；可直接填值 · accepts a typed value）
- 输入 · In：目标 · To（`to`，float；可直接填值 · accepts a typed value）
- 输出 · Out：差值 · Difference（`difference`，float）
- 设置 · Setting：单位 · Unit（`unit`：毫秒 · Milliseconds / 秒 · Seconds / 分钟 · Minutes / 小时 · Hours / 天 · Days / 周 · Weeks / 月 · Months / 年 · Years）

### 转为 ISO 字符串 · To ISO String

`blueprint.time.toIsoString` · 纯数据节点，没有执行针脚 · Pure: no exec pins

- 可放在 · Allowed in: 应用逻辑 · App logic、页面逻辑 · Page logic、控件逻辑 · Widget logic、控件取值 · Widget value、组件内的控件逻辑 · Widget logic inside a component、故事动作 · Story action
- 输入 · In：时间戳 · Timestamp（`timestamp`，float；可直接填值 · accepts a typed value）
- 输出 · Out：结果 · Result（`result`，string）
