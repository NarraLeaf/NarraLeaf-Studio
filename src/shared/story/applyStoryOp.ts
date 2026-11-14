import type { LiveStoryOp } from "@shared/live/ops";
import {
    isDefaultSceneLayerStack,
    normalizeSceneLayerStack,
    type StoryChapter,
    type StoryDocument,
    type StoryScene,
    type StorySceneId,
    type StorySceneLayer,
} from "@shared/types/story";
import { sceneRuntimeName } from "@shared/types/story/sceneRuntimeName";
import { RendererError } from "@shared/utils/error";
import {
    deleteBlockFromScene,
    insertBlockInScene,
    moveBlockInScene,
    moveBlocksInScene,
    updateBlockPayload,
} from "./storyModel";

/**
 * Apply one story operation to one story document, in place. **The one applier, wherever it runs.**
 *
 * The editor's `StoryService` and the Team server's project authority both end here, which is the
 * point of the file: a server that is the authority over a project has to produce, from the same
 * operation, exactly the document every Studio produces - and the only way two machines reliably
 * agree on that is to run the same code.
 *
 * Pure: no services, no events, no disk, no clock except the one handed in. What the caller does
 * around a change - marking the document dirty, saving it, redrawing, stamping `meta.updatedAt` -
 * is the caller's, because those differ between an editor and a server.
 *
 * ⚠ **Takes ownership of `op`.** Blocks, scenes and chapters inside it are written into the document
 * as they are, and inserting a block edits it on the way in. A caller holding the operation for
 * anything else - an effect log, a message still being sent, an undo record - passes a copy
 * (`structuredClone(op)`).
 *
 * ⚠ **`rename-story` reaches the library as well as the document.** Only the document half is done
 * here; the library entry is the caller's (a server holding a library applies it there, the editor
 * through its own library index).
 */
