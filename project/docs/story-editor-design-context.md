# NarraLeaf Studio - Story Editor Design Context

本文补齐 Story Editor 进入实现前仍缺失的设计上下文。它不替代 `story-service-implementation-notes.md`，也不把 `story-stage-editor-concept.md` 中还未落地的产品构想伪装成既有架构。后续 agent 应把本文当作 Story Scene Editor Foundation 之前的编辑器设计补充：理解要接入哪些模块、哪些交互必须遵守现有 StoryService 语义、哪些边界暂时只预留不实现。

## 目标形态

`story-stage-editor-concept.md` 给出的主判断仍然成立：Story Editor 的核心形态不是纯脚本编辑器、行式动作列表、或用户手动画节点图，而是左侧 Story Document Editor 和右侧 Active Stage Snapshot。

左侧 Story Document Editor 表面上应该接近写作工具。用户按 Enter 新增相邻 block，通过 slash command 插入结构化剧情动作，通过 Tab / Shift+Tab 调整层级，通过拖拽整理 block tree。普通旁白和台词应保持可读文本形态，但编辑器内部不能把纯文本当作唯一真相。Studio 内部真相必须是 `StoryScene.rootBlockIds`、`StoryScene.blocks`、`StoryBlock.parentId`、`StoryBlock.childrenIds` 组成的 block tree。

右侧 Active Stage Snapshot 显示 active block 执行后的舞台状态。默认语义是 after state：从当前 Scene 的入口状态开始，按 block tree 的可解释顺序累加到 active block，并展示当前背景、角色、表情、站位、镜头、BGM、对话框和选项状态。动画类 block 未来还需要 before / after / playback 模式，但这属于后续 Snapshot 服务能力。

Scene 是最小状态累加边界。跨 Scene 的变量、flag、历史选择和持久状态通过 Scene 入口上下文进入；Scene 内部从开头累加到 active block。这个边界避免从项目开头无限回放，也让单个 Scene 可以被独立调试、审校和演出。

Preview Context 和 Preview 按钮旁的 Start using 覆盖，是让复杂状态可控的关键。Preview Context 不是项目默认值，也不是真实存档；它只是回答“如果以这些值进入当前 Scene，active block 之后是什么状态”。Start using 的 override 不应修改项目默认值。

## 已经存在

当前已经完成 StoryDocument + StoryService 阶段。后续 Story Editor 不应重新发明 story 存储，也不应把 story 降级成 panel-local state。

已经存在的技术事实包括：

- `StoryService` 已存在，可通过 `Services.Story` 获取。
- 多 story library model 已存在；`StoryDocument` 表示一个 story，不表示整个 project。
- 项目级 library index 位于 `editor/story/index.json`，每个 story 有独立 `editor/story/stories/{storyId}/storydoc.json`。
- `StoryDocument`、`StoryScene`、`StoryBlock`、`StoryTextSegment` 已存在于 `src/shared/types/story/`。
- `StoryScene.rootBlockIds` 保存根级 block 顺序，`StoryScene.blocks` 保存 block record，block 通过 `parentId` 与 `childrenIds` 表达树。
- `StoryBlock.kind` 当前分为 `nodeAction`、`action`、`control`、`jump`、`code`、`note`。
- `StoryNodeActionPayload` 当前包含 `narration`、`dialogue`、`choice`、`choiceOption`。
- `StoryActionPayload` 当前包含 `setBackground`、`character`、`audio`、`setVariable`、`wait`。
- `StoryControlPayload` 当前包含 `condition`、`conditionBranch`。
- `StoryTextSegment.textId` 是 CSV、配音、审校和后续批量生产的稳定身份，文本编辑必须保留它。
- `StoryService` 已提供 library、document、chapter、scene、block mutation API，并提供 `onLibraryChanged`、`onDocumentChanged`、`onDirtyChanged`。
- 所有 chapter、scene、block mutation 都带 `storyId`；任何 editor tab 都不能假设全局只有一个 story。
- `storyModel.canAcceptChildren()` 当前只允许 `control`、`nodeAction.choice`、`nodeAction.choiceOption` 接收 children。
- `jump` block 是 scene transition boundary，不允许 children。
- `storyModel.deleteBlockFromScene` 当前语义是删除 block subtree。
- 当前 Story panel 只是 outline / library entry。它能列出 stories、选择 story、查看 chapter / scene outline、创建 chapter / scene，但不是完整 scene editor。
- 下一阶段建议是 Story Scene Editor Foundation：从 Story panel 打开 scene editor tab，在 tab 中以 block 为单位查看和编辑 scene。

## 需要设计

Story Scene Editor 需要补的是编辑器体验与已有服务之间的连接层，而不是新的 story 数据模型。

