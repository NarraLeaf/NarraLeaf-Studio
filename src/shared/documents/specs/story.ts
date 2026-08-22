import {STORY_DOCUMENT_SCHEMA_VERSION, StoryDocument} from "@shared/types/story/document";
import {normalizeStoryDocumentContent} from "@shared/story/normalizeStoryDocument";
import {encodeCanonicalJson} from "../canonicalJson";
import {compileDocumentPathPattern} from "../documentPath";
import {defineDocumentSpec} from "../registry";
import type {DocumentParseContext} from "../types";
import {isJsonObject, parameterFromPath, rejectNewerSchema, requireDocumentObject, requireOptionalMap} from "./parseHelpers";
import {diffStoryDocument} from "./storyDiff";
import {merge3Story} from "./storyMerge3";

/**
 * `editor/story/stories/<storyId>/storydoc.json` - one story: its chapters, its scenes, its rows.
 *
 * **This spec reads and writes.** It used to refuse to write, and the refusal was not squeamishness:
 * `parse` did not run the story migration - the migration's second half, `normalizeStoryDocument`,
 * lived in the renderer and could not be reached from here - so a document read at v11 and written
 * back would have been stamped v12 without the migration ever having run. Normalize has since moved
 * to `@shared/story/normalizeStoryDocument` and `parse` runs both halves, which is what makes
 * writing honest rather than merely possible.
 *
 * **The invariant that makes a parse/serialize round trip safe**, stated here because everything
 * below depends on it:
 *
 * > Every value that leaves `parse` is stamped at exactly `STORY_DOCUMENT_SCHEMA_VERSION`, and is
 * > a fixed point of `parse` itself: `parse(serialize(parse(x)))` deep-equals `parse(x)`.
 *
 * It holds by construction, in four steps, none of which is a probabilistic argument:
 *
 *  1. A document whose `schemaVersion` is a number greater than this build's is refused before
 *     anything reads it, and one whose `schemaVersion` is present but not a number is refused too -
 *     see the note on that check below, it is the hole through which a newer document could
 *     otherwise be down-levelled in silence.
 *  2. `migrateStoryDocumentToLatest` ends in an unconditional stamp, so everything else arrives at
 *     the current version.
 *  3. `assertSupportedStoryDocument` then refuses anything that is not exactly the current version,
 *     which turns step 2 from "the ladder is believed to be complete" into a post-condition.
 *  4. The ladder and the normalize pass are both **pure and deterministic** - no clock, no
 *     randomness, and `parse` passes no `now`, so `meta.updatedAt` is left exactly as found - and
 *     the normalize pass is idempotent. So parsing the bytes `serialize` produced yields the same
 *     document again.
 *
 * The failure this replaces is worth naming precisely, because it is the one that must not come
 * back: a document from a NEWER Studio must still be refused, loudly. It is, in two places - the
 * raw-record check in `parse` and `assertSupportedStoryDocument` behind it - and a merge involving
 * one comes back as `blocked: "unreadable"` naming the version, never as a quietly down-levelled
 * document with the newer Studio's fields stripped out.
 *
 * **Two things this spec still is not.** `StoryService` continues to own the editor's own reading
 * and writing, and it writes with `JSON.stringify(document, null, 2)` rather than canonical bytes -
 * so a story settled through the conflict resolver is written canonically here and re-written in
 * insertion order by the next autosave, a one-time whole-file diff. Adopting the format for the
 * service's own writes is the change that closes that, and it is the same change that wants story
 * documents chunked one file per scene. Nothing else in Studio calls `saveDocument` for this path
 * today, so making `serialize` real rewrites nothing on its own.
 */
export const STORY_DOCUMENT_PATH = "editor/story/stories/<storyId>/storydoc.json";

const STORY_DOCUMENT_PATTERN = compileDocumentPathPattern(STORY_DOCUMENT_PATH);

