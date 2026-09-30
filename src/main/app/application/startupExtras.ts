export interface StartupFacts {
    /** Whether this launch is `--build`, `--test` or `--lint`. See `BaseApp.isCommandLineRun`. */
    commandLineRun: boolean;
    /** Whether this is a development launch. See `BaseApp.isDevMode`. */
    devMode: boolean;
}

export interface StartupExtras {
    /** The status-bar item Studio lives in once its windows are gone. See `TrayManager`. */
    statusBarItem: boolean;
    /** The delayed check for a newer Studio, which is a request to GitHub. See `UpdateManager`. */
    launchUpdateCheck: boolean;
    /** Crashpad, collecting native crash dumps into the profile. Never uploaded. */
    nativeCrashDumps: boolean;
    /** The file that says a session is in progress, so the next launch can spot one that died. */
    sessionMarker: boolean;
    /** The socket `dev-electron.js` broadcasts rebuilds on, which reloads this app's windows. */
    developmentReloadSocket: boolean;
    /** The local HTTP server `project/app/debug.js` reads this app's logs over. */
    developmentDebugServer: boolean;
}

/**
 * What a launch starts at boot besides the thing it was launched to do.
 *
 * Every one of these exists for the person in front of Studio: a handle to click when the last
 * window is gone, an offer of a newer version, the evidence for "your last session did not shut
 * down cleanly", a reload loop, a log feed. A command-line run - `--build`, `--test`, `--lint` -
 * has no person. It is a tool: it does the job, says what happened on its console and in its
 * report, and leaves nothing behind. So it starts none of them, and each for a reason of its own:
 *
 *   - **The status-bar item** put an icon in an operator's notification area for the few seconds
 *     the job lasted, offering a launcher and a Settings panel belonging to a process already on
 *     its way out. On a build agent it is noise nobody is there to see; on a developer's machine
 *     it is a flicker they cannot explain. Nothing else needs it either, because the one caller
 *     that reads it - `App.handleLastWindowClosed` - already leaves a run's windows to the run.
 *   - **The launch update check** is a request to GitHub that the line did not ask for. A run must
 *     not phone home at all: on an agent the request can hang behind a proxy, fail the sandbox, or
 *     simply be forbidden, and none of that is anything to do with the answer the job was run for.
 *   - **Native crash dumps** lay a `Crashpad` database into the profile and keep a watcher up for
 *     the length of the process. Nothing is ever uploaded, so this is a footprint question rather
 *     than a network one - and the profile is very often one a `--*-user-data-dir` lent to the run
 *     and deleted after it, so a dump written there is one nobody is ever handed. How a run failed
 *     is what its exit code and its report are for.
 *   - **The session marker** is left for the *next* launch to find, and a run ends by `exit()` with
 *     the code it decided - which skips `will-quit`, so the marker it wrote stayed behind every
 *     single time. Every later run then opened on "the previous session did not shut down cleanly"
 *     about a run that had exited perfectly well with 0. It is also somebody else's file: a marker
 *     the author's own last session left is a crash this run must neither claim nor clear away.
 *   - **The development reload socket** opens a connection nothing asked for, and a rebuild landing
 *     mid-run reloads the very window the run is being answered in - a check reporting on a page
 *     that restarted underneath it.
 *   - **The development debug server** listens on a fixed port, so two runs at once leave one of
 *     them failing to bind for a reason neither of them can explain.
 *
 * Stated as one list rather than as six conditions at six call sites, because the thing that goes
 * wrong here is a seventh being added to boot without anyone asking the question.
 */
export function decideStartupExtras(facts: StartupFacts): StartupExtras {
    const forAPerson = !facts.commandLineRun;
    return {
        statusBarItem: forAPerson,
        launchUpdateCheck: forAPerson,
        nativeCrashDumps: forAPerson,
        sessionMarker: forAPerson,
        // The two development conveniences are exactly that - they exist only in a checkout, and a
        // command-line run from a checkout is as much a tool as one from an installed Studio.
        developmentReloadSocket: forAPerson && facts.devMode,
        developmentDebugServer: forAPerson && facts.devMode,
    };
}
