# 蓝图节点：列表 · List

> 本文件由 NarraLeaf Studio 源码自动生成，请勿手动修改。
> Generated from the NarraLeaf Studio source. Do not edit by hand.

「列表 · List」分类下的 32 个节点。标题是节点面板里显示的名字（中文 · English）。

The 32 nodes in the "List" palette category, titled as the node palette shows them.

### 追加列表项 · Append List Item

`blueprint.list.appendItem` · 会等待，完成后才继续 · Latent: waits before continuing

- 只用于这些控件的蓝图 · Only on: 列表 · List、通知列表 · Notification List、选项列表 · Choice List、NVL 列表 · NVL List
- 可放在 · Allowed in: 控件逻辑 · Widget logic、组件内的控件逻辑 · Widget logic inside a component
- 输入 · In：进入 · In（`in`，执行 · exec）
- 输出 · Out：下一步 · Next（`next`，执行 · exec）
- 输入 · In：项 · Item（`item`，any）

### 清空列表 · Clear List

`blueprint.list.clear` · 会等待，完成后才继续 · Latent: waits before continuing

- 只用于这些控件的蓝图 · Only on: 列表 · List、通知列表 · Notification List、选项列表 · Choice List、NVL 列表 · NVL List
- 可放在 · Allowed in: 控件逻辑 · Widget logic、组件内的控件逻辑 · Widget logic inside a component
- 输入 · In：进入 · In（`in`，执行 · exec）
- 输出 · Out：下一步 · Next（`next`，执行 · exec）

### 按字段查找条目 · Find Item By Field

`blueprint.list.findItemByField` · 纯数据节点，没有执行针脚 · Pure: no exec pins

- 只用于这些控件的蓝图 · Only on: 列表 · List、通知列表 · Notification List、选项列表 · Choice List、NVL 列表 · NVL List
- 可放在 · Allowed in: 控件逻辑 · Widget logic、组件内的控件逻辑 · Widget logic inside a component
- 输入 · In：值 · Value（`value`，any）
- 输出 · Out：索引 · Index（`index`，integer）
- 输出 · Out：项 · Item（`item`，json）
- 输出 · Out：已找到 · Found（`found`，boolean）
- 设置 · Setting：字段 · Field（`field`）

### 获取启用状态 · Get Enabled

`blueprint.list.getEnabled` · 纯数据节点，没有执行针脚 · Pure: no exec pins

- 只用于这些控件的蓝图 · Only on: 列表 · List
- 可放在 · Allowed in: 控件逻辑 · Widget logic、组件内的控件逻辑 · Widget logic inside a component
- 输出 · Out：已启用 · Enabled（`enabled`，boolean）

### 取指定条目 · Get Item At

`blueprint.list.getItemAt` · 纯数据节点，没有执行针脚 · Pure: no exec pins

- 只用于这些控件的蓝图 · Only on: 列表 · List、通知列表 · Notification List、选项列表 · Choice List、NVL 列表 · NVL List
- 可放在 · Allowed in: 控件逻辑 · Widget logic、组件内的控件逻辑 · Widget logic inside a component
- 输入 · In：索引 · Index（`index`，integer；可直接填值 · accepts a typed value）
- 输出 · Out：项 · Item（`item`，json）

### 获取列表内容 · Get List Content

`blueprint.list.getItems` · 纯数据节点，没有执行针脚 · Pure: no exec pins

- 只用于这些控件的蓝图 · Only on: 列表 · List、通知列表 · Notification List、选项列表 · Choice List、NVL 列表 · NVL List
- 可放在 · Allowed in: 控件逻辑 · Widget logic、组件内的控件逻辑 · Widget logic inside a component
- 输出 · Out：项列表 · Items（`items`，array）

### 获取列表项数量 · Get List Item Count

`blueprint.list.getItemCount` · 纯数据节点，没有执行针脚 · Pure: no exec pins

- 可放在 · Allowed in: 控件逻辑 · Widget logic、控件取值 · Widget value、组件内的控件逻辑 · Widget logic inside a component
- 只能用在列表项里 · Only inside a list item
- 输出 · Out：数量 · Count（`count`，integer）

### 获取列表项索引 · Get List Item Index

`blueprint.list.getItemIndex` · 纯数据节点，没有执行针脚 · Pure: no exec pins

- 可放在 · Allowed in: 控件逻辑 · Widget logic、控件取值 · Widget value、组件内的控件逻辑 · Widget logic inside a component
- 只能用在列表项里 · Only inside a list item
- 输出 · Out：索引 · Index（`index`，integer）

