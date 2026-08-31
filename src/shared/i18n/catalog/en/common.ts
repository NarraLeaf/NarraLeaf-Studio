/**
 * `common` - ubiquitous verbs, nouns, and chrome reused across every surface.
 * Prefer reusing these keys over re-declaring the same word in a module
 * namespace, so a single translation covers the whole app.
 */
export const common = {
    appName: "NarraLeaf Studio",
    ok: "OK",
    cancel: "Cancel",
    save: "Save",
    reset: "Reset",
    close: "Close",
    loading: "Loading…",
    add: "Add",
    remove: "Remove",
    delete: "Delete",
    rename: "Rename",
    edit: "Edit",
    duplicate: "Duplicate",
    copy: "Copy",
    // What this system calls the thing a folder opens in. Three spellings of one label, chosen
    // by platform, so nothing has to say "file manager" to a Mac.
    revealInFinder: "Show in Finder",
    revealInExplorer: "Show in File Explorer",
    revealInFileManager: "Show in File Manager",
    paste: "Paste",
    cut: "Cut",
    create: "Create",
    new: "New",
    confirm: "Confirm",
    retry: "Try again",
    continue: "Continue",
    apply: "Apply",
    clear: "Clear",
    yes: "Yes",
    no: "No",
    back: "Back",
    next: "Next",
    done: "Done",
    search: "Search",
    refresh: "Refresh",
    more: "More",
    none: "None",
    all: "All",
    name: "Name",
    description: "Description",
    actions: "Actions",
    open: "Open",
    import: "Import",
    export: "Export",
    /**
     * Taking a library out to a file and reading one back - the transform presets and the Story
     * Motions. The sentences are shared because both surfaces exchange the same kind of file and
     * fail in the same four ways.
     */
    library: {
        exportAll: "Export all",
        imported: {
            one: "Imported {count} entry.",
            other: "Imported {count} entries.",
        },
        /** Not one of ours, or not JSON at all. */
        unreadable: "That file is not an exported library.",
        /** Ours, but the other library's - a motion file offered to the preset list. */
        wrongKind: "That file holds a different kind of entry.",
        tooNew: "That file was exported by a newer version of Studio.",
        /** Ours and the right kind, but nothing in it survived reading. */
        empty: "That file holds nothing this version can read.",
        exportFailed: "The file could not be written.",
        importFailed: "The file could not be read.",
    },
    enable: "Enable",
    disable: "Disable",
    show: "Show",
    hide: "Hide",
    undo: "Undo",
    redo: "Redo",
    moveUp: "Move up",
    moveDown: "Move down",
    expand: "Expand",
    collapse: "Collapse",
    filter: "Filter",
    noMatchesFound: "No matches found",
    error: "Error",
    warning: "Warning",
    untitled: "Untitled",
} as const;
