# NarraLeaf Studio - Story Service Handoff

本文是 StoryDocument + StoryService 阶段完成后的唯一交接文档。它整合了早期计划与实际实现结果，后续 agent 应以本文为准；`story-stage-editor-concept.md` 仍作为产品方向参考。

本文不提供完整施工步骤，而是说明已经确定的数据结构、服务边界、当前能力、保留约束，以及下一部分应该从哪里接入。

## 当前状态

第一阶段 StoryDocument + StoryService 已完成。当前项目已经不再是“Story 只有 placeholder”的状态。

| 领域 | 当前结果 |
| --- | --- |
| Story shared types | 已添加 `src/shared/types/story/`，包含 Story library、story document、chapter、scene、block、变量、条件、转场和导入导出能力类型。 |
| Workspace service | 已添加正式 `StoryService`，可通过 `Services.Story` 获取。 |
| Storage model | 已建立多 story library index 与 per-story document 文件结构。 |
| Story panel | 已替换旧 placeholder，`src/renderer/apps/workspace/modules/story/` 现在消费 `StoryService`。 |
| Dev Mode type | `DevModeBundle` 已预留 `story?: StoryDocument` 字段，但当前 bundle assembly 尚未实际加载 story。 |
| Tests | 已添加 `storyModel.test.ts` 覆盖核心模型行为。 |
| Verification | 实现者记录 `yarn test` 和 `yarn lint` 已通过。 |

## 关键文件

| 文件 | 作用 |
| --- | --- |
| `src/shared/types/story/document.ts` | Story 类型定义的主文件。 |
| `src/shared/types/story/index.ts` | Story shared types 汇总导出。 |
| `src/renderer/lib/workspace/services/story/StoryService.ts` | Workspace Story 服务实现。 |
| `src/renderer/lib/workspace/services/story/storyModel.ts` | Story model helper、normalization、block tree mutation。 |
| `src/renderer/lib/workspace/services/story/storyModel.test.ts` | 核心模型测试。 |
| `src/renderer/apps/workspace/modules/story/StoryPanel.tsx` | 当前 Story panel UI。 |
| `src/renderer/apps/workspace/modules/story/index.tsx` | Story panel module 注册入口。 |
| `src/renderer/lib/workspace/services/services.ts` | `Services.Story` 与 `IStoryService` 接口。 |
| `src/renderer/lib/workspace/services/serviceRegistry.ts` | `StoryService` 注册。 |
| `src/renderer/lib/workspace/project/nameConvention.ts` | Story 文件路径约定。 |
| `src/shared/types/devMode.ts` | `DevModeBundle.story?: StoryDocument` 预留字段。 |

## Storage Model

Story data 是 editor core data，不是 asset metadata，也不是 panel-local state。

项目级 story library index:

```text
editor/story/index.json
```

每个 story 独立文档:

```text
editor/story/stories/{storyId}/storydoc.json
```

已新增路径约定：

- `ProjectNameConvention.EditorStory`
- `ProjectNameConvention.EditorStoryIndex`
- `ProjectNameConvention.EditorStoryDocument(storyId)`

Story library index 包含：

- `schemaVersion`
- `stories`
- optional `defaultStoryId`
- optional `meta`

每个 `StoryLibraryEntry` 包含：

- `id`
- `name`
- `documentPath`
- `createdAt`
- `updatedAt`
- optional `importSource`
- optional `exportMeta`

`defaultStoryId` 只是 Studio convenience setting。Runtime launch 后续仍应允许通过 UI、Blueprint 或 future API 显式选择 story，不应被默认 story 绑定死。

## Story Document Shape

`StoryDocument` 表示一个 story，而不是整个 project。项目可以有多个 story。

`StoryDocument` 当前包含：

- `schemaVersion`
- `id`
- `name`
- optional `entrySceneId`
- `chapters`
- `scenes`
- optional `studioGlobals`
- optional `gamePersistents`
- optional `meta`

Scene 是最小状态重放边界。Blocks 存在于 scene 内：

- `StoryScene.rootBlockIds` 存根级 block 顺序。
- `StoryScene.blocks` 是 `Record<StoryBlockId, StoryBlock>`。
- block 通过 `parentId` 和 `childrenIds` 表达树结构。

后续 agent 不应把 story 改回单 story project 模型，也不应把 block 存成纯 flat script line list。

## Block Model

当前 `StoryBlock.kind` 使用 layered roles，而不是直接用一组扁平 runtime commands。

| kind | 用途 |
| --- | --- |
| `nodeAction` | 用户可见的剧情节点，例如 narration、dialogue、choice、choice option。 |
| `action` | 状态改变操作，例如背景、角色操作、音频、变量写入、等待。 |
| `control` | 流程结构，例如 condition、condition branch。 |
| `jump` | Scene transition boundary。 |
| `code` | 高级 escape hatch。 |
| `note` | Studio-only note。 |

