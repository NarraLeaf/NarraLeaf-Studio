# 蓝图节点：视频 · Video

> 本文件由 NarraLeaf Studio 源码自动生成，请勿手动修改。
> Generated from the NarraLeaf Studio source. Do not edit by hand.

「视频 · Video」分类下的 14 个节点。标题是节点面板里显示的名字（中文 · English）。

The 14 nodes in the "Video" palette category, titled as the node palette shows them.

### 获取视频时长 · Get Video Duration

`blueprint.video.getDuration` · 纯数据节点，没有执行针脚 · Pure: no exec pins

视频文件的时长，单位为秒；加载完成前为 0

How long the clip is, in seconds. 0 until the clip has loaded.

- 只用于这些控件的蓝图 · Only on: 视频 · Video
- 可放在 · Allowed in: 控件逻辑 · Widget logic、组件内的控件逻辑 · Widget logic inside a component
- 输出 · Out：时长（秒） · Duration (s)（`duration`，float）

### 获取视频播放位置 · Get Video Time

`blueprint.video.getTime` · 纯数据节点，没有执行针脚 · Pure: no exec pins

视频当前的播放位置，为从视频开头计的秒数；画面上没有视频时为 0

Where the video is, in seconds from the start of the clip. 0 while there is no clip on screen.

- 只用于这些控件的蓝图 · Only on: 视频 · Video
- 可放在 · Allowed in: 控件逻辑 · Widget logic、组件内的控件逻辑 · Widget logic inside a component
- 输出 · Out：时间（秒） · Time (s)（`time`，float）

### 获取视频音量 · Get Video Volume

`blueprint.video.getVolume` · 纯数据节点，没有执行针脚 · Pure: no exec pins

视频的音量（0 到 1），即控件上设置的或「设置视频音量」设置的值，不含玩家的音量设置

The video's volume, from 0 to 1: the one set on the widget, or by Set Video Volume. The player's volume settings are not included.

- 只用于这些控件的蓝图 · Only on: 视频 · Video
- 可放在 · Allowed in: 控件逻辑 · Widget logic、组件内的控件逻辑 · Widget logic inside a component
- 输出 · Out：音量 · Volume（`volume`，float）

### 视频是否已播完 · Is Video Ended

`blueprint.video.isEnded` · 纯数据节点，没有执行针脚 · Pure: no exec pins

视频播放到结尾后为真，直到再次播放或跳转位置。开启「循环」时始终为假

True once the clip has played to its end, until it is played or moved again. Never true while Loop is on.

- 只用于这些控件的蓝图 · Only on: 视频 · Video
- 可放在 · Allowed in: 控件逻辑 · Widget logic、组件内的控件逻辑 · Widget logic inside a component
- 输出 · Out：已播完 · Is Ended（`isEnded`，boolean）

### 视频是否静音 · Is Video Muted

`blueprint.video.isMuted` · 纯数据节点，没有执行针脚 · Pure: no exec pins

视频处于静音时为真

True while the video is muted.

- 只用于这些控件的蓝图 · Only on: 视频 · Video
- 可放在 · Allowed in: 控件逻辑 · Widget logic、组件内的控件逻辑 · Widget logic inside a component
- 输出 · Out：静音 · Muted（`muted`，boolean）

### 视频是否在播放 · Is Video Playing

`blueprint.video.isPlaying` · 纯数据节点，没有执行针脚 · Pure: no exec pins

视频正在播放时为真；暂停、停止、已播完以及画面上没有视频时为假

True while the video is playing. False while it is paused, stopped or at its end, and while there is no clip on screen.

- 只用于这些控件的蓝图 · Only on: 视频 · Video
- 可放在 · Allowed in: 控件逻辑 · Widget logic、组件内的控件逻辑 · Widget logic inside a component
- 输出 · Out：播放中 · Is Playing（`isPlaying`，boolean）

### 暂停视频 · Pause Video

`blueprint.video.pause` · 会等待，完成后才继续 · Latent: waits before continuing

在当前位置暂停视频；「播放视频」从该位置继续播放

Pauses the video where it is. Play Video resumes it from there.

- 只用于这些控件的蓝图 · Only on: 视频 · Video
- 可放在 · Allowed in: 控件逻辑 · Widget logic、组件内的控件逻辑 · Widget logic inside a component
- 输入 · In：进入 · In（`in`，执行 · exec）
- 输出 · Out：下一步 · Next（`next`，执行 · exec）

### 播放视频 · Play Video

`blueprint.video.play` · 会等待，完成后才继续 · Latent: waits before continuing

开始播放视频，或从暂停处继续播放；视频已播完时从头重新播放。音量与「自动播放」相同，受玩家的音量设置影响。视频文件尚未加载完成时，加载完成后开始播放

Starts the video, or resumes it from where it was paused. After the clip has ended, plays it again from the start. Plays at the volume the player has set, as Autoplay does. A clip that has not loaded yet starts once it has.

