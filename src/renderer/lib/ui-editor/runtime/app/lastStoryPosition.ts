import type { GameCrashStoryPosition } from "@shared/types/gameRuntime";

/**
 * The last place the story got to, kept where a torn-down tree can still be asked.
 *
 * Read by the crash screen, which is drawn at the moment `GameApp` has stopped rendering: every ref
 * that knows where the player was belongs to a component that is no longer there, and a hook cannot
 * be called from an error boundary's child. Module state for the same reason the crash policy is -
 * it has to survive the thing whose failure is being reported.
 *
 * Written while the game is healthy, never computed while it is not. The crash path reads three
 * strings and calls nothing, so a position that could not be worked out simply is not there; the
 * report says nothing was running rather than guessing.
 *
 * A whole-module singleton, which is honest here: one page runs one game.
 */

let position: GameCrashStoryPosition | null = null;

/**
 * The story and scene the engine has just entered. Clears the row, which belongs to the scene that
 * has just been left.
 */
export function recordStoryScene(storyName: string, sceneName: string): void {
    position = { storyName, sceneName };
}

/**
 * The row the play head is standing on, when it can name one.
 *
 * Ignored while no scene is recorded: a row without the scene around it names nothing an author can
 * act on, and a row left over from a scene that has ended would name the wrong thing.
 */
export function recordStoryRow(rowId: string | undefined): void {
    if (!position) {
        return;
    }
    position = rowId
        ? { storyName: position.storyName, sceneName: position.sceneName, rowId }
        : { storyName: position.storyName, sceneName: position.sceneName };
}

/** Nothing is running any more: a scene has ended, or the session has. */
export function clearStoryPosition(): void {
    position = null;
}

export function readStoryPosition(): GameCrashStoryPosition | null {
    return position;
}
