# 故事命令 · Story commands

> 本文件由 NarraLeaf Studio 源码自动生成，请勿手动修改。
> Generated from the NarraLeaf Studio source. Do not edit by hand.

故事编辑器里输入 `/` 能用的 58 条命令，按命令菜单的分组排列。每条给出界面上的名称、说明、可输入的写法和参数。

The 58 commands the story editor offers after `/`, grouped as the command menu groups them.

## 角色 · Character

### /show · 显示 · Show

显示角色、舞台对象，或资产库中的图片

Show a character, a stage object, or an image from the asset library

- 也可以写 · Also typed as：`/enter`
- `target`（目标 · Target）：target；按位置填写 · positional
- `form` / `表情`（外观 · Appearance）：characterForm；按位置填写 · positional
- `name`（名称 · Name）：text；写成 key=value · named
- `pos` / `at`（位置 · Position）：enum：`left`、`center`、`right` 或 · or text；写成 key=value · named
- `xoffset`（横向偏移像素 · X Offset px）：number；写成 key=value · named
- `yoffset`（纵向偏移像素 · Y Offset px）：number；写成 key=value · named
- `in` / `reveal`（显隐动画 · Reveal）：enum：`fade`（淡入 · Fade in）、`slide-left`（向左滑动 · Slide left）、`slide-right`（向右滑动 · Slide right）、`slide-up`（向上滑动 · Slide up）、`slide-down`（向下滑动 · Slide down）、`zoom`（缩放 · Zoom）、`scale`（比例 · Scale）、`rotate`（旋转 · Rotate）、`opacity`（不透明度 · Opacity）、`darken`（变暗 · Darken）、`circle`（圆形展开 · Circle reveal）、`wipe`（滑动揭示 · Slide reveal）、`none`（无 · None）；写成 key=value · named
- `d` / `duration`（持续时间 · Seconds）：number，≥ 0，单位 · unit s；写成 key=value · named
- `opacity`（不透明度 · Opacity）：number，≥ 0，≤ 1；写成 key=value · named
- `rate`（速度 · Speed）：number，≥ 0；写成 key=value · named

### /hide · 隐藏 · Hide

隐藏角色或舞台对象

Hide a character or a stage object

- 也可以写 · Also typed as：`/exit`
- `target`（目标 · Target）：target；按位置填写 · positional
- `out` / `conceal`（退场 · Conceal）：enum：`fade`（淡出 · Fade out）、`slide-left`（向左滑动 · Slide left）、`slide-right`（向右滑动 · Slide right）、`slide-up`（向上滑动 · Slide up）、`slide-down`（向下滑动 · Slide down）、`zoom`（缩放 · Zoom）、`scale`（比例 · Scale）、`rotate`（旋转 · Rotate）、`opacity`（不透明度 · Opacity）、`darken`（变暗 · Darken）、`circle`（圆形收拢 · Circle close）、`wipe`（滑动揭示 · Slide reveal）、`none`（无 · None）；写成 key=value · named
- `d` / `duration`（持续时间 · Seconds）：number，≥ 0，单位 · unit s；写成 key=value · named

### /char · 外观 · Appearance

切换角色显示的外观：姿态、差分或表情

Change which of a character's looks is showing

- 也可以写 · Also typed as：`/face`、`/expr`、`/expression`
- `character`（角色 · Character）：character；按位置填写 · positional
- `form` / `表情`（外观 · Appearance）：characterForm 或 · or puppetName；按位置填写 · positional
- `t` / `transition`（转场 · Transition）：enum：`fade`（淡入 · Fade in）、`slide`（推移 · Push）、`circle`（圆形遮罩 · Mask circle）、`wipe`（柔和擦除 · Soft wipe）、`iris`（柔和光圈 · Soft iris）、`blinds`（百叶 · Blinds）、`barn-door`（对开门 · Barn door）、`clock`（时钟 · Clock）、`fan`（风扇 · Fan）、`dots`（圆点 · Dots）、`blur`（模糊溶解 · Blur dissolve）、`black`（过色 · Through color）、`darkness`（压暗 · Darkness）、`exposure`（曝光 · Exposure）、`none`（无 · None）、`dissolve`（溶解 · Dissolve）；写成 key=value · named
- `d` / `duration`（持续时间 · Seconds）：number，≥ 0，单位 · unit s；写成 key=value · named
- `hold`（保持秒数 · Hold Seconds）：number，≥ 0，单位 · unit s；写成 key=value · named

