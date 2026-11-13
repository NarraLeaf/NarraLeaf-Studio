# 蓝图节点：本地化 · Localization

> 本文件由 NarraLeaf Studio 源码自动生成，请勿手动修改。
> Generated from the NarraLeaf Studio source. Do not edit by hand.

「本地化 · Localization」分类下的 6 个节点。标题是节点面板里显示的名字（中文 · English）。

The 6 nodes in the "Localization" palette category, titled as the node palette shows them.

### 获取可用语言 · Get Available Languages

`blueprint.localization.getAvailableLanguages` · 会等待，完成后才继续 · Latent: waits before continuing

- 可放在 · Allowed in: 应用逻辑 · App logic、页面逻辑 · Page logic、控件逻辑 · Widget logic、组件内的控件逻辑 · Widget logic inside a component
- 输入 · In：进入 · In（`in`，执行 · exec）
- 输出 · Out：下一步 · Next（`next`，执行 · exec）
- 输出 · Out：语言列表 · Languages（`value`，array<struct:nl.language>）

### 获取当前语言 · Get Current Language

`blueprint.localization.getCurrentLanguage` · 会等待，完成后才继续 · Latent: waits before continuing

- 可放在 · Allowed in: 应用逻辑 · App logic、页面逻辑 · Page logic、控件逻辑 · Widget logic、组件内的控件逻辑 · Widget logic inside a component
- 输入 · In：进入 · In（`in`，执行 · exec）
- 输出 · Out：下一步 · Next（`next`，执行 · exec）
- 输出 · Out：语言 · Language（`value`，string）

### 获取文本 · Get Text

`blueprint.localization.getText` · 会等待，完成后才继续 · Latent: waits before continuing

获取翻译键在玩家当前语言中的文本；该语言没有译文时获取源文本。不存在的键得到键名本身。「翻译键文本」结果相同，并且可用于蓝图值与函数

Gets a translation key's text in the player's current language, or its source text when that language has no translation. A key that does not exist gives its name. Translation Key Text gives the same text and can also be used in Blueprint Value and functions.

- 可放在 · Allowed in: 应用逻辑 · App logic、页面逻辑 · Page logic、控件逻辑 · Widget logic、组件内的控件逻辑 · Widget logic inside a component
- 输入 · In：进入 · In（`in`，执行 · exec）
- 输出 · Out：下一步 · Next（`next`，执行 · exec）
- 输入 · In：键 · Key（`key`，string）
- 输出 · Out：文本 · Text（`value`，string）
- 设置 · Setting：键 · Key（`key`）

### 是否有文本 · Has Text

`blueprint.localization.hasText` · 会等待，完成后才继续 · Latent: waits before continuing

- 可放在 · Allowed in: 应用逻辑 · App logic、页面逻辑 · Page logic、控件逻辑 · Widget logic、组件内的控件逻辑 · Widget logic inside a component
- 输入 · In：进入 · In（`in`，执行 · exec）
- 输出 · Out：下一步 · Next（`next`，执行 · exec）
- 输入 · In：键 · Key（`key`，string）
- 输出 · Out：存在 · Exists（`value`，boolean）
- 设置 · Setting：键 · Key（`key`）

### 设置语言 · Set Language

`blueprint.localization.setLanguage` · 会等待，完成后才继续 · Latent: waits before continuing

- 可放在 · Allowed in: 应用逻辑 · App logic、页面逻辑 · Page logic、控件逻辑 · Widget logic、组件内的控件逻辑 · Widget logic inside a component
- 输入 · In：进入 · In（`in`，执行 · exec）
- 输出 · Out：下一步 · Next（`next`，执行 · exec）
- 输入 · In：语言 · Language（`language`，string）

### 翻译键文本 · Translation Key Text

`blueprint.localization.keyText` · 纯数据节点，没有执行针脚 · Pure: no exec pins

翻译键在玩家当前语言中的文本；该语言没有译文时为源文本。不存在的键得到键名本身。与「获取文本」结果相同，并且可用于蓝图值与函数。显示它的蓝图值会在玩家切换语言时更新

A translation key's text in the player's current language, or its source text when that language has no translation. A key that does not exist gives its name. The same text as Get Text, and also usable in Blueprint Value and functions. A Blueprint Value that shows it updates when the player changes language.

- 可放在 · Allowed in: 应用逻辑 · App logic、页面逻辑 · Page logic、控件逻辑 · Widget logic、控件取值 · Widget value、组件内的控件逻辑 · Widget logic inside a component
- 输入 · In：键 · Key（`key`，string）
- 输出 · Out：文本 · Text（`value`，string）
- 设置 · Setting：键 · Key（`key`）
