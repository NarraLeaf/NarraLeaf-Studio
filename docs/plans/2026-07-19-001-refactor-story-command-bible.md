---
title: "refactor: 故事指令风格圣经 + 三作用域变量架构统一"
type: refactor
status: draft
date: 2026-07-19
supersedes: 2026-07-16-001-feat-story-command-system.md（架构部分；其产品决策全部继承）
---

# refactor: 故事指令风格圣经 + 三作用域变量架构统一

## 0. 为什么是重构而不是补丁

指令系统经历了三次演进（菜单 → 斜杠菜单 → grammar 管线），每次都留下了上一代的
路径。今天并存的有：

- **两条提交路径**：44 条 grammar 指令走 `commitCommandFromInsert`，13 条无参 palette
  指令穿透到旧的 `chooseCommand`（inspector-first、initialText），行为完全不同。
- **两个 token 解析器**：`getCommandDef`（grammar）与遗留的 `resolveActionCommandToken`。
- **三份手写的分词逻辑**：parser / cursor / ghost 各自实现 `firstUnquotedEquals`、
  `stripQuotes`、"当前是第几个位置参数"，靠注释"mirrors the parser"维持同步。
- **字符串弱类型的 grammar↔apply 契约**：`applyCommandArgs` 用 `args.t`、`args.d` 等
  裸字符串读参数，改名即静默断连。7-16 方案的硬约束 5（"参数声明与 payload 字段漂移
  应当是编译期错误"）从未兑现，且已经真实咬过一次（`declarationFromArgs` 的文档记录）。
- **新增一条指令要摸 4–6 个文件**：id union、palette 条目、建块工厂、grammar def、
  apply case、i18n，彼此无类型关联。
- **通用层写死了具体指令**：auto-name 表、`textFont` 冲突检查、setVariable 类型检查
  都硬编码在"纯通用"的 resolution 里。

签名风格同样是三代叠加的产物：`t=` 在三处指三种东西（TransitionRef.kind / transform
preset / NVL），`name` 有四种含义，`mute on` 用 on/off 枚举而 `loop` 用 true/false，
`/imgsrc` 对象在前而 `/vol` 数值在前，`imgsrc` 前缀式命名而 `settext` 动词式命名。

变量侧：persistent 声明寄生在蓝图文档里（不同的 undo 栈、自由字符串类型、无全局蓝图
则 `/persis` 静默失败）、ref 以 storageKey 寻址（另两个作用域用 variableId）、完整编译
不播种 scene 默认值（预览与成品行为不一致）、persistent 引用编译期零校验、`===` 与
结构相等混用。

这些没有一个能靠局部补丁修好——它们是同一个病：**指令的身份被涂抹在多个无类型关联的
文件里，签名风格从未被立法**。本方案先立法（§1–§4），再换地基（§5–§6）。

## 1. 指令风格圣经（The Bible）

第一原则：**直观**。写作者是低代码用户；每条规则都以"不看文档能不能猜对"为判据。

### 1.1 语法形态

```
/动词 <目标> <内容> 修饰…        ── 一行一令
#说话人 台词                     ── 对话（非指令）
裸文本                           ── 旁白（非指令）
```

- **B1 槽位顺序恒定**：目标 → 内容 → 修饰。位置参数至多 2 个（目标、内容），
  其余一律具名 `k=v`、可乱序、可省略。
- **B2 贪婪文本永远在最后**（台词、文本内容、表达式），吃到行尾；贪婪指令的具名
  修饰必须写在贪婪值之前，这是唯一的顺序约束，ghost 提示要写明。
- **B3 泛型动词优先于类型前缀**：`/show` `/hide` `/swap` `/play` 按目标解析结果
  分派到对应 payload，不再有 `imgshow`/`txtshow`/`vidshow` 三族。写作者只记动词，
  不记"对象类型 × 动词"的积。
- **B4 可省略目标**：声音控制类（`/vol` `/stop` `/pause` `/resume` `/mute`
  `/unmute` `/rate`）目标缺省为 BGM。`/vol 0.5` 与 `/vol piano 0.5` 都合法，
  由类型区分（数值不是对象名）。
- **B5 布尔修饰支持裸旗标**：`loop` ≡ `loop=true`，`loop=off` 也接受；仅在贪婪区
  之前生效。规范存储值恒为 true/false。
