---
title: "feat: Game Localization System"
type: feat
status: phase-2-implemented
date: 2026-07-09
---

# feat: Game Localization System（游戏多语言系统）

## Overview

为 Studio 制作的游戏提供多语言能力（区别于 Studio 自身 UI 的 i18n，后者在 `src/shared/i18n`，与本计划无关）。设计目标：

1. **业界常规**：附着层翻译（翻译永不改动源文档）、状态机（untranslated/machine/translated/reviewed/stale）、原文哈希失效检测、XLSX/XLIFF 交换格式——有本地化经验的团队与外包/平台可无缝对接。
2. **贴合叙事游戏工作流**：故事文本零 key 化（`StoryTextSegment.textId` 天然锚点，Ren'Py 附着模式）；翻译表按"故事 → 场景 → 叙事顺序"组织而非字母序。
3. **差异化创新**：
   - 切换语言零重编译、即时生效（NLR DynamicWord 查表）；
   - 译文中 `{0}` 编号占位符直接映射回源句的插值 Word（变量插值在译文中依然活着）；
   - （Phase 2）选中译文行即用 preview snapshot 架构渲染该句的舞台画面，译者上下文零成本。

## 核心架构决策（已验证代码事实）

### 1. 翻译单元锚点
- 故事文本：`StoryTextSegment.textId`（`src/shared/types/story/document.ts:365`）已是稳定 id。可翻译 role：`narration` / `dialogue` / `choicePrompt` / `choiceText`（`note` 是编辑器备注，排除）。
- UI 控件文本（`UIElement.props.text` 内联明文）→ Phase 2 key 化。
- 命名 key（蓝图 `getText` 用）→ Phase 2。

### 2. 数据存储
- 项目配置（`.nlproj` → `app.localization`，仿 `app.network` 模式，`ProjectService.getNetworkConfiguration` 同款 normalize + 安全默认）：

```ts
type LocalizationConfiguration = {
    sourceLocale: string;                 // 默认 "" = 未启用
    locales: LocalizationLocaleEntry[];   // { code, displayName(自名), fallback? }
};
```

- 翻译库：`editor/localization/<locale>.json`（每语言一文件，git/多译者并行友好；新增 `ProjectNameConvention.EditorLocalization*` 常量）。`editor/` 不进包，符合现有约定：

```jsonc
{
  "schemaVersion": 1,
  "locale": "en",
  "units": {
    "<textId>": {
      "target": "译文（{0} 编号占位符对应源句插值）",
      "sourceHash": "fnv1a:xxxxxxxx",
      "status": "translated",   // untranslated | machine | translated | reviewed | stale
      "note": "译者备注（可选）"
    }
  }
}
```

- 源文本序列化（用于展示 + 哈希）：文本 run 平铺、插值 run 记为 `{n}`（n = 插值在句内序号）。marks/pause 不参与哈希（样式变化不应使翻译失效）。哈希用 FNV-1a（新增 `src/shared/utils/contentHash.ts`）。
- stale 判定是**读取时派生**的：`unit.sourceHash !== hash(当前源文)` 即 stale，不需要写库时批量改状态（作者改稿不触发翻译库写入）。

### 3. 运行时链路（关键：数据走 bundle，不新增 pack 字段）
- `DevModeBundle` 新增 `localization?: GameLocalizationBundle`（config + 各语言 units 表）。`GameRuntimePackV1.bundle` 内嵌 bundle，因此 **Dev Mode 与打包运行时一条链路全覆盖**（两者都走 `GameApp` + `host.bundle`，见 `src/runtime/renderer/GameRuntimeApp.tsx:300`）。
- 装配点：`bundleAssembler.ts`（main 进程）读 `.nlproj` 的 `app.localization` + `editor/localization/*.json`。
- Dev Mode watcher（`DevModeManager.watchProjectFiles`）追加 `editor/localization` 目录，翻译改动热重载。
- **文本解析 = NLR DynamicWord**（已验证 `DynamicWordResult = string | Word | Pausing | (…)[]`，`Menu.prompt`/`choose` 均接受 Word）：
  - `storyCompiler` 的 `CompileInput` 增加 `localization?: StoryLocalizationRuntime`（tables + `getLocale()` 同步闭包）。
  - `compileNodeAction`（narration/dialogue）、`compileChoice`（prompt/option）将可翻译段编译为单个动态 Word：`getLocale()` == source 或无译文 → 返回预编译的原句富文本词组；否则返回译文（按 `{n}` 切分并映射回源句插值 Word）。
  - 切语言即时生效（下一次渲染即新语言），无需重编译故事。
