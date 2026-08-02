---
title: "plan: Story action 模型对齐 —— 四张目录收敛为一张，分类 13→8，补齐引擎缺口"
type: plan
status: draft
date: 2026-07-24
related:
  - 2026-07-19-001-refactor-story-command-bible.md
  - 2026-07-22-001-feat-story-editor-overhaul.md
---

# plan: Story action 模型对齐

本卡是**设计规划**，不是执行交接卡。它给出诊断、目标模型、完整指令表和里程碑拆分，供后续执行卡（task 卡）派生。阅读者可以修改本卡；改动请保留 §3「已决裁决」，那一节是需求方裁定的，不再讨论。

前置阅读：bible `2026-07-19-001` §1（指令风格圣经 B1–B11）。本卡**不推翻 bible**，而是把 bible 已经在斜杠层做对的事（B3 泛型动词、B10 inspector-first）推广到侧栏与分类，并补齐引擎能力缺口。

引擎基准以 **narraleaf-react 源码**为准（分支 `dev_nomen`），文档源为 **`../narraleaf.com`**（`content/docs/narraleaf-react/`）。旧站 `../react.narraleaf.com` 已滞后（`displayable` 只记录 20 个链式方法中的 9 个，元素索引缺 Camera/Video/Vfx），**不要引用它**。

---

## 1. 基准：NLR 的真实能力形状

```
Displayable（抽象基类，20 个链式方法）
├── Image   （+ char / darken / addWearable / wear / useLayer）
├── Text    （+ setText / setFontSize / setFontColor / useLayer）
├── Layer   （+ setZIndex / include）
└── Camera  （+ pan=pos / darken=filter / reset）

Actionable（非 Displayable，动词自成一套）
├── Video   （show / hide / play / pause / resume / stop / seek）
├── Vfx     （show / hide / pause / resume / setPlaybackRate）0.16.0 起
└── Sound   （play / stop / setVolume / setRate / mute / unmute / pause / resume）

非舞台：Scene · Character · Menu · Condition · Control · Persistent · Script · Service · Story · NVLToken
```

Displayable 的 20 个方法：`pos` `zoom` `scale` `scaleX` `scaleY` `scaleXY` `rotate` `opacity` `transform` `show` `hide` `mask` `clearMask` `clip` `clearClip` `filter` `clearFilter` `circleReveal` `circleClose` `wipe` `backdrop` `blend` `effect`。

两条对本卡最关键的事实：

**1.1 `Camera extends Displayable`。** 镜头的推拉摇、压暗、遮罩、滤镜与图片走**完全相同**的 Transform 管线。`story.camera` 是 story 级单例，姿态**跨场景保留**，随存档序列化。

**1.2 NLR 里没有「角色动作」这一类。** `Character` 只有 `say` / `setName` / `apply` / `call` 和立绘绑定；角色立绘就是一个 `Image`。核对编译器 `storyCompiler.ts` `compileCharacterStageAction`：

| Studio action | 实际编译产物 | 等价于 |
|---|---|---|
| `character.enter` | `image.char(src).show(transform)` | `imageSetSource` + `imageShow` |
| `character.move` | `compileDisplayableOperation(image, "transform")` | `displayableTransform`（逐字节相同） |
| `character.exit` | `compileDisplayableOperation(image, "hide")` | `displayableHide`（逐字节相同） |
| `character.expression` | `image.char(src, transition)` | `imageSetSource` |

**但这不构成收敛理由** —— 见 §3.1 裁决。此表的用途是：任何人日后想"顺手把角色并进图片"时，先读 §3.1。

---

## 2. 诊断：四张互不同构的目录

| 层 | 条目数 | 组织原则 | 消费者 |
|---|---|---|---|
| `ACTION_COMMANDS` | 57 | **对象类型 × 动词**矩阵 | 侧栏 `StoryActionCreatorPanel` |
| spec registry | 46 | **泛型动词 + 目标**（B3） | 行内 `/` 创建器 |
| `StoryActionPayload` | 13 kind / 36 舞台 operation | **元素 × operation** | 存储 / 编译器 |
| Inspector 下拉 | —— | 第四张隐形目录 | 属性面板 |

四张之间没有一张是另一张的投影，靠 `createBlockForCommand` 的大 switch 与 `buildShowHide` 的手写 dispatch 缝合。可核算的后果：

