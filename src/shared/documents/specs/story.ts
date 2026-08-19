import {STORY_DOCUMENT_SCHEMA_VERSION, StoryDocument} from "@shared/types/story/document";
import {compileDocumentPathPattern} from "../documentPath";
import {defineDocumentSpec} from "../registry";
import {isJsonObject, parameterFromPath, rejectNewerSchema, requireDocumentObject, requireOptionalMap} from "./parseHelpers";
import {diffStoryDocument} from "./storyDiff";
import {merge3Story} from "./storyMerge3";

/**
 * `editor/story/stories/<storyId>/storydoc.json` - one story: its chapters, its scenes, its rows.
 *
 * **This spec is read-side only, and deliberately so.** It exists to give version control a semantic
 * diff of the biggest documents in a project; it does not adopt the format
 * the way the wave-1 specs adopted theirs, and `StoryService` still owns reading and writing.
 *
 * Two things follow, and both are stated in code rather than left to be discovered:
 *
 *  - **`parse` does not migrate**, and that is now a choice rather than a constraint.
 *    `migrateStoryDocumentToLatest` is reachable from here (`@shared/story/migrateStoryDocument`);
 *    `normalizeStoryDocument` is not, and it is the half that would have to run before a document
 *    could be written back, because it is where the renderer's `undefined` assignments meet the
 *    canonical encoder that rejects them. So an older document is returned as it
 *    was read. That is a real departure from {@link import("../types").DocumentSpec.parse}'s
 *    contract, and the whole reason `serialize` below refuses: a document that was not migrated must
 *    never be written back, because writing it is what would turn "read as v11" into "saved as v12
 *    without the migration having run".
 *  - **A cross-version comparison is honest but coarser.** Two documents at different schema
 *    versions still line up scene by scene and block by block - every migration since v4 has left
 *    the id-keyed skeleton alone and rewritten payloads - so the affected rows read as "this row
 *    changed", which is true, rather than as nothing.
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
        rejectNewerSchema(record, context, STORY_DOCUMENT_SCHEMA_VERSION);
        requireOptionalMap(record, "scenes", context);
        if (record.chapters !== undefined && !Array.isArray(record.chapters)) {
            return context.corrupt(`"chapters" must be an array, got ${describe(record.chapters)}`);
        }

        // Returned as read, with only the id pinned to the path. See the note on this module: no
        // migration runs here, and `serialize` refuses for that exact reason.
        return {...record, id: storyId} as unknown as StoryDocument;
    },
    /**
     * Refused, loudly, rather than silently reformatting a document this spec did not migrate.
     *
     * The alternative is worse than it looks: a canonical encoder would happily write the document
     * back with sorted keys and a schema version this parse never migrated it to, and the first
     * caller to reach for `loadDocument`/`saveDocument` here would rewrite every story in the
     * project on open. Throwing is what makes adopting this format a deliberate act - it fails at
     * the first call rather than in the author's repository.
     */
    serialize: () => {
        throw new Error(
            "The story spec is read-only in this build: `parse` does not run the story migration "
            + "(it lives in the renderer's storyModel.ts), so serializing would write back a document "
            + "that was never migrated. Use StoryService to save a story.",
        );
    },
    summarize: document => ({
        title: typeof document.name === "string" ? document.name : "",
        counts: [
            {key: "storyScenes", value: isJsonObject(document.scenes) ? Object.keys(document.scenes).length : 0},
            {key: "storyChapters", value: Array.isArray(document.chapters) ? document.chapters.length : 0},
            {key: "storyBlocks", value: countBlocks(document)},
        ],
    }),
    diff: diffStoryDocument,
    /**
     * Declared even though {@link serialize} above refuses, and the pairing is not an oversight.
     *
     * `merge3` is a pure function over two parsed documents: it is correct, it is testable, and the
     * decision list it produces is what a resolve surface draws. What it cannot do yet is finish -
     * the write-back step calls `serialize`, which throws here until the
     * story format is adopted for writing. So the second tier can COMPARE and DECIDE a story today
     * and cannot COMMIT one; whoever lifts that has to run the story migration in shared code first,
     * which is what the note on this module is about.
     */
    merge3: merge3Story,
});

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

function describe(value: unknown): string {
    if (value === null) {
        return "null";
    }
    return Array.isArray(value) ? "an array" : `a ${typeof value}`;
}
