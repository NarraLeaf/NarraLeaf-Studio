/** `storySnapshot` - the Scene Snapshot side panel (变量快照) and its Dev Mode launch guard. */
export const storySnapshot = {
    empty: "Open a story scene to manage its snapshots.",
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
        needSnapshotDetail: "Playing from a row requires concrete variable values. Create a scene snapshot first.",
        createAction: "Create snapshot",
        distrusted: "This project is not trusted, so the game cannot start here",
        distrustedDetail: "Playing from a row runs the project. Trust it in Settings to allow that.",
    },
} as const;
