# 故事剧本文本格式（Story Script）：导出、解析与合并

分支 `feat/story-script-io`，从 `origin/develop` 切出，完成后合并回 develop。
本文只覆盖 codec 那一半：`src/renderer/lib/story/script/storyScriptCodec.ts`
（实现）与 `storyScriptTypes.ts`（契约）。宿主那一半（导出/导入入口、确认对话框、i18n）
由并行的另一条会话完成，落在 `src/renderer/apps/workspace/modules/story/script/`。

## 0. 需求原文

> 写作者要能把一场戏从 Studio 里拿出来，在任何设备的任何文本编辑器里改，再原样带回来。
> 「原样带回来」不是靠语法覆盖所有动作挣来的——是靠文件自己携带这一场的 JSON（`#data`），
> 而文本层只允许编辑作者真正会编辑的东西：旁白、对话、选项文本和备注。**其余每一种行都投影成
> 一条只读的 `»` 标签，负载从快照里原样取回。**

值得说第二遍的推论：**`»` 标签永远不被解析**。它是装饰。作者可以把它改烂、翻译掉、删掉一半，
只要该行的锚点还在，动作就原样回来。这让「无损」成为构造性质，而不是导出器和一个每周都在长的
payload 联合体之间的赛跑。

## 1. 文件格式

```
#nlscript 1
#story <storyId>

#scene <sceneId> <场景名>
#origin <导出时场景规范化 JSON 的摘要>

Alice: 早上好，你有 ‹2› 金币。      ⟦3⟧
这是一句旁白。                      ⟦4⟧
// 给译者的备注                     ⟦5⟧
  » 背景 → forest_day（淡入 0.5s）  ⟦6⟧
  - 跟他打招呼                      ⟦7⟧

#datahash <"#data" 行之后全部字节的摘要>
#data
{ "scenes": { "<sceneId>": <StoryScene 原样> } }
```

- 缩进每层 2 空格，导入时**从缩进重建树**。
- 行形状：旁白 = 裸文本；对话 = `Speaker: text`；备注 = `// text`；选项 = `- text`；
  **其余一切 block kind** = `» <标签>`。
- `⟦n⟧` 锚点按阅读顺序编号，一行一个，行尾以**恰好一个空格**分隔。
- `‹i›` = 该行 runs 里下标 i 的原子 run（pause / interpolation / event）；
  `‹i›text‹/i›` = 带 marks 的文本 run。

### 1.1 三条本轮定下的取舍

1. **锚点按场景重新从 1 开始**（`storyScriptCodec.ts:476`）。一段 `#scene` 因此和「这次导了几场」
   无关：单独导出 A 和 A+B 一起导出，A 那一段是同样的字节。锚点 n → 快照阅读顺序的第 n 行，
   这个映射**不写进文件**——文件已经带着它自己那份场景了。
2. **`choice` 自己是 `»`**（`storyScriptCodec.ts:404`）。它的 prompt 是行的*配置*，交给文本层
   就等于同一件事有两个表示，早晚会漂。可编辑的只有它的选项子行。
3. **四种散文形状之间不互转**（`lineContent`，`storyScriptCodec.ts:889`）。在一条旁白行上写
   `Alice: 你好`，结果是「旁白的文字变成了 `Alice: 你好`」，不是「这行变成了对话」。后者要从一个
   标签里凭空造出说话人绑定，而作者可能只是打错了字——且没有回头路。保形状不丢任何字符。

## 2. 转义：必须是全域的

导出时转义、导入时反转义，规则是「`\` 后面永远恰好跟一个字符」，读端把它不认识的 `\X` 一律还原成
X（只有 `\n` `\r` `\t` 特殊）。所以不存在任何字符序列能在往返中变成别的东西。

需要转义的不止需求里点名的四个符号（`storyScriptCodec.ts:166`）：

| 字符 | 为什么 |
|---|---|
| `⟦ ⟧ ‹ ›` | 会被读成锚点 / run 标记 |
| `\` | 转义字符本身 |
| `\n` `\r` `\t` | 一行一个 block，换行会把一行劈成两行 |
| `: `（冒号+空格） | 对话分隔符——否则旁白 `他说: 你好` 回来会变成「他说」说的话 |
| 行首 `#` `/` `-` `»` | 会被读成指令或行前缀 |
| **首尾空格** | 缩进按空格数；锚点前恰好一个空格 |

⚠ **踩过的坑**：首尾空格转义**不能写成两条链式 `replace`**。前导空格被换成 `\ \ \ `，这个结果
*以空格结尾*，第二条规则会去转义那个转义符，`"   "` 变成 `"  \ "`——真的把作者的文字改坏了。
必须在**同一次**测量后一次性拼出来（`escapeBoundarySpaces`，`storyScriptCodec.ts:207`）。这条是
200 个随机种子跑出来的，人手写的用例不会想到「三个空格的备注」。

## 3. 摘要（`#origin` / `#datahash`）

