# plan: 语义 diff 与冲突解决

本卡是 [2026-07-27-001](2026-07-27-001-plan-editor-data-and-version-control.md) 的 **V3（历史与语义
diff）**，加上 **V5 的后半（冲突解决）**。远端卡
[2026-07-31-003](2026-07-31-003-plan-vcs-remote-server.md) §5 明写把这两件事交给这里——它自己遇到
`fileConflict > 0` 就列出文件、停下、说清楚解决界面还没有。本卡负责让那句话不再需要说。

一句话形态：**diff 与 resolve 是同一个列表的两种模式。**

一份文档的变更是 `DocumentChange[]`；一次冲突的解决是**同一个列表**，每行多一个「取哪边」。不是两套
数据模型，不是两个界面，更不是「为 15 种文档各写一个并排 diff 视图」——那条路
[2026-07-28-002](2026-07-28-002-plan-vcs-ui-frozen-workspace.md) 开篇就否掉了，理由是历史版本已经
**用真编辑器渲染**，作者要看「当时长什么样」时看的是当时的场景编辑器，不是一个 diff 视图。

动手前按顺序读：[docs/version-control.md](../version-control.md)（唯一技术事实源，§4 的 22 条坑全部
仍然成立，§6 是离线 diff 的策略）、[2026-07-27-001](2026-07-27-001-plan-editor-data-and-version-control.md)
§4.3 与 §4.5、[2026-07-28-002](2026-07-28-002-plan-vcs-ui-frozen-workspace.md)（§1 的裁决、§4.5 的四个
接缝）、[2026-07-31-003](2026-07-31-003-plan-vcs-remote-server.md) §1 的实测与 §2 的六条边界。

---

## 0. 结论先行

| 问题 | 结论 |
|---|---|
| 三路合并的输入齐了吗 | **齐了，不要重做**。`threeWay` / `mergeBase` / `changedPaths` / `documentsAt` / `listFilesAt` 全部已实现并对真库跑过（`revisionReader.ts`） |
| 语义 diff 挂在哪 | `DocumentSpec.diff`——**这个成员今天不存在**。`types.ts` 的接口里只有 `parse` / `serialize` / `summarize` / `matches` / `pathFor`。本卡加它 |
| 15 种文档现在有几种能语义 diff | **0 种。** 注册的 spec 只有 5 个（`specs/index.ts`），story / assets / blueprint / ui-document 都还没进，且没有一个实现 diff |
| 主进程能查注册表吗 | **不能。** 注册是 import 副作用，而 `@shared/documents/specs` 只被四个**渲染进程**服务 import。主进程里 `resolveDocumentSpecForPath` 现在恒返回 `undefined` |
| 没有 spec 的文档怎么办 | **通用 JSON 结构 diff**，并且在界面上**标记为「结构级」**，不冒充语义级。二进制只报增删改 + 字节数 +（图像）缩略图 |
| diff 在哪个进程跑 | **主进程。** blob 只有主进程够得着（docs §2.3），且 `readRevisionDocuments` 已经是「一次树遍历、一批读」 |
| Lore 有合并 API 吗 | **有，而且很全**：`branch_merge_start / _into / _resolve / _resolve_mine / _resolve_theirs / _abort / _unresolve / _restart`、`file_stage_merge`、`file_reset_to_last_merged` 全在导出表里。**一个都还没绑** |
| Lore 的 automerge 对 JSON 做什么 | ~~未知~~ **已实测（2026-08-01，见 `version-control.md` §4.23–§4.30）**：写 diff3 冲突标记，文档不再可 parse——**但同一次合并在旁边留下三份干净可解析的副本**，写回不需要重建。**另外测出 §4.29：同步之后该进程再也读不出任何内容**，这一条现在就在损坏已发布的 V5a |
| 冲突能自动解决吗 | **不能，也不假装能。** 第一档永远是「整份取一边」；逐变更是第二档；两边都重构了同一棵场景树时**明说无法合并**并退回第一档 |
| 变更行能点了吗 | 能。`ChangeRow` 自己的注释说「一个高亮之后点开什么都没有的行，正是这个面板一直小心不去做的承诺」。本卡就是让它做得出这个承诺 |

