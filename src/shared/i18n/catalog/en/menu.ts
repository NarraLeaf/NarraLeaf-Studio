/** `menu` — native application menu (main process, {@link menuManager.ts}).
 *
 * Every `role:` item needs an explicit label here: macOS localizes role items to the
 * *system* language only, so without these the native menu ignores the in-app
 * language picker. `{name}` interpolates the application display name.
 */
export const menu = {
    app: {
        about: "About {name}",
        preferences: "Preferences…",
        services: "Services",
        hide: "Hide {name}",
        hideOthers: "Hide Others",
        unhide: "Show All",
        quit: "Quit {name}",
    },
    file: {
        title: "File",
        new: "New Workspace",
        open: "Open Workspace",
        export: "Export Project",
        close: "Close Workspace",
    },
    edit: {
        title: "Edit",
        undo: "Undo",
        redo: "Redo",
        cut: "Cut",
        copy: "Copy",
        paste: "Paste",
        pasteAndMatchStyle: "Paste and Match Style",
        delete: "Delete",
        selectAll: "Select All",
        speech: {
            title: "Speech",
            startSpeaking: "Start Speaking",
            stopSpeaking: "Stop Speaking",
        },
    },
    dev: {
        title: "Develop",
        devMode: "Dev Mode",
        preview: "Preview Mode",
        build: "Build Release",
    },
    window: {
        title: "Window",
        minimize: "Minimize",
        zoom: "Zoom",
        front: "Bring All to Front",
        leftSidebar: "Show Sidebar",
        bottomPanel: "Show Bottom Bar",
        rightSidebar: "Show Right Bar",
    },
    // The View menu was removed from the menu bar; the strings stay for future use.
    help: {
        title: "Help",
        welcome: "Open Welcome",
        docs: "Documentation",
    },
} as const;
