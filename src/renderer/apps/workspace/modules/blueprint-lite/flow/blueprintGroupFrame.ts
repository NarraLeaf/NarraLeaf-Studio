/**
 * Geometry for blueprint groups.
 *
 * A group is a comment card in frame mode (`params.frame`), drawn behind the cards it encloses.
 * Membership is not stored anywhere: a card belongs to a group exactly while it sits inside the
 * frame, which is the rule the author can see. A stored member list would drift the moment a card
 * was dragged out - the frame would keep claiming it, and nothing on screen would say so.
 *
 * Containment is transitive, so a frame inside a frame needs no special handling: everything inside
 * the inner one is inside the outer one by the same test.
 *
 * Comments in English per project convention.
 */

// Re-exported so the canvas keeps reading its geometry from one import, while the rule itself
// lives beside the document types the interface panel's thumbnail also has to obey.
export {
    BLUEPRINT_COMMENT_DEFAULT_HEIGHT,
    BLUEPRINT_COMMENT_DEFAULT_WIDTH,
    readBlueprintCommentSize,
} from "@shared/blueprint/blueprintCommentGeometry";

export type BlueprintFrameRect = { x: number; y: number; width: number; height: number };
export type BlueprintFrameBox = BlueprintFrameRect & { id: string };

/**
 * Room a frame keeps around its members. The top band is deeper because the frame's own title row
 * is drawn in it - members start below the header rather than under it.
 */
export const BLUEPRINT_GROUP_FRAME_PADDING = { top: 48, right: 28, bottom: 28, left: 28 } as const;

/** A frame this small holds nothing, but it still has to be grabbable and readable. */
export const BLUEPRINT_GROUP_MIN_WIDTH = 220;
export const BLUEPRINT_GROUP_MIN_HEIGHT = 120;

/** Half a pixel of slack, so a card resting exactly on the frame edge counts as inside it. */
const CONTAINMENT_EPSILON = 0.5;

/** The frame that encloses `members`, or null when there is nothing to enclose. */
export function computeBlueprintGroupFrame(members: readonly BlueprintFrameRect[]): BlueprintFrameRect | null {
    if (members.length === 0) {
        return null;
    }
    const left = Math.min(...members.map(m => m.x));
    const top = Math.min(...members.map(m => m.y));
    const right = Math.max(...members.map(m => m.x + m.width));
    const bottom = Math.max(...members.map(m => m.y + m.height));
    const pad = BLUEPRINT_GROUP_FRAME_PADDING;
    return {
        x: Math.round(left - pad.left),
        y: Math.round(top - pad.top),
        width: Math.max(BLUEPRINT_GROUP_MIN_WIDTH, Math.round(right - left + pad.left + pad.right)),
        height: Math.max(BLUEPRINT_GROUP_MIN_HEIGHT, Math.round(bottom - top + pad.top + pad.bottom)),
    };
}

/** Whether `box` sits entirely inside `frame` - the one test membership and stacking both use. */
export function blueprintFrameContains(frame: BlueprintFrameRect, box: BlueprintFrameRect): boolean {
    return (
        box.x >= frame.x - CONTAINMENT_EPSILON &&
        box.y >= frame.y - CONTAINMENT_EPSILON &&
        box.x + box.width <= frame.x + frame.width + CONTAINMENT_EPSILON &&
        box.y + box.height <= frame.y + frame.height + CONTAINMENT_EPSILON
    );
}

/**
 * The cards a frame currently holds: every box that fits entirely inside it, minus the frame
 * itself. Partly-overlapping cards are not members - a card half out of a group would otherwise be
 * dragged along by a group it visibly is not in.
 */
export function blueprintGroupMemberIds(
    frameId: string,
    frame: BlueprintFrameRect,
    boxes: readonly BlueprintFrameBox[],
): string[] {
    return boxes.filter(box => box.id !== frameId && blueprintFrameContains(frame, box)).map(box => box.id);
}

/**
 * Frames resized around wherever their members ended up - what "Format graph" needs so a group
 * still encloses the same cards after every card moved.
 *
 * Smallest first, and each answer feeds the next: a nested frame is sized around its own members
 * before the frame containing it is sized around the nested frame.
 */
export function refitBlueprintGroupFrames(
    frames: readonly BlueprintFrameBox[],
    membersByFrameId: ReadonlyMap<string, readonly string[]>,
    movedBoxes: ReadonlyMap<string, BlueprintFrameRect>,
): Record<string, BlueprintFrameRect> {
    const working = new Map(movedBoxes);
    const refitted: Record<string, BlueprintFrameRect> = {};
    const innermostFirst = [...frames].sort(
        (a, b) => a.width * a.height - b.width * b.height || (a.id < b.id ? -1 : 1),
    );

    for (const frame of innermostFirst) {
        const memberRects = (membersByFrameId.get(frame.id) ?? [])
            .map(id => working.get(id))
            .filter((rect): rect is BlueprintFrameRect => Boolean(rect));
        const next = computeBlueprintGroupFrame(memberRects);
        if (!next) {
            // An empty frame has nothing to follow, so it stays where the author put it.
            continue;
        }
        refitted[frame.id] = next;
        working.set(frame.id, next);
    }

    return refitted;
}