export function applyStoryOpToDocument(
    document: StoryDocument,
    op: LiveStoryOp,
    context: StoryOpApplyContext,
): StoryOpApplied {
    const { now } = context;
    switch (op.op) {
        case "insert-block":
            insertBlockInScene(sceneOrThrow(document, op.sceneId), op.block, op.target);
            return CHANGED;
        case "insert-blocks": {
            const scene = sceneOrThrow(document, op.sceneId);
            for (const insert of op.inserts) {
                insertBlockInScene(scene, insert.block, insert.target);
            }
            return CHANGED;
        }
        case "update-block":
            updateBlockPayload(sceneOrThrow(document, op.sceneId), op.blockId, op.payload);
            return CHANGED;
        case "update-blocks":
            for (const edit of op.edits) {
                updateBlockPayload(sceneOrThrow(document, edit.sceneId), edit.blockId, edit.payload);
            }
            return CHANGED;
        case "delete-block":
            deleteBlockFromScene(sceneOrThrow(document, op.sceneId), op.blockId);
            return CHANGED;
        case "delete-blocks": {
            // An id already gone by the time its turn comes is not an error: a container takes the
            // rows inside it, so a batch naming both removes the container first and finds the
            // child gone.
            const scene = sceneOrThrow(document, op.sceneId);
            for (const blockId of op.blockIds) {
                deleteBlockFromScene(scene, blockId);
            }
            return CHANGED;
        }
        case "move-block":
            moveBlockInScene(sceneOrThrow(document, op.sceneId), op.blockId, op.target);
            return CHANGED;
        case "move-blocks":
            moveBlocksInScene(
                sceneOrThrow(document, op.sceneId),
                op.moves.map(move => ({ blockIds: [...move.blockIds], target: move.target })),
            );
            return CHANGED;
        case "set-block-disabled": {
            const block = sceneOrThrow(document, op.sceneId).blocks[op.blockId];
            if (!block) {
                return UNCHANGED;
            }
            if (op.disabled) {
                block.disabled = true;
            } else {
                delete block.disabled;
            }
            return CHANGED;
        }
        case "rename-scene": {
            const scene = document.scenes[op.sceneId];
            if (!scene) {
                return UNCHANGED;
            }
            // The internal name the scene compiled under a moment ago, pinned before the display
            // name moves. A scene stored with an empty one compiles under its display name, so
            // letting the rename through unpinned would move its variables - see
            // `sceneRuntimeName`. Every machine derives the same pin from the same record, which is
            // why this one may be worked out on the receiving side.
            scene.runtimeName = sceneRuntimeName(scene);
            scene.name = op.name;
            scene.meta = { ...scene.meta, updatedAt: now };
            return CHANGED;
        }
        case "set-entry-scene":
            if (op.sceneId && !document.scenes[op.sceneId]) {
                throw new RendererError(`Scene not found: ${op.sceneId}`);
            }
            document.entrySceneId = op.sceneId ?? undefined;
            return CHANGED;
        case "rename-story":
            document.name = op.name;
            return CHANGED;
        case "reorder-chapters": {
            // Chapters the order does not name keep their places at the end rather than being
            // dropped: an order written against a document that has since gained a chapter is a
            // stale statement about position, never a request to delete the chapter.
            const byId = new Map(document.chapters.map(chapter => [chapter.id, chapter]));
            const ordered: StoryChapter[] = [];
            for (const id of op.chapterIds) {
                const chapter = byId.get(id);
                if (chapter) {
                    ordered.push(chapter);
                    byId.delete(id);
                }
            }
            document.chapters = [...ordered, ...byId.values()];
            return CHANGED;
        }
        case "create-scene": {
            const scene = op.scene;
            let target = op.chapterId === null
                ? undefined
                : document.chapters.find(item => item.id === op.chapterId);
            if (!target && op.chapter) {
                target = op.chapter;
                document.chapters.push(target);
            }
            document.scenes[scene.id] = scene;
            if (target) {
                const at = op.beforeSceneId === null ? -1 : target.sceneIds.indexOf(op.beforeSceneId);
                if (at === -1) {
                    target.sceneIds.push(scene.id);
                } else {
                    target.sceneIds.splice(at, 0, scene.id);
                }
            } else {
                // A scene no chapter claims - what an imported document can hold. Named in the list
                // that orders those, because a scene in neither list is one the outline never draws.
                document.unassignedSceneIds = [...(document.unassignedSceneIds ?? []), scene.id];
            }
            if (op.entry === true || !document.entrySceneId) {
                document.entrySceneId = scene.id;
            }
            return CHANGED;
        }
        case "delete-scene": {
            if (!document.scenes[op.sceneId]) {
                return UNCHANGED;
            }
            delete document.scenes[op.sceneId];
            for (const chapter of document.chapters) {
                chapter.sceneIds = chapter.sceneIds.filter(id => id !== op.sceneId);
            }
            if (document.unassignedSceneIds) {
                document.unassignedSceneIds = document.unassignedSceneIds.filter(id => id !== op.sceneId);
            }
            if (document.entrySceneId === op.sceneId) {
                document.entrySceneId = firstSceneId(document);
            }
            return CHANGED;
        }
        case "update-scene": {
            const scene = document.scenes[op.sceneId];
            if (!scene) {
                return UNCHANGED;
            }
            const { fields } = op;
            scene.name = fields.name;
            scene.runtimeName = fields.runtimeName;
            if (fields.description === undefined) {
                delete scene.description;
            } else {
                scene.description = fields.description;
            }
            if (fields.defaultBackgroundAssetId === undefined) {
                delete scene.defaultBackgroundAssetId;
            } else {
                scene.defaultBackgroundAssetId = fields.defaultBackgroundAssetId;
            }
            if (fields.bgm === undefined) {
                delete scene.bgm;
            } else {
                scene.bgm = fields.bgm;
            }
            scene.meta = { ...scene.meta, updatedAt: now };
            return CHANGED;
        }
        case "move-scene": {
            const targetChapter = op.chapterId === null
                ? undefined
                : document.chapters.find(chapter => chapter.id === op.chapterId);
            if ((op.chapterId !== null && !targetChapter) || !document.scenes[op.sceneId]) {
                return UNCHANGED;
            }
            for (const chapter of document.chapters) {
                chapter.sceneIds = chapter.sceneIds.filter(id => id !== op.sceneId);
            }
            if (document.unassignedSceneIds) {
                document.unassignedSceneIds = document.unassignedSceneIds.filter(id => id !== op.sceneId);
            }
            if (!targetChapter) {
                // Back to the scenes no chapter claims, which is where an inverse of a move OUT of
                // that state has to put it.
                document.unassignedSceneIds = [...(document.unassignedSceneIds ?? []), op.sceneId];
                return CHANGED;
            }
            const at = op.beforeSceneId ? targetChapter.sceneIds.indexOf(op.beforeSceneId) : -1;
            if (at === -1) {
                targetChapter.sceneIds.push(op.sceneId);
            } else {
                targetChapter.sceneIds.splice(at, 0, op.sceneId);
            }
            return CHANGED;
        }
        case "set-scene-snapshots": {
            const scene = document.scenes[op.sceneId];
            if (!scene) {
                return UNCHANGED;
            }
            scene.sceneSnapshots = op.snapshots.map(snapshot => ({ ...snapshot, values: { ...snapshot.values } }));
            return CHANGED;
        }
        case "set-scene-layers": {
            const scene = document.scenes[op.sceneId];
            if (!scene) {
                return UNCHANGED;
            }
            const next = normalizeSceneLayerStack(op.layers as StorySceneLayer[]);
            if (isDefaultSceneLayerStack(next)) {
                delete scene.layers;
            } else {
                scene.layers = next;
            }
            return CHANGED;
        }
        case "create-chapter": {
            if (!document.chapters.some(item => item.id === op.chapter.id)) {
                const at = op.beforeChapterId === null
                    ? -1
                    : document.chapters.findIndex(item => item.id === op.beforeChapterId);
                if (at === -1) {
                    document.chapters.push(op.chapter);
                } else {
                    document.chapters.splice(at, 0, op.chapter);
                }
            }
            for (const scene of op.scenes ?? []) {
                document.scenes[scene.id] = scene as StoryScene;
            }
            if (op.entry !== undefined && document.scenes[op.entry]) {
                document.entrySceneId = op.entry;
            }
            return CHANGED;
        }
        case "rename-chapter": {
            const chapter = document.chapters.find(item => item.id === op.chapterId);
            if (!chapter) {
                return UNCHANGED;
            }
            chapter.name = op.name;
            chapter.meta = { ...chapter.meta, updatedAt: now };
            return CHANGED;
        }
        case "delete-chapter": {
            const index = document.chapters.findIndex(chapter => chapter.id === op.chapterId);
            if (index === -1) {
                return UNCHANGED;
            }
            const [chapter] = document.chapters.splice(index, 1);
            for (const sceneId of chapter.sceneIds) {
                delete document.scenes[sceneId];
            }
            if (document.entrySceneId && !document.scenes[document.entrySceneId]) {
                document.entrySceneId = firstSceneId(document);
            }
            return CHANGED;
        }
        default: {
            // Exhaustive over the vocabulary, and this is what says so: a verb nobody applied here
            // would otherwise be a silent no-op on one machine and an edit on every other.
            const unapplied: never = op;
            throw new Error(`No applier for story operation: ${JSON.stringify(unapplied)}`);
        }
    }
}