### 获取列表项键 · Get List Item Key

`blueprint.list.getItemKey` · 纯数据节点，没有执行针脚 · Pure: no exec pins

- 可放在 · Allowed in: 控件逻辑 · Widget logic、控件取值 · Widget value、组件内的控件逻辑 · Widget logic inside a component
- 只能用在列表项里 · Only inside a list item
- 输出 · Out：键 · Key（`key`，string）

### 获取列表项属性 · Get List Item Props

`blueprint.list.getItemProps` · 纯数据节点，没有执行针脚 · Pure: no exec pins

- 可放在 · Allowed in: 控件逻辑 · Widget logic、控件取值 · Widget value、组件内的控件逻辑 · Widget logic inside a component
- 只能用在列表项里 · Only inside a list item
- 输出 · Out：属性 · Props（`props`，json）

### 获取列表长度 · Get List Length

`blueprint.list.getLength` · 纯数据节点，没有执行针脚 · Pure: no exec pins

- 只用于这些控件的蓝图 · Only on: 列表 · List、通知列表 · Notification List、选项列表 · Choice List、NVL 列表 · NVL List
- 可放在 · Allowed in: 控件逻辑 · Widget logic、组件内的控件逻辑 · Widget logic inside a component
- 输出 · Out：长度 · Length（`length`，integer）

### 获取滚动位置 · Get Scroll Offset

`blueprint.list.getScrollOffset` · 纯数据节点，没有执行针脚 · Pure: no exec pins

- 只用于这些控件的蓝图 · Only on: 列表 · List、通知列表 · Notification List、选项列表 · Choice List、NVL 列表 · NVL List
- 可放在 · Allowed in: 控件逻辑 · Widget logic、组件内的控件逻辑 · Widget logic inside a component
- 输出 · Out：偏移 · Offset（`offset`，float）
- 输出 · Out：最大偏移 · Max Offset（`maxOffset`，float）

### 获取滚动进度 · Get Scroll Progress

`blueprint.list.getScrollProgress` · 纯数据节点，没有执行针脚 · Pure: no exec pins

- 只用于这些控件的蓝图 · Only on: 列表 · List、通知列表 · Notification List、选项列表 · Choice List、NVL 列表 · NVL List
- 可放在 · Allowed in: 控件逻辑 · Widget logic、组件内的控件逻辑 · Widget logic inside a component
- 输出 · Out：进度 · Progress（`progress`，float）

### 获取选中索引 · Get Selected Index

`blueprint.list.getSelectedIndex` · 纯数据节点，没有执行针脚 · Pure: no exec pins

- 只用于这些控件的蓝图 · Only on: 列表 · List、通知列表 · Notification List、选项列表 · Choice List、NVL 列表 · NVL List
- 可放在 · Allowed in: 控件逻辑 · Widget logic、组件内的控件逻辑 · Widget logic inside a component
- 输出 · Out：索引 · Index（`index`，integer）

### 获取选中项 · Get Selected Item

`blueprint.list.getSelectedItem` · 纯数据节点，没有执行针脚 · Pure: no exec pins

- 只用于这些控件的蓝图 · Only on: 列表 · List、通知列表 · Notification List、选项列表 · Choice List、NVL 列表 · NVL List
- 可放在 · Allowed in: 控件逻辑 · Widget logic、组件内的控件逻辑 · Widget logic inside a component
- 输出 · Out：项 · Item（`item`，json）

### 获取可见性 · Get Visible

`blueprint.list.getVisible` · 纯数据节点，没有执行针脚 · Pure: no exec pins

- 只用于这些控件的蓝图 · Only on: 列表 · List
- 可放在 · Allowed in: 控件逻辑 · Widget logic、组件内的控件逻辑 · Widget logic inside a component
- 输出 · Out：可见 · Visible（`visible`，boolean）

### 插入列表项 · Insert List Item

`blueprint.list.insertItem` · 会等待，完成后才继续 · Latent: waits before continuing

- 只用于这些控件的蓝图 · Only on: 列表 · List、通知列表 · Notification List、选项列表 · Choice List、NVL 列表 · NVL List
- 可放在 · Allowed in: 控件逻辑 · Widget logic、组件内的控件逻辑 · Widget logic inside a component
- 输入 · In：进入 · In（`in`，执行 · exec）
- 输出 · Out：下一步 · Next（`next`，执行 · exec）
- 输入 · In：索引 · Index（`index`，integer；可直接填值 · accepts a typed value）
- 输入 · In：项 · Item（`item`，any）

### 是否已到末尾 · Is Scrolled To End

