# Game 节点

Game 节点用于控制当前 Dev Mode 中的 NarraLeaf 游戏运行时、Dialog 推进，以及访问当前 Studio 项目隔离的本地存档。除非额外声明，所有参数均为传入引脚值；标注（传出引脚）的参数为传出值。

本页节点均通过 Blueprint Host API 执行。`Get Nametag`、`Get Notifications`、`Get Choice Count`、`Is NVL Mode`、`Is In Game`、`Is Game Overlay`、`Can Undo History`、`Can Redo History` 与 Preference Getter 是纯读取节点，可用于 Blueprint Value；Preference Setter、Dialog 控制、推进、`Select Choice`、存档写入/删除等执行节点都是 latent 节点，只用于 `event` 和 `macro` 图，不用于 `function` 图。

Preference Getter/Setter 通过 NarraLeaf React `game.preference.getPreference(...)` / `setPreference(...)` 访问当前活动 `LiveGame`。它们需要 NarraLeaf React 游戏环境已经准备就绪；在新游戏启动时初始化偏好，请使用全局蓝图的 `On Game Ready`，不要依赖可能早于 `LiveGame` 创建的 `App Boot`。

## Start Game

`blueprint.game.startStory` - Start Game

启动节点参数中选择的 Story / Scene，并切换到游戏舞台。游戏首帧 ready 后，当前应用 Page 栈会作为游戏底层隐藏；之后调用 `Go Page` 会把目标 Page 叠加在游戏舞台之上，而不是替换游戏舞台。它是执行尾节点，没有后续执行出口。

- `in` - 执行入口
- `Story` - 节点参数，目标 Story id
- `Scene` - 节点参数，目标 Scene id

## Get Nametag

`blueprint.game.getNametag` - Get Nametag

读取当前 NarraLeaf Dialog 的说话人名字。它由 NarraLeaf React `useDialog()` hook 驱动：Dialog flush / 文本状态变化时，Studio 会把当前 `LiveGame.onCharacterPrompt` 捕获到的角色名同步到 Blueprint runtime，并对 Dialog surface 内带 Blueprint Value 或 `On Flush` 逻辑的元素派发 `blueprint.event.head.flush`；旁白、没有说话人、或说话人名为空字符串/空白时返回 `null`。

- `nametag` - `string | null`（传出引脚），当前说话人名字；没有说话人时为 `null`

该节点是 pure 节点，可放入 Blueprint Value 或普通事件图。默认 Dialog 模板会创建普通 `nl.text` Nametag，并在它自己的 widgetMain 蓝图中用 `Init` / `On Flush -> Get Nametag -> Not Null -> If` 自动更新文本与透明度；不再需要特殊私有 `Nametag` widget，也不再依赖 Blueprint Value。Dialog 控件不重新挂载时，游戏推进产生的 Dialog hook 变化仍会触发该 flush 路径。

## Get Notifications

`blueprint.game.getNotifications` - Get Notifications

读取当前 NarraLeaf 通知数组。Notification slot bridge 会把 NLR notification 组件收到的通知镜像到 Blueprint runtime（每项 `{ id: string, message: string }`），并在变化时对 Notification surface 内带 Blueprint Value 或 `On Flush` 逻辑的元素派发 flush。没有通知时返回空数组。

- `notifications` - `array`（传出引脚），当前通知列表，每项为 `{ id, message }` JSON 对象

该节点是 pure 节点，可放入 Blueprint Value 或普通事件图。默认 Notification 模板不使用该节点：通知内容由 Notification List 的 item 模板通过 `Get List Item Props -> Get JSON Field("message")` 的 Blueprint Value 读取。

## Get Choice Count

`blueprint.game.getChoiceCount` - Get Choice Count

读取当前 NarraLeaf 选择菜单的可见选项数量（hidden 选项不计入）。Choice slot bridge 在菜单挂载时镜像该数量，菜单关闭后恢复为 `0`。

- `count` - `integer`（传出引脚），当前可见选项数量；没有活动菜单时为 `0`

该节点是 pure 节点，可放入 Blueprint Value 或普通事件图。

## Is NVL Mode

`blueprint.game.isNvlMode` - Is NVL Mode

读取当前 NarraLeaf 游戏是否处于 NVL（novel）模式。NVL slot bridge 会在 NVL 状态变化时同步该值并派发 flush；也可直接从 live game 的 NVL state 读取。