/**
 * Which frame a card is being aimed at while it is dragged.
 *
 * The card's centre decides, not its outline: a card is dropped where the author is pointing, and
 * a card wider than the gap it is aimed into would otherwise never count as inside anything. The
 * smallest frame wins, so dropping into a group nested inside another joins the inner one - the
 * outer one still holds it, by the same containment rule as everything else.
 *
 * Frames the drag is carrying have to be left out by the caller: they move with the card, so one
 * of them enclosing it says nothing about where it is being put.
 */
export function pickBlueprintGroupDropTarget(
    frames: readonly BlueprintFrameBox[],
    box: BlueprintFrameRect,
): BlueprintFrameBox | null {
    const cx = box.x + box.width / 2;
    const cy = box.y + box.height / 2;
    const holding = frames.filter(
        frame =>
            cx >= frame.x - CONTAINMENT_EPSILON &&
            cy >= frame.y - CONTAINMENT_EPSILON &&
            cx <= frame.x + frame.width + CONTAINMENT_EPSILON &&
            cy <= frame.y + frame.height + CONTAINMENT_EPSILON,
    );
    if (holding.length === 0) {
        return null;
    }
    return holding.reduce((best, frame) =>
        frame.width * frame.height < best.width * best.height ? frame : best,
    );
}

/**
 * `frame` stretched just far enough to hold `boxes`, with the same room around them a new group
 * leaves. Every edge only ever moves outwards: a frame is the author's rectangle, and the space
 * they left empty in it is theirs to keep. Sizing it back down is what "Format graph" is for.
 */
export function growBlueprintFrameToHold(
    frame: BlueprintFrameRect,
    boxes: readonly BlueprintFrameRect[],
): BlueprintFrameRect {
    if (boxes.length === 0) {
        return frame;
    }
    const pad = BLUEPRINT_GROUP_FRAME_PADDING;
    const left = Math.min(frame.x, ...boxes.map(box => box.x - pad.left));
    const top = Math.min(frame.y, ...boxes.map(box => box.y - pad.top));
    const right = Math.max(frame.x + frame.width, ...boxes.map(box => box.x + box.width + pad.right));
    const bottom = Math.max(frame.y + frame.height, ...boxes.map(box => box.y + box.height + pad.bottom));
    return {
        x: Math.round(left),
        y: Math.round(top),
        width: Math.max(BLUEPRINT_GROUP_MIN_WIDTH, Math.round(right - left)),
        height: Math.max(BLUEPRINT_GROUP_MIN_HEIGHT, Math.round(bottom - top)),
    };
}

function blueprintFrameRectsEqual(a: BlueprintFrameRect, b: BlueprintFrameRect): boolean {
    return a.x === b.x && a.y === b.y && a.width === b.width && a.height === b.height;
}

/**
 * The frames that have to change size for a drop to mean what it looks like it means.
 *
 * The frame the cards were dropped into grows around them, and then every frame that was already
 * enclosing it grows around the result - otherwise a group could be pushed out through the wall of
 * the group it is in, and both memberships would be decided by a rectangle the author never drew.
 * Outward order, smallest first, so each answer is wrapped by the next.
 *
 * Frames that already held everything come back unlisted: nothing to write, and nothing to undo.
 */
export function growBlueprintGroupFramesForDrop(
    frames: readonly BlueprintFrameBox[],
    targetId: string,
    dropped: readonly BlueprintFrameRect[],
): Record<string, BlueprintFrameRect> {
    const target = frames.find(frame => frame.id === targetId);
    if (!target || dropped.length === 0) {
        return {};
    }
    const changed: Record<string, BlueprintFrameRect> = {};
    let inner: BlueprintFrameRect = growBlueprintFrameToHold(target, dropped);
    if (!blueprintFrameRectsEqual(inner, target)) {
        changed[targetId] = inner;
    }

    const enclosing = frames
        .filter(frame => frame.id !== targetId && blueprintFrameContains(frame, target))
        .sort((a, b) => a.width * a.height - b.width * b.height || (a.id < b.id ? -1 : 1));
    for (const frame of enclosing) {
        const grown = growBlueprintFrameToHold(frame, [inner]);
        if (!blueprintFrameRectsEqual(grown, frame)) {
            changed[frame.id] = grown;
        }
        inner = grown;
    }
    return changed;
}