- **B6 枚举**：规范值为小写单词（允许连字符），别名可输入；**补全插入规范值**，
  落库存规范值（终结"输入的是别名、存的是规范值"的三向漂移）。
- **B7 时长一律秒**（可小数），键 `d=`；存储仍为 ms（现状保持）。
- **B8 语法糖允许**，条件是读起来像自然语言且降解到规范块：`/inc` `/dec`
  `/toggle` `/reset` 全部降解为 setVariable 块（现状保持）。
- **B9 必填核心（required core）**：每条指令声明其核心槽位。核心齐全且零错误 →
  Enter 落成 action 行；否则 → **草稿行**（原文逐字保留，可点回继续编辑）；
  Escape 丢弃。Enter 永远有可见结果（§4）。
- **B10 复杂指令行内只建块**：`/fx` 等落块后自动打开 inspector
  （`inspectorAfterCommit`）。命令行承载高频子集，inspector 承载全量——继承
  7-16 方案的产品决策。
- **B11 token 不翻译**、`/` 与 `#` 仅在行首触发、提交后不可反向编辑为命令串
  ——三条产品决策全部继承。

### 1.2 修饰键词汇表（全局唯一含义）

| 键 | 别名 | 含义 | 值 |
|---|---|---|---|
| `t=` | `transition=` | 视觉过渡（统一词表 §1.3） | 枚举 |
| `d=` | `duration=` | 时长（秒） | number ≥ 0 |
| `at=` | | 位置 | left / center / right |
| `name=` | | **仅**新建对象的命名（create 类） | text |
| `fade=` | | 音频淡入淡出（秒） | number ≥ 0 |
| `vol=` | `volume=` | 音量 | number 0–1 |
| `loop` | | 循环（旗标） | boolean |
| `muted` | | 静音（旗标） | boolean |
| `hold=` | | 屏幕效果保持（秒） | number ≥ 0 |
| `color=` | | 颜色 | #hex |
| `opacity=` | | 不透明度 | number 0–1 |
| `z=` | `zindex=` | 层级 | integer |
| `type=` | `as=` | 变量类型 | bool / number / string / json |
| `desc=` | `note=` | 变量描述 | text |

引用既有对象一律是位置参数目标（B1），`name=` 从此只剩一个含义。

### 1.3 统一过渡词表

写作者只有一个词表；每条指令声明支持子集，不支持时报"t=zoom 不适用于 /bg，
可用：fade、slide、…"。**apply 层按指令方向感知地映射**到 payload 需要的 ref
（写作者不关心 fadeIn/fadeOut/dissolve 的区别——指令本身已经表达了方向）：

| 规范值 | `/bg` `/jump` | `/show`（角色/对象） | `/hide` |
|---|---|---|---|
| `fade` | dissolve | fadeIn | fadeOut |
| `slide` `slide-left` `slide-right` `slide-up` `slide-down` | slide | slideX preset | slideX preset |
| `circle` | maskCircle | circleReveal | circleClose |
| `wipe` | softWipe | wipe | wipe(reverse) |
| `iris` | softIris | — | — |
| `blur` | blurDissolve | — | — |
| `blinds` | blinds | — | — |
| `black` | throughColor | — | — |
| `darkness` | darkness | — | — |
| `zoom` | — | zoom | zoom |
| `none` | none | none | none |

## 2. 完整签名表（每一条指令）

记法：`<必填核心>`、`[可选]`、`…` = 贪婪到行尾。所有位置参数同时可具名寻址。

### 场景与流程

| 指令 | 别名 | 签名 | 产出 |
|---|---|---|---|
| `/bg` | background | `/bg <image\|color> [t=] [d=]` | setBackground |
| `/jump` | | `/jump <scene> [t=] [d=]` | jump |
| `/wait` | | `/wait [seconds\|click]`（缺省 = click） | wait |
| `/nvl` | | `/nvl [t=fade\|none] [d=]` | nvl |

### 角色与显示对象（泛型动词）

| 指令 | 别名 | 签名 | 产出 |
|---|---|---|---|
| `/show` | enter | `/show <角色\|对象> [form] [at=] [t=] [d=]` | character enter / image・text・video・layer show |
| `/hide` | exit | `/hide <角色\|对象> [t=] [d=]` | character exit / * hide |
| `/move` | | `/move <角色> at=<pos> [d=]` | character move |
| `/face` | expr, expression | `/face <角色> <form>` | character expression |
| `/say` | | `/say <说话人> [台词…]`（无台词 → 落块进入正文编辑） | dialogue |

