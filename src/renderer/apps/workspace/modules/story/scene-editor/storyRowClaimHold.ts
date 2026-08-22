import { useCallback, useEffect, useRef } from "react";
import { CLAIM_REASSERT_MS } from "@/lib/live";
import type { StoryBlockId, StoryId } from "@shared/types/story";

/**
 * Holding a row while its author writes it, and giving it back however they stop.
 *
 * A claim is what stops two people writing one line and one of them losing the paragraph they have
 * just typed, silently: the editing atom here is a committed line rather than a keystroke, so the
 * loser of a race over a row does not lose a character. Taking one is therefore not optional
 * bookkeeping, and neither is giving it back - **a claim that is never given back is a row nobody
 * can edit for the rest of the session.** The host expires one after a pause in typing, which is the
 * safety net rather than the plan.
 *
 * The whole design is the shape of one effect, and that is deliberate. Editing a row's text begins
 * when the draft box opens on it and ends when the box closes, whether that was Enter, blur, Escape,
 * a click on another row, a freeze landing, the tab closing or the panel unmounting - and every one
 * of those is the same thing seen from React: the open row changed, or the tree went away. A rule
 * written once at that seam cannot miss an ending; a list of endings written out by hand would miss
 * the next one somebody adds.
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
    /**
     * Milliseconds from any source that only moves forward.
     *
     * Injected so that "still typing half a minute later" is something a test can state in a line
     * rather than something it has to sit through.
     */
    now?: () => number;
};

/**
 * Take the open row, give it back when it closes, and keep it while its author types.
 *
 * Returns what to call when a character lands in a row: see {@link CLAIM_REASSERT_MS} for why that
 * is not a message per keystroke, and why there is no timer here.
 */
export function useStoryRowClaimHold(input: StoryRowClaimHoldInput): (blockId: StoryBlockId) => void {
    const { service, storyId, blockId } = input;
    const now = input.now ?? Date.now;
    /**
     * The row this window is holding and when it last said so, or null when it holds none.
     *
     * A ref rather than state: nothing renders it, and a keystroke that re-rendered the editor to
     * record that it had happened would cost more than the claim is worth - see `textDraftRef`,
     * which exists for exactly that reason.
     */
    const standing = useRef<{ blockId: StoryBlockId; assertedAt: number } | null>(null);
    // Read from a ref by the callback below so its identity never changes: it is handed to the row
    // action surface, which is deliberately built once because a new one re-renders every row.
    const clock = useRef(now);
    clock.current = now;

    useEffect(() => {
        if (!service || storyId === undefined || blockId === null) {
            return;
        }
        service.claimRow(storyId, blockId, true);
        standing.current = { blockId, assertedAt: clock.current() };
        return () => {
            standing.current = null;
            service.claimRow(storyId, blockId, false);
        };
    }, [service, storyId, blockId]);

    return useCallback((typedIn: StoryBlockId) => {
        const held = standing.current;
        if (!service || storyId === undefined || held === null || held.blockId !== typedIn) {
            // A character in a row this window is not holding. The claim was refused, or the row
            // was never taken - either way saying so again would not make it this author's.
            return;
        }
        const at = clock.current();
        if (at - held.assertedAt < CLAIM_REASSERT_MS) {
            return;
        }
        held.assertedAt = at;
        service.claimRow(storyId, typedIn, true);
    }, [service, storyId]);
}
