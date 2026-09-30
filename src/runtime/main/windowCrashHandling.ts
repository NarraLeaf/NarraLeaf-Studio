import type { BrowserWindow } from "electron";
import { GAME_RUNTIME_PROTOCOL, type GameCrashPolicy } from "@shared/types/gameRuntime";
import type { GameLaunchTiming } from "@shared/types/gameLaunchTiming";
import { buildGameRuntimeIndexUrl } from "@shared/utils/gameRuntimeIndexUrl";
import { isCrashLooping, recordCrash } from "@shared/utils/crashLoop";
import type { RuntimeLogSink } from "./runtimeLog";
import type { ShellText } from "./shellText";

/**
 * The ways a game window can stop working without anything throwing in JavaScript: its page process
 * exits, it stops answering, its preload never ran, or the game's page will not load into it.
 *
 * All of them were silent before this existed. The page process dying takes the window down with it,
 * so what the player saw was a game that closed itself; a hang looked like a very long load; and a
 * page that would not load left an empty window, or one that said "Not found", running for nobody.
 *
 * Its own module, with everything it touches passed in, because the alternative is a set of module
 * globals in `main.ts` that only a running game can reach - and "what happens when the renderer
 * dies" is precisely the question nobody can answer by reading. Here it can be wired to a real
 * window and the renderer really killed.
 */
export interface WindowCrashHost {
    log: RuntimeLogSink;
    /** Named in the native reports, so the player has somewhere to look. */
    logPath: string;
    /** The game's own name, for dialog titles. */
    displayName(): string;
    /** Everything said to the player here, in the machine's language. */
    text: ShellText;
    /** What this build does about crashes, read fresh: the pack settles it after the first window. */
    policy(): GameCrashPolicy;
    /** True once the app is on its way out; nothing here may interrupt that. */
    isQuitting(): boolean;
    /**
     * The game's page never loaded: a launch that did not start. Ends the process the way every
     * such launch ends - the log, one line on standard error, the fatal box headed `headline`,
     * `GAME_EXIT_CODES.failedToStart` (see `startupRefusal`).
     */
    failedToStart(reason: string, headline: string): void;
    /**
     * The game had started and its window will not come back: it has crashed. Ends the process the
     * way every crash of a running game ends - the stores written out, the fatal box headed
     * `headline`, `GAME_EXIT_CODES.crashed` (see `createCrashTeardown`).
     */
    endAfterCrash(headline: string): void;
    /** The native question. Resolves to the index of the chosen button. */
    ask(request: { title: string; message: string; detail: string; buttons: string[] }): Promise<number>;
    now(): number;
    /**
     * When this process began and what it did before its first page, for the replacement page's
     * performance timeline. The process is the same one after a reload, so the launch is too.
     * Absent where there is nothing to say.
     */
    launch?(): GameLaunchTiming | null;
}

/** What {@link installWindowCrashHandling} hands back to the code that loads the window's page. */
export interface WindowCrashHandle {
    /**
     * A `loadURL` of the game's page rejected. Almost always the same failure the window already
     * reported as `did-fail-load`, which this has acted on; handed over as well because a load can
     * stop without either event. A navigation replaced by another one (`ERR_ABORTED`) is not a
     * failure and is ignored.
     */
    loadRejected(error: unknown): void;
}

/** Chromium's code for a navigation that was replaced by another before it finished. */
const ERR_ABORTED = -3;

/** Whether a URL is the game's own page, as opposed to anywhere else the window was sent. */
function isGamePage(url: string): boolean {
    return url.startsWith(`${GAME_RUNTIME_PROTOCOL}:`);
}