### /motion · 动作 · Motion

设置由运行时绘制的角色循环播放的动作，直到另一行更改

Set the motion a runtime-drawn character loops until another row changes it

- 也可以写 · Also typed as：`/anim`
- `character`（角色 · Character）：character；按位置填写 · positional
- `name`（动作 · Motion）：puppetName；按位置填写 · positional

### /skin · 皮肤 · Skin

设置由运行时绘制的角色所穿的皮肤

Set the skin a runtime-drawn character wears

- 也可以写 · Also typed as：`/costume`
- `character`（角色 · Character）：character；按位置填写 · positional
- `name`（皮肤 · Skin）：puppetName；按位置填写 · positional

### /param · 参数 · Parameter

设置由运行时绘制的角色模型上的一个数值参数

Set one numeric parameter of a runtime-drawn character's model

- `character`（角色 · Character）：character；按位置填写 · positional
- `id`（参数 · Parameter）：puppetParam；按位置填写 · positional
- `value`（数值 · Value）：number；按位置填写 · positional

### /rename · 改名 · Rename

改变角色说话时显示的名字

Change the name a character speaks under

- 也可以写 · Also typed as：`/setname`
- `character`（角色 · Character）：character；按位置填写 · positional
- `name`（显示名 · Display Name）：text；按位置填写 · positional，吃掉本行剩余文字 · takes the rest of the line

### /say · 对白 · Say

写一行对白

A line of dialogue

- `character`（说话人 · Speaker）：character；按位置填写 · positional
- `text`（文本 · Text）：text；按位置填写 · positional，吃掉本行剩余文字 · takes the rest of the line

## 图片 · Image

### /image · 图片 · Image

在舞台上声明图片，由 /show 显示

Declare an image on stage; /show reveals it

- 也可以写 · Also typed as：`/img`
- `image` / `src`（图片 · Image）：asset；按位置填写 · positional
- `name`（名称 · Name）：text；写成 key=value · named
- `pos` / `at`（位置 · Position）：enum：`left`、`center`、`right` 或 · or text；写成 key=value · named
- `xoffset`（横向偏移像素 · X Offset px）：number；写成 key=value · named
- `yoffset`（纵向偏移像素 · Y Offset px）：number；写成 key=value · named
- `in` / `reveal`（显隐动画 · Reveal）：enum：`fade`（淡入 · Fade in）、`slide-left`（向左滑动 · Slide left）、`slide-right`（向右滑动 · Slide right）、`slide-up`（向上滑动 · Slide up）、`slide-down`（向下滑动 · Slide down）、`zoom`（缩放 · Zoom）、`scale`（比例 · Scale）、`rotate`（旋转 · Rotate）、`opacity`（不透明度 · Opacity）、`darken`（变暗 · Darken）、`circle`（圆形展开 · Circle reveal）、`wipe`（滑动揭示 · Slide reveal）、`none`（无 · None）；写成 key=value · named
- `d` / `duration`（持续时间 · Seconds）：number，≥ 0，单位 · unit s；写成 key=value · named

### /swap · 替换 · Swap

替换对象的图片或文本内容

Replace an object's image or text

- 也可以写 · Also typed as：`/src`
- `target`（目标 · Target）：target；按位置填写 · positional
- `t` / `transition`（转场 · Transition）：enum：`fade`（淡入 · Fade in）、`slide`（推移 · Push）、`circle`（圆形遮罩 · Mask circle）、`wipe`（柔和擦除 · Soft wipe）、`iris`（柔和光圈 · Soft iris）、`blinds`（百叶 · Blinds）、`barn-door`（对开门 · Barn door）、`clock`（时钟 · Clock）、`fan`（风扇 · Fan）、`dots`（圆点 · Dots）、`blur`（模糊溶解 · Blur dissolve）、`black`（过色 · Through color）、`darkness`（压暗 · Darkness）、`exposure`（曝光 · Exposure）、`none`（无 · None）、`dissolve`（溶解 · Dissolve）；写成 key=value · named
- `d` / `duration`（持续时间 · Seconds）：number，≥ 0，单位 · unit s；写成 key=value · named
- `hold`（保持秒数 · Hold Seconds）：number，≥ 0，单位 · unit s；写成 key=value · named
- `content`（内容 · Content）：content；按位置填写 · positional，吃掉本行剩余文字 · takes the rest of the line

