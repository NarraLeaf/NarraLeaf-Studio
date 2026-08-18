# Time 节点

Time 节点用于读取当前时刻、构建与拆解日历时间、做时间运算，以及把一个时刻格式化成玩家能读的文本。创建浮窗中归入 Time 分类。

本页所有节点都是纯节点（pure），不调用 Host API，可用于 `event` / `function` / `macro` 图，也可用于 Blueprint Value——存档槽位上那行"保存于 ⋯"本身就是一个 Blueprint Value。

除非额外声明，所有参数均为传入引脚值；标注（传出引脚）的参数为传出值。

## 时刻的表示

一个时刻在图里就是一个数：**Unix 纪元毫秒**，走 `float` 引脚。

这与存档记录携带的时间戳是同一种形态（`Get Save Time` 的 `Saved At`、`Get Latest Auto Save` 的 `Timestamp`），所以存档时间可以直接接进本页任何节点，不需要转换节点；而两个时刻的先后比较、取最早/最晚，直接用已有的 `<`、`>`、`Min`、`Max` 完成，本页不再重复提供。

`Make Time`、`Get Time Parts`、`Add Time`、`Time Difference`、`Start Of Day`、`Is Same Day` 以及 `Format Time` 读写的都是**本地日历**（玩家所在时区），因为它们回答的都是玩家关于自己那一天的问题。唯一的例外是 `To ISO String`，它按 UTC 输出，并在自己的条目里写明了这一点。

## Now

`blueprint.time.now` - 当前时间

读取当前时刻。

- `timestamp` - `float`（传出引脚），当前时刻的纪元毫秒

该节点是纯节点，但每次求值都会重新读钟，与 `Random Float` 同理：这里的"纯"指的是不需要执行流，不是指返回常量。

## Make Time

`blueprint.time.make` - 构建时间

用本地日历的年月日时分秒构建一个时刻。

- `year` - 年（`2026` 就是公元 2026 年；`50` 就是公元 50 年，不会被当成 1950）
- `month` - 月，1-12
- `day` - 日，1-31
- `hour` - 时，0-23
- `minute` - 分，0-59
- `second` - 秒，0-59
- `millisecond` - 毫秒，0-999
- `timestamp` - `float`（传出引脚），构建出的时刻

超范围的字段会按日历进位，这也是表达"本月最后一天"的办法：`month = 9, day = 0` 得到 8 月 31 日，`month = 13` 得到下一年的 1 月。

## Get Time Parts

`blueprint.time.parts` - 获取时间分量

把一个时刻拆成本地日历的各个字段。

- `timestamp` - 要拆解的时刻
- `year` / `month` / `day` / `hour` / `minute` / `second` / `millisecond` - `integer`（传出引脚），对应字段；`month` 为 1-12
- `weekday` - `integer`（传出引脚），星期，0 表示星期日
- `dayOfYear` - `integer`（传出引脚），年内第几天，1 月 1 日为 1

## Format Time

`blueprint.time.format` - 格式化时间

按模板把一个时刻渲染成字符串，使用本地日历。

- `timestamp` - 要格式化的时刻
- `pattern` - 模板字符串；留空时按 `YYYY-MM-DD HH:mm` 输出
- `result` - `string`（传出引脚），格式化结果

可用的模板标记（长的优先匹配）：

| 标记          | 含义                | 示例          |
| ------------- | ------------------- | ------------- |
| `YYYY` / `YY` | 年（四位 / 两位）   | `2026` / `26` |
| `MM` / `M`    | 月（补零 / 不补零） | `08` / `8`    |
| `DD` / `D`    | 日（补零 / 不补零） | `14` / `14`   |
| `HH` / `H`    | 时，24 小时制       | `15` / `15`   |
| `hh` / `h`    | 时，12 小时制       | `03` / `3`    |
| `mm` / `m`    | 分                  | `30` / `30`   |
| `ss` / `s`    | 秒                  | `05` / `5`    |
| `SSS`         | 毫秒                | `007`         |
| `A` / `a`     | 上下午              | `PM` / `pm`   |