- **D1 `show`/`hide` 在侧栏有 10 个入口**（`characterEnter` `characterExit` `imageShow` `imageHide` `textShow` `textHide` `videoShow` `videoHide` `displayableShow` `displayableHide`），NLR 里是 1 个（Video 另有自己的 1 个）。而 `/show` `/hide` 只有 2 个且已正确按目标分派。**两个菜单在教两套互斥的心智模型。**
- **D2 同一系统里两种相反的粒度策略。** 一边把 `Displayable.show()` 摊成 10 条；另一边把 10 个视觉效果压进 1 条 `displayableEffect`（inspector-first）。作者无法预测下一个能力会落在哪一侧。
- **D3 确凿重复项。** `condition` 与 `conditionIf` 的构造器逐字相同（`storyActionCommands.ts` 两处都返回 `{control:"condition"}`），却在 control 分类里并排显示。
- **D4 只有 inspector 能到达的操作。** `layer` 的 `show/hide/transform`、control 容器的 `doAsync/allAsync` —— 两个菜单都无入口，只能先建块再改下拉。
- **D5 13 个分类混了三种切分标准。** 按对象类型（character/image/text/layer/video）、按素材域（media/effects）、按用途（scene/control/data/utils/plugin）。「让立绘淡出」该去 character、image 还是 effects？「换背景」是 scene 还是 image？**分类本身不可推理。**
- **D6 引擎能力缺口。** Camera（整类）、Vfx（整类）、Video 的 pause/resume/stop/seek、`Character.setName`、`Control.label`/`Control.jump` —— 引擎已有，Studio 零入口。

---

## 3. 已决裁决（需求方裁定，不再讨论）

### 3.1 Character 是固定设计，不拆

**Studio 层面的「角色」= 立绘 + 语音 + 台词，是一个不可拆的作者概念。** 理由：普通用户碰不到 NLR；对传统 NVL 引擎的作者而言，把角色拆成"一个图片对象 + 一段语音资源 + 一行文本"不符合直觉。

因此：`character` action kind **保留**，角色保留完整动词集（说话/登场/换装/移动/退场），**不并入** `image` / `displayable`。§1.2 的等价表仅作为架构记录存在。

### 3.2 `/transform` 与 `/fx` 不合并

两者目标集合相同、都是 inspector-first、都写 `displayable` payload，但**保持为两条独立指令**。`/transform` 是高频路径（位置/缩放/旋转/透明度），不能因为归类整洁而多一层选择。

### 3.3 Camera 是独立 action kind + 独立顶级分类

不做成 `StoryDisplayableTargetRef` 的一个 `builtin` 值。理由：镜头在作者心智上无法与其他舞台操作归为一类，即使引擎实现上它是 Displayable。**引擎的类层次不等于作者的心智模型**，此处以后者为准。

### 3.4 侧栏放弃 `ACTION_COMMANDS`

侧栏改为 spec registry 的另一种呈现。57 条独立目录整体删除。

### 3.5 跳标签用独立的 `/goto`，不泛型化 `/jump`

`/jump` 必须保持"跳转场景"的直接语义 —— 跨场景跳转会卸载并重初始化场景，跳标签只移动播放头，两者运行时语义差别过大，不应由目标类型隐式分派。作者多记一个 label 概念的成本可以接受。

### 3.6 命名改动

- `/var`（存档变量）→ **`/save`**，`/var` 降为别名。理由：`var` 在所有编程语言里是"变量"的通用词，作者会拿它声明任意作用域的变量 —— 这是全套指令里最强的直觉陷阱。
- `/persis`（全局变量）→ **`/global`**，`/persis` 降为别名。理由：`persis` 是截断词，不是英文单词，无法猜。
- `/swap` 删除别名 `setimg` / `settext`。理由：这两个别名在教"对象类型 × 动词"，与 B3 直接矛盾。

---

## 4. 目标模型

### 4.1 分类：13 → 8，单一切分标准（主语）

| 新分类 | 吸收 | 二级主语 |
|---|---|---|
| **角色** | character + 对话/旁白 | —— |
| **舞台** | image + text + layer + video + displayable 系 effects | 图片 · 文字 · 图层 · 视频 · 氛围特效 |
| **镜头** | 全新 | —— |
| **场景** | scene + 全屏 effects | —— |
| **声音** | media | —— |
| **数据** | data 的变量部分 | —— |
| **流程** | control | —— |
| **工具** | utils + data 的代码/蓝图 + plugin | —— |

