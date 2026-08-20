/**
 * The Move Mouse family's request, on the wire between a renderer and its main process.
 *
 * ## Why the renderer sends viewport pixels and not stage coordinates
 *
 * The author writes stage coordinates - the 1280×720 the surface was designed at - and that is what
 * the node's pins carry. Turning those into a point in the window is the renderer's job, because
 * only the renderer knows how the surface is currently laid out: which surface shell the point
 * belongs to, what it is scaled by, where letterboxing put it. Turning a point in the window into a
 * point on the desktop is the main process's job, because only it knows where the window is and
 * what the display's scale factor is.
 *
 * Splitting it there means neither side guesses at the other's business, and the seam carries the
 * one thing both agree on: a position in CSS pixels from the top-left of the web contents, which is
 * the same unit `MouseEvent.clientX` is in.
 *
 * Comments in English per project convention.
 */

export type BlueprintPointerMoveRequest = {
    /** CSS pixels from the left edge of the web contents, as `MouseEvent.clientX` reports them. */
    clientX: number;
    /** CSS pixels from the top edge of the web contents. */
    clientY: number;
    /**
     * How long the travel takes. Absent or zero puts the cursor there at once.
     *
     * Seconds, like every other duration an author types into a blueprint.
     */
    durationSeconds?: number;
    /** Ignored by an instant move. */
    easing?: BlueprintPointerMoveEasing;
};

export type BlueprintPointerMoveOutcome =
    /** The cursor is now at the requested point. */
    | "moved"
    /** This shell cannot move the cursor: a web export, or a host with no platform support. */
    | "unsupported"
    /** The move was attempted and failed. */
    | "failed";

export type BlueprintPointerMoveResult = {
    outcome: BlueprintPointerMoveOutcome;
    error?: string;
};

/** How the cursor travels to the target. */
export const BLUEPRINT_POINTER_MOVE_MODES = ["instant", "smooth"] as const;
export type BlueprintPointerMoveMode = (typeof BLUEPRINT_POINTER_MOVE_MODES)[number];

/**
 * The easing curves a smooth move may take.
 *
 * The same names the Displayable animation nodes use, so an author who has eased a fade knows what
 * these do without being taught a second vocabulary.
 */
export const BLUEPRINT_POINTER_MOVE_EASINGS = ["linear", "easeIn", "easeOut", "easeInOut"] as const;
export type BlueprintPointerMoveEasing = (typeof BLUEPRINT_POINTER_MOVE_EASINGS)[number];

/**
 * Upper bound on a smooth move, in seconds.
 *
 * A cursor the player cannot take back is the failure mode worth bounding, and a move still running
 * ten seconds later is indistinguishable from one that never ends. Authors who want the pointer
 * parked somewhere for longer say so with a wait, where it reads as a wait.
 */
export const BLUEPRINT_POINTER_MOVE_MAX_DURATION_SECONDS = 10;

export function normalizeBlueprintPointerMoveDurationSeconds(value: unknown): number {
    const seconds = typeof value === "number" ? value : Number(value);
    if (!Number.isFinite(seconds) || seconds <= 0) {
        return 0;
    }
    return Math.min(seconds, BLUEPRINT_POINTER_MOVE_MAX_DURATION_SECONDS);
}

export function easeBlueprintPointerMove(easing: BlueprintPointerMoveEasing, t: number): number {
    const clamped = Math.max(0, Math.min(1, t));
    switch (easing) {
        case "easeIn":
            return clamped * clamped;
        case "easeOut":
            return 1 - (1 - clamped) * (1 - clamped);
        case "easeInOut":
            return clamped < 0.5 ? 2 * clamped * clamped : 1 - 2 * (1 - clamped) * (1 - clamped);
        case "linear":
        default:
            return clamped;
    }
}
