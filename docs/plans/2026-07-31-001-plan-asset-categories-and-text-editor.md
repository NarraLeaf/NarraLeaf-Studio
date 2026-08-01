# 资产分类合并 + Studio 文本编辑器（第一阶段）

分支：`feat/asset-category-merge-and-text-editor`，完成后合并回 `develop`。

## 0. 需求原文与解读

1. 「资产边栏中的分类太多了，将 Audio 和 Videos 合并为一个分类，JSON 和 Blueprints 合并一个分类，
   内部允许的类型依旧不变。不考虑兼容」
2. 「为 Studio 添加文本编辑器功能……在 Other 分类的 header 上或者其子目录的右键菜单中可以创建新的
   文本文件（`<本地化的新的文件>.txt`），并且尊重内部使用的扩展名，即使 Studio 编辑器只支持 txt、
   markdown、ini 这样的文本文件，但依旧要默认为所有类型使用 utf-8 编码，使用项目对话框来获得初始名称。
   其编辑标签页应该是一个内建 monaco 编辑器，具有相对完整的功能和简单的界面（要能切编码）。
   这个文本编辑器是用于项目成员之间互相共享计划表，要进入 VCS。可以向 studio 添加依赖。
   md 编辑和预览等能力要靠 studio 插件实现，你第一阶段只负责预留接口和发布 type 包」

**解读（编排者裁定，实现者不得自行改动）**

- 「内部允许的类型依旧不变」= `AssetType` 联合体、`AssetExtensions` 扩展名表、`FileFormatValidator`
  的格式闸门、每类型的 `assets.metadata.<type>.json` 分片、AssetSelector / 属性面板 / 打包器的
  按类型分派，**全部原样保留**。audio 和 video 依旧是两个 `AssetType`。
- 「合并为一个分类」= 新增一层**分类（category）**，它是侧栏的组织单位，一个分类含 1..n 个 `AssetType`。
- 但**分组（group）与排序（order）必须跟着上移到分类层**。理由：分组现在是按 `AssetType` 分域的
  （`useDragAndDrop.ts:155` 静默拒绝跨类型拖放，`GroupAssetsManager` 每类型一份 shard），
  如果只改 header 的渲染，合并后的 Media 分类里「新建分组」按钮不知道该建到 audio 还是 video 下，
  而且用户把 mp4 拖进那个「第一章」文件夹会被静默拒绝。那是半成品，读起来就是坏的。
- 「不考虑兼容」用在：旧的 `assets.groups.audio.json` 等分片**不再被读取也不删除**（迁移一次性把内容
  搬进新分片），以及持久化的 UI 状态（手风琴展开项、已保存的标签会话）允许失效。
  **不**用在「把现有项目的分组清空」——那不是兼容问题，那是毁数据。

## 1. 分类层（Category）

```ts
export enum AssetCategory {
    Image = "image",     // [AssetType.Image]
    Media = "media",     // [AssetType.Audio, AssetType.Video]
    Data = "data",       // [AssetType.JSON, AssetType.Blueprint]
    Font = "font",       // [AssetType.Font]
    Model = "model",     // [AssetType.Model]
    Other = "other",     // [AssetType.Other]
}
```

侧栏顺序：Image → Media → Data → Font → Model → Other。

配套导出（与 `AssetType` 同文件 `src/renderer/lib/workspace/services/assets/assetTypes.ts`）：
`ASSET_CATEGORY_ORDER`、`ASSET_CATEGORY_TYPES: Record<AssetCategory, AssetType[]>`、
`categoryOfAssetType(type): AssetCategory`、`ASSET_CATEGORY_EXTENSIONS`（成员类型扩展名的并集）。

### 1.1 磁盘布局

| 文件 | 变化 |
|---|---|
| `assets/assets.metadata.<type>.json` | **不变**（仍按 `AssetType` 分片） |
| `assets/assets.groups.<category>.json` | 由按类型改为按分类。image/font/model/other 的文件名恰好不变 |
| `assets/assets.order.<category>.json` | 同上 |

