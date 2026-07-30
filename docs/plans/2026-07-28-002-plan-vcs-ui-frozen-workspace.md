---
title: "plan: 版本控制界面 —— 冻结工作区与版本轨道"
type: plan
status: draft
date: 2026-07-28
plan: 2026-07-27-001-plan-editor-data-and-version-control.md
branch: feat/vcs-documents-and-repository
worktree: D:/Temp/nls-vcs
---

# plan: 版本控制界面 —— 冻结工作区与版本轨道

底座五个里程碑已落地（见[交接](2026-07-28-001-handoff-vcs-ui.md)），V6a 已落地（`ce259898`）。
本卡是**界面**：作者怎么看历史、怎么提交、怎么回到过去。

核心形态一句话：**整个工作区是「某个版本」的视图，顶栏与最左侧的轨道负责选版本，其余部分在
非当前版本上整体只读。**

这不只是一种呈现选择，它决定了 V3 的规模：**历史版本用真编辑器渲染**，作者看到的是当时的场景
编辑器、当时的蓝图、当时的立绘。结构化 diff 因此退化成变更清单里的一行摘要，而不是「为 8 种
文档各写一个 diff 视图」。同形态的先例是 Google Docs 版本历史与 Figma version history。

---

## 1. 产品裁决（2026-07-28 定，不再重新谈判）

| 问题 | 裁决 |
|---|---|
| 冻结的语义 | **禁止更改项目数据**。编辑器状态（面板布局、控制台、通知）不属于项目状态，不冻 |
| 冻结态下 Dev Mode | **跑聚焦的那个版本**。Preview 与 production build 禁用 |
| 顶栏 | 冻结态下**不接受动态注册的动作项**（见 §6 待确认） |
| 版本轨道位置 | **屏幕最左**，在边栏选择器**左边**——旧版本里仍要能开边栏、读资产、翻场景树 |
| 轨道折叠 | 可折叠到与边栏选择器同宽（48px）。折叠态**就是**「你在看历史版本」的常驻强提示，也是展开入口 |
| 轨道常驻条件（2026-07-29 修正） | **只在冻结期间常驻**：看历史版本或手动冻结时是 48px 条，且不可关成零；在 HEAD / 无仓库 / 无后端时**不占一列、对停靠账目贡献 0**，改为按需从状态栏位与顶栏控件打开 |
| 提交入口 | 版本轨道面板内。状态栏一个小位显示当前版本，点击打开轨道 |
| 浏览历史的副作用 | **零**。不动工作树，因此**不打检查点**。检查点只在「恢复」之前打（那一步真写工作树） |

「轨道常驻条件」那条的理由：48px 条表达的是**对编辑器临时冻结态的控制**，所以它的存在条件就是冻结
本身——在 HEAD 上它什么都不表达，只是一列常驻占位。手动冻结与看历史同等对待：一个没有可见出口的
冻结工作区，比一条没人要的常驻轨道糟得多。**代价是「提交入口在轨道面板内」这条必须靠另一条路活着**
——预览天生只读，如果面板只能从预览里打开，提交就没有家了；所以 HEAD 上「按需打开」不是便利项，
而是承重项（规则落在 `resolveVersionRailPresence`）。

同日第二条修正：**底部停靠区的面板触发器要回到边栏选择器那一列**，与左边栏的条目同一个 x。它是绝对
定位的（要浮在状态栏上方），所以必须被告知列起点；`left-0` 在最左多出一列之后就把它推进了版本轨道的
列里（实测 x≈29 对 x≈90）。两侧都读 `railColumnOffsets`。

最后一条是对交接文档里「切换版本会暂存当前版本」的修正：计划 §4.4 已定浏览不动工作树，
既然不动就没有东西需要暂存；而每次浏览都产生一个检查点意味着作者点开三次历史，他正在读的
那条时间线上就多出三个他没做过的版本——**历史因为「看历史」这个动作而变脏**。

## 2. 冻结的机制：闸门在写边界，不在组件

UI 只读只负责 affordance（别给假的可点按钮）。**正确性由写边界保证。**

理由是失败模式不对称：工作区有 24 个模块、四个停靠区、命令面板、全局快捷键，「每个交互元素
都记得读只读标志」漏掉一个的后果是**作者在历史版本上改了一笔，autosaver 把它写进工作树**。
那不是 bug，是数据丢失，而且发生在一个名字叫「冻结」的功能里。

闸门位置现成：[DocumentStorage.ts](../../src/renderer/lib/workspace/services/core/DocumentStorage.ts)
明写 *"Writes go through `FileSystemService.write` and nothing else"*。冻结 latch 在那一层，
漏网组件的最坏后果是一次无害的 no-op 加一句可见提示。