---

## 1. 现场勘验

### 1.1 输入侧已经齐了（本卡不重做的部分）

| 能力 | 位置 | 状态 |
|---|---|---|
| 读任意修订的单个 blob | `blobAt` / `blobsAt` | ✅ 字节精确，集成测试钉住 |
| 枚举一个修订的全部文件 | `listFilesAt` | ✅ 一次 `listTreeChildren` 一个目录 |
| 一次批读多份文档，**缺席是答案不是失败** | `documentsAt` | ✅ 正是远端工程首次 diff 要联网时该有的形状（docs §6） |
| 两个修订之间哪些路径不同 | `changedPaths` | ✅ 便宜的前置过滤 |
| LCA | `mergeBase` | ✅ criss-cross 降级写在注释里：base 略差 → 多几个冲突，不是错误合并 |
| 三路合并的三个输入 | `threeWay` | ✅ **`base` 缺失表示 add/add，绝不能当空文件** |
| 修订元数据按 revision 缓存 | `VcsSession.details` | ✅ **只缓存明细、绝不缓存图**——这条界线本卡也要守 |

**所以本卡不写读路径。** 本卡写的是「读到的字节 → 作者能读的一句话」以及「两句话 → 一份文件」。

### 1.2 文档模型只走到 5/15，而且没有 diff

`DocumentKind` 有 15 个成员。注册的只有 5 个：`audioTracks` / `variables` / `voice` /
`localization` / `localizationKeys`。story、assets、blueprint、ui-document、project——**内容最大的那
几个——一个都没有**。

`DocumentSpec` 接口里没有 `diff`。2026-07-27-001 §3.2 的草案里写了
`diff?(base, head): DocumentChange[]`，落地时**没有落**。

三条派生结论：

1. **本卡的价值上限由 H2 的第二波决定。** 没有 story spec 就没有 story 的语义 diff，只有结构级降级。
2. **主进程今天看不见注册表。** `@shared/documents/specs` 的 import 名单里只有四个渲染进程服务。
   **D1 的第一行代码是让主进程 import 它**，并加一个断言测试（注册表非空），否则整个语义 diff 会
   静默降级成通用 JSON diff，全链路无一处报错。
3. **角色表根本不在这 15 种里。** 它在 `editor/services/character.json`，走 persistent-state store。
   「角色 Alice 的 angry 差分换图」今天**没有任何模型可以表达**。见 §6 未决第 1 条。

### 1.3 界面侧的两个空位

- **变更行不可点**，且是有意的。
- **看修订时整个变更区不渲染**——它描述的是工作树而屏幕上是修订。所以「**两个修订之间**的变更」在
  今天的界面上**没有任何位置**，本卡必须给它一个。
- 历史行只有一个动作：「显示这个版本」。没有「和上一个比」。
- 变更清单的既有纪律**必须继承**：排序在截断之前、上限 50 行并明说漏了多少、未解决冲突排最前。

### 1.4 Lore 的合并面：导出表里有，绑定层里没有

| verb | args | 用途 |
|---|---|---|
| `lore_branch_merge_start` | `{branch, message, noCommit, link, ignoreLinks}` | 开始一次合并，写工作树 |
| `lore_branch_merge_resolve` | `{paths}` | **把这些路径标记为已解决**——字节由我们写 |
| `lore_branch_merge_resolve_mine` / `_theirs` | `{paths}` | 整份取一边 |
| `lore_branch_merge_abort` | `{link, ignoreLinks}` | 整个中止 |
| `lore_file_stage_merge` | `{paths}` | 暂存合并结果 |

**`branch_merge_resolve(paths)` 是这条路的关键。** 它接受一组路径并把它们标记为已解决，字节由调用方
先写进工作树——这与 §4.10「能读不能写，写回必须走工作树」完全一致。

