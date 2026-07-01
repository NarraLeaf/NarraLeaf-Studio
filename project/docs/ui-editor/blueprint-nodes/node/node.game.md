# Game 节点

Game 节点用于控制当前 Dev Mode 中的 NarraLeaf 游戏运行时，以及访问当前 Studio 项目隔离的本地存档。除非额外声明，所有参数均为传入引脚值；标注（传出引脚）的参数为传出值。

本页节点均通过 Blueprint Host API 执行。存档相关节点都是 latent 节点，只用于 `event` 和 `macro` 图，不用于 `function` 图。

## Start Game

`blueprint.game.startStory` - Start Game

启动节点参数中选择的 Story / Scene，并切换到游戏舞台。它是执行尾节点，没有后续执行出口。

- `in` - 执行入口
- `Story` - 节点参数，目标 Story id
- `Scene` - 节点参数，目标 Scene id

## Write Save

`blueprint.game.save.write` - Write Save

将当前 NarraLeaf live game 通过 `serialize()` 写入项目级本地存档。同一个 `id` 会覆盖旧存档；写入时会尽力调用 `captureJpeg()` 保存预览图，截图失败不会阻止存档写入。没有活动 game session 时执行失败。

- `in` - 执行入口
- `id` - 存档 id，`string` 输入，支持节点卡片 inline literal 或接线覆盖
- `next` - 写入完成后的执行出口

`id` 会 trim，不能为空，且不能包含路径分隔符或控制字符。文件名由安全 hash 派生，真实用户 id 只保存在存档 metadata 中。

## Load Save

`blueprint.game.save.load` - Load Save

读取指定本地存档并放弃当前游戏进度，按 NarraLeaf 渲染器语义清理当前 router / history 后创建新游戏实例并 `deserialize(savedGame)`。读取完成后等待当前 router exit，然后停在该节点；它是执行尾节点，没有 `next` 出口。

- `in` - 执行入口
- `id` - 存档 id，`string` 输入，支持节点卡片 inline literal 或接线覆盖

缺失存档、损坏存档或没有活动 game runtime 时执行失败。

## List Saves

`blueprint.game.save.listIds` - List Saves

列出当前 Studio 项目本地普通存档的 id。返回顺序不保证稳定。

- `in` - 执行入口
- `ids` - `Array<String>` / `string[]`（传出引脚），蓝图引脚类型为 `array`
- `next` - 读取完成后的执行出口

损坏或不符合普通存档 metadata 的文件会被跳过。

## Get Save Preview

`blueprint.game.save.getPreview` - Get Save Preview

读取指定本地存档 metadata 中的截图预览，并在当前 Dev Mode 会话内生成临时 `ImageAsset`。该图片不会导入项目资源库；可直接传给 `nl.image` 的 `Set Image Asset` 或图片相关 Blueprint Value。

- `in` - 执行入口
- `id` - 存档 id，`string` 输入，支持节点卡片 inline literal 或接线覆盖
- `preview` - `ImageAsset|null`（传出引脚）
- `next` - 读取完成后的执行出口

存档不存在、没有截图或截图不可用时，`preview` 返回 `null`。