### /front · 置顶 · Bring to Front

将角色或舞台对象绘制在所在图层的最前

Draw a character or a stage object in front of the rest of its layer

- 也可以写 · Also typed as：`/top`、`/raise`
- `target`（目标 · Target）：target；按位置填写 · positional

### /transform · 变换 · Transform

移动、缩放、旋转、遮罩、添加滤镜或淡入淡出舞台上的任何对象，包括镜头

Move, scale, rotate, mask, filter or fade anything on stage — or the camera

- 也可以写 · Also typed as：`/displayabletransform`
- `target`（目标 · Target）：target；按位置填写 · positional
- `pos` / `at` / `pan`（位置 · Position）：enum：`left`、`center`、`right` 或 · or text；写成 key=value · named
- `xoffset`（横向偏移像素 · X Offset px）：number；写成 key=value · named
- `yoffset`（纵向偏移像素 · Y Offset px）：number；写成 key=value · named
- `zoom`（缩放 · Zoom）：number，≥ 0；写成 key=value · named
- `scale`（比例 · Scale）：number，≥ 0；写成 key=value · named
- `scaleX`（横向比例 · Scale X）：number；写成 key=value · named
- `scaleY`（纵向比例 · Scale Y）：number；写成 key=value · named
- `rot` / `rotate`（角度 · Degrees）：number；写成 key=value · named
- `opacity` / `alpha`（不透明度 · Opacity）：number，≥ 0，≤ 1；写成 key=value · named
- `flip`（开 / 关 · On / Off）：enum：`on`、`off`；写成 key=value · named
- `blur`（模糊像素 · Blur px）：number，≥ 0；写成 key=value · named
- `bright`（亮度 · Brightness）：number，≥ 0；写成 key=value · named
- `contrast`（对比度 · Contrast）：number，≥ 0；写成 key=value · named
- `gray`（去色 · Grayscale）：number，≥ 0，≤ 1；写成 key=value · named
- `sat`（饱和度 · Saturation）：number，≥ 0；写成 key=value · named
- `sepia`（褐色 · Sepia）：number，≥ 0，≤ 1；写成 key=value · named
- `hue`（色相角度 · Hue Degrees）：number；写成 key=value · named
- `invert`（反色 · Invert）：number，≥ 0，≤ 1；写成 key=value · named
- `look`（色调 · Look）：enum：`memory`、`monologue`、`mono`、`moonlight`、`faint`、`hangover`、`none`；写成 key=value · named
- `strength` / `intensity`（色调强度 · Look Strength）：number，≥ 0，≤ 2；写成 key=value · named
- `filter`（滤镜代码 · CSS Filter）：enum：`none` 或 · or text；写成 key=value · named
- `mask`（遮罩图 · Mask Image）：enum：`none` 或 · or asset；写成 key=value · named
- `clip`（裁剪路径 · Clip Path）：enum：`none` 或 · or text；写成 key=value · named
- `backdrop`（背景滤镜 · Backdrop Filter）：enum：`none` 或 · or text；写成 key=value · named
- `blend`（混合模式 · Blend Mode）：enum：`normal`、`multiply`、`screen`、`overlay`、`darken`、`lighten`、`color-dodge`、`color-burn`、`hard-light`、`soft-light`、`difference`、`exclusion`、`hue`、`saturation`、`color`、`luminosity`、`none`；写成 key=value · named
- `color`（颜色 · Color）：color；写成 key=value · named
- `shutter`（眼皮 · Shutter）：number，≥ 0，≤ 1；写成 key=value · named
- `shutterColor`（眼皮颜色 · Shutter Color）：color；写成 key=value · named
- `vignette`（暗角 · Vignette）：number，≥ 0，≤ 1；写成 key=value · named
- `vignetteColor`（暗角颜色 · Vignette Color）：color；写成 key=value · named
- `vignetteInner`（透明中心 % · Clear Center %）：number，≥ 0，≤ 100；写成 key=value · named
- `vignetteOuter`（全暗边缘 % · Dark Edge %）：number，≥ 0，≤ 100；写成 key=value · named
- `lens`（镜头效果 · Lens Effect）：enum：`blink`、`slowBlink`、`vignettePulse`、`none`；写成 key=value · named
- `d` / `duration`（持续时间 · Seconds）：number，≥ 0，单位 · unit s；写成 key=value · named
- `ease` / `easing`（缓动 · Easing）：enum：`linear`、`easeIn`、`easeOut`、`easeInOut`、`circIn`、`circOut`、`circInOut`、`backIn`、`backOut`、`backInOut`、`anticipate`；写成 key=value · named
- `delay`（延迟秒数 · Delay Seconds）：number，≥ 0，单位 · unit s；写成 key=value · named
- `repeat`（重复次数 · Repeat Times）：number，≥ 0；写成 key=value · named
- `repeatDelay`（重复间隔 · Repeat Gap）：number，≥ 0，单位 · unit s；写成 key=value · named
- `repeatType`（重复方式 · Repeat Direction）：enum：`loop`、`reverse`、`mirror`；写成 key=value · named
- `from`（起始属性 · Start Props）：text；写成 key=value · named
- `motion` / `运镜`（动效 · Story Motion）：boolean；写成 key=value · named
- `loop`（循环 · Loop）：boolean；写成 key=value · named
- `stopLoop`（停止循环 · Stop Loop）：boolean；写成 key=value · named