- **当前语言 = persistent 存储键 `nls.locale`**（经 `core.scopeBridge.persistenceGet/Set`，同步快照读）。首启无值时按 `navigator.language` 匹配可用 locale（精确 → 前缀），写入后再用。回退链：locale → 其 fallback → sourceLocale。
- 编辑器场景预览（`compileStagePreviewToNlr`）Phase 1 不传 localization（源语言预览）；Phase 2 加预览语言切换器。

### 4. 蓝图节点（Phase 1 最小集）
扩展 `BlueprintHostApiRuntime`（`BlueprintHostApiBridge.ts`）新增 `localization` 组（仿 `persistence` 组）：
- `Get Current Language`（pure 语义但走 exec latent，同 Get Persistent 模式）
- `Set Language`（校验 code ∈ locales，写 `nls.locale`）
- `Get Available Languages`（返回 `{ code, displayName }[]`，直接作语言选择器 List 数据源）

`getText/formatText/hasText/setPreviewLanguage`（`docs/blueprint-node-plan.md` Localization 段）依赖命名 key / 预览通道，归 Phase 2。

### 5. Localization 面板（填充 `localizationPanelModule` 占位）
- 边栏面板：语言管理（源语言设定、添加/移除语言、自名 displayName、每语言翻译进度条）+ 打开翻译编辑器入口。
- 翻译编辑器（编辑器区 tab，宽度需求大）：按 故事 → 场景 → 叙事顺序 分组的表格；列 = 说话人/角色上下文、源文、译文（行内编辑）、状态徽标；状态过滤器；stale 行显示当前源文与翻译时源文的差异提示。
- 规范：文案走 Studio i18n（`useTranslation`）；无 ALL-CAPS；绝不显示裸 UUID（场景/角色显示名称）。

## Phases

### Phase 1 — MVP（本期交付，验收标准见下）
1. 共享类型 `src/shared/types/localization.ts` + `contentHash.ts` + 源文序列化工具（shared，main/renderer/runtime 三方复用）。
2. `.nlproj` `app.localization` + `ProjectService.getLocalizationConfiguration/updateLocalizationConfiguration`。
3. `LocalizationService`（renderer）：读写翻译库、按叙事顺序抽取翻译单元、进度统计、变更事件；启用 `Services.Localization` 槽位；单元测试。
4. 面板 + 翻译编辑器 tab（上述 UI）。
5. bundle 装配 + Dev Mode watcher + storyCompiler 动态 Word 解析 + 首启语言匹配；storyCompiler 集成测试。
6. 蓝图节点三件套 + host API `localization` 组。

**验收路径**：项目里添加语言 en → 翻译几句 → Dev Mode 启动游戏 → 蓝图 Set Language("en") → 对话/选项即时切换为英文，无译文行回退中文；重启游戏语言记忆保持。