- 只用于这些控件的蓝图 · Only on: 视频 · Video
- 可放在 · Allowed in: 控件逻辑 · Widget logic、组件内的控件逻辑 · Widget logic inside a component
- 输入 · In：进入 · In（`in`，执行 · exec）
- 输出 · Out：下一步 · Next（`next`，执行 · exec）

### 跳转视频播放位置 · Seek Video

`blueprint.video.seek` · 会等待，完成后才继续 · Latent: waits before continuing

把视频移到「时间（秒）」处，从视频开头计时。超过结尾的时间移到结尾，负数移到开头。播放或暂停状态不变：正在播放的视频移到结尾时运行「播放结束」，暂停中的视频停在结尾

Moves the video to Time, in seconds from the start of the clip. A time past the end moves it to the end, and a negative time to the start. A playing video keeps playing and a paused one stays paused. A playing video moved to its end runs Playback Ended.

- 只用于这些控件的蓝图 · Only on: 视频 · Video
- 可放在 · Allowed in: 控件逻辑 · Widget logic、组件内的控件逻辑 · Widget logic inside a component
- 输入 · In：进入 · In（`in`，执行 · exec）
- 输出 · Out：下一步 · Next（`next`，执行 · exec）
- 输入 · In：时间（秒） · Time (s)（`time`，float；可直接填值 · accepts a typed value）

### 设置视频循环 · Set Video Loop

`blueprint.video.setLoop` · 会等待，完成后才继续 · Latent: waits before continuing

开启或关闭「循环」。开启时视频播到结尾后从头继续，「播放结束」不运行

Turns Loop on or off. While Loop is on, the clip starts over at its end and Playback Ended does not run.

- 只用于这些控件的蓝图 · Only on: 视频 · Video
- 可放在 · Allowed in: 控件逻辑 · Widget logic、组件内的控件逻辑 · Widget logic inside a component
- 输入 · In：进入 · In（`in`，执行 · exec）
- 输出 · Out：下一步 · Next（`next`，执行 · exec）
- 输入 · In：循环 · Loop（`loop`，boolean；可直接填值 · accepts a typed value）

### 设置视频静音 · Set Video Muted

`blueprint.video.setMuted` · 会等待，完成后才继续 · Latent: waits before continuing

将视频设为静音或取消静音。静音时不输出声音，不受音量影响

Mutes or unmutes the video. A muted video plays silently at any volume.

- 只用于这些控件的蓝图 · Only on: 视频 · Video
- 可放在 · Allowed in: 控件逻辑 · Widget logic、组件内的控件逻辑 · Widget logic inside a component
- 输入 · In：进入 · In（`in`，执行 · exec）
- 输出 · Out：下一步 · Next（`next`，执行 · exec）
- 输入 · In：静音 · Muted（`muted`，boolean；可直接填值 · accepts a typed value）

### 设置视频速度 · Set Video Speed

`blueprint.video.setPlaybackRate` · 会等待，完成后才继续 · Latent: waits before continuing

设置视频的播放速度：1 为正常速度，2 为两倍速，0.5 为半速。范围为 0.0625 到 16

Sets how fast the video plays: 1 is normal speed, 2 twice as fast, 0.5 half as fast. Kept between 0.0625 and 16.

- 只用于这些控件的蓝图 · Only on: 视频 · Video
- 可放在 · Allowed in: 控件逻辑 · Widget logic、组件内的控件逻辑 · Widget logic inside a component
- 输入 · In：进入 · In（`in`，执行 · exec）
- 输出 · Out：下一步 · Next（`next`，执行 · exec）
- 输入 · In：速度 · Speed（`speed`，float；可直接填值 · accepts a typed value）

### 设置视频音量 · Set Video Volume

`blueprint.video.setVolume` · 会等待，完成后才继续 · Latent: waits before continuing

设置视频的音量（0 到 1），代替控件上设置的音量。玩家的音量设置与音轨仍在此基础上生效

Sets the video's volume, from 0 to 1, in place of the volume set on the widget. The player's volume settings and the audio track still apply on top.

- 只用于这些控件的蓝图 · Only on: 视频 · Video
- 可放在 · Allowed in: 控件逻辑 · Widget logic、组件内的控件逻辑 · Widget logic inside a component
- 输入 · In：进入 · In（`in`，执行 · exec）
- 输出 · Out：下一步 · Next（`next`，执行 · exec）
- 输入 · In：音量 · Volume（`volume`，float；可直接填值 · accepts a typed value）

### 停止视频 · Stop Video

`blueprint.video.stop` · 会等待，完成后才继续 · Latent: waits before continuing

暂停视频并回到视频开头

Pauses the video and returns it to the start of the clip.

- 只用于这些控件的蓝图 · Only on: 视频 · Video
- 可放在 · Allowed in: 控件逻辑 · Widget logic、组件内的控件逻辑 · Widget logic inside a component
- 输入 · In：进入 · In（`in`，执行 · exec）
- 输出 · Out：下一步 · Next（`next`，执行 · exec）
