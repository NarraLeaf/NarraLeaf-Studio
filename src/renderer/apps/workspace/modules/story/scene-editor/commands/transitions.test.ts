import { describe, expect, it } from "vitest";
import { matchEnumOption } from "../storyCommandGrammar";
import {
    supportedTransitionWords,
    transitionKindFor,
    transitionOptions,
    transitionWordFor,
    type StoryTransitionContext,
} from "./transitions";

/**
 * The transition vocabulary's own invariants — the ones no command spec can hold on its own.
 *
 * A word and the kind it writes are a PAIR: a row prints what a line would produce, so a word that
 * stores a kind no word in that context names back is a row an author cannot retype. The mapping is
 * per context, which is exactly what makes the pair worth pinning rather than obvious.
 */

const CONTEXTS = ["scene", "character", "reveal", "conceal", "nvl", "expression"] as const satisfies readonly StoryTransitionContext[];

/** Fails the build when a context joins the type without joining the list above. */
type AssertNever<T extends never> = T;
export type TransitionContextsAreComplete = AssertNever<Exclude<StoryTransitionContext, (typeof CONTEXTS)[number]>>;

describe("the transition vocabulary", () => {
    it("lets no spelling be claimed by two words in one context", () => {
        // The property behind "an author's word resolves to one thing": a value and every alias that
        // reaches it are one flat table per option set, and a spelling in it twice is a line whose
        // meaning depends on which entry the lookup happened to hit first.
        //
        // Pinned for EVERY context rather than for the pair that provoked it (`fade`'s `dissolve`
        // alias beside `expression`'s own `dissolve`), because the collision is invisible where it
        // matters — a duplicated dropdown entry, or a word that quietly stops meaning what it did.
        for (const context of CONTEXTS) {
            const claimedBy = new Map<string, string>();
            for (const option of transitionOptions(context)) {
                for (const spelling of [option.value, ...(option.aliases ?? [])]) {
                    expect(claimedBy.get(spelling), `${context}: "${spelling}" is claimed by both ${claimedBy.get(spelling)} and ${option.value}`)
                        .toBeUndefined();
                    claimedBy.set(spelling, option.value);
                }
            }
        }
    });


    it("names back every kind a whole-screen change or a swap can write", () => {
        // Widened from the swap alone, because the property editor now derives its own menu from
        // this mapping. A kind with no word behind it used to be reachable from the right-hand
        // side only: the row then printed the raw kind, and `maskWipe` is an alias of `wipe`, so
        // reading the line back turned a hard-edged wipe into a feathered one.
        for (const context of ["scene", "character", "expression"] as const) {
            for (const word of supportedTransitionWords(context)) {
                const kind = transitionKindFor(context, word);
                expect(kind, `${context}: ${word}`).toBeTruthy();
                expect(transitionWordFor(context, kind!), `${context}: ${word}`).toBe(word);
            }
        }
    });

    it("gives each soft look an absolute word in the context where `fade` means the other one", () => {
        // `fade` is relative and each context spends it on one of the two: a crossfade on a whole-screen
        // change, a fade-in on a swap. Whichever it does not spend it on is the one that needs a
        // word of its own, or the look is reachable from the property editor and unsayable on the
        // line - which is how a scene fade-in used to print as `t=fadeIn` and re-read as a
        // crossfade, silently.
        expect(transitionKindFor("scene", "fade-in")).toBe("fadeIn");
        expect(transitionWordFor("scene", "fadeIn")).toBe("fade-in");
        expect(supportedTransitionWords("scene")).toContain("fade-in");
        // And the mirror image: on a swap `fade` already IS the fade-in, so the absolute spelling
        // would be a second menu entry for the first one.
        expect(supportedTransitionWords("expression")).not.toContain("fade-in");
        expect(transitionWordFor("expression", "fadeIn")).toBe("fade");
    });

    it("reads `fade` as a fade-in on a swap and as a crossfade on a scene", () => {
        // The whole reason `expression` is a context of its own. A `/bg` has one soft option, so its
        // relative word IS the crossfade; a `/face` has two frames of the same object, and the
        // crossfade there half-fades both at once and shows the background through the middle. What
        // changing a face looks like is the other one: the outgoing frame untouched, the new one up
        // over it.
        expect(transitionKindFor("expression", "fade")).toBe("fadeIn");
        expect(transitionKindFor("scene", "fade")).toBe("dissolve");
        // Which is why the crossfade has an absolute spelling, and why only the swap OFFERS it: on a
        // scene it would be a second menu entry doing what the first one does.
        expect(transitionKindFor("expression", "dissolve")).toBe("dissolve");
        expect(supportedTransitionWords("expression")).toContain("dissolve");
        expect(supportedTransitionWords("scene")).not.toContain("dissolve");
        // And on a character, whose `fade` is the fade-in for the same reason a swap's is. The word
        // was missing here alone, so a stored crossfade on a character row named nothing - and a
        // context that cannot name a kind it can hold reads that row back as no transition at all.
        expect(transitionKindFor("character", "dissolve")).toBe("dissolve");
        expect(transitionWordFor("character", "dissolve")).toBe("dissolve");
        expect(transitionWordFor("character", "fadeIn")).toBe("fade");
        // Not offered is not the same as not accepted: `/bg t=dissolve` has always parsed, and still
        // resolves to the word the scene shows for it.
        expect(matchEnumOption({ kind: "enum", options: transitionOptions("scene") }, "dissolve")?.value).toBe("fade");
        // A stored kind reads back as the word an author types for it.
        expect(transitionWordFor("scene", "dissolve")).toBe("fade");
    });
});
