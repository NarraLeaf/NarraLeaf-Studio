import type { StoryDocument } from "@shared/types/story";

/**
 * What a drag in the story outline is carrying.
 *
 * The outline has two kinds of row and they move for different reasons: a scene changes which
 * chapter holds it and where in that chapter it sits, a chapter only changes where it sits among
 * the other chapters. Keeping them apart here is what lets a gap refuse a gesture that has no
 * meaning there - a chapter dropped between two scenes - instead of guessing at one.
 */
export type StoryOutlineDrag =
    | { kind: "scene"; sceneId: string }
    | { kind: "chapter"; chapterId: string };

/** One row of the outline as it is drawn: a chapter heading, or a scene under one. */
export type StoryOutlineRow =
    | { kind: "chapter"; chapterId: string }
    | { kind: "scene"; sceneId: string; chapterId: string };

/** Which half of a row the pointer is in. */
export type StoryOutlineHalf = "top" | "bottom";

/**
 * Where a dragged row would land, as an index into the gaps between rows.
 *
 * **The whole point of this being one number.** The outline is one list to the author - headings and
 * scenes in one column - and it used to be two independent target systems, one per kind of row, each
 * with its own geometry. At every seam that produced two insertion points a pixel apart meaning
 * almost the same thing, and nudging the pointer flicked between them. `n` rows have `n + 1` gaps;
 * the bottom half of row `i` and the top half of row `i + 1` are the same gap, so there is one
 * answer and one line wherever the pointer is.
 */
export type StoryOutlineGap = number;

/** What the outline draws while a row is in the air. */
export interface StoryOutlineDropHint {
    gap: StoryOutlineGap;
    dragKind: StoryOutlineDrag["kind"];
}

/** Where a dragged scene lands, in the shape `StoryService.moveScene` takes. */
export interface StorySceneMove {
    chapterId: string;
    beforeSceneId: string | null;
}

/** Where a dragged chapter lands, in the shape `StoryService.moveChapter` takes. */
export interface StoryChapterMove {
    beforeChapterId: string | null;
}

/**
 * The rows the outline is showing, in the order it shows them.
 *
 * A collapsed chapter contributes its heading and nothing else, because its scenes are not on
 * screen: a gap the author cannot see is not a gap they can aim at.
 */
export function buildOutlineRows(document: StoryDocument, openChapterIds: ReadonlySet<string>): StoryOutlineRow[] {
    const rows: StoryOutlineRow[] = [];
    for (const chapter of document.chapters) {
        rows.push({ kind: "chapter", chapterId: chapter.id });
        if (!openChapterIds.has(chapter.id)) {
            continue;
        }
        for (const sceneId of chapter.sceneIds) {
            if (document.scenes[sceneId]) {
                rows.push({ kind: "scene", sceneId, chapterId: chapter.id });
            }
        }
    }
    return rows;
}

export function outlineHalfFromPointer(clientY: number, rect: { top: number; height: number }): StoryOutlineHalf {
    return clientY < rect.top + rect.height / 2 ? "top" : "bottom";
}

/** The gap a pointer in this half of this row is aiming at. */
export function outlineGapForRow(rowIndex: number, half: StoryOutlineHalf): StoryOutlineGap {
    return half === "top" ? rowIndex : rowIndex + 1;
}

/**
 * A chapter drag only has somewhere to land at a chapter boundary, so its two halves mean the two
 * ends of the chapter's whole block rather than the two sides of its heading row.
 *
 * Without this the bottom half of an expanded chapter's heading would aim at the gap above its
 * first scene, which is not a place a chapter can go - a dead half on every heading.
 */
export function outlineChapterGapForRow(
    rows: readonly StoryOutlineRow[],
    rowIndex: number,
    half: StoryOutlineHalf,
): StoryOutlineGap | null {
    const row = rows[rowIndex];
    if (!row || row.kind !== "chapter") {
        return null;
    }
    if (half === "top") {
        return rowIndex;
    }
    let end = rowIndex + 1;
    while (end < rows.length && rows[end].kind === "scene") {
        end += 1;
    }
    return end;
}

/**
 * The row the one indicator hangs on, and which edge of it.
 *
 * The other half of the model above: a gap is drawn as the top edge of the row below it, and never
 * also as the bottom edge of the row above, so one gap is one line in one place.
 */