FNV-1a 64 位、UTF-8、16 位小写十六进制，就地实现（`storyScriptCodec.ts:104`）：

- **是防意外损坏和文件漂移的完整性校验，明确不是安全边界。** 它挡的是被截断的下载、写了一半的
  保存、被编辑器改烂的尾巴；挡不住任何有意为之的人——FNV 不是密码学哈希，谁都能一行代码重算。
  这里的威胁是**失误**，不是攻击者。
- 不加依赖、不用 `crypto.subtle`：后者是异步的，会让 `exportStoryScript` 变异步，进而让它的每个
  调用方都变异步，去防一个不存在的东西。
- 算术走四个 16 位肢体而不是 `BigInt`：每个部分积都 < 2^31，在 double 里精确，而一个大故事的
  footer 是几十万次迭代。
- **摘要在归一化换行 + 去掉首尾空白之后才算**（`digestOfText`，`storyScriptCodec.ts:134`）。这份
  文件的全部意义就是去别人的机器上过一圈，而大量编辑器保存时会把 LF 改成 CRLF、或补一个末尾换行。
  这些改的是外框不是内容，一个会因此报警的校验会在几乎每次真实导入时报警。

`#data` 与 `#origin` 都走 `encodeCanonicalJson(JSON.parse(JSON.stringify(scene)))`：
规范化编码器遇到 `undefined` 属性会抛（`canonicalJson.ts:163`），而故事 payload 真的带
（`commands/specs/scene.ts` 里的 `payload.color = undefined`），先过一次 JSON 就是把它们丢掉——
反正写进文件的快照本来也是这么写的。

## 4. 合并规则（= 验收标准，每条一个测试）

| 情形 | 行为 | 测试 |
|---|---|---|
| 锚点命中、文字没动 | 从快照**原样**取块 | `takes an untouched row verbatim` |
| 锚点命中、文字改了 | 同一个块、同一个 `id`、**同一个 `textId`**，只更新 `value` + `rich` | `keeps the block id AND the textId` |
| 快照是 `»`、文件里写成了散文 | 保快照，**丢编辑**，`shapeMismatch` error | `keeps the action and drops the edit` |
| 同一锚点出现两次 | 第一条保身份，其余是克隆：新 `id` **且**新 `textId`，`duplicateAnchor` warning | `gives every copy after the first…` |
| 锚点不在 `#data` 里 | `unknownAnchor` error，行丢弃 | `drops a line whose anchor names nothing` |
| 无锚点、可编辑形状 | 新块，全新 UUID v4 | `creates a row with fresh UUID v4 ids` |
| 无锚点、`»` 形状 | `opaqueWithoutAnchor` error，**不建块** | `creates nothing for an unanchored »` |
| 快照里有、文本里没有 | 删除，计入 `removed` | `removes a row whose line is gone` |
| 缩进/顺序变了 | 重建树，计入 `moved` | `rebuilds the tree from the indentation` |
| `#datahash` 对不上 | `{ok:false, code:"dataCorrupt"}` | `refuses a snapshot that does not match` |
| 活场景摘要 ≠ `#origin` | `stale: true`（不是错误，UI 提示） | `flags a scene the author changed` |
| 缺 `#nlscript` 头 | `{ok:false, code:"notAScript"}` | `refuses a file with no #nlscript header` |

**`textId` 是全文件风险最高的一条**：它同时是本地化单元 id 和引擎的 `voiceId`
（`lint/rules/text/textSegments.ts:42`），换一个新的 = 悄悄解绑这一行的译文和它的配音。所以
「编辑」这条路径全程走 `getSegmentSlot(block).withSegment`（`storyFindReplace.ts:152`），只覆盖
`value`/`rich` 两个字段。

### 4.1 统计口径

一行只落一个桶，优先级：`added`/`cloned` → `edited` → `moved` → `unchanged`
（`countPositions`，`storyScriptCodec.ts:1088`）。既改文字又换了缩进的行读作「编辑」——确认对话框
问的是那个。计数**全部在放置之后统一推导**，不在合并途中累加：一个能被减回去的计数器早晚会漂
（第一版就是这么写错的：`unplaceableLine` 要 `stats.added -= 1`）。

### 4.2 结构必须构造性正确

`replaceScene`（`StoryService.ts:1084`）**不校验也不归一化**，它存什么就是什么。所以
`assembleScene` 返回前跑 `assertStoryScriptSceneValid`（导出，供测试直述不变量）：
`blocks[id].id === id`、`childrenIds` 每一项都存在、`parentId` 与父的 `childrenIds` 一致、
`rootBlockIds` 恰好覆盖深度 0、**`jump` 没有子节点**（`storyModel.ts:927`）。

树重建有两道夹子：一行不能比上一行深超过一层；父节点必须 `canAcceptChildren`
（复用 `storyModel.ts:1001`，不重写），否则向上走。作者在一条 `» 跳转` 下面缩进的行，会变成它的
兄弟而不是它的子节点——这就是「jump 没有子节点」由构造保证的地方。

