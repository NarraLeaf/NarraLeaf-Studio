# 蓝图节点：游戏 · Game

> 本文件由 NarraLeaf Studio 源码自动生成，请勿手动修改。
> Generated from the NarraLeaf Studio source. Do not edit by hand.

「游戏 · Game」分类下的 100 个节点。标题是节点面板里显示的名字（中文 · English）。

The 100 nodes in the "Game" palette category, titled as the node palette shows them.

### 自动保存 · Auto Save

`blueprint.game.autoSave.write` · 会等待，完成后才继续 · Latent: waits before continuing

- 可放在 · Allowed in: 应用逻辑 · App logic、页面逻辑 · Page logic、控件逻辑 · Widget logic、组件内的控件逻辑 · Widget logic inside a component
- 输入 · In：进入 · In（`in`，执行 · exec）
- 输出 · Out：下一步 · Next（`next`，执行 · exec）

### 可重做历史记录 · Can Redo History

`blueprint.game.history.canRedo` · 纯数据节点，没有执行针脚 · Pure: no exec pins

- 可放在 · Allowed in: 应用逻辑 · App logic、页面逻辑 · Page logic、控件逻辑 · Widget logic、控件取值 · Widget value、组件内的控件逻辑 · Widget logic inside a component
- 输出 · Out：可重做 · Can Redo（`canRedo`，boolean）

### 可撤销历史记录 · Can Undo History

`blueprint.game.history.canUndo` · 纯数据节点，没有执行针脚 · Pure: no exec pins

- 可放在 · Allowed in: 应用逻辑 · App logic、页面逻辑 · Page logic、控件逻辑 · Widget logic、控件取值 · Widget value、组件内的控件逻辑 · Widget logic inside a component
- 输出 · Out：可撤销 · Can Undo（`canUndo`，boolean）

### 检查存储是否持久 · Check Storage Durability

`blueprint.game.storageDurability` · 会等待，完成后才继续 · Latent: waits before continuing

- 可放在 · Allowed in: 应用逻辑 · App logic、页面逻辑 · Page logic、控件逻辑 · Widget logic、组件内的控件逻辑 · Widget logic inside a component
- 输入 · In：进入 · In（`in`，执行 · exec）
- 输出 · Out：持久 · Durable（`durable`，执行 · exec）
- 输出 · Out：可能被清除 · Evictable（`evictable`，执行 · exec）
- 输出 · Out：未知 · Unknown（`unknown`，执行 · exec）

### 清除单个结局记录 · Clear Ending State

`blueprint.game.clearEndingState` · 会等待，完成后才继续 · Latent: waits before continuing

- 可放在 · Allowed in: 应用逻辑 · App logic、页面逻辑 · Page logic、控件逻辑 · Widget logic、组件内的控件逻辑 · Widget logic inside a component
- 输入 · In：进入 · In（`in`，执行 · exec）
- 输出 · Out：下一步 · Next（`next`，执行 · exec）
- 设置 · Setting：故事 · Story（`storyId`）
- 设置 · Setting：结局 · Ending（`endingId`）

### 清除结局记录 · Clear Endings

`blueprint.game.clearEndings` · 会等待，完成后才继续 · Latent: waits before continuing

- 可放在 · Allowed in: 应用逻辑 · App logic、页面逻辑 · Page logic、控件逻辑 · Widget logic、组件内的控件逻辑 · Widget logic inside a component
- 输入 · In：进入 · In（`in`，执行 · exec）
- 输出 · Out：下一步 · Next（`next`，执行 · exec）

### 清除已读记录 · Clear Text Read

`blueprint.game.clearTextRead` · 会等待，完成后才继续 · Latent: waits before continuing

- 可放在 · Allowed in: 应用逻辑 · App logic、页面逻辑 · Page logic、控件逻辑 · Widget logic、组件内的控件逻辑 · Widget logic inside a component
- 输入 · In：进入 · In（`in`，执行 · exec）
- 输出 · Out：下一步 · Next（`next`，执行 · exec）

### 清除访问记录 · Clear Visited

`blueprint.game.clearVisited`

- 可放在 · Allowed in: 应用逻辑 · App logic、页面逻辑 · Page logic、控件逻辑 · Widget logic、组件内的控件逻辑 · Widget logic inside a component
- 输入 · In：进入 · In（`in`，执行 · exec）
- 输出 · Out：下一步 · Next（`next`，执行 · exec）

### 当前游戏 · Current Game

`blueprint.game.save.currentRun` · 会等待，完成后才继续 · Latent: waits before continuing

- 可放在 · Allowed in: 应用逻辑 · App logic、页面逻辑 · Page logic、控件逻辑 · Widget logic、组件内的控件逻辑 · Widget logic inside a component
- 输入 · In：进入 · In（`in`，执行 · exec）
- 输出 · Out：下一步 · Next（`next`，执行 · exec）
- 输出 · Out：存档槽 · Slot（`slot`，SaveSlot）

### 删除存档 · Delete Save

`blueprint.game.save.delete` · 会等待，完成后才继续 · Latent: waits before continuing

- 可放在 · Allowed in: 应用逻辑 · App logic、页面逻辑 · Page logic、控件逻辑 · Widget logic、组件内的控件逻辑 · Widget logic inside a component
- 输入 · In：进入 · In（`in`，执行 · exec）
- 输出 · Out：下一步 · Next（`next`，执行 · exec）
- 输入 · In：Id（`id`，string；可直接填值 · accepts a typed value；与 `slot` 任选其一 · one of a group）
- 输入 · In：存档槽 · Slot（`slot`，SaveSlot；可不连 · optional；与 `id` 任选其一 · one of a group）

### 导出进度 · Export Progress

`blueprint.game.progress.export` · 会等待，完成后才继续 · Latent: waits before continuing

- 可放在 · Allowed in: 应用逻辑 · App logic、页面逻辑 · Page logic、控件逻辑 · Widget logic、组件内的控件逻辑 · Widget logic inside a component
- 输入 · In：进入 · In（`in`，执行 · exec）
- 输出 · Out：下一步 · Next（`next`，执行 · exec）
- 输出 · Out：失败 · Failed（`failed`，执行 · exec）
- 输出 · Out：错误 · Error（`error`，string）

### 获取自动前进 · Get Auto Forward

`blueprint.game.getAutoForward` · 纯数据节点，没有执行针脚 · Pure: no exec pins

- 可放在 · Allowed in: 应用逻辑 · App logic、页面逻辑 · Page logic、控件逻辑 · Widget logic、控件取值 · Widget value、组件内的控件逻辑 · Widget logic inside a component
- 输出 · Out：自动前进 · Auto Forward（`autoForward`，boolean）

### 获取自动前进延迟 · Get Auto Forward Delay

`blueprint.game.getAutoForwardDelay` · 纯数据节点，没有执行针脚 · Pure: no exec pins

- 可放在 · Allowed in: 应用逻辑 · App logic、页面逻辑 · Page logic、控件逻辑 · Widget logic、控件取值 · Widget value、组件内的控件逻辑 · Widget logic inside a component
- 输出 · Out：自动前进延迟 · Auto Forward Delay（`autoForwardDelay`，float）

