---
title: "feat: Translation exchange formats (CSV / XLIFF / PO / JSON)"
type: feat
status: implemented
date: 2026-08-05
---

# feat: 翻译交换格式（CSV / XLIFF / PO / JSON）

Card: 2026-08-05-002 · Branch `feat/localization-exchange-formats` · Worktree `.claude/worktrees/loc-exchange`

承接 [2026-07-09-001 游戏多语言系统](2026-07-09-001-feat-game-localization.md) 的 Phase 3 首项
（原文只写了「XLIFF 1.2/2.0」）。

## 1. Problem

Phase 2 给了 CSV 一条通路：语言行的「更多」菜单里两条写死的 Export CSV / Import CSV。
对外包翻译来说这不够用，理由不是格式偏好而是**工具链**：

- 用 CAT 工具的翻译公司（Trados / memoQ / OmegaT）只接 XLIFF，拿到 CSV 要自己写转换；
- 志愿者与开源社区在 Poedit / Weblate / Crowdin 里工作，那边的母语是 gettext PO；
- 交给脚本或模型批量处理时，CSV 的引号转义是纯粹的负担，JSON 才是自然形态；
- Excel 派本来就有 CSV。

另外三个与格式无关、但同样卡在这条路上的缺口：

- **只能整表导出**。一个已上线的项目改了三句话，导出仍然是几千行，翻译按字数计费的那一方
  没有办法只看这三句。
- **导错语言不会有任何提示**。unit id 在所有语言之间是同一套，法语文件导进德语库，
  每一条都「匹配成功」。
- 导入只认扩展名 `.csv`；翻译者寄回 `translations.txt` 就没有入口。

## 2. Rulings

**R1 — 四种格式共用一个行模型，分歧只在编解码器。**
`TranslationExchangeRow`（unit_id / context / source / target / status / note）是唯一的中间形态，
`applyImportedRows` 以下只有一条路径。新增格式 = 新增一个 codec + 注册表一行。

**R2 — 锚点永远是 unit id，不是原文。**
两句话可以字面相同而含义不同，作者改一个字也不该让译文失联。
每种格式都用它自己「给外部 id 的位置」：XLIFF `trans-unit/@id`（外加 `resname`，
因为有的工具只把 `resname` 展示给译者）、PO `msgctxt`、CSV 的 `unit_id` 列、JSON 的键。

**R3 — XLIFF 写 1.2、读 1.2 与 2.0。**
1.2 是市面上每个 CAT 工具都能直接打开的版本，2.0 虽然是新标准但支持面薄得多。
写 1.2 才真的能把文件翻完；读两种只多一个分支，代价极小，却让 2.0 工具寄回的文件不至于是死路。

**R4 — `{0}` 占位符在所有格式里都是字面文本。**
把它变成 XLIFF 的 inline code 在 CAT 工具里更好看，但会毁掉另外三条路——
往回走的那一趟必须能容忍「译者在 Excel 里重打了一整句」。

**R5 — 状态词汇表统一，各格式映射到自己的惯用法。**
`"" | machine | translated | reviewed | stale`。XLIFF 映射到 `state` 的五个合法值；
PO 用 `#, fuzzy` 表达 machine/stale（这正是该 flag 在 gettext 里的含义），
`reviewed` 这类 gettext 说不出来的状态另写一行 `#. nls-status:` 保真。
读回来时未知状态一律按「有译文就是 translated」处理，绝不因为一个词丢掉整句翻译。

**R6 — `stale` 只出现在导出方向。**
它是读取时派生的（原文哈希对不上），不是存储状态。导入时 `stale` 落库为 translated，
但哈希锚定文件里带的那份原文——原文若确实又变过，下一次读取自然重新派生出 stale。

**R7 — 导出范围是选项，不是新面板。**
「全部」与「未翻译与待校对」两档，计数直接写在选项文字里（沿用翻译表过滤器的既有写法）。
默认值：两者都非空时选后者，其余选全部。

**R8 — 语言不符要拦一下。**
文件里带语言标注的（XLIFF/PO/JSON）与目标语言不一致时弹确认框。CSV 没有存放语言的位置，
这条对它天然缺席，属于格式的固有代价，不为此加自定义列。

**R9 — 冻结工作区里导出仍可用、导入不可用。**
导出写的是工程外的路径，导入写工程。沿用既有的 `FREEZE_READ_ONLY_*` 名单机制。

