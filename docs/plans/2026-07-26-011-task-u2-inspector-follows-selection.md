---
title: "task: U2 检查器 — 右栏跟随选中，消灭空态文案"
type: task
status: ready
date: 2026-07-26
plan: 2026-07-26-004-plan-ui-professionalization.md
branch: feat/ui-u2-inspector-follows-selection
---

# task: U2 检查器

总计划 `2026-07-26-004` §U2。这张卡直接治用户最早点出的那句话：**右栏 600px 恒空**。

## 0. 分支与纪律

- 从 `develop`（**`7f50bcd7`**）切 `feat/ui-u2-inspector-follows-selection`。
- 逐文件 `git add`，**禁止 `git add -A`**。每个 WI 完成即 commit。不合并、不 push。
- 禁止 `git worktree remove`、禁止 `git stash`。
- 提交前先 `git branch --show-current`，确认没落到别人的分支上。
- 提交前确认没推高 CI 的 style ratchet。`yarn lint` 只跑 tsc，"lint 绿"不等于没问题。

### 0.1 共享检出：开卡时的外来未提交文件（**必须做隔离树审计**）

开卡时 `git status` 有 4 个不属于本卡的未提交改动：

```
 M docs/plans/2026-07-23-006-task-mobile-encryption-rollout.md
 M src/renderer/apps/launcher/tabs/PluginDetailsModal.tsx
 M src/renderer/apps/launcher/tabs/ProjectsTab.tsx
 M src/renderer/lib/components/elements/Modal.tsx
```

它们都在 launcher / 通用 Modal 上，不在本卡的量测路径（故事场景编辑器 + 右栏）上，所以
orchestrator 的改前基线不受污染。**但你的代码可能会不知不觉适配它们**——U1 就是这么栽的：
执行者把提交的代码适配到了当时只存在于未提交改动里的 `.nl-dock-divider`，合进 develop 后
分隔条没有宽度，而 lint、测试、截图**全部通过**。

所以本卡**必须**做隔离树审计，并在报告里给**过程**而不只是结论：

1. `git archive HEAD | tar -x -C <隔离树>`（`node_modules` 用 junction 链过去）；
2. 在那棵**不含任何未提交改动**的树上跑 `yarn lint` + `yarn build:apps:dev`；
3. 报告里贴命令、退出码、以及隔离树的 `git status`（应为空）。

`Modal.tsx` 是通用组件——如果你的实现引用到它，请在报告里显式说明你在隔离树上验证过。

## 1. 风格铁律

- 复用既有组件（`PropertyEditor` 框架、`ActionInspector`、既有 field 类型）。**不新增依赖**。
- **UI 里不要解释性文本。** 这张卡的一半工作就是删文案，不要一边删一边加。
- 不加 chip / 徽章 / 图例 / 空态插画。不要 `title` 原生 tooltip。
- 想加"提示告诉用户可以点一行看属性"时，答案是**不加**。

## 2. 为什么这张卡存在（orchestrator 亲测，别当背景读，这是验收的锚）

### 2.1 改前基线

develop `7f50bcd7`，全新实例，demo3 `First Day`（12 行），视口 1400×902 @dpr 1.25，
**壁纸开启**（`ui.backgroundImage` 在，blur 4 / opacity 9），`editor.surfaceOpacity` **100**。
证据图在 `docs/plans/reports/assets/2026-07-26-U2-before-*.png`。

| # | 事实 | 实测 |
|---|---|---|
| B1 | 右栏几何 | **463 × 838 = 388,179 CSS px²**；同屏编辑器行宽只有 **486px**——恒空面板几乎和正文一样宽 |
| B2 | 无选中时右栏全部内容 | 12 个词：`Properties / Properties / No item selected / Select an item to view its properties`，其中空态块本身 460×196 |
| B3 | **单击行完全不动右栏** | 依次单击第 2 / 9 / 12 / 5 行，行确实进入选中态（`bg-primary/20`），右栏文本**逐字节不变，4/4** |
| B4 | Inspector 只能双击打开 | 双击第 2 行 → `Inspector / Character / Enter Nattou`；双击第 12 行 → `Inspector / Background / Set background 4b645b59-1723-4ac9-98ab-e6859b837bef` |
| B5 | 打开后不跟随选中 | Inspector 开着时单击别的行，面板仍显示**上一行**——比空着更糟，它是**错的** |
| B6 | Escape 关不掉 | 连按两次 Escape，右栏仍是 Inspector |
| B7 | **右栏会跳到无关面板** | 先单击一个对白行（留下光标），再双击命令行 → 右栏**确定性地**变成 `Story Variables`。可复现，非偶发 |
| B8 | 手动切走后回不来 | 把右栏切到 Properties 后再双击**同一行**，Inspector 不再出现（`shownInspectorBlockRef` 记着它"已展示过"）——必须先点别的行 |
| B9 | 两个面板的表面不一致 | `StoryInspectorPanel` 挂了 `.nl-editor-surface` → `rgb(11,13,18)` 不透明；**`PropertiesPanel` 没挂**，computed `rgba(0,0,0,0)`，壁纸直接透到属性区 |