### 获取音乐音量 · Get BGM Volume

`blueprint.game.getBgmVolume` · 纯数据节点，没有执行针脚 · Pure: no exec pins

- 可放在 · Allowed in: 应用逻辑 · App logic、页面逻辑 · Page logic、控件逻辑 · Widget logic、控件取值 · Widget value、组件内的控件逻辑 · Widget logic inside a component
- 输出 · Out：音乐音量 · BGM Volume（`bgmVolume`，float）

### 获取构建变体 · Get Build Variant

`blueprint.game.getAppTag` · 纯数据节点，没有执行针脚 · Pure: no exec pins

- 可放在 · Allowed in: 应用逻辑 · App logic、页面逻辑 · Page logic、控件逻辑 · Widget logic、控件取值 · Widget value、组件内的控件逻辑 · Widget logic inside a component、故事动作 · Story action
- 输出 · Out：构建变体 · Build Variant（`appTag`，string）

### 获取角色 · Get Character

`blueprint.game.getCharacter` · 纯数据节点，没有执行针脚 · Pure: no exec pins

- 可放在 · Allowed in: 应用逻辑 · App logic、页面逻辑 · Page logic、控件逻辑 · Widget logic、控件取值 · Widget value、组件内的控件逻辑 · Widget logic inside a component
- 输出 · Out：名称 · Name（`name`，string）
- 输出 · Out：颜色 · Color（`characterColor`，RGBAColor）
- 输出 · Out：头像 · Avatar（`characterAvatar`，ImageAsset|null）
- 输出 · Out：已找到 · Found（`found`，boolean）
- 设置 · Setting：角色 · Character（`characterId`）

### 获取选项数量 · Get Choice Count

`blueprint.game.getChoiceCount` · 纯数据节点，没有执行针脚 · Pure: no exec pins

- 可放在 · Allowed in: 应用逻辑 · App logic、页面逻辑 · Page logic、控件逻辑 · Widget logic、控件取值 · Widget value、组件内的控件逻辑 · Widget logic inside a component
- 输出 · Out：数量 · Count（`count`，integer）

### 获取对话框文本 · Get Dialog Text

`blueprint.game.getDialogText` · 纯数据节点，没有执行针脚 · Pure: no exec pins

- 可放在 · Allowed in: 应用逻辑 · App logic、页面逻辑 · Page logic、控件逻辑 · Widget logic、控件取值 · Widget value、组件内的控件逻辑 · Widget logic inside a component
- 输出 · Out：文本 · Text（`text`，string）

### 获取结局列表 · Get Endings

`blueprint.game.getEndings` · 纯数据节点，没有执行针脚 · Pure: no exec pins

- 可放在 · Allowed in: 应用逻辑 · App logic、页面逻辑 · Page logic、控件逻辑 · Widget logic、控件取值 · Widget value、组件内的控件逻辑 · Widget logic inside a component
- 输出 · Out：结局列表 · Endings（`endings`，array<struct:nl.ending>）
- 设置 · Setting：故事 · Story（`storyId`）

### 获取前方历史记录 · Get Future History

`blueprint.game.history.getFuture` · 会等待，完成后才继续 · Latent: waits before continuing

- 可放在 · Allowed in: 应用逻辑 · App logic、页面逻辑 · Page logic、控件逻辑 · Widget logic、组件内的控件逻辑 · Widget logic inside a component
- 输入 · In：进入 · In（`in`，执行 · exec）
- 输出 · Out：下一步 · Next（`next`，执行 · exec）
- 输出 · Out：条目 · Entries（`entries`，array<struct:nl.historyEntry>）
- 输出 · Out：数量 · Count（`count`，integer）

### 获取游戏速度 · Get Game Speed

`blueprint.game.getGameSpeed` · 纯数据节点，没有执行针脚 · Pure: no exec pins

- 可放在 · Allowed in: 应用逻辑 · App logic、页面逻辑 · Page logic、控件逻辑 · Widget logic、控件取值 · Widget value、组件内的控件逻辑 · Widget logic inside a component
- 输出 · Out：游戏速度 · Game Speed（`gameSpeed`，float）

### 获取总音量 · Get Global Volume

`blueprint.game.getGlobalVolume` · 纯数据节点，没有执行针脚 · Pure: no exec pins

- 可放在 · Allowed in: 应用逻辑 · App logic、页面逻辑 · Page logic、控件逻辑 · Widget logic、控件取值 · Widget value、组件内的控件逻辑 · Widget logic inside a component
- 输出 · Out：总音量 · Global Volume（`globalVolume`，float）

### 获取历史记录 · Get History

`blueprint.game.history.get` · 会等待，完成后才继续 · Latent: waits before continuing

- 可放在 · Allowed in: 应用逻辑 · App logic、页面逻辑 · Page logic、控件逻辑 · Widget logic、组件内的控件逻辑 · Widget logic inside a component
- 输入 · In：进入 · In（`in`，执行 · exec）
- 输出 · Out：下一步 · Next（`next`，执行 · exec）
- 输出 · Out：条目 · Entries（`entries`，array<struct:nl.historyEntry>）
- 输出 · Out：数量 · Count（`count`，integer）

### 获取最新自动存档 · Get Latest Auto Save

`blueprint.game.autoSave.latest` · 会等待，完成后才继续 · Latent: waits before continuing

- 可放在 · Allowed in: 应用逻辑 · App logic、页面逻辑 · Page logic、控件逻辑 · Widget logic、组件内的控件逻辑 · Widget logic inside a component
- 输入 · In：进入 · In（`in`，执行 · exec）
- 输出 · Out：下一步 · Next（`next`，执行 · exec）
- 输出 · Out：Id（`id`，string）
- 输出 · Out：有自动存档 · Has Auto Save（`hasAutoSave`，boolean）
- 输出 · Out：时间戳 · Timestamp（`timestamp`，float）

### 获取失去焦点时静音 · Get Mute When Unfocused

`blueprint.game.getMuteOnWindowBlur` · 纯数据节点，没有执行针脚 · Pure: no exec pins

- 可放在 · Allowed in: 应用逻辑 · App logic、页面逻辑 · Page logic、控件逻辑 · Widget logic、控件取值 · Widget value、组件内的控件逻辑 · Widget logic inside a component
- 输出 · Out：失去焦点时静音 · Mute When Unfocused（`muteOnWindowBlur`，boolean）

### 获取名牌 · Get Nametag

`blueprint.game.getNametag` · 纯数据节点，没有执行针脚 · Pure: no exec pins

- 可放在 · Allowed in: 应用逻辑 · App logic、页面逻辑 · Page logic、控件逻辑 · Widget logic、控件取值 · Widget value、组件内的控件逻辑 · Widget logic inside a component
- 输出 · Out：名牌 · Nametag（`nametag`，string）

### 获取通知 · Get Notifications

`blueprint.game.getNotifications` · 纯数据节点，没有执行针脚 · Pure: no exec pins

- 可放在 · Allowed in: 应用逻辑 · App logic、页面逻辑 · Page logic、控件逻辑 · Widget logic、控件取值 · Widget value、组件内的控件逻辑 · Widget logic inside a component
- 输出 · Out：通知 · Notifications（`notifications`，array<struct:nl.notificationItem>）

