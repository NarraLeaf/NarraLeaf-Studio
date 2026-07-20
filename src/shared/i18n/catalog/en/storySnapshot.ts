/** `storySnapshot` - the Scene Snapshot side panel (变量快照) and its Dev Mode launch guard. */
export const storySnapshot = {
    empty: "Open a story scene to manage its snapshots.",
    none: "No snapshots yet.",
    getStarted: "Add a snapshot to set launch values.",
    noVariables: "No variables in scope for this scene.",
    add: "Add snapshot",
    delete: "Delete snapshot",
    defaultName: "Snapshot",
    nameAria: "Snapshot name",
    value: {
        true: "True",
        false: "False",
    },
    launch: {
        needSnapshot: "A snapshot is needed to start the game here",
        needSnapshotDetail: "Playing from a row needs concrete variable values. Create a Scene Snapshot, then try again.",
        createAction: "Create snapshot",
    },
} as const;
