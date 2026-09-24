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
        // Not a finding: a project whose routes are separate stories writes saves in each of
        // them, and reaching one from a title screen means putting its story up first.
        storyStarted: "Load Save: \"{id}\" was written in another of the project's stories, which was started to receive it.",
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
            storySwitch: "The story this save belongs to could not be put on the stage. {error}",
            unresolvedScene: "The scene this save was in is not in the running story.",
            unresolvedElement: "The running story does not have everything this save puts on stage.",
            unresolvedAction: "The rows this save was stopped on are not in the running story.",
            savedAt: "{detail} The save's last line: {line}",
            engine: "{error}",
        },
    },
    /**
     * What the running game tells whoever is watching the run - the Dev Mode Issues panel, the log
     * of a shipped build. Nodes are named by their canvas titles (`{node}` is already translated)
     * and nothing carries an id; a raw `{error}` is the engine's or the host's own account.
     */
    run: {
        voicePlayFailed: "The voice recording of this line could not be played.",
        choiceVoicePlayFailed: "The voice recording of this option could not be played.",
        savedVariableUndeclared: "“{node}”: the running story does not declare this saved variable.",
        valueNotSerializable: "“{node}”: a saved variable can only hold a value that fits in a save file.",
        variablesNotSerializable: "Saved and persistent variables can only hold values that fit in a save file.",
        persistenceUnavailable: "Persistent variables are not available here.",
        storyMissing: "“{node}”: the story it names is no longer in this project.",
        sceneMissing: "“{node}”: the scene it names is no longer in this project.",
        noChoiceMenu: "“{node}”: no menu is showing.",
        noChoiceAtIndex: "“{node}”: the menu has no option {index}.",
        saveCaptureFailed: "“{node}”: the screenshot for this save could not be taken. The save was written without one.",
        relaunchUnavailable: "There is no running story to start again.",
        // Why a load could not put a story on the stage; they sit inside `saveLoad.detail.*`.
        storyNotRestartable: "The story that was running could not be started again.",
        saveStoryMissing: "The story this save belongs to is not in this build.",
        storyCannotStart: "A story cannot be started here.",
        noGameToResume: "No game came up to resume into.",
        // A reload or a relaunch that could not put the author back where they were.
        resume: {
            relaunchRowGone: "The row this run started from no longer exists; the scene started from its first row.",
            sceneGone: "The scene being played no longer exists; the story started from the beginning.",
            storyGone: "The story being played no longer exists; the game started from the beginning.",
            rowGoneBefore: "The row being played no longer exists; play resumed from the row before it.",
            rowGoneSceneStart: "The row being played no longer exists; play resumed from the start of the scene.",
        },
        // A language change while a playthrough is running.
        language: {
            noRestart: "The language changed during a playthrough and the game cannot restart here. Text on screen, the backlog and any voice already playing stay in the previous language.",
            restartFresh: "The language changed; the game restarts without keeping the playthrough.",
            saveFailed: "The language changed, but the playthrough could not be saved, so the game did not restart: {error}",
            parked: "The playthrough was set aside for the language change; the game restarts.",
            restoring: "A playthrough set aside for a language change is being restored.",
            resumeFailed: "The playthrough could not be resumed after the language change: {error}",
            resumeRefused: "The playthrough set aside for the language change was not accepted; it is still stored.",
            restored: "The playthrough set aside for the language change was restored.",
            returnFailed: "The game could not return to its start after the language change: {error}",
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
        // The one file the player can send. Named for what it is rather than for what it is for:
        // where it goes next is theirs to decide, and nothing here sends it anywhere.
        saveReport: "Save report",
        reportSaved: "The report is in {path}",
        reportFailed: "Could not save the report: {error}",
        // Shown under every policy: a player who is not being told what went wrong is the one
        // who most needs to be able to hand a file to somebody who can read it. The log, by its
        // own name, because the report above is now a different file in the same folder.
        logAt: "The log is in {path}",
        // The failure itself where the page came up but its preload did not, so there is no way
        // through to the pack, the saves or anything else. Named the way the process's own report
        // of a dead renderer is, because both are read by whoever the player sends them to.
        bridgeUnavailable: "The game's runtime bridge did not load",
    },
    /**
     * The web export refusing to be a second copy of a game that is already open.
     *
     * Two tabs of one export share a single store, so the second one would be writing over the
     * first one's saves. Nothing is said about that: what the player needs is the state and the way
     * out of it, and both fit in a line.
     */
    session: {
        title: "The game is already open",
        detail: "It is running in another browser tab. Close that tab, then reload this page.",
        reload: "Reload",
    },
} as const;
