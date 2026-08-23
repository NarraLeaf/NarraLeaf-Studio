import { useEffect } from "react";
import { CLAIM_REASSERT_MS } from "@/lib/live";
import type { StoryBlockId, StoryId } from "@shared/types/story";

/**
 * Holding a row while its author writes it, and giving it back however they stop.
 *
 * A claim is what stops two people writing one line and one of them losing the paragraph they have
 * just typed, silently: the editing atom here is a committed line rather than a keystroke, so the
 * loser of a race over a row does not lose a character. Taking one is therefore not optional
 * bookkeeping, and neither is giving it back - **a claim that is never given back is a row nobody
 * can edit for the rest of the session.** The host expires one after a pause in the assertions
 * below, which is the safety net for a machine that has gone rather than the plan.
 *
 * The whole design is the shape of one effect, and that is deliberate. Editing a row's text begins
 * when the draft box opens on it and ends when the box closes, whether that was Enter, blur, Escape,
 * a click on another row, a freeze landing, the tab closing or the panel unmounting - and every one
 * of those is the same thing seen from React: the open row changed, or the tree went away. A rule
 * written once at that seam cannot miss an ending; a list of endings written out by hand would miss
 * the next one somebody adds.
 *
 * ⚠ **The claim is asserted for as long as the box is open, not for as long as its author is
 * typing.** Those are different lengths of time and the difference cost somebody their draft on a
 * real machine: the assertion used to ride on keystrokes, so an author who stopped to think about a
 * sentence went on holding an open box, went on being named on that row on every screen in the room,
 * and stopped holding it after thirty seconds. Somebody else was then shown "alice is writing this
 * line" over a line they were free to delete - which is precisely the loss the claim exists to
 * prevent, arranged by the thing that was meant to prevent it. The box being open is what a claim
 * means, so the box being open is what asserts it.
 */

/** The one thing this needs of a live session. See `LiveSession.claimRow`. */
export type StoryRowClaimPort = {
    claimRow(storyId: StoryId, blockId: StoryBlockId, holding: boolean): void;
};

export type StoryRowClaimHoldInput = {
    /** Null before the workspace is up, which is a window that cannot be in a session either. */
    service: StoryRowClaimPort | null;
    /** The story this editor is on. Undefined for a tab with no story behind it yet. */
    storyId: StoryId | undefined;
    /** The row whose text is open for writing, or null when none is. */
    blockId: StoryBlockId | null;
};

/**
 * Take the open row, keep saying so while it is open, and give it back when it closes.
 *
 * The timer runs in every workspace, session or not, because this hook deliberately knows nothing
 * about sessions - `claimRow` is silent outside one. What it costs a window with nobody to tell is
 * one call every ten seconds while a draft box is open, which returns immediately; what asking
 * first would cost is this file having an opinion about when a claim matters, and there is exactly
 * one place that is allowed to have one.
 */
export function useStoryRowClaimHold(input: StoryRowClaimHoldInput): void {
    const { service, storyId, blockId } = input;

    useEffect(() => {
        if (!service || storyId === undefined || blockId === null) {
            return;
        }
        service.claimRow(storyId, blockId, true);
        // See `CLAIM_REASSERT_MS` for why this is an interval and not a message per keystroke.
        const timer = setInterval(() => {
            service.claimRow(storyId, blockId, true);
        }, CLAIM_REASSERT_MS);
        return () => {
            clearInterval(timer);
            service.claimRow(storyId, blockId, false);
        };
    }, [service, storyId, blockId]);
}