- `isNvlMode` - `boolean`（传出引脚），当前是否处于 NVL 模式

该节点是 pure 节点，可放入 Blueprint Value 或普通事件图。

## Select Choice

`blueprint.game.choose` - Select Choice

按原始选项序号选择当前 NarraLeaf 选择菜单中的选项。默认 Choice 模板在 Choice List 的 widgetMain 蓝图中预接 `Item Click -> Select Choice`：Choice item 数据中的 `index` 是原始选项序号（hidden 选项被过滤后序号不连续），Item Click 事件输出的 `index` 直接连入本节点。宿主实现会重新校验目标选项的 hidden/disabled 状态，不合法时静默拒绝。

- `in` - 执行入口
- `index` - `integer` 输入，原始选项序号，支持节点卡片 inline literal 或接线覆盖；必须是非负整数
- `next` - 选择请求完成后的执行出口

没有活动选择菜单时执行失败。

## Is In Game

`blueprint.game.isInGame` - Is In Game

读取当前 Dev Mode 是否处于 NarraLeaf 游戏状态。只要游戏舞台可见并且存在当前 NarraLeaf session 就返回 `true`；即使上方打开了 Page UI 叠层也仍为 `true`。普通 Page 预览、游戏尚未启动、退出游戏后都返回 `false`。

- `isInGame` - `boolean`（传出引脚），当前是否处于 NarraLeaf 游戏状态

该节点是 pure 节点，可放入 Blueprint Value 或普通事件图，用于在界面中按游戏状态切换文案、可见性或逻辑分支。

## Is Game Overlay

`blueprint.game.isGameOverlay` - Is Game Overlay

读取当前 Page / Game UI Surface runtime scope 是否以游戏上方 UI 叠层身份运行。通过 `Start Game` 或 `Load Save` 进入游戏状态后，继续用 `Go Page` 打开的 Page 会返回 `true`；内建 Game UI Surface（例如 Dialog slot）也返回 `true`；通过 `nl.frame` 嵌入的子 Page 会继承父 Page 的 overlay 状态。普通应用 Page、普通 Page 预览，以及 `Quit Game` 打开的返回 Page 返回 `false`。

- `isGameOverlay` - `boolean`（传出引脚），当前 Surface 实例是否是游戏 UI 叠层

该节点是 pure 节点，可放入 Blueprint Value 或普通事件图。它描述当前 Surface 实例的展示身份，并在 Page 实例创建时锁定；因此暂停菜单执行退出动画时，即使 `Quit Game` 已经开始清理游戏 session，该旧暂停菜单实例仍会返回 `true`。需要判断 live game runtime 是否仍可用时使用 `Is In Game`，需要判断共享 Page 应显示主页控件还是暂停菜单控件时优先使用 `Is Game Overlay`。

## Quit Game

`blueprint.game.quit` - Quit Game

退出当前 NarraLeaf 游戏状态，并打开节点卡片中选择的返回 Page。它会清理当前 live game/session 引用、取消仍在等待的游戏启动请求、清空当前 Dialog nametag，同步恢复普通 Page 显示，然后通过 Page 导航打开目标 Page。它是执行尾节点，没有后续执行出口。

- `in` - 执行入口
- `Page` - 节点参数，退出游戏后返回的 Page id

`Page` 必须选择有效值。该节点不要求作者额外连接 `Go Page`；退出和导航由同一次 Host API 调用完成。

## Next

`blueprint.game.next` - Next

触发当前 NarraLeaf live game 的 virtual click 路径。Studio Host API 优先点击当前 NarraLeaf Dialog wrapper 暴露的虚拟点击目标，让 NarraLeaf 自己决定“正在打字时完成当前句子、句子已完成时进入下一步”等行为；没有 Dialog 目标时才退回到对 NarraLeaf player/main content 发起 DOM click。该节点不会直接发送 `state.player.skip(false)` 或强制跳过。默认 Dialog 模板把推进逻辑集中在 Dialog Content 蓝图中：Content 自己的 `Mouse Click`、绑定全屏透明 Dialog Interaction Layer、可见 Dialog Panel 与默认内容子控件的 `Element Click`、以及 Space `keyUp` 都连到同一个 `Next`。

- `in` - 执行入口
- `next` - 推进请求完成后的执行出口

没有活动 game runtime 时执行失败。

## Skip

`blueprint.game.skip` - Skip