`blueprint.list.isScrolledToEnd` · 纯数据节点，没有执行针脚 · Pure: no exec pins

- 只用于这些控件的蓝图 · Only on: 列表 · List、通知列表 · Notification List、选项列表 · Choice List、NVL 列表 · NVL List
- 可放在 · Allowed in: 控件逻辑 · Widget logic、组件内的控件逻辑 · Widget logic inside a component
- 输出 · Out：已到末尾 · At End（`atEnd`，boolean）

### 是否已到开头 · Is Scrolled To Start

`blueprint.list.isScrolledToStart` · 纯数据节点，没有执行针脚 · Pure: no exec pins

- 只用于这些控件的蓝图 · Only on: 列表 · List、通知列表 · Notification List、选项列表 · Choice List、NVL 列表 · NVL List
- 可放在 · Allowed in: 控件逻辑 · Widget logic、组件内的控件逻辑 · Widget logic inside a component
- 输出 · Out：已到开头 · At Start（`atStart`，boolean）

### 刷新列表项 · Refresh List Items

`blueprint.list.refreshItems` · 会等待，完成后才继续 · Latent: waits before continuing

- 只用于这些控件的蓝图 · Only on: 列表 · List、通知列表 · Notification List、选项列表 · Choice List、NVL 列表 · NVL List
- 可放在 · Allowed in: 控件逻辑 · Widget logic、组件内的控件逻辑 · Widget logic inside a component
- 输入 · In：进入 · In（`in`，执行 · exec）
- 输出 · Out：下一步 · Next（`next`，执行 · exec）

### 移除列表项 · Remove List Item

`blueprint.list.removeItem` · 会等待，完成后才继续 · Latent: waits before continuing

- 只用于这些控件的蓝图 · Only on: 列表 · List、通知列表 · Notification List、选项列表 · Choice List、NVL 列表 · NVL List
- 可放在 · Allowed in: 控件逻辑 · Widget logic、组件内的控件逻辑 · Widget logic inside a component
- 输入 · In：进入 · In（`in`，执行 · exec）
- 输出 · Out：下一步 · Next（`next`，执行 · exec）
- 输入 · In：项 · Item（`item`，any）

### 按索引移除列表项 · Remove List Item At

`blueprint.list.removeItemAt` · 会等待，完成后才继续 · Latent: waits before continuing

- 只用于这些控件的蓝图 · Only on: 列表 · List、通知列表 · Notification List、选项列表 · Choice List、NVL 列表 · NVL List
- 可放在 · Allowed in: 控件逻辑 · Widget logic、组件内的控件逻辑 · Widget logic inside a component
- 输入 · In：进入 · In（`in`，执行 · exec）
- 输出 · Out：下一步 · Next（`next`，执行 · exec）
- 输入 · In：索引 · Index（`index`，integer；可直接填值 · accepts a typed value）

### 滚动到底部 · Scroll To Bottom

`blueprint.list.scrollToBottom` · 会等待，完成后才继续 · Latent: waits before continuing

- 只用于这些控件的蓝图 · Only on: 列表 · List、通知列表 · Notification List、选项列表 · Choice List、NVL 列表 · NVL List
- 可放在 · Allowed in: 控件逻辑 · Widget logic、组件内的控件逻辑 · Widget logic inside a component
- 输入 · In：进入 · In（`in`，执行 · exec）
- 输出 · Out：下一步 · Next（`next`，执行 · exec）

### 滚动到索引 · Scroll To Index

`blueprint.list.scrollToIndex` · 会等待，完成后才继续 · Latent: waits before continuing

- 只用于这些控件的蓝图 · Only on: 列表 · List、通知列表 · Notification List、选项列表 · Choice List、NVL 列表 · NVL List
- 可放在 · Allowed in: 控件逻辑 · Widget logic、组件内的控件逻辑 · Widget logic inside a component
- 输入 · In：进入 · In（`in`，执行 · exec）
- 输出 · Out：下一步 · Next（`next`，执行 · exec）
- 输入 · In：索引 · Index（`index`，integer；可直接填值 · accepts a typed value）

### 滚动到顶部 · Scroll To Top

`blueprint.list.scrollToTop` · 会等待，完成后才继续 · Latent: waits before continuing

- 只用于这些控件的蓝图 · Only on: 列表 · List、通知列表 · Notification List、选项列表 · Choice List、NVL 列表 · NVL List
- 可放在 · Allowed in: 控件逻辑 · Widget logic、组件内的控件逻辑 · Widget logic inside a component
- 输入 · In：进入 · In（`in`，执行 · exec）
- 输出 · Out：下一步 · Next（`next`，执行 · exec）