export function installWindowCrashHandling(win: BrowserWindow, host: WindowCrashHost): WindowCrashHandle {
    /** When this window's page process died, newest last. Only the last minute is kept. */
    let crashHistory: number[] = [];
    /** True while a hang question is on screen, so `unresponsive` cannot stack a second one. */
    let hangPromptOpen = false;
    /** True between asking for a reload and the page process it replaces going away. */
    let expectedProcessSwap = false;
    /**
     * Whether the game's page has ever loaded in this window - committed with a status that is not
     * an error. Before it has, a page that will not load is a launch that did not start; after, it is
     * a game that has crashed. Set from `did-navigate` rather than `did-finish-load`, which also fires
     * for the error page Chromium puts in place of a load that failed (measured on Electron 38).
     */
    let pageLoaded = false;
    /** Set once this has decided the game is over, so the several signals of one failure act once. */
    let ending = false;

    /**
     * The game's page would not load. Nothing can be shown instead of it - the crash screen is that
     * same page - so this ends the game: as a launch that did not start if the page never loaded,
     * and as a crash, the way a window that keeps dying ends, if it had.
     */
    const pageFailed = (description: string): void => {
        if (ending || host.isQuitting() || win.isDestroyed()) {
            return;
        }
        ending = true;
        const headline = host.text.windowStopped(description);
        if (!pageLoaded) {
            host.failedToStart(`could not start: the game's page could not be loaded: ${description}`, headline);
            return;
        }
        host.log("error", `[Crash] The game's page could not be loaded again: ${description}`);
        host.endAfterCrash(headline);
    };

    const loadRejected = (error: unknown): void => {
        if ((error as { errno?: unknown } | null)?.errno === ERR_ABORTED) {
            return;
        }
        pageFailed(describe(error));
    };

    /**
     * The page process died outright: out of memory, a GPU fault, a kill from the system.
     *
     * No JavaScript survived it, so nothing in the page caught anything - this is the only place
     * the failure exists. It used to become a native dialog; the window now goes back to the game's
     * own crash screen, which is the same screen a caught error draws and so the same thing the
     * player has already been taught to expect. Under `restart` it goes back to the game itself.
     *
     * The reason travels in the URL because there is nothing left to carry it: no renderer to send
     * a message to, and the window is about to be replaced. The page decides what to show of it.
     *
     * A window that keeps dying stops being reloaded. The crash page is served by the bundle that
     * just died, so a fourth attempt would be the fourth identical death; at that point the only
     * honest move is to say so natively, name the log, and go.
     */
    const recoverDeadRenderer = async (reason: string, exitCode: number): Promise<void> => {
        if (ending || host.isQuitting() || win.isDestroyed()) {
            return;
        }
        crashHistory = recordCrash(crashHistory, host.now());
        if (isCrashLooping(crashHistory)) {
            host.log("error", "[Crash] The game window has stopped working repeatedly; not reloading it again.");
            // A game that ran and then crashed, and so ends as one: the stores written out, the box,
            // exit `crashed`. It used to be the box and an ordinary quit, which exits 0 - a launcher
            // was told the game had been closed. Exiting also skips the window's close guard, which
            // would otherwise hold the close open asking the renderer that just died for a decision.
            ending = true;
            host.endAfterCrash(host.text.windowStopped(reason));
            return;
        }

        // The policy and the log path go back on the address under both policies, including the
        // one that carries no failure: the page that comes back has to know them as well as the
        // one that died, and a bare address would leave it guessing at the next crash.
        const target = buildGameRuntimeIndexUrl({
            policy: host.policy(),
            logPath: host.logPath,
            crashDetails: host.policy() === "restart"
                ? null
                : describeProcessDeath(host.text, reason, exitCode),
            launch: host.launch?.() ?? null,
        });
        host.log("info", `[Crash] Reloading the game window (policy: ${host.policy()})`);
        expectedProcessSwap = true;
        // A reload that fails is the page failing to load again - see `pageFailed`.
        await win.loadURL(target).catch(loadRejected);
    };

    /**
     * The window is still there but has not answered for some time.
     *
     * One question per hang: `unresponsive` fires again while the answer is still on screen, and a
     * stack of identical dialogs in front of a frozen window is worse than the freeze.
     */
    const offerHangReload = async (): Promise<void> => {
        if (hangPromptOpen || host.isQuitting() || win.isDestroyed()) {
            return;
        }
        hangPromptOpen = true;
        try {
            if (host.policy() === "restart") {
                host.log("info", "[Crash] Restarting the hung game window (policy: restart)");
                expectedProcessSwap = true;
                win.reload();
                return;
            }
            const answer = await host.ask({
                title: host.displayName(),
                message: host.text.hangMessage,
                detail: host.text.hangDetail,
                buttons: [host.text.hangKeepWaiting, host.text.hangRestart],
            });
            if (answer === 1 && !win.isDestroyed()) {
                // Navigation is decided in this process rather than in the page, so it lands even
                // though the page is not answering. Chromium discards the hung process on the way,
                // which arrives as a renderer that disappeared - hence the flag.
                expectedProcessSwap = true;
                win.reload();
            }
        } catch (error) {
            host.log("warning", `[Crash] Could not ask about restarting the hung window: ${describe(error)}`);
        } finally {
            hangPromptOpen = false;
        }
    };

    win.webContents.on("render-process-gone", (_event, details) => {
        if (!details.reason || details.reason === "clean-exit") {
            return;
        }
        host.log(
            "error",
            `[Crash] The game window's renderer exited: ${details.reason} (exit code ${details.exitCode})`,
        );
        // A reload this process asked for discards the old page process, which arrives here looking
        // exactly like a crash. Acting on it would mean crashing in response to our own recovery.
        if (expectedProcessSwap) {
            expectedProcessSwap = false;
            return;
        }
        void recoverDeadRenderer(details.reason, details.exitCode);
    });
    win.webContents.on("did-finish-load", () => {
        expectedProcessSwap = false;
    });
    // The game's page answered with an error status. The game's protocol answers a page it cannot
    // read with 404 rather than failing the request, and Chromium treats that as a page that loaded:
    // `did-finish-load`, a resolved `loadURL`, and "Not found" in the window (measured). The status
    // is the only sign of it.
    win.webContents.on("did-navigate", (_event, url, httpResponseCode, httpStatusText) => {
        if (!isGamePage(url)) {
            return;
        }
        if (httpResponseCode >= 400) {
            pageFailed(`${httpResponseCode} ${httpStatusText}`.trim());
            return;
        }
        pageLoaded = true;
    });
    // The request for the page failed outright. Only the main frame, and never a navigation that was
    // replaced by another: a reload started while the first load is still going ends the first one
    // that way, and the reload carries on.
    win.webContents.on("did-fail-load", (_event, errorCode, errorDescription, validatedURL, isMainFrame) => {
        if (!isMainFrame || errorCode === ERR_ABORTED) {
            return;
        }
        if (!isGamePage(validatedURL)) {
            // Somewhere the game's own page sent the window, which did not load - not the game
            // failing to, so not a reason to end it here. Recorded without the address.
            host.log("warning", `[Crash] The game window was sent to a page outside the game that did not load: ${errorDescription} (${errorCode})`);
            return;
        }
        pageFailed(`${errorDescription} (${errorCode})`);
    });
    win.on("unresponsive", () => {
        host.log("warning", "[Crash] The game window stopped responding");
        void offerHangReload();
    });
    win.on("responsive", () => {
        host.log("info", "[Crash] The game window is responding again");
        hangPromptOpen = false;
    });
    win.webContents.on("preload-error", (_event, preloadPath, error) => {
        // Without the preload there is no bridge, so the page cannot read its pack, its saves, or
        // anything else. It would draw a black screen and look like a game that does not run.
        host.log("error", `[Crash] Preload script failed (${preloadPath}): ${describe(error)}`);
    });

    return { loadRejected };
}

/**
 * What the crash page is told about a death no JavaScript witnessed.
 *
 * In the machine's language, because it is the one line of that screen this process writes: the
 * page localizes its own chrome and takes this verbatim. Chromium's `reason` and the exit code
 * stay as they are - they are identifiers, and translating them would only make the report harder
 * to act on for whoever the player sends it to.
 */
export function describeProcessDeath(text: ShellText, reason: string, exitCode: number): string {
    return text.displayProcessExited(reason, exitCode);
}

function describe(error: unknown): string {
    return error instanceof Error ? (error.message || String(error)) : String(error);
}
