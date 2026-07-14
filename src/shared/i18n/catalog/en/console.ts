/** `console` — the bottom Console panel (log channels, level filter, entries). */
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
    emptyFiltered: "No lines match the current filters",
    emptyChannel: "No {label} output yet",
    entryEmpty: "(empty)",
    outputFallback: "output",
    channels: {
        blueprint: "Blueprint",
        build: "Build",
        story: "Story",
        blueprintDescription: "Blueprint runtime and graph diagnostics",
        buildDescription: "Build, packaging, and preview pipeline output",
        storyDescription: "Story scene preview diagnostics and warnings",
    },
} as const;