**一个已经存在的信息丢弃。** `LoreRepositoryStatusFileEventData` 有 **8 个**冲突相关标志，Studio 的
解码器只取了 5 个——`flagConflictAutomerged` / `flagConflictMine` / `flagConflictTheirs` 被丢掉了。
**这三个正是 resolve 界面要的。** D5 把它们接出来。

### 1.5 今天还没有冲突可看，而这是有意的

Studio 现在**造不出一个冲突**：`syncRevision` 传 `forwardChanges: 0`、`pushBranch` 传
`fastForwardMerge: 0`、远端卡定死「同步前工作树必须干净」、分支操作整个不在范围内。

所以本卡是**第一次**让 Studio 有两边。在 D5 落地之前，`VcsFileChange.conflictUnresolved` 在真实使用
中永远是 false。

### 1.6 五个未测量的事实 —— **已于 2026-08-01 全部测完**

> 五条的答案与另外三条计划没问到的，全部写在
> [`version-control.md` §4.23–§4.30](../version-control.md)。**动 D5–D8 之前先读那八条**，
> 其中三条推翻了本卡下文的写法：附属文件让 §6 的「重建」备案作废（§4.23）、冲突路径只能从
> tag 29 拿（§4.24）、以及 §4.29 这个必须先修掉才谈得上 diff 的阻塞缺陷。下面保留原始问题
> 陈述，因为它解释了每条实验为什么值得做。

以下每一条都**不知道**，并且每一条都能改变设计。§7 给出 settle 它们的脚本。

1. **Lore 的 automerge 对规范化 JSON 做什么？** 如果它写冲突标记，那份文件对 `loadDocument` 就是
   corrupt，会被隔离——而那是**对一份好文件贴坏标签**。
2. **冲突文件在工作树上是哪一边的字节？**
3. **`branch_merge_resolve(paths)` 是否真的接受我们写进去的字节？**
4. **合并提交的 parents 是不是两个？** `flattenFirstParent` 的 `merge` 标志靠 `parents.length > 1`，
   历史列表已经准备好画它，但从来没有一个真的合并修订进过那条路径。
5. **`branch_merge_abort` 是否完整回滚工作树？** 如果不是，「取消合并」这个按钮不能存在。

---

## 2. 语义 diff 的模型

### 2.1 `DocumentChange`

新增 `src/shared/documents/diff.ts`（shared：主进程产出，渲染进程渲染）。

```ts
export type DocumentChangeKind = "added" | "removed" | "changed" | "moved";

export interface DocumentChange {
    /**
     * 这条变更在文档里的位置，**也是 resolve 的粒度单元**。
     * 稳定：同一份文档的两次 diff 对同一个东西必须给出同一条 path。
     */
    readonly path: readonly string[];
    readonly kind: DocumentChangeKind;
    /** 怎么念这一行。**翻译键加参数，不是句子。** */
    readonly label: { readonly key: string; readonly params?: Readonly<Record<string, string | number>> };
    /** 作者自己写下的名字（场景名、角色名、本地化键）。**永不翻译**。 */
    readonly subject?: string;
    /** 子变更，**最多一层**。上层是「场景」，下层是「块」。 */
    readonly children?: readonly DocumentChange[];
    /** 被上限折叠掉的子变更数。非 0 时界面必须画出「另有 N 处」。 */
    readonly truncated?: number;
}

export interface DocumentDiff {
    readonly changes: readonly DocumentChange[];
    /** false = 触到上限。界面必须说出来，不许静默截断。 */
    readonly complete: boolean;
    readonly total: number;
    /** 这份 diff 是哪一档产出的。界面据此决定画得多显眼。 */
    readonly tier: "semantic" | "summary" | "structural" | "opaque";
}
```

`tier` 是这个模型里最不显眼、也最重要的字段。**一个结构级 diff 长得像语义级 diff，就是在骗人**。

### 2.2 `DocumentSpec.diff`

```ts
/**
 * 两份同种文档之间，作者会关心的变化。
 *
 * 可选，而且**缺席是一个正常答案**。实现了就必须是**纯函数、不抛**：它跑在主进程里，
 * 一次抛出会让整份变更列表消失。`limit` 是硬预算。
 */
diff?(base: T, head: T, options: { limit: number }): DocumentDiff;
```