原 `effects` 分类**解散**：它按"素材域"切，与其余维度不同构。displayable 系（`/transform` `/fx`）进「舞台」，全屏系（`/blink` `/vignette`）进「场景」。

旁白归入「角色」：NLR 的 `Narrator` 就是一个 Character，且与「谁在说话」是同一个选择。

### 4.2 侧栏由 spec 自动导出（本卡唯一的新机械）

侧栏改用 spec registry 会立刻撞上：`/show` 是泛型动词、横跨五种主语，而 spec 只有一个 `category` 字段，只能出现在一个分类下 —— 作者浏览「图片」时找不到"显示"。

解法所需数据**已经在 spec 里**：`targetParam(accepts)` 的 `accepts` 就是"这个动词能用于哪些主语"。

> **归类规则（实现要点）**
> - spec **有** target 参数 → 按 `accepts` 归入其中的**每一个**主语（同一 spec 可出现在多个主语下）。
> - spec **无** target 参数 → 按 `category` 归入分类。
>
> 主语×动词二维菜单由此自动导出，不需要第二张目录。`category` 字段保留，语义收窄为"无目标指令的归属"。

**侧栏项的建块行为**：调用 `spec.build({}, ctx)`（bible 已保证 `build` 接受空 args 并返回合法默认块），得到目标未绑定的块，由 inspector 挑目标。`createBlockForCommand` 保留但降级为 spec 内部实现细节，不再是菜单入口。

---

## 5. 完整指令表

状态：**保留** / **改名** / **移除** / **新增** / **扩展**（现有指令接受更多目标）

### 5.1 角色 —— Character

| 指令 | 作用 | action（payload） | 状态 |
|---|---|---|---|
| `#名字 台词` | 角色说台词（含语音绑定） | `nodeAction.dialogue` | 保留 |
| `/say` | 同上，指令形式 | `nodeAction.dialogue` | 保留 |
| 裸文本 | 旁白 | `nodeAction.narration` | 保留 |
| `/show` `/enter` | 立绘登场 | `action.character.enter` | 保留 |
| `/face` `/expr` | 换表情 / 形态 | `action.character.expression` | 保留 |
| `/move` | 立绘移动 | `action.character.move` | 保留 |
| `/hide` `/exit` | 立绘退场 | `action.character.exit` | 保留 |
| `/rename` | 改显示名（"？？？"→ 真名） | `action.character.setName` | **新增** |

### 5.2 舞台 › 图片 —— Image

| 指令 | 作用 | action | 状态 |
|---|---|---|---|
| `/image` `/img` | 放置图片 | `action.image.create` | 保留 |
| `/swap` `/src` | 换图源 | `action.image.setSource` | 保留（**删别名 `setimg`**） |
| `/show` `/hide` | 显示 / 隐藏 | `action.image.show/hide` | 保留 |
| `/transform` | 位置 / 缩放 / 旋转 / 透明度 | `action.displayable.transform` | 保留（**不与 `/fx` 合并**，§3.2） |
| `/fx` `/effect` | 遮罩 / 裁剪 / 滤镜 / 变暗 / 圆形 / 扫过 | `action.displayable.<10 ops>` | 保留 |
| `/fx` | 毛玻璃 `backdrop-filter` | `action.displayable.backdrop` | **新增**（P3 低优先） |
| `/fx` | 混合模式 `mix-blend-mode` | `action.displayable.blend` | **新增**（P3 低优先） |

### 5.3 舞台 › 文字 —— Text

| 指令 | 作用 | action | 状态 |
|---|---|---|---|
| `/text` `/txt` | 放置文字 | `action.text.create` | 保留 |
| `/swap` | 改文字内容 | `action.text.setText` | 保留（**删别名 `settext`**） |
| `/font` | 字号 / 颜色 | `action.text.setFontSize` `setFontColor` | 保留 |
| `/show` `/hide` | 显示 / 隐藏 | `action.text.show/hide` | 保留 |
| `/transform` `/fx` | 同图片 | `action.displayable.*` | 保留 |

### 5.4 舞台 › 图层 —— Layer

