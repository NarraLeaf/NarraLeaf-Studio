---
title: "plan: Puppet 故事动作重新设计 —— 名字由模型给出，不由作者背下来"
type: plan
status: done
date: 2026-07-29
parent: 2026-07-27-003-task-engine-puppet-seam.md
repo: NarraLeaf-Studio (worktree D:/Temp/nls-puppetaction, 分支 feat/puppet-action-surface)
---

# plan: Puppet 故事动作重新设计

## 0. 命题

`/face` / `/motion` / `/skin` 三条动作在 2026-07-28 落地，**taxonomy 是对的、管道是通的、作者面是毛的**。

三个问题，第一个是本卡的由来：

1. **名字只存在于模型里，而编辑器一个都不给。**
   `storyCommandCandidates.ts` 的 `case "puppetName"` 是一句硬 `return []`，
   `hasCandidateSource` 对它返回 `false`，属性编辑器是两个裸 `TextField`。
   → 作者必须**凭记忆手打**动作名，打错了没有任何提示，一路静默到运行时的一条 `warn`。
   同一个工程里，角色编辑器**早就是下拉框**（`PuppetEditor` 的 `ChoiceField`）——
   两个面读的是同一份 `describe()`，只有故事面没接。
2. **`describe()` 唯一有形状的通道没有任何作者面**：`params`（`{id, min, max, default}`）
   能被枚举，却根本无法从剧情里设置。
3. **引擎的一次性逃生口 `command` 够不着**：「挥一下手然后继续」写不出来。

(1) 是用户的原话（"甚至要用户手填轨道名称"）。(2)(3) 是两个能力洞。

**本卡的设计主张一句话**：*puppet 动作的每一个槽位都由模型自己填*。
凡是模型说不出来的东西，本卡不给它假装成命令的界面——这条同时决定了 (2) 做、(3) 不做（见 §2.6）。

---

## 1. 勘验（已核对代码，几乎全是好消息）

| # | 发现 | 出处 |
|---|---|---|
| 1 | `PuppetDescriptionService.peek()` **是同步的，且注释里写明就是为这件事准备的**："a dropdown drawing its options during a keystroke"；配 `onDescriptionChanged` 订阅 | `PuppetDescriptionService.ts:186-199` |
| 2 | `describeCharacter(characterId)` 已存在——故事行说的是角色，不是 bundle+runtime | 同上 `:167` |
| 3 | `puppetChoiceOptions(available, current)` **已经解决"模型里没有当前值"**：前置而不丢弃，正是"重导出后动作没了"要让作者看见的情形 | `puppetDescriptionModel.ts:300` |
| 4 | `buildStoryCommandContext` 被设计成**纯函数**（注释明说，为了不依赖 services 可测）→ 词表必须像 `persistentVariables` 一样**作为入参**进来 | `storyCommandContext.ts:13-19` |
| 5 | `storyRowDiagnostics` 只有一个 code，门槛写得很清楚：「产生**静默错误的游戏**而不是构建错误的失误」。模型没有的动作名**正好是这一类** | `storyRowDiagnostics.ts:1-20` |
| 6 | `PuppetPreview` 的挂载键是模型身份、状态走 `apply` → **把 `state` 放宽就能直接在故事属性面复用**，不必再写一个 | `PuppetPreview.tsx:44-98` |
| 7 | `normalizePuppetDescription` 对 param 的 min/max 有兜底（0..1）→ 滑杆永远有区间，不会出现"拉不动的控件" | `puppetDescriptionModel.ts:243` |
| 8 | ⚠️ `param`/`slot`/`cmd` 的拒绝**被一条守卫测试钉住**；但它给 param 写的解封条件是"要 describe 的 min/max/default"——**那个条件已经落地了** | `specs/specs.test.ts:225-232` |
| 9 | ⚠️ `getQuickParams(block)` 是纯函数且与 Dev Mode 时间线共用 → 想给动作名做行内快改 token，得改一个共享签名 | `storyQuickParamsModel.ts:48` |
| 10 | 编译器只有三个通道的臂；`setParam`/`setSlot`/`command` 没有 | `storyCompiler.ts:2019-2050` |
| 11 | `getPoses()`/`getAxes()` 对 puppet 外观返回 `[]` → `/face` 的 `characterForm` 分支自然弃权，联合类型不用动 | `CharacterAppearance.ts:303,486` |

**结论**：服务层是完备的，缺的全部是"故事编辑器没去问"。本卡不新增任何服务能力。

---

## 2. 设计

### 2.1 一份词表，三个消费者

`StoryCommandContext` 长出：