### Phase 2 — 协作与 UI 文本（已实现，见下方实施记录）
- UI 控件文本 key 化：text/button 控件新增 `localizable?: boolean`（隐式单元 `ui:<elementId>.<prop>`）与 `localizationKey?: string`（引用命名 key，优先）。Inspector 加 "Localization" 折叠段。运行时经 `GameLocalizationContext`（GameApp Provider，`scopeBridge.subscribePersistence` 响应式）+ `useLocalizedWidgetText` 解析；编辑器画布无 Provider 恒显源文。
- 命名 key 库：`editor/localization/keys.json`（`LocalizationKeysDocument`），面板 "Named keys" 区 CRUD；装配进 `bundle.localization.keys`；翻译单元 `key:<name>`。
- 蓝图节点：`getText`（未知 key 渲染键名以显式暴露缺陷）、`hasText`、`formatText`（`{n}` + values 列表）。host API `localizationConfig` 升级为携带完整 bundle（tables+keys）。
- CSV 导出/导入（RFC 4180 + UTF-8 BOM，Excel 直开；无 XLSX 依赖，XLIFF/XLSX 归 Phase 3）：导出到 `editor/localization/exports/<locale>.csv`（列 unit_id/context/source/target/status/note）；导入按 unit_id 对齐、以 CSV 的 source 列锚定哈希（导出后原文再改动自然派生 stale）、空译文跳过、未知条目计数，汇总通知。
- 占位符 parity 校验：`validatePlaceholderParity`（outOfRange=缺陷 / missing=警告）；UI 集成（行内警告）待接。
- 翻译编辑器重构：翻译/审校双模式（用户反馈：去 chip、正文 text-sm、状态改 2px 左侧色条；审校模式才有 通过/退回 与 stale 警示条）；范围选择器 = 各故事 + 界面文本 + 通用文本。
- **递延**：选中行 snapshot 舞台预览与 `setPreviewLanguage`（scene-editor 文件当时有并行改动，避免冲突，单独一轮实施）。
- Bug 修复：`LOCALE_STORAGE_KEY` 由 `nls:locale` 改为 `nls.locale`（persistence 键校验不允许冒号，Set Language 节点曾因此报错）。

### Phase 3 — 资产与打磨
- XLIFF 1.2/2.0；机器翻译预填（status: machine）。
- 资产 locale variants（带字 CG、voiceAssetId 配音，参照 character forms 的"选择维度→资产"映射）；字体覆盖 per locale。
- 伪本地化 locale（文本膨胀 + 重音字符）检查 UI 溢出；舞台 text 对象（`action:"text"` 的 `text` 字符串）本地化。

## 改动文件清单（Phase 1）

| 文件 | 改动 |
|---|---|
| `src/shared/types/localization.ts` | 新增：配置/翻译库/bundle 类型 + 常量 |
| `src/shared/utils/contentHash.ts` | 新增：FNV-1a 哈希 |
| `src/shared/utils/localizationText.ts` | 新增：源文序列化（`{n}` 占位）、译文切分 |
| `src/shared/types/devMode.ts` | `DevModeBundle.localization?` |
| `src/renderer/lib/workspace/project/configuration.ts` | `LocalizationConfiguration` + normalize |
| `src/renderer/lib/workspace/services/core/ProjectService.ts` | get/update LocalizationConfiguration |
| `src/renderer/lib/workspace/project/nameConvention.ts` | `EditorLocalization` 路径 |
| `src/renderer/lib/workspace/services/localization/LocalizationService.ts`(+test) | 新增服务 |
| `src/renderer/lib/workspace/services/services.ts` / `serviceRegistry.ts` | 启用 Localization 槽位、接口 |
| `src/renderer/apps/workspace/modules/localization/*` | 面板 + 翻译编辑器 tab |
| `src/renderer/apps/workspace/modules/registry.ts` | 换用真实实现 |
| `src/shared/i18n`（catalog） | 新增 `workspace.localization.*` 文案 |
| `src/main/.../devMode/pipeline/bundleAssembler.ts`(+test) | 装配 localization |
| `src/main/.../devMode/DevModeManager.ts` | watch `editor/localization` |
| `src/renderer/lib/ui-editor/runtime/game/storyCompiler.ts`(+集成测试) | 动态 Word 查表 |
| `src/renderer/lib/ui-editor/runtime/app/GameApp.tsx` | 传 localization、首启语言匹配 |
| `src/renderer/lib/ui-editor/blueprint-runtime/BlueprintHostApiBridge.ts` | `localization` API 组 |
| `src/renderer/lib/ui-editor/blueprint-nodes/built-in/localizationNodes.ts` | 三个节点 |
| `src/shared/types/blueprint/graph.ts`（如需节点 type 常量） | 节点类型常量 |