B5–B8 的根因是同一处：面板可见性由 `editorMode.kind === "inspector"` 驱动，
配 `panels.show/hide` 手动显隐（`StorySceneEditorTab.tsx:892-997`），而**选中**（`activeBlockId`）
根本没接进右栏。

### 2.2 现成的料

不是从零做检查器。`ActionInspector`（`StorySceneActionInspector.tsx:412`）已经是纯 props 组件，
内容也够好（角色下拉、形象、Transform、Motion）。缺的只有一件事：**把它接到选中上**。

## 3. 用户裁决（2026-07-26，不要重新讨论）

1. **Properties 吞掉 Inspector。** 右栏只留**一个** Properties 面板；选中故事行时它渲染
   `ActionInspector`，选中资产/角色/UI 元素时渲染现有编辑器。**删掉独立的 story-inspector 面板注册
   与那套 `panels.show/hide` 显隐机械**——B6 / B7 / B8 都是它带出来的。导轨上少一个图标。
2. **无选中时显示场景级属性**，不是收起、也不是空白。面板永远有内容，也就不需要"收起/展开"这个额外状态。

## 4. 工作项

### WI-1 选中驱动右栏（最高优先，先做）

- 给 `SelectionState`（`UIStore.ts:35`）加一个故事行成员（建议 `storyBlock`），照
  `storyMotionKeyframe` 的先例：字面量 + `isXxxSelectionData` 类型守卫放在 story 模块里。
- 场景编辑器在 `activeBlockId` 变化时 `setSelection`；清空选中时清成场景级（见 WI-3）。
- `PropertiesPanel` 分派到 `ActionInspector`。
- **⚠️ 加成员不会产生任何编译错误**——全 app 没有一处 `switch`，全是 `if`/三元。所以必须手工过这些点：
  - `PropertiesPanel.tsx:652-669`（分派）、`:630-645`（标题/副标题）、`:967-1011`（渲染）
  - `framework/types.ts:420` 的 `SelectionType` **已经和 `UIStore` 脱节**（缺 `storyMotionKeyframe`），
    `usePropertyEditor.tsx:195` 靠 cast 绕过去。你要么补齐要么别踩它，**但要在报告里说清楚你选了哪条**。
- 编辑回调（`onUpdatePayload` / `onSetDialogueCharacter` / `onCreateLayer` / `generateTextId`）
  今天走 `storyInspectorBridge`。**桥可以留作传输层**，但它不能再控制面板显隐。

### WI-2 退役独立 Inspector 面板

- 删 `STORY_INSPECTOR_PANEL_ID` 的注册与显隐（`StorySceneEditorTab.tsx:892-918`、`938-997` 的
  `panels.show/hide` 部分）、`StoryInspectorPanel.tsx`。
- **Enter / 双击的既有语义保留**：仍然进入编辑/聚焦检查器。它们只是不再负责"让面板出现"——
  面板本来就在，因为选中就在。
- `closeInspector` / Escape 之后右栏**不得**落到无关面板（B7）。

### WI-3 场景级属性（无行选中时）

- 用 `PropertyEditor` 框架写 `storyScenePropertySchema(t)`，context 形如
  `{ storyId, sceneId, scene, storyService }`，照 `characterSchema.ts:42` 的 getter/setter 风格。
- 字段限定在**文档里真实存在**的（`StoryScene`，`document.ts:95`；写侧 `StorySceneUpdate`，`document.ts:123`）：
  场景名、描述、默认背景。**不要发明字段**，也不要为此扩 schema（总计划 §4：本轮不改故事 schema）。
- 写路径必须复用 `editor.updateSceneMetadata`（`useStorySceneEditorController.ts:690`）
  → `storyService.updateScene`，**撤销要是一步**。不许另起一条写路径。
- 场景头卡片 `StorySceneOverviewBlock`（`StorySceneEditorTab.tsx:144`）编辑的是同三个字段。
  两处并存可以，但**不能各写各的**——同一个 commit 路径。

### WI-4 消灭空态文案

- 删 `properties.panel.noSelection` / `noSelectionHint`（en `properties.ts:12-13`、zh `properties.ts:13-14`）
  以及渲染点 `PropertiesPanel.tsx:989-999`。
- 没有故事场景在前台、又什么都没选（例如 Dashboard 标签页）时：**一块干净的表面，零文案**——
  照 `StoryInspectorPanel.tsx:14` 已有的空态惯例。
- i18n 的 en/zh key 集合一致性测试必须保持绿。

### WI-5 表面不透明（**做不到这条，这张卡就是把 Inspector 从不透明改回透明**）

- 右栏承载故事内容的表面必须挂 `.nl-editor-surface`（今天只有 `StoryInspectorPanel` 挂了，
  `PropertiesPanel` 没挂，见 B9）。
- 必须**跟随 `editor.surfaceOpacity` 这个旋钮**，不许写死颜色：100 时 alpha == 1，0 时 alpha == 0。

