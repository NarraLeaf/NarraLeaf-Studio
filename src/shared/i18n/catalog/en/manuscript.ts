/**
 * `manuscript` - script documents: importing Word, Fountain and spreadsheet scripts through the paste
 * wizard, and exporting a readable script as PDF or Word.
 */
export const manuscript = {
    importCommand: "Import Script Document…",
    importPickerTitle: "Import Script Document",
    wizardTitle: "Import {file}",
    importAction: "Import",
    sceneCount: {
        one: "{count} scene",
        other: "{count} scenes",
    },
    table: {
        sheet: "Sheet",
        headerRow: "First row holds column names",
        role: {
            speaker: "Speaker",
            text: "Line",
            note: "Note",
            scene: "Scene",
        },
        none: "None",
        column: "Column {n}",
        columnNamed: "Column {n}: {name}",
    },
    error: {
        unreadable: "{file} could not be read",
        notOffice: "{file} is not a Word document or spreadsheet",
        tooLarge: "{file} is too large to import",
        empty: "{file} contains no lines",
        unsupported: "{file} is not a supported script format",
        failed: "The import could not be completed",
        writeFailed: "{file} could not be written",
    },
    imported: {
        one: "Imported {count} scene",
        other: "Imported {count} scenes",
    },
    historyLabel: "Import script document",
    defaultSceneName: "Imported Scene",

    exportCommand: "Export Readable Script…",
    exportSceneCommand: "Export Scene as Readable Script…",
    exportTitle: "Export Readable Script",
    format: {
        label: "Format",
        pdf: "PDF",
        docx: "Word document",
    },
    scenes: {
        label: "Scenes",
        all: "All scenes",
        selectAll: "Select all",
        selectNone: "Clear",
    },
    speakers: {
        label: "Speakers",
        all: "All speakers",
        lineCount: {
            one: "{count} line",
            other: "{count} lines",
        },
    },
    context: {
        label: "Context before each line",
        none: "None",
        lines: {
            one: "{count} line",
            other: "{count} lines",
        },
    },
    include: {
        label: "Include",
        ids: "Line IDs",
        directions: "Stage directions and notes",
        branches: "Choices",
    },
    exportAction: "Export",
    exported: "Script exported to {path}",
    noScenes: "Select at least one scene",
    noLines: "No lines match the selection",
    linesFor: "Lines for {names}",
    unnamedSpeaker: "Unnamed",
    gap: "Lines omitted",
    pageOf: "Page {page} of {total}",
} as const;