`/show` 目标解析顺序：角色 → 舞台对象；同名冲突报 `ambiguousName`（携带改名建议）。
第二位置参数 `form` 仅当目标解析为角色时存在（依赖参数，机制已有）。

### 媒体对象

| 指令 | 别名 | 签名 | 产出 |
|---|---|---|---|
| `/image` | img | `/image <asset> [name=] [at=] [t=] [d=]` | image create（name 自动派生自文件名） |
| `/text` | txt | `/text <内容…> [name=] [at=]` | text create |
| `/video` | vid | `/video <asset> [name=] [muted]` | video create |
| `/layer` | | `/layer <name> [z=]` | layer create |
| `/swap` | src, setimg, settext | `/swap <对象> <新内容…>`（image/video → asset；text → 文本） | image setSource / video src / text setText |
| `/play` | | `/play <video 对象>` | video play |
| `/font` | | `/font <text 对象> [size] [color=]`（至少其一；允许同时） | text 字体（payload 扩展为组合 op） |

### 声音（可省略目标，缺省 BGM）

| 指令 | 别名 | 签名 | 产出 |
|---|---|---|---|
| `/bgm` | | `/bgm <audio> [fade=] [loop]` | setBgm |
| `/sound` | se | `/sound <audio> [vol=] [loop]` | playSound |
| `/vol` | volume | `/vol [对象] <0–1> [fade=]` | setVolume |
| `/rate` | | `/rate [对象] <rate>` | setRate |
| `/stop` | | `/stop [对象] [fade=]` | stopSound |
| `/pause` | | `/pause [对象]` | pauseSound |
| `/resume` | | `/resume [对象]` | resumeSound |
| `/mute` | | `/mute [对象]` | mute |
| `/unmute` | | `/unmute [对象]` | unmute |

### 变量与逻辑

| 指令 | 别名 | 签名 | 产出 |
|---|---|---|---|
| `/set` | | `/set <变量> <表达式…>`（支持 `+=` `-=` `*=` `/=`） | setVariable |
| `/inc` | add | `/inc <变量> [量…]`（缺省 1） | setVariable 糖 |
| `/dec` | sub | `/dec <变量> [量…]` | setVariable 糖 |
| `/toggle` | flip | `/toggle <变量>` | setVariable 糖 |
| `/reset` | | `/reset <变量>` | setVariable 糖 |
| `/local` | scenevar | `/local <名> [默认值] [type=] [desc=]` | 场景变量声明（无块） |
| `/var` | savedvar | `/var <名> [默认值] [type=] [desc=]` | 存档变量声明（无块） |
| `/persis` | persistent, global | `/persis <名> [默认值] [type=] [desc=]` | 全局变量声明（无块） |
| `/if` | | `/if <布尔表达式…>` | condition 容器 + if 分支 |
| `/menu` | choice | `/menu [提示…]` | choice 容器 |
| `/repeat` | loop | `/repeat <次数>` | repeat 容器 |
| `/parallel` | | `/parallel` | parallel 容器 |
| `/race` | | `/race` | race 容器 |
| `/sequence` | seq | `/sequence` | sequence 容器 |
| `/code` | script | `/code [language]` | code 块 |

### 效果与其他

| 指令 | 别名 | 签名 | 产出 |
|---|---|---|---|
| `/blink` | | `/blink [d=] [hold=] [color=]` | screenEffect blink |
| `/vignette` | vig | `/vignette [d=] [hold=] [color=] [opacity=]` | screenEffect vignette |
| `/fx` | effect | `/fx <对象>` → 落块即开 inspector | displayable effect（inspectorAfterCommit） |
| `/note` | `//` | `/note [文本…]` | note |

**被移除的 token**（全部变为上表的别名或被泛型动词覆盖）：`imgsrc` `imgshow`
`imghide` `settext` `txtshow` `txthide` `vidshow` `vidhide` `vidplay` `pausesound`
`waitclick` `displayabletransform` `displayableshow` `displayablehide`
`displayableeffect` `layerzindex` `narration` `condition`。palette 穿透路径整体删除
——**每条指令都有 grammar（哪怕无参），只走一条提交路径**。

## 3. 变量架构：Persistent / Var / Local