单引号内的内容原样输出，不参与标记匹配，这是打出与标记同形的字母的唯一办法：`'Day' D` 得到 `Day 14`。连续两个单引号表示一个单引号字符。

## Format Time Localized

`blueprint.time.formatLocalized` - 按语言格式化时间

按某种语言的书写习惯格式化一个时刻，底层是 `Intl.DateTimeFormat`。

- `timestamp` - 要格式化的时刻
- `locale` - BCP 47 语言标记（如 `zh-CN`、`en-US`）；留空使用运行环境的语言，在发布版里就是玩家的系统设置
- `Date Style` - 节点参数，日期部分的详略：`None` / `Short` / `Medium` / `Long` / `Full`，默认 `Medium`
- `Time Style` - 节点参数，时间部分的详略，同上，默认 `None`
- `result` - `string`（传出引脚），格式化结果

语言是**传入引脚**而不是自动读取游戏当前语言：读取游戏语言是一次异步 Host 调用，纯节点做不到。要让日期跟随游戏内语言切换，把 `Get Current Language` 接进 `locale`——那根连线就是"我要的是游戏语言"这句话本身。

两个 Style 都设为 `None` 时输出空字符串。

## Format Relative Time

`blueprint.time.formatRelative` - 格式化相对时间

把两个时刻的间隔说成"5 分钟前""2 天后"，底层是 `Intl.RelativeTimeFormat`。

- `from` - 基准时刻（通常接 `Now`）
- `to` - 被描述的时刻（通常接存档时间）
- `locale` - BCP 47 语言标记，规则同 `Format Time Localized`
- `Wording` - 节点参数，`Auto` 允许该语言使用"昨天"这类词，`Always Numeric` 一律用数字计数；默认 `Auto`
- `result` - `string`（传出引脚），格式化结果

单位按间隔大小自动选择：不足一分钟用秒，其后依次是分、时、天、月、年。

## Format Duration

`blueprint.time.formatDuration` - 格式化时长

把一段时长渲染成时钟读数。

- `milliseconds` - 时长，毫秒
- `Layout` - 节点参数，`Auto`（有小时才显示小时，如 `1:05` / `2:03:04`）、`Hours Minutes Seconds`（固定 `02:03:04`）、`Minutes Seconds`（固定 `03:04`）
- `result` - `string`（传出引脚），格式化结果

只输出数字和分隔符，没有单位词。"1 小时 20 分"这种带词的写法需要翻译，而节点读不到游戏语言，所以那种形态请用 `Get Duration Parts` 接进作者自己的、可翻译的 `Format Text`。

小时不会进位成天：30 小时的游戏时长显示为 `30:02:03`，不是 `06:02:03`。

## Get Duration Parts

`blueprint.time.durationParts` - 获取时长分量

把一段时长拆成各级单位。

- `milliseconds` - 时长，毫秒
- `days` / `hours` / `minutes` / `seconds` - `integer`（传出引脚），逐级取整，各自被上一级限制（`hours` 为 0-23，`minutes` / `seconds` 为 0-59）
- `remainingMilliseconds` - `integer`（传出引脚），不足一秒的毫秒数
- `totalHours` / `totalMinutes` / `totalSeconds` - `integer`（传出引脚），换算成该单位的总数，不受上一级限制
- `negative` - `boolean`（传出引脚），时长是否为负

符号只由 `negative` 携带，其余各项都是绝对值，这样拼字符串时不必到处剥掉只该出现在最前面的负号。

## Add Time

`blueprint.time.add` - 时间偏移

把一个时刻按指定单位前移或后移。

- `timestamp` - 起始时刻
- `amount` - 偏移量，负数表示往前
- `Unit` - 节点参数，`Milliseconds` / `Seconds` / `Minutes` / `Hours` / `Days` / `Weeks` / `Months` / `Years`
- `result` - `float`（传出引脚），偏移后的时刻

