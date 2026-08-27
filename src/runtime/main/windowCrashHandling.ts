import type { BrowserWindow } from "electron";
import type { GameCrashPolicy } from "@shared/types/gameRuntime";
import { buildGameRuntimeIndexUrl } from "@shared/utils/gameRuntimeIndexUrl";
import { isCrashLooping, recordCrash } from "@shared/utils/crashLoop";
import type { RuntimeLogSink } from "./runtimeLog";
import type { ShellText } from "./shellText";

/**
 * The three ways a game window can stop working without anything throwing in JavaScript: its page
 * process exits, it stops answering, or its preload never ran.
 *
 * All three were silent before this existed. The page process dying takes the window down with it,
 * so what the player saw was a game that closed itself; a hang looked like a very long load.
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
    quit(): void;
    /** The native "this is fatal" box. Separated so a harness can observe instead of drawing one. */
    reportFatal(headline: string): void;
    /** The native question. Resolves to the index of the chosen button. */
    ask(request: { title: string; message: string; detail: string; buttons: string[] }): Promise<number>;
    now(): number;
}

export function installWindowCrashHandling(win: BrowserWindow, host: WindowCrashHost): void {
    /** When this window's page process died, newest last. Only the last minute is kept. */
    let crashHistory: number[] = [];
    /** True while a hang question is on screen, so `unresponsive` cannot stack a second one. */
    let hangPromptOpen = false;
    /** True between asking for a reload and the page process it replaces going away. */
    let expectedProcessSwap = false;

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
        if (host.isQuitting() || win.isDestroyed()) {
            return;
        }
        crashHistory = recordCrash(crashHistory, host.now());
        if (isCrashLooping(crashHistory)) {
            host.log("error", "[Crash] The game window has stopped working repeatedly; not reloading it again.");
            host.reportFatal(host.text.windowStopped(reason));
            // Before the quit, always: the window's close guard holds the close open while it asks
            // the renderer for a decision, and the renderer is the thing that just died. Without
            // this the quit waits out that timeout in front of a player already told it is over.
            host.quit();
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
        });
        host.log("info", `[Crash] Reloading the game window (policy: ${host.policy()})`);
        expectedProcessSwap = true;
        await win.loadURL(target).catch((error: unknown) => {
            host.log("error", `[Crash] Could not reload the game window: ${describe(error)}`);
            host.reportFatal(host.text.windowStopped(reason));
            host.quit();
        });
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
