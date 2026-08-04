import { describe, expect, it } from "vitest";
import { STORY_EDITOR_DENSITIES } from "./storyEditorSessionStore";
import {
    STORY_DENSITY_METRICS,
    STORY_GUTTER_VAR,
    STORY_MARK_VAR,
    STORY_ROW_BOX_VAR,
    storyEditorRootStyle,
    storyGutterWidth,
} from "./storyEditorTextStyle";
import { STORY_MARK_PX } from "./StoryRowGutterMark";

/**
 * The density table is the single source the row chrome sizes itself from — the row box reaches both
 * columns as a CSS variable, so a density with no entry here would publish `undefined` and silently
 * collapse every box to `auto`. That is the failure this suite exists to make loud.
 *
 * The alignment itself (text, line number and drag handle sharing one centre line) is a *layout*
 * fact and jsdom has no layout engine: `getBoundingClientRect` is all zeroes there, so an
 * "offset === 0" assertion would pass on a completely broken stylesheet. It is verified against the
 * running app instead; see the report.
 */
describe("story editor density metrics", () => {
    it("carries metrics for every density the store can hold", () => {
        for (const density of STORY_EDITOR_DENSITIES) {
            expect(STORY_DENSITY_METRICS[density], density).toBeDefined();
            expect(STORY_DENSITY_METRICS[density].rowBox).toBeGreaterThan(0);
        }
    });

    it("keeps compact as the untouched baseline", () => {
        // No line-height: compact inherits the Tailwind `text-sm` leading it has always had, and
        // pinning one here would quietly reflow every existing project.
        expect(STORY_DENSITY_METRICS.compact.fontScale).toBe(1);
        expect(STORY_DENSITY_METRICS.compact.lineHeight).toBeUndefined();
    });

    it("orders the densities by how much room they give", () => {
        const boxes = STORY_EDITOR_DENSITIES.map(density => STORY_DENSITY_METRICS[density].rowBox);
        expect(boxes).toEqual([...boxes].sort((a, b) => a - b));
    });

    /**
     * gutter 规范 §6: the mark column is an alignment device, and its whole value is that every mark in
     * a scene lands on one vertical line at one weight. Density may change how much room the WORDS get;
     * the identity column beside them holds still, and a tier that re-sized it would be re-tuning the
     * optical centring each mark is hand-aligned to.
     */
    it("keeps the mark column out of the density table", () => {
        for (const density of STORY_EDITOR_DENSITIES) {
            const style = storyEditorRootStyle(density, 12) as Record<string, string>;
            expect(style[STORY_MARK_VAR], density).toBe(`${STORY_MARK_PX}px`);
        }
    });

    it("holds the mark at the width the spec pins it to", () => {
        expect(STORY_MARK_PX).toBe(26);
    });

    it("publishes every row-chrome variable from one style object", () => {
        const style = storyEditorRootStyle("comfortable", 12) as Record<string, string>;
        expect(style[STORY_ROW_BOX_VAR]).toBe(`${STORY_DENSITY_METRICS.comfortable.rowBox}px`);
        expect(style[STORY_GUTTER_VAR]).toBe(`${storyGutterWidth(12)}px`);
        expect(style[STORY_MARK_VAR]).toBe(`${STORY_MARK_PX}px`);
    });
});

describe("line-number gutter", () => {
    it("holds one width while line numbers fit in two digits", () => {
        // 38: the 30 the digits and chevron need, plus the 8px of trailing gap that keeps the last
        // digit off the column beside it. Still 12 less than the 30 + 20px handle column it replaced.
        expect(storyGutterWidth(0)).toBe(38);
        expect(storyGutterWidth(1)).toBe(38);
        expect(storyGutterWidth(99)).toBe(38);
    });

    it("widens once a digit is added, so four digits cannot collide with the fold chevron", () => {
        expect(storyGutterWidth(100)).toBeGreaterThan(storyGutterWidth(99));
        expect(storyGutterWidth(1000)).toBeGreaterThan(storyGutterWidth(999));
        expect(storyGutterWidth(10000)).toBeGreaterThan(storyGutterWidth(9999));
    });
});
