import { describe, expect, it, vi } from "vitest";
import { STORY_LIBRARY_PATH, storyDocumentPath } from "@shared/authority/storyFiles";
import { DocumentCorruptError } from "@shared/documents/types";
import { createEmptyStoryDocument, createEmptyStoryLibraryIndex, createStoryLibraryEntry } from "@shared/story/storyModel";
import { STORY_LIBRARY_INDEX_SCHEMA_VERSION } from "@shared/types/story";
import { Services } from "../services";
import { StoryService } from "./StoryService";

vi.mock("@/lib/app/writeFreeze", () => ({ getProjectWriteFreeze: () => null }));

const NOW = "2026-11-14T00:00:00.000Z";
const STORY_ID = "00000000-0000-4000-8000-000000000001";

function createHarness() {
    const writes = new Map<string, string>();
    const fs = {
        isDirExists: vi.fn(async () => ({ ok: true as const, data: true })),
        createDir: vi.fn(async () => ({ ok: true as const, data: undefined })),
        mkdir: vi.fn(async () => ({ ok: true as const, data: undefined })),
        writeFileNoFollowOrCreate: vi.fn(async (path: string, text: string) => {
            writes.set(path, text);
            return { ok: true as const, data: undefined };
        }),
    };
    const service = new StoryService();
    service.setContext({
        project: { resolve: (...parts: (string | string[])[]) => parts.flat().join("/") },
        services: { get: (id: Services) => {
            if (id === Services.FileSystem) return fs;
            throw new Error(`Unexpected service ${id}`);
        } },
    } as never);
    return { service, writes, fs };
}

describe("adopting a team story library", () => {
    it.each([1, STORY_LIBRARY_INDEX_SCHEMA_VERSION])("treats a missing stories list in schema v%i as empty", async schemaVersion => {
        const { service, writes, fs } = createHarness();
        const stored = { schemaVersion, meta: { updatedAt: NOW }, extension: { retained: true } };

        await service.adoptTeamFiles(new Map([[STORY_LIBRARY_PATH, JSON.stringify(stored)]]));

        expect(service.listStories()).toEqual([]);
        expect(fs.writeFileNoFollowOrCreate).toHaveBeenCalledTimes(1);
        expect(JSON.parse(writes.get(STORY_LIBRARY_PATH)!)).toEqual({ ...stored, stories: [] });
    });

    it("adopts an existing story with its library entry", async () => {
        const { service, writes } = createHarness();
        const path = storyDocumentPath(STORY_ID);
        const entry = createStoryLibraryEntry({ id: STORY_ID, name: "Story", documentPath: path, now: NOW });
        const library = createEmptyStoryLibraryIndex(NOW);
        library.stories.push(entry);
        let next = 100;
        const document = createEmptyStoryDocument({
            id: STORY_ID,
            name: "Story",
            now: NOW,
            generateId: () => `00000000-0000-4000-8000-${(++next).toString(16).padStart(12, "0")}`,
        });

        await service.adoptTeamFiles(new Map([
            [STORY_LIBRARY_PATH, JSON.stringify(library)],
            [path, JSON.stringify(document)],
        ]));

        expect(service.listStories()).toEqual([entry]);
        expect(service.getStoryDocument(STORY_ID).id).toBe(STORY_ID);
        expect(JSON.parse(writes.get(STORY_LIBRARY_PATH)!).stories).toEqual([entry]);
        expect(JSON.parse(writes.get(path)!).id).toBe(STORY_ID);
    });

    it("rejects an invalid stories list without writing it", async () => {
        const { service, fs } = createHarness();
        const text = JSON.stringify({ schemaVersion: STORY_LIBRARY_INDEX_SCHEMA_VERSION, stories: null });

        await expect(service.adoptTeamFiles(new Map([[STORY_LIBRARY_PATH, text]]))).rejects.toBeInstanceOf(DocumentCorruptError);
        expect(fs.writeFileNoFollowOrCreate).not.toHaveBeenCalled();
    });
});
