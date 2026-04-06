# P3: Visual Editor M2-B + M3 (追溯性实施记录)

**Status:** Implemented in-repo (追溯记录，2026-04).  
**对应里程碑：** `visual-editor-milestones.md` §5.2（M2-B）、§6（M3）。

## 已交付范围

- **M2-B 四件套 widget**：`nl.stack`、`nl.scroll`、`nl.spacerDivider`、`nl.listRepeater` — 注册于 `src/renderer/lib/ui-editor/widget-modules/builtin/index.ts`，各模块含 `inspector` / `renderer` 等。
- **流式布局与画布交互**：`EditorNodeWrapper`、`UI_FLOW_LAYOUT_PARENT_ELEMENT_TYPES`（见 `visual-editor.md` §4.2）。
- **M3 官方范式与示例目录**：`project/examples/visual-editor/` 下六组目录（`dialog-surface`、`choice-menu`、`notification-toast`、`settings-layer`、`save-load-grid`、`overlay-pause`），与 `visual-editor.md` §4.4 表一致；各含 `editor/ui/uidoc.json` 与 `uigraphs.json` 壳。

## 明确非目标（保持里程碑原意）

- 编辑器内模板库 / preset / “New from pattern”。
- 将 M3 升格为独立 VN 领域主模型。

## 示例与 schema 语义（P7 对齐）

- 示例内 `uigraphs.json` 仍为 **磁盘可读** 的较早形态（如 `blueprintDocument.schemaVersion: 2` 与 `ownerIndex`），用于对照结构。
- 项目在 Studio 中打开时，`UIGraphService.migrateIfNeeded` 会将 **壳层** 升到当前 `UI_GRAPH_DOCUMENT_SCHEMA_VERSION`，并通过 `migrateBlueprintDocumentToLatest` 升级 `blueprintDocument`。**权威写入形态** 以加载迁移后的类型与 `LocalBlueprintService` 行为为准，而非手工复制示例 JSON 时的字面版本号。

## 验收锚点

- 八件套与示例目录可按路径枚举核对。
- `npx tsc --noEmit -p src/renderer/tsconfig.json` 通过。

## 相关计划链

- 前置：`p1-ve-m2a-bp-m2-plan.md`、`p2-bp-m3min-ve-m4lite-plan.md`
- 后续缺口收口：`p7-doc-gap-closure-plan.md`
