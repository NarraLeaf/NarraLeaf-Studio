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
        notRestored: "Load Save: \"{id}\" was not applied, and the running game could not be put back. {detail}",
        otherStory: "Load Save: \"{id}\" was written from a different version of the story.",
        detail: {
            unreadable: "The save could not be read. {error}",
            missing: "No save is stored under that id.",
            malformed: "What is stored is not in the saved game format.",
            unresolved: "Not found in the running story: {ids}.",
            engine: "{error}",
        },
    },
} as const;