## 文本 · Text

### /text · 文本 · Text

在舞台上声明文本，由 /show 显示

Declare text on stage; /show reveals it

- 也可以写 · Also typed as：`/txt`
- `name`（名称 · Name）：text；写成 key=value · named
- `pos` / `at`（位置 · Position）：enum：`left`、`center`、`right` 或 · or text；写成 key=value · named
- `xoffset`（横向偏移像素 · X Offset px）：number；写成 key=value · named
- `yoffset`（纵向偏移像素 · Y Offset px）：number；写成 key=value · named
- `content`（内容 · Content）：text；按位置填写 · positional，吃掉本行剩余文字 · takes the rest of the line

### /font · 字体 · Font

修改文本字号或颜色

Change a text's size or color

- 也可以写 · Also typed as：`/txtfont`
- `target`（目标 · Target）：target；按位置填写 · positional
- `size`（字号 · Font Size）：number，≥ 1；按位置填写 · positional
- `color`（颜色 · Color）：color；写成 key=value · named
- `outline`（描边宽度 · Outline px）：number，≥ 0，≤ 8；写成 key=value · named
- `outlineColor`（描边颜色 · Outline Color）：color；写成 key=value · named

## 图层 · Layer

### /layer · 图层 · Layer

向本场景添加图层

Add a layer to this scene

- `name`（名称 · Name）：text；按位置填写 · positional

## 视频 · Video

### /play · 播放 · Play

播放资产库中的视频，或再次播放视频

Play a video from the asset library, or play a video again

- 也可以写 · Also typed as：`/video`、`/vid`
- `target`（目标 · Target）：target；按位置填写 · positional
- `name`（名称 · Name）：text；写成 key=value · named
- `wait`（等待播放结束 · Wait for the clip）：boolean；写成 key=value · named
- `hide`（播放结束后隐藏 · Hide when finished）：boolean；写成 key=value · named
- `out` / `conceal`（退场 · Conceal）：enum：`fade`（淡出 · Fade out）、`none`（无 · None）；写成 key=value · named
- `d` / `duration`（持续时间 · Seconds）：number，≥ 0，单位 · unit s；写成 key=value · named
- `muted`（静音 · Muted）：boolean；写成 key=value · named

## 氛围特效 · Ambience

### /vfx · 氛围特效 · Ambience

声明全屏循环叠加（落花、雨雪、尘埃、光斑），由 /show 显示

Declare a looping full-screen overlay (petals, rain, dust, light); /show reveals it

- 也可以写 · Also typed as：`/ambience`
- `clip` / `src`（片段或天气 · Clip or weather）：enum：`snow`、`rain`、`sakura` 或 · or asset；按位置填写 · positional
- `name`（名称 · Name）：text；写成 key=value · named
- `opacity`（不透明度 · Opacity）：number，≥ 0，≤ 1；写成 key=value · named