### WI-6 面板标题不得出现裸 id

- B4 里 `Set background 4b645b59-1723-4ac9-98ab-e6859b837bef` 是裸 uuid。右栏的标题/主语行
  不得包含裸 id。**仅限标题行**——`Stage name` 这类内部词汇、以及其余 C5 清扫归 U5，本卡不动。

## 5. 硬约束（踩了就是退回）

- **不改故事文档 schema**，不改编译器。
- **不动 `editor.surfaceOpacity`** 的取值与语义（U0.1 刚落）。
- 不重做 `ActionInspector` 的内容与字段布局。本卡是**接线**，不是重画。
- 行的既有机械一律不变：选择/多选/拖拽/右键菜单/播放头高亮/Enter/双击。
- **不许写 assert / scenario / 通过判定。** 判据在 §6，由 orchestrator 亲验。
  报告里给你的自验结果可以，但那不是验收。
- 选中一行**不得修改文档**。（提醒：在对白行上按 Enter 会提交编辑并插入新行——
  orchestrator 的基线脚本踩过，别在自验里把 demo3 改脏。）

## 6. 判据（orchestrator 亲验，全部在**壁纸开启**态下，demo3 `First Day`）

驱动路径：启动器 → Demo → `First Day` 标签页 → 关掉浮动 Live Preview 与底部 Console →
行列表滚到顶 → 右栏选到 Properties。每条断言前先过两道 setup guard：
**12 行全部 `elementFromPoint` 可达**、**右栏标题 == 期望面板**。

| # | 判据 | 量 |
|---|---|---|
| A | **跟随选中** | 逐行单击 1…12，右栏主语行必须指向**被点的那一行**，**12/12**。改前 0/12 |
| B | **即时** | 单击后 ≤120ms 内右栏已是该行内容（不靠额外等待） |
| C | **不发霉** | 打开 A 行后单击 B 行，右栏显示 **B**。改前显示 A |
| D | **不跳无关面板** | 复现 B7（先单击对白行留光标，再双击命令行）后，右栏标题仍是 `Properties`。改前是 `Story Variables` |
| E | **回得来** | 手动把右栏切走再切回，选中行的检查器仍在（B8 不再成立） |
| F | **空态归零** | 无选中时右栏显示场景级属性且含场景名 `First Day`；全 app DOM 里 `No item selected` 与 `Select an item to view its properties` 出现 **0 次**；两个 i18n key 在 en/zh 里都不存在，parity 测试绿 |
| G | **表面不透明** | 右栏故事内容表面 computed `backgroundColor` alpha == **1**（`surfaceOpacity` 100，壁纸开），且把 `surfaceOpacity` 调到 0 时 alpha == 0（证明它跟旋钮而不是写死） |
| H | **无裸 id** | 右栏标题/主语行不匹配 `/[0-9a-f]{8}-[0-9a-f]{4}-/` |
| I | **不改文档** | 整轮驱动结束后 12 行文本指纹与开始时**逐字节相同** |
| J | **撤销一步** | 从右栏改场景描述 → 一次 Ctrl+Z 恢复原值，且场景头卡片同步 |
| K | **既有语义不变** | 双击/Enter 仍进入编辑；选中/多选标记与改前一致 |

要截的图（orchestrator 自己截、自己读）：
`无选中(场景属性)` / `单击第 2 行` / `单击第 12 行` / `B7 复现路径之后` / `surfaceOpacity 0 与 100 各一张`。

**目视 + 断言双绿才合并。** "测试全绿"不构成通过。

## 7. 自验（报告里逐项给结果，这不是验收）

1. `yarn lint`（tsc）——绿。
2. `yarn test` 相关范围——win32 基线 8–9 个失败不是回归，**但要列出你看到的失败清单**以便对齐。
3. i18n en/zh parity 测试——绿。
4. **隔离树审计**（§0.1）——贴命令、退出码、隔离树 `git status`。
5. 真机自测：你自己拉一个实例走一遍 §6 的驱动路径，说明你看到了什么。
   **测完把 demo3 恢复原状**（12 行、`editor.surfaceOpacity` 100、右栏选回 Properties）。

## 8. 报告

`docs/plans/reports/2026-07-26-U2-report.md`：改了哪些文件、每个 WI 的做法与取舍、
§7 逐项结果、隔离树审计过程、以及**你没做到或没把握的地方**（这一条最重要，藏着比漏着贵）。

## 9. 何时必须停下来报告

- 发现 §6 里某条判据在不改 schema / 不改编译器的前提下**做不到**。
- `SelectionType` 与 `UIStore` 的脱节比 §WI-1 描述的更深，牵出计划外的重构。
- 退役 Inspector 面板会破坏 Enter/双击/Escape 的既有语义，且找不到不破坏的做法。
- 场景级属性的写路径无法复用 `updateSceneMetadata`（撤销会变成多步）。
- 隔离树里编译失败，但工作树里是绿的——**立刻停，这就是 U1 那个坑**。