```ts
/** 一个 puppet 角色的模型词表，键缺席 = 没问到答案（没装 runtime / 没实现 describe / 没模型）。 */
puppetByCharacterId: Readonly<Record<string, StoryPuppetVocabulary>>;
```

**键缺席与空列表的区别是本卡的枢轴**：缺席=不知道（不许报错、不许说"没有匹配"），
在场=模型说过话（这才有资格下诊断）。

在 `useStorySceneEditorController` 里用 `peek()` 逐角色取、同时踢一次 `describe()`、
订阅 `onDescriptionChanged` 触发重渲染；`buildStoryCommandContext` 收它作入参，**保持纯**。

为什么不塞进 `appearanceByCharacterId`：那张表的元素是 `{id, name, axisId}`，是**能被改名的工程引用**；
puppet 名字没有 id、不可改名。分开放是 `/face` 两个分支不会互相污染的原因。

### 2.2 补全（用户那句话的正解）

- `candidatesForType` 的 `puppetName` 臂：按 `type.channel` 返回宿主角色的那一列，前缀优先。
- **不追加"作者打的那个"作为候选**（这条推翻了初稿）。speaker 臂那么做是因为裸名字**本身就是合法结果**
  （临时说话人）；模型没列的动作名绝大多数是打错，把它列成一个选项等于把错别字打扮成选择。
  它**照样能提交**（空菜单时 Enter 仍是提交），错在哪由行上的 `unknownPuppetName` 标说——
  **补全永不变成闸门**：runtime 没装的机器上仍然写得出正确的名字。
- `hasCandidateSource(param)` 现在**看不见 context**，所以对 puppetName 只能一律 `false`（无菜单）
  或一律 `true`（"没有匹配"，而真相是"没人问过模型"）。两者都在撒谎 → **把签名放宽**，
  让这一臂据 context 诚实作答。

### 2.3 属性编辑器

三个通道字段换成"有列表就 `SelectField`、没列表才 `TextField`"——**逐字段判定，不是逐模型**
（十一个动画零个表情的骨骼，动画那栏照样该有列表）。空选项是引擎的 `null`（真状态，不是"没填"）。

配套（这才是"配得上其他 action"）：

- 一行**来源状态 + 重读按钮**（`已从模型读取` / `本机未安装该运行时` / …），
  与角色编辑器共用一张映射表，不各写一份。
- 一块**实时预览**：复用 `PuppetPreview`，显示"角色默认状态 + 这一行改的通道"。
  不做全场景累积状态——那要把 `buildDialogueAppearances` 那套推到 puppet 通道上，是另一张卡。
- 布局从裸 2 列网格改成 `Section`，与 `/show` 的外观区一致。

### 2.4 行诊断

新 code `unknownPuppetName`。**只在**（该角色词表在场）∧（该通道列表非空）∧（行里的名字不在其中）时亮。
第二个合取项是必须的：只描述皮肤的后端会返回 `motions: []`，那是"无可奉告"而不是"任何动作都非法"。

这正是 `missingAsset` 定下的门槛：构建通过、玩家什么也看不到。

### 2.5 `/param` —— 唯一有形状的自由通道

**推翻 2026-07-28 的拒绝，按它自己写下的条件推翻**（勘验 #8）。

- 行：`operation: "setParams"`，载荷 `params?: Record<string, number>`（加字段，无需 schema bump）。
- 命令：`/param <角色> <id> <值>`；`id` 由 `describe().params` 补全（候选带区间：`ParamAngleX  -30…30`），
  值是数字。**三个槽位都是 core**——这条也推翻了初稿的"裸 `/param Doll` 出空行"：
  `/motion Doll` 是合法行（清空通道），而参数**没有"清空"**（引擎读缺席的键为"保持模型自己的默认"），
  所以只给 id 不给值的行什么也没请求。多参手势归属性面。
- 编译：N 次链式 `puppet.setParam(id, value)`。引擎是合并语义，所以**一行三个参数 = 一次作者手势**。
  空 id / 非有限值在编译期丢弃，不当成对"某个模型没有的 id"的真请求转发出去。
- 属性面：每个参数两行——`id 下拉（去掉本行已用的） + 删除` / `min..max 滑杆 + 数字 + 区间文字`；
  「添加参数」取模型还没被本行用掉的第一个 id，初值用 describe 给的 `default`（即"什么都没动"的值）。
- **为什么一行多参**：动一次头是 ParamAngleX/Y/Z 三个一起动；一参一行会把一个手势拆成三行，
  而引擎的合并语义让多参行完全等价。

**`slots` 不做**：不可枚举、无区间、没有任何能验证它的后端。做成 key/value 表格就正是上一轮
拒掉的"自由文本框假装是命令"。载荷可后续加字段，什么都没被堵死。

