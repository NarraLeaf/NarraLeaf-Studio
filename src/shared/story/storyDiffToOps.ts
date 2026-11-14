import type { LiveSceneFields, LiveStoryOp } from "@shared/live/ops";
import type { StoryBlock, StoryBlockId, StoryChapter, StoryDocument, StoryScene, StorySceneId } from "@shared/types/story";

/**
 * The operations that turn one story document into another.
 *
 * **What offline editing in a team project replays.** While a Studio cannot reach its Team
 * server it edits its own copy; when it reconnects it compares that copy with the one it last
 * had in common with the server, turns the difference into ordinary story operations, puts its
 * copy back the way it was, catches up on what everybody else did, and sends these as intents
 * stamped with the seq it last saw. Whatever nobody else touched lands; a row somebody changed
 * in the meantime comes back as a conflict for the author to settle, one row at a time.
 *
 * Operations rather than a document because the server applies operations, and because an
 * operation names the record it writes - which is what makes a conflict a row rather than a
 * file.
 *
 * The order matters and is fixed: chapters appear before the scenes filed in them, scenes
 * before the rows inside them, parents before their children, deletions of rows before the
 * rows around them move, and chapter deletions last, after any scene that was moved out of a
 * chapter has left it. Each group is stated so that applying it in order against `base`
 * produces `mine`'s structure.
 *
 * Pure. Neither input is modified, and the operations carry copies.
 */
export function storyDiffToOps(base: StoryDocument, mine: StoryDocument): LiveStoryOp[] {
    const ops: LiveStoryOp[] = [];

    if (base.name !== mine.name) {
        ops.push({ op: "rename-story", name: mine.name });
    }

    // Chapters that are new, first, so scenes can be filed in them.
    const baseChapters = new Map(base.chapters.map(chapter => [chapter.id, chapter]));
    const mineChapters = new Map(mine.chapters.map(chapter => [chapter.id, chapter]));
    for (const [index, chapter] of mine.chapters.entries()) {
        if (!baseChapters.has(chapter.id)) {
            const before = mine.chapters.slice(index + 1).find(next => baseChapters.has(next.id))?.id ?? null;
            ops.push({ op: "create-chapter", chapter: { ...copy(chapter), sceneIds: [] }, beforeChapterId: before });
        }
    }
    for (const chapter of mine.chapters) {
        const was = baseChapters.get(chapter.id);
        if (was !== undefined && was.name !== chapter.name) {
            ops.push({ op: "rename-chapter", chapterId: chapter.id, name: chapter.name });
        }
    }

    // Scenes that are new, filed where they sit in `mine`.
    for (const scene of Object.values(mine.scenes)) {
        if (base.scenes[scene.id] !== undefined) {
            continue;
        }
        const placed = placementOf(mine, scene.id);
        ops.push({
            op: "create-scene",
            scene: copy(scene),
            chapterId: placed.chapterId,
            beforeSceneId: null,
        });
    }

    // Scenes that are in both: their fields, their stacks, and their rows.
    for (const scene of Object.values(mine.scenes)) {
        const was = base.scenes[scene.id];
        if (was === undefined) {
            continue;
        }
        const fields = sceneFields(scene);
        if (!same(sceneFields(was), fields)) {
            ops.push({ op: "update-scene", sceneId: scene.id, fields });
        }
        if (!same(was.sceneSnapshots ?? [], scene.sceneSnapshots ?? [])) {
            ops.push({ op: "set-scene-snapshots", sceneId: scene.id, snapshots: copy(scene.sceneSnapshots ?? []) });
        }
        if (!same(was.layers ?? [], scene.layers ?? [])) {
            ops.push({ op: "set-scene-layers", sceneId: scene.id, layers: copy(scene.layers ?? []) });
        }
        ops.push(...rowOps(scene.id, was, scene));
    }

    // Where every scene of `mine` sits: chapter and order. Stated after every scene exists.
    ops.push(...sceneOrderOps(base, mine));

    // Chapter order, once every chapter is there. New chapters were placed by `create-chapter`;
    // this is for the chapters both sides have, when their order changed.
    const keptBase = base.chapters.map(chapter => chapter.id).filter(id => mineChapters.has(id));
    const keptMine = mine.chapters.map(chapter => chapter.id).filter(id => baseChapters.has(id));
    if (!same(keptBase, keptMine)) {
        ops.push({ op: "reorder-chapters", chapterIds: mine.chapters.map(chapter => chapter.id) });
    }

    // Scenes that are gone.
    for (const scene of Object.values(base.scenes)) {
        if (mine.scenes[scene.id] === undefined) {
            ops.push({ op: "delete-scene", sceneId: scene.id });
        }
    }
    // Chapters that are gone - last, so a scene moved out of one has already left it.
    for (const chapter of base.chapters) {
        if (!mineChapters.has(chapter.id)) {
            ops.push({ op: "delete-chapter", chapterId: chapter.id });
        }
    }

    if ((base.entrySceneId ?? null) !== (mine.entrySceneId ?? null) && (mine.entrySceneId === undefined || mine.scenes[mine.entrySceneId])) {
        ops.push({ op: "set-entry-scene", sceneId: mine.entrySceneId ?? null });
    }
    return ops;
}