### 2.3 四级降级，每一级都诚实

| 档 | 触发条件 | 产出 | `tier` |
|---|---|---|---|
| 1 | spec 存在且实现了 `diff` | 「场景『序章』新增 3 行对白」 | `semantic` |
| 2 | spec 存在但没有 `diff` | 两侧各跑一次 `summarize`：「变量 12 → 14」。**几乎白送** | `summary` |
| 3 | 没有 spec，但两侧都能 `JSON.parse` | 通用 JSON 结构 diff | `structural` |
| 4 | 不是 JSON / parse 失败 / 二进制 | 增删改 + 两侧字节数 +（图像）缩略图 | `opaque` |

第三档值得单独辩护一次：今天 15 种文档里 10 种没有 spec，其中包括 story——**没有第三档，本卡上线
那天作者点开 story 文档会看到一片空白**。代价是必须被明确标记，而 `tier` 就是那个标记。

### 2.4 主进程侧的形状

新增 `src/main/app/application/managers/vcs/diff/`：`documentDiff.ts`（纯策略，不碰 Lore/fs）、
`revisionDiff.ts`（编排）、`workingTreeDiff.ts`。

`VcsManager` 加 `diffRevisions` / `diffWorkingTree`，走既有的 `serialize` 队列。

**缓存规矩**：`diffRevisions(from, to)` **可以缓存**（修订不可变）；`diffWorkingTree()` **绝不缓存**。

### 2.5 规模：什么有界、什么分页、什么拒绝

| 边界 | 值 |
|---|---|
| 每份文档的变更上限 | `DOCUMENT_DIFF_CHANGE_LIMIT = 200` |
| 单份文档的字节上限 | `DIFF_PARSE_BYTE_CEILING = 8 MiB` |
| 一次比较的总预算 | `DIFF_TOTAL_BYTE_BUDGET = 64 MiB` |
| 层级 | **两层**：文档 → 组 → 叶 |
| 路径数上限 | `DIFF_PATH_LIMIT = 2000`，超过只做第四档 |

**关于那两个字节数字的诚实说明**：2026-07-28-002 §4.2.4 实测过一个真实夹具——文档 50 个共 3.62 MiB、
素材 22 个共 73.78 MiB。但**没有人测过一份大 story 文档**，所以这两个数是按已知的唯一一个数据点画的
护栏，第一份真实大工程到手时要重设。

---

## 3. diff 出现在哪

三个位置，一个组件。

### 3.1 轨道里：变更行可点，就地展开摘要

`ChangeRow` 从 `<div>` 变成 `<button>`，点开在**同一段里**展开该文档的变更摘要——不是新面板、不是
弹窗、不是第二个滚动容器。理由是既有的：面板是 320px、**只有一个滚动容器**，UI 规矩是最少 chrome。

**摘要最多 8 行**，再多就是「查看全部 N 处」，通向 §3.2。

### 3.2 编辑器区：`vcs-changes` tab

一个 `EditorModule`，编辑器宽度，画**同一个 `DocumentChange` 列表**。三种载荷：
`{mode:"working-tree"}` / `{mode:"between", from, to}` / `{mode:"resolve"}`。

它之所以必须存在，是因为**冲突解决没有别的地方可以住**——一个 320px 的栏放不下「两边各是什么、
你选哪边」。

进入口两个，都不新增常驻控件：摘要底部的「查看全部 N 处」；历史行 **hover 揭示**一个对比图标。

### 3.3 不做的

- **不做并排文本 diff。** 作者从来没写过那些字节。
- **不做「在场景编辑器里高亮改了哪些行」。** 那需要编辑器同时持有两个版本。
- **不做修订之间的素材字节对比视图。**

---

## 4. 冲突解决

### 4.1 冲突从哪来

```
push 被拒（远端卡 §1.3 实测：Branch has diverged, sync to merge remote changes）
  → 作者按「同步」→ revisionSync 能自动合的自动合 → fileConflict > 0
  → 进入解决模式             ← 本卡从这里开始
```