| 指令 | 作用 | action | 状态 |
|---|---|---|---|
| `/layer` | 新建图层 | `action.layer.create` | 保留 |
| `/layer z=` | 层级 | `action.layer.setZIndex` | 保留 |
| `/show` `/hide` | 显示 / 隐藏 | `action.displayable.show/hide` | 保留（**侧栏首次给入口**，解 D4） |
| `/transform` `/fx` | 变换 / 效果 | `action.displayable.*` | 保留（同上） |

### 5.5 舞台 › 视频 —— Video（非 Displayable，动词自成一套）

| 指令 | 作用 | action | 状态 |
|---|---|---|---|
| `/video` `/vid` | 放置视频 | `action.video.create` | 保留 |
| `/play` | 播放 | `action.video.play` | 保留 |
| `/show` `/hide` | 显示 / 隐藏 | `action.video.show/hide` | 保留 |
| `/pause` | 暂停 | `action.video.pause` | **扩展**（现有音频指令 target 加 video） |
| `/resume` | 继续 | `action.video.resume` | **扩展** |
| `/stop` | 停止 | `action.video.stop` | **扩展** |
| `/seek` | 跳到时间点 | `action.video.seek` | **新增** |

用泛型动词吸收后，四项能力只新增 1 个 token。

### 5.6 舞台 › 氛围特效 —— Vfx（0.16.0 新元素）

| 指令 | 作用 | action | 状态 |
|---|---|---|---|
| `/vfx` | 放置全屏氛围叠加（落花 / 雨雪 / 尘埃 / 光斑） | `action.vfx.create` | **新增** |
| `/show` `/hide` | 淡入 / 淡出 | `action.vfx.show/hide` | **新增**（复用泛型动词） |
| `/pause` `/resume` | 冻结 / 继续 | `action.vfx.pause/resume` | **新增**（复用） |
| `/rate` | 播放速率（飘落快慢） | `action.vfx.setPlaybackRate` | **新增**（复用） |

同样只新增 1 个 token。资产管线复用视频；`blendMode`（`normal`/`screen`/`multiply`/`lighten`/`color-dodge`/`overlay`）、`opacity`、`fit`、`zIndex` 在 inspector。

### 5.7 镜头 —— Camera（独立 action kind + 独立顶级分类，§3.3）

| 指令 | 作用 | action | 状态 |
|---|---|---|---|
| `/camera pan` | 平移镜头 | `action.camera.pan` | **新增** |
| `/camera zoom` | 推近 / 拉远 | `action.camera.zoom` | **新增** |
| `/camera rotate` | 倾斜 | `action.camera.rotate` | **新增** |
| `/camera darken` | 整个舞台压暗 | `action.camera.darken` | **新增** |
| `/camera reset` | 复位到中性姿态 | `action.camera.reset` | **新增** |

一个 token，第一个位置参数是 operation 枚举：`/camera zoom 1.5 d=0.8`、`/camera pan left d=0.6`、`/camera darken 0.6`、`/camera reset d=0.6`。

### 5.8 场景 —— Scene

| 指令 | 作用 | action | 状态 |
|---|---|---|---|
| `/bg` `/background` | 设置背景 | `action.setBackground` | 保留 |
| `/jump` | **跳转场景**（卸载并重初始化） | `jump` | 保留（语义不泛型化，§3.5） |
| `/nvl` | NVL 堆叠对白块 | `action.nvl` | 保留 |
| `/blink` | 闪白 | `action.screenEffect.blink` | 保留（从 effects 迁入） |
| `/vignette` `/vig` | 暗角 | `action.screenEffect.vignette` | 保留（从 effects 迁入） |

### 5.9 声音 —— Sound

| 指令 | 作用 | action | 状态 |
|---|---|---|---|
| `/bgm` | 背景音乐 | `action.audio.setBgm` | 保留 |
| `/sound` `/se` | 播放音效 | `action.audio.playSound` | 保留 |
| `/vol` `/volume` | 音量 | `action.audio.setVolume` | 保留 |
| `/rate` | 播放速率 | `action.audio.setRate` | 保留（target 扩展到 vfx） |
| `/stop` | 停止 | `action.audio.stopSound` | 保留（target 扩展到 video） |
| `/pause` | 暂停 | `action.audio.pauseSound` | 保留（扩展 video / vfx） |
| `/resume` | 继续 | `action.audio.resumeSound` | 保留（扩展 video / vfx） |
| `/mute` `/unmute` | 静音 / 取消 | `action.audio.muteSound` | 保留 |

