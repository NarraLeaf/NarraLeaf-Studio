import { describe, expect, it } from "vitest";
import type { DevModeBundle } from "@shared/types/devMode";
import type { StoryDocument } from "@shared/types/story";
import { STORY_DOCUMENT_SCHEMA_VERSION, STORY_LIBRARY_INDEX_SCHEMA_VERSION } from "@shared/types/story";
import { resolveDefaultLaunchScene } from "./resolveDefaultLaunchScene";

function makeDocument(overrides: Partial<StoryDocument> & { id: string }): StoryDocument {
    return {
        schemaVersion: STORY_DOCUMENT_SCHEMA_VERSION,
        name: overrides.id,
        chapters: [],
        scenes: {},
        ...overrides,
    } as StoryDocument;
}

function makeBundle(storyLibrary: unknown): DevModeBundle {
    return { storyLibrary } as unknown as DevModeBundle;
}

describe("resolveDefaultLaunchScene", () => {
    it("returns null when there is no story library", () => {
        expect(resolveDefaultLaunchScene(makeBundle(undefined))).toBeNull();
    });

    it("returns null when no default story is configured", () => {
        const bundle = makeBundle({
            index: { schemaVersion: STORY_LIBRARY_INDEX_SCHEMA_VERSION, stories: [] },
            documents: {},
            characters: [],
        });
        expect(resolveDefaultLaunchScene(bundle)).toBeNull();
    });

    it("uses the default story's entry scene when valid", () => {
        const document = makeDocument({
            id: "story-1",
            entrySceneId: "scene-b",
            chapters: [{ id: "chapter-1", name: "c", sceneIds: ["scene-a", "scene-b"] }],
            scenes: {
                "scene-a": { id: "scene-a", name: "a" } as StoryDocument["scenes"][string],
                "scene-b": { id: "scene-b", name: "b" } as StoryDocument["scenes"][string],
            },
        });
        const bundle = makeBundle({
            index: {
                schemaVersion: STORY_LIBRARY_INDEX_SCHEMA_VERSION,
                stories: [],
                defaultStoryId: "story-1",
            },
            documents: { "story-1": document },
            characters: [],
        });
        expect(resolveDefaultLaunchScene(bundle)).toEqual({ storyId: "story-1", sceneId: "scene-b" });
    });

    it("falls back to the first chapter scene when entry scene is missing/invalid", () => {
        const document = makeDocument({
            id: "story-1",
            entrySceneId: "does-not-exist",
            chapters: [{ id: "chapter-1", name: "c", sceneIds: ["scene-a"] }],
            scenes: {
                "scene-a": { id: "scene-a", name: "a" } as StoryDocument["scenes"][string],
            },
        });
        const bundle = makeBundle({
            index: {
                schemaVersion: STORY_LIBRARY_INDEX_SCHEMA_VERSION,
                stories: [],
                defaultStoryId: "story-1",
            },
            documents: { "story-1": document },
            characters: [],
        });
        expect(resolveDefaultLaunchScene(bundle)).toEqual({ storyId: "story-1", sceneId: "scene-a" });
    });

    it("returns null when the default story has no scenes", () => {
        const document = makeDocument({ id: "story-1" });
        const bundle = makeBundle({
            index: {
                schemaVersion: STORY_LIBRARY_INDEX_SCHEMA_VERSION,
                stories: [],
                defaultStoryId: "story-1",
            },
            documents: { "story-1": document },
            characters: [],
        });
        expect(resolveDefaultLaunchScene(bundle)).toBeNull();
    });
});
