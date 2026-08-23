import { opSceneId, type LiveEffect } from "@shared/live/ops";
import type { StorySceneId } from "@shared/types/story";

/**
 * Two machines in one session hold different documents, and the decision to leave that follows.
 *
 * Everything on it is here because a caller has to do one of two things with it. Telling the author
 * what happened needs the scene, so the sentence can name where the trouble is rather than gesture
 * at the project; re-fetching state needs the sequence, because that is the point in the host's
 * order this machine's copy stopped being trustworthy and everything a resync could offer after it
 * would be built on the same wrong document. The two digests are on it because they are the only
 * evidence there is: without both, a report of this reads as an assertion nobody can check, and the
 * pair is what a diagnostic bundle carries when somebody comes to ask which copy was wrong.
 */
export type LiveDivergence = {
    /** The scene the two machines made different things of; null for an effect about the story. */
    sceneId: StorySceneId | null;
    /** The host's application order position at which the copies were found to differ. */
    seq: number;
    /** What the host made of the scene after applying that effect. */
    expected: string;
    /** What this machine made of its own copy after applying the same effect. */
    computed: string;
};

/**
 * What {@link LiveDivergenceGuard} makes of one effect.
 *
 * Three answers rather than two, and the third is the point: an effect that carried no digest, or
 * one applied to a scene this machine could not read, is **not evidence of anything**. Folding
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
 * hold the same scene. A digest that differs from the host's means one of them is wrong and
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
     * scene, since a digest covers one scene at a time - stays different forever. Letting that pass
     * for recovery is exactly the silent failure the ruling exists to prevent, and re-reading or
     * retrying to reach it is a decision nobody at this level is in a position to take.
     */
    private ruling: { verdict: "diverged"; divergence: LiveDivergence } | null = null;

    /**
     * Weigh one effect against what this machine made of the scene after applying it.
     *
     * `computed` is null when the scene could not be read, which is the guest saying it has nothing
     * to offer rather than saying it disagrees.
     */
    public check(effect: LiveEffect, computed: string | null): LiveDivergenceRuling {
        if (this.ruling) {
            // Answered, not re-asked. See the field.
            return this.ruling;
        }
        const expected = effect.sceneDigest;
        if (expected === undefined || computed === null) {
            return { verdict: "unproven" };
        }
        if (expected === computed) {
            return { verdict: "agreed" };
        }
        this.ruling = {
            verdict: "diverged",
            divergence: { sceneId: opSceneId(effect.op), seq: effect.seq, expected, computed },
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
