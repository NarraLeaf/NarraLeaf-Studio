---
title: "feat: 故事编辑器指令系统（斜杠命令 + 参数补全）"
type: feat
status: draft
date: 2026-07-16
---

# feat: 故事编辑器指令系统（斜杠命令 + 参数补全）

## Overview

需求的表层是"打斜杠能用命令名和参数快速创建 action"。但这个功能**已经有一半了** —— `InsertRow` 里的 `/` 已经能打开动作菜单、能键盘过滤、能回车选中（`StorySceneEditorRows.tsx:700-825`）。

缺的是另一半，而且这一半正好是全部痛点所在。`storyActionCommands.ts:395`：

```ts
export function isInspectorFirstCommand(commandId: ActionCommandId): boolean {
    return !["narration", "dialogue", "note", "choiceOption"].includes(commandId);
}
```

除了四个纯文本命令，**其余 55 个 action 全部是"创建即跳 inspector"**。用户按 `/` 只是用键盘选了个 action *类型*，参数一个都没填，然后被扔进一个表单。用户抱怨的"还需要用鼠标去点击各个界面"，正是被这一行强制的。

所以本计划的主体不是"斜杠菜单"，而是**参数的行内输入、位置感知的候选补全、键盘提交**。斜杠菜单只是它的第一个 token。

## 1. 目标与非目标

### 目标

1. 命令行可输入**参数**，不止命令名：`/bg forest_day t=fade d=500` 一次成型，回车落库，光标落到下一行。
2. **位置感知的候选补全**：光标在主参数位是资产候选，在 `t=` 后是 transition 枚举，在 `/show ali` 是角色 —— 由参数类型决定候选来源。
3. **落库前实时预览 + 行内报错**：解析不通过绝不建块。
4. 砍掉 P0 覆盖命令的 `isInspectorFirstCommand`，让它们直接落成完整 action。
5. 候选逻辑抽成**共享 registry**，inspector 与命令行同源。
6. 插件 story action 可声明参数 schema，与内置命令同等享受补全。

### 非目标

- **不做反向编辑**（产品决策，见 §3.4）。命令串是一次性输入，回车后完全转化为 action，此后只能通过界面编辑。
- **不做命令行全量参数覆盖**。命令行只承载每个 action 的高频参数子集（2–4 个），transform 九连、blueprint 引用、motion 仍归 inspector（§3.5）。
- **不翻译命令 token**。`/bg` 在任何语言下都是 `/bg`（§3.6）。
- **不改 NLR**。这是纯编辑器输入层，编译产物不变。
- **不做整段脚本粘贴导入**。与反向编辑同属被砍的 parser 反向链路。

## 2. 硬约束

1. **`/` 只在行首且行为空时是命令触发符**。现在 `useStorySceneEditorController.ts:765` 是 `value.startsWith("/")`，在空插入行上成立。但一旦命令行承载参数，正文里的 `他/她`、`AC/DC` 就是真实的误触发风险 —— 触发条件必须显式收紧为"行首 + 空行"，其他任何位置的 `/` 是普通字符。`#` 同理。
2. **解析失败不落成动作块 —— 落成无效行。** 块一旦创建就是结构化数据；建一个半残 block 再叫用户去 inspector 修，比现状更糟。

   > **修订（交互模型落地后）** —— 初稿说的是"回车无操作"，现在有了确切的落点：`kind: "invalid"`（`StoryInvalidPayload { source }`，原文逐字保留，重新编辑即从它续写命令）。不是 note，不是旁白，无运行时行为。预览带 `error` diagnostic 跳过它（写作途中命令没写完是常态）；**构建**才是闸门 —— `BuildService.start` 用 `collectInvalidBlocks` 扫全库并拒绝。注意：**故事编译器是在游戏启动时跑的，不在构建期**，所以别指望用编译器来卡构建。