**8 条一条不合。** NLR `Sound` 本身就是这 8 个方法，且 B4 的"省略目标默认 BGM"已把成本压到 `/vol 0.5` 三个字符。合成"声音设置 + operation 下拉"是倒退。

### 5.10 数据 —— Data

| 指令 | 作用 | action | 状态 |
|---|---|---|---|
| `/local` `/scenevar` | 声明场景变量 | `declaration(scope=scene)` | 保留 |
| **`/save`** ← `/var` | 声明存档变量 | `declaration(scope=saved)` | **改名**（§3.6） |
| **`/global`** ← `/persis` | 声明全局变量 | `declaration(scope=persistent)` | **改名**（§3.6） |
| `/set` | 赋值（含表达式） | `action.setVariable` | 保留 |
| `/inc` `/add` | 增加 | `action.setVariable` | 保留 |
| `/dec` `/sub` | 减少 | `action.setVariable` | 保留 |
| `/toggle` `/flip` | 翻转布尔 | `action.setVariable` | 保留 |
| `/reset` | 恢复声明默认值 | `action.setVariable` | 保留 |

四个赋值糖**不合回** `/set`：存储层已经是合的，展示层的分开正是 B8 的价值。三个声明**不合成** `/declare scope=`：作用域是这条语句最重要的信息，不能变成可省略的具名参数。

### 5.11 流程 —— Flow

| 指令 | 作用 | action | 状态 |
|---|---|---|---|
| `/menu` `/choice` | 选项菜单 | `nodeAction.choice` | 保留 |
| （脚手架） | 选项 | `nodeAction.choiceOption` | 保留 |
| `/if` | 条件分支 | `control.condition` | 保留 |
| （脚手架） | elseIf / else | `control.conditionBranch` | 保留 |
| `/repeat` `/loop` | 重复 N 次 | `control.repeat` | 保留 |
| `/parallel` | 同时执行 | `control.parallel` | 保留 |
| `/race` | 竞速，先完成者继续 | `control.race` | 保留 |
| `/sequence` `/seq` | 按序执行 | `control.sequence` | 保留 |
| `/wait` | 等待时长 / 等待点击 | `action.wait` | 保留 |
| `/label` | 标记一个位置 | `control.label` | **新增** |
| `/goto` | 跳到本场景内的标签（不卸载场景） | `control.goto` | **新增** |

### 5.12 工具 —— Utils

| 指令 | 作用 | action | 状态 |
|---|---|---|---|
| `/note` `//` | 仅 Studio 可见的注释 | `note` | 保留 |
| `/code` `/script` | 代码块 | `code` | 保留 |
| `/blueprint` `/bp` | 执行 Story Action 蓝图 | `action.blueprint` | 保留 |
| （动态） | 插件动作 | 插件注册 | 保留 |

---

## 6. 移除清单

| 项 | 类型 | 理由 |
|---|---|---|
| `conditionIf` | 侧栏条目 + `ActionCommandId` 成员 | 与 `condition` 构造器逐字相同（D3） |
| `ACTION_COMMANDS`（57 条） | 整份目录 | 由 spec + `accepts` 自动导出取代（§4.2、§3.4） |
| `ACTION_COMMAND_CATEGORIES`（13 条） | 分类表 | 由 8 分类表取代（§4.1） |
| `/swap` 别名 `setimg` / `settext` | 别名 | 与 B3 矛盾（§3.6） |
| `story.actionCommand.<id>.label/detail` | i18n（约 114 键 × 语言数） | 随 `ACTION_COMMANDS` 退役；spec 侧 `story.command.<id>.*` 为唯一来源 |

**不是删除、而是补入口**：`layer` 的 `show/hide/transform`（D4）。

**保持 inspector-only（有意，需在 spec 注释里写明）**：control 容器的 `doAsync` / `allAsync`。

---

## 7. 新增能力规格

以下给出足以派生执行卡的形状；具体字段名可由执行者调整，但语义须一致。

### 7.1 `action: "camera"`

```
operation: "pan" | "zoom" | "rotate" | "darken" | "reset"
position?: <复用 placement / 精确 xalign,yalign>   // pan
zoom?: number                                     // zoom
rotation?: number                                 // rotate（度）
darkness?: number                                 // darken，0..1
durationMs?: number
easing?: string
```

