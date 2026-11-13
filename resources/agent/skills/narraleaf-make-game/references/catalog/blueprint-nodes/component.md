# 蓝图节点：组件 · Component

> 本文件由 NarraLeaf Studio 源码自动生成，请勿手动修改。
> Generated from the NarraLeaf Studio source. Do not edit by hand.

「组件 · Component」分类下的 1 个节点。标题是节点面板里显示的名字（中文 · English）。

The 1 nodes in the "Component" palette category, titled as the node palette shows them.

### 获取组件参数 · Get Component Param

`blueprint.component.getParam` · 纯数据节点，没有执行针脚 · Pure: no exec pins

当前放置处为所选参数设置的值；未设置时为参数的默认值。使用翻译键的「文字」参数得到键名，其文字由「翻译键文本」取得

The value this placement sets for the chosen parameter, or the parameter's default when it sets none. A Text parameter that reads from a translation key gives the key's name; Translation Key Text gives its words.

- 可放在 · Allowed in: 组件内的控件逻辑 · Widget logic inside a component
- 输出 · Out：值 · Value（`value`，string）
- 设置 · Setting：参数 · Parameter（`paramId`）
