# Flow 节点

Flow 节点用于控制事件图或宏图中的执行线路。所有 Flow 节点可用于 `event` 和 `macro` 图，不可用于 `function` 图。

除非额外声明，所有 `in` 参数均为执行入口；`next`、`true`、`false`、`then`、`else`、`then*`、`case*`、`default`、`loop`、`completed` 参数均为执行出口；标注（传出引脚）的参数为传出值，其余数据参数为传入引脚值。`Timer` 是延迟计时器 token 类型，只能连接到接收 `Timer` 的节点。

循环节点采用当前运行时的单光标执行模型：`loop` 出口连接循环体，循环体末尾需要连接回同一个循环节点的 `in` 入口；节点再次进入时会推进下一轮循环，直到进入 `completed` 出口。

## If

`if` - 条件分支

根据布尔条件选择后续执行出口。

- `in` - 执行入口
- `condition` - 布尔条件
- `true` - 条件为真时的执行出口
- `false` - 条件为假时的执行出口

## Noop

`blueprint.flow.noop` - 空操作

不改变任何数据，只把执行线路继续传递到下一个节点。适合占位、调试或临时断开复杂链路时保持图结构清晰。

- `in` - 执行入口
- `next` - 执行出口

## If Else

`blueprint.flow.ifElse` - 条件分支

根据布尔条件选择后续执行出口。节点卡片可通过 `Add If condition` 追加 If 条件；运行时按 `condition`、追加条件的顺序依次判断，第一个为真的条件会进入对应 `then` / `if_N_then` 出口，没有任何条件为真时进入固定的 `else` 兜底出口。

- `in` - 执行入口
- `condition` - 布尔条件
- `then` - 条件为真时的执行出口
- `if_N_condition` - 第 N 个追加 If 条件
- `if_N_then` - 第 N 个追加 If 条件为真时的执行出口
- `else` - 条件为假时的执行出口

## Sequence

`blueprint.flow.sequence` - 顺序执行

进入节点后按顺序排队执行 `then0` 到 `then3` 已连接的出口。未连接的出口会被跳过；如果后续分支执行到 `Return`，剩余队列会被终止。

- `in` - 执行入口
- `then0` - 第 1 个执行出口
- `then1` - 第 2 个执行出口
- `then2` - 第 3 个执行出口
- `then3` - 第 4 个执行出口

## Switch String

`blueprint.flow.switchString` - 字符串分流

根据字符串值选择匹配的 Case 出口。节点卡片可通过 `Add Case` 追加更多 Case；运行时按固定 Case、追加 Case 的顺序依次匹配，第一个匹配项会进入对应 Case 出口。没有任何 Case 匹配时，执行 `default` 出口。

- `in` - 执行入口
- `value` - 用于匹配的字符串
- `case0Value` - 第 1 个 Case 的匹配值
- `case1Value` - 第 2 个 Case 的匹配值
- `case0` - 第 1 个 Case 匹配时的执行出口
- `case1` - 第 2 个 Case 匹配时的执行出口
- `case_N_value` - 第 N 个追加 Case 的匹配值
- `case_N_output` - 第 N 个追加 Case 匹配时的执行出口
- `default` - 未匹配任何 Case 时的执行出口

## For Loop

`blueprint.flow.forLoop` - 有界整数循环

从 `start` 开始，按 `step` 递增或递减，直到到达 `end`。每次循环触发 `loop` 出口，并通过 `index` 输出当前循环值。

- `in` - 执行入口
- `start` - 初始整数
- `end` - 结束整数
- `step` - 每次循环递增或递减的步长
- `maxIterations` - 最大循环次数
- `loop` - 每次循环的执行出口
- `completed` - 循环结束后的执行出口
- `index` - 当前循环整数（传出引脚）

## For Each

`blueprint.flow.forEach` - 遍历数组

遍历 JSON 数组中的每一项。每次循环触发 `loop` 出口，并输出当前 `item` 与 `index`。

- `in` - 执行入口
- `items` - 要遍历的 JSON 数组
- `maxIterations` - 最大循环次数
- `loop` - 每个数组项的执行出口
- `completed` - 遍历结束后的执行出口
- `item` - 当前数组项（传出引脚）
- `index` - 当前数组下标（传出引脚）

## While

`blueprint.flow.while` - 条件循环

当 `condition` 为真时重复执行 `loop` 出口。必须设置最大循环次数，避免剧情运行时被无限循环阻塞。

- `in` - 执行入口
- `condition` - 循环条件
- `maxIterations` - 最大循环次数
- `loop` - 条件为真时的循环出口
- `completed` - 条件为假或循环结束时的执行出口

## Delay

`blueprint.flow.delay` - 延迟执行

等待指定时长后执行 `completed` 出口。该节点是 latent 节点，会挂起当前执行链直到等待完成。

- `in` - 执行入口
- `duration` - 等待时长，单位为秒；例如 `1` 表示等待 1 秒，`0.25` 表示等待 250ms
- `completed` - 等待完成后的执行出口
- `token` - 当前 Delay 节点的计时器 token（传出引脚），类型为 `Timer`，可传给 `Skip Delay`

## Skip Delay

`blueprint.flow.skipDelay` - 跳过延迟

传入 `Delay` 节点输出的 `Timer` token，提前完成该 token 对应的 pending Delay，使目标 Delay 进入自己的 `completed` 出口；`Skip Delay` 自己会继续执行 `next`。如果传入的不是 Delay token，或目标 Delay 当前没有 pending 等待，该节点静默 no-op 并继续执行。

- `in` - 执行入口
- `timer` - 要跳过的 Delay `Timer` token
- `next` - skip 请求提交后的执行出口

## Return

`blueprint.flow.return` - 提前结束

立即结束当前事件图或宏图的执行链。该节点没有后续执行出口，也会终止 `Sequence` 已排队但尚未执行的后续出口。

- `in` - 执行入口