3. **候选逻辑单一来源**。`AssetSelector`、`DisplayableTargetField`、`CharacterAppearancePicker` 今天各自持有候选逻辑。命令行**不得**再抄一份，否则某天 inspector 能选的资产命令行选不到。registry 是 P0 前置。
4. **`createBlockForCommand()` 保持不变**。命令层只在它之后 `applyArgs`，不重写建块路径。这条保证 `/` 菜单选中（无参）与命令行（带参）走同一条建块链。
5. **grammar 与 payload 类型必须绑死**。`applyArgs` 的输出要能被 `StoryBlock` 的判别联合收窄；参数声明与 payload 字段漂移时应当是**编译期**错误，不是运行时 undefined。
6. **插件参数 schema 第一版就要留好**。`services.ts:668` 的 `StoryPluginActionRegistration` 目前只有 `{id, label, detail?, group?, createBlock}`。参数 schema 后加是破坏性变更 —— 必须在 P0 定形。
7. **纯函数层不碰 UI**。parser/grammar 不 import React、不读 service 单例，候选 provider 通过 ctx 注入。这是这套东西唯一能被测住的形态。

## 3. 核心模型

### 3.1 语法：少量位置参数 + 具名参数

Ren'Py 敢用位置参数是因为每条语句参数极少（`scene <image> with <transition>`）。而 `background` 有 asset/color/transition/duration，`character enter` 还带 transform preset —— `/bg forest 500 fade` 没人记得住顺序。TyranoScript 用户则从来不被要求记顺序（`[bg storage="room.jpg" time=1000]`）。

取两者公约数：**每个命令声明一小段有序位置参数（通常 1 个，至多 2 个），其余一律具名、可乱序、可省略。**

> **修订（grammar 实装时证伪）** —— 本节初稿写的是"恰好一个位置主参数"。这条在 P0 的十条命令里就死了两次：`/set gold 100`（变量 + 值）和 `/say alice 台词`（角色 + 台词）都需要两个。硬塞成一个的写法（`/set gold=100`、`/say alice text=…`）既不像 Ren'Py 也不像 Tyrano，纯属为了迁就一条错误的约束。改为**有序位置参数列表**，按声明顺序消费 —— 更简单，也是所有命令行的标准做法。"位置参数要少"的**意图**保留，但它是设计纪律，不是类型约束。

```
/bg forest_day t=fade d=500
/show alice at=left form=smile
/wait 1000
/jump chapter2
```

`/bg forest_day` 贴 Ren'Py 的开头手感，`t=fade` 贴 Tyrano 的 kv 习惯。主参数省略时命令仍合法（落成待填的 action，等价于今天的 `/` 菜单行为）。

### 3.2 参数类型驱动候选

grammar 层为每个 `ActionCommandId` 声明参数：

```ts
type StoryCommandParam = {
    name: string;              // 具名参数的 key，如 "t" / "d"
    aliases?: string[];        // "transition" / "duration"
    type: StoryCommandParamType | StoryCommandParamType[];  // 数组 = union，见下
    positional?: true;         // 至多一个
    greedy?: true;             // 吃到行尾，至多一个且必须末位，见下
    required?: boolean;
};

type StoryCommandParamType =
    | { kind: "asset"; assetType: "image" | "audio" | "video" }
    | { kind: "character" }
    | { kind: "scene" }
    | { kind: "variable"; scope?: "scene" | "saved" | "persistent" }
    | { kind: "displayableName" }
    | { kind: "enum"; options: readonly string[] }
    | { kind: "number"; min?: number; max?: number }
    | { kind: "color" }
    | { kind: "text" };
```

`type` → 候选 provider 的映射是整个系统的技术核心。光标所在的 token 决定查哪个 provider，query 是该 token 的已输入前缀。

`displayableName` 的候选必须沿用既有的 **static + stable binding** 规则（绑定到创建块 id，不是可变的 name），不能退化成字符串模糊匹配。

**`greedy`（原型验证时补）** —— `say` 的台词必须吃到行尾，且不被空格分词：`/say alice 你好 世界` 里 `世界` 不是第二个参数。一个命令至多一个 greedy 参数且必须在末位；tokenizer 遇到它就停止分词、原样取剩余串。没有这条 `/say` 根本不成立，而它是最高频的命令。greedy 参数位不出候选（`text` 类型无候选源）。

**union 类型（原型验证时补）** —— 主参数类型可以是数组：`background` 的主参数是 `[{kind:"asset",assetType:"image"}, {kind:"color"}]`，`/bg forest_day` 与 `/bg #1a1a1a` 都合法（`setBackground` 本就接受 asset 或 color）。候选合并展示，校验取"任一通过"，`applyArgs` 按命中的分支决定写 payload 的哪个字段。

### 3.3 候选 provider registry（P0 前置重构）