`AssetGroup.type: AssetType` → `AssetGroup.category: AssetCategory`。读取时接受遗留的 `type` 字段并经
`categoryOfAssetType` 折算。**group id 不变**，因此资产记录的 `groupId` 一个字都不用改。

**一次性迁移**（在 `GroupAssetsManager` / `AssetOrderManager` 的读取路径里）：若 `media` / `data` 分片
不存在而旧的 `audio`+`video` / `json`+`blueprint` 分片存在，则合并写出新分片。旧文件保留不动。
两个旧分片里出现同名分组时**不做去重**（它们是不同的 group id，各自成行）。

### 1.2 侧栏

- `AssetsListView` / `AssetsIconView` 由遍历 `Object.values(AssetType)` 改为遍历 `ASSET_CATEGORY_ORDER`。
- header 文案 `assets.categories.<category>`，计数 = 成员类型资产数之和。
- header 三个按钮语义：
  - **Import**：文件对话框过滤器用 `ASSET_CATEGORY_EXTENSIONS`；选完后按文件逐个判定具体 `AssetType`，
    分桶后在一个 `transaction` 里对每个类型调一次 `importFromPaths`。
    判定规则：先按 `assetTypeMatchesExtension` 匹配成员类型；`data` 分类下 `.json` 二义
    （Blueprint 也吃 `.json`），规则是**先试 Blueprint 解析**（`parseSharedBlueprintAssetJson`），
    成功即 Blueprint，否则 JSON。`.nlbp` 直接 Blueprint。
  - **Import Remote**：按 URL 扩展名判定成员类型；判不出来落分类的首个成员类型。
  - **New Group**：建在分类下，不再有类型二义。
- 拖放：分类根的高亮判据由 `draggedItem.type === type` 改为
  `categoryOfAssetType(draggedItem.type) === category`；分组落点判据同理比对 `group.category`。
  **跨分类拖放仍然拒绝**。
- 手风琴展开状态、`assetDragContract`、`useMultiSelection`、`useAssetData`、`useAssetFilters`、
  `FilterSystem` 里凡是「按类型分域」而实际语义是「按侧栏分区」的地方，一并上移到分类。
  资产本身的 map 仍按 `AssetType` 键控。
- `asset-overview` 视图（同一面板的第三种视图模式）的分区也要合并，否则同一面板两种视图对不上。
- `InputDialog` 的 `typeNouns` 改为按分类取 `dialogs.noun.<category>`。

### 1.3 明确不动的地方

`AssetExtensions`、`FileFormatValidator`、`ASSET_TYPE_ICONS`（资产行图标仍按类型）、
`AssetSelector`、属性面板 schema、`gameRuntimeArtifactCompiler.ts:49` 与
`bundleAssembler.ts:218` 的硬编码类型数组、`revisionSnapshot.ts` / `PreviewManager` / `DevModeManager`
里硬编码的 `assets.metadata.blueprint.json` 路径。

分类图标另立 `ASSET_CATEGORY_ICONS`（lucide）。

## 2. 文本文件的创建

### 2.1 入口

- **Other 分类 header 的右键菜单**，以及 **Other 分类下任意分组行的右键菜单**，新增一行「新建文本文件」。
  分类 header 目前**没有**右键菜单（`AssetsListView.tsx:108` 还主动吞掉了 body 的 contextmenu）——
  给 header 加 `onContextMenu`，body 的吞掉保持原样。
- 该行只在 `AssetCategory.Other` 出现。冻结工作区时**禁用**（不要加进
  `FREEZE_READ_ONLY_ASSET_MENU_IDS` 白名单）。

### 2.2 取名

用项目自己的 `InputDialog.show()`：

- 标题 `assets.newTextFile.title`
- `initialValue` = `t("assets.newTextFile.defaultName") + ".txt"`（en `New Text File.txt` /
  zh `新建文本文件.txt`），**并把选区默认落在扩展名之前**（若 `InputDialog` 支持；不支持就整选，
  不要为此改造对话框）