**判据也是现成的**：冻结边界 == 工作集边界。`isVersioned()`（V6a 已搬到
[@shared/vcs/workingSet](../../src/shared/vcs/workingSet.ts)）就是「这条路径进不进版本库」的
唯一真值源，`.nlstudio/`（编辑器布局、插件、隔离区）、`editor/cache`、`dist` 都已排除。
所以裁决「编辑器状态不冻、项目数据冻」= 「被 `.loreignore` 排除的不冻、进版本库的冻」，
一条谓词，不需要逐面板判断。

不走 `DocumentStorage` 的写路径要单独堵：**资产导入**（直接调 `appPrivilegedFacade.fs.copyFile`，
写进 `assets/content/**`）与**项目设置**写 `project.json`。U1a 的审计把两处都堵上了，闸门落在
`createBoundPrivilegedFacade`——所有写路径的唯一交汇点，插件的绑定也走它。

> 本节初稿把**蓝图持久化**也列为第三处旁路写，那是错的：它写 `UserDataNamespace.BlueprintPersistence`
> 下的 userData，按项目路径哈希 keying，一个字节都不落在项目目录里。Dev Mode 的存档同理。

**没堵、且是有意的**：游戏构建的最终输出目录（作者可以把它指到项目里）。构建是 IPC 直达主进程的，
从渲染层拦是做样子——按 §1 的裁决，这一拦要落在主进程，属 U4。

## 3. 界面形态

```
┌────┬──┬──────────────┬─────────────────────────────┬──┐
│版本│边│  边栏面板     │        编辑器区域             │边│
│轨道│栏│              │                             │栏│
│    │选│  (可用、只读) │   (可用、只读)                │  │
│320 │择│              │                             │  │
│ or │器│              │                             │  │
│ 48 │48│              │                             │48│
└────┴──┴──────────────┴─────────────────────────────┴──┘
│ 状态栏（可点：显示当前版本，点击开轨道）                    │
```

- **展开态 320px**：提交信息（消息 / 时间 / 人员）、操作按钮、变更清单；下方滚动切换到
  线性历史上的其它版本。
- **折叠态 48px**：与边栏选择器同宽。冻结态下常驻，是模式指示器也是展开入口。
- **顶栏**：项目切换器右侧一个版本控件。Production Build 合并进 Dev Mode 下拉腾位置。

**必须一起改的一处**：停靠求解器按 `windowWidth - 2*RAIL_SELECTOR_WIDTH - EDITOR_FLOOR.width`
算侧边栏上限（[dockLayoutModel.ts](../../src/renderer/apps/workspace/components/layout/dockLayoutModel.ts)，
编辑器 480px 硬地板）。新的最左列不在它的账里，展开到 320 时侧边栏会按「这一列不存在」自算宽度，
把编辑器压到地板以下。轨道宽度必须进 `DockEnv` 参与求解——账目不符正是之前那次
「编辑器组溢出 → 拉出滚动条 → 容器缩 → 浮层回夹 → 死循环」的成因。

## 4. 里程碑

| # | 里程碑 | 依赖 | 产出 |
|---|---|---|---|
| **V6a** | 渲染框架 | V2 之外全部 | ✅ 落地 `ce259898` |
| **U1a** | 冻结的写边界 | V6a | ✅ 落地：闸门在 `createBoundPrivilegedFacade` + `BaseFileSystemService`，判据 = `isVersioned`；命令面板入口 |
| **U1a′** | Studio 状态搬出版本库 | U1a | ✅ 落地：`panel_state` / `notification_history` / `recent_colors` → `.nlstudio/services/`，分类表 `shared/vcs/serviceStores.ts`，`character` 与插件 store 留在版本库 |
| **U1b-顶栏** | 顶栏 affordance | U1a | ✅ 落地：注册项渲染但禁用，File/Help 豁免；命令面板套同一张表（否则灰按钮仍能被搜到运行） |
| **U1c** | 解冻重载 | U1a | ✅ 落地：`WorkspaceReloadService`，参与者静态表；reload 期间另一道静默 hold；丢弃欠账而非补写；清撤销栈 |
| **V2** | 提交与检查点 | V1, U1c | ✅ 落地：管线 flush→stage→**标记**→commit→flush；检查点由 `observeWrites` 驱动（**绝不扫描**）；`versionControl.checkpointIntervalMinutes`（默认 15，0=关） |
| **U1b-编辑区** | 编辑区只读 | U1a | ✅ 落地：创建流程、直接操作手势、行内文本、属性字段；机制在 `components/ui/freezeGuard.ts` + `lib/ui-editor/interaction/readOnlyInteraction.ts` |
| **U1d** | 工作区能显示某个修订 | U1c | ✅ 落地：`DocumentSource` 端口（`@shared/documents/documentSource`）+ 读边界闸门（`lib/app/documentSource.ts`）；`reload(cause, source)`；`WorkspaceFreezeService.showRevision` / `VersionControlService.showRevision`；详见 §4.2.3 |
| **U2** | 入口 | U1 | 顶栏版本控件 + 状态栏位；「启用版本控制」进项目设置与新建向导 |
| **U3** | 版本轨道 | U2, V2 | 轨道面板、线性历史、变更清单、提交 |
| **U4** | 冻结下的 Dev Mode | U1c | ✅ 落地：快照落 `.nlstudio/devmode/revisions/<rev前16位>`（按版本命名、每次启动重建、会话结束删除）；`DevModeSession.sourcePath` 取代 `projectPath` 喂编译；冻结记录多带一个 `revision`；读不出来就**拒绝启动**，绝不回落工作树。详见 §4.2.4 |

