/**
 * The boot timeline is a contract with two readers that never meet: a profiler (and the
 * performance-inspector plugin) reading names out of `performance`, and a shell drawing a loading
 * state from the callback. Both come from the same call, and these hold the names and the shape
 * still - a renamed mark is a plugin that silently measures nothing.
 *
 * Comments in English per project convention.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
    createGameBootReporter,
    GAME_BOOT_FIRST_FRAME_MARK,
    GAME_BOOT_MEASURE,
    gameBootSpanMark,
    gameBootSpanMeasure,
    type GameBootProgress,
} from "./bootTiming";

beforeEach(() => {
    performance.clearMarks();
    performance.clearMeasures();
});

function markNames(): string[] {
    return performance.getEntriesByType("mark").map(entry => entry.name);
}

/**
 * Sorted, because the timeline is not: `getEntriesByType` returns measures in start-time order, and
 * the whole-boot measure starts at zero and so comes back before the phases it contains.
 */
function measureNames(): string[] {
    return performance.getEntriesByType("measure").map(entry => entry.name).sort();
}

describe("the boot timeline", () => {
    it("names its marks and measures exactly as published", () => {
        expect(gameBootSpanMark("bundle", "start")).toBe("nl.boot.bundle.start");
        expect(gameBootSpanMark("preload", "end")).toBe("nl.boot.preload.end");
        expect(gameBootSpanMeasure("story")).toBe("nl.boot.story");
        expect(GAME_BOOT_FIRST_FRAME_MARK).toBe("nl.boot.firstFrame");
        expect(GAME_BOOT_MEASURE).toBe("nl.boot");
    });

    it("writes a start, an end and a measure for every phase, and one for the whole boot", () => {
        const reporter = createGameBootReporter();
        reporter.begin("bundle");
        reporter.end("bundle");
        reporter.begin("story");
        reporter.end("story");
        reporter.begin("preload", { loaded: 0, total: 4 });
        reporter.end("preload");
        reporter.firstFrame();

        expect(markNames()).toEqual([
            "nl.boot.bundle.start",
            "nl.boot.bundle.end",
            "nl.boot.story.start",
            "nl.boot.story.end",
            "nl.boot.preload.start",
            "nl.boot.preload.end",
            "nl.boot.firstFrame",
        ]);
        expect(measureNames()).toEqual([
            "nl.boot",
            "nl.boot.bundle",
            "nl.boot.preload",
            "nl.boot.story",
        ]);
    });

    it("measures the whole boot from the page's own start, not from the first phase", () => {
        const reporter = createGameBootReporter();
        reporter.begin("bundle");
        reporter.end("bundle");
        reporter.firstFrame();

        const total = performance.getEntriesByName("nl.boot", "measure")[0];
        expect(total).toBeDefined();
        expect(total!.startTime).toBe(0);
    });

    it("tells the listener which phase is running, and the counts only when it has them", () => {
        const seen: GameBootProgress[] = [];
        const reporter = createGameBootReporter(progress => seen.push(progress));

        reporter.begin("story");
        reporter.end("story");
        reporter.begin("preload", { loaded: 0, total: 3 });
        reporter.progress("preload", 2, 3);
        reporter.end("preload");
        reporter.firstFrame();

        expect(seen.map(entry => entry.phase)).toEqual(["story", "preload", "preload", "firstFrame"]);
        // Indeterminate is the absence of both, never a zero total: a consumer has to be able to
        // tell "nothing to count" from "counted nothing yet".
        expect(seen[0]).not.toHaveProperty("loaded");
        expect(seen[0]).not.toHaveProperty("total");
        expect(seen[2]).toMatchObject({ loaded: 2, total: 3 });
        expect(seen.every(entry => typeof entry.at === "number")).toBe(true);
    });

    it("ignores progress for a phase that is not running, and an end for one that never began", () => {
        const seen: GameBootProgress[] = [];
        const reporter = createGameBootReporter(progress => seen.push(progress));

        reporter.progress("preload", 1, 2);
        reporter.end("preload");

        expect(seen).toEqual([]);
        expect(markNames()).toEqual([]);
        expect(measureNames()).toEqual([]);
    });

    it("begins a phase once, so a repeated start cannot move its beginning", () => {
        const reporter = createGameBootReporter();
        reporter.begin("preload");
        reporter.begin("preload");
        expect(markNames()).toEqual(["nl.boot.preload.start"]);
    });

    it("closes a phase still running when the first frame arrives", () => {
        // A preload that timed out, or a story superseded by a newer one: the boot reached a
        // painted frame with the span open, and dropping it would lose the phase entirely rather
        // than record that it ran up to the frame.
        const reporter = createGameBootReporter();
        reporter.begin("preload");
        reporter.firstFrame();

        expect(measureNames()).toEqual(["nl.boot", "nl.boot.preload"]);
    });

    it("reports the first frame once, however many times it is told", () => {
        const seen: GameBootProgress[] = [];
        const reporter = createGameBootReporter(progress => seen.push(progress));
        reporter.firstFrame();
        reporter.firstFrame();
        expect(seen).toHaveLength(1);
        expect(markNames()).toEqual(["nl.boot.firstFrame"]);
    });

    it("does not let a listener that throws take the boot down with it", () => {
        const reporter = createGameBootReporter(() => {
            throw new Error("a shell that broke while being told");
        });
        expect(() => reporter.begin("story")).not.toThrow();
        expect(() => reporter.firstFrame()).not.toThrow();
        expect(markNames()).toContain("nl.boot.firstFrame");
    });

    it("runs where there is no timeline at all", () => {
        const real = globalThis.performance;
        // A context with no `performance` is reachable (a unit test importing a module that boots),
        // and a missing timeline has to cost the boot nothing rather than throw inside it.
        vi.stubGlobal("performance", undefined);
        try {
            const seen: GameBootProgress[] = [];
            const reporter = createGameBootReporter(progress => seen.push(progress));
            expect(() => {
                reporter.begin("bundle");
                reporter.end("bundle");
                reporter.firstFrame();
            }).not.toThrow();
            expect(seen.map(entry => entry.phase)).toEqual(["bundle", "firstFrame"]);
        } finally {
            vi.stubGlobal("performance", real);
        }
    });
});