### 获取游玩时长 · Get Playtime

`blueprint.game.getPlaytime` · 纯数据节点，没有执行针脚 · Pure: no exec pins

- 可放在 · Allowed in: 应用逻辑 · App logic、页面逻辑 · Page logic、控件逻辑 · Widget logic、控件取值 · Widget value、组件内的控件逻辑 · Widget logic inside a component
- 输出 · Out：秒 · Seconds（`playtimeSeconds`，float）
- 输出 · Out：毫秒 · Milliseconds（`playtimeMilliseconds`，float）

### 获取存档语句 · Get Save Line

`blueprint.game.save.getLine` · 会等待，完成后才继续 · Latent: waits before continuing

- 可放在 · Allowed in: 应用逻辑 · App logic、页面逻辑 · Page logic、控件逻辑 · Widget logic、组件内的控件逻辑 · Widget logic inside a component
- 输入 · In：进入 · In（`in`，执行 · exec）
- 输出 · Out：下一步 · Next（`next`，执行 · exec）
- 输入 · In：Id（`id`，string；可直接填值 · accepts a typed value；与 `slot` 任选其一 · one of a group）
- 输入 · In：存档槽 · Slot（`slot`，SaveSlot；可不连 · optional；与 `id` 任选其一 · one of a group）
- 输出 · Out：语句 · Line（`line`，string）
- 输出 · Out：说话人 · Speaker（`speaker`，string）
- 输出 · Out：存在 · Exists（`exists`，boolean）

### 获取存档元数据 · Get Save Metadata

`blueprint.game.save.getMetadata` · 会等待，完成后才继续 · Latent: waits before continuing

- 可放在 · Allowed in: 应用逻辑 · App logic、页面逻辑 · Page logic、控件逻辑 · Widget logic、组件内的控件逻辑 · Widget logic inside a component
- 输入 · In：进入 · In（`in`，执行 · exec）
- 输出 · Out：下一步 · Next（`next`，执行 · exec）
- 输入 · In：Id（`id`，string；可直接填值 · accepts a typed value；与 `slot` 任选其一 · one of a group）
- 输入 · In：存档槽 · Slot（`slot`，SaveSlot；可不连 · optional；与 `id` 任选其一 · one of a group）
- 输出 · Out：元数据 · Metadata（`metadata`，json）

### 获取存档游玩时长 · Get Save Playtime

`blueprint.game.save.getPlaytime` · 会等待，完成后才继续 · Latent: waits before continuing

- 可放在 · Allowed in: 应用逻辑 · App logic、页面逻辑 · Page logic、控件逻辑 · Widget logic、组件内的控件逻辑 · Widget logic inside a component
- 输入 · In：进入 · In（`in`，执行 · exec）
- 输出 · Out：下一步 · Next（`next`，执行 · exec）
- 输入 · In：Id（`id`，string；可直接填值 · accepts a typed value；与 `slot` 任选其一 · one of a group）
- 输入 · In：存档槽 · Slot（`slot`，SaveSlot；可不连 · optional；与 `id` 任选其一 · one of a group）
- 输出 · Out：秒 · Seconds（`playtimeSeconds`，float）
- 输出 · Out：毫秒 · Milliseconds（`playtimeMilliseconds`，float）
- 输出 · Out：已记录 · Recorded（`recorded`，boolean）
- 输出 · Out：存在 · Exists（`exists`，boolean）

### 获取存档预览 · Get Save Preview

`blueprint.game.save.getPreview` · 会等待，完成后才继续 · Latent: waits before continuing

- 可放在 · Allowed in: 应用逻辑 · App logic、页面逻辑 · Page logic、控件逻辑 · Widget logic、组件内的控件逻辑 · Widget logic inside a component
- 输入 · In：进入 · In（`in`，执行 · exec）
- 输出 · Out：下一步 · Next（`next`，执行 · exec）
- 输入 · In：Id（`id`，string；可直接填值 · accepts a typed value；与 `slot` 任选其一 · one of a group）
- 输入 · In：存档槽 · Slot（`slot`，SaveSlot；可不连 · optional；与 `id` 任选其一 · one of a group）
- 输出 · Out：预览 · Preview（`preview`，ImageAsset|null）

### 获取存档故事 · Get Save Story

`blueprint.game.save.getStory` · 会等待，完成后才继续 · Latent: waits before continuing

- 可放在 · Allowed in: 应用逻辑 · App logic、页面逻辑 · Page logic、控件逻辑 · Widget logic、组件内的控件逻辑 · Widget logic inside a component
- 输入 · In：进入 · In（`in`，执行 · exec）
- 输出 · Out：下一步 · Next（`next`，执行 · exec）
- 输入 · In：Id（`id`，string；可直接填值 · accepts a typed value；与 `slot` 任选其一 · one of a group）
- 输入 · In：存档槽 · Slot（`slot`，SaveSlot；可不连 · optional；与 `id` 任选其一 · one of a group）
- 输出 · Out：故事名称 · Story Name（`storyName`，string）
- 输出 · Out：故事 Id · Story Id（`storyId`，string）
- 输出 · Out：存在 · Exists（`exists`，boolean）

### 获取存档时间 · Get Save Time

`blueprint.game.save.getTime` · 会等待，完成后才继续 · Latent: waits before continuing

- 可放在 · Allowed in: 应用逻辑 · App logic、页面逻辑 · Page logic、控件逻辑 · Widget logic、组件内的控件逻辑 · Widget logic inside a component
- 输入 · In：进入 · In（`in`，执行 · exec）
- 输出 · Out：下一步 · Next（`next`，执行 · exec）
- 输入 · In：Id（`id`，string；可直接填值 · accepts a typed value；与 `slot` 任选其一 · one of a group）
- 输入 · In：存档槽 · Slot（`slot`，SaveSlot；可不连 · optional；与 `id` 任选其一 · one of a group）
- 输出 · Out：保存时间 · Saved At（`savedAt`，float）
- 输出 · Out：创建时间 · Created At（`createdAt`，float）
- 输出 · Out：存在 · Exists（`exists`，boolean）

### 获取文字速度 · Get Sentence Speed

`blueprint.game.getCps` · 纯数据节点，没有执行针脚 · Pure: no exec pins

- 可放在 · Allowed in: 应用逻辑 · App logic、页面逻辑 · Page logic、控件逻辑 · Widget logic、控件取值 · Widget value、组件内的控件逻辑 · Widget logic inside a component
- 输出 · Out：CPS（`cps`，float）

### 获取音效音量 · Get SFX Volume

`blueprint.game.getSoundVolume` · 纯数据节点，没有执行针脚 · Pure: no exec pins

- 可放在 · Allowed in: 应用逻辑 · App logic、页面逻辑 · Page logic、控件逻辑 · Widget logic、控件取值 · Widget value、组件内的控件逻辑 · Widget logic inside a component
- 输出 · Out：音效音量 · SFX Volume（`soundVolume`，float）

### 获取跳过 · Get Skip

`blueprint.game.getSkip` · 纯数据节点，没有执行针脚 · Pure: no exec pins

