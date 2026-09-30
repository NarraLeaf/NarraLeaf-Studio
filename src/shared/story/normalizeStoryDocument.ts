/**
 * The second half of reading a story document: after the schema ladder has run, the pass that makes
 * the result self-consistent and writable.
 *
 * **It lives in `@shared` for the same reason the ladder next door does, one step further on.**
 * `migrateStoryDocument.ts` moved here so the main process could migrate a document it read off
 * disk; this moved here so the main process can *write one back*. Those are different requirements:
 * migrating is enough to compile a story correctly, but a document that is going to be serialized
 * has to survive the canonical encoder, and the encoder is the strict one - it throws on a key
 * holding `undefined` rather than dropping it the way `JSON.stringify` does.
 *
 * That distinction is the whole reason this file exists as its own module rather than staying in
 * the renderer's `storyModel.ts`, which re-exports it. Everything here is reachable from
 * `@shared/documents/specs/story.ts`, so `storySpec.parse` can honestly promise what
 * {@link import("../documents/types").DocumentSpec} asks of it - a value at the current schema
 * version, or a refusal - and `storySpec.serialize` can stop refusing.
 *
 * **Three properties this pass must have, and each one is load-bearing for the merge path:**
 *
 *  1. **Deterministic.** No clock, no randomness. `now` is optional precisely so a caller with no
 *     business inventing a timestamp - the document spec - can leave `meta.updatedAt` alone.
 *  2. **Idempotent.** Normalizing an already-normalized document changes nothing. Three-way merge
 *     parses three sides and writes one back; if this pass moved a document a little further on
 *     every call, the bytes committed would not be the bytes the decision list described.
 *  3. **Free of assigned `undefined`.** A key whose value normalizes away is *removed*, not set to
 *     `undefined`. `JSON.stringify` cannot tell those apart, `encodeCanonicalJson` can, and it
 *     refuses the second - so the renderer's old spelling would have made every story unwritable
 *     through the spec.
 */

import {
    deriveUnassignedSceneIds,
    STORY_DOCUMENT_SCHEMA_VERSION,
    StoryBlock,
    StoryBlockId,
    StoryChapter,
    StoryDocument,
    StoryMeta,
    StoryScene,
    StorySceneId,
} from "@shared/types/story";
import { assertValidStoryId } from "@shared/utils/storyId";
import { migrateStoryDocumentToLatest, StoryDocumentTooNewError } from "@shared/story/migrateStoryDocument";

/**
 * Refuse a document this build cannot represent.
 *
 * Two rejections, and they fail for opposite reasons. **Newer than this build** cannot be migrated
 * down: every field this Studio has not heard of would be dropped by the pass below and written
 * back by the next save, so opening a project once in an older Studio would silently strip the
 * newer one's work. **Not exactly the current version** after the ladder has run means the ladder
 * did not do its job - a version it has no step for and does not stamp - and a half-migrated
 * document is the one outcome `DocumentSpec.parse` says must not happen.
 *
 * Neither of these is the check for a document that is too OLD. That one belongs to the ladder, not
 * here, and it has to: by the time this runs the only thing left to say is "not the current
 * version", which names neither the version the document is at nor the oldest one that opens. See
 * `STORY_DOCUMENT_MIN_SUPPORTED_VERSION`.
 *
 * Called *after* {@link migrateStoryDocumentToLatest}, never instead of it. The ladder refuses a
 * newer document itself, by name, and the story spec has a still earlier guard on the raw record
 * (`rejectNewerSchema`); this one is the backstop that makes the post-condition true by
 * construction rather than by inspection of the ladder. It throws the ladder's own error so that a
 * reader looking for the two versions finds them whichever guard fired.
 */
export function assertSupportedStoryDocument(document: StoryDocument): void {
    if (document.schemaVersion > STORY_DOCUMENT_SCHEMA_VERSION) {
        throw new StoryDocumentTooNewError(document.schemaVersion, STORY_DOCUMENT_SCHEMA_VERSION);
    }
    if (document.schemaVersion !== STORY_DOCUMENT_SCHEMA_VERSION) {
        throw new Error("Story document migration is not implemented");
    }
}

