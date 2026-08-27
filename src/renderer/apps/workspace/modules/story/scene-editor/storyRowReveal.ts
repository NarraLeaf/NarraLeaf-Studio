import type { StoryBlockId } from "@shared/types/story";

/**
 * One vocabulary for every move of the scene editor's viewport.
 *
 * The editor has a dozen reasons to put a row in front of the author — an arrow key, a search result,
 * a line committed at the end of a chapter, the scene flow map handing over a drafted jump, Dev Mode's
 * play head walking the scene as the game runs. Each of those used to answer "and how far should the
 * page move" for itself, and the answers disagreed: some centred the row, some nudged it, some moved
 * the page for a row the author had just clicked on and was already looking at.
 *
 * They disagreed because none of them said out loud the one thing the answer depends on, which is not
 * *what* is being revealed but *how the author got there*. That is what an intent names.
 */
export type StoryRevealIntent =
    /**
     * The author is already looking at it: they clicked the row, dragged onto it, dropped it here. The
     * page must not move at all. It is under their pointer, and taking it out from under a gesture
     * still in flight turns a click into a drag across whatever slid up to meet the cursor.
     */
    | "none"
    /**
     * The cursor moved one step, under the author's hand — an arrow, Enter opening the next line, a row
     * deleted and the caret falling back onto its neighbour, a slot opening where they asked for one.
     * They know where they are, so the page moves the smallest distance that puts the target back
     * inside the edge it left through, and not one pixel further.
     */
    | "step"
    /**
     * The author arrived from somewhere else: a search result, a lint entry, the scene flow map, an
     * undo landing on a row they had scrolled away from. They do not know what is around the target,
     * so it is placed with a screenful of context above it rather than at the edge it happens to be
     * nearest. A target already fully on screen is left where it is — arriving at the line you were
     * already reading is not a reason to move the page.
     */
    | "jump";

/**
 * What is being revealed. Not always a row: the thing the author's caret is in may be an insert slot,
 * which is not a row of its own (it renders inside its host row's wrapper, or past the end of the
 * list), or the "add a row" line past the last row, which is a button rather than a block.
 */
export type StoryRevealTarget =
    | { kind: "row"; blockId: StoryBlockId }
    | { kind: "slot" }
    | { kind: "addRow" };

export type StoryRowRevealRequest = {
    target: StoryRevealTarget;
    intent: StoryRevealIntent;
    /**
     * Bumped per request, so asking for the same target twice is two moves rather than one. The same
     * reason `StorySceneEditorTabPayload.revealToken` exists: without it, the second ask is a click
     * that does nothing.
     */
    token: number;
};

/** A target's extent in the scroller's content coordinates — the same space as `scrollTop`. */
export type StoryRevealBand = {
    top: number;
    height: number;
};

export type StoryRevealView = {
    scrollTop: number;
    /** Visible height of the scroll port. */
    height: number;
    /** Largest `scrollTop` the content allows. */
    maxScrollTop: number;
    /**
     * Breathing room kept beyond the target, so a revealed row never sits flush against an edge with
     * nothing after it. One row's worth is what makes an arrow at the bottom of the page show the line
     * you are about to walk onto.
     */
    lead: number;
};

/**
 * How far down the page a jump lands its target: a third, not a half.
 *
 * Centring reads as "the page moved as much as it possibly could" — the author's eye has to find the
 * row again in the middle of a screen that changed completely. A third puts the target where a reader
 * naturally looks while leaving most of the screen for what follows it, which is what someone
 * arriving from a search result is about to read.
 */
export const STORY_REVEAL_READING_OFFSET = 1 / 3;

/** Sub-pixel noise from measured row heights must not read as "not quite visible" and start a move. */
const EPSILON = 1;

/**
 * Where the scroller should end up to satisfy `intent`, or null when it should not move at all.
 *
 * Pure, and deliberately so: this is the whole of the model, and it is the part worth a test rather
 * than a screenshot. Everything around it is plumbing — finding the target's band, and re-running this
 * once the row it just scrolled to has mounted and measured itself honestly.
 */
export function resolveRevealScrollTop(
    intent: StoryRevealIntent,
    band: StoryRevealBand,
    view: StoryRevealView,
): number | null {
    if (intent === "none") {
        return null;
    }
    const clamp = (value: number): number => Math.max(0, Math.min(value, Math.max(0, view.maxScrollTop)));
    const viewTop = view.scrollTop;
    const viewBottom = view.scrollTop + view.height;
    const bandBottom = band.top + band.height;

    // A lead only earns its name while it fits. On a short pane — a scene editor sharing the column
    // with the live preview, a row that wrapped to five lines — two leads plus the target are taller
    // than the viewport, and a margin that does not fit is not a margin, it is the two edges pulling
    // the page in opposite directions for as long as the loop runs.
    const lead = Math.max(0, Math.min(view.lead, (view.height - band.height) / 2));

    if (intent === "jump") {
        const fullyVisible = band.top >= viewTop - EPSILON && bandBottom <= viewBottom + EPSILON;
        if (!fullyVisible) {
            return clamp(band.top - view.height * STORY_REVEAL_READING_OFFSET);
        }
        // Already in front of the author. Fall through to the minimal move, which will either leave the
        // page alone or lift the row off an edge it was flush against.
    }

    if (band.top - lead >= viewTop - EPSILON && bandBottom + lead <= viewBottom + EPSILON) {
        return null;
    }
    // Taller than the page can show: only one end of it can be visible, and the end you read from is
    // the top. Aligning the bottom instead would answer "scroll down to reach it" with the row's tail.
    if (band.height + lead * 2 > view.height) {
        return clamp(band.top - lead);
    }
    if (band.top - lead < viewTop) {
        return clamp(band.top - lead);
    }
    return clamp(bandBottom + lead - view.height);
}

/**
 * The lead for a viewport, from the height of one row.
 *
 * One row is the useful amount: it is exactly the context an arrow key is about to need. The cap keeps
 * it from swallowing a short pane, where a fixed 36px is a sixth of everything the author can see.
 */
export function storyRevealLead(rowHeight: number, viewportHeight: number): number {
    return Math.max(0, Math.min(rowHeight, viewportHeight * 0.15));
}