- 可放在 · Allowed in: 应用逻辑 · App logic、页面逻辑 · Page logic、控件逻辑 · Widget logic、控件取值 · Widget value、组件内的控件逻辑 · Widget logic inside a component
- 输出 · Out：跳过 · Skip（`skip`，boolean）

### 获取跳过延迟 · Get Skip Delay

`blueprint.game.getSkipDelay` · 纯数据节点，没有执行针脚 · Pure: no exec pins

- 可放在 · Allowed in: 应用逻辑 · App logic、页面逻辑 · Page logic、控件逻辑 · Widget logic、控件取值 · Widget value、组件内的控件逻辑 · Widget logic inside a component
- 输出 · Out：跳过延迟 · Skip Delay（`skipDelay`，float）

### 获取跳过间隔 · Get Skip Interval

`blueprint.game.getSkipInterval` · 纯数据节点，没有执行针脚 · Pure: no exec pins

- 可放在 · Allowed in: 应用逻辑 · App logic、页面逻辑 · Page logic、控件逻辑 · Widget logic、控件取值 · Widget value、组件内的控件逻辑 · Widget logic inside a component
- 输出 · Out：跳过间隔 · Skip Interval（`skipInterval`，float）

### 获取跳过已读文本 · Get Skip Read Text

`blueprint.game.getSkipReadText` · 纯数据节点，没有执行针脚 · Pure: no exec pins

- 可放在 · Allowed in: 应用逻辑 · App logic、页面逻辑 · Page logic、控件逻辑 · Widget logic、控件取值 · Widget value、组件内的控件逻辑 · Widget logic inside a component
- 输出 · Out：跳过已读文本 · Skip Read Text（`skipReadText`，boolean）

### 获取持续跳过 · Get Skipping

`blueprint.game.getSkipping` · 纯数据节点，没有执行针脚 · Pure: no exec pins

- 可放在 · Allowed in: 应用逻辑 · App logic、页面逻辑 · Page logic、控件逻辑 · Widget logic、控件取值 · Widget value、组件内的控件逻辑 · Widget logic inside a component
- 输出 · Out：持续跳过 · Skipping（`skipping`，boolean）

### 获取说话人头像 · Get Speaker Avatar

`blueprint.game.getSpeakerAvatar` · 纯数据节点，没有执行针脚 · Pure: no exec pins

- 可放在 · Allowed in: 应用逻辑 · App logic、页面逻辑 · Page logic、控件逻辑 · Widget logic、控件取值 · Widget value、组件内的控件逻辑 · Widget logic inside a component
- 输出 · Out：头像 · Avatar（`avatar`，ImageAsset|null）

### 获取说话人主色 · Get Speaker Color

`blueprint.game.getSpeakerColor` · 纯数据节点，没有执行针脚 · Pure: no exec pins

- 可放在 · Allowed in: 应用逻辑 · App logic、页面逻辑 · Page logic、控件逻辑 · Widget logic、控件取值 · Widget value、组件内的控件逻辑 · Widget logic inside a component
- 输出 · Out：颜色 · Color（`color`，RGBAColor）

### 获取文字渐入 · Get Text Fade In

`blueprint.game.getTextRevealDuration` · 纯数据节点，没有执行针脚 · Pure: no exec pins

- 可放在 · Allowed in: 应用逻辑 · App logic、页面逻辑 · Page logic、控件逻辑 · Widget logic、控件取值 · Widget value、组件内的控件逻辑 · Widget logic inside a component
- 输出 · Out：文字渐入 · Text Fade In（`textRevealDuration`，float）

### 获取累计游玩时长 · Get Total Playtime

`blueprint.game.getTotalPlaytime` · 纯数据节点，没有执行针脚 · Pure: no exec pins

- 可放在 · Allowed in: 应用逻辑 · App logic、页面逻辑 · Page logic、控件逻辑 · Widget logic、控件取值 · Widget value、组件内的控件逻辑 · Widget logic inside a component
- 输出 · Out：秒 · Seconds（`totalPlaytimeSeconds`，float）
- 输出 · Out：毫秒 · Milliseconds（`totalPlaytimeMilliseconds`，float）

### 获取音轨音量 · Get Track Volume

`blueprint.game.getTrackVolume` · 纯数据节点，没有执行针脚 · Pure: no exec pins

- 可放在 · Allowed in: 应用逻辑 · App logic、页面逻辑 · Page logic、控件逻辑 · Widget logic、控件取值 · Widget value、组件内的控件逻辑 · Widget logic inside a component
- 输入 · In：音轨 · Track（`audioTrackId`，string；可不连 · optional）
- 输出 · Out：音量 · Volume（`volume`，float）
- 设置 · Setting：音轨 · Track（`audioTrackId`）

### 获取语音结束模式 · Get Voice End Mode

`blueprint.game.getVoiceEndMode` · 纯数据节点，没有执行针脚 · Pure: no exec pins

- 可放在 · Allowed in: 应用逻辑 · App logic、页面逻辑 · Page logic、控件逻辑 · Widget logic、控件取值 · Widget value、组件内的控件逻辑 · Widget logic inside a component
- 输出 · Out：语音结束模式 · Voice End Mode（`voiceEndMode`，string）

### 获取语音淡变时长 · Get Voice Fade Duration

`blueprint.game.getVoiceFadeDuration` · 纯数据节点，没有执行针脚 · Pure: no exec pins

- 可放在 · Allowed in: 应用逻辑 · App logic、页面逻辑 · Page logic、控件逻辑 · Widget logic、控件取值 · Widget value、组件内的控件逻辑 · Widget logic inside a component
- 输出 · Out：语音淡出 · Voice Fade（`voiceFadeDuration`，float）

### 获取语音音量 · Get Voice Volume

`blueprint.game.getVoiceVolume` · 纯数据节点，没有执行针脚 · Pure: no exec pins

- 可放在 · Allowed in: 应用逻辑 · App logic、页面逻辑 · Page logic、控件逻辑 · Widget logic、控件取值 · Widget value、组件内的控件逻辑 · Widget logic inside a component
- 输出 · Out：语音音量 · Voice Volume（`voiceVolume`，float）

### 是否有快速存档 · Has Quick Save

`narraleaf.quick-save.has` · 会等待，完成后才继续 · Latent: waits before continuing

- 可放在 · Allowed in: 应用逻辑 · App logic、页面逻辑 · Page logic、控件逻辑 · Widget logic、组件内的控件逻辑 · Widget logic inside a component、故事动作 · Story action
- 输入 · In：进入 · In（`in`，执行 · exec）
- 输出 · Out：下一步 · Next（`next`，执行 · exec）
- 输出 · Out：有存档 · Has Save（`hasQuickSave`，boolean）

### 指定文本是否已读 · Has Read Text

`blueprint.game.isTextReadById` · 纯数据节点，没有执行针脚 · Pure: no exec pins

- 可放在 · Allowed in: 应用逻辑 · App logic、页面逻辑 · Page logic、控件逻辑 · Widget logic、控件取值 · Widget value、组件内的控件逻辑 · Widget logic inside a component
- 输入 · In：文本 Id · Text Id（`textId`，string；可直接填值 · accepts a typed value）
- 输出 · Out：已读 · Has Read（`isRead`，boolean）