| 面向写作者 | 内部 scope | 声明位置 | 运行时落点 | 生命周期 |
|---|---|---|---|---|
| **Local** 场景变量 | `scene` | `StoryScene.sceneVariables` | NLR `Scene.local` | 每次进入场景重置为默认值 |
| **Var** 存档变量 | `saved` | `StoryDocument.savedVariables` | NLR `Persistent`（存档内） | 跟随存档 |
| **Persistent** 全局变量 | `persistent` | **项目级注册表（新）** | 宿主持久化桥 | 跟随应用，蓝图可读 |

### 3.1 Persistent 迁出蓝图文档（核心变更）

新建项目级变量注册表（项目数据文件 + `VariableRegistryService`），持有全部
persistent 声明，形状与故事变量对齐：`{ id, name, valueType(4 值闭集), defaultValue,
storageKey, desc? }`。

**已确认（2026-07-19）：无需考虑任何现状兼容。** 干净切换：

- `BlueprintDocument.persistentVariables` 字段删除；蓝图 Get/Set Persistent 节点、
  成员树、故事编辑器全部改读注册表——同一份数据，故事内标记 flag，其他界面
  （蓝图）直接理解。
- `/persis` 不再依赖"全局蓝图 owner 存在"，永不静默失败。
- `valueType` 收敛为 4 值闭集。不写蓝图文档迁移，不留双读路径。

### 3.2 Ref 对称化（schema v6）

`StoryVariableRef` 三臂统一为 `{ scope, variableId }`；v5→v6 迁移把 persistent 臂的
`storageKey` 换为注册表分配的 `variableId`（迁移时按 storageKey 建立注册表条目，
id 取 storageKey 保证稳定）。`storyVariableRefKey` 化简为 `scope:variableId`。

### 3.3 编译器统一（三作用域同构行为）

1. **完整编译播种 Local 默认值**：场景头部注入播种动作（`Scene.local.init` 每次
   进入都重置命名空间，故播种必须在场景入口执行）——预览与成品从此一致。
2. **Persistent 读取回落声明默认值**：编译器内嵌 defaults map；条件、插值、表达式
   读取统一走"快照 → 缺失回落默认值"。
3. **Persistent 引用编译期校验**：对照注册表，缺失产出与 scene/saved 同款诊断。
4. **相等语义统一**：persistent 条件的 `===` 改为与表达式求值器一致的结构相等。
5. **场景名冲突检测**：`local:` 命名空间按场景 runtimeName 键控，编译期对重名场景
  产出诊断。

### 3.4 作用域解析（现状保持，立法确认）

裸标识符按 Local → Var → Persistent 就近解析；限定前缀规范形
`local.` `var.` `persis.`（`scene.` `saved.` `global.` 等作为别名保留）。同名跨作用域
遮蔽合法，但补全候选在遮蔽发生时标注被遮蔽方。

### 3.4b 声明即行（2026-07-19 追加，需求方指定；schema v6）

变量声明是**显式的行**：`declaration` 块即变量本身——行内显示编辑器文本
（`gold: number = 100` + 作用域徽标），Enter/双击打开类型与初始值编辑器，**删除该行即
删除该变量**。持久化的注册表字段（`sceneVariables`/`savedVariables`）删除，变量表由
扫描声明行派生（`declarations.ts`）；块 id 即 variableId，v5→v6 迁移为每个注册表条目
在其所属场景（saved 落入口场景）顶部合成一行，旧引用零迁移。蓝图声明的 persistent
是唯一不以行呈现的类别。由此声明天然进入场景快照 undo，"删不掉旧变量"一类的孤儿
条目不再可能存在。

单引号为**实体引用**语法：双引号包裹字符串字面量，单引号引用带空格等复杂名字的实体
（`/set 'Complex Var Name' 5`、`/jump 'Scene Name'`），表达式内同样支持；候选补全对
需要引用的名字自动以单引号包裹。

### 3.5 声明的 undo 与反馈

- 声明成功：**输入槽立即清空**并保持插入状态，ghost 区短暂显示
  `✓ var gold: number = 0`（随下一次输入消隐，不弹 toast——不张扬）；变量面板即时刷新。
- 声明进入故事编辑器 undo：history 条目扩展为可携带变量注册表操作（含逆操作），
  场景快照不再为声明单独记录（终结"undo 一步无事发生"）。
- 删除声明时扫描故事文档引用并告警（变量面板）。

