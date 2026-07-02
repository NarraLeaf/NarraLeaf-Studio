# Game 节点

Game 节点用于控制当前 Dev Mode 中的 NarraLeaf 游戏运行时、Dialog 推进，以及访问当前 Studio 项目隔离的本地存档。除非额外声明，所有参数均为传入引脚值；标注（传出引脚）的参数为传出值。

本页节点均通过 Blueprint Host API 执行。`Get Nametag` 与 `Is In Game` 是纯读取节点，可用于 Blueprint Value；其余 Game 执行节点都是 latent 节点，只用于 `event` 和 `macro` 图，不用于 `function` 图。

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

## Is In Game

`blueprint.game.isInGame` - Is In Game

读取当前 Dev Mode 是否处于 NarraLeaf 游戏状态。只要游戏舞台可见并且存在当前 NarraLeaf session 就返回 `true`；即使上方打开了 Page UI 叠层也仍为 `true`。普通 Page 预览、游戏尚未启动、退出游戏后都返回 `false`。

- `isInGame` - `boolean`（传出引脚），当前是否处于 NarraLeaf 游戏状态

该节点是 pure 节点，可放入 Blueprint Value 或普通事件图，用于在界面中按游戏状态切换文案、可见性或逻辑分支。

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
- `speed` - 正数 `float` 输入，写入 `cps` preference key
- `next` - 偏好写入完成后的执行出口

`speed` 必须是大于 0 的有限数字；没有活动 game runtime 时执行失败。

## Write Save

`blueprint.game.save.write` - Write Save

将当前 NarraLeaf live game 通过 `serialize()` 写入项目级本地存档。同一个 `id` 会覆盖旧存档；写入时会尽力调用 `captureJpeg()` 保存预览图，截图失败不会阻止存档写入。没有活动 game session 时执行失败。

- `in` - 执行入口
- `id` - 存档 id，`string` 输入，支持节点卡片 inline literal 或接线覆盖
- `metadata` - 存档用户 metadata，蓝图通用 `json` 输入；未提供时写入 `null`
- `next` - 写入完成后的执行出口

`id` 会 trim，不能为空，且不能包含路径分隔符或控制字符。文件名由安全 hash 派生，真实用户 id 只保存在存档 metadata 中。`metadata` 使用现有 Blueprint JSON pin 类型，可传入 object、array、string、number、boolean 或 `null`，不会创建专用 Save Metadata 数据类型。

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

列出当前 Studio 项目本地普通存档的 id。返回顺序不保证稳定。

- `in` - 执行入口
- `ids` - `Array<String>` / `string[]`（传出引脚），蓝图引脚类型为 `array`
- `next` - 读取完成后的执行出口

损坏或不符合普通存档 metadata 的文件会被跳过。

## Get Save Metadata

`blueprint.game.save.getMetadata` - Get Save Metadata

读取指定本地存档的用户 metadata。该节点只读取由 `Write Save` 的 `metadata` pin 写入的通用 JSON 值，不返回系统字段 `id`、`type`、`createdAt`、`updatedAt` 或预览截图。

- `in` - 执行入口
- `id` - 存档 id，`string` 输入，支持节点卡片 inline literal 或接线覆盖
- `metadata` - 蓝图通用 `json`（传出引脚）
- `next` - 读取完成后的执行出口

存档不存在或没有用户 metadata 时，`metadata` 输出 `null`。

## Get Save Preview

`blueprint.game.save.getPreview` - Get Save Preview

读取指定本地存档 metadata 中的截图预览，并在当前 Dev Mode 会话内生成临时 `ImageAsset`。该图片不会导入项目资源库；可直接传给 `nl.image` 的 `Set Image Asset` 或图片相关 Blueprint Value。

- `in` - 执行入口
- `id` - 存档 id，`string` 输入，支持节点卡片 inline literal 或接线覆盖
- `preview` - `ImageAsset|null`（传出引脚）
- `next` - 读取完成后的执行出口

存档不存在、没有截图或截图不可用时，`preview` 返回 `null`。
