# Input 节点

项目给手势起的名字，以及界面对它的回答。一个输入意图有 id、作者读的名字和一组绑定；每个 Surface 单独选择响应哪些意图，以及响应后是否继续冒泡。

这套东西存在的意义就是让绑定离开图：作者把「点对话框 = 推进」从单击改成空格，改的是词表里的一行，而不是每一张监听它的图。所以 Input 分类的节点只认操作的名字，从不描述用什么触发。

## Is Action Held

`blueprint.input.isActionHeld` - 指定输入操作当前是否按住

用于长按类手势：按住推进等于快进，松开就停。纯节点，可供事件图、函数图和宏图读取。Blueprint Value 不跟踪输入状态变化，因此不提供此节点。

卡片字段：
- `Action` - 从项目的输入操作词表里选一个（Inspector 参数）。留空时节点恒为 `false`，而不是报错——半填的卡片不该把玩家正在看的界面弄崩

输出：
- `held` - `boolean`。宿主没有输入路由时（例如编辑器预览里根本没有人在按键）读作 `false`，而不是空值

### 「按住」按的是什么

按住是**手上的事实**，不是事件。运行时记录此刻按下的键、鼠标键、手柄按键和已识别的长按手势（`runtime/input/inputHoldState.ts`），`Is Action Held` 根据意图的绑定读取它。

- **绑定属于意图**。当前 Surface 响应该意图时，节点读取意图自己的绑定；未响应或未声明的意图读作 `false`。
- **能被按住的是键、鼠标键、手柄按键和长按**。绑到 `longPress` 的意图在识别器计满 500ms 后读作按住，手指抬起就结束。滚轮和双击是瞬时手势，不能作为按住状态。
- **指针按在可操作控件上时让位于控件**。判据取按下时的目标；拖动指针不会改变这次按压的归属。
- **窗口失焦会清空**。玩家 Alt-Tab 走掉，`keyup` 永远不会来，所以失焦就当全部松开；否则那一次按住会一直「按」到会话结束。

## Get Input Device

`blueprint.input.getDevice` - 玩家当前使用的输入设备

用于同一句话在不同设备上要写成不同措辞：读出设备，分支，各自设置文本。纯节点，可供事件图、函数图和宏图读取；Blueprint Value 不跟踪设备变化，因此不提供此节点。卡片上没有字段。

输出：
- `device` - `string`，取值 `pointer` / `key` / `gamepad` / `touch`，与 `On Action` 的 `source` 引脚是同一套值，因此两边用同样的字面量去比。答的是玩家最近用的那件硬件，不是某条绑定能接受什么——只有前者能决定界面该印哪个词。宿主没有输入路由时（例如编辑器预览里根本没有人在操作）读作 `pointer`，而不是空值——作者不必为「设备读不出来」单写一条分支

## Is Gamepad Connected

`blueprint.input.isGamepadConnected` - 是否有标准 mapping 手柄连着

纯节点。非标准手柄不算。

- `connected` - `boolean`

## Is Gamepad Button Held

`blueprint.input.isGamepadButtonHeld` - 指定手柄按键当前是否按住

卡片选一个规范按键名。未选时读 `false`；游戏窗口没有焦点或被隐藏时也读 `false`。

- `held` - `boolean`

## Get Gamepad Axis

`blueprint.input.getGamepadAxis` - 读第一只标准手柄的摇杆轴

`LeftX` / `LeftY` / `RightX` / `RightY`。死区 0.18 以内读 0。Y 轴不翻转。游戏窗口没有焦点或被隐藏时读 0。

- `value` - `float`

## On Action

`blueprint.event.head.action` 归在 Events 分类，说明见 `node.events.md`。
