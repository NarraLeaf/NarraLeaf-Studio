/**
 * What a shipped game says on stdout, which is nothing unless it was asked.
 *
 * Everything the main process printed carried the engine's name, and a packaged game has no console
 * to print it to - so the lines were only ever read by someone who ran the executable from a
 * terminal, which is the one reader they should not have been written for. The first thing they
 * answer is what the game is built with, and the question after that one is about its content.
 *
 * The log file is untouched. It is where the lines were always meant to go: the player can be asked
 * for it, and it sits in the profile directory rather than in front of whoever started the process.
 *
 * Comments in English per project convention.
 */

const SILENCED_CONSOLE_METHODS = [
    "log",
    "info",
    "warn",
    "error",
    "debug",
    "trace",
    "dir",
    "table",
    "group",
    "groupCollapsed",
    "groupEnd",
    "count",
    "countReset",
    "time",
    "timeEnd",
    "timeLog",
    "assert",
] as const;

/**
 * Stop the main process writing to stdout and stderr through `console`.
 *
 * The console object rather than the call sites: a shipped game has around a hundred of them plus
 * whatever its dependencies print, and one added later would put the engine's name back on stdout
 * without anyone noticing. Replacing the methods covers both, and there is nothing in the main
 * process that reads console output back.
 *
 * What it cannot cover, and nothing in JavaScript can: Chromium's own C++ logging, and the stack
 * trace Electron prints when the main script throws before it runs. Both are quiet in an ordinary
 * launch of a working build.
 */
export function silenceRuntimeConsole(): void {
    const noop = (): void => {};
    for (const method of SILENCED_CONSOLE_METHODS) {
        (console as unknown as Record<string, unknown>)[method] = noop;
    }
}
