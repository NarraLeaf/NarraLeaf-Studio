import { describe, expect, it } from "vitest";
import { BLUEPRINT_NODE_TYPE_GAME_START_STORY } from "@shared/types/blueprint/graph";
import type { DevModeBundle } from "@shared/types/devMode";
import type { StoryDocument } from "@shared/types/story";
import { STORY_DOCUMENT_SCHEMA_VERSION, STORY_LIBRARY_INDEX_SCHEMA_VERSION } from "@shared/types/story";
import { resolveDefaultLaunchScene, resolveStagePreloadTarget } from "./resolveDefaultLaunchScene";

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

function makeStartGameBlueprints(targets: Array<{ storyId?: string; sceneId?: string }>) {
    return {
        blueprints: {
            "bp-1": {
                id: "bp-1",
                name: "Main Menu",
                owner: { kind: "globalMain" },
                frontend: "visual",
                programKind: "graph",
                program: {
                    kind: "graph",
                    graphs: {
                        events: {
                            onClick: {
                                id: "onClick",
                                graph: {
                                    nodes: Object.fromEntries(targets.map((params, index) => [
                                        `node-${index}`,
                                        { id: `node-${index}`, type: BLUEPRINT_NODE_TYPE_GAME_START_STORY, params },
                                    ])),
                                },
                            },
                        },
                        functions: {},
                    },
                },
            },
        },
        ownerRecords: {},
    };
}

/** Two stories, `story-1` is the configured default; `story-2` is only reachable via Start Game. */
function makeTwoStoryBundle(localBlueprints?: unknown): DevModeBundle {
    const storyOne = makeDocument({
        id: "story-1",
        entrySceneId: "scene-a",
        scenes: { "scene-a": { id: "scene-a", name: "a" } as StoryDocument["scenes"][string] },
    });
    const storyTwo = makeDocument({
        id: "story-2",
        entrySceneId: "scene-x",
        scenes: {
            "scene-x": { id: "scene-x", name: "x" } as StoryDocument["scenes"][string],
            "scene-y": { id: "scene-y", name: "y" } as StoryDocument["scenes"][string],
        },
    });
    return {
        storyLibrary: {
            index: {
                schemaVersion: STORY_LIBRARY_INDEX_SCHEMA_VERSION,
                stories: [],
                defaultStoryId: "story-1",
            },
            documents: { "story-1": storyOne, "story-2": storyTwo },
            characters: [],
        },
        ...(localBlueprints === undefined ? {} : { ui: { localBlueprints } }),
    } as unknown as DevModeBundle;
}

const DEFAULT_TARGET = { storyId: "story-1", sceneId: "scene-a" };

describe("resolveStagePreloadTarget", () => {
    it("warms what Start Game actually launches, not the default story", () => {
        const bundle = makeTwoStoryBundle(makeStartGameBlueprints([
            { storyId: "story-2", sceneId: "scene-y" },
        ]));
        expect(resolveStagePreloadTarget(bundle)).toEqual({ storyId: "story-2", sceneId: "scene-y" });
    });

    it("treats repeated Start Game nodes with the same target as one target", () => {
        const bundle = makeTwoStoryBundle(makeStartGameBlueprints([
            { storyId: "story-2", sceneId: "scene-x" },
            { storyId: "story-2", sceneId: "scene-x" },
        ]));
        expect(resolveStagePreloadTarget(bundle)).toEqual({ storyId: "story-2", sceneId: "scene-x" });
    });

    it("falls back when the project can start more than one scene", () => {
        const bundle = makeTwoStoryBundle(makeStartGameBlueprints([
            { storyId: "story-2", sceneId: "scene-x" },
            { storyId: "story-2", sceneId: "scene-y" },
        ]));
        expect(resolveStagePreloadTarget(bundle)).toEqual(DEFAULT_TARGET);
    });

    it("falls back when the Start Game node is not configured yet", () => {
        const bundle = makeTwoStoryBundle(makeStartGameBlueprints([{ storyId: "story-2" }]));
        expect(resolveStagePreloadTarget(bundle)).toEqual(DEFAULT_TARGET);
    });

    it("falls back when the target scene is not in this bundle", () => {
        const bundle = makeTwoStoryBundle(makeStartGameBlueprints([
            { storyId: "story-2", sceneId: "deleted-scene" },
        ]));
        expect(resolveStagePreloadTarget(bundle)).toEqual(DEFAULT_TARGET);
    });

    it("falls back when there is no UI at all", () => {
        expect(resolveStagePreloadTarget(makeTwoStoryBundle())).toEqual(DEFAULT_TARGET);
    });

    it("ignores blueprints that are not graphs", () => {
        const bundle = makeTwoStoryBundle({
            blueprints: {
                "bp-ts": {
                    id: "bp-ts",
                    name: "Script",
                    owner: { kind: "globalMain" },
                    frontend: "typescript",
                    programKind: "scriptModule",
                    program: { kind: "scriptModule", source: { language: "typescript", code: "" } },
                },
            },
            ownerRecords: {},
        });
        expect(resolveStagePreloadTarget(bundle)).toEqual(DEFAULT_TARGET);
    });
});
