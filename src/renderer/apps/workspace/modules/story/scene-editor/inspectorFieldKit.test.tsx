import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { STORY_DEFAULT_BEZIER_EASING } from "@shared/utils/storyEasing";
import { CUSTOM_EASING_OPTION, EasingField, nextEasingValue, type TFunc } from "./inspectorFieldKit";

/**
 * The `Easing` field's two states, asserted as markup: a named easing is a pick and nothing else, a
 * drawn one brings its card with it.
 *
 * `renderToStaticMarkup`, so no workspace has to be mounted - the card's freeze guard is the one
 * thing that would demand one, and it is stubbed to the state every unfrozen workspace is in.
 */

vi.mock("@/apps/workspace/components/ui/freezeGuard", () => ({
    useFreezeGuard: () => ({
        frozen: false,
        reason: "",
        writes: () => ({ disabled: false, "data-tip": undefined }),
        gesture: (handler: unknown) => handler,
    }),
}));

/** Keys, not words: what this asserts is which control is drawn, never how it reads. */
const t = ((key: string) => key) as TFunc;

const markupOf = (easing: string | undefined) =>
    renderToStaticMarkup(<EasingField t={t} value={easing} onChange={() => undefined} />);

describe("the easing field", () => {
    it("draws no card while the easing is a word", () => {
        const markup = markupOf("easeInOut");
        expect(markup).toContain("storyInspector.field.easing");
        // The pick reads as the word it is, and nothing is drawn under it (the one `svg` in this
        // markup is the select's own chevron, so the card is counted by its handles instead).
        expect(markup).toContain("storyInspector.easing.easeInOut");
        expect(markup).not.toContain("<circle");
        expect(markup).not.toContain("cubic-bezier");
    });

    it("draws the curve, and the value it spells, once the easing is a drawn one", () => {
        const markup = markupOf("cubic-bezier(0.4,0,0.2,1)");
        // A stored curve reads back as the custom option rather than as a blank pick.
        expect(markup).toContain("storyInspector.easing.custom");
        // The readout is the stored value: what the row prints and what a line would take back.
        expect(markup).toContain("cubic-bezier(0.4,0,0.2,1)");
        // Two handles, drawn from the two control points.
        expect(markup.match(/<circle/g)).toHaveLength(2);
    });

    it("keeps the drawn curve across a trip through the named easings", () => {
        // Picking `Custom curve` on a field that has one already must not reset the shape - the
        // author is coming back to the curve they drew, not asking for a new one.
        expect(nextEasingValue(CUSTOM_EASING_OPTION, undefined)).toBe(STORY_DEFAULT_BEZIER_EASING);
        expect(nextEasingValue(CUSTOM_EASING_OPTION, "easeOut")).toBe(STORY_DEFAULT_BEZIER_EASING);
        expect(nextEasingValue(CUSTOM_EASING_OPTION, "cubic-bezier(0.4,0,0.2,1)")).toBe("cubic-bezier(0.4,0,0.2,1)");
        expect(nextEasingValue("easeOut", "cubic-bezier(0.4,0,0.2,1)")).toBe("easeOut");
        // The blank option is the field's "no easing stated", which is stored as nothing at all.
        expect(nextEasingValue("", "easeOut")).toBeUndefined();
    });
});
