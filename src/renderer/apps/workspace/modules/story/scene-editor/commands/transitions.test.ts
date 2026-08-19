import { describe, expect, it } from "vitest";
import { supportedTransitionWords, transitionKindFor, transitionWordFor } from "./transitions";

/**
 * The transition vocabulary's own invariants — the ones no command spec can hold on its own.
 *
 * A word and the kind it writes are a PAIR: a row prints what a line would produce, so a word that
 * stores a kind no word in that context names back is a row an author cannot retype. The mapping is
 * per context, which is exactly what makes the pair worth pinning rather than obvious.
 */

describe("the transition vocabulary", () => {
    it("names back every kind a swap can write", () => {
        for (const word of supportedTransitionWords("expression")) {
            const kind = transitionKindFor("expression", word);
            expect(kind, word).toBeTruthy();
            expect(transitionWordFor("expression", kind!), word).toBe(word);
        }
    });

    it("reads `fade` as a fade-in on a swap and as a crossfade on a scene", () => {
        // The whole reason `expression` is a context of its own. A `/bg` has one soft option, so its
        // relative word IS the crossfade; a `/face` has two frames of the same object, and the
        // crossfade there half-fades both at once and shows the background through the middle. What
        // changing a face looks like is the other one: the outgoing frame untouched, the new one up
        // over it.
        expect(transitionKindFor("expression", "fade")).toBe("fadeIn");
        expect(transitionKindFor("scene", "fade")).toBe("dissolve");
        // Which is why the crossfade also has an absolute spelling: it is the only way to ask for it
        // where the relative word means something else.
        expect(transitionKindFor("expression", "dissolve")).toBe("dissolve");
        expect(transitionKindFor("scene", "dissolve")).toBe("dissolve");
        // On a scene the two coincide, and the relative word is the one a stored kind reads back as -
        // it is what an author types.
        expect(transitionWordFor("scene", "dissolve")).toBe("fade");
    });
});
