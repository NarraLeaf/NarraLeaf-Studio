import type { LiveDigestScope, LiveEffect } from "@shared/live/ops";

/**
 * Two machines in one session hold different documents, and the decision to leave that follows.
 *
 * Everything on it is here because a caller has to do one of two things with it. Telling the author
 * what happened needs the scope, so the sentence can name where the trouble is - this scene, that
 * character - rather than gesture at the project; re-fetching state needs the sequence, because that
 * is the point in the host's order this machine's copy stopped being trustworthy and everything a
 * resync could offer after it would be built on the same wrong document. The two digests are on it
 * because they are the only evidence there is: without both, a report of this reads as an assertion
 * nobody can check, and the pair is what a diagnostic bundle carries when somebody comes to ask which
 * copy was wrong.
 */
export type LiveDivergence = {
    /**
     * The unit the two machines made different things of.
     *
     * Read off the effect rather than recomputed from its operation. The digest that disagreed was
     * taken over a scope the host stated, and naming a different one in the report would send whoever
     * reads it to the wrong document.
     */
    scope: LiveDigestScope;
    /** The host's application order position at which the copies were found to differ. */
    seq: number;
    /** What the host made of that unit after applying that effect. */
    expected: string;
    /** What this machine made of its own copy after applying the same effect. */
    computed: string;
};

/**
 * What {@link LiveDivergenceGuard} makes of one effect.
 *
 * Three answers rather than two, and the third is the point: an effect that carried no digest, or
 * one applied to a unit this machine could not read, is **not evidence of anything**. Folding
 * either into "agreed" would let a run of them read as a clean bill of health, and folding them into
 * "diverged" would throw a machine out of a session over a message that said nothing.
 */
export type LiveDivergenceRuling =
    /** The digests match. This machine holds what the host holds, as of that effect. */
    | { verdict: "agreed" }
    /** Nothing was compared. Agreement is not established, and neither is disagreement. */
    | { verdict: "unproven" }
    /** The digests differ. The session is over for this machine; {@link LiveDivergence} says why. */
    | { verdict: "diverged"; divergence: LiveDivergence };

/**
 * The thing that decides whether this machine still agrees with the host, and rules once.
 *
 * Every machine in a session applies the same operations in the same order, so every machine should
 * hold the same document. A digest that differs from the host's means one of them is wrong and
 * **neither can tell which** - there is no vote to take and no third copy to consult. That is the
 * most expensive way the whole design can fail: two documents that differ, each saved into its own
 * version history, with nothing anywhere reporting a problem, and nobody finding out until somebody
 * reads a scene weeks later and finds a paragraph that was never written that way.
 *
 * So the ruling is that a guest whose digest disagrees leaves the session and says so. It does not
 * repair itself, it does not silently re-read, and it does not keep applying. Leaving is the cheap,
 * loud, recoverable answer; carrying on is the expensive silent one.
 *
 * This class only produces the decision. Leaving the room, and telling the author, belong to
 * whoever holds the transport and the interface - what is here is a value they can act on.
 */
export class LiveDivergenceGuard {
    /**
     * The ruling, once there is one. **Set once and never cleared, and that is a rule rather than an
     * omission.**
     *
     * Re-evaluating later effects would be a door back into the session, and there is nothing on the
     * other side of it worth having. A later digest that matches proves nothing about the difference
     * already found: it is computed from the same document the first mismatch condemned, so the two
     * copies can agree about the row just edited while a paragraph elsewhere - or a whole other
     * scene, or the cast, since a digest covers one unit at a time - stays different forever. Letting that pass
     * for recovery is exactly the silent failure the ruling exists to prevent, and re-reading or
     * retrying to reach it is a decision nobody at this level is in a position to take.
     *
     * ⚠ Set once **across every document a session carries**, not once per document. Two copies that
     * differ about the cast are two copies, and carrying on with the story because the story still
     * agrees would write the disagreement into one machine's history and not the other's - the
     * outcome this class exists for, reached through a door marked "only the characters".
     */
    private ruling: { verdict: "diverged"; divergence: LiveDivergence } | null = null;

    /**
     * Weigh one effect against what this machine made of the same unit after applying it.
     *
     * `computed` is null when the unit could not be read, which is the guest saying it has nothing
     * to offer rather than saying it disagrees. ⚠ A **deleted** character record is not that case:
     * absence is a value the cast's digest can state, so a machine that failed to apply a deletion is
     * caught rather than excused. See `characterRecordDigest`.
     */
    public check(effect: LiveEffect, computed: string | null): LiveDivergenceRuling {
        if (this.ruling) {
            // Answered, not re-asked. See the field.
            return this.ruling;
        }
        const carried = effect.digest;
        if (carried === undefined || computed === null) {
            return { verdict: "unproven" };
        }
        if (carried.hash === computed) {
            return { verdict: "agreed" };
        }
        this.ruling = {
            verdict: "diverged",
            divergence: { scope: carried.scope, seq: effect.seq, expected: carried.hash, computed },
        };
        return this.ruling;
    }

    /**
     * The decision to leave, or null while this machine still agrees with the host.
     *
     * For a caller that has to ask rather than being told - the interface deciding whether to offer
     * a session at all, say, rather than the seam that fed the guard the effect.
     */
    public get divergence(): LiveDivergence | null {
        return this.ruling ? this.ruling.divergence : null;
    }
}