```ts
type StoryCandidateContext = {
    assets: AssetIndex;
    characters: Character[];
    scenes: SceneIndex;
    variables: DeclaredVariable[];
    displayables: DisplayableBinding[];  // 当前 scene 内、光标位置之前已创建的
};

type StoryCandidate = { value: string; label: string; detail?: string; icon?: ... };

type StoryCandidateProvider = (query: string, ctx: StoryCandidateContext) => StoryCandidate[];
```

先把 `AssetSelector` / `DisplayableTargetField` / `CharacterAppearancePicker` 里的候选**筛选与排序**逻辑抽出来（各组件保留自己的渲染），registry 成为两边唯一的数据源。这一步不做，命令行与 inspector 必然漂移。

### 3.4 为什么不做反向编辑（以及代价）

传统脚本用户的心智是"这行字就是这条命令"。他们打完 `/bg forest d=500` 发现时长错了，本能是回去改那个 `500`。要满足它需要每个命令双向序列化（`parse(tokens) → block` 与 `serialize(block) → string`），并在 action row 上把 Enter 从"开 inspector"改成"就地展开成命令串"。

**产品决策：不做。** 命令串输入完成后完全转化为 action，只能靠界面编辑。

代价是明确的：改一个参数仍会被赶回 inspector。两个缓解手段，均在 P0 范围内：

- **落库前一切可改**：预览条常驻，回车前命令行本身就是可编辑文本。落库后立刻 `Ctrl+Z` 整块撤回重打 —— 把"修补"换成"重打"，对短命令是等价体验。
- **inspector 只读显示等价命令串**：只展示、可复制、不可编辑。用于教学（GUI 用户自然长成命令用户的唯一低成本路径）与复制复用。这只需要 `serialize` 的展示路径，不需要 parser 往回接，**不违反本决策**。

### 3.5 命令行是快车道，不是全量 API

每个命令暴露 2–4 个高频参数。transform 的九个字段、blueprint 引用、motion 不进命令行 —— 那是表单的活。命令行负责"90% 的行 5 秒打完"，inspector 负责剩下 10% 的精调。

判断标准：**一个参数是否值得进命令行，看它是否在超过一半的使用里被显式设置。**

### 3.6 命令 token 不翻译，但中文可搜

命令 token 是关键字，像编程语言一样保持英文稳定，否则跨语言协作与文档全废。但菜单过滤要吃中文：打 `/背景` 高亮到 `bg`，回车后行内落成 `/bg`。**中文是别名/搜索词，不是 token。**

现有 `ActionCommandId` 是英文驼峰（`characterEnter`），用户不会打这个。需要一组短 token 别名：`bg` / `show` / `hide` / `move` / `say` / `wait` / `jump` / `set` / `play` / `stop` / `if`。`ActionCommand.aliases` 字段已存在（`storyActionCommands.ts:119`），但 `actionCommandMatchesQuery` 目前只在 query 以 `/` 开头时**排他地**匹配 aliases（为了 `//` → Note）。这个分支要重做：token 匹配与标签模糊搜索需要共存并分级排序。

### 3.7 渐进式披露

三类用户的唯一公约数。`/` 后菜单照常出现、边打边过滤 —— 新手浏览，老手无视。进入参数阶段后显示 ghost hint（灰字 `/bg <image> [t=] [d=]`），像 fish 的 autosuggestion。**任何时候都不要求用户预先记住 token 才能用。**

## 4. 交互规范

### 4.0 六条地基规则

其余全是推论。

1. ~~**Tab 永远是补全，永不提交。Enter 永远是提交，不可提交时先补全。**~~ **已被推翻，见下。**

   > **修订（交互模型落地时由用户裁定）** —— 现行契约是 `docs/story-editor-interaction-model.md` 的规则 2：**高亮就是 Enter 的指针。凡有候选被高亮处，Tab 与 Enter 完全等价 —— 这是刻意的。无高亮处，Enter 提交整行。**
   >
   > 于是绑定规则变成：**必选位默认高亮，可选下一步位不默认高亮。**
   >
   > - **命令名**与**说话人名**是必选位 → 默认高亮首项。
   > - **`k=` 参数位**是可选下一步 → **必须列出候选但不选中任何一项**，否则 `/bg forest_day` + Enter 永远无法提交（Enter 会去抓 `t=`），得多按一次 Esc 才行。
   >
   > 候选的展示与高亮是两件事：`k=` 位列出候选是**发现性**（让人知道还能填什么），不是**待选**。这条最容易在后续重构里被"顺手改成一致"而丢掉 —— 不要修它。
