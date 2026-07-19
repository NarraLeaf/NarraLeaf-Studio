import { describe, expect, it } from "vitest";
import { resolvePlayStart } from "./transport";

const at = (options: Partial<Parameters<typeof resolvePlayStart>[0]> = {}) =>
    resolvePlayStart({ position: 0, selection: null, totalSamples: 1000, finished: false, ...options });

describe("resolvePlayStart", () => {
    describe("with a selection", () => {
        const selection = { start: 200, end: 600 };

        it("rewinds to the selection start once the run finished there", () => {
            expect(at({ selection, position: 600, finished: true })).toBe(200);
        });

        it("rewinds even when the finished run parked just short of the end", () => {
            // The audio clock stops on a frame boundary, so the last tick lands before the end.
            expect(at({ selection, position: 597, finished: true })).toBe(200);
        });

        it("resumes from the middle after a pause", () => {
            expect(at({ selection, position: 400, finished: false })).toBe(400);
        });

        it("starts at the selection when the playhead sits before it", () => {
            expect(at({ selection, position: 50, finished: false })).toBe(200);
        });

        it("rewinds when the playhead was seeked to or past the end, even without finishing", () => {
            expect(at({ selection, position: 600, finished: false })).toBe(200);
            expect(at({ selection, position: 900, finished: false })).toBe(200);
        });

        it("plays the whole selection when starting from its own start", () => {
            expect(at({ selection, position: 200, finished: false })).toBe(200);
        });
    });

    describe("without a selection", () => {
        it("rewinds to the clip start once playback ran to the end", () => {
            expect(at({ position: 1000, finished: true })).toBe(0);
        });

        it("resumes from the playhead after a pause", () => {
            expect(at({ position: 400, finished: false })).toBe(400);
        });

        it("rewinds when the playhead is at or past the clip end", () => {
            expect(at({ position: 1000, finished: false })).toBe(0);
        });
    });

    it("treats an empty selection as no selection", () => {
        const empty = { start: 300, end: 300 };
        expect(at({ selection: empty, position: 400, finished: false })).toBe(400);
        expect(at({ selection: empty, position: 400, finished: true })).toBe(0);
    });

    it("stays at the start of an empty clip rather than returning something negative", () => {
        expect(at({ totalSamples: 0, position: 0, finished: true })).toBe(0);
    });
});
