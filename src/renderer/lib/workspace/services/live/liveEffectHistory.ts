import { inverseOf, type LiveBefore } from "@/lib/live/inverse";
import type { LiveCastView } from "@shared/live/cast";
import type { LiveDerived, LiveEffect, LiveOp } from "@shared/live/ops";
import type { StoryDocument } from "@shared/types/story";
import type { LiveUndoRefusalReason } from "./liveSessionView";

/**
 * What this window has done to the shared document, and what would take it back.
 *
 * **Not the scene's undo stack, and not a subset of it.** Inside a session an undo is an operation
 * sent to the host, so what has to be remembered is not "what the scene looked like" but "which
 * effects were mine, in which order, and what each of them overwrote". Somebody else's rows landing
 * on top of mine do not stop me taking mine back, which is exactly what a stack of whole-scene
 * snapshots cannot express: restoring one would delete their work as a side effect of undoing mine.
 *
 * Only effects this window CAUSED are here. An effect by anybody else has no inverse at all (see
 * `inverseOf`), so a stack holding one could only ever offer to delete a stranger's paragraph.
 *
 * Unbounded, for the same reason `LiveEffectLog` is: a session opens on a committed revision and
 * what accumulates here is the difference since then, one small record at a time.
 */

/** One effect of this window's, with the part of the document only its own moment could know. */
export type LiveEffectRecord = {
    effect: LiveEffect;
    /** What `captureBefore` read immediately before this effect was applied, or null. */
    before: LiveBefore | null;
    /**
     * Entries the inverse of this effect has to carry with it.
     *
     * The gap this closes: `inverseOf` answers with a `LiveOp` and nothing else, so undoing the
     * delete of a pasted row restores the row and none of the translations or voice takes that came
     * with it - they are not in the document, they are in the libraries every machine derived from
     * the effect that inserted it. Recorded here at the moment the delete is recorded, so the
     * insert built to undo it can be sent with them re-attached.
     */
    derived?: LiveDerived;
};

/** Undo and redo, which are the same act in two directions. See {@link LiveEffectHistory.plan}. */
export type LiveStepDirection = "undo" | "redo";

/** A step that can be taken, or the reason it cannot. */
export type LiveStepPlan =
    | { index: number; direction: LiveStepDirection; op: LiveOp; derived?: LiveDerived }
    | { impossible: LiveUndoRefusalReason };

type Entry = {
    /**
     * The effect that put this step into the state it is in now.
     *
     * It changes as the step is taken back and put again: undoing entry N sends the inverse of
     * this, and the effect that answers becomes the new `current` - so redoing is inverting it once
     * more. That is why nothing here distinguishes the two directions; there is nothing to
     * distinguish.
     */
    current: LiveEffectRecord;
};

export class LiveEffectHistory {
    private readonly entries: Entry[] = [];
    /**
     * How many entries are in force. Everything from here up has been taken back and a redo would
     * put it back, which is what makes the undone part a suffix rather than a scattering.
     */
    private cursor = 0;
    /**
     * Steps that have been asked for and not yet answered, by the key that will carry the answer.
     *
     * A step is only real when its effect lands - the host may refuse it - so the cursor moves on
     * arrival rather than on sending. Until then this is what tells the effect answering an undo
     * from an ordinary edit, which would otherwise be recorded as a fresh step and leave the author
     * pressing Ctrl+Z twice to get back to where one press had already taken them.
     */
    private readonly awaiting = new Map<string, { index: number; direction: LiveStepDirection }>();

    /** Whether there is a step of this window's own to take back, and one to put back. */
    public get canUndo(): boolean {
        return this.cursor > 0;
    }

    public get canRedo(): boolean {
        return this.cursor < this.entries.length;
    }

    /** How many effects this window has caused. For tests and diagnostics. */
    public get length(): number {
        return this.entries.length;
    }

    /**
     * What undoes (or redoes) the step at the cursor, or why nothing does.
     *
     * Decides nothing and sends nothing: the caller has to send the operation, and the step is not
     * taken until {@link record} sees the effect that answers it.
     */
    public plan(
        direction: LiveStepDirection,
        context: { self: string; document: StoryDocument; cast: LiveCastView },
    ): LiveStepPlan {
        const index = direction === "undo" ? this.cursor - 1 : this.cursor;
        if (index < 0) {
            return { impossible: "nothing-to-undo" };
        }
        if (index >= this.entries.length) {
            return { impossible: "nothing-to-redo" };
        }
        const entry = this.entries[index];
        const inverse = inverseOf(entry.current.effect, {
            self: context.self,
            document: context.document,
            cast: context.cast,
            before: entry.current.before,
        });
        if ("impossible" in inverse) {
            return { impossible: inverse.impossible };
        }
        // Carried only where the inverse puts rows back. Every other inverse leaves the libraries
        // exactly as they are, and an operation arriving with entries nothing derives from them is
        // an invitation for a later reader to believe they were derived from something.
        const derived = inverse.op.op === "insert-block" ? entry.current.derived : undefined;
        return {
            index,
            direction,
            op: inverse.op,
            ...(derived === undefined ? {} : { derived }),
        };
    }

    /** Say that the planned step has been sent, and which key its answer will carry. */
    public expect(key: string, plan: { index: number; direction: LiveStepDirection }): void {
        this.awaiting.set(key, { index: plan.index, direction: plan.direction });
    }

    /** The host said no to a step. Nothing moved, so nothing here does either. */
    public abandon(key: string): void {
        this.awaiting.delete(key);
    }

    /**
     * Take in one effect this window caused.
     *
     * `key` is the client id the effect came back with, which is how a step's own answer is
     * recognised. An effect that answers a step it was expecting moves the cursor; anything else is
     * a new step and **truncates whatever had been undone** - the ordinary rule, and here also the
     * only coherent one, since the undone entries describe a document that has since moved on.
     */
    public record(record: LiveEffectRecord, key?: string): void {
        const step = key === undefined ? undefined : this.awaiting.get(key);
        if (step && key !== undefined) {
            this.awaiting.delete(key);
            this.entries[step.index].current = record;
            // Undoing entry N leaves N and everything above it undone; redoing it puts N back.
            this.cursor = step.direction === "undo" ? step.index : step.index + 1;
            return;
        }
        // An ordinary edit while a step was in flight. Its bookkeeping is dropped rather than kept:
        // the indices it names are about to be truncated, and the inverse it is waiting for is - if
        // it ever lands - an effect this window caused like any other, recorded as its own step.
        this.awaiting.clear();
        this.entries.length = this.cursor;
        this.entries.push({ current: record });
        this.cursor = this.entries.length;
    }
}