/**
 * Migrate, then make the result consistent with itself.
 *
 * `now` is **optional**, and its absence is not a lesser call. With a timestamp, `meta.updatedAt`
 * is stamped when the document has never carried one - which is what a service loading a file for
 * an author wants. Without one, `meta` is left exactly as it was found, which is what a document
 * spec wants: `parse` runs on the three sides of a merge and on blobs out of a repository, and a
 * pass that stamped the wall clock there would make two parses of the same bytes differ, and with
 * them the bytes a merge writes back.
 *
 * What it fixes, all of it references that name nothing: chapters listing scenes that are gone,
 * scenes listing rows that are gone, rows whose parent is gone (re-rooted rather than dropped, so
 * the row stays reachable in the editor), an entry scene that no longer exists, and a scene's
 * opening track with no asset behind it.
 */
export function normalizeStoryDocument(document: StoryDocument, now?: string): StoryDocument {
    const migrated = migrateStoryDocumentToLatest(document);
    assertSupportedStoryDocument(migrated);
    assertValidStoryId(migrated.id);
    return normalizeMigrated(migrated, now);
}

/**
 * The same pass **without the identity assertion**, for a caller whose document is addressed by
 * path rather than by id.
 *
 * The difference is not a relaxation, it is a different question being asked. `assertValidStoryId`
 * is load-bearing in the renderer because `StoryService` BUILDS paths out of the id: a malformed id
 * there is a read or a write aimed at a directory nobody meant. The document spec is the other way
 * round - it takes the id *from* the path it was handed and never constructs one - so the same
 * assertion would decide nothing about safety and would instead make a whole class of document
 * unreadable: every historical revision blob, and every test and fixture whose story lives at
 * `stories/prologue/` rather than at a UUID. The diff surface has to stay maximally tolerant of
 * documents that came out of a repository, which is the one place shapes a current Studio would
 * never write are guaranteed to turn up.
 *
 * Everything the round-trip invariant rests on is still here: the ladder runs, the version is
 * asserted, and the structural pass is the identical one.
 */
export function normalizeStoryDocumentContent(document: StoryDocument): StoryDocument {
    const migrated = migrateStoryDocumentToLatest(document);
    assertSupportedStoryDocument(migrated);
    return normalizeMigrated(migrated, undefined);
}

function normalizeMigrated(migrated: StoryDocument, now: string | undefined): StoryDocument {
    const scenes: Record<StorySceneId, StoryScene> = {};
    for (const [sceneId, scene] of Object.entries(migrated.scenes ?? {})) {
        scenes[sceneId] = normalizeScene(scene);
    }
    const chapters = (migrated.chapters ?? []).map(chapter => ({
        ...chapter,
        sceneIds: (chapter.sceneIds ?? []).filter(sceneId => scenes[sceneId]),
    }));
    const entrySceneId = migrated.entrySceneId && scenes[migrated.entrySceneId]
        ? migrated.entrySceneId
        : firstSceneId(chapters);
    // The only writer of `unassignedSceneIds`. Recomputing here rather than having every chapter
    // mutation maintain it is the difference between a stale id that self-heals on the next load and
    // a missed call site that loses an order nothing can reconstruct. It is omitted when empty -
    // which is nearly every document - so a project that never had a chapter-less scene carries no
    // trace of the field and no diff line for it.
    const normalized: StoryDocument = { ...migrated, chapters, scenes };
    // Assigned only when there is one. `entrySceneId` is optional, and `{...doc, entrySceneId:
    // undefined}` is a key holding `undefined` - which `JSON.stringify` drops in silence and the
    // canonical encoder throws on. Deleting is what actually clears an entry scene the document
    // named and no longer has.
    if (entrySceneId !== undefined) {
        normalized.entrySceneId = entrySceneId;
    } else {
        delete normalized.entrySceneId;
    }
    const unassignedSceneIds = deriveUnassignedSceneIds(normalized);
    if (unassignedSceneIds.length > 0) {
        normalized.unassignedSceneIds = unassignedSceneIds;
    } else {
        delete normalized.unassignedSceneIds;
    }
    const meta = normalizeMeta(migrated.meta, now);
    if (meta !== undefined) {
        normalized.meta = meta;
    } else {
        delete normalized.meta;
    }
    return normalized;
}

/**
 * `meta` with `updatedAt` filled in, or nothing at all.
 *
 * Returning `undefined` for a document that has no `meta` and was given no `now` is the whole point:
 * the obvious spelling, `{...meta, updatedAt: meta?.updatedAt ?? now}`, produces `{updatedAt:
 * undefined}` in that case - an object whose only key cannot be encoded, on a document that had
 * nothing wrong with it.
 */