### 设置启用状态 · Set Enabled

`blueprint.list.setEnabled` · 会等待，完成后才继续 · Latent: waits before continuing

- 只用于这些控件的蓝图 · Only on: 列表 · List
- 可放在 · Allowed in: 控件逻辑 · Widget logic、组件内的控件逻辑 · Widget logic inside a component
- 输入 · In：进入 · In（`in`，执行 · exec）
- 输出 · Out：下一步 · Next（`next`，执行 · exec）
- 输入 · In：已启用 · Enabled（`enabled`，boolean）

### 设置条目字段 · Set Item Field At

`blueprint.list.setItemFieldAt` · 会等待，完成后才继续 · Latent: waits before continuing

- 只用于这些控件的蓝图 · Only on: 列表 · List、通知列表 · Notification List、选项列表 · Choice List、NVL 列表 · NVL List
- 可放在 · Allowed in: 控件逻辑 · Widget logic、组件内的控件逻辑 · Widget logic inside a component
- 输入 · In：进入 · In（`in`，执行 · exec）
- 输出 · Out：下一步 · Next（`next`，执行 · exec）
- 输入 · In：索引 · Index（`index`，integer；可直接填值 · accepts a typed value）
- 输入 · In：值 · Value（`value`，any）
- 设置 · Setting：字段 · Field（`field`）

### 设置列表内容 · Set List Content

`blueprint.list.setItems` · 会等待，完成后才继续 · Latent: waits before continuing

- 只用于这些控件的蓝图 · Only on: 列表 · List、通知列表 · Notification List、选项列表 · Choice List、NVL 列表 · NVL List
- 可放在 · Allowed in: 控件逻辑 · Widget logic、组件内的控件逻辑 · Widget logic inside a component
- 输入 · In：进入 · In（`in`，执行 · exec）
- 输出 · Out：下一步 · Next（`next`，执行 · exec）
- 输入 · In：项列表 · Items（`items`，array）

### 设置选中索引 · Set Selected Index

`blueprint.list.setSelectedIndex` · 会等待，完成后才继续 · Latent: waits before continuing

- 只用于这些控件的蓝图 · Only on: 列表 · List、通知列表 · Notification List、选项列表 · Choice List、NVL 列表 · NVL List
- 可放在 · Allowed in: 控件逻辑 · Widget logic、组件内的控件逻辑 · Widget logic inside a component
- 输入 · In：进入 · In（`in`，执行 · exec）
- 输出 · Out：下一步 · Next（`next`，执行 · exec）
- 输入 · In：索引 · Index（`index`，integer；可直接填值 · accepts a typed value）

### 设置选中项 · Set Selected Item

`blueprint.list.setSelectedItem` · 会等待，完成后才继续 · Latent: waits before continuing

- 只用于这些控件的蓝图 · Only on: 列表 · List、通知列表 · Notification List、选项列表 · Choice List、NVL 列表 · NVL List
- 可放在 · Allowed in: 控件逻辑 · Widget logic、组件内的控件逻辑 · Widget logic inside a component
- 输入 · In：进入 · In（`in`，执行 · exec）
- 输出 · Out：下一步 · Next（`next`，执行 · exec）
- 输入 · In：项 · Item（`item`，any）

### 设置可见性 · Set Visible

`blueprint.list.setVisible` · 会等待，完成后才继续 · Latent: waits before continuing

- 只用于这些控件的蓝图 · Only on: 列表 · List
- 可放在 · Allowed in: 控件逻辑 · Widget logic、组件内的控件逻辑 · Widget logic inside a component
- 输入 · In：进入 · In（`in`，执行 · exec）
- 输出 · Out：下一步 · Next（`next`，执行 · exec）
- 输入 · In：可见 · Visible（`visible`，boolean）

### 按字段排序列表 · Sort List By Field

`blueprint.list.sortByField` · 会等待，完成后才继续 · Latent: waits before continuing

- 只用于这些控件的蓝图 · Only on: 列表 · List、通知列表 · Notification List、选项列表 · Choice List、NVL 列表 · NVL List
- 可放在 · Allowed in: 控件逻辑 · Widget logic、组件内的控件逻辑 · Widget logic inside a component
- 输入 · In：进入 · In（`in`，执行 · exec）
- 输出 · Out：下一步 · Next（`next`，执行 · exec）
- 设置 · Setting：字段 · Field（`field`）
- 设置 · Setting：顺序 · Direction（`direction`：升序 · Ascending / 降序 · Descending）