2. **能否提交由 grammar 的 `required` 决定，不由状态决定。** P0 无一命令设 `required`（见 §7-5），故此条在 P0 不触发；保留给插件。
3. **Esc 是一条退出梯，一次一级；从不提交，也从不销毁。** 第一级收起候选、保留文本；第二级丢弃整个插入槽。离开**编辑**会保存（走 history，故 Mod+Z 可撤）；离开**未提交的槽**不产生任何块。

   > **修订** —— 本节初稿写的是"Esc 一次退出命令模式，文本原样变旁白，不需要转义语法"。**错了。** Esc 第一级只收候选；`/` 开头的行此后要么解析成命令，要么落成**无效行**（`kind: "invalid"`），**绝不会变成旁白**。用户已接受其后果：**旁白不能以 `/` 开头**（见交互模型的"Known gaps"）。不要再为它加逃生舱。旧代码曾在 Esc 时把 `/set` 提交成一行旁白 —— 任何"取消动作产出块"的路径都不得重新引入。
4. **命令名落地即规范化。** `/背景` + Tab/空格 → 行内立刻变成 `/bg `。中文只活在候选菜单里，从不进入 token（§3.6）。
5. **两段式 Tab。** 参数名本身也是候选：`/bg forest_day ` 时菜单列 `t=` `d=`；Tab 补成 `t=` 且**不加空格**，候选立刻切到 transition 枚举，再 Tab 选值。用户不必记参数名 —— 与 `/` 菜单让用户不必记命令名同理，只是下沉一层。
6. **主参数可省略。** `/bg` + Enter 落一个待填的背景块，等价于今天 `/` 菜单选中的行为。新手路径零退化。

### 4.1 状态机

插入行的状态由**已输入文本 + 光标位置**纯函数导出（`parseCommandLine` 已实现这一层）。

> **修订** —— 初稿说"`chooser` 字段可以退休"，但**不能全退**：`EditorMode.insert` 上的 **`chooserDismissed` 必须保留**。候选面板是从 `value` 前缀派生的，而"作者按过 Esc"这件事**不在文本里** —— 没有这个标志，Esc 收起候选后下一次击键菜单就会弹回来（已在运行的 app 上验证过）。可以退休的是"当前是哪种 chooser"（那确实可从文本导出），不是"是否已被收起"。

| 状态 | 判据 |
| --- | --- |
| `Empty` | 空行 |
| `Narration` | 首字符非 `/` `#` |
| `CommandName` | `/` 后、尚无空格 |
| `PositionalArg` | 命令已定，主参数位未填 |
| `ParamName` | 主参数已填，当前 token 无 `=` |
| `ParamValue` | 当前 token 形如 `key=` 或 `key=前缀` |
| `Greedy` | 命令有 greedy 参数且主参数已填 |
| `CharacterPick` | `#` 后（等价于 `/say` 的主参数位） |

`BadCommand` / `BadValue` 是叠加在上述状态之上的错误标记，不是独立状态。

### 4.2 逐键路线

**默认高亮**（决定 Enter 的去向，见 §4.0-1）：CommandName、CharacterPick **高亮首项**；PositionalArg / ParamValue 高亮首项（也是必选位）；**ParamName 不高亮任何项** —— 列出候选只为发现性。

| 键 | CommandName | PositionalArg / ParamValue | ParamName（无高亮） | Greedy |
| --- | --- | --- | --- | --- |
| 字符 | 过滤命令菜单 | 过滤候选 | 过滤参数名 | 原样入文本，无候选 |
| `Tab` | 取高亮项 → canonical token + 空格 | 取高亮项（含空格值自动加引号）+ 空格 | 取首个匹配项 → `key=`，**不加空格** | 无操作 |
| `↑` `↓` | 移动高亮 | 移动高亮 | 移动高亮（此时才产生高亮） | 无操作 |
| `空格` | 规范化 token，进入参数阶段 | 结束当前 token | 结束当前 token | 原样入文本 |
| `=` | — | — | 转为 `ParamValue`，候选切该参数类型 | 原样入文本 |
| `Enter` | **同 Tab**（有高亮 → 取之） | **同 Tab**（有高亮 → 取之） | **无高亮 → 提交整行** | 提交 |
| `Shift+Enter` | 解析该行；解析不出 → 无效行。随后开一个空行 | 同左 | 同左 | 同左 |
| `Esc` ×1 | 收菜单，留文本（置 `chooserDismissed`） | 同左 | 同左 | — |
| `Esc` ×2 | 弃整个插入槽，不产生任何块 | 同左 | 同左 | 同左 |
| `Backspace` 于空行 | 沿用既有 demote 阶梯（`handleInsertBackspaceEmpty`） | | | |