### 4.2 V2 之后新增的两条实测（细节在 version-control.md §4.21 / §4.22）

- **`revisionMetadataSet` 写的是暂存修订，不是 HEAD**，而且**没东西暂存时它不报错、会贴到下一次提交上**。
  所以标记必须在 commit **之前**打，且打之前要先确认有东西可提交（用 `scan:false` 的纯读，不能引入扫描）。
- **`repositoryFlush` 会等满 store 的 keep-alive 窗口**，与要落盘多少东西无关。默认 10 秒意味着**每次提交
  10 秒**；`storeKeepAliveSeconds: 1` 把它压到 1 秒，代价是 blob 读突发之间的 store 复用窗口变短（远大于
  突发内的间隔，可接受）。只给 flush 那一次传 `storeKeepAlive:false` **无效**——等待属于之前那些读。

### 4.2.1 U1b 的三个机制，和它们各自的理由

- **手势用白名单，不用逐个关**。`toReadOnlyMoveableProps` 从两个允许的键重建一个新的 props 对象，
  所以 Moveable 升级新增一种 ability 不会漏出来。覆盖层同时 `pointer-events-none`——这也是点击与
  悬停能穿透到元素、让**选中继续工作**的原因。
- **只拦提交不够，要拦 DOM 的可编辑性**。场景行的普通点击根本不走 `startTextEdit`：行把按下交给
  浏览器（让原生选区变成插入符），窗口级 `mouseup` 直接设置文本模式；而 `RichTextInput` 无条件
  `contentEditable`，键入由浏览器完成，Studio 全程不被问。**实测过一次「只拦了提交」的修复在真 app
  上完全无效**：作者打完一句话、看着它出现在行上，然后被丢掉。
- **属性框架用 `<fieldset disabled>` 兜底**。`inlineRow` / `custom` 这类字段的内容是调用方给的
  JSX，没有地方接 `readOnly`，于是标志被静默丢掉——这就是 Position 锁住而紧挨着的 Rotation、
  Appearance 还能输入的原因。改为把结构性字段的输出包进禁用的 `fieldset`（`display:contents`
  用内联样式而不是 Tailwind 类，免得依赖某个工具类被生成过），禁用交给浏览器，一个自制控件不需要
  知道这段代码存在就是惰性的。顺带覆盖了同样漏掉的另外四种字段类型。

> **验收这块时的一个测量陷阱**：`<fieldset disabled>` 里的 input，`el.disabled` 是 **false**——
> 那个属性反射的是元素自身的属性，不继承祖先。要问的是 `el.matches(":disabled")`。用错探针会报出
> 一个不存在的缺陷（本轮发生过）。

### 4.2.2 U1b 仍未覆盖的（写边界保证安全，缺的只是「别提供做不到的动作」）

- 场景行的其余控件：位置选择器、条件编辑器、循环次数、加分支/加内层、背景快捷参数
- `StoryFindBar` 的替换；`StorySceneActionInspector` 的自制编辑器（转场、VFX、镜头、角色动作）
- 构建对话框（其主进程那一半属 U4）
- 基于 `div` 的自制按钮不受 `fieldset` 约束（那条只作用于表单控件）

### 4.2.3 U1d 的四条结论（都是实测，不是设计偏好）

