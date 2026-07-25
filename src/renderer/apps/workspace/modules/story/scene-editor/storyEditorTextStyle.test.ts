import { describe, expect, it } from "vitest";
import { STORY_EDITOR_DENSITIES } from "./storyEditorSessionStore";
import {
    STORY_AVATAR_VAR,
    STORY_DENSITY_METRICS,
    STORY_GUTTER_VAR,
    STORY_HANDLE_PX,
    STORY_HANDLE_VAR,
    STORY_ROW_BOX_VAR,
    storyEditorRootStyle,
    storyGutterWidth,
} from "./storyEditorTextStyle";

/**
 * The density table is the single source the row chrome sizes itself from — the row box reaches the
 * three columns as a CSS variable, so a density with no entry here would publish `undefined` and
 * silently collapse every box to `auto`. That is the failure this suite exists to make loud.
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
        const avatars = STORY_EDITOR_DENSITIES.map(density => STORY_DENSITY_METRICS[density].avatar);
        expect(avatars).toEqual([...avatars].sort((a, b) => a - b));
    });

    /**
     * U1 §6.3, as a number rather than a screenshot: 24px was 1.7% of the editor's width, at which a
     * differential head and a crop selection are both invisible. These two floors are the acceptance
     * criteria, so a future density tweak that walks back under them fails here first.
     */
    it("keeps the speaker portrait legible at compact and gives it a column at comfortable", () => {
        expect(STORY_DENSITY_METRICS.compact.avatar).toBeGreaterThanOrEqual(28);
        expect(STORY_DENSITY_METRICS.comfortable.avatar).toBeGreaterThanOrEqual(40);
    });

    it("publishes every row-chrome variable from one style object", () => {
        const style = storyEditorRootStyle("comfortable", 12) as Record<string, string>;
        expect(style[STORY_ROW_BOX_VAR]).toBe(`${STORY_DENSITY_METRICS.comfortable.rowBox}px`);
        expect(style[STORY_GUTTER_VAR]).toBe(`${storyGutterWidth(12)}px`);
        expect(style[STORY_AVATAR_VAR]).toBe(`${STORY_DENSITY_METRICS.comfortable.avatar}px`);
        expect(style[STORY_HANDLE_VAR]).toBe(`${STORY_HANDLE_PX}px`);
    });
});

describe("line-number gutter", () => {
    it("holds one width while line numbers fit in two digits", () => {
        // 30, down from 36: the numbers dropped a type size and tightened to the fold chevron (U1
        // WI-2), and the width they gave up went to the words.
        expect(storyGutterWidth(0)).toBe(30);
        expect(storyGutterWidth(1)).toBe(30);
        expect(storyGutterWidth(99)).toBe(30);
    });

    it("widens once a digit is added, so four digits cannot collide with the fold chevron", () => {
        expect(storyGutterWidth(100)).toBeGreaterThan(storyGutterWidth(99));
        expect(storyGutterWidth(1000)).toBeGreaterThan(storyGutterWidth(999));
        expect(storyGutterWidth(10000)).toBeGreaterThan(storyGutterWidth(9999));
    });
});