> **Tab 已被腾出来给参数了。** 旧的 Tab 循环切换分类（`moveCategory`）**已删除**，分类 chips 只保留鼠标操作。这正是 §4.0-5 两段式 Tab 得以成立的前提。

### 4.3 关键路线

- **老手直达**：`/bg forest_day t=fade d=500` `Enter` → 落库，光标已在下一插入行。全程不抬手。
- **新手浏览**：`/` → 菜单列全部动作 → `↓↓` → `Enter`（此时不可提交，故补全为 `/bg `）→ 候选自动列出全部图片 → `↓` `Tab` → `Enter`。全程不需要预先知道任何 token。
- **鼠标用户**：点菜单项 → **进入参数阶段，而不是直接建块**。这是相对现状的关键改动 —— 鼠标用户同样吃到参数补全，不再被直接扔进 inspector。不想填参数就直接 Enter（若无 required）。
- **~~`/` 开头的旁白~~**：**不存在这条路线。** Esc 只收候选；`/` 行要么解析成命令，要么落成无效行。**旁白不能以 `/` 开头**（已接受的取舍，见交互模型 "Known gaps"）。要写这样一行，用命令来建。
- **打错要改**：`Ctrl+Z` 撤回该块，并把 `serialize(block)` 的结果**回填到插入行**，用户在原命令串上改。这是 §3.4"不做反向编辑"的核心缓解手段，且不需要额外存原始串 —— `serialize` 因 inspector 只读展示已经存在，此处复用。
- **`#` 角色**：`#alice` `Tab` → `#alice ` → 打台词 → `Enter` 落 dialogue block。与 `/say alice 台词` 等价，两条路都保留。

### 4.4 错误呈现

错误**只标记、不阻断输入**，且永不落库（§2.2）。

**"未知值"只适用于必须解析的类型**（asset / scene / variable / displayable）。它**绝不适用于说话人名** —— 一个匹配不到角色的名字是临时说话人，是合法的行，不是错误（`allowsFreeValue` 在 grammar 里编码了这条）。

| 错误 | 呈现 |
| --- | --- |
| 未知命令 `/bgg` | 菜单空，预览条红字"没有名为 bgg 的动作"，Enter → 落无效行 |
| 未知值 `/bg nonexist` | 该 token 标红，"找不到图片：nonexist"（仅限必须解析的类型） |
| 未知说话人 `/say Zoe` | **不是错误**。落成 `speakerName: "Zoe"` 的临时说话人 |
| 类型错 `/wait abc` | 该 token 标红，"abc 不是数字" |
| 未知参数名 `/bg x=1` | 该 token 标红，"x 不是 /bg 的参数" |
| 枚举越界 `/bg t=zoom` | 该 token 标红，"t= 没有 zoom 这个选项" |
| 缺 required | 不报错（未完成 ≠ 错误），Enter 时补全并停在缺失位 |

## 5. 落点

### 新增（纯函数，无 UI 依赖）

- `storyCommandGrammar.ts` —— 每个 `ActionCommandId` 的参数声明、`applyArgs(block, args)`、`serializeArgs(block)`（仅供 §3.4 的只读展示）。
- `storyCommandParser.ts` —— tokenize（引号、`k=v`）、resolve、带 token span 的错误定位。
- `storyCandidateProviders.ts` —— §3.3 的 registry。

三者均可纯单测，且应当是本计划测试覆盖的重心。

### 改动