## 场景 · Scene

### /bg · 背景 · Background

设置场景背景图片或颜色

Set the scene background image or color

- 也可以写 · Also typed as：`/background`
- `image`（图片或颜色 · Image or Color）：asset 或 · or color；按位置填写 · positional
- `t` / `transition`（转场 · Transition）：enum：`fade`（溶解 · Dissolve）、`slide`（推移 · Push）、`circle`（圆形遮罩 · Mask circle）、`wipe`（柔和擦除 · Soft wipe）、`iris`（柔和光圈 · Soft iris）、`blinds`（百叶 · Blinds）、`barn-door`（对开门 · Barn door）、`clock`（时钟 · Clock）、`fan`（风扇 · Fan）、`dots`（圆点 · Dots）、`blur`（模糊溶解 · Blur dissolve）、`black`（过色 · Through color）、`darkness`（压暗 · Darkness）、`exposure`（曝光 · Exposure）、`none`（无 · None）、`fade-in`（淡入 · Fade in）、`rule`（规则图 · Rule image）；写成 key=value · named
- `rule` / `ruleimage`（规则图 · Rule image）：asset；写成 key=value · named
- `d` / `duration`（持续时间 · Seconds）：number，≥ 0，单位 · unit s；写成 key=value · named
- `hold`（保持秒数 · Hold Seconds）：number，≥ 0，单位 · unit s；写成 key=value · named

### /jump · 跳转 · Jump

前往另一个场景，未带「返回」时当前场景会被卸载

Go to another scene, unloading this one unless Return is set

- `scene`（场景 · Scene）：scene；按位置填写 · positional
- `t` / `transition`（转场 · Transition）：enum：`fade`（溶解 · Dissolve）、`slide`（推移 · Push）、`circle`（圆形遮罩 · Mask circle）、`wipe`（柔和擦除 · Soft wipe）、`iris`（柔和光圈 · Soft iris）、`blinds`（百叶 · Blinds）、`barn-door`（对开门 · Barn door）、`clock`（时钟 · Clock）、`fan`（风扇 · Fan）、`dots`（圆点 · Dots）、`blur`（模糊溶解 · Blur dissolve）、`black`（过色 · Through color）、`darkness`（压暗 · Darkness）、`exposure`（曝光 · Exposure）、`none`（无 · None）、`fade-in`（淡入 · Fade in）、`rule`（规则图 · Rule image）；写成 key=value · named
- `rule` / `ruleimage`（规则图 · Rule image）：asset；写成 key=value · named
- `d` / `duration`（持续时间 · Seconds）：number，≥ 0，单位 · unit s；写成 key=value · named
- `hold`（保持秒数 · Hold Seconds）：number，≥ 0，单位 · unit s；写成 key=value · named
- `return` / `comeback` / `call`（返回 · Return）：boolean；写成 key=value · named

### /nvl · NVL

切换堆叠对白面板

Toggle the stacked dialogue panel

- `in` / `reveal`（显隐动画 · Reveal）：enum：`fade`（淡入 · Fade in）、`none`（无 · None）；写成 key=value · named
- `d` / `duration`（持续时间 · Seconds）：number，≥ 0，单位 · unit s；写成 key=value · named

### /rumble · 振动 · Rumble

使玩家的手柄振动，可选择预设或分别设置两侧马达

Vibrate the player's controller. Pick a preset, or set each motor

- 也可以写 · Also typed as：`/vibrate`
- `preset`（振动样式 · Shape）：enum：`tap`、`pulse`、`impact`、`quake`、`alert`、`custom`、`stop`；按位置填写 · positional
- `left`（左马达 · Left Motor）：number，≥ 0，≤ 1；写成 key=value · named
- `right`（右马达 · Right Motor）：number，≥ 0，≤ 1；写成 key=value · named
- `d` / `duration`（持续时间 · Seconds）：number，≥ 0，单位 · unit s；写成 key=value · named
- `wait`（等待振动结束 · Wait for the rumble）：boolean；写成 key=value · named

## 声音 · Sound

### /bgm · 背景音乐 · BGM

设置背景音乐

Set the background music

