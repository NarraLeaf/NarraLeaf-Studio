import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { WeatherBakeSpec } from "@shared/weather/model";
import { Services, type WorkspaceContext } from "../services";
import { WeatherPrebakeService } from "./WeatherPrebakeService";

/**
 * When Studio decides to bake weather nobody has asked for yet.
 *
 * The scheduler makes speculation *safe*; this decides when it is *worth it*, and both ways of
 * getting that wrong are silent. Baking too eagerly puts an encoder on the machine while the author
 * is typing, and there is no reading anywhere that would show it. Never baking at all costs nothing
 * except the wait the feature exists to remove, and that looks exactly like the feature working.
 */

type Submission = { projectPath: string; specs: WeatherBakeSpec[] };

const submissions: Submission[] = [];
let storyChanged: (() => void) | null = null;
let libraryChanged: (() => void) | null = null;
let uiChanged: (() => void) | null = null;
let documents: Record<string, unknown> = {};
let loads: string[] = [];
let stageSize = { width: 1920, height: 1080 };

vi.mock("@/lib/app/bridge", () => ({
    getInterface: () => ({
        studioTasks: {
            prebakeWeather: async (projectPath: string, specs: WeatherBakeSpec[]) => {
                submissions.push({ projectPath, specs });
                return { success: true, data: {} };
            },
        },
    }),
}));

const vfxRow = (id: string, seed: string) => ({
    id,
    kind: "nodeAction",
    parentId: null,
    childrenIds: [],
    payload: { action: "vfx", operation: "create", objectName: id, seed: { seed } },
});

const storyWith = (id: string, seeds: readonly string[]) => ({
    id,
    scenes: {
        "scene-1": {
            id: "scene-1",
            rootBlockIds: seeds.map((_, index) => `row-${index}`),
            blocks: Object.fromEntries(seeds.map((seed, index) => [`row-${index}`, vfxRow(`row-${index}`, seed)])),
        },
    },
});

async function mount(): Promise<WeatherPrebakeService> {
    const ctx = {
        project: { getConfig: () => ({ projectPath: "D:/projects/fixture" }) },
        services: {
            get: (id: Services) => {
                switch (id) {
                    case Services.Story:
                        return {
                            onDocumentChanged: (handler: () => void) => {
                                storyChanged = handler;
                                return () => { storyChanged = null; };
                            },
                            onLibraryChanged: (handler: () => void) => {
                                libraryChanged = handler;
                                return () => { libraryChanged = null; };
                            },
                            listStories: () => Object.keys(documents).map(storyId => ({ id: storyId, name: storyId })),
                            loadStory: async (storyId: string) => {
                                loads.push(storyId);
                                const document = documents[storyId];
                                if (!document) {
                                    throw new Error(`Story document not loaded: ${storyId}`);
                                }
                                return document;
                            },
                        };
                    case Services.UIDocument:
                        return {
                            onDocumentChanged: (handler: () => void) => {
                                uiChanged = handler;
                                return () => { uiChanged = null; };
                            },
                            getDocument: () => ({ surfaces: [{ kind: "stageSurface", designSize: stageSize }] }),
                        };
                    default:
                        throw new Error(`Unexpected service lookup: ${String(id)}`);
                }
            },
        },
    } as unknown as WorkspaceContext;

    const service = new WeatherPrebakeService();
    service.setContext(ctx);
    await service.initialize(ctx, async () => undefined);
    return service;
}

