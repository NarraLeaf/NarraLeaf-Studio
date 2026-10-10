/** `console` - the bottom Console panel (log channels, level filter, entries). */
export const console = {
    level: {
        error: "Error",
        warning: "Warn",
        success: "Success",
        info: "Info",
        verbose: "Verbose",
    },
    channelsAria: "Console channels",
    filterLevels: "Filter levels",
    export: "Export logs",
    exportEmpty: "No {label} logs to export",
    exportChoosingFolder: "Choose a folder to export {label} logs…",
    exportSuccess: "Exported {label} logs to {path}",
    exportFailed: "Failed to export logs: {error}",
    emptyFiltered: "No lines match the current filters",
    entryEmpty: "(empty)",
    outputFallback: "output",
    channels: {
        blueprint: "Blueprint",
        build: "Build",
        story: "Story",
        storage: "Storage",
        blueprintDescription: "Blueprint runtime and graph diagnostics",
        buildDescription: "Build, packaging, and preview pipeline output",
        storyDescription: "Story scene preview diagnostics and warnings",
        storageDescription: "Project file writes: failed saves, retries, and recoveries",
        agent: "Agent",
        agentDescription: "Calls from AI agents connected to Studio",
    },
    // What a line says it came from, where no tab's name says it already: a blueprint's Log node,
    // as opposed to the blueprint runtime's own lines on the same tab.
    sources: {
        blueprintLog: "Blueprint Log",
    },
    // A Dev Mode line on the Build tab says which state the session is in now. The steady and
    // in-between states read the way the status bar's run cell reads them; these are the two it
    // has no word for.
    devModeStatus: {
        idle: "Stopped",
        error: "Stopped on an error",
    },
} as const;