编译落点：`nlrStory.camera.<pan|zoom|rotate|darken|reset>(...)`。编译器上下文已持有 `nlrStory`（`storyCompiler.ts` `SceneCompileContext`），无需新解析机械。

**作用域告知（UI 必做）**：镜头是 story 级单例，姿态**跨场景保留**。作者若不知道，会以为切场景自动复位。分类页需有一句常驻说明，且 `/camera reset` 在文案上要显眼。

**与 `/vignette` 的区分（文案必做）**：`/vignette` 是场景内的暗角遮罩层；`/camera darken` 是整个舞台的亮度（走 `filter: brightness()`）。两者极易混淆。注意 `darken` 与其他 filter 共用同一通道 —— 同时用 `blur` 需自行写完整 filter 串（引擎文档已注明）。

### 7.2 `action: "vfx"`

```
operation: "create" | "show" | "hide" | "pause" | "resume" | "setRate"
objectName: string
assetId?: string          // 视频资产
blendMode?: VfxBlendMode
opacity?: number
loop?: boolean
fit?: "cover" | "contain" | "fill"
zIndex?: number
rate?: number             // setRate
durationMs?: number       // show/hide 淡入淡出
```

`create` 参与 `displayableSourceIdentity`，使 `/show` `/hide` `/pause` `/resume` `/rate` 的目标解析能找到它。**注意 Vfx 不是 Displayable** —— 它不接受 `/transform` `/fx`，`accepts` 列表须排除。

资产：复用视频资产类型；两条素材路线（true-alpha WebM 用 `normal`，黑底辉光用 `screen`）在 inspector 里给出选择提示。

### 7.3 `action.video` 扩展

`operation` 增加 `"pause" | "resume" | "stop" | "seek"`；`seek` 带 `timeMs: number`。`/stop` `/pause` `/resume` 的 `targetParam` accepts 加入 `"video"`（`/rate` 加入 `"vfx"`）。

**歧义规则**：`/pause` 无目标时按 B4 默认 BGM；有目标时按解析出的对象类型分派。ghost 提示需显示将要作用的对象，避免作者误以为在操作音频。

### 7.4 `action.character` 扩展

`operation` 增加 `"setName"`；带 `displayName: string`。编译落点 `character.setName(name)`。

### 7.5 `control.label` / `control.goto`

```
control: "label";  name: string
control: "goto";   targetLabel: string
```

编译落点 `Control.label(name)` / `Control.jump(name)`。

**编译期校验（必做）**：`goto` 的目标标签必须存在于**同一场景**，否则引擎构建失败。Studio 必须在编译期给出诊断，不能让作者拿到一个构建失败的产物。同名标签重复声明同样需诊断。

**与 `/jump` 的区分（文案必做）**：`/jump` 跳场景会卸载并重初始化场景；`/goto` 只移动播放头。两条指令的说明文案必须互相点名。

---

## 8. 里程碑

### M1 —— 目录收敛（无 schema 变更，无新能力）

侧栏改用 spec registry；实现 §4.2 的 `accepts` 归类规则；8 分类重排；删 `conditionIf`；删 `setimg`/`settext` 别名；`/var`→`/save`、`/persis`→`/global` 改名（旧 token 保留为别名）。

**风险点（M1 唯一的真实迁移）**：收藏夹 `story.actionCreator.starredActionIds`（设置键，见 `StoryActionCreatorPanel.tsx`）持久化的是 **palette command id**，删除 `ACTION_COMMANDS` 后全部成为孤儿。必须给一张 `ActionCommandId → spec id` 映射做一次性迁移；无对应者（如 `conditionIf`）丢弃。**不要**静默清空用户收藏。

改名**不影响已存文档**（文档存 payload，不存 command id），只影响肌肉记忆与 i18n 键。

### M2 —— 零架构成本的能力补齐

`/camera`（§7.1）、`action.video` 四个 operation + `/seek`（§7.3）、`/rename`（§7.4）。三项互不依赖，可并行。

`/camera` 优先级最高：表现力/成本比最高，且是 8 分类里唯一空着的分类。

### M3 —— 新元素与流程

`/vfx`（§7.2）、`/label` + `/goto`（§7.5）。两者都需要新 action kind 与编译期校验，成本高于 M2。