### 隐藏对话框 · Hide Dialog

`blueprint.game.hideDialog` · 会等待，完成后才继续 · Latent: waits before continuing

- 可放在 · Allowed in: 应用逻辑 · App logic、页面逻辑 · Page logic、控件逻辑 · Widget logic、组件内的控件逻辑 · Widget logic inside a component
- 输入 · In：进入 · In（`in`，执行 · exec）
- 输出 · Out：下一步 · Next（`next`，执行 · exec）

### 导入进度 · Import Progress

`blueprint.game.progress.import` · 会等待，完成后才继续 · Latent: waits before continuing

- 可放在 · Allowed in: 应用逻辑 · App logic、页面逻辑 · Page logic、控件逻辑 · Widget logic、组件内的控件逻辑 · Widget logic inside a component
- 输入 · In：进入 · In（`in`，执行 · exec）
- 输出 · Out：已找到 · Found（`found`，执行 · exec）
- 输出 · Out：不存在 · Missing（`missing`，执行 · exec）
- 输出 · Out：失败 · Failed（`failed`，执行 · exec）
- 输出 · Out：场景 · Scene（`sceneId`，string）
- 输出 · Out：错误 · Error（`error`，string）

### 对话框是否显示 · Is Dialog Shown

`blueprint.game.isDialogShown` · 纯数据节点，没有执行针脚 · Pure: no exec pins

- 可放在 · Allowed in: 应用逻辑 · App logic、页面逻辑 · Page logic、控件逻辑 · Widget logic、控件取值 · Widget value、组件内的控件逻辑 · Widget logic inside a component
- 输出 · Out：显示中 · Is Shown（`isShown`，boolean）

### 对话框是否等待推进 · Is Dialog Waiting

`blueprint.game.isDialogWaiting` · 纯数据节点，没有执行针脚 · Pure: no exec pins

- 可放在 · Allowed in: 应用逻辑 · App logic、页面逻辑 · Page logic、控件逻辑 · Widget logic、控件取值 · Widget value、组件内的控件逻辑 · Widget logic inside a component
- 输出 · Out：等待推进 · Is Waiting（`isWaiting`，boolean）

### DLC 是否已安装 · Is DLC Installed

`blueprint.game.isDlcInstalled` · 纯数据节点，没有执行针脚 · Pure: no exec pins

- 可放在 · Allowed in: 应用逻辑 · App logic、页面逻辑 · Page logic、控件逻辑 · Widget logic、控件取值 · Widget value、组件内的控件逻辑 · Widget logic inside a component
- 输出 · Out：是否已安装 · Is Installed（`isInstalled`，boolean）
- 设置 · Setting：DLC（`dlcId`）

### 结局是否达成 · Is Ending Reached

`blueprint.game.isEndingReached` · 纯数据节点，没有执行针脚 · Pure: no exec pins

- 可放在 · Allowed in: 应用逻辑 · App logic、页面逻辑 · Page logic、控件逻辑 · Widget logic、控件取值 · Widget value、组件内的控件逻辑 · Widget logic inside a component
- 输出 · Out：已达成 · Is Reached（`isReached`，boolean）
- 设置 · Setting：故事 · Story（`storyId`）
- 设置 · Setting：结局 · Ending（`endingId`）

### 是否为游戏覆盖层 · Is Game Overlay

`blueprint.game.isGameOverlay` · 纯数据节点，没有执行针脚 · Pure: no exec pins

所在的页面、叠加页面或游戏 UI 显示在进行中的游戏之上时为真。在应用逻辑中，有页面或模态叠加页面覆盖剧情画面时为真

True when this page, layer or Game UI is shown over a running game. In App logic, true while a page or a modal layer covers the story.

- 可放在 · Allowed in: 应用逻辑 · App logic、页面逻辑 · Page logic、控件逻辑 · Widget logic、控件取值 · Widget value、组件内的控件逻辑 · Widget logic inside a component
- 输出 · Out：游戏覆盖层 · Game Overlay（`isGameOverlay`，boolean）

### 是否在游戏中 · Is In Game

`blueprint.game.isInGame` · 纯数据节点，没有执行针脚 · Pure: no exec pins

- 可放在 · Allowed in: 应用逻辑 · App logic、页面逻辑 · Page logic、控件逻辑 · Widget logic、控件取值 · Widget value、组件内的控件逻辑 · Widget logic inside a component
- 输出 · Out：游戏中 · In Game（`isInGame`，boolean）

### 是否为旁白 · Is Narrator

`blueprint.game.isNarrator` · 纯数据节点，没有执行针脚 · Pure: no exec pins

- 可放在 · Allowed in: 应用逻辑 · App logic、页面逻辑 · Page logic、控件逻辑 · Widget logic、控件取值 · Widget value、组件内的控件逻辑 · Widget logic inside a component
- 输出 · Out：旁白 · Is Narrator（`isNarrator`，boolean）

### 是否为 NVL 模式 · Is NVL Mode

`blueprint.game.isNvlMode` · 纯数据节点，没有执行针脚 · Pure: no exec pins

- 可放在 · Allowed in: 应用逻辑 · App logic、页面逻辑 · Page logic、控件逻辑 · Widget logic、控件取值 · Widget value、组件内的控件逻辑 · Widget logic inside a component
- 输出 · Out：NVL 模式 · NVL Mode（`isNvlMode`，boolean）

### 选项是否选过 · Is Option Picked

`blueprint.game.isOptionPicked` · 纯数据节点，没有执行针脚 · Pure: no exec pins

- 可放在 · Allowed in: 应用逻辑 · App logic、页面逻辑 · Page logic、控件逻辑 · Widget logic、控件取值 · Widget value、组件内的控件逻辑 · Widget logic inside a component
- 输入 · In：故事 Id · Story Id（`storyId`，string；可不连 · optional）
- 输入 · In：选项 Id · Option Id（`optionId`，string；可不连 · optional）
- 输出 · Out：已选过 · Is Picked（`isPicked`，boolean）
- 设置 · Setting：故事 · Story（`storyId`）
- 设置 · Setting：选项 · Option（`optionId`）

### 场景是否访问过 · Is Scene Visited

`blueprint.game.isSceneVisited` · 纯数据节点，没有执行针脚 · Pure: no exec pins

- 可放在 · Allowed in: 应用逻辑 · App logic、页面逻辑 · Page logic、控件逻辑 · Widget logic、控件取值 · Widget value、组件内的控件逻辑 · Widget logic inside a component
- 输入 · In：故事 Id · Story Id（`storyId`，string；可不连 · optional）
- 输入 · In：场景 Id · Scene Id（`sceneId`，string；可不连 · optional）
- 输出 · Out：已访问 · Is Visited（`isVisited`，boolean）
- 设置 · Setting：故事 · Story（`storyId`）
- 设置 · Setting：场景 · Scene（`sceneId`）

### 文本是否已读 · Is Text Read

`blueprint.game.isTextRead` · 纯数据节点，没有执行针脚 · Pure: no exec pins

- 可放在 · Allowed in: 应用逻辑 · App logic、页面逻辑 · Page logic、控件逻辑 · Widget logic、控件取值 · Widget value、组件内的控件逻辑 · Widget logic inside a component
- 输出 · Out：已读 · Is Read（`isRead`，boolean）

