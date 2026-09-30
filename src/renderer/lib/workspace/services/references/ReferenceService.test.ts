import { beforeEach, describe, expect, it, vi } from "vitest";
import { ReferenceService } from "./ReferenceService";
import { Services, type WorkspaceContext } from "../services";

/**
 * The installed plugins, as the main process would list them. Empty unless a test says otherwise, so
 * every test that is not about plugin data reads a project with none.
 */
const installedPlugins: { value: unknown[] } = { value: [] };
vi.mock("@/lib/app/bridge", () => ({
    getInterface: () => ({
        plugins: { list: async () => ({ success: true, data: { plugins: installedPlugins.value } }) },
    }),
}));
beforeEach(() => {
    installedPlugins.value = [];
});

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
    /** Break the incremental rescan (`onDocumentChanged`), not the initial build. */
    storyRescanFails?: boolean;
    blueprintFails?: boolean;
    blueprintNodes?: Record<string, unknown>;
    /** Node types the catalogue admits to knowing; everything else reads as unknown. */
    knownNodeTypes?: readonly string[];
    charactersFail?: boolean;
    /** Records what the service subscribes to, so a rescan trigger can be fired at it. */
    hooks?: { setsChanged?: () => void; storyLoads?: string[] };
    /** The project's default font stack, which is a reference site like any other. */
    projectFonts?: ReadonlyArray<{ assetId: string }>;
    designFails?: boolean;
    /** The library, by asset id. Only these ids count when plugin data is swept. */
    libraryAssetIds?: readonly string[];
    /** Plugin stores on disk, by store namespace (`plugin__<id>__<namespace>`). */
    pluginStores?: Record<string, unknown>;
    /** Store namespaces that exist on disk and will not parse. */
    unreadablePluginStores?: readonly string[];
    /** Records the store-write listener, so a plugin's own save can be fired at the service. */
    storeWrites?: { listener?: (namespace: string) => void };
};

const noop = () => () => { };

