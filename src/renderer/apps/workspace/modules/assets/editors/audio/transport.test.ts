import { describe, expect, it } from "vitest";
import { playbackPosition, resolvePlaybackGeometry, resolvePlayStart } from "./transport";

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

describe("resolvePlaybackGeometry", () => {
    it("is the whole clip when no range is given", () => {
        expect(resolvePlaybackGeometry({ from: 300, range: null, totalSamples: 1000, looping: true })).toEqual({
            start: 300,
            end: 1000,
            loopStart: 0,
            looping: true,
        });
    });

    it("returns to the range start when the range names no loop point", () => {
        expect(resolvePlaybackGeometry({
            from: 250,
            range: { start: 200, end: 600 },
            totalSamples: 1000,
            looping: true,
        })).toEqual({ start: 250, end: 600, loopStart: 200, looping: true });
    });

    it("keeps the loop point where the range put it", () => {
        expect(resolvePlaybackGeometry({
            from: 0,
            range: { start: 0, end: 84_000, loopStart: 12_000 },
            totalSamples: 96_000,
            looping: true,
        })).toEqual({ start: 0, end: 84_000, loopStart: 12_000, looping: true });
    });

    it("clamps a loop point that sits outside the range, so it can never describe an empty loop", () => {
        const outside = (loopStart: number) => resolvePlaybackGeometry({
            from: 0,
            range: { start: 200, end: 600, loopStart },
            totalSamples: 1000,
            looping: true,
        }).loopStart;
        expect(outside(50)).toBe(200);
        expect(outside(600)).toBe(599);
        expect(outside(900)).toBe(599);
    });

    it("treats an empty range as no range", () => {
        expect(resolvePlaybackGeometry({
            from: 0,
            range: { start: 300, end: 300 },
            totalSamples: 1000,
            looping: false,
        })).toEqual({ start: 0, end: 1000, loopStart: 0, looping: false });
    });

    it("keeps the start inside the clip", () => {
        expect(resolvePlaybackGeometry({ from: 5000, range: null, totalSamples: 1000, looping: false }).start).toBe(999);
        expect(resolvePlaybackGeometry({ from: -5, range: null, totalSamples: 1000, looping: false }).start).toBe(0);
        expect(resolvePlaybackGeometry({ from: 0, range: null, totalSamples: 0, looping: false }).start).toBe(0);
    });
});

describe("playbackPosition", () => {
    const geometry = (over: Partial<Parameters<typeof playbackPosition>[0]> = {}) => ({
        start: 0,
        end: 1000,
        loopStart: 0,
        looping: false,
        ...over,
    });

    it("advances from where the run started", () => {
        expect(playbackPosition(geometry({ start: 300 }), 0)).toBe(300);
        expect(playbackPosition(geometry({ start: 300 }), 250)).toBe(550);
    });

    it("parks at the end rather than wrapping when not looping", () => {
        expect(playbackPosition(geometry(), 1200)).toBe(1000);
        // A selection played once stops at the selection's end, not the file's.
        expect(playbackPosition(geometry({ start: 200, end: 600 }), 900)).toBe(600);
    });

    it("wraps the whole clip when the whole clip is the loop", () => {
        expect(playbackPosition(geometry({ looping: true }), 1050)).toBe(50);
        expect(playbackPosition(geometry({ looping: true }), 2050)).toBe(50);
    });

    it("wraps a looping selection to the selection, not to the head of the file", () => {
        const selection = geometry({ start: 200, end: 600, loopStart: 200, looping: true });
        expect(playbackPosition(selection, 300)).toBe(500);
        // 400 samples of loop: one full pass, then 100 more.
        expect(playbackPosition(selection, 500)).toBe(300);
        expect(playbackPosition(selection, 900)).toBe(300);
    });

    describe("intro→loop - the case a modulo cannot express", () => {
        // The whole intro→loop spec: play 0..84000 once, then repeat 12000..84000 forever.
        const intro = geometry({ start: 0, end: 84_000, loopStart: 12_000, looping: true });

        it("plays the intro through on the first pass", () => {
            expect(playbackPosition(intro, 0)).toBe(0);
            expect(playbackPosition(intro, 6000)).toBe(6000);
            expect(playbackPosition(intro, 12_000)).toBe(12_000);
            expect(playbackPosition(intro, 83_999)).toBe(83_999);
        });

        it("returns to the loop point, not to zero and not to the in point", () => {
            expect(playbackPosition(intro, 84_000)).toBe(12_000);
            expect(playbackPosition(intro, 90_000)).toBe(18_000);
        });

        it("never revisits the intro on any later pass", () => {
            const period = 84_000 - 12_000;
            for (let pass = 1; pass <= 4; pass++) {
                expect(playbackPosition(intro, 84_000 + period * pass)).toBe(12_000);
                expect(playbackPosition(intro, 84_000 + period * pass + 500)).toBe(12_500);
                expect(playbackPosition(intro, 84_000 + period * (pass + 1) - 1)).toBe(83_999);
            }
        });

        it("keeps an in point ahead of zero out of the loop's arithmetic", () => {
            // in=2000, loop=12000, out=84000: the first pass starts at 2000, the loop is unchanged.
            const trimmed = geometry({ start: 2000, end: 84_000, loopStart: 12_000, looping: true });
            expect(playbackPosition(trimmed, 0)).toBe(2000);
            expect(playbackPosition(trimmed, 82_000)).toBe(12_000);
            expect(playbackPosition(trimmed, 82_500)).toBe(12_500);
        });
    });

    it("holds at the loop point rather than dividing by zero on a degenerate loop", () => {
        expect(playbackPosition(geometry({ start: 0, end: 500, loopStart: 500, looping: true }), 900)).toBe(500);
    });

    it("never runs backwards from a clock that has not advanced", () => {
        expect(playbackPosition(geometry({ start: 300 }), -50)).toBe(300);
    });
});