### 列出自动存档 · List Auto Saves

`blueprint.game.autoSave.list` · 会等待，完成后才继续 · Latent: waits before continuing

- 可放在 · Allowed in: 应用逻辑 · App logic、页面逻辑 · Page logic、控件逻辑 · Widget logic、组件内的控件逻辑 · Widget logic inside a component
- 输入 · In：进入 · In（`in`，执行 · exec）
- 输出 · Out：下一步 · Next（`next`，执行 · exec）
- 输出 · Out：条目 · Entries（`entries`，array<struct:nl.saveEntry>）
- 输出 · Out：数量 · Count（`count`，integer）

### 列出存档 · List Saves

`blueprint.game.save.listIds` · 会等待，完成后才继续 · Latent: waits before continuing

- 可放在 · Allowed in: 应用逻辑 · App logic、页面逻辑 · Page logic、控件逻辑 · Widget logic、组件内的控件逻辑 · Widget logic inside a component
- 输入 · In：进入 · In（`in`，执行 · exec）
- 输出 · Out：下一步 · Next（`next`，执行 · exec）
- 输出 · Out：Id 列表 · Ids（`ids`，array<string>）

### 读取存档 · Load Save

`blueprint.game.save.load` · 会等待，完成后才继续 · Latent: waits before continuing

- 可放在 · Allowed in: 应用逻辑 · App logic、页面逻辑 · Page logic、控件逻辑 · Widget logic、组件内的控件逻辑 · Widget logic inside a component
- 输入 · In：进入 · In（`in`，执行 · exec）
- 输入 · In：Id（`id`，string；可直接填值 · accepts a typed value；与 `slot` 任选其一 · one of a group）
- 输入 · In：存档槽 · Slot（`slot`，SaveSlot；可不连 · optional；与 `id` 任选其一 · one of a group）
- 输出 · Out：失败 · Failed（`failed`，执行 · exec）

### 下一步 · Next

`blueprint.game.next` · 会等待，完成后才继续 · Latent: waits before continuing

- 可放在 · Allowed in: 应用逻辑 · App logic、页面逻辑 · Page logic、控件逻辑 · Widget logic、组件内的控件逻辑 · Widget logic inside a component
- 输入 · In：进入 · In（`in`，执行 · exec）
- 输出 · Out：下一步 · Next（`next`，执行 · exec）

### 发送通知 · Post Notification

`blueprint.game.postNotification`

在进行中的游戏里将「消息」显示为通知，位置与游戏自身的提示相同。项目有通知游戏 UI 时由其显示。「时长（秒）」以秒为单位，留空时使用默认的 3 秒。通知关闭前，「获取通知」会列出该条通知。需要进行中的游戏

Shows Message as a notification in the running game, in the same place as the game's own notices. A project with a Notifications Game UI shows it there. Duration is in seconds, and 3 seconds when left empty. Get Notifications lists the notification until it closes. Needs a running game.

- 可放在 · Allowed in: 应用逻辑 · App logic、页面逻辑 · Page logic、控件逻辑 · Widget logic、组件内的控件逻辑 · Widget logic inside a component
- 输入 · In：进入 · In（`in`，执行 · exec）
- 输出 · Out：下一步 · Next（`next`，执行 · exec）
- 输入 · In：消息 · Message（`message`，string；可直接填值 · accepts a typed value）
- 输入 · In：时长（秒） · Duration (s)（`duration`，float；可不连 · optional；可直接填值 · accepts a typed value）

### 快速读档 · Quick Read

`narraleaf.quick-save.load` · 会等待，完成后才继续 · Latent: waits before continuing

- 可放在 · Allowed in: 应用逻辑 · App logic、页面逻辑 · Page logic、控件逻辑 · Widget logic、组件内的控件逻辑 · Widget logic inside a component、故事动作 · Story action
- 输入 · In：进入 · In（`in`，执行 · exec）

### 快速存档 · Quick Save

`narraleaf.quick-save.save` · 会等待，完成后才继续 · Latent: waits before continuing

- 可放在 · Allowed in: 应用逻辑 · App logic、页面逻辑 · Page logic、控件逻辑 · Widget logic、组件内的控件逻辑 · Widget logic inside a component、故事动作 · Story action
- 输入 · In：进入 · In（`in`，执行 · exec）
- 输出 · Out：下一步 · Next（`next`，执行 · exec）

### 退出游戏 · Quit Game

`blueprint.game.quit` · 会等待，完成后才继续 · Latent: waits before continuing

- 可放在 · Allowed in: 应用逻辑 · App logic、页面逻辑 · Page logic、控件逻辑 · Widget logic、组件内的控件逻辑 · Widget logic inside a component
- 输入 · In：进入 · In（`in`，执行 · exec）
- 输入 · In：页面 Id · Page Id（`surfaceId`，string；可不连 · optional）
- 设置 · Setting：页面 · Page（`surfaceId`）

### 重做下一条历史记录 · Redo Next History Entry

`blueprint.game.history.redoNext` · 会等待，完成后才继续 · Latent: waits before continuing

- 可放在 · Allowed in: 应用逻辑 · App logic、页面逻辑 · Page logic、控件逻辑 · Widget logic、组件内的控件逻辑 · Widget logic inside a component
- 输入 · In：进入 · In（`in`，执行 · exec）
- 输出 · Out：下一步 · Next（`next`，执行 · exec）

### 从历史恢复 · Restore From History

`blueprint.game.history.restore` · 会等待，完成后才继续 · Latent: waits before continuing

- 可放在 · Allowed in: 应用逻辑 · App logic、页面逻辑 · Page logic、控件逻辑 · Widget logic、组件内的控件逻辑 · Widget logic inside a component
- 输入 · In：进入 · In（`in`，执行 · exec）
- 输出 · Out：下一步 · Next（`next`，执行 · exec）
- 输入 · In：条目 Id · Entry Id（`id`，string；可直接填值 · accepts a typed value）

### 保存游戏 · Save Game

`blueprint.game.save.write` · 会等待，完成后才继续 · Latent: waits before continuing

- 可放在 · Allowed in: 应用逻辑 · App logic、页面逻辑 · Page logic、控件逻辑 · Widget logic、组件内的控件逻辑 · Widget logic inside a component
- 输入 · In：进入 · In（`in`，执行 · exec）
- 输出 · Out：下一步 · Next（`next`，执行 · exec）
- 输入 · In：Id（`id`，string；可直接填值 · accepts a typed value；与 `slot` 任选其一 · one of a group）
- 输入 · In：存档槽 · Slot（`slot`，SaveSlot；可不连 · optional；与 `id` 任选其一 · one of a group）
- 输入 · In：元数据 · Metadata（`metadata`，json；可不连 · optional）
- 输入 · In：捕获 · Capture（`screenshot`，boolean；可不连 · optional；可直接填值 · accepts a typed value）

### 存档槽 · Save Slot

`blueprint.game.save.slot` · 纯数据节点，没有执行针脚 · Pure: no exec pins

