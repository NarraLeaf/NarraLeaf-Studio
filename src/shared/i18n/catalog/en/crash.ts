/**
 * `crash` - what Studio says when something has already gone wrong: the in-app screen a window
 * shows in place of its interface, and the three native dialogs the main process puts up when a
 * window's page process dies, stops answering, or the main process itself cannot continue.
 *
 * One namespace for all four because they answer the same question in four places, and text that
 * disagreed about whether unsaved work survives would be worse than text in the wrong file. Native
 * rather than in-app for three of them: by the time they are shown, the window that would have
 * drawn them is the thing that failed.
 */
export const crash = {
    /** The window-level screen, shown in place of everything the window was drawing. */
    screen: {
        title: "This window stopped working",
        detail: "Other Studio windows are unaffected. Reloading builds this window again from the files on disk.",
        reload: "Reload window",
        close: "Close window",
        showStackTrace: "Show stack trace",
        copyDetails: "Copy details",
        copied: "Error details copied to the clipboard.",
        copyFailed: "Could not copy: {error}",
        exportLogs: "Export logs",
        exported: "Logs saved to {path}",
        exportFailed: "Could not export the logs: {error}",
        /** Outcome of the save that runs by itself as this screen appears. */
        saved: "Unsaved changes were written to disk.",
        saveFailed: "Unsaved changes could not be written to disk.",
    },
    /**
     * The page process exited on its own: out of memory, a GPU fault, or killed by the system.
     * Nothing in the window is left to draw with, so this one has to be native.
     */
    rendererGone: {
        title: "Window stopped working",
        message: "A NarraLeaf Studio window stopped working.",
        messageProject: "The window for {project} stopped working.",
        detail: "Reason: {reason}. Changes that had not been written to disk are lost.",
        /** Same failure, after it has already happened several times in a row. */
        detailRepeated: "Reason: {reason}. This window has stopped working repeatedly, so it will not be reloaded again.",
        reload: "Reload",
        close: "Close window",
    },
    /** The window is still there but has not answered for some time. */
    unresponsive: {
        title: "Window not responding",
        message: "A NarraLeaf Studio window is not responding.",
        messageProject: "The window for {project} is not responding.",
        detail: "Reloading discards changes that have not been written to disk.",
        wait: "Keep waiting",
        reload: "Reload",
    },
    /** The main process hit an error that leaves it unable to carry on. */
    fatal: {
        title: "NarraLeaf Studio has to close",
        message: "NarraLeaf Studio ran into an error it cannot continue from.",
        detail: "The report is in {path}.",
        restart: "Restart",
        quit: "Quit",
    },
} as const;