describe("WeatherPrebakeService", () => {
    beforeEach(() => {
        vi.useFakeTimers();
        submissions.length = 0;
        loads = [];
        storyChanged = null;
        libraryChanged = null;
        uiChanged = null;
        documents = {};
        stageSize = { width: 1920, height: 1080 };
    });

    afterEach(() => {
        vi.useRealTimers();
    });

    it("waits for the project to stop changing before it submits anything", async () => {
        const service = await mount();
        documents["story-1"] = storyWith("story-1", ["snow"]);

        storyChanged?.();
        await vi.advanceTimersByTimeAsync(3000);
        // Still typing. An encoder started here would be competing with the author for the machine.
        expect(submissions).toHaveLength(0);

        storyChanged?.();
        await vi.advanceTimersByTimeAsync(3000);
        expect(submissions).toHaveLength(0);

        await vi.advanceTimersByTimeAsync(3000);
        expect(submissions).toHaveLength(1);
        expect(submissions[0].projectPath).toBe("D:/projects/fixture");
        expect(submissions[0].specs.map(spec => spec.ref.seed)).toEqual(["snow"]);

        service.dispose();
    });

    it("covers a story the author never opened, which is the whole of opening a project and pressing Run", async () => {
        const service = await mount();
        documents["story-1"] = storyWith("story-1", ["snow"]);
        documents["story-2"] = storyWith("story-2", ["rain"]);

        libraryChanged?.();
        await vi.advanceTimersByTimeAsync(6000);

        expect(loads).toEqual(["story-1", "story-2"]);
        expect(submissions).toHaveLength(1);
        expect(submissions[0].specs.map(spec => spec.ref.seed)).toEqual(["snow", "rain"]);

        service.dispose();
    });

    it("submits nothing at all when an edit did not change which clips are wanted", async () => {
        // Writing prose changes the document constantly and changes the weather never, which is what
        // this whole service has to cost nothing during.
        const service = await mount();
        documents["story-1"] = storyWith("story-1", ["snow"]);
        storyChanged?.();
        await vi.advanceTimersByTimeAsync(6000);
        expect(submissions).toHaveLength(1);

        storyChanged?.();
        await vi.advanceTimersByTimeAsync(6000);
        expect(submissions).toHaveLength(1);

        // A new seed is a new clip, so this one is worth submitting.
        documents["story-1"] = storyWith("story-1", ["snow", "sakura"]);
        storyChanged?.();
        await vi.advanceTimersByTimeAsync(6000);
        expect(submissions).toHaveLength(2);
        expect(submissions[1].specs.map(spec => spec.ref.seed)).toEqual(["snow", "sakura"]);

        service.dispose();
    });

    it("says so when the last weather row goes, because a bake for it may still be running", async () => {
        // The other side reads a submission as the whole of what this project wants, so silence here
        // reads as "the same as last time" - and the clip for a row the author has deleted goes on
        // encoding. An empty ask is the only thing that stops it.
        const service = await mount();
        documents["story-1"] = storyWith("story-1", ["snow"]);
        storyChanged?.();
        await vi.advanceTimersByTimeAsync(6000);
        expect(submissions).toHaveLength(1);

        documents["story-1"] = storyWith("story-1", []);
        storyChanged?.();
        await vi.advanceTimersByTimeAsync(6000);

        expect(submissions).toHaveLength(2);
        expect(submissions[1].specs).toEqual([]);

        service.dispose();
    });

    it("asks again after a stage resize, because the size is half of a clip's identity", async () => {
        const service = await mount();
        documents["story-1"] = storyWith("story-1", ["snow"]);
        storyChanged?.();
        await vi.advanceTimersByTimeAsync(6000);
        expect(submissions[0].specs[0]).toMatchObject({ width: 1920, height: 1080 });

        stageSize = { width: 1280, height: 720 };
        uiChanged?.();
        await vi.advanceTimersByTimeAsync(6000);

        expect(submissions).toHaveLength(2);
        expect(submissions[1].specs[0]).toMatchObject({ width: 1280, height: 720 });

        service.dispose();
    });

    it("treats a story it cannot read as asking for nothing", async () => {
        const service = await mount();
        documents["broken"] = null;
        libraryChanged?.();
        await vi.advanceTimersByTimeAsync(6000);
        expect(submissions).toHaveLength(0);

        service.dispose();
    });
});
