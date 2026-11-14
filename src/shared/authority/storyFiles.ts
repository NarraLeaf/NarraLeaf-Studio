import type { LiveStoryOp } from "@shared/live/ops";
import { storyDocumentSpec } from "@shared/documents/specs/story";
import { STORY_INDEX_DOCUMENT_PATH, storyIndexSpec } from "@shared/documents/specs/storyIndex";
import { DocumentCorruptError, type DocumentKind, type DocumentParseContext } from "@shared/documents/types";
import type { StoryDocument, StoryLibraryIndex } from "@shared/types/story";
import { storyDocumentRelativePath } from "@shared/story/storyModel";

/**
 * A team project's story files, read and written the way the editor reads and writes them.
 *
 * What the Team server needs to start from a project's repository and to put a snapshot back into
 * it: where the files are, how to turn their text into documents the appliers accept, and how to
 * turn documents back into text **byte for byte what the editor writes**, so a snapshot the server
 * commits produces the same diff an author's save would have, and no whole-file churn.
 *
 * Parsing goes through the document specs, which run the schema migration and refuse a document
 * from a newer Studio by name - a server on an older kernel must not down-level it.
 */

/** Where the story library is, project-relative. */
export const STORY_LIBRARY_PATH = STORY_INDEX_DOCUMENT_PATH;

/** Where one story document is, project-relative. */
export function storyDocumentPath(storyId: string): string {
    return storyDocumentRelativePath(storyId);
}

/** Read the story library from the text of `editor/story/index.json`. Throws `DocumentCorruptError`. */
export function parseStoryLibrary(text: string): StoryLibraryIndex {
    return storyIndexSpec.parse(jsonOf(text, "story-index", STORY_LIBRARY_PATH), contextFor("story-index", STORY_LIBRARY_PATH, text));
}

/**
 * Read one story document from its file's text, migrated to this kernel's schema.
 * Throws `DocumentCorruptError`, with `defect: "newerVersion"` for one a newer Studio wrote.
 */
export function parseStoryDocument(storyId: string, text: string): StoryDocument {
    const path = storyDocumentPath(storyId);
    return storyDocumentSpec.parse(jsonOf(text, "story", path), contextFor("story", path, text));
}

/** A story document or the library as the editor writes it: `JSON.stringify(value, null, 2)`. */
export function serializeStoryFile(value: StoryDocument | StoryLibraryIndex): string {
    return JSON.stringify(value, null, 2);
}

/**
 * The library half of a story operation, in place. True when the library changed.
 *
 * Only `rename-story` reaches the library: the entry carries the story's name so the list can be
 * drawn without loading every document. Every other verb answers false.
 */
export function applyStoryOpToLibrary(
    library: StoryLibraryIndex,
    storyId: string,
    op: LiveStoryOp,
    context: { now: string },
): boolean {
    if (op.op !== "rename-story") {
        return false;
    }
    const entry = library.stories.find(story => story.id === storyId);
    if (!entry) {
        return false;
    }
    entry.name = op.name;
    entry.updatedAt = context.now;
    library.meta = { ...library.meta, updatedAt: context.now } as StoryLibraryIndex["meta"];
    return true;
}

function contextFor(kind: DocumentKind, path: string, text: string): DocumentParseContext {
    return {
        path,
        corrupt(reason, options) {
            throw new DocumentCorruptError({ kind, path, reason, text, ...options });
        },
    };
}

function jsonOf(text: string, kind: DocumentKind, path: string): unknown {
    try {
        return JSON.parse(text);
    } catch (error) {
        throw new DocumentCorruptError({
            kind,
            path,
            reason: `not JSON: ${error instanceof Error ? error.message : String(error)}`,
            text,
            cause: error,
        });
    }
}