/** The rows of one scene: deletions, then insertions in document order, then moves, then edits. */
function rowOps(sceneId: StorySceneId, was: StoryScene, now: StoryScene): LiveStoryOp[] {
    const ops: LiveStoryOp[] = [];

    // Deleted rows. Only the outermost of a deleted subtree is named: deleting it takes the rest.
    const deleted = Object.keys(was.blocks).filter(id => now.blocks[id] === undefined);
    const outermost = deleted.filter(id => {
        const parent = was.blocks[id]?.parentId;
        return parent === null || parent === undefined || now.blocks[parent] !== undefined;
    });
    if (outermost.length === 1) {
        ops.push({ op: "delete-block", sceneId, blockId: outermost[0] });
    } else if (outermost.length > 1) {
        ops.push({ op: "delete-blocks", sceneId, blockIds: outermost });
    }

    // New rows, parents before children, each placed before the next sibling that already exists
    // by the time it is inserted. Walking siblings left to right and anchoring every new row on the
    // first kept sibling to its right keeps a run of new rows in their order.
    const existing = new Set(Object.keys(was.blocks).filter(id => now.blocks[id] !== undefined));
    const walk = (parentId: StoryBlockId | null, children: readonly StoryBlockId[]): void => {
        for (const [index, id] of children.entries()) {
            const block = now.blocks[id];
            if (block === undefined) {
                continue;
            }
            if (!existing.has(id)) {
                const before = children.slice(index + 1).find(next => existing.has(next)) ?? null;
                const inserted: StoryBlock = { ...copy(block), childrenIds: [] };
                ops.push({ op: "insert-block", sceneId, block: inserted, target: { parentId, beforeBlockId: before } });
            }
            walk(id, block.childrenIds);
        }
    };
    walk(null, now.rootBlockIds);

    // Kept rows whose parent changed, or whose order among the kept rows of their parent did.
    // Moved right to left, each before its right-hand neighbour in `mine`, which by then is where it
    // belongs - so the final order is `mine`'s however the rows were shuffled.
    const parents: Array<{ parentId: StoryBlockId | null; children: readonly StoryBlockId[] }> = [
        { parentId: null, children: now.rootBlockIds },
        ...Object.values(now.blocks).map(block => ({ parentId: block.id, children: block.childrenIds })),
    ];
    for (const { parentId, children } of parents) {
        const kept = children.filter(id => existing.has(id));
        const wasChildren = parentId === null ? was.rootBlockIds : (was.blocks[parentId]?.childrenIds ?? []);
        const wasKept = wasChildren.filter(id => existing.has(id) && kept.includes(id));
        const movedIn = kept.some(id => (was.blocks[id]?.parentId ?? null) !== parentId);
        if (!movedIn && same(wasKept, kept)) {
            continue;
        }
        for (let index = children.length - 1; index >= 0; index -= 1) {
            const id = children[index];
            if (!existing.has(id)) {
                continue;
            }
            const before = children[index + 1] ?? null;
            ops.push({ op: "move-block", sceneId, blockId: id, target: { parentId, beforeBlockId: before } });
        }
    }

    // Edited rows: what they say, and whether they are compiled out.
    for (const id of existing) {
        const previous = was.blocks[id];
        const current = now.blocks[id];
        if (previous === undefined || current === undefined) {
            continue;
        }
        if (!same(previous.payload, current.payload)) {
            ops.push({ op: "update-block", sceneId, blockId: id, payload: copy(current.payload) });
        }
        if ((previous.disabled === true) !== (current.disabled === true)) {
            ops.push({ op: "set-block-disabled", sceneId, blockId: id, disabled: current.disabled === true });
        }
    }
    // A new row's own disabled flag travels inside it, so nothing more is said about new rows.
    return ops;
}

