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
} as const;