1. **修订是可枚举的**。`lore_revision_tree_list_children` 在 win32 build 的 263 个导出符号里
   （不属于 SDK 声明而库没有的那三个写侧 verb），已绑定并在 `revisionReader.integration.test.ts`
   对真仓库跑通：一次 `listTreeChildren` 一个目录，child 事件自带 name/kind/size/address，所以路径
   和内容地址来自同一次遍历，不需要每个文件一次 `resolvePath`。**这条很关键**：备选方案是从文档
   注册表猜路径，而注册表至今只认识迁到 spec 的 4 种（共 14 种），猜出来的清单是残缺的。
2. **闸门在读边界，不在九个服务里**。与 §2 同一条论证，只是换到读侧：一是**文档是懒加载的**
   （`StoryService.loadStory` 在 tab 第一次问它时才读），穿参数只能覆盖当时已打开的那些，之后打开
   的每一个都会静默读工作树；二是九个服务里只有三个走 `DocumentStorage` 端口，另外六个直接用
   `FileSystemService`，穿参数等于新造六个可以忘记的接缝。所以 `BaseFileSystemService.read` /
   `isFileExists` 在有 source 时改答 source，判据仍是 `isVersioned`——`.nlstudio/`、`editor/cache`、
   `dist` 照旧读磁盘，否则历史视图连面板布局都是历史的，看起来就是应用坏了。
3. **只重定向文本，不重定向 `readRaw`**。source 答的是字符串，而走 `readRaw` 的是作者的素材：为了
   重绘一张缩略图把几 MB 的图 base64 过 IPC 不值得。所以历史视图里**文档是历史的、素材字节是当下的**
   ——这是明说的限制，不是漏掉。
4. **进出各有一个必须关掉的窗口**。进：先冻结再读，否则内存里有历史文档而工作区还能写，一个
   autosave 定时器就把修订写到工作树上（§4.1 第 1 条的损失换个方向到达）。出：先撤 source 再撤闸门，
   否则那趟本该替换历史内存的重读会把历史再读回来、然后在它上面解冻。另外 reload 的**合并**必须
   按版本区分：两趟读的是不同版本时排队而不是合并，否则「进入还没读完就离开」会把进入那趟的结果
   交给离开的调用方。

### 4.2.4 U4 的实测与两条明说的限制

- **成本可以忽略，但只有在不复制素材的前提下。** 在 `D:/Temp/nls-vcs-proj-withhistory`（两个修订）上实测：
  一个修订共 72 个文件，**文档 50 个 / 3.62 MiB，素材字节 22 个 / 73.78 MiB**——95% 的字节是素材。
  只物化文档 **89 ms**；连素材一起物化 209 ms。跳过素材的理由不是这 120 ms，而是**规模与磨损**：
  一个 2GB 美术的工程每按一次 Run 就往作者项目里写 2GB，而且**换不到任何行为差别**（下一条）。
- **限制一：素材字节是当下的，不是历史的。** 编译管线一个素材字节都不读（bundle 里只有 assetId），
  Dev Mode 窗口的素材 URL 是**回头问它的 workspace 窗口**要的（`DevModeResolveAssetUrlHandler`），
  而 workspace 按 §4.2.3 第 3 条读磁盘。所以历史版本里的立绘显示的是**现在**那张图，作者已删掉的
  那张则整个显示不出来。要把这半边也变成历史，得改渲染层的素材解析，是另一个里程碑。
- **限制二：启动时定一次，之后不重解。** 作者按 Run 时看的是哪个版本，跑完的就是那个版本；启动途中
  离开版本不会中止。同理该会话的 reload 重编同一个快照（而且**修订会话不装文件监听**——快照不会变，
  监听工作树只会让作者一次无关的保存把正在跑的历史版本重启一遍）。要跑别的，重新启动。
- **Dev Mode 存档与网络策略仍取工作树**：`readProjectAllowHttp` 故意读当前配置（历史版本不该有机会
  放宽网络策略），存档按项目路径 keying，因此历史版本写的存档和当前游戏的混在一处。

**顺带修正**：作者时的 quarantine 在显示修订期间必须关掉——读不动的字节是**修订的**，作者磁盘上
那份是好的，把它复制进 `.nlstudio/quarantine/` 是给一份好文件贴上「坏了」的标签。`loadDocument`
本来就有正确的落点（corrupt + 没能 quarantine + 服务不加载）。

### 4.3 已知缺口

- **Cmd+Q 跳过「关闭项目前的检查点」**。检查点挂在关闭工作区的请求上，而不是退出应用的 flush 上：
  那条路有 20 秒硬上限用于有界收尾，而一次提交在大工程上没有上界（stage 要遍历整棵资产树）。
  工作本身不会丢（退出前的保存 flush 照旧），丢的只是「最后那段进了一个修订」。