/** Scene placement: one `move-scene` for every scene whose chapter or order in it differs. */
function sceneOrderOps(base: StoryDocument, mine: StoryDocument): LiveStoryOp[] {
    const ops: LiveStoryOp[] = [];
    for (const chapter of mine.chapters) {
        const wasChapter: StoryChapter | undefined = base.chapters.find(one => one.id === chapter.id);
        const kept = chapter.sceneIds.filter(id => mine.scenes[id] !== undefined);
        const wasOrder = (wasChapter?.sceneIds ?? []).filter(id => kept.includes(id));
        // A new scene was created at the end of this chapter, so it is out of place unless it is last.
        const settled = same(wasOrder, kept) && kept.every(id => base.scenes[id] !== undefined);
        if (settled) {
            continue;
        }
        for (let index = kept.length - 1; index >= 0; index -= 1) {
            ops.push({
                op: "move-scene",
                sceneId: kept[index],
                chapterId: chapter.id,
                beforeSceneId: kept[index + 1] ?? null,
            });
        }
    }
    // Scenes no chapter claims: moved back to that list when they were in a chapter before.
    for (const sceneId of mine.unassignedSceneIds ?? []) {
        const was = placementOf(base, sceneId);
        if (base.scenes[sceneId] !== undefined && was.chapterId !== null) {
            ops.push({ op: "move-scene", sceneId, chapterId: null, beforeSceneId: null });
        }
    }
    return ops;
}

function placementOf(document: StoryDocument, sceneId: StorySceneId): { chapterId: string | null } {
    const chapter = document.chapters.find(one => one.sceneIds.includes(sceneId));
    return { chapterId: chapter?.id ?? null };
}

function sceneFields(scene: StoryScene): LiveSceneFields {
    return {
        name: scene.name,
        runtimeName: scene.runtimeName,
        ...(scene.description === undefined ? {} : { description: scene.description }),
        ...(scene.defaultBackgroundAssetId === undefined ? {} : { defaultBackgroundAssetId: scene.defaultBackgroundAssetId }),
        ...(scene.bgm === undefined ? {} : { bgm: copy(scene.bgm) }),
    };
}

function copy<T>(value: T): T {
    return structuredClone(value);
}

/** Structural equality over JSON values, insensitive to key order. */
function same(left: unknown, right: unknown): boolean {
    if (left === right) {
        return true;
    }
    if (typeof left !== typeof right || left === null || right === null || typeof left !== "object") {
        return false;
    }
    if (Array.isArray(left) !== Array.isArray(right)) {
        return false;
    }
    if (Array.isArray(left)) {
        const other = right as unknown[];
        return left.length === other.length && left.every((item, index) => same(item, other[index]));
    }
    const a = left as Record<string, unknown>;
    const b = right as Record<string, unknown>;
    const keys = new Set([...Object.keys(a), ...Object.keys(b)].filter(key => a[key] !== undefined || b[key] !== undefined));
    for (const key of keys) {
        if (!same(a[key], b[key])) {
            return false;
        }
    }
    return true;
}
