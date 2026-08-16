# Move Mouse 节点

移动玩家真实的系统光标。用于手柄或键盘导航的菜单需要、而纯鼠标菜单无法伪造的那件事：把指针放到确认按钮上，让玩家下一次点击落在游戏已经在的位置。这与 Windows「自动移到默认按钮」是同一类行为。

**这是作者的决定，不是 Studio 的。** 游戏抢玩家指针是玩家会察觉的动作，判断它合不合适的人是作者本人——和决定游戏是否全屏启动、是否接管键盘的是同一个人。Studio 负责把这件事做成可能，并在编辑器里把它的适用范围说清楚。

游戏内自绘的软光标是另一个功能，本节点与它无关。

## 适用范围

桌面构建与 Dev Mode。Web 导出无法定位系统指针，节点在那里返回 `unsupported` 并走 `Failed` 出口。工程里存在这两个节点、而构建目标包含 web / android / ios 时，构建控制台按蓝图逐条输出 warning（不阻断构建）。

主进程侧经 `koffi` 调用系统自带的库：Windows `user32.dll` 的 `SetCursorPos`、macOS ApplicationServices 的 `CGWarpMouseCursorPosition`、Linux `libX11.so.6` 的 `XWarpPointer`。**不引入自建原生二进制**——那正是杀软会反应的形状；`koffi` 是本应用已有并已签名的依赖。库加载发生在调用内部而非模块求值期，缺库的宿主降级为 `unsupported` 而不是启动即崩。Wayland 会话（无 XWayland）报 `unsupported`。

## 坐标

输入是**舞台坐标**，与 `Get Measured Rect`、`Get Bounds` 和每个鼠标事件的 `X` / `Y` 是同一套。作者面对的是 1280×720 的设计尺寸，不是玩家的窗口。渲染层把它换成页面内的点，主进程再换成桌面上的物理像素（内容区原点 + 页面缩放 + 显示器缩放，见 `@shared/utils/blueprintPointerMove`）。

目标点被**夹在游戏窗口的内容区之内**。落在窗口外的请求要么来自过期的测量、要么来自舞台外的坐标；把它放行等于让游戏可以把指针停在桌面任意位置，那是比本节点更大的权限。

## Move Mouse To

`blueprint.app.movePointerTo` - 把光标移到一个点

输入：
- `point` - Vector2D，舞台坐标

卡片参数：
- `duration` - 秒。`0`（默认）表示立即到位，任何正值表示平滑移动；上限 10 秒
- `easing` - `linear` / `easeIn` / `easeOut` / `easeInOut`（默认 `easeInOut`），仅平滑移动使用

输出：
- `Next` / `Failed` - exec；`Failed` 同时覆盖「宿主不支持」和「系统拒绝了这次移动」
- `error` - string，失败原因

时长做成参数而不是第二个节点，与 `Animate Property` 一致：同一个动作，多久完成写在它自己身上。

## Move Mouse To Element

`blueprint.app.movePointerToElement` - 把光标移到控件的中心

输入：
- `element` - Element 引用，可选目标为全部 16 种可显示控件

卡片参数与输出同上。

中心点取的是**实测矩形**而不是文档布局：一次点击会落在控件画出来的地方，而动画途中或列表行里的控件并不在文档说的位置。控件当前没有画出来时走 `Failed`。

## 平滑移动的行程

行程在主进程里走，不在渲染层：渲染层做补间意味着每一动画帧一次 IPC 往返，而且它无从知道起点——光标现在在哪里是桌面的事实，页面问不到。主进程用 `screen.getCursorScreenPoint()` 就能回答，于是整条路径在两个端点都已知的地方计算。

目标点在移动开始时固定。控件在光标赶路途中移动了，光标不会追——追着动画按钮跑的指针是玩家无法预测的指针；作者要那个效果就再移一次。

同一个窗口上第二次移动会**接管**第一次：新的请求是作者更近的一次表态，旧的那次停在当前位置而不是弹回去。
