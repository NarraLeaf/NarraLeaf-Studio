import { describe, expect, it } from "vitest";
import { controlButtonClass } from "@/lib/ui-editor/widget-modules/shared/chrome/constants";

/**
 * Studio is arrow-everywhere; Tailwind's preflight disagrees.
 *
 * `preflight.css` ships `button, [role="button"] { cursor: pointer }`, so every `<button>` in the
 * app starts out with a hand cursor and has to opt back out. Sixty-odd files do that by hand, which
 * means the ones that forget are invisible until someone notices a single row behaving differently
 * from the rest of the window - which is exactly how this was found, twice, in copies of the same
 * list idiom.
 *
 * Only the *shared* class sources are pinned here. A one-off `className` on a hand-rolled button is
 * a review matter and cannot be reached from a unit test; these two fan out to every surface, so a
 * regression in them is the expensive kind.
 */
describe("cursor convention", () => {
    it("controlButtonClass opts out of the preflight pointer cursor", () => {
        // Both arms: `active` swaps colours and must not drop the cursor on the way through.
        expect(controlButtonClass()).toContain("cursor-default");
        expect(controlButtonClass(true)).toContain("cursor-default");
    });

    it("controlButtonClass never emits a pointer cursor", () => {
        expect(controlButtonClass()).not.toContain("cursor-pointer");
    });
});
