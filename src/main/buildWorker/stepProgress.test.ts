import { afterEach, describe, expect, it, vi } from "vitest";
import type { StudioTaskProgress } from "@shared/types/studioTask";
import { countBuildStep, reportStepProgress, setStepProgressReporter } from "./stepProgress";

/** Collect what a step says, in order, with the sink wired the way a worker entry point wires it. */
function record(): (StudioTaskProgress | null)[] {
    const seen: (StudioTaskProgress | null)[] = [];
    setStepProgressReporter(progress => seen.push(progress));
    return seen;
}

afterEach(() => {
    setStepProgressReporter(null);
    vi.useRealTimers();
});

describe("counting a step of a build", () => {
    it("says where it is before the first unit, so the bar is determinate for the whole pass", () => {
        const seen = record();

        countBuildStep(4, "file");

        expect(seen).toEqual([{ done: 0, total: 4, unit: "file" }]);
    });

    it("announces the last unit however recently it last spoke", () => {
        const seen = record();

        const counted = countBuildStep(3, "file");
        counted.advance();
        counted.advance();
        counted.advance();

        // The two in the middle are inside the reporting interval and are allowed to be dropped;
        // the one that completes the pass is not, because a step that stopped one short of its
        // total reads as a step that stalled.
        expect(seen.at(-1)).toEqual({ done: 3, total: 3, unit: "file" });
    });

    it("does not send a message per unit for a pass over thousands of them", () => {
        vi.useFakeTimers();
        const seen = record();

        const counted = countBuildStep(5000, "file");
        for (let index = 0; index < 5000; index += 1) {
            counted.advance();
        }

        // Time never moves, so everything but the opening count and the closing one is throttled.
        expect(seen).toHaveLength(2);
    });

    it("goes back to nothing when the step ends, so what follows it is not described by its count", () => {
        const seen = record();

        const counted = countBuildStep(2, "file");
        counted.advance();
        counted.end();

        expect(seen.at(-1)).toBeNull();
    });

    it("claims nothing for a step with no work in it, and still ends", () => {
        const seen = record();

        const counted = countBuildStep(0, "file");
        counted.advance();
        counted.end();

        // Zero of zero is not a fraction, so the only thing said is that there is nothing counting.
        expect(seen).toEqual([null]);
    });

    it("never counts past its total, whatever the loop does", () => {
        const seen = record();

        const counted = countBuildStep(2, "file");
        counted.advance();
        counted.advance();
        counted.advance();

        expect(seen.at(-1)).toEqual({ done: 2, total: 2, unit: "file" });
    });

    it("is silent when nothing is listening, which is a build run from a script", () => {
        setStepProgressReporter(null);

        expect(() => countBuildStep(2, "file").advance()).not.toThrow();
    });

    it("survives a sink that throws, because a readout cannot fail a build", () => {
        setStepProgressReporter(() => {
            throw new Error("the parent process went away");
        });

        expect(() => reportStepProgress({ done: 1, total: 2, unit: "file" })).not.toThrow();
    });
});