- `audio` / `src`（音频 · Audio）：asset；按位置填写 · positional
- `track`（音轨 · Audio Track）：audioTrack；写成 key=value · named
- `vol` / `volume`（音量 · Volume）：number，≥ 0，≤ 1；写成 key=value · named
- `fade`（淡入淡出秒数 · Fade Seconds）：number，≥ 0，单位 · unit s；写成 key=value · named
- `loop`（循环 · Loop）：boolean；写成 key=value · named

### /sound · 音效 · Sound

播放音效

Play a sound effect

- 也可以写 · Also typed as：`/se`
- `audio` / `src`（音频 · Audio）：asset；按位置填写 · positional
- `name`（名称 · Name）：text；写成 key=value · named
- `track`（音轨 · Audio Track）：audioTrack；写成 key=value · named
- `vol` / `volume`（音量 · Volume）：number，≥ 0，≤ 1；写成 key=value · named
- `fade`（淡入淡出秒数 · Fade Seconds）：number，≥ 0，单位 · unit s；写成 key=value · named
- `loop`（循环 · Loop）：boolean；写成 key=value · named
- `wait`（等待播放结束 · Wait for the clip）：boolean；写成 key=value · named

### /vol · 音量 · Volume

设置音量（默认 BGM）

Set a sound's volume (BGM by default)

- 也可以写 · Also typed as：`/volume`
- `target`（目标 · Target）：target；按位置填写 · positional
- `volume` / `vol`（音量 · Volume）：number，≥ 0，≤ 1；按位置填写 · positional
- `fade`（淡入淡出秒数 · Fade Seconds）：number，≥ 0，单位 · unit s；写成 key=value · named

### /rate · 倍速 · Rate

设置播放速度（默认 BGM）

Set a sound's speed (BGM by default)

- `target`（目标 · Target）：target；按位置填写 · positional
- `rate`（速度 · Speed）：number，≥ 0；按位置填写 · positional

### /stop · 停止 · Stop

停止声音或视频（默认 BGM）

Stop a sound or a video (BGM by default)

- `target`（目标 · Target）：target；按位置填写 · positional
- `fade`（淡入淡出秒数 · Fade Seconds）：number，≥ 0，单位 · unit s；写成 key=value · named

### /pause · 暂停 · Pause

暂停声音或视频（默认 BGM）

Pause a sound or a video (BGM by default)

- 也可以写 · Also typed as：`/pausesound`
- `target`（目标 · Target）：target；按位置填写 · positional
- `fade`（淡入淡出秒数 · Fade Seconds）：number，≥ 0，单位 · unit s；写成 key=value · named

### /resume · 继续 · Resume

继续播放声音或视频（默认 BGM）

Resume a sound or a video (BGM by default)

- `target`（目标 · Target）：target；按位置填写 · positional
- `fade`（淡入淡出秒数 · Fade Seconds）：number，≥ 0，单位 · unit s；写成 key=value · named

### /mute · 静音 · Mute

静音（默认 BGM）

Mute a sound (BGM by default)

- `target`（目标 · Target）：target；按位置填写 · positional

### /unmute · 取消静音 · Unmute

取消静音（默认 BGM）

Unmute a sound (BGM by default)

- `target`（目标 · Target）：target；按位置填写 · positional

### /seek · 跳转进度 · Seek

把视频跳到指定时间

Jump a video to a time

- `target`（目标 · Target）：target；按位置填写 · positional
- `time`（秒数 · Seconds）：number，≥ 0，单位 · unit s；按位置填写 · positional

## 数据 · Data

### /set · 赋值 · Set

为变量赋值

Assign a variable

- `variable`（变量 · Variable）：variable；按位置填写 · positional
- `value`（值或表达式 · Value or Expression）：expression；按位置填写 · positional，吃掉本行剩余文字 · takes the rest of the line

### /inc · 增加 · Increase

为数值变量加值

Add to a number variable

- 也可以写 · Also typed as：`/add`
- `variable`（变量 · Variable）：variable；按位置填写 · positional
- `by`（数量 · Amount）：expression；按位置填写 · positional，吃掉本行剩余文字 · takes the rest of the line

### /dec · 减少 · Decrease

为数值变量减值

Subtract from a number variable