固定长度的单位按数值运算；`Months` 与 `Years` 走日历，并且**截断而不是进位**：1 月 31 日加一个月是 2 月 28 日（闰年 29 日），不是 3 月 3 日。

## Time Difference

`blueprint.time.difference` - 时间差

计算 `to - from`，按指定单位表示。

- `from` - 起始时刻
- `to` - 结束时刻
- `Unit` - 节点参数，同 `Add Time`
- `difference` - `float`（传出引脚），差值，`to` 早于 `from` 时为负

固定长度的单位保留小数（两次存档相差 90 分钟，按小时问得到 `1.5`，要整数就再接一个 `Floor`）；`Months` 与 `Years` 只数走完的整个日历单位。

## Parse Time

`blueprint.time.parse` - 解析时间

把写好的日期字符串读回一个时刻。

- `value` - 要解析的字符串
- `timestamp` - `float`（传出引脚），解析出的时刻；失败时为 `0`
- `ok` - `boolean`（传出引脚），是否解析成功

约定的输入格式是 ISO 8601；其余格式取决于运行环境的 `Date.parse`，不要依赖。

**失败时必须看 `ok`**：解析失败返回的 `0` 与真正保存在 1970 年的时刻在数值上没有区别。

只有日期没有时间的 `YYYY-MM-DD` 按**本地零点**解析。这与 ISO 规定的 UTC 不同，但本页其余节点都说本地日历，让日期字符串在西半球落到前一天晚上只会变成缺陷报告。

## To ISO String

`blueprint.time.toIsoString` - 转为 ISO 字符串

把一个时刻输出为 **UTC** 的 ISO 8601 字符串（`2026-08-14T07:30:00.000Z`），用于写进存档元数据或持久变量。

- `timestamp` - 要输出的时刻
- `result` - `string`（传出引脚），ISO 字符串

它与 `Parse Time` 互为往返：`To ISO String` 的输出交给 `Parse Time` 能拿回同一个时刻。

## Is Same Day

`blueprint.time.isSameDay` - 是否同一天

判断两个时刻是否落在本地日历的同一天。

- `a` - 第一个时刻
- `b` - 第二个时刻
- `result` - `boolean`（传出引脚），是否同一天

判据是日历日而不是间隔时长：相差半小时的 23:59 与次日 00:30 不是同一天。

## Start Of Day

`blueprint.time.startOfDay` - 当天零点

取一个时刻所在那一天的本地零点。

- `timestamp` - 输入时刻
- `result` - `float`（传出引脚），当天零点

常用于把存档按天分组，或与 `Now` 的当天零点比较来判断"今天/昨天"。

## Get Time Zone

`blueprint.time.zoneOffset` - 获取时区

读取运行环境所在时区。

- `timestamp` - 要询问的时刻（夏令时使同一时区在不同时刻有不同偏移）
- `offsetMinutes` - `float`（传出引脚），相对 UTC 的偏移分钟数，**东为正**（东八区为 `480`）
- `name` - `string`（传出引脚），IANA 时区名（如 `Asia/Shanghai`）；运行环境不提供时为空字符串

注意符号与 JavaScript `Date.getTimezoneOffset()` 相反，这里采用的是与时区写法（`UTC+8`）一致的方向。

## 与存档系统配合

存档槽位上的日期来自 Game 分类的 `Get Save Time`（见 [Game 节点](node.game.md)），它按存档 id 返回该槽位的写入与创建时刻，单位同样是纪元毫秒。典型接法：

- 显示绝对时间：`Get Save Time` → `Saved At` → `Format Time`（或 `Format Time Localized`）→ 槽位标签
- 显示相对时间：`Now` → `From`，`Get Save Time` 的 `Saved At` → `To`，接 `Format Relative Time`
- 空槽位与 1970 年的存档要靠 `Get Save Time` 的 `Exists` 区分，不要靠时间戳是否为 0
