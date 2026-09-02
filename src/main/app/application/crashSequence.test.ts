import { describe, expect, it } from "vitest";
import { createCrashSequence, type CrashSaveOutcome, type CrashSequenceHost } from "./crashSequence";

/**
 * A crash sequence whose collaborators are all recorded, and whose budget is short enough to sit
 * out in a test. Windows are modelled as flush thunks, which is what the real host hands over.
 */
function harness(options: {
    windows?: (() => Promise<unknown>)[];
    restart?: boolean;
    budgetMs?: number;
    pendingSaveFlushes?: () => readonly (() => Promise<unknown>)[];
    askToRestart?: (outcome: CrashSaveOutcome) => boolean;
    exit?: () => void;
} = {}) {
    const record = {
        outcomes: [] as CrashSaveOutcome[],
        relaunches: 0,
        exits: 0,
        warnings: [] as string[],
    };
    const host: CrashSequenceHost = {
        pendingSaveFlushes: options.pendingSaveFlushes ?? (() => options.windows ?? []),
        askToRestart: options.askToRestart ?? ((outcome) => {
            record.outcomes.push(outcome);
            return options.restart ?? false;
        }),
        relaunch: () => {
            record.relaunches += 1;
        },
        exit: options.exit ?? (() => {
            record.exits += 1;
        }),
        warn: (message) => {
            record.warnings.push(message);
        },
        budgetMs: options.budgetMs ?? 20,
    };
    return { record, sequence: createCrashSequence(host) };
}

/**
 * Let the sequence run to its exit. Real timers rather than fake ones: the sequence races a
 * `setTimeout` against promises that a fake clock would not settle, and the budget above is short
 * enough that waiting it out costs nothing.
 */
async function settle(ms = 60): Promise<void> {
    await new Promise((resolve) => setTimeout(resolve, ms));
}

describe("createCrashSequence", () => {
    it("asks every window to write out what it owes before the process ends", async () => {
        const flushed: string[] = [];
        const { record, sequence } = harness({
            windows: [
                async () => {
                    flushed.push("first");
                },
                async () => {
                    flushed.push("second");
                },
            ],
        });

        sequence.begin();
        await settle();

        expect(flushed).toEqual(["first", "second"]);
        expect(record.outcomes).toEqual(["saved"]);
        expect(record.exits).toBe(1);
    });

    it("ends the process rather than waiting out a window that never answers", async () => {
        // The renderer holding the unwritten work may be the thing that has just failed. Waiting
        // for it forever is an application that cannot be closed after it has already broken.
        const { record, sequence } = harness({
            windows: [
                async () => {
                    await new Promise(() => {
                        // Never settles.
                    });
                },
            ],
            budgetMs: 20,
        });

        sequence.begin();
        await settle();

        expect(record.outcomes).toEqual(["incomplete"]);
        expect(record.exits).toBe(1);
        expect(record.warnings.join(" ")).toContain("0 of 1 windows");
    });

    it("keeps the windows that did answer when another one did not", async () => {
        const flushed: string[] = [];
        const { record, sequence } = harness({
            windows: [
                async () => {
                    flushed.push("answered");
                },
                async () => {
                    await new Promise(() => {
                        // Never settles.
                    });
                },
            ],
            budgetMs: 20,
        });

        sequence.begin();
        await settle();

        expect(flushed).toEqual(["answered"]);
        expect(record.outcomes).toEqual(["incomplete"]);
        expect(record.exits).toBe(1);
    });

    it("says nothing about unwritten work when no window was holding any", async () => {
        const { record, sequence } = harness({ windows: [] });

        sequence.begin();
        await settle();

        expect(record.outcomes).toEqual(["none"]);
        expect(record.exits).toBe(1);
    });

    it("ends the process when a window's flush rejects", async () => {
        const { record, sequence } = harness({
            windows: [
                async () => {
                    throw new Error("the renderer is gone");
                },
            ],
        });

        sequence.begin();
        await settle();

        expect(record.outcomes).toEqual(["incomplete"]);
        expect(record.exits).toBe(1);
    });

    it("ends the process when the windows cannot even be listed", async () => {
        const { record, sequence } = harness({
            pendingSaveFlushes: () => {
                throw new Error("the window manager is gone");
            },
        });

        sequence.begin();
        await settle();

        expect(record.outcomes).toEqual(["incomplete"]);
        expect(record.exits).toBe(1);
    });

    it("ends the process when the prompt itself throws", async () => {
        const { record, sequence } = harness({
            askToRestart: () => {
                throw new Error("no window server");
            },
        });

        sequence.begin();
        await settle();

        expect(record.exits).toBe(1);
        expect(record.relaunches).toBe(0);
    });

    it("comes back up when the author asks it to", async () => {
        const { record, sequence } = harness({ restart: true });

        sequence.begin();
        await settle();

        expect(record.relaunches).toBe(1);
        expect(record.exits).toBe(1);
    });

    it("runs once however many further failures arrive while it is running", async () => {
        // The failure that got here is usually still happening. Restarting the sequence would
        // restart the budget, which is how a bounded crash turns into one that never exits.
        let flushes = 0;
        const { record, sequence } = harness({
            windows: [
                async () => {
                    flushes += 1;
                    await new Promise((resolve) => setTimeout(resolve, 5));
                },
            ],
        });

        sequence.begin();
        sequence.begin();
        sequence.begin();
        await settle();

        expect(flushes).toBe(1);
        expect(record.exits).toBe(1);
        expect(record.warnings.filter(line => line.includes("further fatal error"))).toHaveLength(2);
    });

    it("stays quiet about a further failure that arrives after the exit", async () => {
        const { record, sequence } = harness({ windows: [] });

        sequence.begin();
        await settle();
        expect(record.exits).toBe(1);

        sequence.begin();
        await settle();

        expect(record.exits).toBe(1);
    });
});
