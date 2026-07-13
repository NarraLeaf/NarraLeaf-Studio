/** `menu` — native application menu (main process, {@link menuManager.ts}). */
export const menu = {
    app: {
        preferences: "Preferences…",
    },
    file: {
        title: "File",
        new: "New Workspace",
        open: "Open Workspace",
        export: "Export Project",
        close: "Close Workspace",
    },
    view: {
        title: "View",
    },
    window: {
        title: "Window",
    },
    help: {
        title: "Help",
        welcome: "Open Welcome",
        docs: "Documentation",
    },
} as const;