- 也可以写 · Also typed as：`/sub`
- `variable`（变量 · Variable）：variable；按位置填写 · positional
- `by`（数量 · Amount）：expression；按位置填写 · positional，吃掉本行剩余文字 · takes the rest of the line

### /toggle · 翻转 · Toggle

翻转真/假变量

Flip a true/false variable

- 也可以写 · Also typed as：`/flip`
- `variable`（变量 · Variable）：variable；按位置填写 · positional

### /local · 场景变量 · Local variable

声明仅本场景有效的变量

Declare a scene variable

- 也可以写 · Also typed as：`/scenevar`
- `name`（变量名 · Var Name）：text；按位置填写 · positional
- `default` / `value`（初始值 · Default Value）：constant；按位置填写 · positional
- `type` / `as`（类型 · Type）：enum：`boolean`、`number`、`string`、`json`；写成 key=value · named
- `desc` / `note`（说明 · Description）：text；写成 key=value · named

### /reset · 重置 · Reset

将对象恢复原样：变量返回默认值，舞台对象恢复中性外观

Put something back the way it was: a variable to its default, or a stage object to its neutral look

- 也可以写 · Also typed as：`/clear`
- `target`（目标 · Target）：target 或 · or variable；按位置填写 · positional
- `pos`（位置 · Position）：boolean；写成 key=value · named
- `zoom`（缩放 · Zoom）：boolean；写成 key=value · named
- `scale`（比例 · Scale）：boolean；写成 key=value · named
- `scaleX`（横向比例 · Scale X）：boolean；写成 key=value · named
- `scaleY`（纵向比例 · Scale Y）：boolean；写成 key=value · named
- `rot`（角度 · Degrees）：boolean；写成 key=value · named
- `opacity`（不透明度 · Opacity）：boolean；写成 key=value · named
- `filter`（滤镜代码 · CSS Filter）：boolean；写成 key=value · named
- `mask`（遮罩图 · Mask Image）：boolean；写成 key=value · named
- `clip`（裁剪路径 · Clip Path）：boolean；写成 key=value · named
- `backdrop`（背景滤镜 · Backdrop Filter）：boolean；写成 key=value · named
- `blend`（混合模式 · Blend Mode）：boolean；写成 key=value · named
- `d` / `duration`（持续时间 · Seconds）：number，≥ 0，单位 · unit s；写成 key=value · named

## 流程 · Flow

### /wait · 等待 · Wait

等待数秒，或等待点击

Pause for seconds, or for a click

- `seconds`（秒数或 click · Seconds or click）：keyword 或 · or number，≥ 0，单位 · unit s；按位置填写 · positional

### /if · 条件 · If

按条件分支

Branch on a condition

- `test`（条件 · Condition）：expression；按位置填写 · positional，吃掉本行剩余文字 · takes the rest of the line

### /menu · 菜单 · Menu

向玩家给出一组选项

Present a set of options to the player

- 也可以写 · Also typed as：`/choice`
- `text`（内容 · Content）：text；按位置填写 · positional，吃掉本行剩余文字 · takes the rest of the line

### /repeat · 重复 · Repeat

按设定次数重复执行所含动作；按条件循环请用 /until

Run the enclosed actions a set number of times. For a condition instead, use /until

- 也可以写 · Also typed as：`/loop`
- `times`（次数 · Times）：number，≥ 1；按位置填写 · positional
- `until`（条件 · Condition）：expression；写成 key=value · named

### /until · 直到 · Until

重复执行所含动作，直到条件成立；条件在每轮开始前检查

Repeat the enclosed actions until a condition becomes true. The condition is checked before each pass

- `condition`（条件 · Condition）：expression；按位置填写 · positional，吃掉本行剩余文字 · takes the rest of the line

### /break · 跳出 · Break

跳出本行所在的重复组

Leave the repeat group this row sits in

### /parallel · 并行 · Parallel

同时执行所含动作

Run the enclosed actions together

### /race · 竞速 · Race

全部执行，最先完成者结束

Run all, continue when the first finishes

### /sequence · 顺序 · Sequence

依次执行所含动作

Run the enclosed actions in order

- 也可以写 · Also typed as：`/seq`

### /label · 标签 · Label

在本场景标记一个位置，供 /goto 跳转

Mark a place in this scene for /goto to reach