/** What {@link applyStoryOpToDocument} needs from the world. */
export type StoryOpApplyContext = {
    /** The instant stamped on the records an operation touches, as an ISO string. */
    now: string;
};

/** What applying one operation did. */
export type StoryOpApplied = {
    /** False when the operation named something that is not there and nothing was written. */
    changed: boolean;
};

const CHANGED: StoryOpApplied = Object.freeze({ changed: true });
const UNCHANGED: StoryOpApplied = Object.freeze({ changed: false });

/**
 * The scenes an operation can reach, or undefined when it may reach the document as a whole.
 *
 * What the editor's serialisation cache is told so the next save re-serialises just those scenes.
 * Naming too few writes a stale file, so anything that is not plainly one scene's rows answers
 * undefined.
 */
export function storyOpSceneReach(op: LiveStoryOp): readonly StorySceneId[] | undefined {
    switch (op.op) {
        case "insert-block":
        case "insert-blocks":
        case "update-block":
        case "delete-block":
        case "delete-blocks":
        case "move-block":
        case "move-blocks":
        case "set-block-disabled":
            return [op.sceneId];
        case "update-blocks":
            return op.edits.map(edit => edit.sceneId);
        default:
            return undefined;
    }
}

/** The scene an entry pointer falls back to: the first scene of the first chapter that has one. */
export function firstSceneId(document: StoryDocument): StorySceneId | undefined {
    for (const chapter of document.chapters) {
        if (chapter.sceneIds[0]) {
            return chapter.sceneIds[0];
        }
    }
    return undefined;
}

function sceneOrThrow(document: StoryDocument, sceneId: StorySceneId): StoryScene {
    const scene = document.scenes[sceneId];
    if (!scene) {
        throw new RendererError(`Scene not found: ${sceneId}`);
    }
    return scene;
}