- 可放在 · Allowed in: 应用逻辑 · App logic、页面逻辑 · Page logic、控件逻辑 · Widget logic、控件取值 · Widget value、组件内的控件逻辑 · Widget logic inside a component
- 输入 · In：Id（`id`，string；可直接填值 · accepts a typed value）
- 输出 · Out：存档槽 · Slot（`slot`，SaveSlot）

### 选择选项 · Select Choice

`blueprint.game.choose` · 会等待，完成后才继续 · Latent: waits before continuing

- 可放在 · Allowed in: 应用逻辑 · App logic、页面逻辑 · Page logic、控件逻辑 · Widget logic、组件内的控件逻辑 · Widget logic inside a component
- 输入 · In：进入 · In（`in`，执行 · exec）
- 输出 · Out：下一步 · Next（`next`，执行 · exec）
- 输入 · In：索引 · Index（`index`，integer；可直接填值 · accepts a typed value）

### 设置自动前进 · Set Auto Forward

`blueprint.game.setAutoForward` · 会等待，完成后才继续 · Latent: waits before continuing

- 可放在 · Allowed in: 应用逻辑 · App logic、页面逻辑 · Page logic、控件逻辑 · Widget logic、组件内的控件逻辑 · Widget logic inside a component
- 输入 · In：进入 · In（`in`，执行 · exec）
- 输出 · Out：下一步 · Next（`next`，执行 · exec）
- 输入 · In：自动前进 · Auto Forward（`autoForward`，boolean）

### 设置自动前进延迟 · Set Auto Forward Delay

`blueprint.game.setAutoForwardDelay` · 会等待，完成后才继续 · Latent: waits before continuing

- 可放在 · Allowed in: 应用逻辑 · App logic、页面逻辑 · Page logic、控件逻辑 · Widget logic、组件内的控件逻辑 · Widget logic inside a component
- 输入 · In：进入 · In（`in`，执行 · exec）
- 输出 · Out：下一步 · Next（`next`，执行 · exec）
- 输入 · In：自动前进延迟 · Auto Forward Delay（`autoForwardDelay`，float；可直接填值 · accepts a typed value）

### 设置音乐音量 · Set BGM Volume

`blueprint.game.setBgmVolume` · 会等待，完成后才继续 · Latent: waits before continuing

- 可放在 · Allowed in: 应用逻辑 · App logic、页面逻辑 · Page logic、控件逻辑 · Widget logic、组件内的控件逻辑 · Widget logic inside a component
- 输入 · In：进入 · In（`in`，执行 · exec）
- 输出 · Out：下一步 · Next（`next`，执行 · exec）
- 输入 · In：音乐音量 · BGM Volume（`bgmVolume`，float；可直接填值 · accepts a typed value）

### 设置游戏速度 · Set Game Speed

`blueprint.game.setGameSpeed` · 会等待，完成后才继续 · Latent: waits before continuing

- 可放在 · Allowed in: 应用逻辑 · App logic、页面逻辑 · Page logic、控件逻辑 · Widget logic、组件内的控件逻辑 · Widget logic inside a component
- 输入 · In：进入 · In（`in`，执行 · exec）
- 输出 · Out：下一步 · Next（`next`，执行 · exec）
- 输入 · In：游戏速度 · Game Speed（`gameSpeed`，float；可直接填值 · accepts a typed value）

### 设置总音量 · Set Global Volume

`blueprint.game.setGlobalVolume` · 会等待，完成后才继续 · Latent: waits before continuing

- 可放在 · Allowed in: 应用逻辑 · App logic、页面逻辑 · Page logic、控件逻辑 · Widget logic、组件内的控件逻辑 · Widget logic inside a component
- 输入 · In：进入 · In（`in`，执行 · exec）
- 输出 · Out：下一步 · Next（`next`，执行 · exec）
- 输入 · In：总音量 · Global Volume（`globalVolume`，float；可直接填值 · accepts a typed value）

### 设置失去焦点时静音 · Set Mute When Unfocused

`blueprint.game.setMuteOnWindowBlur` · 会等待，完成后才继续 · Latent: waits before continuing

- 可放在 · Allowed in: 应用逻辑 · App logic、页面逻辑 · Page logic、控件逻辑 · Widget logic、组件内的控件逻辑 · Widget logic inside a component
- 输入 · In：进入 · In（`in`，执行 · exec）
- 输出 · Out：下一步 · Next（`next`，执行 · exec）
- 输入 · In：失去焦点时静音 · Mute When Unfocused（`muteOnWindowBlur`，boolean）

### 设置文字速度 · Set Sentence Speed

`blueprint.game.setSentenceSpeed` · 会等待，完成后才继续 · Latent: waits before continuing

- 可放在 · Allowed in: 应用逻辑 · App logic、页面逻辑 · Page logic、控件逻辑 · Widget logic、组件内的控件逻辑 · Widget logic inside a component
- 输入 · In：进入 · In（`in`，执行 · exec）
- 输出 · Out：下一步 · Next（`next`，执行 · exec）
- 输入 · In：CPS（`cps`，float；可直接填值 · accepts a typed value）

### 设置音效音量 · Set SFX Volume

`blueprint.game.setSoundVolume` · 会等待，完成后才继续 · Latent: waits before continuing

- 可放在 · Allowed in: 应用逻辑 · App logic、页面逻辑 · Page logic、控件逻辑 · Widget logic、组件内的控件逻辑 · Widget logic inside a component
- 输入 · In：进入 · In（`in`，执行 · exec）
- 输出 · Out：下一步 · Next（`next`，执行 · exec）
- 输入 · In：音效音量 · SFX Volume（`soundVolume`，float；可直接填值 · accepts a typed value）

### 设置跳过 · Set Skip

`blueprint.game.setSkip` · 会等待，完成后才继续 · Latent: waits before continuing

- 可放在 · Allowed in: 应用逻辑 · App logic、页面逻辑 · Page logic、控件逻辑 · Widget logic、组件内的控件逻辑 · Widget logic inside a component
- 输入 · In：进入 · In（`in`，执行 · exec）
- 输出 · Out：下一步 · Next（`next`，执行 · exec）
- 输入 · In：跳过 · Skip（`skip`，boolean）

### 设置跳过延迟 · Set Skip Delay

`blueprint.game.setSkipDelay` · 会等待，完成后才继续 · Latent: waits before continuing

- 可放在 · Allowed in: 应用逻辑 · App logic、页面逻辑 · Page logic、控件逻辑 · Widget logic、组件内的控件逻辑 · Widget logic inside a component
- 输入 · In：进入 · In（`in`，执行 · exec）
- 输出 · Out：下一步 · Next（`next`，执行 · exec）
- 输入 · In：跳过延迟 · Skip Delay（`skipDelay`，float；可直接填值 · accepts a typed value）

### 设置跳过间隔 · Set Skip Interval

`blueprint.game.setSkipInterval` · 会等待，完成后才继续 · Latent: waits before continuing

- 可放在 · Allowed in: 应用逻辑 · App logic、页面逻辑 · Page logic、控件逻辑 · Widget logic、组件内的控件逻辑 · Widget logic inside a component
- 输入 · In：进入 · In（`in`，执行 · exec）
- 输出 · Out：下一步 · Next（`next`，执行 · exec）
- 输入 · In：跳过间隔 · Skip Interval（`skipInterval`，float；可直接填值 · accepts a typed value）