- `StorySceneEditorRows.tsx` 的 `InsertRow` —— 升级为三段式：命令行输入、随光标所在参数切换的候选 popover、底部预览条。**`InsertRow` 里现有的按键路由已经对了，并已对着运行中的 app 验证过 —— 重写渲染时请把路由原样搬过去，不要重新推导一遍。**
- `storyActionCommands.ts` 的 **`resolveActionCommandToken(line)`** —— 这是留给本系统的接缝，今天只认第一个 token（`/note`、`//`）。用 parser 替换它，**契约不变**：能解析 → 提交该命令；不能解析 → 无效行。
- `useStorySceneEditorController.ts` —— 触发条件收紧为行首+空行（§2.1）；`chooseCommand` 增加 args 通路；保留 `chooserDismissed`（§4.1）。
- `storyActionCommands.ts:395` —— P0 覆盖的命令移出 `isInspectorFirstCommand`。
- `actionCommandMatchesQuery` 的 `/` 前缀分支仍是**排他匹配 aliases**，导致在**侧栏搜索框**里打 `/image` 返回空（§3.6）。这仍归本系统修。
- `services.ts:668` `StoryPluginActionRegistration` —— 增 `params?: StoryCommandParam[]`（§2.6）。
- `StorySceneActionInspector.tsx` —— 顶部只读命令串（§3.4）。

## 6. 分期

**P0 —— 高频十条打通全链路**

候选 registry 重构 → grammar/parser → InsertRow 三段式 → 砍对应的 inspector-first。

覆盖 `bg` / `show` / `hide` / `move` / `say` / `wait` / `bgm` / `sound` / `jump` / `set`。选这十条是因为它们覆盖绝大多数行，且参数结构差异足够大，能证伪 grammar 的表达力 —— 如果 grammar 撑得住 `set`（变量 scope + 值类型多态）和 `show`（角色 + 表情 + 位置 + 过渡），剩下 49 条就是填表。

**P1 —— 铺满**

其余命令、ghost hint、inspector 只读命令串、插件参数 schema 落地。

**P2 —— 打磨**

中文 token 别名、候选排序按使用频次学习、`//` 之类的特例收编。

## 7. 实装结论（grammar + parser 已落地）

`storyCommandGrammar.ts` / `storyCommandParser.ts` / `storyCommandParser.test.ts` 已写，29 个测试通过。P0 的十条命令全部可解析。以下是实装暴露的、与初稿不同的结论：

1. **位置参数是有序列表，不是"恰好一个"**。见 §3.1 的修订。
2. **`applyArgs` 应当每命令手写，不该从 grammar 声明式派生**。`StoryActionPayload` 的判别联合过于异构（`setBackground` 的 `assetId|color`、`character` 同时有 `transition` 和 `transform`、`wait` 用 `mode` 区分两种语义）。声明式只在 **parse / 候选 / hint** 三处付得起，写 payload 的那一步派生成本远高于手写。grammar 因此明确**不承诺**能生成 block。
3. **依赖类型有两处，不止 `set`**。`/show alice form=smile` 的 `form` 候选依赖已解析的 `character`（form 是每角色私有的）。已用 `{ kind: "characterForm"; dependsOn: "character" }` 显式声明依赖边。`set` 的 `value` 则用 `{ kind: "literal" }` 把依赖整个推给 resolution 层 —— parser 收下任意标量，由 resolution 对照变量的 `valueType` 判错。**依赖类型不进 parser** 是这套分层能保持纯函数的关键。
4. **union 校验必须"有可判分支才判"**。`/bg forest_day` 不能因为它不是合法 color 就报错 —— `asset` 分支在 parser 里根本无法判定，可能正好接受它。`isBadValue` 只在**所有**分支都明确拒绝时才报。这是最容易写错、且错了会让整个命令行天天误报的一处。
5. **`required` 在 P0 全部为空，规则 §4.0-2 不触发**。`createBlockForCommand` 本来就为每个命令产出 valid-but-unfilled 的 block，"落一个待填块"是调色板既有契约，命令行不能倒退。`required` 保留在类型里给插件用。
6. **command token 与 `ActionCommandId` 不是 1:1**。`/wait click` 与 `/wait 500` 共用 `waitDuration`，靠 payload 的 `mode` 分流；解析期不分叉，`applyArgs` 时才定。
7. **enum 值需要输入别名**。payload 里的 `fadeIn` / `maskCircle` / `throughColor` 不适合手打，grammar 给了 `fade` / `circle` / `black`。**parser 不做归一化**（`t=fade` 的 arg value 就是 `"fade"`），归一化是 resolution 的事 —— 保持 parser 输出忠实于用户所打。
8. **中文搜索不需要 grammar 出力**。命令的显示名已经走 `story.actionCommand.<id>.label` 的既有翻译，UI 按翻译后的 label 过滤即可命中 `/背景`。grammar 因此零 locale 数据，§3.6 的目标自动达成。