export function outlineGapAnchor(
    rowCount: number,
    gap: StoryOutlineGap,
): { rowIndex: number; edge: "before" | "after" } | null {
    if (rowCount === 0 || gap < 0 || gap > rowCount) {
        return null;
    }
    return gap < rowCount
        ? { rowIndex: gap, edge: "before" }
        : { rowIndex: rowCount - 1, edge: "after" };
}

/**
 * Where a scene drag would put the scene, or null when the gap is not a place it can go.
 *
 * Null is not a failure the caller has to report: it is either "this is the position the scene is
 * already in" - what dropping a row back where it came from means - or "nothing above this gap can
 * hold a scene", which is only true of the gap above the first heading. The caller writes nothing,
 * and a drag that writes nothing must not become an undo entry or, inside a live session, a message
 * to everyone else in the room.
 *
 * The insertion point is worked out against the chapter **with the dragged scene taken out**,
 * because that is the list `moveScene` inserts into: it unfiles the scene from every chapter first,
 * so an index read off the list as drawn would be one too far whenever the scene moves down within
 * its own chapter.
 */
export function resolveSceneDropAtGap(
    document: StoryDocument,
    rows: readonly StoryOutlineRow[],
    sceneId: string,
    gap: StoryOutlineGap,
): StorySceneMove | null {
    if (!document.scenes[sceneId] || gap < 0 || gap > rows.length) {
        return null;
    }
    const below = rows[gap];
    const above = rows[gap - 1];
    // A gap above a scene is that scene's place. Any other gap is the end of whatever chapter the
    // row above it belongs to - and for a heading that is the chapter itself, so dropping just under
    // a collapsed heading files the scene in it.
    const targetChapterId = below?.kind === "scene" ? below.chapterId : above?.chapterId;
    if (!targetChapterId) {
        return null;
    }
    const targetChapter = document.chapters.find(chapter => chapter.id === targetChapterId);
    if (!targetChapter) {
        return null;
    }

    const remaining = targetChapter.sceneIds.filter(id => id !== sceneId);
    const anchorSceneId = below?.kind === "scene" && below.chapterId === targetChapterId ? below.sceneId : null;
    const insertAt = anchorSceneId === null ? remaining.length : remaining.indexOf(anchorSceneId);
    if (insertAt === -1) {
        // The row below the gap is the scene being dragged, so this gap is the one it came out of.
        return null;
    }

    const fromChapter = document.chapters.find(chapter => chapter.sceneIds.includes(sceneId));
    if (fromChapter?.id === targetChapterId && fromChapter.sceneIds.indexOf(sceneId) === insertAt) {
        return null;
    }

    return {
        chapterId: targetChapterId,
        beforeSceneId: insertAt >= remaining.length ? null : remaining[insertAt],
    };
}

/**
 * Where a chapter drag would put the chapter, or null when the gap is not a chapter boundary.
 *
 * Gaps between the scenes of a chapter are refused rather than guessed at: a chapter dropped inside
 * another chapter's scenes has no position to mean there.
 */
export function resolveChapterDropAtGap(
    document: StoryDocument,
    rows: readonly StoryOutlineRow[],
    chapterId: string,
    gap: StoryOutlineGap,
): StoryChapterMove | null {
    if (gap < 0 || gap > rows.length) {
        return null;
    }
    const below = rows[gap];
    if (below && below.kind !== "chapter") {
        return null;
    }
    const beforeChapterId = below ? below.chapterId : null;
    if (beforeChapterId === chapterId) {
        return null;
    }

    const ids = document.chapters.map(chapter => chapter.id);
    const fromIndex = ids.indexOf(chapterId);
    if (fromIndex === -1) {
        return null;
    }
    const withoutDragged = ids.filter(id => id !== chapterId);
    const insertAt = beforeChapterId === null
        ? withoutDragged.length
        : withoutDragged.indexOf(beforeChapterId);
    if (insertAt === -1 || fromIndex === insertAt) {
        return null;
    }
    return { beforeChapterId };
}

/**
 * Whether a gap should draw the indicator for the drag in flight.
 *
 * One function so the outline cannot light a gap up for a drop it would then refuse: this asks the
 * same resolvers the drop asks.
 */
export function isOutlineDropAllowed(
    document: StoryDocument,
    rows: readonly StoryOutlineRow[],
    drag: StoryOutlineDrag,
    gap: StoryOutlineGap,
): boolean {
    return drag.kind === "scene"
        ? resolveSceneDropAtGap(document, rows, drag.sceneId, gap) !== null
        : resolveChapterDropAtGap(document, rows, drag.chapterId, gap) !== null;
}