**同步前工作树必须干净**这条不放松。

### 4.2 三档模型

**第一档：整份取一边。必须最先做，而且它单独就能让合并可用。** 对**任何**文档都成立，包括二进制、
包括没有 spec 的、包括超上限的。

**第二档：逐变更接受。** 只对实现了 `merge3` 的 spec 成立。

```ts
/**
 * 三路合并。`base` 缺失表示 add/add——**绝不能当空文件**，那等于静默接受一边。
 * 有 conflict 的那些在作者选边之前放 base（没有 base 就是 mine），
 * 这样一份未解决的文档也**始终是可序列化的**。
 */
merge3?(base: T | undefined, mine: T, theirs: T): DocumentMerge3<T>;
```

界面：一行一个 decision。`auto-*` 画成**已决定**，hover 揭示「改用另一边」。`conflict` 画成两个待选，
**默认都不选**。

**第三档：拒绝。** 退回第一档并说出理由，不是灰一个按钮。

### 4.3 每一种文档「解决」是什么意思

**story 文档。** 块按 id 匹配，精确且免费。不同场景 → 直接合；同场景不同块 → 合；同块不同字段 → 合；
同块同字段 → 叶级冲突。顺序数组一边动 → 取动的那边；**两边都动 → 整个数组取一边，绝不交错。**

> **明说的拒绝：两边都重构了同一棵场景树。** 理由不是实现难：一棵树的两个重排交错出来的故事是
> **谁都没写过的**，而且它**能编译**——作者不会看到任何错误，只会在某一天发现剧情断了。

**资产元数据。** 两边各自导入了不同的素材 → **合**，这是协作里最常见的场景。**顺序文件两边都变 →
追加合并而不是冲突**，因为资产顺序是导入序不是作者排的。

**本地化。** 同键不同译文 → 叶级冲突，两侧并排显示译文本身。**这是逐变更解决收益最高的一种**，
排在 D7 最前面。

**二进制素材。** **永不合并。** 素材路径按 assetId 做两级 fan-out，两个人导入不同的图根本不会碰上。

### 4.4 写回与记录

```
spec.serialize(合并结果) → 原子写进工作树
  → branchMergeResolve([**绝对**路径])
  → repositoryStatus(scan:false, revisionOnly:true)   # 确认真有东西可提交（§4.21）
  → revisionMetadataSet(narraleaf.kind = commit)      # **必须在 commit 之前**（§4.21）
  → revisionCommit → repositoryFlush                  # 不 flush 会丢，且是竞态（§4.11）
  → afterRevision() + 走 V4 的重载路径
```

五条硬约束：**路径要绝对**（§4.16）、**标记在 commit 之前**（§4.21）、**不 flush 会丢提交**（§4.11）、
**合并写工作树 → 必须走 V4 重载路径**、**全程持有 `holdRelease()` 并在自己 `thaw()` 之前释放**。

**中途退出**：`branchMergeAbort` 只有 §7 实验 5 证明它完整回滚之后才做成按钮。

### 4.5 诚实清单：本设计**不**能解决的七种情况

1. 两边都重构了同一棵场景树。2. 二进制素材。3. 没有 spec 的文档。4. 两边都改了同一个作者排过的顺序
数组。5. 一边删了文档、另一边改了它。6. `base` 缺失的 add/add。7. 超过变更上限的文档。

第 3 条会随 H2 第二波缩小；第 1、2、4、5、6 条是**永久的**，不是待办。

---

## 5. 里程碑