调用 NarraLeaf React `LiveGame.skipDialog()` 跳过当前 dialog。该节点用于作者显式提供 Skip 操作；默认 Dialog 模板不自动绑定 Skip。

- `in` - 执行入口
- `next` - Skip 请求完成后的执行出口

没有活动 game runtime 时执行失败。

## Show Dialog

`blueprint.game.showDialog` - Show Dialog

通过 NarraLeaf React Preference API 将 `showDialog` preference 设为 `true`，让当前 Dialog UI 恢复显示。该节点只改写 NarraLeaf runtime preference，不修改 Studio UI 文档，也不推进对话。

- `in` - 执行入口
- `next` - 显示请求完成后的执行出口

没有活动 game runtime 时执行失败。

## Hide Dialog

`blueprint.game.hideDialog` - Hide Dialog

通过 NarraLeaf React Preference API 将 `showDialog` preference 设为 `false`，隐藏当前 Dialog UI。隐藏后 Dialog wrapper 仍保留 NarraLeaf React 的交互语义；作者可以继续用 `Next`、`Skip` 或再次调用 `Show Dialog` / `Toggle Dialog Display` 控制流程。

- `in` - 执行入口
- `next` - 隐藏请求完成后的执行出口

没有活动 game runtime 时执行失败。

## Toggle Dialog Display

`blueprint.game.toggleDialogDisplay` - Toggle Dialog Display

读取当前 NarraLeaf React `showDialog` preference 并写入相反值，用于在同一个 UI 控件上切换 Dialog 显示状态。该节点不会改变对话内容、nametag 状态或 sentence speed。

- `in` - 执行入口
- `next` - 切换请求完成后的执行出口

没有活动 game runtime 时执行失败。

## Set Sentence Speed

`blueprint.game.setSentenceSpeed` - Set Sentence Speed

通过 NarraLeaf React Preference API 设置当前游戏的 sentence `cps`（characters per second）偏好，影响 Dialog Sentence 的文字显示速度。

- `in` - 执行入口
- `cps` / `CPS` - 正数 `float` 输入，写入 `cps` preference key
- `next` - 偏好写入完成后的执行出口

`CPS` 必须是大于 0 的有限数字；没有活动 game runtime 时执行失败。

## Get Sentence Speed

`blueprint.game.getCps` - Get Sentence Speed

读取当前游戏的 sentence `cps`（characters per second）偏好。该节点是 pure 节点，可用于 `event`、`function`、`macro` 图和 Blueprint Value；对应写入继续使用现有 `Set Sentence Speed` 节点，不新增第二个 CPS setter。

- `cps` / `CPS` - 正数 `float`（传出引脚），当前 `cps` preference key 的值

没有活动 game runtime 时执行失败。

## Game Preference Getter / Setter

以下节点直接对应 NarraLeaf React `GamePreference` 字段。Getter 是 pure 节点，只有一个传出值引脚；Setter 是 latent 执行节点，具有 `in`、偏好值输入和 `next`。除 `Get Sentence Speed` 外，每个字段都有成对的 Getter/Setter。`showDialog` 不在本组中注册新的 Getter/Setter，继续由现有 `Show Dialog`、`Hide Dialog`、`Toggle Dialog Display` 节点覆盖。

