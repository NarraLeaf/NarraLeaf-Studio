import type { StoryDocument } from "@shared/types/story";

/**
 * What a drag in the story outline is carrying.
 *
 * The outline has two kinds of row and they move for different reasons: a scene changes which
 * chapter holds it and where in that chapter it sits, a chapter only changes where it sits among
 * the other chapters. Keeping them apart here is what lets the drop targets refuse a gesture that
 * has no meaning - a chapter dropped onto a scene row - instead of guessing at one.
 */
export type StoryOutlineDrag =
    | { kind: "scene"; sceneId: string }
    | { kind: "chapter"; chapterId: string };

/**
 * The row the pointer is over, and which half of it.
 *
 * `edge` is pure geometry: it says which side of the row's midpoint the pointer is on, and the
 * resolvers below decide what that means for the thing being dragged. A scene dropped on a chapter
 * header ignores it - see {@link resolveSceneDrop}.
 */
export type StoryOutlineDropTarget =
    | { kind: "scene"; sceneId: string; edge: StoryOutlineEdge }
    | { kind: "chapter"; chapterId: string; edge: StoryOutlineEdge };

export type StoryOutlineEdge = "before" | "after";

/** Where a dragged scene lands, in the shape `StoryService.moveScene` takes. */
export interface StorySceneMove {
    chapterId: string;
    beforeSceneId: string | null;
}

/** Where a dragged chapter lands, in the shape `StoryService.moveChapter` takes. */
export interface StoryChapterMove {
    beforeChapterId: string | null;
}

/** Which half of a row a pointer at `clientY` is in. */
export function outlineEdgeFromPointer(clientY: number, rect: { top: number; height: number }): StoryOutlineEdge {
    return clientY < rect.top + rect.height / 2 ? "before" : "after";
}

function findChapterOfScene(document: StoryDocument, sceneId: string): string | undefined {
    return document.chapters.find(chapter => chapter.sceneIds.includes(sceneId))?.id;
}

/**
 * Where a scene drag would put the scene, or null when the drop would change nothing.
 *
 * Null is not a failure the caller has to report: it is "this drop is the position the scene is
 * already in", which is what dropping a row back on itself or on the gap it came out of means. The
 * caller writes nothing, and a drag that writes nothing must not become an undo entry or - inside a
 * live session - a message to everyone else in the room.
 *
 * The insertion point is worked out against the chapter **with the dragged scene taken out**,
 * because that is the list `moveScene` inserts into: it unfiles the scene from every chapter first,
 * so an anchor index read off the list as drawn would be one too far whenever the scene is being
 * moved down within its own chapter.
 */
export function resolveSceneDrop(
    document: StoryDocument,
    sceneId: string,
    target: StoryOutlineDropTarget,
): StorySceneMove | null {
    if (!document.scenes[sceneId]) {
        return null;
    }
    const targetChapterId = target.kind === "chapter"
        ? target.chapterId
        : findChapterOfScene(document, target.sceneId);
    if (!targetChapterId) {
        return null;
    }
    const targetChapter = document.chapters.find(chapter => chapter.id === targetChapterId);
    if (!targetChapter) {
        return null;
    }

    const remaining = targetChapter.sceneIds.filter(id => id !== sceneId);
    let insertAt: number;
    if (target.kind === "chapter") {
        // A chapter header is the row directly above that chapter's first scene, so dropping on it
        // means the first position - the same place the indicator is drawn. Which half of the header
        // the pointer is in says nothing here: both halves are the one chapter.
        insertAt = 0;
    } else {
        const anchorIndex = remaining.indexOf(target.sceneId);
        if (anchorIndex === -1) {
            // The anchor is the scene being dragged. Dropping a row on itself is the no-op above.
            return null;
        }
        insertAt = target.edge === "before" ? anchorIndex : anchorIndex + 1;
    }

    const fromChapterId = findChapterOfScene(document, sceneId);
    if (fromChapterId === targetChapterId && targetChapter.sceneIds.indexOf(sceneId) === insertAt) {
        return null;
    }

    return {
        chapterId: targetChapterId,
        beforeSceneId: insertAt >= remaining.length ? null : remaining[insertAt],
    };
}

/**
 * Where a chapter drag would put the chapter, or null when the drop would change nothing.
 *
 * Scene rows are not targets for this: a chapter dropped inside another chapter's scenes has no
 * position to mean, and the honest answer to a gesture with no meaning is that it is not a drop.
 */
export function resolveChapterDrop(
    document: StoryDocument,
    chapterId: string,
    target: StoryOutlineDropTarget,
): StoryChapterMove | null {
    if (target.kind !== "chapter" || target.chapterId === chapterId) {
        return null;
    }
    const ids = document.chapters.map(chapter => chapter.id);
    const fromIndex = ids.indexOf(chapterId);
    if (fromIndex === -1) {
        return null;
    }
    const remaining = ids.filter(id => id !== chapterId);
    const anchorIndex = remaining.indexOf(target.chapterId);
    if (anchorIndex === -1) {
        return null;
    }
    const insertAt = target.edge === "before" ? anchorIndex : anchorIndex + 1;
    if (fromIndex === insertAt) {
        return null;
    }
    return { beforeChapterId: insertAt >= remaining.length ? null : remaining[insertAt] };
}

/**
 * Whether a row should draw a drop indicator for the drag in flight.
 *
 * One function for both row kinds so the panel cannot light a row up for a drop it would then
 * refuse: this asks the same resolvers the drop itself asks.
 */
export function isOutlineDropAllowed(
    document: StoryDocument,
    drag: StoryOutlineDrag,
    target: StoryOutlineDropTarget,
): boolean {
    if (drag.kind === "scene") {
        return resolveSceneDrop(document, drag.sceneId, target) !== null;
    }
    return resolveChapterDrop(document, drag.chapterId, target) !== null;
}

/**
 * Whether two targets name the same row and the same side of it.
 *
 * `dragover` fires continuously while the pointer sits still, so the panel compares before storing:
 * without this the outline would re-render dozens of times a second for a target that has not moved,
 * and every scene row's line-count projection would be rebuilt with it.
 */
export function sameOutlineDropTarget(a: StoryOutlineDropTarget, b: StoryOutlineDropTarget): boolean {
    if (a.kind !== b.kind || a.edge !== b.edge) {
        return false;
    }
    return a.kind === "scene" && b.kind === "scene"
        ? a.sceneId === b.sceneId
        : a.kind === "chapter" && b.kind === "chapter" && a.chapterId === b.chapterId;
}