### 2.6 `command` 本卡不做，及解封条件

引擎把"播一次就结束的动作"明确放在 `command`，而今天剧情根本写不出来——洞是真的。
但 `name` 和 `payload` 的形状**都属于后端**（文档自己的例子是 `command("playMotion", {id:"wave"})`），
Studio 无法枚举、无法校验、无法提示。给它开一行 = 两个自由文本框 + 一个 `await` 开关，
**恰好违反本卡的设计主张**（§0 末）。

不是"以后再说"，是有明确解封条件，二者任一：

1. 引擎的 `PuppetDescription` 长出 `commands: {name, payload?}[]`——那时它和 motion 同等待遇；
2. Studio 为作者自备的 runtime 定一个清单约定（`runtimes/puppet/<name>/studio.json` 声明命令表）。

两条都是跨仓/新契约，各自一张卡。**这条不是本卡的遗漏，是本卡的裁决。**

### 2.7 其余打磨

- 行投影：给 param 行写投影（`参数 Doll → ParamAngleX 12 +2`）。
- 动作创建面板：确认 `/motion` `/skin` `/param` 不会对没有 puppet 角色的工程显示为死命令。
- 动作名的**行内快改 token**：搁置，理由是勘验 #9（共享纯签名），单独记账。

---

## 3. 工作项

| WI | 内容 | 状态 |
|----|------|------|
| W1 | 词表进 `StoryCommandContext` + 补全 + `hasCandidateSource` 诚实化 | 完成 |
| W2 | 属性面：列表化三通道、来源状态行、实时预览 | 完成 |
| W3 | 行诊断 `unknownPuppetName`（含 `/param` 的 id） | 完成 |
| W4 | `/param` 全链路（spec / 载荷 / 编译器 / 属性面 / 投影 / 测试）+ 重写守卫测试 | 完成 |
| W5 | 创建面板噪声核查 | 完成（结论：不改，见下） |
| W6 | 测试、i18n 双语 parity、四工程 typecheck、NUL 字节自查 | 完成 |

## 4. 实机验收（orchestrator 亲眼，2026-07-29）

工程 `D:/Temp/nls-demo` 的副本（Hiyori/Haru/Mao 三个 live2d + Doll 一个 spine，两套 runtime 都装着），
worktree 实例 CDP 9391 / reload 5601。四条都看过截图：

1. **命令行补全**：`/motion Hiyori ` 弹出 `Idle_0 … Idle_8, TapBody_0` —— 模型自己的动作表。
2. **属性面**：动作是下拉框（`none / Idle_0 / Idle_1 …`）+ **活的 Live2D 预览** +
   「Filled from the model」+ 重读按钮。
3. **`/param`**：`/param Hiyori ` 列出 **74 个真 id 带区间**（`ParamAngleX / -30…30`、
   `ParamEyeLOpen / 0…1.2`、以及适配器自己的 `@timeScale / 0…4`）；提交为
   `Parameter Hiyori → ParamAngleX 24`，属性面出滑杆 + 数字 + 区间。
4. **行诊断**：`/motion Hiyori nosuchmotion` 提交成功（不拦），行上出现琥珀警告，
   tooltip「This character's model does not have that name.」，
   下拉框把这个名字留在选项首位而不是静默改写。

**只有跑真应用才暴露的一处**：参数行第一版是「id + 滑杆 + 数字 + 删除」挤在一行，
在 ~360px 的属性栏里 **id 下拉塌成一个箭头、数字框跑出面板、整个面板长出横向滚动条**
（`min-width:auto` 让 flex 子项拒绝收缩）。已改成两行 + 每个 flex 子项 `min-w-0`，复验无横向溢出。
参见 [[editor-group-overflow-trap]] 记的同族病。

## 5. 裁决与遗留

- **§2.6 的 `command` 不做**，解封条件已写在 §2.6 与 `specs.test.ts` 的守卫里。
- **`setSlot` 不做**，同上。
- **创建面板不改**：`/motion` `/skin` `/param` 对没有 puppet 角色的工程照样列出。
  侧栏是"spec 注册表的投影，不是第二份目录"，让它认工程状态是改一个共享机械。
  而且失败路径现在是**有解释的**：命令行报 `notPuppetCharacter`，属性面写
  「This character is drawn by Studio, so it has no runtime state to set.」。
- **行内快改 token（动作名）搁置**：`getQuickParams(block)` 是纯函数且与 Dev Mode 时间线共用，
  要带选项就得改共享签名，且 `QuickParamValue` 没有 "choice" 种类。
- **§2.3 的预览常挂**：按常挂实现，实测选择切换无卡顿。若日后要收，
  改成 `Disclosure` 折叠是一行改动。