| Preference key | Getter | Setter | Pin | Validation |
| --- | --- | --- | --- | --- |
| `autoForward` | `Get Auto Forward` (`blueprint.game.getAutoForward`) | `Set Auto Forward` (`blueprint.game.setAutoForward`) | `autoForward` / `Auto Forward`, `boolean` | 必须是 boolean |
| `skip` | `Get Skip` (`blueprint.game.getSkip`) | `Set Skip` (`blueprint.game.setSkip`) | `skip` / `Skip`, `boolean` | 必须是 boolean |
| `gameSpeed` | `Get Game Speed` (`blueprint.game.getGameSpeed`) | `Set Game Speed` (`blueprint.game.setGameSpeed`) | `gameSpeed` / `Game Speed`, `float` | 必须是大于 0 的有限数字 |
| `cps` | `Get Sentence Speed` (`blueprint.game.getCps`) | 使用 `Set Sentence Speed` (`blueprint.game.setSentenceSpeed`) | `cps` / `CPS`, `float` | 必须是大于 0 的有限数字 |
| `voiceVolume` | `Get Voice Volume` (`blueprint.game.getVoiceVolume`) | `Set Voice Volume` (`blueprint.game.setVoiceVolume`) | `voiceVolume` / `Voice Volume`, `float` | 必须是大于等于 0 的有限数字 |
| `voiceFadeDuration` | `Get Voice Fade Duration` (`blueprint.game.getVoiceFadeDuration`) | `Set Voice Fade Duration` (`blueprint.game.setVoiceFadeDuration`) | `voiceFadeDuration` / `Voice Fade`, `float` | 必须是大于等于 0 的有限数字，单位 ms |
| `voiceEndMode` | `Get Voice End Mode` (`blueprint.game.getVoiceEndMode`) | `Set Voice End Mode` (`blueprint.game.setVoiceEndMode`) | `voiceEndMode` / `Voice End Mode`, `string` | 必须是 `"fade"`、`"stop"` 或 `"none"` |
| `bgmVolume` | `Get BGM Volume` (`blueprint.game.getBgmVolume`) | `Set BGM Volume` (`blueprint.game.setBgmVolume`) | `bgmVolume` / `BGM Volume`, `float` | 必须是大于等于 0 的有限数字 |
| `soundVolume` | `Get Sound Volume` (`blueprint.game.getSoundVolume`) | `Set Sound Volume` (`blueprint.game.setSoundVolume`) | `soundVolume` / `Sound Volume`, `float` | 必须是大于等于 0 的有限数字 |
| `globalVolume` | `Get Global Volume` (`blueprint.game.getGlobalVolume`) | `Set Global Volume` (`blueprint.game.setGlobalVolume`) | `globalVolume` / `Global Volume`, `float` | 必须是大于等于 0 的有限数字 |
| `skipDelay` | `Get Skip Delay` (`blueprint.game.getSkipDelay`) | `Set Skip Delay` (`blueprint.game.setSkipDelay`) | `skipDelay` / `Skip Delay`, `float` | 必须是大于等于 0 的有限数字，单位 ms |
| `skipInterval` | `Get Skip Interval` (`blueprint.game.getSkipInterval`) | `Set Skip Interval` (`blueprint.game.setSkipInterval`) | `skipInterval` / `Skip Interval`, `float` | 必须是大于 0 的有限数字，单位 ms |

所有 Preference Getter/Setter 在没有活动 game runtime 时执行失败。初始化新游戏偏好时，将这些 Setter 接到 `On Game Ready`，这样写入会发生在 `LiveGame` 已存在且第一段剧情开始前。

## Save Game

`blueprint.game.save.write` - Save Game

将当前 NarraLeaf live game 通过 `serialize()` 写入项目级本地存档。同一个 `id` 会覆盖旧存档；当可选 `Capture` 输入为 `true` 时，会调用 NarraLeaf React `capturePng()` 截取 PNG 预览图并保存到该存档 preview。没有活动 game session 时执行失败。

- `in` - 执行入口
- `id` - 存档 id，`string` 输入，支持节点卡片 inline literal 或接线覆盖
- `metadata` - 可选存档用户 metadata，蓝图通用 `json` 输入；未提供时写入 `null`
- `screenshot` / `Capture` - 可选 `boolean` 输入；只有传入 `true` 时写入预览截图
- `next` - 写入完成后的执行出口

`id` 会 trim，不能为空，且不能包含路径分隔符或控制字符。文件名由安全 hash 派生，真实用户 id 只保存在存档 metadata 中。`metadata` 使用现有 Blueprint JSON pin 类型，可传入 object、array、string、number、boolean 或 `null`，不会创建专用 Save Metadata 数据类型。

### 存档字段

工程可以声明一份**存档字段**（`editor/save-schema.json`），声明之后这个节点会为每个字段长出一个具名输入引脚，不必再用 `Make JSON Object` 拼对象、也不用手写存储 key。字段在节点卡片上的按钮里编辑，改的是整个工程共用的那一份——写档节点和读档节点因此永远长出同一批引脚。

- 引脚按**字段 id** 寻址，改字段名只换标签，不会断线。
- 字段声明的类型**就是**引脚的类型，中间没有映射表。
- 裸 `metadata` 引脚**永远保留**：先写它，再把声明字段盖上去，重叠时以声明字段为准。这样声明第一个字段不会让原本接着 `metadata` 的图静默断掉，插件写的、历史遗留的 key 也仍然有地方搭车。
- 会执行到的 Save Game 上，声明过的字段**必须填**（接线或在卡片上填值都算，填空串也算）。空着会报 lint error `blueprint/save-field-empty`——因为读端承诺每个字段都有值，漏填的存档在运行时和"写在该字段存在之前"的老存档完全无法区分。

