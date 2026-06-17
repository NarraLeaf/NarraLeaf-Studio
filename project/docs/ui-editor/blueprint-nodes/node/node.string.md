# String 节点

除非额外声明，所有参数均为传入引脚值；标注（传出引脚）的参数为传出值。

## To String

`blueprint.string.toString` - 转换为字符串

将任意值转换为字符串。
- `value` - 要转换的值
- `result` - 转换后的字符串（传出引脚）

## Concat

`blueprint.string.concat` - 拼接字符串

将两个或多个字符串按顺序拼接为一个字符串。
- `a` - 第一个字符串
- `b` - 第二个字符串
- `result` - 拼接后的字符串（传出引脚）

## Format

`blueprint.string.format` - 格式化字符串

将模板字符串中的占位符替换为指定值。
- `template` - 模板字符串
- `values` - 用于替换占位符的数据
- `result` - 格式化后的字符串（传出引脚）

## Length

`blueprint.string.length` - 获取字符串长度

获取字符串的字符数量。
- `value` - 字符串
- `length` - 字符串长度（传出引脚）

## Is Empty

`blueprint.string.isEmpty` - 判断字符串是否为空

判断字符串长度是否为 0。
- `value` - 字符串
- `result` - 是否为空（传出引脚）

## Is Blank

`blueprint.string.isBlank` - 判断字符串是否为空白

判断字符串是否为空，或只包含空格、制表符、换行等空白字符。
- `value` - 字符串
- `result` - 是否为空白（传出引脚）

## Trim

`blueprint.string.trim` - 移除两端空白

移除字符串开头和结尾的空白字符。
- `value` - 字符串
- `result` - 处理后的字符串（传出引脚）

## Trim Start

`blueprint.string.trimStart` - 移除开头空白

移除字符串开头的空白字符。
- `value` - 字符串
- `result` - 处理后的字符串（传出引脚）

## Trim End

`blueprint.string.trimEnd` - 移除结尾空白

移除字符串结尾的空白字符。
- `value` - 字符串
- `result` - 处理后的字符串（传出引脚）

## To Upper Case

`blueprint.string.toUpperCase` - 转换为大写

将字符串转换为大写。
- `value` - 字符串
- `result` - 转换后的字符串（传出引脚）

## To Lower Case

`blueprint.string.toLowerCase` - 转换为小写

将字符串转换为小写。
- `value` - 字符串
- `result` - 转换后的字符串（传出引脚）

## Capitalize

`blueprint.string.capitalize` - 首字母大写

将字符串的第一个字符转换为大写。
- `value` - 字符串
- `result` - 转换后的字符串（传出引脚）

## Contains

`blueprint.string.contains` - 判断是否包含字符串

判断字符串中是否包含指定内容。
- `value` - 字符串
- `search` - 要查找的字符串
- `result` - 是否包含（传出引脚）

## Starts With

`blueprint.string.startsWith` - 判断是否以字符串开头

判断字符串是否以指定内容开头。
- `value` - 字符串
- `search` - 要匹配的开头字符串
- `result` - 是否匹配（传出引脚）

## Ends With

`blueprint.string.endsWith` - 判断是否以字符串结尾

判断字符串是否以指定内容结尾。
- `value` - 字符串
- `search` - 要匹配的结尾字符串
- `result` - 是否匹配（传出引脚）

## Equals

`blueprint.string.equals` - 判断字符串是否相等

判断两个字符串是否完全相等。
- `a` - 第一个字符串
- `b` - 第二个字符串
- `result` - 是否相等（传出引脚）

## Equals Ignore Case

`blueprint.string.equalsIgnoreCase` - 忽略大小写判断字符串是否相等

忽略大小写判断两个字符串是否相等。
- `a` - 第一个字符串
- `b` - 第二个字符串
- `result` - 是否相等（传出引脚）

## Index Of

`blueprint.string.indexOf` - 查找字符串位置

