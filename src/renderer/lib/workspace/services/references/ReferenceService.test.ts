import { describe, expect, it } from "vitest";
import { ReferenceService } from "./ReferenceService";
import { Services, type WorkspaceContext } from "../services";

/**
 * `ReferenceService.getIndexResult()` — the answer everything that deletes on this index's word has
 * to consult first.
 *
 * The failure this is about is silent by construction: a slice that throws is caught, logged to the
 * console nobody is reading, and contributes an empty list that is indistinguishable from a project
 * where nothing uses anything. These cases drive the real `buildAll` with one dependency broken at
 * a time, because the point is that the *service* notices, not that the model can hold a gap.
 */

type MountOptions = {
    stories?: Array<{ id: string; name: string }>;
    storyLoadFails?: string;
    blueprintFails?: boolean;
    charactersFail?: boolean;
};

const noop = () => () => { };

function mount(options: MountOptions = {}): ReferenceService {
    const stories = options.stories ?? [];
    const ctx = {
        services: {
            get: (id: Services) => {
                switch (id) {
                    case Services.Story:
                        return {
                            loadLibrary: async () => undefined,
                            listStories: () => stories,
                            loadStory: async (storyId: string) => {
                                if (storyId === options.storyLoadFails) {
                                    throw new Error("story will not parse");
                                }
                                return { id: storyId, scenes: {} };
                            },
                            listAnimationAssets: () => [],
                            loadAnimationAsset: async () => ({ id: "a", name: "a", sequences: [] }),
                            onDocumentChanged: noop,
                            onLibraryChanged: noop,
                            onAnimationsChanged: noop,
                        };
                    case Services.Voice:
                        return {
                            getConfiguration: () => ({ voicedLocales: [] }),
                            loadDocument: async () => ({ locale: "en", units: {} }),
                            onDocumentChanged: noop,
                        };
                    case Services.LocalBlueprint:
                        return {
                            getBlueprintDocument: () => {
                                if (options.blueprintFails) {
                                    throw new Error("blueprint document will not load");
                                }
                                return { ownerRecords: {}, blueprints: {} };
                            },
                        };
                    case Services.BlueprintNodeCatalog:
                        return { resolveCatalogEntry: () => ({ displayName: "Node", pins: [] }) };
                    case Services.UIDocument:
                        return { getDocument: () => ({ elements: {} }), onDocumentChanged: noop };
                    case Services.UIGraph:
                        return { onGraphsChanged: noop };
                    case Services.Character:
                        return {
                            listCharacter: () => {
                                if (options.charactersFail) {
                                    throw new Error("character store is unreadable");
                                }
                                return [];
                            },
                            subscribe: noop,
                        };
                    default:
                        throw new Error(`Unexpected service lookup: ${String(id)}`);
                }
            },
        },
    } as unknown as WorkspaceContext;

    const service = new ReferenceService();
    service.setContext(ctx);
    return service;
}

describe("ReferenceService.getIndexResult", () => {
    it("reports an index that has never been built as incomplete, not as empty", async () => {
        // Every asset in the project is unreferenced to an index that has read nothing, so this is
        // the state in which "delete the unused ones" would delete the project.
        const service = mount();

        expect(service.getIndexResult()).toEqual({ complete: false, gaps: [{ reason: "indexNotBuilt" }] });
    });

    it("is complete once every slice has been read", async () => {
        const service = mount({ stories: [{ id: "s1", name: "Main Story" }] });

        await service.ensureReady();

        expect(service.getIndexResult()).toEqual({ complete: true, gaps: [] });
    });

    it("names the slice that threw", async () => {
        const service = mount({ blueprintFails: true });

        await service.ensureReady();
        const result = service.getIndexResult();

        expect(result.complete).toBe(false);
        expect(result.gaps).toEqual([{ reason: "sliceFailed", slice: "blueprint", location: "Blueprints" }]);
    });

    it("names the document that would not load, by the name the author gave it", async () => {
        const service = mount({ stories: [{ id: "s1", name: "Main Story" }], storyLoadFails: "s1" });

        await service.ensureReady();
        const result = service.getIndexResult();

        expect(result.complete).toBe(false);
        expect(result.gaps).toEqual([{ reason: "documentUnreadable", slice: "story", location: "Main Story" }]);
    });

    it("collects a gap from each slice that failed", async () => {
        const service = mount({ blueprintFails: true, charactersFail: true });

        await service.ensureReady();

        expect(service.getIndexResult().gaps.map(gap => gap.slice).sort()).toEqual(["blueprint", "character"]);
    });

    it("drops a gap once the slice reads cleanly again", async () => {
        // A gap that outlived its cause would leave the index permanently incomplete, and the
        // delete guard permanently refusing.
        const service = mount({ stories: [{ id: "s1", name: "Main Story" }], storyLoadFails: "s1" });
        await service.ensureReady();
        expect(service.getIndexResult().complete).toBe(false);

        const healed = mount({ stories: [{ id: "s1", name: "Main Story" }] });
        await healed.ensureReady();

        expect(healed.getIndexResult().complete).toBe(true);
    });
});