### M4 —— 低优先补漏

`/fx` 的 `backdrop` / `blend` 两个 operation。

---

## 9. 明确不做

| 项 | 理由 |
|---|---|
| `character` / `image` / `text` / `layer` 的 show/hide/transform 在 **payload 层**收敛进 `displayable` | 需 schema 迁移 + 编译器 / inspector / 舞台快照 / staging lens 全线改动，收益是内部少 9 个 operation，**作者感知为零** —— 作者看的是菜单，不是 payload。等到有别的理由必须动 schema 时顺带做 |
| 音频 8 条合并 | §5.9 |
| `/inc` `/dec` `/toggle` `/reset` 合回 `/set` | §5.10 |
| 三个声明合成 `/declare scope=` | §5.10 |
| `displayableEffect` 的 10 个 operation 拆成 10 条菜单项 | B10 的 inspector-first 是对的，低频复杂能力不占菜单宽度 |
| `Control.whileLoop` / `breakLoop` | VN 场景罕见，`repeat` + `condition` 可近似 |
| `Image` wearable（挂件叠层）、`Scene.preloadImage` | 专业向 / 非作者面 |
| 引入"简单 / 高级"双模式 | 已裁决否决；且双模式等于把"两张目录"合法化，会让本卡的收敛全部失效 |

---

## 10. 总账与验证口径

| | 现在 | 目标 |
|---|---|---|
| 分类 | 13（三种切分标准混用） | **8**（单一标准：主语） |
| 侧栏条目 | 57（独立目录，type×verb 矩阵） | **由 spec 自动导出**，与斜杠同源 |
| 斜杠指令 | 46 | **52**（+6 新 token：`/rename` `/vfx` `/camera` `/label` `/goto` `/seek`；另 2 项改名 `/var`→`/save`、`/persis`→`/global`） |
| 目录份数 | 4（侧栏 / 斜杠 / payload / inspector） | **2**（spec + inspector，且 inspector 是 spec 的展开） |
| 引擎能力缺口 | Camera · Vfx · Video×4 · setName · label/goto | 全部补齐 |

**验证口径**

- 每个里程碑：`yarn lint`（注意：本仓 lint 只跑 tsc，"lint 干净"仅证明类型）+ vitest 新失败 0（win32 基线 8–9 个既有失败不算回归）。
- M1 必须有一条测试覆盖 `accepts` 归类规则：`/show` 同时出现在角色/图片/文字/图层/视频五个主语下，且 `/vfx` 创建的对象不出现在 `/transform` 的可选目标里。
- M1 必须有一条测试覆盖收藏夹迁移：旧 id 集合迁移后条目数不减（除 `conditionIf`）。
- M2/M3 每项新能力需真机跑通一次（编译产物实际生效，不止建块成功）。`/camera` 需验证跨场景姿态保留。
- 每个里程碑一份 `docs/plans/reports/` 报告（≤60 行，沿用既有模板）。
- 引擎侧若有任何改动，CHANGELOG 必写（既有铁律）。

---

## 11. 留给执行者的开放项

1. **`/camera` 的 operation 是否够用**：目前 5 个（pan/zoom/rotate/darken/reset）。Displayable 还有 `opacity` `scale` `filter` `mask` 等对镜头理论可用的方法。本卡的判断是 5 个覆盖 95% 用例，其余走 P3；执行者若在真机试用中发现缺口，可提案追加。
2. **`/camera pan` 的位置参数粒度**：本卡沿用 `placementParam()`（left/center/right），精确 `xalign`/`yalign` 走 inspector。若发现镜头场景下三档太粗，可考虑行内接受数值。
3. **8 分类的本地化标签与图标**：本卡只定分类骨架，未定 label/icon/色值。需与既有 UI 风格约束对齐（最小 chrome，复用既有组件）。
4. **`/goto` 的标签补全**：目标应从同场景的 `label` 行扫描得出（类似变量表的扫描机制）。执行者需确认这条扫描是否可复用现有 `StoryCommandContext` 的构建路径。

---

## 12. Orchestrator 裁决（2026-07-24）

本卡**采纳为正式规划**。§1–§11 的诊断与目标模型全部通过；§3 的需求方裁决不动。以下为编排层的修订与补充，与正文冲突时以本节为准。

### 12.1 里程碑改名（避免编号冲突）

