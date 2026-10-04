# Localization 节点

Localization 节点读写玩家的游戏语言、按翻译键取文本，创建浮窗中归入 Localization 分类。这里说的语言是玩家玩游戏用的语言（本地化面板里配置的那些），不是 Studio 的界面语言。

除 `Translation Key Text` 外，本页节点都是 latent 节点：带执行引脚，只能用于 `event` / `macro` 图，不能用于 Blueprint Value 和 `function` 图。`Translation Key Text` 是纯节点，三种图和 Blueprint Value 都可以用。

本页节点都需要游戏的 Host API，所以不出现在故事行的蓝图里。

除非额外声明，所有参数均为传入引脚值；标注（传出引脚）的参数为传出值。

## 翻译键的文本

`Get Text` 与 `Translation Key Text` 对同一个键给出同一个结果：

1. 键在当前语言里有译文，就是译文；当前语言没有时沿该语言的回退语言链找；
2. 都没有，就是键的源文本；
3. 项目里没有这个键，就是键名本身，缺陷在游戏里直接看得见。

项目没有设置源语言时，构建里不带键也不带译文，于是每个键都按第 3 条显示键名。

## Translation Key Text

`blueprint.localization.keyText` - 翻译键文本

`Get Text` 的纯节点版本：不带执行引脚，结果在被读取时计算。它是 Blueprint Value 与 `function` 图里取译文的方式，一个绑定了 Blueprint Value 的文本由此能显示「3 秒」/「3 s」这类随语言变化的字。

- `key` - 翻译键名；不连线时取卡片上的下拉框所选的键
- `value` - `string`（传出引脚），按上节规则得到的文本；没有选键时为空字符串

在 Blueprint Value 中读取它（直接读取，或经被调用的 Fn 读取），会把玩家的语言记为该绑定读过的状态：玩家切换语言后，绑定立即重新求值，与使用翻译键的文本在同一帧换成新语言。在标题画面切换语言不会重启游戏，所以这一点决定了绑定的文字会不会停在旧语言。

把数字等值填进译文，用 `Format`：模板接 `Translation Key Text`，值接 `Make Array`（`{0}`、`{1}`…）或 `Make Object`（`{name}`）。例如键 `settings.seconds` 的源文本是 `{0} s`、中文译文是 `{0} 秒`：

```
Translation Key Text(settings.seconds) → Format.template
Integer 3 → Make Array.item → Format.values
Format.result → Return Value
```

英文显示 `3 s`，中文显示 `3 秒`。

## Get Text

`blueprint.localization.getText` - 获取文本

按翻译键取文本，结果规则见「翻译键的文本」。

- `key` - 翻译键名；不连线时取卡片上的下拉框所选的键。为空时本次执行报错停止
- `value` - `string`（传出引脚），键的文本

在 Blueprint Value 调用的 Fn 里执行时，同样把玩家的语言记为该绑定读过的状态。

## Has Text

`blueprint.localization.hasText` - 是否有文本

判断项目的本地化里是否有这个翻译键。项目没有设置源语言时总为假。

- `key` - 翻译键名
- `value` - `boolean`（传出引脚），键是否存在

## Get Current Language

`blueprint.localization.getCurrentLanguage` - 获取当前语言

读取玩家当前的游戏语言代码：玩家选过的语言，没有选过时为源语言。

- `value` - `string`（传出引脚），语言代码，如 `zh-CN`

在 Blueprint Value 调用的 Fn 里执行时，把玩家的语言记为该绑定读过的状态。

## Set Language

`blueprint.localization.setLanguage` - 设置语言

切换玩家的游戏语言并保存。在游戏进行中切换时，按项目 ▸ 游戏 ▸ 语言的设置重启并回到原处、重启回到启动画面，或在下次启动时生效；不在游戏中（标题画面、从标题打开的设置页）时只切换语言，界面上的文字立即换成新语言。

- `language` - 语言代码，必须是项目配置过的语言之一，否则本次执行报错停止

项目没有配置任何语言时执行会报错。

## Get Available Languages

`blueprint.localization.getAvailableLanguages` - 获取可用语言

列出项目配置的全部语言，可用作设置页语言选择器的数据来源。

- `value` - `any`（传出引脚），数组，每项为 `{ code, displayName, isSource }`

## Format Text

`blueprint.localization.formatText` - 格式化文本

已不在创建浮窗中提供，已有图里的节点照常运行。新图使用 `Format`（见 String 节点），它同样以 `{0}`、`{1}`… 取数组各项，还能以 `{name}` 取对象字段，并且可用于 Blueprint Value 与 `function` 图。

- `text` - 模板
- `values` - 值列表；单个值时当作只有一项的列表
- `value` - `string`（传出引脚），替换后的文本。只有 `{数字}` 是占位符，其他花括号内容原样保留；没有对应值的占位符替换为空