export const storyDocumentSpec = defineDocumentSpec<StoryDocument>({
    kind: "story",
    version: STORY_DOCUMENT_SCHEMA_VERSION,
    paths: [STORY_DOCUMENT_PATH],
    parse: (raw, context) => {
        // The id is taken from the path, not from the document's own `id`, for the reason every spec
        // that captures one does: the file is addressed by path, and a document disagreeing with its
        // own location would be written back to the location its contents claim.
        const storyId = parameterFromPath(STORY_DOCUMENT_PATTERN, "storyId", context);
        const record = requireDocumentObject(raw, context, "a story document");

        // **Step 1 of the invariant, and this half of it is the one that is easy to leave open.**
        // `rejectNewerSchema` compares numbers, so it says nothing at all about a `schemaVersion`
        // that is a string, a boolean or a null - and the ladder reads a non-numeric version as 1
        // and walks the whole thing over it. A file saying `"schemaVersion": "21"` would therefore
        // be migrated *down* to this build's version and stamped, which is precisely the silent
        // down-level the old `serialize` refusal existed to prevent. No Studio has ever written a
        // non-numeric version, so refusing costs nothing real.
        if (record.schemaVersion !== undefined && typeof record.schemaVersion !== "number") {
            return context.corrupt(
                `"schemaVersion" must be a number, got ${describe(record.schemaVersion)}`,
            );
        }
        rejectNewerSchema(record, context, STORY_DOCUMENT_SCHEMA_VERSION);

        requireOptionalMap(record, "scenes", context);
        if (record.chapters !== undefined && !Array.isArray(record.chapters)) {
            return context.corrupt(`"chapters" must be an array, got ${describe(record.chapters)}`);
        }
        requireStructuralScenes(record, context);

        // Both halves of the migration, in the order they have to run: the ladder brings the
        // document to the current version, normalize makes it consistent with itself and removes
        // the keys holding `undefined` that the canonical encoder refuses.
        //
        // **`normalizeStoryDocumentContent` rather than `normalizeStoryDocument`, and no `now`.**
        // The first is the identity question: this document is addressed by its path, so the id is
        // taken from there and the renderer's UUID assertion would only make historical blobs
        // unreadable - see the note on that function. The second is determinism: the renderer's
        // entry point stamps `meta.updatedAt` from the clock when a document has never carried one,
        // and a parse that did that would not be a function of its bytes - the three sides of a
        // merge would be stamped at three different instants, and re-reading a document would
        // produce different bytes from the ones just written. Leaving `meta` alone is what makes
        // step 4 of the invariant true.
        let document: StoryDocument;
        try {
            document = normalizeStoryDocumentContent({...record, id: storyId} as unknown as StoryDocument);
        } catch (error) {
            return context.corrupt(messageOf(error), {cause: error});
        }

        // Step 3, restated where a reader of `parse` will see it. `assertSupportedStoryDocument`
        // has already run inside normalize; this is the same assertion held as a post-condition of
        // this function, so that a future edit which reorders the two calls above cannot let a
        // document out at another version without failing here first.
        if (document.schemaVersion !== STORY_DOCUMENT_SCHEMA_VERSION) {
            return context.corrupt(
                `did not migrate to the current schema (ended at v${String(document.schemaVersion)}, `
                + `this build writes v${STORY_DOCUMENT_SCHEMA_VERSION})`,
            );
        }
        return document;
    },
    /**
     * Canonical bytes, and nothing else.
     *
     * A pure encoder rather than a second normalize pass, which is what
     * {@link import("../types").DocumentSpec.serialize} asks for and what the per-change conflict
     * resolver needs: `applyMergeDecisions` composes a document out of the author's answers, and a
     * serializer that quietly rewrote it would be settling changes the author was never shown.
     *
     * The encoder is the strict half - it throws on a key holding `undefined`, naming its JSON
     * path, where `JSON.stringify` drops it in silence. That strictness is left in place rather
     * than papered over with a strip pass: the only way an `undefined` reaches here is a defect in
     * `parse` or in the merge, and a defect that names its own path is worth more than a document
     * that silently loses a field.
     */
    serialize: document => encodeCanonicalJson(document),
    summarize: document => ({
        title: typeof document.name === "string" ? document.name : "",
        counts: [
            {key: "storyScenes", value: isJsonObject(document.scenes) ? Object.keys(document.scenes).length : 0},
            {key: "storyChapters", value: Array.isArray(document.chapters) ? document.chapters.length : 0},
            {key: "storyBlocks", value: countBlocks(document)},
        ],
    }),
    diff: diffStoryDocument,
    merge3: merge3Story,
});

/**
 * The shape checks that stand between a hand-edited file and a scene being emptied.
 *
 * `normalizeStoryDocument` reads `scene.blocks` as a map and `scene.rootBlockIds` as a list, and -
 * being a normalizer - it is tolerant: an absent `blocks` reads as a scene with no rows. That
 * tolerance is right for a field that has always been optional and wrong for a field that is
 * present and the wrong type, because the two are indistinguishable *afterwards*: `"blocks": []`
 * would normalize to a scene with nothing in it and `serialize` would write that back over every
 * row the author had. Refused here instead, naming the scene, so the merge reports the file as
 * unreadable rather than settling it into an empty one.
 */
function requireStructuralScenes(record: Record<string, unknown>, context: DocumentParseContext): void {
    const scenes = record.scenes;
    if (!isJsonObject(scenes)) {
        return;
    }
    for (const [sceneId, scene] of Object.entries(scenes)) {
        if (!isJsonObject(scene)) {
            context.corrupt(`scene "${sceneId}" must be an object, got ${describe(scene)}`);
        }
        const blocks = (scene as Record<string, unknown>).blocks;
        if (blocks !== undefined && !isJsonObject(blocks)) {
            context.corrupt(`scene "${sceneId}" has "blocks" that is not keyed by id, got ${describe(blocks)}`);
        }
        const rootBlockIds = (scene as Record<string, unknown>).rootBlockIds;
        if (rootBlockIds !== undefined && !Array.isArray(rootBlockIds)) {
            context.corrupt(`scene "${sceneId}" has "rootBlockIds" that is not an array, got ${describe(rootBlockIds)}`);
        }
    }
}

/** Rows across every scene - the number that actually tracks how much story there is. */
function countBlocks(document: StoryDocument): number {
    if (!isJsonObject(document.scenes)) {
        return 0;
    }
    let total = 0;
    for (const scene of Object.values(document.scenes)) {
        const blocks = (scene as {blocks?: unknown} | null)?.blocks;
        if (isJsonObject(blocks)) {
            total += Object.keys(blocks).length;
        }
    }
    return total;
}

function messageOf(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
}

function describe(value: unknown): string {
    if (value === null) {
        return "null";
    }
    return Array.isArray(value) ? "an array" : `a ${typeof value}`;
}