U1 单独完工时作者看不见任何东西，所以入口是 U1 的一部分而不是 U2 的——否则冻结要攒到 U2 才
第一次被真正跑到，而验收要求是亲眼看。

**U4 的形态已勘验**：`bundleAssembler` 是纯路径驱动的，12 个读取点全部从 `context.projectPath`
拼出来，所以不用改编译管线，把它指向物化出来的快照即可。两个附带条件：快照必须落在工作集之外
（`.nlstudio/` 已被排除），否则跑一次旧版本就把仓库弄脏；**禁用 production build 要在主进程再拦
一次**——构建是 IPC 直达的，只灰按钮等于没拦。

## 4.1 U1a 完工后跑真 app 抓到的三件事（测试与子代理报告都没有）

1. **解冻不重载内存，冻结期间的改动会搭下一次保存的车落盘。** 实测：冻结时新建的场景当场没进磁盘，
   解冻后第一次成功保存把它写进去了。手动冻结无害（内存里是作者自己的东西），**浏览历史时是致命的**
   ——那时内存里是一个**过去的修订**，解冻后第一次保存就把它覆盖到工作树上，正是这道闸门要防的
   损失晚一步到达。修法与计划给「恢复」定的是同一条：工作树不再是编辑器显示的东西时，丢掉内存文档
   重读。**U3 的阻塞前置，不是优化项。**
2. ~~**面板布局存在版本库里**~~ **已修**：`editor/services/` 是个混装目录，`panel_state` /
   `notification_history` / `recent_colors` 是 Studio 状态，`character`（工程的角色表）与插件 store
   是项目内容。裁决：**Studio 状态不进版本控制也不冻**，前三者搬到 `.nlstudio/services/`，分类表在
   [shared/vcs/serviceStores.ts](../../src/shared/vcs/serviceStores.ts)，**默认是「项目内容」**——
   多冻一个偏好可恢复，少冻一份作者写的东西就退出了版本控制。
3. ~~**冻结的瞬间就弹「什么都没在保存」**~~ 随第 2 条消失。实测（冻结态下同一个动作）：
   `editor/story/index.json` 纹丝不动，`.nlstudio/services/notification_history.json` 照常写入。

## 5. 会咬人的实现约束

1. **不许有任何定时器。** `getStatus` 的扫描不是纯读：发现新目录会记进暂存状态，之后目录被删
   整个 session 都报成删除（§4.17）。变更数只能在明确时机刷新：展开控件时、保存 flush 之后、
   构建前、项目打开时。顶栏控件平时显示**版本标识**，不显示变更数。
2. **`action: KEEP(0)` 是「已修改」**（§4.18）。映射已在 `repository.ts` 做好，别自己读原始 action。
3. **状态里的路径是仓库相对，写侧要绝对**（§4.16），两边都是 `string`，编译器不会拦。
4. **首次 diff 可能联网**，要 loading 态。
5. **VCS 是可选能力**，先问 `getAvailability()`；三种 `reason` 对用户要说不同的话。
6. **历史是 DAG 不是链**：`VcsHistoryEntry.parents` 已是数组。轨道按第一父级压平展示可以，
   但服务层要返回图，别在数据层假设线性，否则 V5 协作返工。

## 6. 待确认 / 待定

- **顶栏「不允许动态注册项目」的准确含义**：当前读法是「冻结态下顶栏不再接受模块与插件动态
  注册的动作项，因为它们不保证冻结感知，与其逐个禁不如整体不注册」。版本控件本身是固定核心
  元素而非注册项。**未经确认，U2 开工前需要拍板。**
- **状态栏那一位显示什么**：复杂历史（分支、合并）的呈现尚未想清楚，先做成可替换的槽。
- **`refreshVcsAvailability()` 没有 IPC**：主进程支持重新探测（用户修好安装不必重启），但渲染
  层够不着，`VersionControlService` 的可用性缓存因此仍是一个 session。要么补 IPC，要么承认这条。

## 7. 环境

- **worktree 里 `yarn` 跑不了**：`yarn.lock` 在 `.gitignore` 第 150 行、不进版本库，yarn 因
  「not present in your lockfile」直接中止。用 `node node_modules/typescript/bin/tsc --project src/<p>/tsconfig.json`
  逐个跑五个项目，`node node_modules/vitest/vitest.mjs run` 跑测试——与 `yarn lint` / `yarn test`
  等价。
- win32 基线失败 **5 个文件 / 8 个测试**（`GameBuildManager`、`mobileSigningIdentity`、
  `storageManager`、`runtimeProtocol`、`utils/path`），是权限位与路径分隔符，与本程序无关。
