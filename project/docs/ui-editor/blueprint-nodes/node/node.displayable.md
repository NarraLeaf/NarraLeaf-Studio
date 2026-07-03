# Displayable 节点

除非额外声明，所有参数均为传出引脚值。

Displayable 节点默认读取当前元素。坐标和尺寸均使用当前 Surface 的设计坐标系，与 Inspector 的 Position `X` / `Y` 一致。

透明度统一为 Displayable 的有效 `opacity`：Appearance Variant 中的 `transformOpacity` 会解析到同一个元素透明度，不再和内部 chrome/text 透明度叠乘；`nl.image` Variant 中相对 Default 实际改动过的 `fillOpacity` 也会解析到这套透明度，并且不会再写到内部 `<img>` 的 opacity。`nl.image` 的图片内容层 `imageFill` / crop / contain 模式来自 Default，不会被非 Default Variant 切换；需要改图片资源或裁剪时使用 Image 节点/图片控件。`Get Property` / `Set Property` / `Animate Property` 读写和动画的都是这同一套透明度。

Displayable Self 节点只在可显示控件自己的私有蓝图中出现，创建浮窗中归入 `Displayable` 分类，且没有 Element 输入；执行目标默认就是当前蓝图所属元素。

Displayable Element 派生节点使用 `blueprint.element.displayable.*`，创建浮窗中归入 `Element` 分类。多数派生节点带顶部 generic `element` 输入，并且只有在当前图中已有任意 Same-Surface Element Literal、Element Flush 或 Element Click 时才会显示；同一节点类型只显示一项。若兼容来源唯一，放置时会自动连接对应的 `element` 输入；若有多个兼容来源，则保留 `element` 输入由作者手动选择/连接。`Stop Element Animation` 只接收 `AnimationToken`，不带 `element` 输入，因为 token 已经定位到具体动画。读取节点是 pure，可用于 Blueprint Value；写入/动画节点只用于 event/macro。

下文列出的 `blueprint.displayable.*` 均有对应 `blueprint.element.displayable.*` Element 版；其中 `Get Display` / `Set Display` 的 Element 派生版显示为 `Get Element Display` / `Set Element Display`，通过 `element` 输入读写显式目标元素；Stop Element Animation 只改变分类和名称，不增加 Element 输入。

## Get Display

`blueprint.displayable.getDisplay` - 读取 Displayable 渲染开关

Element 派生版：`blueprint.element.displayable.getDisplay` - `Get Element Display`。

输出：
- `display` - boolean，当前运行时 `display` 状态

`display` 默认为 `true`。当运行时 `display` 为 `false` 时，元素仍保留在 SurfaceElementTree 中，并通过 CSS `display: none` 隐藏元素自身和子树。

## Set Display

`blueprint.displayable.setDisplay` - 设置 Displayable 渲染开关

Element 派生版：`blueprint.element.displayable.setDisplay` - `Set Element Display`，额外带 `element` 输入并作用于该 Element 引用。

输入：
- `display` - boolean，目标运行时 `display` 状态

写入发生在运行时 patch 层，不修改 authored UI document。`display = false` 表示对元素应用 CSS `display: none`，但不卸载元素；`display = true` 恢复显示。它不同于 `visible`：`visible` 仍是布局/可见性属性，保留给 `Get Property visible` / `Set Property visible` 以及旧的 Visible 节点语义。

## Get Property

`blueprint.displayable.getProperty` - 读取 Displayable 属性

通过节点卡片的 `Property` 下拉选择要读取的属性。该节点取代旧的多个固定 get 节点，是新图中推荐的 Displayable 读取入口。

卡片参数：
- `property` - `position`、`size`、`bounds`、`x`、`y`、`offsetX`、`offsetY`、`width`、`height`、`rotation`、`opacity`、`visible`

输出：
- `value` - 所选属性值

属性语义：
- `position` 返回 `{ x, y }`
- `size` 返回 `{ width, height }`
- `bounds` 返回 `{ x, y, width, height }`
- `x` / `y` / `offsetX` / `offsetY` / `width` / `height` / `rotation` / `opacity` 返回 number
- `visible` 返回 boolean
兼容说明：旧节点 `Get Position`、`Get Size`、`Get Bounds`、`Get Rotation`、`Get Opacity`、`Get Visible`、`Get Variant` 仍注册以支持旧蓝图，但在创建浮窗中隐藏。新图应使用 `Get Property`。

## Set Property

`blueprint.displayable.setProperty` - 设置 Displayable 运行时属性

通过节点卡片选择一个可写 Displayable 属性并填写值。写入发生在运行时 patch 层，不直接改 authored UI document；值变化会触发目标元素 flush。

卡片参数：
- `property` - `x`、`y`、`offsetX`、`offsetY`、`width`、`height`、`rotation`、`opacity`、`visible`
- `value` - 属性值；`visible` 使用 Visible / Hidden 下拉，`opacity` 按百分比 `0..100` 输入，其它属性使用 number 输入

卡片会在数字输入框右侧显示单位：`x` / `y` / `offsetX` / `offsetY` / `width` / `height` 使用 `px`，`rotation` 使用 `deg`，`opacity` 使用 `%`。

如果 `value` 输入 pin 已经接入数据线，卡片上的 Value 控件会禁用，运行时以传入 pin 值为准。

数字输入采用草稿编辑：输入时不立即写回节点参数，失去输入/节点/窗口焦点或按 Enter 时提交，按 Esc 放弃本次编辑。

