/**
 * `game` - text the running game produces, in Dev Mode and in a shipped build alike.
 *
 * `saveLoad.refused*` is shown to the player inside the game. The rest is written to whoever is
 * watching the run: the Dev Mode issues panel where there is one, the log otherwise.
 */
export const game = {
    saveLoad: {
        refused: "This save could not be loaded. The game continues from the current point.",
        refusedOtherStory:
            "This save was written from a different version of the story. The game continues from the current point.",
        notApplied: "Load Save: \"{id}\" was not applied, and the running game is unchanged. {detail}",
        putBack: "Load Save: \"{id}\" was not applied, and the running game was put back. {detail}",
        notRestored: "Load Save: \"{id}\" was not applied, and the running game could not be put back. {detail}",
        otherStory: "Load Save: \"{id}\" was written from a different version of the story.",
        // The Older saves policy taking effect rather than a failure, so it is stated as what
        // happened: the slot was honoured, in the only way the policy allows it to be.
        relaunchedRow: "Load Save: \"{id}\" was written by another build. The story was started again on the line the save records.",
        relaunchedScene: "Load Save: \"{id}\" was written by another build and the line it records is no longer present. The story was started again at the start of that scene.",
        detail: {
            unreadable: "The save could not be read. {error}",
            missing: "No save is stored under that id.",
            malformed: "What is stored is not in the saved game format.",
            unsupported: "This save was written in a format this build cannot read.",
            policy: "Older saves from another build are not restored in this project.",
            unanchored: "This save records no position, and the story cannot be started again without one.",
            sceneGone: "The scene this save records is not in this build.",
            relaunch: "The story could not be started again at the position this save records. {error}",
            unresolvedScene: "The scene this save was in is not in the running story.",
            unresolvedElement: "The running story does not have everything this save puts on stage.",
            unresolvedAction: "The rows this save was stopped on are not in the running story.",
            savedAt: "{detail} The save's last line: {line}",
            engine: "{error}",
        },
    },
    /**
     * What the game puts on screen when it cannot carry on drawing: a failure inside the game's
     * own rendering, or a pack it could not read at all.
     *
     * Written for the player, not the author. The player's questions are whether their saves are
     * gone and how to get back in, and those are answered outright; what actually broke is one
     * click away, because the person who can act on it is whoever they send it to.
     */
    crash: {
        title: "The game stopped working",
        detail: "Saved games are not affected. Restarting reopens the game at its title screen.",
        restart: "Restart",
        showDetails: "Details",
        copyDetails: "Copy details",
        copied: "Copied to the clipboard.",
        copyFailed: "Could not copy: {error}",
        // Shown under every policy: a player who is not being told what went wrong is the one
        // who most needs to be able to hand the file to somebody who can read it.
        logAt: "The report is in {path}",
    },
} as const;
