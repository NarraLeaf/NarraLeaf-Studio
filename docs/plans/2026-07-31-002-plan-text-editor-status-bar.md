# 文本编辑器：状态栏化 + 表面对齐 + 编码/行尾持久化

分支 `feat/text-editor-status-bar`，从 `develop`（`8ccc6a7b`）切出，完成后合并回 develop。
上一轮见 `2026-07-31-001-plan-asset-categories-and-text-editor.md`。

## 0. 需求原文

> monaco的样式要和编辑器匹配，顶部要留点空间。编辑器底下的设置项可以留给studio状态栏。
> 例如当前编辑的文件名放在状态栏靠左的右侧，而编码设置、行尾符号和选中状态放在状态栏靠右左侧
> （主要是靠近中心的意思）。新文件面板根据当时新建这个文件的OS决定，可以使用状态栏切换行尾。
> 选定的阅读用编码需要保存，切换编码时可以选择使用选定编码重新阅读，或者使用选定编码保存
> （就像VSC那样）。

**解读**：
- 「新文件[的行尾]根据当时新建这个文件的 OS 决定」= 保持现状（Windows 上 CRLF），这条同时**回答了上一轮
  留给用户的裁决**——不改默认值，只补切换入口。
- 「重新阅读 / 保存为」两个动作已经实现（`Reopen with` / `Save with`），本轮只是把入口搬到状态栏。

## 1. Monaco 表面与内边距

**根因**：文本编辑器外壳用 `bg-surface-sunken`（`TextEditor.tsx:551`），而不是本仓编辑面的
`.nl-editor-surface`（`styles.css:353-355`，= `rgb(var(--nl-surface-sunken) / var(--nl-editor-surface-opacity))`）。
壁纸规则 `.nl-has-workspace-bg .bg-surface { background-color: transparent }` 只清 `bg-surface`，
所以文本编辑器是全仓**唯一**一块不透明的编辑面，和 story 编辑器并排看就是一块黑板。

要做的：
1. 外壳改用 `.nl-editor-surface`，跟随 `editor.surfaceOpacity` 设置。
2. `defineStudioMonacoTheme` 的 `editor.background` 必须带 alpha。现在的 `readChannels`
   （`studioMonaco.ts:158-168`）只产出 6 位 hex、**丢掉 alpha**。改成 8 位 `#RRGGBBAA`，
   把 `--nl-editor-surface-opacity` 折进去。
   ⚠ **Monaco 对 `editor.background` 的 alpha 支持必须实测**，不许假定。若它不吃 alpha，
   退路是把 `editor.background` 设为完全透明并让宿主 div 画背景——同样要实测，判据是
   「设了工作区背景图时，文本编辑器和 story 编辑器的透明度看起来是同一档」。
3. 顶部留白：给 `monaco.editor.create` 的选项加 `padding: { top, bottom }`
   （`TextEditor.tsx:276-294` 现在完全没有 padding，宿主 div 是 `absolute inset-0`）。
   **不要**用宿主 div 的 CSS padding，那会打乱 Monaco 自己的滚动与装订线度量。

## 2. 状态栏化

`TextEditor.tsx:577-641` 那条自带状态条的**设置类内容全部搬走**，位置：

| 内容 | 簇 | 位置 |
|---|---|---|
| 文件名 | Left | 数组**末位** → 左簇最右端 |
| 编码 / 行尾 / 选中状态 | Right | 数组**末位** → 右簇最靠中心 |

右簇渲染时 `reverse()`（`statusBarEntryOrder.ts:19-26`），所以「数组末位 = 最靠中心」。
落点是 `modules/status-bar/index.ts` 的 `builtInStatusBarEntries`；条目类型
`modules/types.ts:159-168` 是 `{id, labelKey, alignment, component}`。
i18n 键在 `workspace.shell.statusBar.entries`（en/zh 都要）。

**取当前标签页**：抄 `WordCountEntry`（`entries.tsx:125-264`）——
`uiService.getStore().getEditorTabsByRecency()` + 订阅 `editorLayoutChanged`。
**绝对不要用 `useActiveEditorTab()`**（`hooks/useUIService.ts:319-350`）：它读
`getActiveEditorTabId()`，而分屏路径 `setActiveEditorTabInGroup` 不更新那个字段，分屏下必然陈旧。

**状态怎么跨出去**：编码/行尾/光标/选区/lossy 现在都是 `TextEditor` 的局部 state，状态栏条目够不着。
新增一个按 tabId 键控的小服务（放 `lib/workspace/services/ui/`，仿 `PanelService` 的形状），
`TextEditor` 挂载时登记、变化时更新、卸载时注销；状态栏条目读**当前活动文本标签**的那条记录。
命令方向也走它：`reopenWith(encoding)` / `saveWith(encoding)` / `setEol(eol)` 由 `TextEditor` 注册实现，
状态栏只负责调用。**这是一个宿主内部服务，不进插件 API**（`narraleaf-studio@0.4.0` 已发布，不许改它的面）。

