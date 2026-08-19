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
        // Which is why the crossfade has an absolute spelling, and why only the swap OFFERS it: on a
        // scene it would be a second menu entry doing what the first one does.
        expect(transitionKindFor("expression", "dissolve")).toBe("dissolve");
        expect(supportedTransitionWords("expression")).toContain("dissolve");
        expect(supportedTransitionWords("scene")).not.toContain("dissolve");
        // Not offered is not the same as not accepted: `/bg t=dissolve` has always parsed, and still
        // resolves to the word the scene shows for it.
        expect(matchEnumOption({ kind: "enum", options: transitionOptions("scene") }, "dissolve")?.value).toBe("fade");
        // A stored kind reads back as the word an author types for it.
        expect(transitionWordFor("scene", "dissolve")).toBe("fade");
    });
});