这个分层是重要设计决策。它的目的是让 Story Document Editor、Active Snapshot、Flow Map、Localization、后续 NarraLeaf React 映射不要各自发明 block 语义。

### Node Action Payloads

`StoryNodeActionPayload` 当前包括：

- `narration`
- `dialogue`
- `choice`
- `choiceOption`

可翻译文本用 `StoryTextSegment` 表示：

- `textId`
- `value`
- `role`

`textId` 是稳定身份，用于 CSV、配音、审校状态和后续批量生产流程。更新文本内容时不应替换已有 `textId`。

### Action Payloads

`StoryActionPayload` 当前包括：

- `setBackground`
- `character`
- `audio`
- `setVariable`
- `wait`

角色、资源、变量等引用应尽量使用 id/ref，不应把可变显示名当作主要存储依据。

### Control / Jump / Code / Note

已确定的约束：

- `control` 可承载条件结构。
- `jump` 是 scene transition boundary，不允许拥有 children。
- `code` 是高级逃生舱，不能成为普通 VN 行为的主路径。
- `note` 是 Studio-only，不应被当作 runtime command。

`storyModel.canAcceptChildren()` 当前只允许：

- `control`
- `nodeAction.choice`
- `nodeAction.choiceOption`

后续扩展 block nesting 时必须先确认这条规则是否仍成立，并补测试。

## Variables And Conditions

当前变量定义保留了三个 scope：

- `studioGlobal`
- `gamePersistent`
- `sceneLocal`

当前 value type：

- `boolean`
- `number`
- `string`
- `json`

`StoryVariableRef` 使用：

- `scope`
- optional `namespace`
- `key`

`StoryConditionRef` 当前有两类：

- `variable`
- `expression`

Preview Context 后续会依赖这些结构判断条件是否已知、是否需要 override、是否来自 scene entry state。

## StoryService API

`IStoryService` 已包含以下能力。

Library APIs:

- `listStories`
- `getStoryEntry`
- `getDefaultStoryId`
- `setDefaultStory`
- `createStory`
- `renameStory`
- `deleteStory`

Document APIs:

- `loadLibrary`
- `getLibraryIndex`
- `loadStory`
- `getStoryDocument`
- `saveStory`
- `reloadStory`

Mutation APIs:

- chapter create / rename / delete / move
- scene create / rename / delete / move / set entry
- block insert / update / delete / move

Events:

- `onLibraryChanged`
- `onDocumentChanged`
- `onDirtyChanged`

Import/export capability APIs:

- `canImportStoryPackage`
- `canExportStoryPackage`

当前 import/export capability 返回 `false`，没有 placeholder importer/exporter 逻辑。

所有 chapter、scene、block mutation 都带 `storyId`。这是多 story 模型的一部分，后续 UI 或 editor tab 不应假设全局只有当前唯一 story。

## Current Story Panel

`src/renderer/apps/workspace/modules/story/StoryPanel.tsx` 当前支持：

- 列出 stories
- 创建 story
- 重命名 story
- 删除 story
- 设置或清除 default story
- 选择 story
- 查看 chapter / scene outline
- 创建 chapter
- 创建 scene

当前未支持：

- 完整 story scene editor tab
- 富文本块编辑器
- slash command menu
- block-level drag / indent / fold
- Active Stage Snapshot
- Preview Context
- Flow Map
- import/export UI
- runtime preview

Story panel 当前只是可用的 outline / library entry，不是主编辑器。

## Model Helpers And Tests

`storyModel.ts` 已承担这些纯模型职责：

- create empty library
- create empty story document
- create library entry
- normalize story library index
- normalize story document
- create chapter
- create scene
- insert block
- update block payload
- delete block subtree
- move block
- preserve text ids
- reject unsupported schema
- reject illegal jump children

`storyModel.test.ts` 已覆盖：

- 空 library 创建时不强制生成 story document。
- 多 story 使用独立 document path。
- future schema rejection。
- block tree insert / move / delete 合法性。
- 更新文本时保留 stable text id。
- jump block 不允许 children。

后续 agent 修改 story model 时，应优先补这些测试，而不是只改 UI。

## Relationship To Existing Systems