可写属性暂不包含 `variant`，Variant 使用 `Set Variant`。

## Set Variant

`blueprint.displayable.setVariant` - 设置 Appearance Variant

设置目标元素的运行时 Variant 覆盖。Self 版默认绑定当前蓝图所属元素，只有支持 Appearance Variant 的控件会显示该节点；Element 派生版通过 `element` 输入引用目标元素。节点卡片的 `Variant` 字段会在能静态推断目标元素时显示该元素已有 Variants 的下拉列表；`Wait For Animation` 下拉选择是否等待目标 Variant 的 Appearance transition 完成后再继续执行 `Next`。

卡片参数：
- `variantId` - 隐藏持久化值，只能由 Variant 下拉写入
- `waitForTransition` - `continue` 立即继续，`wait` 等待目标 Variant 上最长的字段 transition；没有 transition 时不会额外等待

Variant 的内部 UUID 只作为隐藏持久化值保存。节点没有 `variantId` 数据输入，也不能手动输入 Variant id；作者只会看到 Variant 名称。运行时会校验目标元素是否支持 Appearance Variant，以及所选 Variant 是否存在。不支持 Variant 的 Displayable 元素执行时提交错误，不会静默忽略。

当 Variant 设置了 `transformOpacity`，运行时会把它投影到同一个 Displayable `opacity`；`nl.image` 还会把 Variant 中相对 Default 实际改动过的 `fillOpacity` 作为 Displayable opacity 来源，并且不会再把这个值写到内部 `<img>` 的 opacity 上。`nl.image` 的非 Default Variant 不覆盖 Default 的 `imageFill`，因此透明 Variant 不会把图片从 `contain` 切成残留的 `crop`。`Set Variant` 本身不持有 runtime opacity patch；它会清理旧的 runtime opacity override，让当前 Variant 决定透明度。因此先切换到透明 Variant，再运行 `Animate Property opacity 0 -> 100` 会从该透明状态正常进入，而不会被 Variant 的透明状态锁住。`Animate Property` 使用 `hold` 时会把最终 opacity 写回运行时 Displayable opacity，后续刷新不会被透明 Variant 再压回 0。

## Animate Property

`blueprint.displayable.animateProperty` - 动画化 Displayable 属性

通过节点卡片选择一个属性并填写动画参数。第一版是属性驱动的基础节点，不内建 Fade / Shake / Pulse 等动画序列；这些序列之后可以作为更高层节点或宏基于本节点构建。

卡片参数：
- `property` - 要动画化的属性：`opacity`、`offsetX`、`offsetY`、`x`、`y`、`scale`、`rotation`
- `from` - 可选起始值；留空时 Motion 从元素当前运行时状态开始，`opacity` 按百分比输入；`x` / `y` 如需从坐标 0 开始，必须在卡片中显式填写 `0`
- `to` - 目标值；`opacity` 按百分比输入
- `duration` - 时长，单位为秒；例如 `0.3` 表示 300ms
- `delay` - 延迟，单位为秒；例如 `1` 表示 1 秒
- `easing` - 曲线：`linear`、`easeIn`、`easeOut`、`easeInOut`、`circIn`、`circOut`、`circInOut`
- `after` - 完成后行为：`hold` 保持最终值，`reset` 回到 authored layout/appearance

输出：
- `animation` - 当前动画 token，类型为 `AnimationToken`，可保存到 `Var` 并传给 `Stop Animation` / `Stop Element Animation`

节点启动动画时会先写出 `animation` token；执行链仍在动画自然完成或被停止节点跳过后进入 `Next`。

卡片会在数字输入框右侧显示单位：`opacity` 使用 `%`，`offsetX` / `offsetY` / `x` / `y` 使用 `px`，`scale` 使用 `x`，`rotation` 使用 `deg`，`duration` / `delay` 使用 `s`。

数字输入采用草稿编辑：输入时不立即写回节点参数，失去输入/节点/窗口焦点或按 Enter 时提交，按 Esc 放弃本次编辑。

属性语义：
- `opacity` 使用元素透明度，卡片显示/输入为百分比 `0..100`，运行时归一化为 `0..1`；`after = hold` 会把最终 opacity 持久到运行时 patch，旧图中已经保存的 `0..1` 值仍兼容
- `offsetX` / `offsetY` 是相对 authored layout 的视觉位移，单位为设计坐标 px
- `x` / `y` 是布局位置动画，单位为设计坐标 px；`after = hold` 会先把最终位置写回运行时 layout patch，再用 motion offset 过渡到该位置，动画结束后清理残留 offset；`after = reset` 会在动画结束后回到当前运行时布局位置
- `scale` 是视觉缩放倍率，`1` 为原始大小
- `rotation` 是视觉旋转角度，单位为度

## Stop Animation

`blueprint.displayable.stopAnimation` - 停止指定 Displayable 动画

输入：
- `animation` - `Animate Property` / `Animate Element Property` 输出的 `AnimationToken`

该节点只停止 token 对应的 runtime animation，并让正在等待该动画完成的 `Animate Property` / `Animate Element Property` 提前进入 `Next`。传入缺失值、非 `AnimationToken`、非 `animation:` token，或已不再 pending 的 token 时静默 no-op 并继续执行。`Stop Element Animation` 与 Self 版使用同一个 `animation` 输入，不再按元素清除全部动画。