**选中状态是新东西**：现在只订阅了 `onDidChangeCursorPosition`（`TextEditor.tsx:301-303`），
没有任何选区统计。要加 `onDidChangeCursorSelection`。显示照 VS Code：无选区时 `Ln 12, Col 3`，
有选区时补 `(N selected)`；多选区时 `(N selected in M ranges)`。

**菜单**：`StatusEntry` 的 `onClick` 是 `() => void`，拿不到 event。把签名放宽成
`(event: React.MouseEvent) => void`（既有调用方忽略参数即可，不是破坏性改动）。
`ContextMenu` 已经会向上夹紧到视口内（`ContextMenu.tsx:119-121`），状态栏在窗口最底部也能正常弹。

**插件贡献的预览开关与动作按钮不搬。** 它们是标签作用域的，进全局状态栏会串味；而且
`previewId` 是标签的局部 state。做法：那条自带 strip **保留但只为插件贡献而存在**——
没有任何匹配的 preview/action 时**整条不渲染、不占高度**（现有契约已经是「空注册表什么都不画」）。
Studio 自身不注册任何东西，所以实际观感就是「标签页没有底栏」，正是需求要的。

## 3. 行尾

- **新文件的行尾由创建时的 OS 决定**：Windows → CRLF，其余 → LF。写进资产记录（见 §4），
  因为新文件是 0 字节、内容里没有行尾可探。
- **已有内容的文件**：从字节探测（现有 `detectLineEnding`）。探测结果与记录冲突时**以内容为准**。
- 状态栏的行尾 token 可点，切换后立即改 Monaco 模型的 EOL 并触发一次保存。

## 4. 编码与行尾的持久化

存进**资产记录的 `meta`**（`OtherAssetMetadata`），不是会话状态。

理由：这个功能的用途是「项目成员之间共享计划表」。编码是**文件的属性**而不是窗口的属性，
`assets.metadata.other.json` 本来就进 VCS，队友打开同一个 GBK 文件时应该直接就是对的，
而不是各自再点一次。会话状态做不到这一点。

- 新增可选字段 `textEncoding?: TextEncodingId`、`textEol?: "lf" | "crlf"`。分片没有版本信封，
  加可选字段向后兼容（旧读者忽略即可），**不要**为此引入迁移。
- **只在作者显式切换时写**（reopen-with / save-with / set-eol），不要每次打开都写——否则
  光是浏览文件就会产生 VCS 变更。
- 打开时的优先级：记录里的 `textEncoding` > BOM 嗅探 > UTF-8。
  ⚠ 记录优先于 BOM 是**故意的**：作者显式说过的话应当压过启发式。但 BOM 与记录冲突时要能自愈——
  以记录解码后若出现 U+FFFD，仍然走既有的失真互锁（不自动保存 + token 变红）。

## 5. 不许破坏的既有性质

上一轮实机验过、本轮回归必须仍然成立：

- 失真解码（U+FFFD）时**不自动保存**，且覆盖每一条写入路径（含标签停用 flush、卸载 flush）。
- 冻结工作区：Monaco `readOnly` 而非 disabled，文本全可读（opacity 1）；
  「以编码保存」禁用而「重新打开」可用；「新建文本文件」菜单行禁用。
- 写入四步契约：写字节 → 重算 hash → 丢缩略图缓存 → 写记录并 emit。
- 打开文本标签页期间控制台**零 error**（Monaco 无 worker 配置，`SectionHeaderDetector`
  读的是三个 `minimap.*SectionHeaders` 标志）。

## 6. 验收判据（编排者亲自驱动实机，截图为证）

1. 文本标签页**底部没有任何自带状态条**（未装插件时）。
2. 全局状态栏左簇**最右**一格是当前文件名；右簇**最靠中心**依次是选中状态、行尾、编码。
   非文本标签页激活时这四格**全部消失**。
3. 分屏下把焦点切到另一侧的非文本标签，状态栏那四格随之消失（这条专打
   `useActiveEditorTab()` 的陈旧值）。
4. 点编码格弹菜单，含「重新打开 / 保存为」两级；菜单**向上**弹且完整可见（不被窗口底边裁掉）。
5. 选中若干字符，选中格显示选中字符数；取消选中回到 `Ln x, Col y`。
6. 点行尾格切成 LF，磁盘字节里不再有 `0d 0a`；切回 CRLF 则恢复。
7. 以 GBK 重新打开 → 关闭标签 → 重新打开该资产：**直接就是 GBK**，不再乱码。
   且 `assets.metadata.other.json` 里出现 `textEncoding`。
8. 重启 Studio 后仍然是 GBK。
9. 设了工作区背景图时，文本编辑器的透明度与 story 编辑器**同档**（量两者容器的
   `backgroundColor` alpha，或量同一像素处背景图的可见程度）。
10. Monaco 第一行文字与编辑区顶边之间有留白（量 `.view-lines` 首行 rect 的 y 减去容器 rect 的 y）。
11. §5 的四条回归全部仍然成立。
