# 蓝图节点：声音 · Sound

> 本文件由 NarraLeaf Studio 源码自动生成，请勿手动修改。
> Generated from the NarraLeaf Studio source. Do not edit by hand.

「声音 · Sound」分类下的 9 个节点。标题是节点面板里显示的名字（中文 · English）。

The 9 nodes in the "Sound" palette category, titled as the node palette shows them.

### 声音是否在播放 · Is Sound Playing

`blueprint.sound.isPlaying` · 会等待，完成后才继续 · Latent: waits before continuing

- 可放在 · Allowed in: 应用逻辑 · App logic、页面逻辑 · Page logic、控件逻辑 · Widget logic、组件内的控件逻辑 · Widget logic inside a component
- 输入 · In：进入 · In（`in`，执行 · exec）
- 输入 · In：句柄 · Handle（`handle`，SoundHandle）
- 输出 · Out：下一步 · Next（`next`，执行 · exec）
- 输出 · Out：播放中 · Is Playing（`isPlaying`，boolean）

### 暂停声音 · Pause Sound

`blueprint.sound.pause` · 会等待，完成后才继续 · Latent: waits before continuing

- 可放在 · Allowed in: 应用逻辑 · App logic、页面逻辑 · Page logic、控件逻辑 · Widget logic、组件内的控件逻辑 · Widget logic inside a component
- 输入 · In：进入 · In（`in`，执行 · exec）
- 输入 · In：句柄 · Handle（`handle`，SoundHandle）
- 输出 · Out：下一步 · Next（`next`，执行 · exec）

### 播放页面音乐 · Play Page Music

`blueprint.sound.playPageMusic` · 会等待，完成后才继续 · Latent: waits before continuing

在本蓝图所在页面打开期间，把这段音乐作为它的音乐，取代页面属性里设置的音乐。正在播放的音乐交接给它，已在播放的同一段音乐继续播放。返回下面的页面时，换回那个页面的音乐。游戏进行中不起作用：那时音乐由故事决定

Makes this the music of the page this graph runs on, for as long as the page is open, in place of the music set in its properties. The music playing hands over to it, and the same music already playing carries on. Going back to a page underneath brings that page's music back. Does nothing while a game is running: the story decides the music then.

- 可放在 · Allowed in: 应用逻辑 · App logic、页面逻辑 · Page logic、控件逻辑 · Widget logic、组件内的控件逻辑 · Widget logic inside a component
- 输入 · In：进入 · In（`in`，执行 · exec）
- 输入 · In：资产 Id · Asset Id（`assetId`，string；可不连 · optional）
- 输入 · In：音量 · Volume（`volume`，float；可不连 · optional；可直接填值 · accepts a typed value）
- 输入 · In：循环 · Loop（`loop`，boolean；可不连 · optional；可直接填值 · accepts a typed value）
- 输入 · In：淡变（秒） · Fade (s)（`fade`，float；可不连 · optional；可直接填值 · accepts a typed value）
- 输出 · Out：下一步 · Next（`next`，执行 · exec）
- 设置 · Setting：音频片段 · Clip（`soundAssetId`）
- 设置 · Setting：音轨 · Track（`audioTrackId`）

### 播放声音 · Play Sound

`blueprint.sound.play` · 会等待，完成后才继续 · Latent: waits before continuing

- 可放在 · Allowed in: 应用逻辑 · App logic、页面逻辑 · Page logic、控件逻辑 · Widget logic、组件内的控件逻辑 · Widget logic inside a component
- 输入 · In：进入 · In（`in`，执行 · exec）
- 输入 · In：资产 Id · Asset Id（`assetId`，string；可不连 · optional）
- 输入 · In：循环 · Loop（`loop`，boolean；可不连 · optional；可直接填值 · accepts a typed value）
- 输入 · In：音量 · Volume（`volume`，float；可不连 · optional；可直接填值 · accepts a typed value）
- 输入 · In：淡入（秒） · Fade In (s)（`fadeIn`，float；可不连 · optional；可直接填值 · accepts a typed value）
- 输出 · Out：下一步 · Next（`next`，执行 · exec）
- 输出 · Out：句柄 · Handle（`handle`，SoundHandle）
- 设置 · Setting：音频片段 · Clip（`soundAssetId`）
- 设置 · Setting：音轨 · Track（`audioTrackId`）

