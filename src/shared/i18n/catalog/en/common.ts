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
    /**
     * One count with its noun, read with `tn` and dropped into a sentence that carries several
     * counts at once ("1 error, 3 warnings, 0 info"). A plural group covers one number; a tally of
     * three would need a key per combination, so each number takes its own form here and the
     * tally's template only joins them. Shared by the project check, the test report and Dev Mode,
     * which count the same three severities.
     */
    count: {
        errors: {
            one: "{count} error",
            other: "{count} errors",
        },
        warnings: {
            one: "{count} warning",
            other: "{count} warnings",
        },
        infos: {
            one: "{count} info",
            other: "{count} info",
        },
    },
    /**
     * What a screen reader is told on a node graph - the blueprint editor, the scene flow - about
     * working it from the keyboard. The graph library's own sentences are English, and it reads them
     * out in every language unless it is handed these.
     */
    flowCanvas: {
        nodeHelp: "Press Enter or Space to select a node. Press Delete to remove it and Escape to cancel.",
        movableNodeHelp:
            "Press Enter or Space to select a node, then move it with the arrow keys. Press Delete to remove it and Escape to cancel.",
        wireHelp: "Press Enter or Space to select a wire. Press Delete to remove it and Escape to cancel.",
        nodeMoved: "Moved the selected node {direction}. Position x {x}, y {y}",
        up: "up",
        down: "down",
        left: "left",
        right: "right",
    },
} as const;