## 4. 交互契约（提交语义）

继承四条既有规则（Escape 阶梯、highlight 是 Enter 的指针、Enter 行间 Tab 行内、
解析失败落草稿行），修订与新增：

1. **Enter 永远有可见结果**：
   - 核心齐全 + 零错误 → 落成 action 行（声明 → 清槽 + 确认反馈）。
   - 其余一切 → **草稿行**（原文逐字保留）。不再存在"Enter 无反应"的状态。
2. **草稿行**是 `kind:"invalid"` 的重新定位：视觉从 error 红降为 draft 琥珀
   （构建控制台仍作为错误拒绝）；行内显示原文 + 悬停/尾注显示原因与修复提示。
3. **草稿行重开必须有完整补全**：`chooser`/`chooserDismissed` 存储态删除，
   菜单开合完全由 (text, caret) 派生；Escape 的"关闭候选"降为一次性
   （下一次输入即恢复），不再终身压制。
4. **提交后的 action 行显示概览投影**（§5.3），点击/Enter 进 inspector，永不回到
   命令串。文本承载行的正文编辑不变。
5. 失焦规则不变：`/`・`#` 行失焦保持槽存活，纯文本失焦落旁白。

## 5. 架构落地

### 5.1 单一来源指令规格（one file per command）

```ts
// commands/registry 下每指令一个文件，聚合为类型化 registry
const bg = defineStoryCommand({
    id: "background",
    token: "bg",
    aliases: ["background"],
    params: {
        image: { pos: 1, type: [asset("image"), color()], core: true },
        t:     { alias: ["transition"], type: transitionEnum("bg") },
        d:     { alias: ["duration"], type: seconds() },
    },
    createBlock: (uuid) => ...,                    // 建块工厂（原 createBlockForCommand case）
    apply: (block, args) => ...,                   // args: ResolvedArgsOf<typeof params> ← 编译期绑定
    overview: (payload, ctx) => [...],             // 行内概览投影（§5.3）
    // inspectorAfterCommit?, scaffold?, declaration?
});
```

- `ResolvedArgsOf<P>` 由参数声明经映射类型生成——**改参数名而不改 apply 是编译错误**。
  7-16 硬约束 5 至此兑现。
- 指令的 id、token、grammar、建块、apply、概览、i18n 键全部收拢至一处；新增指令 =
  新增一个文件 + i18n 词条。
- parser / cursor / ghost / candidates / resolution 保持纯函数通用层，全部由规格驱动；
  auto-name、冲突检查等指令特例迁入各自规格的钩子（`validate?(args)`）。
- 声明类指令以 `declaration: { scope }` 声明，通用提交层据此分流——三处同步的
  特判表删除。
- 插件注册扩展可选 `params?`（同一 schema），无参插件指令自动获得平凡 grammar，
  与内置指令走同一条提交路径。

### 5.2 单一分词器

parser 产出带 span 的 token 流；cursor / ghost / reason 消费同一份解析结果，
不再各自重刨。每击键一次 parse+resolve，结果沿 InsertRow 下发（终结三重解析）。

### 5.3 概览投影

规格的 `overview()` 返回结构化片段 `[动词徽标] [目标名] [关键修饰]`，统一渲染
（muted 单行、图标 + 文本，与现有行视觉一致）；`describeBlock` 通用串仅作缺省回落。
背景/变换等既有的富预览渲染器保留为规格级覆盖。

## 6. 里程碑

- **M1 架构换底**：规格 registry + 类型化 args + 单一分词器 + 删除 palette 穿透与
  遗留 token 解析器 + 插件 params 预留。行为等价迁移（现有 44 指令原签名先原样搬入），
  测试全绿为闸门。
- **M2 签名立法**：按 §2 重写全部签名——泛型动词、统一过渡词表、可省略目标、
  裸旗标、枚举规范化。i18n 词条同步。
- **M3 交互修订**：B9 提交分级 + 草稿行重定位 + 重开补全修复 + 声明反馈/undo +
  派生态清理（删除 chooser 存储位）。
- **M4 变量统一**：项目级注册表 + v6 迁移 + 编译器五项修复（§3.3）+ 蓝图侧改读
  注册表。
- **M5 概览投影**：全指令 overview 实现 + 草稿行视觉。

依赖：M2/M3/M5 依赖 M1；M4 独立可并行。每个里程碑单独可合入、可验证。