function mount(options: MountOptions = {}): ReferenceService {
    const stories = options.stories ?? [];
    const storyLoads = options.hooks?.storyLoads;
    const ctx = {
        services: {
            get: (id: Services) => {
                switch (id) {
                    case Services.Story:
                        return {
                            loadLibrary: async () => undefined,
                            listStories: () => stories,
                            loadStory: async (storyId: string) => {
                                storyLoads?.push(storyId);
                                if (storyId === options.storyLoadFails) {
                                    throw new Error("story will not parse");
                                }
                                return { id: storyId, scenes: {} };
                            },
                            getStoryDocument: (storyId: string) => {
                                if (options.storyRescanFails) {
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
                                if (!options.blueprintNodes) {
                                    return { ownerRecords: {}, blueprints: {} };
                                }
                                return {
                                    ownerRecords: { globalMain: { blueprintId: "bp-1" } },
                                    blueprints: {
                                        "bp-1": {
                                            id: "bp-1",
                                            name: "Main",
                                            graphs: { events: { "g-1": { graph: { nodes: options.blueprintNodes } } }, functions: {} },
                                        },
                                    },
                                };
                            },
                        };
                    case Services.BlueprintNodeCatalog:
                        return {
                            get: (type: string) => (options.knownNodeTypes?.includes(type) ? { type } : undefined),
                            resolveCatalogEntry: (type: string) => ({ displayName: type, pins: [] }),
                        };
                    case Services.UIDocument:
                        return { getDocument: () => ({ elements: {} }), onDocumentChanged: noop };
                    case Services.UIGraph:
                        return { onGraphsChanged: noop };
                    case Services.AssetSets:
                        return {
                            listSets: () => [],
                            onSetsChanged: (handler: () => void) => {
                                if (options.hooks) {
                                    options.hooks.setsChanged = handler;
                                }
                                return () => { };
                            },
                        };
                    case Services.Assets:
                        return {
                            getAssets: () => ({
                                image: Object.fromEntries((options.libraryAssetIds ?? []).map(id => [id, { id }])),
                            }),
                            getEvents: () => ({ on: () => () => { } }),
                        };
                    case Services.ServiceAssets:
                        return {
                            readStore: async (namespace: string) => {
                                if (options.unreadablePluginStores?.includes(namespace)) {
                                    return { ok: false, error: { code: "PARSE_ERROR", message: "will not parse" } };
                                }
                                const data = options.pluginStores?.[namespace];
                                return data === undefined
                                    ? { ok: false, error: { code: "NOT_FOUND", message: "missing" } }
                                    : { ok: true, data };
                            },
                            onStoreWritten: (listener: (namespace: string) => void) => {
                                if (options.storeWrites) {
                                    options.storeWrites.listener = listener;
                                }
                                return () => { };
                            },
                        };
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
                    case Services.Brand:
                        return {
                            listFonts: () => {
                                if (options.designFails) {
                                    throw new Error("the design document is unreadable");
                                }
                                return options.projectFonts ?? [];
                            },
                            onFontsChanged: noop,
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

describe("ReferenceService and what an asset set resolves to", () => {
    it("re-reads the stories when the set declarations change", async () => {
        // The defect this pins: a story slice records a row naming a set as a use of the files that
        // set resolves to. Dissolve the set and the index still claims the row uses those files, so
        // the project check reports nothing over a row that now names an id the project does not
        // have - and it only surfaces after a reload.
        const hooks: { setsChanged?: () => void; storyLoads: string[] } = { storyLoads: [] };
        const service = mount({ stories: [{ id: "s1", name: "Main Story" }], hooks });

        await service.ensureReady();
        expect(hooks.storyLoads).toEqual(["s1"]);

        hooks.setsChanged?.();
        await service.flushPendingRebuilds();

        expect(hooks.storyLoads).toEqual(["s1", "s1"]);
    });
});

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

describe("the incremental story rescan", () => {
    /** The path `onDocumentChanged` runs, which is the one that runs on every scene edit. */
    const rescan = (service: ReferenceService, storyId: string) =>
        (service as unknown as { rebuildStorySlice(id: string): void }).rebuildStorySlice(storyId);

    it("keeps the gap when a story that is still in the library will not read", async () => {
        // The build path reports this correctly; the rescan path used to clear the gap it should
        // raise, so a project that opened clean went back to reporting full coverage the moment an
        // edit made a document unreadable - with that story's references already dropped.
        const service = mount({ stories: [{ id: "s1", name: "Main Story" }], storyRescanFails: true });
        await service.ensureReady();
        expect(service.getIndexResult().complete).toBe(true);

        rescan(service, "s1");

        expect(service.getIndexResult()).toEqual({
            complete: false,
            gaps: [{ reason: "documentUnreadable", slice: "story", location: "Main Story" }],
        });
    });

    it("reports nothing for a story that has been deleted", async () => {
        // The other failure that arrives at the same catch. A story that is gone contributes no
        // references and no doubt, and a gap here would never clear.
        const service = mount({ stories: [], storyRescanFails: true });
        await service.ensureReady();

        rescan(service, "deleted-story");

        expect(service.getIndexResult()).toEqual({ complete: true, gaps: [] });
    });
});

describe("nodes the catalogue does not know", () => {
    it("reports a gap rather than reading silence as coverage", async () => {
        // `resolveCatalogEntry` answers for an unknown type with a two-exec-pin stub, so it can
        // never throw and never says "unknown". Asking it alone reported an uninstalled plugin's
        // nodes as holding no assets at all.
        const service = mount({
            blueprintNodes: { n1: { id: "n1", type: "acme.showBanner", params: { banner: "img-1" } } },
            knownNodeTypes: [],
        });

        await service.ensureReady();
        const result = service.getIndexResult();

        expect(result.complete).toBe(false);
        expect(result.gaps).toEqual([
            expect.objectContaining({ reason: "unknownNodeType", slice: "blueprint" }),
        ]);
    });

    it("says nothing about a node type the catalogue has", async () => {
        const service = mount({
            blueprintNodes: { n1: { id: "n1", type: "blueprint.flow.branch", params: {} } },
            knownNodeTypes: ["blueprint.flow.branch"],
        });

        await service.ensureReady();

        expect(service.getIndexResult()).toEqual({ complete: true, gaps: [] });
    });
});

/**
 * The project's default fonts are the one asset use that lives outside every document the other
 * five slices walk, so nothing else in this index can catch them going missing.
 */
describe("the project design slice", () => {
    it("reports the default font stack as a reference", async () => {
        const service = mount({ projectFonts: [{ assetId: "font-a" }, { assetId: "font-b" }] });
        await service.ensureReady();

        expect(service.isReferenced("font-a")).toBe(true);
        // The rung's place in the stack is what an author would recognise the row by.
        expect(service.getReferences("font-b")).toEqual([
            { id: "design:font:font-b", assetId: "font-b", kind: "design", label: "Default fonts", field: "fonts[2]" },
        ]);
    });

    // The built-in stacks are CSS literals with no file behind them, and `isLibraryAssetId` is what
    // keeps them out of an index whose whole purpose is answering "may I delete this file".
    it("ignores the built-in system stacks", async () => {
        const service = mount({ projectFonts: [{ assetId: "builtin:font:serif" }] });
        await service.ensureReady();

        expect(service.getReferencedAssetIds().size).toBe(0);
        expect(service.getIndexResult().complete).toBe(true);
    });

    it("reports a gap - narrowed to fonts - when the design document will not read", async () => {
        const service = mount({ designFails: true });
        await service.ensureReady();

        expect(service.getIndexResult().gaps).toEqual([
            { reason: "sliceFailed", slice: "design", location: "Default fonts", affects: ["font"] },
        ]);
    });
});

/**
 * A plugin's published data ships inside the game, and the build carries every library asset it
 * names. The index has to say the same, or a picture only the Gallery shows reads as unused.
 */
describe("the plugin data slice", () => {
    const GALLERY_STORE = "plugin__narraleaf.gallery__narraleaf.gallery.items";
    const WASHROOM = "b1a0c227-b4db-4156-875d-d2809aaa4c48";
    const ENTRY_ID = "0f3c2a44-1111-4222-8333-944455556666";
    const gallery = (enabled = true) => ({
        pluginId: "narraleaf.gallery",
        enabled,
        manifest: {
            id: "narraleaf.gallery",
            name: "Gallery",
            entries: { runtime: "runtime.js" },
            contributes: { runtimeData: ["narraleaf.gallery.items"] },
        },
    });
    const catalog = { entries: [{ id: ENTRY_ID, variants: [{ imageAssetId: WASHROOM }] }] };

    it("reports an asset the published data names, under the plugin's own name", async () => {
        installedPlugins.value = [gallery()];
        const service = mount({ libraryAssetIds: [WASHROOM], pluginStores: { [GALLERY_STORE]: catalog } });
        await service.ensureReady();

        expect(service.getReferences(WASHROOM)).toEqual([
            expect.objectContaining({ assetId: WASHROOM, kind: "plugin", label: "Gallery" }),
        ]);
        expect(service.getIndexResult()).toEqual({ complete: true, gaps: [] });
    });

    it("does not read an entry's own id as an asset", async () => {
        // The catalogue keys its entries by id-shaped strings. Reading one as an asset would give
        // `assets/missing` a dangling reference for every entry in the Gallery.
        installedPlugins.value = [gallery()];
        const service = mount({ libraryAssetIds: [WASHROOM], pluginStores: { [GALLERY_STORE]: catalog } });
        await service.ensureReady();

        expect(service.getReferencedAssetIds()).toEqual(new Set([WASHROOM]));
    });

    it("reads nothing from a plugin that is switched off, which the build does not package", async () => {
        installedPlugins.value = [gallery(false)];
        const service = mount({ libraryAssetIds: [WASHROOM], pluginStores: { [GALLERY_STORE]: catalog } });
        await service.ensureReady();

        expect(service.isReferenced(WASHROOM)).toBe(false);
    });

    it("reports a store that exists and will not read, by the plugin's name", async () => {
        installedPlugins.value = [gallery()];
        const service = mount({ libraryAssetIds: [WASHROOM], unreadablePluginStores: [GALLERY_STORE] });
        await service.ensureReady();

        expect(service.getIndexResult().gaps).toEqual([
            { reason: "documentUnreadable", slice: "plugin", location: "Gallery" },
        ]);
    });

    it("re-reads when the plugin writes its store", async () => {
        installedPlugins.value = [gallery()];
        const stores: Record<string, unknown> = {};
        const storeWrites: { listener?: (namespace: string) => void } = {};
        const service = mount({ libraryAssetIds: [WASHROOM], pluginStores: stores, storeWrites });
        await service.ensureReady();
        expect(service.isReferenced(WASHROOM)).toBe(false);

        stores[GALLERY_STORE] = catalog;
        storeWrites.listener?.(GALLERY_STORE);
        await service.flushPendingRebuilds();

        expect(service.isReferenced(WASHROOM)).toBe(true);
    });
});
