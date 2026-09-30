/**
 * What a fatal error in the main process does after it has been logged.
 *
 * The order is the whole point. A crash ends the process with `exit()`, which - unlike a quit -
 * does not run `before-quit` and therefore runs none of the shutdown drain. Auto-save in the
 * renderer is debounced, so at any instant there is an edit that has been typed and not written;
 * before this ran, a fatal error in main threw that edit away without ever asking for it. So the
 * windows are given a bounded chance to write out what they owe the disk, and only then does the
 * prompt go up and the process end.
 *
 * Three properties this has to hold, each of them the difference between a bounded crash and a
 * hang:
 *
 * - **The exit is not negotiable.** Every path through here ends in `exit`, including the ones
 *   where the flush throws, the windows never answer, or the prompt cannot be shown.
 * - **The wait is bounded.** The state being saved is state a bug has just been running in, and
 *   the renderer holding it may already be gone. Waiting for it forever is an application that
 *   cannot be closed after it has already failed.
 * - **It runs once.** The failure that got here is often still happening, so a second one
 *   arriving mid-flush is expected. Restarting the sequence would restart the wait, and a
 *   sequence that restarts on every error is one that never reaches the exit at all.
 */

/**
 * Eight seconds, matching the in-window crash screen's own flush (`runCrashRecoveryFlush`).
 *
 * Long enough for a workspace with a large story document on a slow disk, short enough that an
 * author looking at a frozen application is not left wondering whether it is coming back. The
 * per-window IPC has a longer ceiling of its own for the close path; this is the shorter one that
 * applies when the process is already on its way out.
 */
export const CRASH_FLUSH_BUDGET_MS = 8_000;

/**
 * What became of the unwritten work, as far as the crash can tell.
 *
 * `none` is not the same as `saved`: it means no window was holding anything, so there was nothing
 * to write and nothing to claim. The prompt says different things for the three, because telling
 * an author their work was saved when the write never finished is worse than telling them nothing.
 */
export type CrashSaveOutcome = "none" | "saved" | "incomplete";

export interface CrashSequenceHost {
    /**
     * One thunk per window that may still owe the disk a write, read at the moment of the crash.
     *
     * Each writes that window out. None of them may reject: a window that cannot save is not a
     * reason to stop the others, and it is certainly not a reason to stop the exit.
     */
    pendingSaveFlushes(): readonly (() => Promise<unknown>)[];
    /** The native prompt, told what happened to the unwritten work. Returns whether to come back up. */
    askToRestart(outcome: CrashSaveOutcome): boolean;
    relaunch(): void;
    exit(): void;
    warn(message: string, error?: unknown): void;
    /** Overridable so a test does not sit out the budget in real time. */
    budgetMs?: number;
}

export interface CrashSequence {
    /** Handle the fatal error. The first call runs; every later one is recorded and dropped. */
    begin(): void;
}

export function createCrashSequence(host: CrashSequenceHost): CrashSequence {
    const budgetMs = host.budgetMs ?? CRASH_FLUSH_BUDGET_MS;
    let started = false;

    const flushPendingSaves = async (): Promise<CrashSaveOutcome> => {
        let flushes: readonly (() => Promise<unknown>)[];
        try {
            flushes = host.pendingSaveFlushes();
        } catch (error) {
            host.warn("Could not work out which windows still owed the disk a write.", error);
            return "incomplete";
        }
        if (flushes.length === 0) {
            return "none";
        }

        // Counted rather than read off `allSettled`, because the race below can finish first: what
        // the prompt needs to know is how many had actually landed by the time the budget ran out.
        let settled = 0;
        const all = Promise.allSettled(flushes.map(async (run) => {
            await run();
            settled += 1;
        }));

        let timer: ReturnType<typeof setTimeout> | undefined;
        const expiry = new Promise<void>((resolve) => {
            timer = setTimeout(resolve, budgetMs);
        });
        try {
            await Promise.race([all, expiry]);
        } finally {
            if (timer !== undefined) {
                clearTimeout(timer);
            }
        }

        if (settled < flushes.length) {
            host.warn(
                `${settled} of ${flushes.length} windows wrote out their pending changes within ${budgetMs}ms;`
                + " the rest were still writing when the process ended.",
            );
            return "incomplete";
        }
        return "saved";
    };

    const run = async (): Promise<void> => {
        try {
            const outcome = await flushPendingSaves();
            if (host.askToRestart(outcome)) {
                host.relaunch();
            }
        } catch (error) {
            host.warn("Failed to report the fatal error.", error);
        } finally {
            host.exit();
        }
    };

    return {
        begin() {
            if (started) {
                host.warn("A further fatal error arrived while the first one was being handled.");
                return;
            }
            started = true;
            void run().catch((error) => {
                // Only reachable if `exit` itself threw, which leaves nothing further to try.
                host.warn("The fatal error handler could not finish.", error);
            });
        },
    };
}