### 恢复声音 · Resume Sound

`blueprint.sound.resume` · 会等待，完成后才继续 · Latent: waits before continuing

- 可放在 · Allowed in: 应用逻辑 · App logic、页面逻辑 · Page logic、控件逻辑 · Widget logic、组件内的控件逻辑 · Widget logic inside a component
- 输入 · In：进入 · In（`in`，执行 · exec）
- 输入 · In：句柄 · Handle（`handle`，SoundHandle）
- 输出 · Out：下一步 · Next（`next`，执行 · exec）

### 跳转声音位置 · Seek Sound

`blueprint.sound.seek` · 会等待，完成后才继续 · Latent: waits before continuing

- 可放在 · Allowed in: 应用逻辑 · App logic、页面逻辑 · Page logic、控件逻辑 · Widget logic、组件内的控件逻辑 · Widget logic inside a component
- 输入 · In：进入 · In（`in`，执行 · exec）
- 输入 · In：句柄 · Handle（`handle`，SoundHandle）
- 输入 · In：时间（秒） · Time (s)（`time`，float；可直接填值 · accepts a typed value）
- 输出 · Out：下一步 · Next（`next`，执行 · exec）

### 设置声音音量 · Set Sound Volume

`blueprint.sound.setVolume` · 会等待，完成后才继续 · Latent: waits before continuing

- 可放在 · Allowed in: 应用逻辑 · App logic、页面逻辑 · Page logic、控件逻辑 · Widget logic、组件内的控件逻辑 · Widget logic inside a component
- 输入 · In：进入 · In（`in`，执行 · exec）
- 输入 · In：句柄 · Handle（`handle`，SoundHandle）
- 输入 · In：音量 · Volume（`volume`，float；可不连 · optional；可直接填值 · accepts a typed value）
- 输入 · In：淡变（秒） · Fade (s)（`fade`，float；可不连 · optional；可直接填值 · accepts a typed value）
- 输出 · Out：下一步 · Next（`next`，执行 · exec）

### 停止页面音乐 · Stop Page Music

`blueprint.sound.stopPageMusic` · 会等待，完成后才继续 · Latent: waits before continuing

在本蓝图所在页面打开期间不播放音乐。正在播放的音乐按「淡变（秒）」淡出，未连接时按它自己的淡入淡出。游戏进行中不起作用：那时音乐由故事决定

Silences the page this graph runs on, for as long as it is open. The music playing fades out over Fade (s), or over its own fade when Fade (s) is not connected. Does nothing while a game is running: the story decides the music then.

- 可放在 · Allowed in: 应用逻辑 · App logic、页面逻辑 · Page logic、控件逻辑 · Widget logic、组件内的控件逻辑 · Widget logic inside a component
- 输入 · In：进入 · In（`in`，执行 · exec）
- 输入 · In：淡变（秒） · Fade (s)（`fade`，float；可不连 · optional；可直接填值 · accepts a typed value）
- 输出 · Out：下一步 · Next（`next`，执行 · exec）

### 停止声音 · Stop Sound

`blueprint.sound.stop` · 会等待，完成后才继续 · Latent: waits before continuing

- 可放在 · Allowed in: 应用逻辑 · App logic、页面逻辑 · Page logic、控件逻辑 · Widget logic、组件内的控件逻辑 · Widget logic inside a component
- 输入 · In：进入 · In（`in`，执行 · exec）
- 输入 · In：句柄 · Handle（`handle`，SoundHandle；可不连 · optional）
- 输入 · In：淡变（秒） · Fade (s)（`fade`，float；可不连 · optional；可直接填值 · accepts a typed value）
- 输出 · Out：下一步 · Next（`next`，执行 · exec）