- 校验：非空；不含路径分隔符与 Windows 非法字符；同分组重名交给 `resolveUniqueAssetName` 兜底
- **扩展名规则**：用户输入里带扩展名就**原样尊重**（`plan.md`、`notes.ini`、`data.csv` 都建得出来）；
  没有扩展名则补 `.txt`。Studio 的文本编辑器只**打开** `TEXT_EDITABLE_EXTENSIONS` 里的那些，
  这是两件事，不要用编辑器的白名单去限制创建。

### 2.3 落盘

现在**没有任何**「从字节创建资产」的 API（一切创建都要求磁盘上先有源文件）。新增：

```ts
// LocalAssetsManager
createLocalAssetFromBytes<T extends AssetType>(
    type: T, name: string, bytes: Uint8Array, groupId?: string,
): Promise<RequestStatus<Asset<T, AssetSource.Local>>>
// AssetsService 上同名转发
```

按 `importLocalAsset`（`LocalAssetsManager.ts:512-613`）逐条对齐：uuid → hash → 唯一名 →
写入 `AssetsDataShard(id)` → 写记录 → `markDirty` → emit `"updated"`。新建文件内容为**空字节**。

VCS 不需要任何登记：`src/shared/vcs/workingSet.ts` 是路径制，`assets/` 不在排除表里，
只要经由被观察的 `FileSystemService` 写入，检查点时钟自动上弦。

## 3. 文本编辑器标签页

### 3.1 打开

`openDraggedAssetsInEditor.tsx` 的白名单加 `AssetType.Other`，且**扩展名在
`TEXT_EDITABLE_EXTENSIONS` 内**才开标签；不在则维持现状（只选中、只开属性面板）。
单击即开（本仓的既有手势，不是双击）。id 前缀 `narraleaf-studio:assets:text-editor-`。

`TEXT_EDITABLE_EXTENSIONS`（含义是「Studio 内建编辑器认得的纯文本」）：
`txt md markdown ini cfg conf toml yaml yml csv tsv log properties env gitignore xml`。
按扩展名映射 Monaco 语言 id；认不出的落 `plaintext`。

### 3.2 界面

严格遵守既有 UI 规约（见 `ui-style-constraints`）：**不堆条**、**无解释性文字**、复用既有组件。

- 整个标签页：`flex h-full flex-col`。Monaco 占满剩余高度，`automaticLayout: true`。
  宿主 `EditorGroup.tsx:543` 是 `overflow-hidden`，标签必须自带滚动。
- **只有一条底部状态条**，全是值、没有标签文字，形如：
  `plan.md · UTF-8 · LF · Ln 12, Col 3`
- 编码切换：点状态条上的编码 token 弹 `ContextMenu`，两个子菜单
  「以编码重新打开」/「以编码保存」（VS Code 的既有心智模型）。不新增工具栏。
- 冻结工作区时 Monaco 走 `readOnly`（**不是** `disabled`——冻结不许把「只是看」也关掉，
  见 `frozen-workspace-readability`）。

### 3.3 编码

- 默认一律 **UTF-8**（无论扩展名）。
- 打开时：先嗅 BOM（UTF-8 / UTF-16LE / UTF-16BE），命中即用之；否则按 UTF-8 解码。
  UTF-8 严格解码失败**不做猜测**，仍按 UTF-8 带替换字符显示，由用户手动「重新打开」。
- 支持集：UTF-8、UTF-8 with BOM、UTF-16 LE、UTF-16 BE、GBK、GB18030、Big5、Shift_JIS、
  EUC-KR、Windows-1252、ISO-8859-1。
- 实现：新增依赖 **`iconv-lite`**，编解码都放**主进程**（Node 侧 Buffer 可用），
  把 `FileSystemService.read/write` 的 encoding 参数从 `BufferEncoding` 拓宽成
  `TextEncodingId`，主进程侧 Node 认得的走 Node、认不得的走 iconv-lite。
  **不要**把 iconv-lite 塞进 renderer bundle（需要 Buffer polyfill，不值）。