Scene editor tab 应从 Story panel 的 scene 行打开。用户在某个 story 的某个 scene 上触发打开动作时，Story panel 不应把 scene 内容复制进本地状态，而应调用一个集中 helper，例如 `openStorySceneEditorTab`。tab payload 至少包含：

```ts
type StorySceneEditorTabPayload = {
    storyId: string;
    sceneId: string;
    activeBlockId?: string;
};
```

`activeBlockId` 可以先作为 editor-local 或 tab-session 状态存在，用于恢复当前光标位置和喂给未来 Snapshot。它不应写入 `StoryDocument`，除非后续明确设计“协作光标 / 上次编辑位置”这类 Studio metadata。

tab 打开后应通过 `StoryService` 读取 document，并订阅 `onDocumentChanged`。订阅逻辑必须按 `storyId` 过滤，只刷新当前 tab 对应 story 的 document。scene 被删除、story 被删除、或 document reload 后 scene 不存在时，tab 应进入可解释的 missing state，而不是保留旧 scene 快照继续编辑。

block 渲染必须从 `rootBlockIds` 开始，递归读取 `blocks[id].childrenIds`。缩进是 block tree 的展示结果，不是从文本空格猜出来的结构。renderer 可以先是轻量的 `StoryBlockTree` 和 `StoryBlockRow`，但它要从第一版就暴露 `kind`、payload action/control、text segment、children 状态和 diagnostics slot。

active block selection 需要显式模型。点击 row、进入 inline editor、键盘移动、拖拽目标预览，都应该能更新同一份 active block selection。这个 selection 是编辑器状态，不是 StoryService persistent state。StoryService 只负责保存 story document；selection、slash menu open state、临时输入草稿、折叠展开状态、inspector 当前 tab 等都属于 editor-local state，最多进入 workspace editor session。

active block 是未来 Active Snapshot 的入口。Scene editor 应能输出 `{ storyId, sceneId, activeBlockId }`，让未来 `StorySnapshotService` 在同一个 story document 上计算快照。没有 active block 时，Snapshot 可以显示 scene entry defaults 或空状态；但 editor 本身不应在缺 active block 时假装有累计状态。

## 关键操作约束

Enter 的语义是新增相邻 block。默认应在当前 active block 后插入同层 block；如果 active block 是可接收 children 的结构块，并且光标处于“进入子内容”的上下文，才插入为 child。空文本 block 可以先插入 narration 或 note，但必须创建合法 `StoryBlock`，而不是在 scene 上追加纯文本行。

Tab / Shift+Tab 的语义是调整 block 层级。任何层级变化都必须遵守 `canAcceptChildren` 规则：只有 `control`、`nodeAction.choice`、`nodeAction.choiceOption` 当前可以作为 parent。不能把 block 缩进到 `jump`、普通 dialogue、background action、code 或 note 下。非法缩进应禁用、回退到合法目标，或给出轻量提示。

拖拽排序必须通过 `StoryService.moveBlock(storyId, sceneId, blockId, target)`。拖拽 UI 可以自由计算 hover target，但最终提交必须是 `{ parentId, beforeBlockId }` 形式的 block tree mutation。不能在 UI 里直接改 `rootBlockIds` 或 `childrenIds`。

文本编辑必须通过 `StoryService.updateBlock`。更新 narration、dialogue、choice prompt、choice option、note 时，要只替换 `StoryTextSegment.value`，保留原 `textId`。如果创建新文本 segment，才生成新的 `textId`。

删除 block 应删除 subtree，符合当前 `storyModel.deleteBlockFromScene` 语义。UI 删除前应让用户能理解会删除 children，尤其是 choice、choiceOption、condition、conditionBranch 这类结构块。删除后 active block 应移动到相邻可见 block 或 parent，不能指向已删除 id。

choice、choiceOption、condition branch 的缩进要保护结构。choice 的 children 应主要是 choiceOption；choiceOption 的 children 是该选项被选择后的剧情内容；condition 的 children 应主要是 conditionBranch；conditionBranch 的 children 是该分支成立后的剧情内容。当前模型只在 `canAcceptChildren` 层面做通用约束，editor UI 需要在插入和拖拽时提供更语义化的保护。

jump block 不能有 children。jump 表示当前 Scene 的 transition boundary，编辑器应把它显示成叶子 block。Tab、拖拽、slash 插入都不能把其他 block 放进 jump 下。

code block 是 advanced escape hatch。它可以折叠，应可显示诊断，应在常规写作视图中弱化处理，不应成为背景、角色、选择、条件等常规 VN 行为的默认入口。

note block 是 Studio-only。它可以参与编辑器批注、审校和团队沟通，但不应进入 runtime 语义，也不应影响 Active Snapshot 的状态累加。

