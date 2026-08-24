import { describe, expect, it } from "vitest";
import { isListScrolledToEnd, resolveListScrollMetrics } from "./helpers";

describe("resolveListScrollMetrics", () => {
    it("reads 0 at the top of a list that scrolls", () => {
        expect(resolveListScrollMetrics(400, 1000, 0)).toEqual({ offset: 0, maxOffset: 600, progress: 0 });
    });

    it("reads 1 at the bottom of a list that scrolls", () => {
        expect(resolveListScrollMetrics(400, 1000, 600)).toEqual({ offset: 600, maxOffset: 600, progress: 1 });
    });

    it("reads the fraction travelled in between", () => {
        expect(resolveListScrollMetrics(400, 1000, 150).progress).toBeCloseTo(0.25);
    });

    // The whole point of the change: a list whose content fits is at its end, and the author asking
    // "are we at the bottom?" has no other way to find out - a viewport that cannot scroll never
    // fires a scroll event, so nothing else would ever tell them.
    it("reads 1 when the content does not overflow", () => {
        expect(resolveListScrollMetrics(400, 120, 0)).toEqual({ offset: 0, maxOffset: 0, progress: 1 });
    });

    it("reads 1 when the content is exactly as tall as the viewport", () => {
        expect(resolveListScrollMetrics(400, 400, 0).progress).toBe(1);
    });

    // Caught on a real run: a 74px range reported 73.6, which a plain `progress >= 0.999` test read
    // as "not at the bottom" - so the backlog gesture worked on a long log and silently did not on
    // a short one. The viewport had gone as far as it could go both times.
    it("reads 1 when the viewport has gone as far as it can but lands a sub-pixel short", () => {
        expect(resolveListScrollMetrics(800, 874, 73.6).progress).toBe(1);
        expect(resolveListScrollMetrics(400, 1000, 599.4).progress).toBe(1);
    });

    it("still reads a fraction a whole pixel short of the end", () => {
        expect(resolveListScrollMetrics(400, 1000, 598).progress).toBeCloseTo(0.9967);
    });
});

describe("isListScrolledToEnd", () => {
    it("agrees with progress at both ends", () => {
        expect(isListScrolledToEnd(resolveListScrollMetrics(400, 1000, 0))).toBe(false);
        expect(isListScrolledToEnd(resolveListScrollMetrics(400, 1000, 600))).toBe(true);
        expect(isListScrolledToEnd(resolveListScrollMetrics(400, 120, 0))).toBe(true);
    });

    it("tolerates the sub-pixel a fractional layout leaves behind", () => {
        expect(isListScrolledToEnd(resolveListScrollMetrics(400, 1000, 599.4))).toBe(true);
        expect(isListScrolledToEnd(resolveListScrollMetrics(400, 1000, 598))).toBe(false);
    });
});