### 7.1 resolution + applyArgs + 接缝替换（已落地）

`storyCommandResolution.ts` / `storyCommandContext.ts` / `storyCommandApply.ts` 已写，`resolveActionCommandToken` 接缝已由 parser 接管（`commitCommandFromInsert`）。整条链在运行的 app 上验证过：`/bg outside.jpg t=fade d=500` 落盘为 `{assetId, transition:{kind:"fadeIn",durationMs:500}}`。新增结论：

9. **`allowsFreeValue` 是「参数」的属性，不是「类型」的属性 —— 上一版写错了。** `/say Zoe`（临时说话人，合法）与 `/show Zoe`（要显示立绘，没角色就没图，必须报错）用的是同一个 `{kind:"character"}`。改为 `{ kind: "character"; allowTemp?: true }` 按参数选择加入。这个错只有推进到 resolution 才会暴露 —— 在 parse 层两者都无法判定，看起来是对的。
10. **命令行必须覆盖调色板的全部命令，否则是回归。** 旧接缝 `resolveActionCommandToken` 匹配**任意 `ActionCommandId`** 加别名（`/imageCreate`、`/note`、`//`）。P0 的 grammar 只有 10 个 token，直接换上去会让另外 49 个命令全部落成无效行。已补 `PALETTE_COMMANDS`（由 `ACTION_COMMANDS` 派生、零参数）+ `getCommandDef` 的 id 兜底，并加了一条遍历 `ACTION_COMMANDS` 的回归测试钉住它。**没有 grammar 的命令走旧的菜单路径**（保留 inspector-first 与 `/note some text` 的 initialText 语义），直到 P1 给它们 grammar。
11. **命令行永不路由到 inspector。** 有 grammar 的命令提交后直接开下一个插入槽（Ren'Py 节奏）；只有 `/say Alice` 这种「说话人有了、台词还没写」的情况把光标落进正文，与 `#` 路径一致。§1-4「砍掉 `isInspectorFirstCommand`」因此只在命令行路径成立，菜单/侧栏路径不变 —— 那是另一个变更，有它自己的 UX 影响。
12. **同名资产无法寻址（新缺口）。** 命令行按 name 寻址，但资产名在项目内不唯一。`/bg forest` 遇到两张都叫 forest 的图时，`findByName` 返回 `ambiguous` → 落无效行，而不是静默挑一张（挑到的那张会随排序变化而改变，是最难查的一类 bug）。代价是这行在命令行里无法完成，作者只能改名或走 inspector。**这是已知缺口，不是决定** —— 候选补全把名字填回文本时同样歧义，真正的解法需要一个消歧写法（如 `#id` 后缀），留待 P1。
13. **persistent 变量还不能寻址。** `buildStoryCommandContext` 只收 scene-local 与 document-saved；persistent 变量住在 blueprint 文档里、按 `storageKey` 索引，需要一个本 builder 拿不到的数据源。`/set` 它们目前报 unknownVariable —— 缺口，非决定。

**尚未实现**：cursor context（光标位置 → 该出什么候选）与候选 provider registry —— 即 §4.2 的候选/高亮规则和 §3.3 的重构。它们是下一块，也是让 `/bg fo⇥` 能补全的那一块；目前作者必须把名字打全。

## 8. 风险

1. **grammar 表达力被 payload 的异构性击穿**。55 个 action 的 payload 形状差异极大（`storyActionCommands.ts:281-393` 那个 switch 就是证据）。P0 选 `set` 和 `show` 正是为了尽早撞上这堵墙 —— 如果 `applyArgs` 在这两条上就需要大量逃生舱，说明声明式 grammar 不成立，应退回"每命令手写 applyArgs"的朴素形态。
2. **候选 registry 重构的波及面**。`AssetSelector` 被 inspector 之外的地方复用，抽离时要保证既有调用方行为不变。这是纯重构，应当独立提交、独立验证。
3. **只读命令串会诱发反向编辑的需求**。用户看到命令串的第一反应大概率是"我能不能直接改这里"。这是 §3.4 决策的已知摩擦点，需要在 UI 上明确它是只读展示（而非禁用的输入框）。
