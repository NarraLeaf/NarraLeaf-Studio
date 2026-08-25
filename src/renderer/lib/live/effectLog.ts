import type { LiveEffect } from "@shared/live/ops";

/**
 * Every effect the host has produced since the session opened, in the order it produced them.
 *
 * A guest that sees a gap in `seq` knows it missed a frame, and this is what it is caught up from:
 * the host's application order is the only order there is, so replaying the effects after the last
 * sequence a guest applied leaves that guest holding what the host holds. Nothing here decides who
 * to send them to - a catch-up goes to the room and names its addressee.
 *
 * Unbounded on purpose. A session opens on an already-committed revision and this carries only the
 * difference since then, an operation of a few hundred bytes at a time; a log large enough to be a
 * problem is the signal to record a checkpoint and re-base the session on it, and that is a decision
 * this class cannot take on its own.
 */
export class LiveEffectLog {
    private readonly effects: LiveEffect[] = [];

    public append(effect: LiveEffect): void {
        this.effects.push(effect);
    }

    /**
     * Everything the host did after `seq`, in order.
     *
     * A linear scan, because a resync is what a lost frame costs and not something that happens per
     * keystroke.
     */
    public after(seq: number): LiveEffect[] {
        return this.effects.filter(effect => effect.seq > seq);
    }

    /** How many effects the session has produced. */
    public get length(): number {
        return this.effects.length;
    }

    /** The sequence of the last effect, or zero when nothing has happened yet. */
    public get lastSeq(): number {
        const last = this.effects[this.effects.length - 1];
        return last ? last.seq : 0;
    }
}