### 4.3 说话人

codec 不持有任何项目查询，两个方向都是回调：

- 导出：`StoryScriptExportOptions.speaker(scene, blockId)`，**必填**。可选并回退成 `""` 的话，
  一个绑定了角色的行会导出成 `: 早上好`，再导入时被读成*说话人被改了*，静默解绑角色。这必须是
  编译错误，不是运行时惊喜。
- 导入：`StoryScriptPlanInput.resolveSpeaker(label)`，可选。比较的是**解析结果**而不是标签：
  标签仍然解析到该行已有的绑定 = 没改。这让「作者改说话人了吗」在 codec 不知道任何角色名字的
  前提下可答。
- 回调缺席时：只报**看得见**的改动（裸 `speakerName` 的行）→ `speakerUnresolved` warning 并忽略。
  绑定了 `characterId` 的行导出的是显示名，没有角色表时它不只是「无法解析」，而是**无法察觉**；
  给每一行都挂一条诊断说的是「未校验」而不是「改了」。

## 5. 无损性证明

`storyScriptRoundTrip.test.ts`：自带的 LCG 种子生成器（不引依赖，不用 `Math.random`——失败必须
可复现；本仓没有 `fast-check` 也不许加）造随机场景，覆盖每一种 `StoryBlockKind`、嵌套、
`disabled` 行、每一种 rich run 变体（带/不带每种 mark 的 text、`pause`、三种 `interpolation`、
`event`），文本取自一份专门的语料：四个保留符号、CJK、emoji、行内换行、首尾空白、空串、以及
`// ` `- ` `» ` `#` `: ` 这些会被误读成结构的前缀。

**200 个种子**上断言 `plan(parse(export(doc))).scene` deepEqual `doc.scenes[id]`，并且
`stats` 必须是「全部 unchanged」——后者是防自证：如果「没变」的判定本身坏成恒真，计数会露馅。

另外两条：
- **标签乱改测试**：把导出文件里每一条 `»` 标签整条换成别的文字（40 个种子、>40 条标签），
  导入结果仍然 deepEqual 原场景。这是第 0 节那条不变量的可执行版本。
- **编辑穿透测试**：给每一条散文行末尾追加一段文字，断言 `id` 与 `textId` 不变、`value` 与
  `rich` 恰好等于「原 runs + 追加」归一化后的结果。round trip 走的是「没变 → 原样取回」那条路，
  这条测试走的是重建那条路。

`review` 模式另有一条字节稳定性测试（同一文档导两次字节相同、无锚点、无 `#data`，且解析它必然
得到 `dataMissing`——没有快照就没法还原动作，猜一个比拒绝更糟）。

## 6. 已知取舍与未做的事

1. 快照里**从 `rootBlockIds` 走不到的块**（只有损坏的文档才有）不会拿到锚点，导入后消失。这是
   修复不是丢失，但它是静默的。
2. 空白行是版式，不建行。所以「在文本里新加一条空旁白」做不到（有锚点的空行不受影响：它带着
   `⟦n⟧`，不是空白行）。
3. 作者手打的、恰好以 `⟦数字⟧` 结尾的一行会被读成锚点。转义只能保护导出端写出去的字。
4. `»` 标签里的换行会被压成空格、`⟦⟧` 被剥掉（`sanitizeLabel`）——标签不被解析，这只是防它冒充
   锚点或把一行劈成两行。
5. 新增的诊断码 `speakerUnresolved` 需要 `story.script.diag.speakerUnresolved` 文案；宿主那一半
   已经补上了 en/zh 两份。

## 7. 落点

| 文件 | 内容 |
|---|---|
| `src/renderer/lib/story/script/storyScriptCodec.ts` | 实现（导出 / 解析 / 计划，摘要与场景校验一并导出供测试） |
| `src/renderer/lib/story/script/storyScriptTypes.ts` | 契约。本轮**只增不改**：`speaker` / `resolveSpeaker` 两个回调、`speakerUnresolved` 诊断码 |
| `src/renderer/lib/story/script/storyScriptCodec.test.ts` | 合并规则、解析失败、说话人、摘要向量、结构校验（29 条） |
| `src/renderer/lib/story/script/storyScriptRoundTrip.test.ts` | 种子生成器 + 200 种子往返、标签乱改、编辑穿透（3 条） |

复用而非重写：`richText.ts` 的 `richRunsToPlain` / `plainToRichRuns` / `segmentToRuns` /
`normalizeRuns` / `richIfMeaningful`（最后一个是「纯文本行不带 `rich`」的唯一守门人，往返靠它）、
`storyFindReplace.ts:152` 的 `getSegmentSlot`、`storyModel.ts:1001` 的 `canAcceptChildren`、
`canonicalJson.ts:45` 的 `encodeCanonicalJson`。