## Load Save

`blueprint.game.save.load` - Load Save

读取指定本地存档并放弃当前游戏进度，按 NarraLeaf 渲染器语义清理当前 router / history 后创建新游戏实例并 `deserialize(savedGame)`。读取完成后等待当前 router exit，重新隐藏当前应用 Page 栈并保留游戏舞台作为背景；之后调用 `Go Page` 会打开游戏上方 UI 叠层。该节点停在自身；它是执行尾节点，没有 `next` 出口。

- `in` - 执行入口
- `id` - 存档 id，`string` 输入，支持节点卡片 inline literal 或接线覆盖

缺失存档、损坏存档或没有活动 game runtime 时执行失败。

## Delete Save

`blueprint.game.save.delete` - Delete Save

删除指定项目级本地存档。删除完成后从 `next` 出口继续执行；目标存档原本不存在时也视为成功完成。该节点只需要当前 Dev Mode 项目的存档命名空间，不要求存在活动 NarraLeaf live game。

- `in` - 执行入口
- `id` - 存档 id，`string` 输入，支持节点卡片 inline literal 或接线覆盖
- `next` - 删除请求完成后的执行出口

`id` 会 trim，不能为空，且不能包含路径分隔符或控制字符。

## List Saves

`blueprint.game.save.listIds` - List Saves

列出当前 Studio 项目本地普通存档的 id。返回顺序不保证稳定。**不含自动存档**——自动存档写在保留 id 命名空间（`@autosave.<n>`）里，由 `List Auto Saves` 列出，因此作者自己的存档界面不必再过滤 Studio 的簿记条目。

- `in` - 执行入口
- `ids` - `Array<String>` / `string[]`（传出引脚），蓝图引脚类型为 `array`
- `next` - 读取完成后的执行出口

损坏或不符合普通存档 metadata 的文件会被跳过。

## Get Save Metadata

`blueprint.game.save.getMetadata` - Get Save Metadata

读取指定本地存档的用户 metadata。该节点只读取由 `Save Game` 的 `metadata` pin 写入的通用 JSON 值，不返回系统字段 `id`、`type`、`createdAt`、`updatedAt` 或预览截图。

- `in` - 执行入口
- `id` - 存档 id，`string` 输入，支持节点卡片 inline literal 或接线覆盖
- `metadata` - 蓝图通用 `json`（传出引脚）
- `next` - 读取完成后的执行出口

存档不存在或没有用户 metadata 时，`metadata` 输出 `null`。

工程声明了存档字段之后，这个节点会为每个字段多长出一个具名输出引脚，`metadata` 输出则原样保留、仍然给出完整的存储对象。

字段输出**永远有值**：存档里没有这个 key 时给的是该字段配置的默认值。这正是"给已发布的游戏加一个存档字段"安全的原因——老存档照常显示，不会变成一片空白。

## Get Save Time

`blueprint.game.save.getTime` - Get Save Time

读取指定本地存档的写入时刻。存档库一直在给每条记录盖时间戳，这个节点是把它取出来给图使用的通路——否则作者要在 `Save Game` 时把时间自己写进 metadata，那是同一个事实的第二份、并且会漂移的副本。

- `in` - 执行入口
- `id` - 存档 id，`string` 输入，支持节点卡片 inline literal 或接线覆盖
- `savedAt` - 最后写入时间，Unix 毫秒（传出引脚）
- `createdAt` - 首次写入时间，Unix 毫秒（传出引脚）
- `exists` - 该存档是否存在（传出引脚）
- `next` - 读取完成后的执行出口

单位与 `List Auto Saves` / `Get Latest Auto Save` 一致，可以直接接进 [Time 节点](node.time.md) 做格式化。

存档不存在时 `savedAt` 与 `createdAt` 都是 `0`，**要靠 `exists` 而不是时间戳是否为 0 来判断**：后者与真正保存在 1970 年的存档没有区别。存档存在但记录缺少时间戳时，缺的那一项为 `0`，`exists` 仍为 `true`。

