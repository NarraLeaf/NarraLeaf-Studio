import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { VariableJumpRow } from "./StoryVariablesPanel";

/**
 * Guards the two rulings the read-only row exists to satisfy, neither of which is visible from the
 * component's own source once someone starts "improving" it:
 *
 *  - It must READ as clickable without being told so. The affordance is structural (a real button,
 *    with the pointer cursor and a hover treatment), which is exactly what a later edit that swaps
 *    it for a styled `<div>` would silently drop.
 *  - It must carry nothing but the variable and its type. A source badge, a chip, an "in story" label
 *    or a hint line is the failure mode this panel was rebuilt to avoid, so the row's text is
 *    asserted whole rather than by substring.
 *
 * `renderToStaticMarkup`, so no workspace has to be mounted - the row reads nothing but its props
 * and the translator.
 */

const markupOf = (name: string) =>
    renderToStaticMarkup(<VariableJumpRow name={name} valueType="number" onJump={() => undefined} />);

describe("the read-only variable row", () => {
    it("is a button, so it is reachable and carries the pointer cursor", () => {
        const markup = markupOf("gold");
        expect(markup).toMatch(/^<button/);
        expect(markup).toContain("cursor-pointer");
    });

    it("changes on hover, which is what makes a static row read as a target", () => {
        // Three at once - fill behind it, the name to full contrast, the border from subtle to solid.
        const markup = markupOf("gold");
        expect(markup).toContain("hover:bg-fill");
        expect(markup).toContain("hover:text-fg");
        expect(markup).toContain("hover:border-edge");
    });

    it("says the variable and its type, and nothing else", () => {
        const text = markupOf("gold").replace(/<[^>]*>/g, "|").split("|").filter(Boolean);
        expect(text).toEqual(["gold", "Number"]);
    });
});