## Slash Command

slash command 是普通用户插入结构化 block 的主入口。它不应被隐藏进复杂 property panel；property panel 或 inspector 只是补充引用选择、高级字段和诊断信息。

slash menu 打开时应读取当前 active block、当前 selection、当前 parent context 和可见 block tree，推断插入位置。最常见语义是在 active block 后插入同层 block；如果当前处于 choice 或 condition 的结构上下文内，菜单可以优先推荐合法 child，例如在 choice 下推荐 choice option，在 condition 下推荐 condition branch。非法插入不能静默创建错误结构：可以禁用命令、降级为同层插入、自动创建必要 wrapper，或提示需要先选中合法 parent。

最低 command 覆盖如下：

| Command | StoryBlock 映射 | 插入后编辑焦点 |
| --- | --- | --- |
| narration | `kind: "nodeAction"`, `payload.action: "narration"` | 进入 inline text edit |
| dialogue | `kind: "nodeAction"`, `payload.action: "dialogue"` | 进入 inline text edit，角色可用 picker 补充 |
| choice | `kind: "nodeAction"`, `payload.action: "choice"` | 若有 prompt，进入 inline prompt edit；否则打开轻量 inspector |
| choice option | `kind: "nodeAction"`, `payload.action: "choiceOption"` | 进入 inline option text edit |
| condition | `kind: "control"`, `payload.control: "condition"` | 打开 condition inspector，并建议创建 branch |
| condition branch | `kind: "control"`, `payload.control: "conditionBranch"` | 打开 condition inspector 或 branch picker |
| background | `kind: "action"`, `payload.action: "setBackground"` | 打开 asset picker |
| character enter | `kind: "action"`, `payload.action: "character"`, `operation: "enter"` | 打开 character picker / transform inspector |
| character move | `kind: "action"`, `payload.action: "character"`, `operation: "move"` | 打开 transform inspector |
| character exit | `kind: "action"`, `payload.action: "character"`, `operation: "exit"` | 打开 character picker |
| character expression | `kind: "action"`, `payload.action: "character"`, `operation: "expression"` | 打开 character / asset picker |
| bgm | `kind: "action"`, `payload.action: "audio"`, `operation: "setBgm"` | 打开 audio picker |
| sound | `kind: "action"`, `payload.action: "audio"`, `operation: "playSound"` | 打开 audio picker |
| set variable | `kind: "action"`, `payload.action: "setVariable"` | 打开 variable/value editor |
| jump scene | `kind: "jump"` | 打开 scene target picker |
| wait | `kind: "action"`, `payload.action: "wait"` | 进入 lightweight duration / click control |
| note | `kind: "note"` | 进入 inline text edit |
| code block | `kind: "code"` | 进入 folded-aware code editor 或 inspector |

choice option 的合法 parent 默认应是 choice；condition branch 的合法 parent 默认应是 condition。若用户在普通 dialogue 后输入 `/choice option`，编辑器不应创建悬空 option。可选行为是禁用该命令、提示先创建 choice，或把它降级为普通 narration。若用户在 choice 内输入普通 narration，插入位置应位于当前 option 下，而不是 choice 直接 children 下，除非这是明确允许的结构。

command 插入后的焦点应服务写作主路径：文本类 block 进入 inline edit；资源、角色、变量、scene target 等引用进入轻量 picker；高级字段、transition、duration、condition expression、code language 等进入 block inspector。不要让用户为了写一行普通台词先打开大型 property panel。

## Block Inspector

Block inspector 是轻量属性编辑，不是常规写作的主路径。

普通文本优先 inline editing。narration、dialogue text、choice prompt、choice option text、note text 都应能在 block row 内直接编辑，并通过 `StoryService.updateBlock` 保留 `textId`。

引用类字段使用轻量 picker。背景 asset、角色 id、角色立绘或 expression asset、BGM、sound、变量 ref、jump target scene 等字段，应从现有 project 数据中选择 id/ref。显示名只是派生信息，不应成为主要存储依据。

高级字段可以在 inspector 中展开。transition、duration、easing、transform props、hiddenWhen、disabledWhen、condition expression、code language、code source、advanced/folded 状态等字段不应挤占普通 block row。inspector 可以提供诊断和快速修复入口，但不能把 slash command 的主入口替代掉。

## Active Snapshot 边界

本阶段不实现 Active Stage Snapshot，但 Scene editor 要为它留下清晰接口。

Scene editor 应输出 active block id。未来 `StorySnapshotService` 的输入至少应包含：

```ts
type StorySnapshotInput = {
    storyId: string;
    sceneId: string;
    activeBlockId?: string;
    previewContext: StoryPreviewContext;
};
```

