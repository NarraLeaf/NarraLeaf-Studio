/**
 * Every exit code a game's own process ends with on purpose, in one table.
 *
 * A launcher, a storefront or a script that started the game reads nothing but this number, so each
 * way the game can end has one of its own, and 0 means only what it says:
 *
 * | Code | Meaning |
 * |------|---------|
 * | 0 | The game ran and was closed - by the player, by the Quit Application node, or because another copy was already running and was raised instead. |
 * | 1 | It did not start: its own content could not be read, the window could not be set up from it, or its page would not load. |
 * | 2 | It did not start: the command line carries something this build does not accept. |
 * | 3 | It did not start: its content was written by a newer Studio than this build reads. |
 * | 4 | It crashed after it had started: an exception nobody caught, a window that kept dying, or a page that would not load again. The player was told, what could be saved was, and it closed. |
 *
 * 1 to 3 end a launch before the game runs (see `startupRefusal`, and `windowCrashHandling` for a
 * page that never loaded); 4 ends one that was running (see `mainProcessErrors`, and
 * `windowCrashHandling` for its window). Anything else - a signal, a code Chromium chose, a
 * debugger's kill - was not the game's decision.
 *
 * Comments in English per project convention.
 */
export const GAME_EXIT_CODES = {
    closed: 0,
    failedToStart: 1,
    commandLineRefused: 2,
    contentTooNew: 3,
    crashed: 4,
} as const;

export type GameExitCode = (typeof GAME_EXIT_CODES)[keyof typeof GAME_EXIT_CODES];