| 系统 | 当前关系 |
| --- | --- |
| UI Editor | Story block 可以后续引用 stage surface、dialog surface、choice surface，但不应内嵌 UI element tree。 |
| Character | dialogue / character action 应引用 character id，显示名应是派生信息。 |
| Assets | 背景、BGM、音效、语音、立绘等应引用 asset id。 |
| Blueprint | 复杂逻辑可后续通过 code block 或 bridge 接入，但普通剧情行为不应被强制转换成 blueprint graph。 |
| Dev Mode | `DevModeBundle.story?: StoryDocument` 已预留；bundle assembler 尚未加载 story document。 |
| Localization | `StoryTextSegment.textId` 是后续 CSV、配音、审校的基础。 |
| Diagnostics | 当前只做模型级约束；缺资源、无效变量、跳转不存在等静态诊断尚未落地。 |

## Deferred Work

以下内容是有意 deferred，不应被误认为已经完成：

- Story to `narraleaf-react` TypeScript generation
- Dev Mode story runtime execution
- Story package import/export implementation
- full Story Document Editor
- Active Stage Snapshot
- Preview Context
- Flow Map
- localization CSV workflow
- undo/redo stack
- story diagnostics panel
- stable editor tab/session restore for story scene editors

Future work should build on `StoryService` and shared story types rather than introducing panel-local story state.

## Next Part Instruction: Story Scene Editor Foundation

下一部分建议接入“Story Scene Editor foundation”，目标是让用户能从 Story panel 打开一个 scene editor tab，并在该 tab 中以 block 为单位查看和编辑 scene。这里仍不是完整 WordPress / Monaco 混合编辑器，而是给后续富文本体验、Active Snapshot 和 Preview Context 打基础。

### Intended Outcome

| Outcome | Meaning |
| --- | --- |
| Scene editor tab exists | 从 Story panel 的 scene 行打开 editor tab，tab payload 至少包含 `storyId` 和 `sceneId`。 |
| Editor uses `StoryService` | tab 不直接读写 JSON，不维护独立 story state。 |
| Blocks are visible | scene 的 `rootBlockIds` / `blocks` 可以被渲染成可扫描的 block list/tree。 |
| Basic text edits are possible | narration、dialogue、choice prompt、choice option、note 等文本可编辑，并通过 `updateBlock` 保留 `textId`。 |
| Basic block insertion exists | 至少能插入 narration/dialogue/note，后续再扩展 slash command menu。 |
| Selection model is explicit | editor 能记录 active block，为后续 Active Snapshot 提供入口。 |

### Attach Points

| Area | Suggested attachment |
| --- | --- |
| module | `src/renderer/apps/workspace/modules/story/` |
| editor component | `StorySceneEditorTab.tsx` or equivalent under story module |
| open helper | helper similar to existing asset/surface tab open helpers |
| session restore | later extend `workspaceEditorSession.ts`; can be deferred if tab support starts local-only |
| service access | `context.services.get<StoryService>(Services.Story)` |
| types | use `StoryDocument`, `StoryScene`, `StoryBlock`, `StoryTextSegment` from `@shared/types/story` |

### Boundaries For The Next Agent

Do:

- Use existing `StoryService` API.
- Preserve multi-story semantics.
- Preserve `StoryTextSegment.textId` during text edits.
- Treat block tree as the editor truth.
- Keep the first editor minimal but structurally compatible with future rich editing.
- Add focused tests when changing `storyModel.ts` or service mutation behavior.

Do not:

- Replace `StoryService` with component-local state.
- Revert to a single-story project assumption.
- Store scene text as one plain text blob.
- Build Active Snapshot before active block selection and block rendering are stable.
- Implement import/export or Dev Mode runtime as part of the editor foundation unless explicitly requested.

### Design Notes For The Editor

- A block row should expose its `kind` and payload action/control enough for debugging.
- Nesting should follow `parentId` and `childrenIds`, not indentation guessed from text.
- Editing text should call `StoryService.updateBlock`; do not regenerate the whole block unless necessary.
- Inserting a block should create a proper `StoryBlock` with stable `id` and any required `textId`.
- Jump blocks should remain leaf blocks.
- Code blocks should be visibly advanced / escape-hatch oriented if shown.
- Active block state can live in editor UI initially, but it should be easy to feed into a future `StorySnapshotService`.

### Suggested Completion Signals

The next phase is ready to hand off when:

- Story panel can open a scene editor tab.
- The tab survives story document updates through service events.
- The tab can render existing root and nested blocks.
- At least narration/note text can be edited without changing `textId`.
- At least one simple block type can be inserted through the service.
- No existing story model tests regress.

## Product Principles To Preserve

- StoryDocument is Studio's internal story truth; plain text is import/export or presentation, not the only source of truth.
- Scene is the minimum state replay boundary.
- Routine VN behavior should use structured blocks; code blocks are escape hatches.
- Stable text identity is required for localization, voice, and review workflows.
- Story UI should consume the workspace service layer, not create a parallel architecture.
