/** `menu` - native application menu (main process, {@link menuManager.ts}).
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
        /**
         * The overlay shown after the first of the two ⌘Q presses, when `app.confirmQuit` is on
         * (macOS only, see {@link confirmQuit.ts}). Not a menu item, but the same gesture as the one
         * above and the only other text the quit produces, so it is kept beside it.
         */
        pressAgainToQuit: "Press ⌘Q again to quit",
    },
    /**
     * The status-bar item's context menu (Windows and Linux; macOS has none - see
     * {@link trayManager.ts}). Studio stays running with no windows open, so this menu is the
     * only way back in, and Quit here is the only way out.
     */
    tray: {
        openLauncher: "Open Launcher",
        checkForUpdates: "Check for Updates…",
        quit: "Quit {name}",
        /**
         * Shown once, from the tray icon, the first time every window is closed. Windows files a
         * new notification icon into the overflow flyout, so without this the app looks like it
         * shut down and left nothing behind.
         */
        residencyNotice: {
            title: "NarraLeaf Studio is still running",
            body: "It stays in the notification area so downloads and updates can finish. Right-click its icon to reopen or quit.",
        },
    },
    file: {
        title: "File",
        new: "New Workspace",
        open: "Open Workspace",
        openRecent: "Open Recent Workspaces",
        noRecent: "No Recent Workspaces",
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
    // Only the menu's own title lives here. Every entry inside it reuses the Run dropdown's labels
    // (`actions.run.*`, `test.action.*`), so the two places that start the same four things cannot
    // end up calling them different names.
    dev: {
        title: "Develop",
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
        feedback: "Send Feedback",
        about: "About {name}",
    },
} as const;