## 7. 已决与待决

**继承的既有决策**（不再讨论）：不做反向编辑；`/` 仅行首触发；token 不翻译；
命令行只承载高频参数子集；解析失败不落半残块。

**本方案的关键抉择**（已全部确认，2026-07-19）：
1. 泛型动词（B3）——**采纳**。
2. 必填核心 + 草稿行（B9）——需求方在阶段目标中直接给定。
3. Persistent 迁项目级注册表（§3.1）——**采纳**，且无需考虑现状兼容（干净切换，
   蓝图同源消费）。

**实施修订**：M1 与 M2 合并执行——既然签名全部重写，先按旧签名搬一遍再改一遍是
双倍工作；新 registry 直接以圣经签名落地，纯函数层测试同步重写为新签名的规格测试。

## 8. 实施状态（2026-07-19）

**M1+M2 已落地**：
- `commands/spec.ts`（规格类型 + `ResolvedArgsOf` 编译期绑定）、`commands/transitions.ts`
  （统一过渡词表 + 方向感知映射）、`commands/payloadHelpers.ts`、`commands/registry.ts`、
  `commands/specs/`（8 个族文件，45 条规格）、`commands/specPalette.ts`（斜杠菜单投影）。
- grammar 收缩为纯类型层；新参数类型 `target`（泛型动词分派）与 `content`（随目标定型）；
  `core` / `skippable` 标志；死类型 `displayable` / `stageObject` 删除。
- parser：裸旗标（B5，含 on/off/yes/no 拼写）、可省略前导目标（B4）、`canCommit` 核心
  门控（B9）+ `missingCoreParams`。
- resolution：`target`/`content` 解析、bgm 保留名、规格钩子（`validate`/`deriveArgs`）
  取代通用层里的指令特判；`storyCommandApply.ts` 整体删除（并入各规格 `build`）。
- 提交路径统一：palette 穿透与 `resolveActionCommandToken` 删除；声明成功即清槽
  （`/var name` Enter 无反应的整类 bug 消除）；声明不再记录场景快照 undo。
- 编译器：`setBgm` 把 BGM 句柄注册进 `ctx.sounds["bgm"]`，声音控制族缺省目标可寻址。
- i18n：`story.command.*`（45 条 en/zh）、`paramHint.target`、三个新 reason 码。
- 测试：规格端到端套件（parse→resolve→build，28 例）+ 纯层测试重写，全绿；tsc 零错误。

**M3 已落地**（同日）：
- 草稿行重定位：琥珀色 + 原因行（`DraftRowPreview` / `getCommandLineDraftReason`，含
  "缺少核心槽位"），构建控制台仍作为错误拒绝。
- 重开草稿行补全修复：`chooserDismissed` 改为一次性——Escape 只在文本不变期间压制菜单，
  下一次实际输入即恢复（对齐 `startLineEdit` 一直声称却未实现的语义）。
- 声明提交清槽（Enter 永远有可见结果）+ 不再录制无效场景快照 undo。

**声明即行 + 实体引用已落地**（同日，schema v6）：
- `declaration` 块 + 注册表字段删除 + 扫描派生表（`declarations.ts`）+ v5→v6 迁移合成行
  （块 id 接管 variableId，引用零迁移）；StoryService 变量 CRUD 改为块操作（面板照旧可用，
  一切声明可删）；声明指令经统一提交路径落行；声明行有徽标 + `名: 类型 = 默认值` 概览、
  inspector 卡（名/类型/默认/描述）；`/set` 等行内概览显示真实变量名（修复
  "saved variable += 5"）。编译器跳过声明行、完整编译播种 Local 默认值（预览与成品一致）、
  persistent 读取回落故事声明的默认值——三个原 M4 项顺带落地。
- 单引号实体引用：命令分词器与表达式语言均支持 `'Complex Var Name'`；补全对带空格名字
  自动单引号包裹；`/set 'boss hp' += 2` 正确脱糖；`/say` 台词中的撇号不再误判为引号。

**M3 余项（小）**：声明成功的槽内瞬时确认（现为落行本身即反馈，已基本闭环）。
**遗留至 M4/M5**：见 §3 / §5.3；另有 `/font` 双属性合并 op（schema v6）、cursor 层对
skippable 的精确建模（当前仅旗标感知）、真机（Electron 实例）走查未做——下一会话首项。