## 3. What shipped

**共享层**（`src/shared/utils/`）

| 文件 | 内容 |
|---|---|
| `xml.ts`(+test) | 手写的最小 XML 读写：元素/属性/文本/CDATA/注释/实体，命名空间前缀剥离，容错恢复。不引依赖，也因为 main 进程没有 `DOMParser` |
| `localizationExchange.ts`(+test) | 行模型、状态词汇表、格式注册表、序列化/解析分发、扩展名+内容双路探测 |
| `localizationXliff.ts` | 写 1.2、读 1.2/2.0；inline 标记拍平；`\r` 与首尾换行走数字实体（XML 会规范化 CRLF，不转义就等于悄悄改写作者的换行） |
| `localizationPo.ts` | msgctxt/msgid/msgstr、多行折行、fuzzy、obsolete 跳过、复数取第一形态、header 读 `Language:` |
| `localizationJsonExchange.ts` | 写一种形态，读四种（Studio 自身格式、`units` 只带译文、裸 map、行数组） |
| `localizationCsv.ts` | 行类型改为共用类型，其余不变；BOM 从调用方上移到 `serializeTranslationExchange` |

**渲染层**

- `localizationModel.ts`：`buildTranslationExchangeRows(units, document, scope)` —— 导出行的组装，
  状态在这里派生；`TranslationExportScope` 两档。
- `LocalizationService.applyImportedRows`：签名改为通用行，状态经 `normalizeExchangeStatus` 收口。
- `TranslationExportForm.tsx`：导出对话框正文（格式 + 范围两个 Select，各带工具名/计数），
  选择上报给对话框，因为 footer 按钮在打开时就被快照了。
- `LocalizationPanel.tsx`：菜单两条改为 Export / Import translations…；导出走
  `uiService.dialogs.show` + 原生保存框；导入探测格式、语言不符确认、解析警告二次通知。

**i18n**：`workspace.localization.exchange.*`（en/zh 各 24 键），旧的 `panel.exportCsv` /
`importCsv` / `exportDone` / `importFailed` 移除。

## 4. Acceptance

单测：`localizationExchange.test.ts` 35 例（四格式各自 round-trip 同一批「难缠行」——引号、逗号、
换行、CJK、反斜杠、制表符、空译文、`{0}`），`xml.test.ts` 12 例，`localizationModel.test.ts` 新增 3 例。
四工程 `tsc --noEmit` 干净，`style:ratchet` 无上升，i18n parity 通过。

真机：worktree dev 实例（`NLS_DEV_RELOAD_PORT=5601`、CDP 9401、带 occlusion 开关），
真工程副本（49 个可翻译单元：11 个角色名 + 故事行 + 界面文本）。
`tools/ui-verify/scenarios/localization-exchange-formats.js` **9 green / 0 red**，
四种格式各自跑完「导出 → 原生保存框 → 磁盘 → 改一条译文 → 导入 → 落到 `editor/localization/ja.json`」。
另外手工确认的三件：

- PO 的状态映射按设计落库：`#, fuzzy` → `machine`，`#. nls-status: reviewed` → `reviewed`，
  普通 → `translated`，`# ` 译者注释 → 单元的 `note`。
- XLIFF `state="final"` → `reviewed`；scope=pending 时导出 46 条，已翻译的 3 条不在文件里。
- 语言不符拦截：把 `target-language` 改成 `fr` 再导入，确认框出现，取消后进度仍是 3/49。

本轮新增两件验收基建（此前仓库里都没有）：`tools/ui-verify/file-dialog.ps1`
（原生文件对话框驱动，CDP 到不了那一层）与上面的 scenario。

## 5. Known gaps

- **舞台 `action:"text"` 的字符串仍不可翻译**（Phase 3 原本就列着的另一项）。导出的是
  角色名 + 故事行 + 勾选了 localizable 的 UI 控件文本 + 命名 key，这是当前「全部可翻译文本」的定义。
- **一次一语言**。给外包多语言包要导多次；打包多语言的 XLIFF（一个 file 元素一种语言）没做。
- **XLIFF 只写 1.2**。读 2.0 但不写；等到有工具真的只吃 2.0 再说。
- **PO 复数**未支持（写不出、读只取第一形态）—— Studio 的翻译单元是作者写下的一行，
  源语言侧没有复数形态这个概念。
- **CSV 不带语言标注**，所以 R8 的拦截对 CSV 不生效。