function normalizeMeta(meta: StoryMeta | undefined, now: string | undefined): StoryMeta | undefined {
    const updatedAt = meta?.updatedAt ?? now;
    if (meta === undefined && updatedAt === undefined) {
        return undefined;
    }
    return { ...meta, ...(updatedAt !== undefined ? { updatedAt } : {}) };
}

function normalizeScene(scene: StoryScene): StoryScene {
    const source = scene.blocks ?? {};
    const blocks: Record<StoryBlockId, StoryBlock> = {};
    for (const [id, block] of Object.entries(source)) {
        blocks[id] = {
            ...block,
            id,
            childrenIds: (block.childrenIds ?? []).filter(childId => source[childId]),
        } as StoryBlock;
    }
    const rootBlockIds = (scene.rootBlockIds ?? []).filter(blockId => blocks[blockId]);
    for (const block of Object.values(blocks)) {
        if (block.parentId && !blocks[block.parentId]) {
            block.parentId = null;
            if (!rootBlockIds.includes(block.id)) {
                rootBlockIds.push(block.id);
            }
        }
        if (block.kind === "jump") {
            block.childrenIds = [];
        }
    }
    const normalized: StoryScene = {
        ...scene,
        description: typeof scene.description === "string" ? scene.description : "",
        rootBlockIds,
        blocks,
    };
    // Both of these clear a value the document HELD, so neither can be expressed by spreading a
    // conditional: `...(bgm ? {bgm} : {})` leaves the unplayable record from `scene` in place, and
    // `bgm: undefined` leaves a key the canonical encoder refuses. Deleting is the only spelling
    // that means "this document no longer says that".
    const bgm = normalizeSceneBgm(scene.bgm);
    if (bgm !== undefined) {
        normalized.bgm = bgm;
    } else {
        delete normalized.bgm;
    }
    const defaultBackgroundAssetId = normalizeOptionalString(scene.defaultBackgroundAssetId);
    if (defaultBackgroundAssetId !== undefined) {
        normalized.defaultBackgroundAssetId = defaultBackgroundAssetId;
    } else {
        delete normalized.defaultBackgroundAssetId;
    }
    return normalized;
}

/**
 * The scene's opening track. A record with no asset id names nothing playable, so it is dropped
 * rather than carried - which also means a cleared picker leaves no residue in the document.
 */
function normalizeSceneBgm(value: StoryScene["bgm"]): StoryScene["bgm"] {
    const assetId = normalizeOptionalString(value?.assetId);
    if (!value || !assetId) {
        return undefined;
    }
    const volume = typeof value.volume === "number" && Number.isFinite(value.volume)
        ? Math.min(1, Math.max(0, value.volume))
        : undefined;
    const fadeMs = normalizeOptionalNonNegativeNumber(value.fadeMs);
    const audioTrackId = normalizeOptionalString(value.audioTrackId);
    return {
        assetId,
        // Kept as authored even when no track of that id exists: a reference to a deleted track
        // resolves to its bus's built-in at compile time, and dropping the id here would silently
        // discard the author's choice the moment they deleted a track they meant to re-create.
        ...(audioTrackId !== undefined ? { audioTrackId } : {}),
        ...(volume !== undefined ? { volume } : {}),
        ...(typeof value.loop === "boolean" ? { loop: value.loop } : {}),
        ...(fadeMs !== undefined ? { fadeMs } : {}),
    };
}

function firstSceneId(chapters: StoryChapter[]): StorySceneId | undefined {
    for (const chapter of chapters) {
        if (chapter.sceneIds[0]) {
            return chapter.sceneIds[0];
        }
    }
    return undefined;
}

/**
 * Shared with `storyModel.ts`, which normalizes the story library index and the motion assets with
 * the same two rules. One definition rather than two: they are the difference between a cleared
 * field and a field holding whitespace, and two copies of that judgement would drift.
 */
export function normalizeOptionalString(value: string | undefined): string | undefined {
    const trimmed = typeof value === "string" ? value.trim() : "";
    return trimmed || undefined;
}

export function normalizeOptionalNonNegativeNumber(value: unknown): number | undefined {
    return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : undefined;
}