### 3.4 保存

house style 是防抖自动保存（`TypeScriptBlueprintEditorPane.tsx:33-43` 是现成参照），
本仓没有任何按标签的关闭确认。因此：

- 400ms 防抖自动保存；未落盘期间 `EditorService.setModified(tabId, true)`，落盘后清掉。
- 标签停用（`active` 转 false）与卸载时**冲刷一次**。
- 写入必须走新增的 `AssetsService.writeAssetTextContent(asset, text, encoding)`，
  它要完整实现 `replaceAssetContent` 文档块（`AssetsService.ts:715-734`）规定的四步：
  写字节 → **重算 `hash`** → 丢缩略图缓存 → 写记录并 emit `"updated"`。
  绕过重算 hash 会让下游读者拿着旧 hash 当缓存键，静默读到旧内容。

### 3.5 会话恢复

`workspaceEditorSession.ts` 的 `SerializedTab` 是**闭合联合**，不登记的话重开 Studio 标签就消失、
也无法「重新打开已关闭的标签」。要动的五处：`SerializedTab:57`、前缀常量 `:42`、
`trySerializeTab:223`、`isSerializedTab:312`、`buildTabDefinition:556`。

## 4. 插件接口（第一阶段：只预留 + 发 type 包）

Studio 自己**不实现** markdown 的编辑增强与预览，只把接口留出来。仿 `ui.panels` 的做法：
**纯命令式，不加 manifest `contributes` 种类**（因此不需要同步 `NarraLeaf/Plugins` 的 schema）。

新命名空间 `app.services.textEditor`：

```ts
registerLanguage(def: PluginTextEditorLanguageDef): PluginCleanup;
registerPreview(def: PluginTextEditorPreviewDef): PluginCleanup;
registerAction(def: PluginTextEditorActionDef): PluginCleanup;
```

- `PluginTextEditorLanguageDef` `{ id, extensions, aliases?, monarch?, configuration? }`
  —— 懒注册进 Monaco（首次有匹配扩展名的文档打开时）。
- `PluginTextEditorPreviewDef` `{ id, extensions, title | titleKey, icon?, component }`，
  组件 props `PluginTextEditorPreviewProps` `{ text, encoding, fileName, assetId, active }`。
  渲染契约：**当且仅当**当前文档扩展名有已注册的预览时，状态条上才出现预览开关；
  没有插件时界面上不许留任何死控件。
- `PluginTextEditorActionDef` `{ id, title | titleKey, icon?, extensions?, run(ctx) }`，
  `PluginTextEditorActionContext` `{ assetId, fileName, encoding, getText(), setText(text) }`。

宿主侧照 `PanelService` + `UIStore` + `usePanels` 的三件套建 `TextEditorContributionService`。
id 必须经 `assertOwnedId` 加插件 id 前缀；`register*` 一律返回 `PluginCleanup` 并进卸载袋。

Type 包：所有新类型必须从 `src/renderer/plugin/index.ts` **显式 re-export**
（`build.mjs` 的 `exportReferencedTypes:false` 会让没导出的类型静默消失）；
不新增需要按值导入的枚举/常量（编码 id 用字符串联合类型），因此
`exposePluginModule` 的冻结全局与 `pluginHandler.ts` 的 shim **不用动**。
`packages/plugin-types/package.json` 版本 0.3.0 → **0.4.0**。
`yarn build:plugin-types` 与 `npm publish --dry-run` 必须绿；**真正 `npm publish` 由编排者向用户确认后再执行**。

文档：`project/docs/create-plugin.md` 增一节。

## 5. 技术风险（按可能性排序）

