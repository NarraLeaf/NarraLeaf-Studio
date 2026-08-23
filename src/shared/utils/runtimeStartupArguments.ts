/**
 * What a shipped game accepts on its own command line.
 *
 * Electron has no allowlist of its own: Chromium's parser takes every switch compiled into the
 * binary, which in Electron 38 is thousands of them. Among those are switches that open a debugger
 * port, weaken the renderer sandbox, redirect name resolution, or run the browser's child processes
 * through a prefix command. A shipped game needs none of them, so it states the few it does accept
 * and refuses to start on anything else.
 *
 * This is a cost, not a boundary. A player owns the machine the game runs on: they can edit the
 * shortcut, replace the binary with a stock Electron of the same version, or attach a debugger to
 * the process. What the refusal removes is the cheapest route - a switch typed into a launcher.
 *
 * Comments in English per project convention.
 */

/**
 * The switches a shipped game still accepts, and why each one is here.
 *
 * Every entry is a statement about the player's own hardware, and none of them reaches the game's
 * content, its network or its process boundaries. Anything that would is left out, the sandbox
 * switches included however often a support thread recommends one.
 */
export const ALLOWED_STARTUP_SWITCHES: readonly string[] = [
    // The standard answer to a driver that cannot composite. A game that draws on the CPU is better
    // than a game that does not draw.
    "disable-gpu",
    "disable-gpu-compositing",
    // The other half of that answer: which backend to draw through.
    "use-angle",
    "use-gl",
    // A display whose reported scale is wrong, which is a fact about the player's monitor.
    "force-device-scale-factor",
    // Chromium's own locale, which is what the chrome around the game is drawn in. The game's
    // language is a player setting and is not this.
    "lang",
];

/**
 * Chromium's switch prefixes, which are not the same on every platform.
 *
 * Windows also reads `-` and `/` and lower-cases the name; POSIX reads `--` and `-`. Matching this
 * matters in both directions: a prefix not read here is a switch that slips past, and one read here
 * that Chromium does not read is a launch refused over an ordinary argument.
 */
function switchPrefixes(platform: NodeJS.Platform): string[] {
    return platform === "win32" ? ["--", "-", "/"] : ["--", "-"];
}

export type StartupArgumentReview = {
    /**
     * The arguments this game does not accept, as they were written.
     *
     * Empty means the launch may proceed. Anything in it is the reason it may not, and is what the
     * log line names - a switch typed into a launcher is the usual cause and the only thing the
     * person reading that line can act on.
     */
    refused: string[];
    /**
     * Every switch name seen, refused or not, for taking off the command line before Chromium
     * reads it.
     *
     * Removing beats quitting on its own, and the difference is measurable. On Electron 38 with
     * `--remote-debugging-port`, quitting from the first line of the main script still left the
     * port accepting connections about 130ms in; removing the switch from that same line meant it
     * never listened at all. Several switches are read after the main script runs, and those are
     * exactly the ones a removal reaches.
     */
    removable: string[];
};

/**
 * Read a command line the way Chromium reads it, and say what a shipped game will not take.
 *
 * `args` is the command line without the executable - `process.argv.slice(1)` plus `execArgv`,
 * which is where a Node-level switch lands.
 */
export function reviewStartupArguments(
    args: readonly string[],
    platform: NodeJS.Platform,
    allowed: readonly string[] = ALLOWED_STARTUP_SWITCHES,
): StartupArgumentReview {
    const prefixes = switchPrefixes(platform);
    const permitted = new Set(allowed);
    const refused: string[] = [];
    const removable: string[] = [];
    let switchesEnded = false;

    for (const argument of args) {
        if (switchesEnded) {
            refused.push(argument);
            continue;
        }
        // A bare `--` ends switch parsing in Chromium and everything after it is a file name. A
        // shipped game is not opened with one.
        if (argument === "--") {
            switchesEnded = true;
            continue;
        }
        const prefix = prefixes.find(candidate => argument.startsWith(candidate) && argument.length > candidate.length);
        if (!prefix) {
            refused.push(argument);
            continue;
        }
        const body = argument.slice(prefix.length);
        const separator = body.indexOf("=");
        const rawName = separator >= 0 ? body.slice(0, separator) : body;
        const name = platform === "win32" ? rawName.toLowerCase() : rawName;
        removable.push(name);
        // The process serial number macOS hands a Finder-launched application. Chromium ignores it;
        // refusing it would refuse the ordinary way of opening the game.
        if (platform === "darwin" && name.startsWith("psn_")) {
            continue;
        }
        if (!permitted.has(name)) {
            refused.push(argument);
        }
    }

    return { refused, removable };
}

/**
 * The switches that ask for a debugger, as opposed to merely not being allowed.
 *
 * A build made under the experimental debuggable condition accepts any command line, and this is
 * how it tells a launch that came to inspect it from one that came to play: DevTools opens only
 * for the first. Not a refusal list - the refusal is the allowlist above, and naming dangerous
 * switches one by one is what that replaced.
 */
export const DEBUGGING_SWITCHES: readonly string[] = [
    "remote-debugging-port",
    "remote-debugging-pipe",
    "inspect",
    "inspect-brk",
    "inspect-port",
    "inspect-publish-uid",
];

/** Whether this command line asked for a debugger. */
export function hasDebuggingSwitch(args: readonly string[], platform: NodeJS.Platform): boolean {
    const asked = new Set(DEBUGGING_SWITCHES);
    return reviewStartupArguments(args, platform, []).removable.some(name => asked.has(name));
}
