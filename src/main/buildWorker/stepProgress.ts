import type { StudioTaskProgress } from "@shared/types/studioTask";

/**
 * Where a worker says how far through a countable step of a build it is.
 *
 * A build is a sequence of stretches, and only some of them can be counted. Re-encoding the
 * project's images is N images; sealing a pack is N items; hashing the finished artifacts is N
 * files. Handing electron-builder a target is one promise that comes back minutes later, and
 * nothing inside this process can see what happened in between. So the readout is not one bar over
 * a build - it is a bar that fills while a step with a denominator is running and goes back to a
 * sweep when the next stretch has none, which is the only reading of a build that is true.
 *
 * The sink is registered once by the worker's entry point and the counting code calls
 * {@link countBuildStep}, the same arrangement `downloadReporting` uses beside it and for the
 * same reason: the loops sit several layers inside a compile or a repack, and none of the functions
 * between them and the entry point is about progress. A process-wide value is safe here in a way it
 * would not be on the main process, because a worker is forked per build and packs one thing.
 *
 * Unset means nobody is listening, which is what a build run from a script or a test is, and every
 * caller has to go on working in that state.
 */

export type BuildStepProgressReporter = (progress: StudioTaskProgress | null) => void;

let sink: BuildStepProgressReporter | null = null;

/** Wired once by a worker entry point. Tests set their own, or none. */
export function setStepProgressReporter(reporter: BuildStepProgressReporter | null): void {
    sink = reporter;
}

/**
 * Announce one count, if anything is listening. Never throws - a readout cannot fail a build.
 *
 * `null` says the build has left a countable stretch. Whatever comes next has no denominator until
 * something says otherwise, which is the honest state during the packaging itself.
 */
export function reportStepProgress(progress: StudioTaskProgress | null): void {
    try {
        sink?.(progress);
    } catch {
        // A broken channel to the parent process is the parent's problem; the step still runs.
    }
}

/**
 * How often a running count is allowed to cross the process boundary.
 *
 * The window polls the build once a second, so anything finer than this is a message nobody reads -
 * and the loops this sits in can turn over thousands of times.
 */
const REPORT_INTERVAL_MS = 200;

export type BuildStepCounter = {
    /** One more unit behind us. */
    advance(by?: number): void;
    /**
     * This step is over: what follows it cannot be counted until something else says it can.
     *
     * Called on every exit from the step, including a failing one. A count left standing would
     * describe a pass that ended minutes ago for the whole of the packaging that follows it.
     */
    end(): void;
};

/**
 * Count one pass whose length is known before it starts.
 *
 * The total is a parameter rather than something this discovers, and that is the contract: a step
 * that does not know how much work it has before the first iteration has no honest fraction to
 * report, and it must not open a counter at all. A denominator that grows as the loop runs produces
 * a bar that slides backwards, which is worse than the sweep it replaced.
 */
export function countBuildStep(total: number, unit: StudioTaskProgress["unit"]): BuildStepCounter {
    if (total <= 0) {
        // Nothing to count, so nothing is claimed. `end` still speaks, so a caller can close a step
        // it opened without checking whether the step had any work in it.
        return { advance: () => {}, end: () => reportStepProgress(null) };
    }
    let done = 0;
    let reportedAt = Date.now();
    reportStepProgress({ done, total, unit });
    return {
        advance: (by = 1) => {
            done = Math.min(total, done + by);
            const now = Date.now();
            // The last unit is always announced: a step that ended one short of its total reads as
            // one that stalled, and the difference between those two matters.
            if (done < total && now - reportedAt < REPORT_INTERVAL_MS) {
                return;
            }
            reportedAt = now;
            reportStepProgress({ done, total, unit });
        },
        end: () => reportStepProgress(null),
    };
}
