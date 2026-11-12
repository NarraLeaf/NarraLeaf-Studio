import {
    normalizeStoryCommentsDocument,
    STORY_COMMENTS_SCHEMA_VERSION,
    type StoryCommentsDocument,
} from "../../types/storyComments";
import {defineDocumentSpec} from "../registry";
import {rejectNewerSchema, requireDocumentObject} from "./parseHelpers";

/**
 * `editor/story-comments.json` - review threads on story rows.
 *
 * Owned by `StoryCommentsService`. A document of its own rather than a field of the story document,
 * so that nothing in it can reach a build or a story migration (see `@shared/types/storyComments`).
 *
 * No `diff` and no `merge3`: absent is a normal answer for both. The threads are a map keyed by id,
 * so the generic walk already names the thread that changed, and a merge that is resolved whole costs
 * a comment, never a line of the script.
 */
export const STORY_COMMENTS_DOCUMENT_PATH = "editor/story-comments.json";

export const storyCommentsSpec = defineDocumentSpec<StoryCommentsDocument>({
    kind: "story-comments",
    version: STORY_COMMENTS_SCHEMA_VERSION,
    paths: [STORY_COMMENTS_DOCUMENT_PATH],
    parse: (raw, context) => {
        const record = requireDocumentObject(raw, context, "a story comments document");
        rejectNewerSchema(record, context, STORY_COMMENTS_SCHEMA_VERSION);
        // A present-but-wrong map is corrupt rather than "no threads": the normalizer would read it
        // as empty, and the next comment written would replace every thread the project had.
        if (record.threads !== undefined && (typeof record.threads !== "object" || record.threads === null || Array.isArray(record.threads))) {
            context.corrupt(`"threads" must be an object, got ${Array.isArray(record.threads) ? "array" : typeof record.threads}`);
        }
        return normalizeStoryCommentsDocument(record);
    },
    summarize: document => ({
        title: "",
        counts: [{key: "storyCommentThreads", value: Object.keys(document.threads).length}],
    }),
});
