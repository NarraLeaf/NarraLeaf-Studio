import { describe, expect, it } from "vitest";
import { cn } from "./cn";

/**
 * The outline utilities as Tailwind 3 defines them: a bare `outline` is the style, `outline-<n>` the
 * width. tailwind-merge's defaults describe Tailwind 4 and read both as widths.
 */
describe("cn and the outline utilities", () => {
    it("keeps the outline style beside an outline width", () => {
        expect(cn("outline outline-2 outline-offset-1 outline-primary"))
            .toBe("outline outline-2 outline-offset-1 outline-primary");
        expect(cn("focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"))
            .toBe("focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary");
    });

    it("still resolves two widths, and two styles, last-wins", () => {
        expect(cn("outline-2", "outline-4")).toBe("outline-4");
        expect(cn("outline-[3px]", "outline-1")).toBe("outline-1");
        expect(cn("outline", "outline-dashed")).toBe("outline-dashed");
        expect(cn("outline-none", "outline")).toBe("outline");
        expect(cn("focus:outline", "focus:outline-none")).toBe("focus:outline-none");
    });

    it("keeps an important outline style beside its important width", () => {
        expect(cn("focus-visible:!outline focus-visible:!outline-2 focus-visible:!outline-primary"))
            .toBe("focus-visible:!outline focus-visible:!outline-2 focus-visible:!outline-primary");
    });

    it("leaves the outline colour alone", () => {
        expect(cn("outline outline-primary/60")).toBe("outline outline-primary/60");
    });
});