本卡的 M1–M4 与总计划 `2026-07-22-001` 的 M1–M7 是两套编号，会在派卡与报告里混淆。本卡里程碑统一改称 **A1（目录收敛）· A2（零成本能力补齐）· A3（新元素与流程）· A4（低优先补漏）**，正文中的 M1–M4 按此对应。

### 12.2 §4.2 的前置事实必须先核验（A1 第一步）

本卡断言"`targetParam(accepts)` 的数据已经在 spec 里"。**A1 动手前先核实这一点**：如果 `accepts` 尚不存在、或只覆盖部分指令，补齐它属于 A1 范围（不另立卡），但必须在报告里写清核实结论——整个自动导出机制建立在这个断言上，它若不成立，A1 的形状要重估。

### 12.3 `ACTION_COMMAND_CATEGORIES` 的连坐面（A1 硬前置，本卡低估）

分类表不只喂侧栏。13→8 会同时改变**已落地**的四处消费：

- 行左缘类别色条与 `BlockBadge` 底色（总计划 M1 的行类视觉系统，色值唯一真源就是 `iconColor`）；
- `/` 空态的分类浏览网格（M3.1 palette）；
- spec 派生的指令手册（M3.1）；
- 演出透镜的容器模式徽标（M7，用 control 类别色）。

**要求**：A1 先做一次消费者盘点并在报告列出；8 分类必须重新指派完整的 icon/色值（不得留空回退成灰）；行视觉不得退化。这是 A1 里唯一会被用户一眼看见的风险。

### 12.4 i18n 退役的跨仓账（记账，不在 A1 内做）

`story.actionCommand.<id>.*` 退役会波及**已发布的插件语言包**（`NarraLeaf/Plugins` 的 locales 包是全量覆盖式的）。A1 完成后语言包需要重新生成一版；A1 报告里点名此事即可，不在本线内做。

### 12.5 `/save` 的 token 保留裁定

§3.6 的改名接受。但 `/save` 单独出现时会被读成"执行存档"这个动词——为杜绝后来者占用，A1 顺手在 bible 写死一句：**`/save` 只用于声明存档作用域变量；触发存档不是故事指令，将来也不会是**（存档是运行时/UI 关注点）。`/local` `/save` `/global` 作为并列三条时可读性成立，这条保留声明是它的护栏。

### 12.6 `/label` `/goto` 的工具连坐（A3 硬要求）

`goto` 让**行序 ≠ 执行序**，这会撞上两个已落地的工具：

- **Dev Mode 时间线热跳**（M5）按行序判断"目标在当前之后"才用 `fastForward({until:{actionId}})`。有 `goto` 后该判断可能失真——依赖既有的 `reachedTarget:false → 静默回落冷跳`兜底即可，但 A3 必须显式验证这条回落路径在 label 循环下成立（引擎侧另有 `maxSteps` 兜底，不会空转）。
- **场景流程图**（M6）只表示跨场景 `jump`；`goto` 是场内跳转，**不进场景图**——与 M6 卡的边界一致，不要顺手加。

### 12.7 演出透镜的时长派生要认识新 action（A2/A3 验收项）

`/camera` 与 `/vfx` 都带 `durationMs`。M7 的 `deriveBlockTiming` 若不认识它们，这两类动作在 `/parallel` 容器里会渲染成"未知时长"的等宽虚条——本该是它们最典型的用法（镜头推近与立绘移动同时进行）。A2/A3 各自把新 action 接进时长派生，并在验收里跑一次并行容器。

### 12.8 排期

- **A1 等在飞的两张卡落地后再开**（`2026-07-24-004` 0.16.1 采纳、`2026-07-24-005` M6）：A1 与 palette/手册/行视觉同区，三线并行必冲突。
- **A2 可立即与 A1 并行**：`/camera` 是新 spec + 新 payload + 新编译分支 + 新 inspector 区，与 A1 的目录重构文件交集小。§11 开放项 1/2（operation 集合、pan 粒度）授权执行者在真机试用后提案。
- A3、A4 顺延。

### 12.9 §11 开放项 4 的倾向

`/goto` 的标签补全**复用 `StoryCommandContext` 的扫描路径**（与变量表同构，同一份场景扫描）；不可复用时新建一个纯函数扫描器，**不要**在 completion 层写指令特例——那正是 bible 立法要消除的东西。