Snapshot 默认语义是 active block 的 after state。动画和演出类 block 未来需要 before / after / playback，因为舞台动作通常要检查起点、终点和播放效果。

舞台拖拽回写不能直接修改累计 snapshot。拖动角色、调整表情、移动镜头、改变透明度或 motion preset 时，写入目标必须是当前 block，或创建一个新的 action block。若 active block 是 dialogue，而拖拽实际表达的是角色移动，UI 应提示创建 character move block；若 active block 已是 character move，则可以更新该 block payload。

Snapshot 计算应能解释状态来源：scene entry defaults、Preview Context override、已应用 block、当前分支路径、随机结果和被跳过 block。解释面板可以折叠，但不能缺失。

## Preview Context 边界

本阶段不实现 Preview Context，但 Scene editor 不应阻塞它接入。

Preview Context 至少要预留这些输入来源：

- scene entry defaults：当前 Scene 入口变量、flag、局部默认值。
- global variable defaults：`studioGlobals` 与 `gamePersistents` 的默认定义。
- Start using overrides：只影响当前预览入口，不等于修改项目默认值。
- choice trace：active block 所在路径能推出的 choice 选择，以及用户手动覆盖的选择。
- random fixed seed/result：影响预览的随机应固定成可复现种子或可见结果。
- unknown condition prompts：条件依赖外部或未知状态时，Preview Context 应提示用户选择或覆盖，而不是猜。

override 和项目默认值必须分开。用户通过 Start using 把 `has_key` 临时设为 true，只说明“这次预览从 true 开始”，不应改写 `StoryDocument.studioGlobals`、`gamePersistents` 或 scene local defaults。

## Diagnostics / Flow Map / Localization 预留

Diagnostics 不应只在 Snapshot 阶段才出现。StoryBlockRow、StoryBlockInspector、StoryBlockTree 都应保留 diagnostics slot，未来可显示：

- missing resource
- invalid character
- invalid variable
- jump target missing
- unreachable branch
- condition unknown
- code block error
- Snapshot 与 runtime 语义可能不一致

Flow Map 应从 `StoryDocument` 自动生成，不要求用户手动画节点。choice、condition、jump、entry scene、scene chapter ordering 都是 Flow Map 的输入。用户可以查看和诊断 flow，但不应被迫在图上维护第二份 story 真相。

Localization 依赖稳定 `textId`。narration、dialogue、choice prompt、choice option、note 等可文本化内容都应使用 `StoryTextSegment`。CSV、voice、review、批量替换和审校状态都应绑定 `textId`，而不是绑定可变行号或纯文本内容。

## 暂不实现

本文讨论的是接入边界，不要求下一位 agent 同时实现完整 Story Editor。以下内容可以保留设计接口，但不应混进 Story Scene Editor Foundation 的最小落地：

- Active Stage Snapshot 的完整状态推导。
- StorySnapshotService。
- Preview Context 面板与 Start using 持久覆盖。
- Dev Mode story runtime execution。
- Story to `narraleaf-react` TypeScript generation。
- Flow Map 可视化。
- localization CSV workflow。
- story diagnostics panel 的完整规则集。
- import/export implementation。
- undo/redo stack。
- 稳定 editor tab/session restore 的完整扩展。

## 下一位 agent 的接入点

| 接入点 | 设计意图 |
| --- | --- |
| `StorySceneEditorTab` | 承载 scene editor tab，payload 至少包含 `storyId` / `sceneId`，通过 StoryService 获取 document。 |
| `openStorySceneEditorTab` helper | 从 Story panel scene 行打开或聚焦 tab，避免 panel 自己拼装重复 tab 逻辑。 |
| `StoryBlockTree` renderer | 从 `rootBlockIds` / `blocks` 渲染 block tree，不从纯文本缩进推断结构。 |
| `StoryBlockRow` | 展示并编辑单个 block，暴露 kind、payload action/control、text、selection、diagnostics slot。 |
| `StorySlashCommandMenu` | 普通用户插入结构化 block 的主入口，负责合法插入位置推断和非法命令降级。 |
| `StoryBlockInspector` | 轻量属性编辑，处理 picker、高级字段和 diagnostics，不替代 inline writing。 |
| active block selection model | 保存 editor-local active block，为 Snapshot 输入 `{ storyId, sceneId, activeBlockId }` 打基础。 |
| tests for editor-facing storyModel behavior | 覆盖 textId 保留、delete subtree、moveBlock 合法性、jump leaf、canAcceptChildren 相关编辑器行为。 |

当前最重要的边界是：Story Editor 要消费现有 `StoryService` 和 shared story types，保留多 story 语义，把 block tree 作为内部真相；纯文本只是呈现、导入或导出的形式，不是 Studio 内部唯一真相。