### 设置跳过已读文本 · Set Skip Read Text

`blueprint.game.setSkipReadText` · 会等待，完成后才继续 · Latent: waits before continuing

- 可放在 · Allowed in: 应用逻辑 · App logic、页面逻辑 · Page logic、控件逻辑 · Widget logic、组件内的控件逻辑 · Widget logic inside a component
- 输入 · In：进入 · In（`in`，执行 · exec）
- 输出 · Out：下一步 · Next（`next`，执行 · exec）
- 输入 · In：跳过已读文本 · Skip Read Text（`skipReadText`，boolean）

### 设置持续跳过 · Set Skipping

`blueprint.game.setSkipping` · 会等待，完成后才继续 · Latent: waits before continuing

- 可放在 · Allowed in: 应用逻辑 · App logic、页面逻辑 · Page logic、控件逻辑 · Widget logic、组件内的控件逻辑 · Widget logic inside a component
- 输入 · In：进入 · In（`in`，执行 · exec）
- 输出 · Out：下一步 · Next（`next`，执行 · exec）
- 输入 · In：持续跳过 · Skipping（`skipping`，boolean）

### 设置文字渐入 · Set Text Fade In

`blueprint.game.setTextRevealDuration` · 会等待，完成后才继续 · Latent: waits before continuing

- 可放在 · Allowed in: 应用逻辑 · App logic、页面逻辑 · Page logic、控件逻辑 · Widget logic、组件内的控件逻辑 · Widget logic inside a component
- 输入 · In：进入 · In（`in`，执行 · exec）
- 输出 · Out：下一步 · Next（`next`，执行 · exec）
- 输入 · In：文字渐入 · Text Fade In（`textRevealDuration`，float；可直接填值 · accepts a typed value）

### 设置音轨音量 · Set Track Volume

`blueprint.game.setTrackVolume` · 会等待，完成后才继续 · Latent: waits before continuing

- 可放在 · Allowed in: 应用逻辑 · App logic、页面逻辑 · Page logic、控件逻辑 · Widget logic、组件内的控件逻辑 · Widget logic inside a component
- 输入 · In：进入 · In（`in`，执行 · exec）
- 输出 · Out：下一步 · Next（`next`，执行 · exec）
- 输入 · In：音轨 · Track（`audioTrackId`，string；可不连 · optional）
- 输入 · In：音量 · Volume（`volume`，float；可直接填值 · accepts a typed value）
- 设置 · Setting：音轨 · Track（`audioTrackId`）

### 设置语音结束模式 · Set Voice End Mode

`blueprint.game.setVoiceEndMode` · 会等待，完成后才继续 · Latent: waits before continuing

- 可放在 · Allowed in: 应用逻辑 · App logic、页面逻辑 · Page logic、控件逻辑 · Widget logic、组件内的控件逻辑 · Widget logic inside a component
- 输入 · In：进入 · In（`in`，执行 · exec）
- 输出 · Out：下一步 · Next（`next`，执行 · exec）
- 输入 · In：语音结束模式 · Voice End Mode（`voiceEndMode`，string；可直接填值 · accepts a typed value）

### 设置语音淡变时长 · Set Voice Fade Duration

`blueprint.game.setVoiceFadeDuration` · 会等待，完成后才继续 · Latent: waits before continuing

- 可放在 · Allowed in: 应用逻辑 · App logic、页面逻辑 · Page logic、控件逻辑 · Widget logic、组件内的控件逻辑 · Widget logic inside a component
- 输入 · In：进入 · In（`in`，执行 · exec）
- 输出 · Out：下一步 · Next（`next`，执行 · exec）
- 输入 · In：语音淡出 · Voice Fade（`voiceFadeDuration`，float；可直接填值 · accepts a typed value）

### 设置语音音量 · Set Voice Volume

`blueprint.game.setVoiceVolume` · 会等待，完成后才继续 · Latent: waits before continuing

- 可放在 · Allowed in: 应用逻辑 · App logic、页面逻辑 · Page logic、控件逻辑 · Widget logic、组件内的控件逻辑 · Widget logic inside a component
- 输入 · In：进入 · In（`in`，执行 · exec）
- 输出 · Out：下一步 · Next（`next`，执行 · exec）
- 输入 · In：语音音量 · Voice Volume（`voiceVolume`，float；可直接填值 · accepts a typed value）

### 显示对话框 · Show Dialog

`blueprint.game.showDialog` · 会等待，完成后才继续 · Latent: waits before continuing

- 可放在 · Allowed in: 应用逻辑 · App logic、页面逻辑 · Page logic、控件逻辑 · Widget logic、组件内的控件逻辑 · Widget logic inside a component
- 输入 · In：进入 · In（`in`，执行 · exec）
- 输出 · Out：下一步 · Next（`next`，执行 · exec）

### 跳过 · Skip

`blueprint.game.skip` · 会等待，完成后才继续 · Latent: waits before continuing

- 可放在 · Allowed in: 应用逻辑 · App logic、页面逻辑 · Page logic、控件逻辑 · Widget logic、组件内的控件逻辑 · Widget logic inside a component
- 输入 · In：进入 · In（`in`，执行 · exec）
- 输出 · Out：下一步 · Next（`next`，执行 · exec）

### 开始游戏 · Start Game

`blueprint.game.startStory` · 会等待，完成后才继续 · Latent: waits before continuing

- 可放在 · Allowed in: 应用逻辑 · App logic、页面逻辑 · Page logic、控件逻辑 · Widget logic、组件内的控件逻辑 · Widget logic inside a component
- 输入 · In：进入 · In（`in`，执行 · exec）
- 输入 · In：故事 Id · Story Id（`storyId`，string；可不连 · optional）
- 输入 · In：场景 Id · Scene Id（`sceneId`，string；可不连 · optional）
- 输入 · In：起始行 · From Row（`startBlockId`，string；可不连 · optional）
- 输入 · In：继承自 · Inherit From（`inheritFrom`，SaveSlot；可不连 · optional）
- 设置 · Setting：故事 · Story（`storyId`）
- 设置 · Setting：场景 · Scene（`sceneId`）

### 切换对话框显示 · Toggle Dialog Display

`blueprint.game.toggleDialogDisplay` · 会等待，完成后才继续 · Latent: waits before continuing

- 可放在 · Allowed in: 应用逻辑 · App logic、页面逻辑 · Page logic、控件逻辑 · Widget logic、组件内的控件逻辑 · Widget logic inside a component
- 输入 · In：进入 · In（`in`，执行 · exec）
- 输出 · Out：下一步 · Next（`next`，执行 · exec）

### 撤销最后一条历史记录 · Undo Last History Entry

`blueprint.game.history.undoLast` · 会等待，完成后才继续 · Latent: waits before continuing

- 可放在 · Allowed in: 应用逻辑 · App logic、页面逻辑 · Page logic、控件逻辑 · Widget logic、组件内的控件逻辑 · Widget logic inside a component
- 输入 · In：进入 · In（`in`，执行 · exec）
- 输出 · Out：下一步 · Next（`next`，执行 · exec）