- 也可以写 · Also typed as：`/mark`
- `name`（标签 · Label）：text；按位置填写 · positional，吃掉本行剩余文字 · takes the rest of the line

### /goto · 跳到标签 · Go to

把播放头移到本场景的标签，与 /jump 不同，场景不会重启

Move the play head to a label in this scene. Unlike /jump, the scene keeps running

- 也可以写 · Also typed as：`/jumpto`
- `target`（标签 · Label）：label；按位置填写 · positional

### /cut · 截断 · Cut point

让某个变体的剧情在此行结束，其他变体中没有这一行

End one build variant's story at this line. Other builds do not have this line

- `tag`（变体 · Build Variant）：appTag；按位置填写 · positional

### /ending · 结局 · Ending

在此行结束剧情，并记录玩家到达的结局

End the story at this line and record which ending the player reached

- 也可以写 · Also typed as：`/end`
- `name`（结局 · Ending）：text；按位置填写 · positional，吃掉本行剩余文字 · takes the rest of the line

### /quit · 退出到页面 · Quit to page

在此行结束本次游玩并显示一个页面，不记录结局

End this playthrough at this line and show a page. No ending is recorded

- 也可以写 · Also typed as：`/leave`
- `page`（页面 · Page）：surface；按位置填写 · positional

### /page · 打开页面 · Open page

在剧情上方打开一个页面，等它关闭后再继续，可把页面关闭时返回的结果写入变量

Open a page over the story and wait until it closes. What the page closes with can be written into a variable

- 也可以写 · Also typed as：`/overlay`、`/popup`
- `page`（页面 · Page）：surface；按位置填写 · positional
- `into` / `result`（结果变量 · Result Variable）：variable；写成 key=value · named

### /input · 输入锁定 · Input lock

锁定或解除玩家输入；锁定期间点击推进、推进键、自动播放与快进均无效，选项仍可选择；须在下一句对白前解除

Lock or unlock player input. While locked, clicking to advance, the advance key, auto-forward and skipping do nothing; choices can still be picked. Unlock before the next line of dialogue

- `state`（锁定 / 解锁 · Lock / Unlock）：enum：`lock`、`unlock`；按位置填写 · positional

### /waitinput · 等待输入 · Wait for input

等待玩家执行一个输入动作，可设置时限

Wait until the player performs an input action, optionally within a time limit

- 也可以写 · Also typed as：`/waitaction`
- `action`（输入动作 · Input Action）：inputAction；按位置填写 · positional
- `timeout` / `limit`（时限 · Time Limit）：number，≥ 0，单位 · unit s；写成 key=value · named
- `into` / `result`（结果变量 · Result Variable）：variable；写成 key=value · named

### /hold · 长按 · Hold

等待玩家按住一个输入动作达到指定秒数

Wait until the player holds an input action down for a number of seconds

- 也可以写 · Also typed as：`/longpress`
- `action`（输入动作 · Input Action）：inputAction；按位置填写 · positional
- `seconds`（按住秒数 · Hold Seconds）：number，≥ 0，单位 · unit s；按位置填写 · positional
- `timeout` / `limit`（时限 · Time Limit）：number，≥ 0，单位 · unit s；写成 key=value · named
- `into` / `result`（结果变量 · Result Variable）：variable；写成 key=value · named

### /mash · 连按 · Mash

等待玩家按下一个输入动作达到指定次数

Wait until the player presses an input action a number of times

- 也可以写 · Also typed as：`/rapid`
- `action`（输入动作 · Input Action）：inputAction；按位置填写 · positional
- `count`（按键次数 · Presses）：number，≥ 1；按位置填写 · positional
- `timeout` / `limit`（时限 · Time Limit）：number，≥ 0，单位 · unit s；写成 key=value · named
- `into` / `result`（结果变量 · Result Variable）：variable；写成 key=value · named

## 工具 · Tools

### /blueprint · 蓝图 · Blueprint

运行故事动作蓝图

Run a Story Action Blueprint

- 也可以写 · Also typed as：`/executescript`、`/bp`

### /note · 备注 · Note

仅 Studio 可见的备注

A Studio-only note

- 也可以写 · Also typed as：`//`
- `text`（内容 · Content）：text；按位置填写 · positional，吃掉本行剩余文字 · takes the rest of the line