1. **Monaco 从未被真正打包过。** `monaco-editor` / `@monaco-editor/react` 在依赖里但零调用方，
   `storyMonaco.ts` 是死代码。窗口文档是 `loadFile` 的 `file://`，脚本/样式走 `app://windows/...`，
   HTML 里 `<base href="app://public">`。因此 **worker 能不能起必须在实机上定死**：
   - 首选：不依赖 worker 的配置（`wordBasedSuggestions:"off"`、`links:false`、
     `unicodeHighlight` 全关、`occurrencesHighlight:"off"`），并确认控制台**零报错**。
   - 若能让 worker 起来（blob URL / `app://` 同源）也可以，但判据不变：控制台零报错。
   - 从 `monaco-editor/esm/vs/editor/editor.api` 精确引入 + 按需引入
     `basic-languages/{markdown,ini,yaml,xml}`，**不要**引 `monaco-editor` 桶（它会拉进
     全部语言与 TS/JSON 语言服务，必然要 worker）。
2. **CSS**：Monaco 的 ESM 会 `import` 一堆 `.css`，本仓的 esbuild 把每个 `.css` 都过 postcss+tailwind
   （`project/build/postCss-plugin.js`）。要确认产物 `dist/windows/workspace/index.css` 里真有
   Monaco 的样式，而不是被 tailwind 吃掉。
3. **NUL 字节**：本环境用 Write/Edit 写 TS 源码时，**短字符串字面量里的单个空格偶发变成 `\0`**，
   git 会把文件当二进制、merge 整文件冲突。收尾前必须扫一遍（见任务卡）。
4. 分组分片迁移写错会让现有项目的资产全部变成未分组。

## 6. 验收判据（编排者亲自驱动实机，截图为证）

判据由编排者持有，实现者**不得**自行编写通过判定。

1. 资产面板恰好 6 个分类 header：Images / Media / Data / Fonts / Models / Other（本地化）。
2. Media 的计数 == audio 数 + video 数；Data 的计数 == json 数 + blueprint 数。
3. 在 Media 下新建一个分组，把一个 audio 资产和一个 video 资产都移进去，两者都被接受且都渲染在该组下。
4. 右键 Other 的 header → 菜单含「新建文本文件」→ 点击 → 对话框默认值是本地化的 `*.txt`
   → 确认 → Other 下出现该资产，且**同时**打开一个 Monaco 标签页。
5. 在编辑器里输入文本 → 等自动保存 → 磁盘字节按 UTF-8 解码 == 输入的文本。
6. 切到 GBK 保存 → 磁盘字节**不是** UTF-8 编码的那串（对中文断言字节序列），再「以 GBK 重新打开」
   → 文本一致。
7. 重启 Studio → 该标签页被会话恢复。
8. 打开该标签页期间控制台**零** error。
9. 新建的文本资产被 VCS 认领（`isVersioned` 为真，且能进一次检查点/提交）。
10. 冻结工作区：Monaco 变只读但内容仍可见可滚动；「新建文本文件」菜单行禁用。

验收剧本已先于实现写好：`tools/ui-verify/scenarios/asset-categories-and-text-editor.js`。

## 7. 验收所需的 DOM 抓手（实现方必须提供）

验收脚本按这些抓手取元素。没有它们就只能按文本猜，而按文本猜正是历史上「探针全绿其实什么都没测」
的主要来源。这些属性是产品的一部分，不是测试专用后门——同类抓手本仓已有
（`data-editor-tab-id`、`data-story-row-block-id`、`data-ui-surface-id`）。

| 抓手 | 挂在哪 |
|---|---|
| `data-asset-category="<category>"` | 列表视图的分类手风琴 header、图标视图的分区 `<header>` |
| `data-asset-group-id="<id>"` | 分组行 |
| `data-text-editor-tab-id="<tabId>"` | 文本编辑器标签页根元素 |
| `data-text-editor-encoding="<id>"` | 状态条上的编码 token（同时给 `aria-label`） |

分类 header 的可见文本里必须含该分类的资产计数（既有 `assets.itemCount` 复数机制），
验收会拿它和服务里的真实计数对账。
