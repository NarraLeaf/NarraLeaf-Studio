import type { LocaleNamespace } from "../types";

/** `manuscript` - 剧本文档：经粘贴向导导入 Word、Fountain 与表格剧本，并导出 PDF 或 Word 可读剧本。 */
export const manuscript = {
    importCommand: "导入剧本文档…",
    importPickerTitle: "导入剧本文档",
    wizardTitle: "导入 {file}",
    importAction: "导入",
    sceneCount: {
        one: "{count} 个场景",
        other: "{count} 个场景",
    },
    table: {
        sheet: "工作表",
        headerRow: "首行为列名",
        role: {
            speaker: "说话人",
            text: "台词",
            note: "备注",
            scene: "场景",
        },
        none: "无",
        column: "第 {n} 列",
        columnNamed: "第 {n} 列：{name}",
    },
    error: {
        unreadable: "无法读取 {file}",
        notOffice: "{file} 不是 Word 文档或电子表格",
        tooLarge: "{file} 过大，无法导入",
        empty: "{file} 中没有台词",
        unsupported: "{file} 不是受支持的剧本格式",
        failed: "导入未能完成",
        writeFailed: "无法写入 {file}",
    },
    imported: {
        one: "已导入 {count} 个场景",
        other: "已导入 {count} 个场景",
    },
    historyLabel: "导入剧本文档",
    defaultSceneName: "导入的场景",

    exportCommand: "导出可读剧本…",
    exportSceneCommand: "将场景导出为可读剧本…",
    exportTitle: "导出可读剧本",
    format: {
        label: "格式",
        pdf: "PDF",
        docx: "Word 文档",
    },
    scenes: {
        label: "场景",
        all: "全部场景",
        selectAll: "全选",
        selectNone: "清空",
    },
    speakers: {
        label: "角色",
        all: "全部角色",
        lineCount: {
            one: "{count} 句",
            other: "{count} 句",
        },
    },
    context: {
        label: "每句台词前的上下文",
        none: "无",
        lines: {
            one: "{count} 句",
            other: "{count} 句",
        },
    },
    include: {
        label: "包含",
        ids: "行 ID",
        directions: "舞台指示与备注",
        branches: "选项分支",
    },
    exportAction: "导出",
    exported: "剧本已导出到 {path}",
    noScenes: "请至少选择一个场景",
    noLines: "没有符合所选条件的台词",
    linesFor: "{names} 的台词",
    unnamedSpeaker: "未命名",
    gap: "已省略若干行",
    pageOf: "第 {page} 页，共 {total} 页",
} satisfies LocaleNamespace<"manuscript">;