| # | 里程碑 | 依赖 | 产出 |
|---|---|---|---|
| **D0** | 实测：§1.6 的五个未知 | — | ✅ **完成 2026-08-01**。`mergeSpike*.integration.test.ts` + 结论写回 `version-control.md` **§4.23–§4.30**（八条，多出来的三条比原来的五条更重要） |
| **D1** | diff 的地基 | H1 | `shared/documents/diff.ts`、通用 JSON 结构 diff、`vcs/diff/`、两个 IPC、**主进程 import specs 并断言注册表非空**。**没有任何界面** |
| **D2** | 变更行可点 | D1 | 就地展开 8 行摘要 + loading 态 |
| **D3** | `vcs-changes` tab | D2 | `working-tree` 与 `between` 两种模式 |
| **D4** | 三个真 `spec.diff` | D1 | story / assets-metadata / characters |
| **D5** | 合并绑定 | D0 | 六个 verb；补上被丢掉的三个冲突标志 |
| **D6** | 解决第一档 | D5, D3 | 整份取一边；写回管线（§4.4）；接 V4 重载与 `afterRevision` |
| **D7** | 解决第二档 | D6, D4 | `merge3`；**localization 与 assets-metadata 先行** |
| **D8** | story 的 merge3 | D7 | 场景级/块级合并 + 不可合并判据 |

**D0 排最前**，因为 D5 之后的一切都建立在「Lore 的 automerge 到底做了什么」上。
**D6 单独就让合并可用**，第二档是改善不是及格线。

---

## 6. 风险与未决

| 风险 | 处置 |
|---|---|
| Lore 的 automerge 把规范化 JSON 弄成不可解析 | D0 实验 1。若成立：写回**不看工作树**，只用 `threeWay` 的三个 blob 重建；并且**合并期间关掉 quarantine**——把合并产物复制进隔离区是给好文件贴坏标签 |
| 主进程解析大文档卡住主线程 | §2.5 的三重预算 |
| 通用 JSON diff 的 UUID 噪声被当成语义 diff | `tier` 字段 + 界面两种画法 |
| 三个版本界面各读各的 head，互相矛盾 | 老坑（真发生过：轨道 `#3` 旁边状态栏 `#2`）。**合并提交也必须让 `afterRevision()` 跑到** |
| 仓库锁独占且**阻塞**（§4.12） | 合并排在项目串行队列里；**不能放进开窗路径** |
| 解决到一半崩溃/关窗 | 合并状态在 Lore 里，不在 Studio 里。重开工程时 `getStatus` 会报出未解决冲突，**Studio 侧不存任何解决进度** |

**未决（需要人裁决）：**

1. **角色表要不要成为一个 `DocumentKind`？** 语义 diff 和逐变更合并**都要求它是一个 spec**。这是一次
   schema 搬家，属于 H 而不是 V，而且它挡着最直观的那个例子。**要人拍板。**
2. **`vcs-changes` 是不是应该是一个编辑器 tab？** 形态问题不是实现问题。
3. **合并的入口在哪？** 「同步时自动进入合并模式」还是「同步报告冲突，作者再显式按『解决』」？
   后者与「不自动建库」同一条纪律。
4. **逐变更解决的默认值。** 全部未选（安全，但 200 个冲突是折磨）还是默认取我的（快，但一次误按就
   静默丢掉对方的工作）？§4.2 按前者写。

---

## 7. 怎么 settle §1.6 的五个未知

配方与远端卡 §6 相同（真 loreserver 0.8.5）。

1. **automerge 对规范化 JSON 做什么**：两个分支各改**不相邻**的键 → `branchMergeStart` → 读工作树
   **原始字节**：`JSON.parse` 过不过？两侧改动都在吗？有没有 `<<<<<<<` 标记？再用**同一个键**重复一次。
   **这一条的结论直接决定 D6 的写回管线是「读工作树」还是「重建」。**
2. **冲突文件在工作树上是哪一边**：与 `blobAt(mine)` / `blobAt(theirs)` 做**字节比对**。
3. **`branchMergeResolve` 是否接受我们写的字节**：写进一份**两边都没有**的内容 → resolve → commit →
   重开 session → `blobAt` 字节比对。
4. **合并修订的 parents**：`readRevisionGraph` 断言 `parents.length === 2`。
5. **`branchMergeAbort` 是否完整回滚**：记录整棵工作树哈希 → abort → 再记一次 → 比对。
   **这一条不通过，就不做「取消合并」按钮。**

每条结论都写回 [docs/version-control.md](../version-control.md) §4，编号接在 §4.22 之后。