与 `Get Save Metadata`、`Get Save Preview` 一样按 id 取值，因此对 `List Saves` 的玩家槽位和 `List Auto Saves` 的自动存档环同样适用。

## Get Save Line

`blueprint.game.save.getLine` - Get Save Line

读取指定本地存档停在哪一句。引擎每次序列化都会把 `lastSentence` / `lastSpeaker` 写进存档，这个节点是把它们取出来给图使用的通路。

- `in` - 执行入口
- `id` - 存档 id，`string` 输入，支持节点卡片 inline literal 或接线覆盖
- `line` - 存档停在的那句话（传出引脚）
- `speaker` - 说这句话的人；旁白或尚无对话时为空串（传出引脚）
- `exists` - 该存档是否存在（传出引脚）
- `next` - 读取完成后的执行出口

**不要再用 `Get History` 取 backlog 最后一条来重建这两个值。** 那是同一个事实的第二份副本，而且是不准的那份：backlog 最后一条是**最后显示过**的那一句，这个节点给的是存档**将从哪一句继续**。从叠层菜单里存档、say 之后还跟着非 say 动作、backlog 超出上限被截断，三种情况都会让两者错开。

存档不存在时 `line` 与 `speaker` 都是空串，**要靠 `exists` 判断**：一个在任何对话播放之前就保存的存档同样两项为空。

与 `Get Save Metadata`、`Get Save Preview`、`Get Save Time` 一样按 id 取值，因此对 `List Saves` 的玩家槽位和 `List Auto Saves` 的自动存档环同样适用。

存档里的 `storyHash` **刻意没有开放给图**。它唯一的用途是拒绝加载存档，而按 hash 拒绝正是本项目否决过的做法——改一行正文它就会变，会拦下大量本来能正常读取的存档。

## Get Save Preview

`blueprint.game.save.getPreview` - Get Save Preview

读取指定本地存档 metadata 中的截图预览，并在当前 Dev Mode 会话内生成临时 `ImageAsset`。该图片不会导入项目资源库；可直接传给 `nl.image` 的 `Set Image Asset` 或图片相关 Blueprint Value。

- `in` - 执行入口
- `id` - 存档 id，`string` 输入，支持节点卡片 inline literal 或接线覆盖
- `preview` - `ImageAsset|null`（传出引脚）
- `next` - 读取完成后的执行出口

存档不存在、没有截图或截图不可用时，`preview` 返回 `null`。

## Auto Save

`blueprint.game.autoSave.write` - Auto Save

立即写入一次自动存档，进入保留存档环的下一个槽位（最旧的先被覆盖），并附带截图。
与定时自动保存写的是同一个环，两者产生的存档没有区别。
无论「项目 → 游戏 → 自动保存」是否开启都会执行——这一次是作者显式要求的。

- `in` - 执行入口
- `next` - 写入完成后的执行出口

没有正在运行的游戏时抛出错误（与其它存档节点一致）。自动保存不会替换正在进行的游玩，因此执行会继续。

## List Auto Saves

`blueprint.game.autoSave.list` - List Auto Saves

列出保留命名空间内的全部自动存档，**按时间从新到旧**排序。只列自动存档，`List Saves` 只列玩家存档，两者互不重叠。

- `in` - 执行入口
- `entries` - `Array<Object>`（传出引脚），蓝图引脚类型为 `array`
- `count` - `integer`（传出引脚）
- `next` - 读取完成后的执行出口

每个条目的字段：

- `id` - 存档 id，可直接喂给 `Load Save` / `Get Save Preview` / `Get Save Metadata` / `Delete Save`
- `slot` - 环内槽位序号
- `timestamp` - 最后写入时间，Unix 毫秒
- `createdAt` - 首次写入时间，Unix 毫秒
- `metadata` - 写入方附带的用户 metadata，没有时为 `null`

条目带的是 **id 而不是序列化后的存档数据**：`SavedGameData` 在图里无法使用，而 id 能直接接进既有的存档节点。
作者把 `slots` 调小后遗留的槽位仍会被列出（玩家的存档不会因为改配置而消失），只是不会再被轮转覆盖。

## Get Latest Auto Save

`blueprint.game.autoSave.latest` - Get Latest Auto Save

取最新的一条自动存档。「继续游戏」按钮的专用节点：等价于 `List Auto Saves` 的第一条，但省掉取下标和取字段的三个节点。

