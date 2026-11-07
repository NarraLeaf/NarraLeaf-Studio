# 蓝图节点：语音 · Voice

> 本文件由 NarraLeaf Studio 源码自动生成，请勿手动修改。
> Generated from the NarraLeaf Studio source. Do not edit by hand.

「语音 · Voice」分类下的 5 个节点。标题是节点面板里显示的名字（中文 · English）。

The 5 nodes in the "Voice" palette category, titled as the node palette shows them.

### 获取可用语音语言 · Get Available Voice Languages

`blueprint.voice.getAvailableLanguages` · 会等待，完成后才继续 · Latent: waits before continuing

- 可放在 · Allowed in: 应用逻辑 · App logic、页面逻辑 · Page logic、控件逻辑 · Widget logic、组件内的控件逻辑 · Widget logic inside a component
- 输入 · In：进入 · In（`in`，执行 · exec）
- 输出 · Out：下一步 · Next（`next`，执行 · exec）
- 输出 · Out：语言列表 · Languages（`value`，array<struct:nl.voiceLanguage>）

### 获取语音语言 · Get Voice Language

`blueprint.voice.getLanguage` · 会等待，完成后才继续 · Latent: waits before continuing

- 可放在 · Allowed in: 应用逻辑 · App logic、页面逻辑 · Page logic、控件逻辑 · Widget logic、组件内的控件逻辑 · Widget logic inside a component
- 输入 · In：进入 · In（`in`，执行 · exec）
- 输出 · Out：下一步 · Next（`next`，执行 · exec）
- 输出 · Out：语言 · Language（`value`，string）

### 播放选项语音 · Play Choice Voice

`blueprint.voice.playChoice` · 会等待，完成后才继续 · Latent: waits before continuing

- 可放在 · Allowed in: 应用逻辑 · App logic、页面逻辑 · Page logic、控件逻辑 · Widget logic、组件内的控件逻辑 · Widget logic inside a component
- 输入 · In：进入 · In（`in`，执行 · exec）
- 输出 · Out：下一步 · Next（`next`，执行 · exec）
- 输入 · In：打断其他选项 · Interrupt Others（`interruptOthers`，boolean；可不连 · optional；可直接填值 · accepts a typed value）
- 输出 · Out：已播放 · Played（`value`，boolean）

### 播放语音 · Play Voice

`blueprint.voice.play` · 会等待，完成后才继续 · Latent: waits before continuing

- 可放在 · Allowed in: 应用逻辑 · App logic、页面逻辑 · Page logic、控件逻辑 · Widget logic、组件内的控件逻辑 · Widget logic inside a component
- 输入 · In：进入 · In（`in`，执行 · exec）
- 输出 · Out：下一步 · Next（`next`，执行 · exec）
- 输入 · In：语音 ID · Voice Id（`voiceId`，string）
- 输出 · Out：已播放 · Played（`value`，boolean）

### 设置语音语言 · Set Voice Language

`blueprint.voice.setLanguage` · 会等待，完成后才继续 · Latent: waits before continuing

- 可放在 · Allowed in: 应用逻辑 · App logic、页面逻辑 · Page logic、控件逻辑 · Widget logic、组件内的控件逻辑 · Widget logic inside a component
- 输入 · In：进入 · In（`in`，执行 · exec）
- 输出 · Out：下一步 · Next（`next`，执行 · exec）
- 输入 · In：语言 · Language（`language`，string）
