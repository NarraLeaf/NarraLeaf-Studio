import { describe, expect, it } from "vitest";
import { DocumentCorruptError } from "@shared/documents/types";
import { STORY_DOCUMENT_SCHEMA_VERSION } from "@shared/types/story";
import { createEmptyStoryDocument, createEmptyStoryLibraryIndex, createStoryLibraryEntry } from "@shared/story/storyModel";
import {
    applyStoryOpToLibrary,
    parseStoryDocument,
    parseStoryLibrary,
    serializeStoryFile,
    storyDocumentPath,
} from "./storyFiles";

const NOW = "2026-11-14T00:00:00.000Z";
const STORY_ID = "00000000-0000-4000-8000-000000000001";

function document() {
    let next = 100;
    return createEmptyStoryDocument({
        id: STORY_ID,
        name: "Story",
        now: NOW,
        generateId: () => `00000000-0000-4000-8000-${(++next).toString(16).padStart(12, "0")}`,
    });
}

describe("a team project's story files", () => {
    it("reads back exactly what it writes, in the editor's format", () => {
        const written = serializeStoryFile(document());
        expect(written).toBe(JSON.stringify(document(), null, 2));
        const read = parseStoryDocument(STORY_ID, written);
        expect(serializeStoryFile(read)).toBe(written);
    });

    it("refuses a document a newer Studio wrote, by name", () => {
        const newer = { ...document(), schemaVersion: STORY_DOCUMENT_SCHEMA_VERSION + 1 };
        let caught: unknown;
        try {
            parseStoryDocument(STORY_ID, JSON.stringify(newer));
        } catch (error) {
            caught = error;
        }
        expect(caught).toBeInstanceOf(DocumentCorruptError);
    });

    it("refuses text that is not JSON as a corrupt document", () => {
        expect(() => parseStoryDocument(STORY_ID, "{nope")).toThrow(DocumentCorruptError);
    });

    it("renames a story's library entry and nothing else", () => {
        const library = createEmptyStoryLibraryIndex(NOW);
        library.stories.push(createStoryLibraryEntry({ id: STORY_ID, name: "Story", documentPath: storyDocumentPath(STORY_ID), now: NOW }));
        const parsed = parseStoryLibrary(serializeStoryFile(library));

        expect(applyStoryOpToLibrary(parsed, STORY_ID, { op: "rename-story", name: "Renamed" }, { now: "later" })).toBe(true);
        expect(parsed.stories[0].name).toBe("Renamed");
        expect(parsed.stories[0].updatedAt).toBe("later");
        expect(applyStoryOpToLibrary(parsed, STORY_ID, { op: "delete-scene", sceneId: "s" }, { now: "later" })).toBe(false);
    });

    it("puts a story document where the editor does", () => {
        expect(storyDocumentPath(STORY_ID)).toBe(`editor/story/stories/${STORY_ID}/storydoc.json`);
    });
});
