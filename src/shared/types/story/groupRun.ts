/**
 * How the rows inside a `/sequence`, `/parallel` or `/race` group run.
 *
 * A group row stores two fields, `control` and `mode`, and both describe the same thing: `mode` is
 * the engine call the group compiles to, and `control` is the word the row was created with. The
 * compiler runs `mode` whenever it is set and falls back to `control` only when it is not, so a row
 * holding `control: "sequence"` with `mode: "all"` runs its rows side by side. Everything that shows
 * or reasons about a group reads it through here, so the editor never says one thing while the game
 * does another.
 *
 * Read as two questions, which is also how the script dialect writes it (a verb plus `async`):
 *   - how the rows run against each other: one after another, side by side, or side by side until the
 *     first one finishes;
 *   - whether the story waits for the group before going on to the row after it.
 *
 * `repeat` is not covered: its body always runs its rows side by side and `mode` never reaches it.
 *
 * Comments in English per project convention.
 */

/** The engine call a group compiles to. */
export type StoryGroupRunMode = "do" | "doAsync" | "all" | "allAsync" | "any";

/** How a group's rows run against each other, by the command that names it. */
export type StoryGroupKind = "sequence" | "parallel" | "race";

/** The run a group row makes: the engine call the compiler hands it, as the compiler decides it. */
export function resolveStoryGroupRunMode(payload: { control: StoryGroupKind | "repeat"; mode?: StoryGroupRunMode }): StoryGroupRunMode {
    return payload.mode ?? (payload.control === "parallel" ? "all" : payload.control === "race" ? "any" : "do");
}

/** Which kind of group a run is: the command an author would write for it. */
export function storyGroupKindOfMode(mode: StoryGroupRunMode): StoryGroupKind {
    return mode === "all" || mode === "allAsync" ? "parallel" : mode === "any" ? "race" : "sequence";
}

/** Whether the story waits for the group to finish before running the row after it. */
export function storyGroupWaits(mode: StoryGroupRunMode): boolean {
    return mode !== "doAsync" && mode !== "allAsync";
}

/**
 * The run for a kind of group, waiting or not. A race always waits - for its first row to finish -
 * because the engine has no race that does not.
 */
export function storyGroupRunModeFor(kind: StoryGroupKind, waits: boolean): StoryGroupRunMode {
    if (kind === "race") {
        return "any";
    }
    if (kind === "parallel") {
        return waits ? "all" : "allAsync";
    }
    return waits ? "do" : "doAsync";
}