- `in` - 执行入口
- `id` - 最新自动存档的 id，`string`（传出引脚）；没有自动存档时为空字符串
- `hasAutoSave` - `boolean`（传出引脚），用来在没有存档时禁用「继续」
- `timestamp` - 最后写入时间，Unix 毫秒（传出引脚）；没有自动存档时为 `0`
- `next` - 读取完成后的执行出口

自动保存的开关、间隔与保留数量在「项目 → 游戏」中配置，随项目一起出货。

## 对话历史（backlog）

backlog 是一条**带播放头的时间轴**，不是一个只增不减的列表。玩家读过的每一行都在轴上；播放头停在当前这一行。

- **`Get History`** 给的是播放头**之后**的部分，也就是「已经读到这里」的那一段，按顺序排列。
- 玩家回退时播放头往前移动，被它越过的行成为**前方**，由 **`Get Future History`** 给出。
- **`Restore From History`** 按条目 id 把播放头移到指定那一行，两个方向都可以。
- **`Undo Last History Entry`** / **`Redo Next History Entry`** 各把播放头移动一行。
- **`Can Undo History`** / **`Can Redo History`** 是纯节点，用来让两个按钮自己决定要不要禁用。

⚠ **`Get History` 不再包含前方的行。** 从引擎 0.26.0 起它在播放头处截断，因此玩家回退之后，
只连 `Get History` 的 backlog 界面会**看起来少了几行**——那几行在 `Get Future History` 里。
在没有人回退过的普通一周目里，前方恒为空，两者之和就是全部读过的行。

回退有两条执行路径，作者不需要关心是哪一条：本次会话真跑过的行就地回退（音乐不停、转场不动），
引擎的执行栈够不到的行（读档之后、或超出栈上限）用该行的快照恢复。两条都落到同一个状态。

### Get History

`blueprint.game.history.get` - Get History

- `in` - 执行入口
- `entries` - `Array<Object>`（传出引脚），蓝图引脚类型为 `array`
- `count` - `integer`（传出引脚）
- `next` - 读取完成后的执行出口

每个条目的字段：

- `id` - 条目 token，喂给 `Restore From History`。**读档与回退之后仍然有效**（引擎 0.26.0 起 token 写进存档并在读回时保留；更早写的存档没有 token，读回时会重新分配）
- `type` - `"say"` 或 `"menu"`
- `text` - 该行正文；`menu` 条目是提示语
- `character` - 说话人名字，旁白与 `menu` 条目为 `null`
- `voice` - 已解析的语音 URL，没有时为 `null`
- `voiceId` - 该行登记的语音 id，用来做 backlog 重播按钮；旧存档的条目没有它
- `selected` - `menu` 条目里玩家选中的那一项，`say` 条目为 `null`
- `isPending` - 该行是否还在打字中

### Get Future History

`blueprint.game.history.getFuture` - Get Future History

引脚与条目字段和 `Get History` 完全一致，因此 backlog 列表的 item 模板两边共用一套。
**排序是由近及远**：第一条是再往前走一行会到达的那一行。玩家没有回退过时返回空数组。

### Restore From History

`blueprint.game.history.restore` - Restore From History

- `in` - 执行入口
- `id` - 条目 id，`string` 输入，支持 inline literal 或接线覆盖；**留空会报错**
- `next` - 执行出口

id 取自 `Get History` 或 `Get Future History` 的条目，两个方向都能到。

### Undo Last History Entry / Redo Next History Entry

`blueprint.game.history.undoLast` - Undo Last History Entry
`blueprint.game.history.redoNext` - Redo Next History Entry

- `in` - 执行入口
- `next` - 执行出口

各把播放头移动一行，都不取 id。走到尽头时**什么都不做，不报错**——这正是 `Can Undo History` /
`Can Redo History` 存在的原因：让按钮在走到尽头之前就已经是禁用的。

⚠ 回退之后再往前读**会保留前方**：走三行回去再读回来，是重走那三行，后面读过的仍在前方。
只有当故事走去了别处（选了另一个分支）才会丢弃前方，因为那段前方已经不再接在当前位置之后。

### Can Undo History / Can Redo History

`blueprint.game.history.canUndo` - Can Undo History
`blueprint.game.history.canRedo` - Can Redo History

- `canUndo` / `canRedo` - `boolean`（传出引脚）

两者都是 pure 节点，可放入 Blueprint Value 或普通事件图。没有运行中的游戏时都返回 `false`。