从前向后查找指定内容第一次出现的位置。未找到时返回 -1。
- `value` - 字符串
- `search` - 要查找的字符串
- `start` - 开始查找的位置
- `index` - 找到的位置（传出引脚）

## Last Index Of

`blueprint.string.lastIndexOf` - 从后查找字符串位置

从后向前查找指定内容最后一次出现的位置。未找到时返回 -1。
- `value` - 字符串
- `search` - 要查找的字符串
- `index` - 找到的位置（传出引脚）

## Count

`blueprint.string.count` - 统计字符串出现次数

统计指定内容在字符串中出现的次数。
- `value` - 字符串
- `search` - 要统计的字符串
- `count` - 出现次数（传出引脚）

## Char At

`blueprint.string.charAt` - 获取指定位置字符

获取字符串中指定位置的单个字符。
- `value` - 字符串
- `index` - 字符位置
- `char` - 指定位置的字符（传出引脚）

## Substring

`blueprint.string.substring` - 截取字符串

从字符串中截取一段内容。
- `value` - 字符串
- `start` - 开始位置
- `length` - 截取长度
- `result` - 截取后的字符串（传出引脚）

## Insert

`blueprint.string.insert` - 插入字符串

在指定位置插入字符串。
- `value` - 原字符串
- `index` - 插入位置
- `insert` - 要插入的字符串
- `result` - 插入后的字符串（传出引脚）

## Replace

`blueprint.string.replace` - 替换第一个匹配字符串

将第一个匹配内容替换为新字符串。
- `value` - 原字符串
- `search` - 要替换的字符串
- `replacement` - 替换后的字符串
- `result` - 替换后的字符串（传出引脚）

## Replace All

`blueprint.string.replaceAll` - 替换所有匹配字符串

将所有匹配内容替换为新字符串。
- `value` - 原字符串
- `search` - 要替换的字符串
- `replacement` - 替换后的字符串
- `result` - 替换后的字符串（传出引脚）

## Split

`blueprint.string.split` - 分割字符串

按照分隔符把字符串分割为字符串数组。
- `value` - 字符串
- `separator` - 分隔符
- `result` - 分割后的字符串数组（传出引脚）

## Join

`blueprint.string.join` - 合并字符串数组

按照分隔符把字符串数组合并为一个字符串。
- `values` - 字符串数组
- `separator` - 分隔符
- `result` - 合并后的字符串（传出引脚）

## Repeat

`blueprint.string.repeat` - 重复字符串

将字符串重复指定次数。
- `value` - 字符串
- `count` - 重复次数
- `result` - 重复后的字符串（传出引脚）

## Pad Start

`blueprint.string.padStart` - 在开头补齐字符串

在字符串开头补齐指定内容，直到达到目标长度。
- `value` - 字符串
- `length` - 目标长度
- `pad` - 用于补齐的字符串
- `result` - 补齐后的字符串（传出引脚）

## Pad End

`blueprint.string.padEnd` - 在结尾补齐字符串

在字符串结尾补齐指定内容，直到达到目标长度。
- `value` - 字符串
- `length` - 目标长度
- `pad` - 用于补齐的字符串
- `result` - 补齐后的字符串（传出引脚）

## Matches Regex

`blueprint.string.matchesRegex` - 判断是否匹配正则表达式

判断字符串是否匹配指定正则表达式。
- `value` - 字符串
- `pattern` - 正则表达式
- `result` - 是否匹配（传出引脚）

## Extract Regex

`blueprint.string.extractRegex` - 提取正则匹配内容

从字符串中提取第一个正则匹配内容。
- `value` - 字符串
- `pattern` - 正则表达式
- `result` - 匹配到的字符串（传出引脚）

## Normalize Line Breaks

`blueprint.string.normalizeLineBreaks` - 统一换行符

将不同平台的换行符统一为 `\n`。
- `value` - 字符串
- `result` - 处理后的字符串（传出引脚）
