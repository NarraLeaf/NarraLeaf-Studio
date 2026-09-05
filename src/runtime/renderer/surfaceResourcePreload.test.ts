import { afterEach, describe, expect, it, vi } from "vitest";
import { GAME_RUNTIME_PACK_SCHEMA_VERSION, type GameRuntimePackV1 } from "@shared/types/gameRuntime";
import { UI_DOCUMENT_SCHEMA_VERSION, type UIDocument } from "@shared/types/ui-editor/document";
import { UI_FRAME_ELEMENT_TYPE } from "@shared/types/ui-editor/frame";
import {
    collectRuntimePackAssetIds,
    collectRuntimeSurfaceAssetIds,
    preloadRuntimePackAssets,
} from "./surfaceResourcePreload";
import {
    registeredRuntimeFontCssFamily,
    resetRuntimeFontFacesForTest,
    runtimeFontCssFamily,
} from "./runtimeFontFaces";

function makePack(): GameRuntimePackV1 {
    const document: UIDocument = {
        schemaVersion: UI_DOCUMENT_SCHEMA_VERSION,
        id: "doc",
        name: "Doc",
        surfaces: [
            {
                id: "home",
                name: "Home",
                host: "app",
                kind: "appSurface",
                designSize: { width: 1280, height: 720 },
                rootElementId: "home-root",
            },
            {
                id: "nested",
                name: "Nested",
                host: "app",
                kind: "appSurface",
                designSize: { width: 400, height: 240 },
                rootElementId: "nested-root",
            },
            {
                id: "credits",
                name: "Credits",
                host: "app",
                kind: "appSurface",
                designSize: { width: 1280, height: 720 },
                rootElementId: "credits-root",
            },
        ],
        components: [
            {
                id: "menu-card",
                name: "Menu Card",
                rootElementId: "menu-card-root",
                elements: {
                    "menu-card-root": {
                        id: "menu-card-root",
                        type: "nl.container",
                        parentId: null,
                        childrenIds: ["menu-card-label"],
                        layout: { x: 0, y: 0, width: 200, height: 100 },
                    },
                    "menu-card-label": {
                        id: "menu-card-label",
                        type: "nl.text",
                        parentId: "menu-card-root",
                        childrenIds: [],
                        layout: { x: 0, y: 0, width: 200, height: 40 },
                        props: { fontAssetId: "component-font" },
                    },
                },
            },
        ],
        elements: {
            "home-root": {
                id: "home-root",
                type: "nl.root",
                parentId: null,
                childrenIds: ["home-bg", "home-frame"],
                layout: { x: 0, y: 0, width: 1280, height: 720 },
            },
            "home-bg": {
                id: "home-bg",
                type: "nl.image",
                parentId: "home-root",
                childrenIds: [],
                layout: { x: 0, y: 0, width: 1280, height: 720 },
                props: { assetId: "first-bg" },
            },
            "home-frame": {
                id: "home-frame",
                type: UI_FRAME_ELEMENT_TYPE,
                parentId: "home-root",
                childrenIds: [],
                layout: { x: 100, y: 100, width: 400, height: 240 },
                props: { targetSurfaceId: "nested", params: {}, navigationMode: "static" },
            },
            "nested-root": {
                id: "nested-root",
                type: "nl.root",
                parentId: null,
                childrenIds: ["nested-image", "nested-component"],
                layout: { x: 0, y: 0, width: 400, height: 240 },
            },
            "nested-image": {
                id: "nested-image",
                type: "nl.image",
                parentId: "nested-root",
                childrenIds: [],
                layout: { x: 0, y: 0, width: 400, height: 240 },
                props: { assetId: "nested-img" },
            },
            "nested-component": {
                id: "nested-component",
                type: "nl.container",
                parentId: "nested-root",
                childrenIds: [],
                layout: { x: 0, y: 0, width: 200, height: 100 },
                extra: { componentLink: { componentId: "menu-card", linked: true } },
            },
            "credits-root": {
                id: "credits-root",
                type: "nl.root",
                parentId: null,
                childrenIds: ["credits-bg"],
                layout: { x: 0, y: 0, width: 1280, height: 720 },
            },
            "credits-bg": {
                id: "credits-bg",
                type: "nl.image",
                parentId: "credits-root",
                childrenIds: [],
                layout: { x: 0, y: 0, width: 1280, height: 720 },
                props: { assetId: "credits-bg", ignoredNested: { assetId: "missing-manifest" } },
            },
        },
    };

    return {
        schemaVersion: GAME_RUNTIME_PACK_SCHEMA_VERSION,
        generatedAt: "2026-01-01T00:00:00.000Z",
        mode: "preview",
        runtimeVersion: "test",
        project: { name: "Test Game" },
        entry: { kind: "surface", surfaceId: "home" },
        bundle: {
            bundleId: "bundle",
            revision: 1,
            timestamp: "2026-01-01T00:00:00.000Z",
            ui: {
                uidoc: document,
                uigraphs: { blueprintDocument: { graphs: {}, nodes: {}, edges: {} } },
                localBlueprints: { graphs: {}, nodes: {}, edges: {} },
            },
        } as unknown as GameRuntimePackV1["bundle"],
        assets: {
            items: {
                "first-bg": {
                    id: "first-bg",
                    type: "image",
                    name: "first",
                    source: "local",
                    relativePath: "assets/first-bg.png",
                    ext: ".png",
                },
                "nested-img": {
                    id: "nested-img",
                    type: "image",
                    name: "nested",
                    source: "local",
                    relativePath: "assets/nested-img.png",
                    ext: ".png",
                },
                "component-font": {
                    id: "component-font",
                    type: "font",
                    name: "font",
                    source: "local",
                    relativePath: "assets/component-font.woff2",
                    ext: ".woff2",
                },
                "credits-bg": {
                    id: "credits-bg",
                    type: "image",
                    name: "credits",
                    source: "local",
                    relativePath: "assets/credits-bg.png",
                    ext: ".png",
                },
            },
        },
        plugins: [],
    };
}

afterEach(() => {
    vi.unstubAllGlobals();
});

describe("runtime surface asset preload", () => {
    it("collects first-surface assets through frames and linked component children", () => {
        const pack = makePack();
        const home = pack.bundle.ui.uidoc.surfaces.find(surface => surface.id === "home")!;

        expect(collectRuntimeSurfaceAssetIds(pack, home)).toEqual([
            "first-bg",
            "nested-img",
            "component-font",
        ]);
    });

    it("collects both a video widget's clip and its poster", () => {
        // The walk matches literal property names, not a suffix, so `posterAssetId` had to be added
        // explicitly. Without it the poster loads mid-scene instead of arriving with the Surface -
        // the still meant to cover the first frame pops in after the author already saw an empty box.
        const pack = makePack();
        const document = pack.bundle.ui.uidoc;
        document.elements["credits-root"]!.childrenIds.push("credits-clip");
        document.elements["credits-clip"] = {
            id: "credits-clip",
            type: "nl.video",
            parentId: "credits-root",
            childrenIds: [],
            layout: { x: 0, y: 0, width: 480, height: 270, opacity: 1, visible: true },
            props: { assetId: "outro-clip", posterAssetId: "outro-poster" },
        } as unknown as (typeof document.elements)[string];
        pack.assets.items["outro-clip"] = {
            id: "outro-clip",
            type: "video",
            name: "outro",
            source: "local",
            relativePath: "assets/outro.mp4",
            ext: ".mp4",
        } as (typeof pack.assets.items)[string];
        pack.assets.items["outro-poster"] = {
            id: "outro-poster",
            type: "image",
            name: "outro poster",
            source: "local",
            relativePath: "assets/outro.png",
            ext: ".png",
        } as (typeof pack.assets.items)[string];

        const credits = document.surfaces.find(surface => surface.id === "credits")!;

        expect(collectRuntimeSurfaceAssetIds(pack, credits).sort()).toEqual([
            "credits-bg",
            "outro-clip",
            "outro-poster",
        ]);
    });

    /**
     * A widget that names an asset set keeps the set id in its props and carries the build's answer
     * beside it. The set id names no bytes, so preloading it is a guaranteed miss - and in a
     * protected build, where there is no manifest to filter against, a miss that reaches the failure
     * log. What has to be warmed is the members.
     *
     * Every member, not the one the current language names: the title screen's language button
     * changes languages without restarting, so a preload keyed to the language at load would leave
     * the picture the player just switched to arriving late.
     */
    it("warms an asset set's members rather than the set id the props still name", () => {
        const pack = makePack();
        const document = pack.bundle.ui.uidoc;
        const root = document.elements["credits-root"]!;
        root.props = { ...(root.props ?? {}), imageFill: { assetId: "title-set" } };
        root.assetVariants = { "title-set": { en: "title-en", ja: "title-ja" } };
        for (const id of ["title-en", "title-ja"]) {
            pack.assets.items[id] = {
                id,
                type: "image",
                name: id,
                source: "local",
                relativePath: `assets/${id}.png`,
                ext: ".png",
            } as (typeof pack.assets.items)[string];
        }

        const credits = document.surfaces.find(surface => surface.id === "credits")!;
        const collected = collectRuntimeSurfaceAssetIds(pack, credits);

        expect(collected.sort()).toEqual(["credits-bg", "title-en", "title-ja"]);
        expect(collected).not.toContain("title-set");
    });

    it("prioritizes first screen assets before the rest of the pack", () => {
        const pack = makePack();
        const home = pack.bundle.ui.uidoc.surfaces.find(surface => surface.id === "home")!;

        expect(collectRuntimePackAssetIds(pack, home)).toEqual({
            firstSurfaceAssetIds: ["first-bg", "nested-img", "component-font"],
            assetIds: ["first-bg", "nested-img", "component-font", "credits-bg"],
        });
    });

    it("decodes image assets and starts non-first-screen preloads after first screen settles", async () => {
        const pack = makePack();
        delete pack.assets.items["component-font"];
        const home = pack.bundle.ui.uidoc.surfaces.find(surface => surface.id === "home")!;
        const started: string[] = [];
        const decoded: string[] = [];

        class FakeImage {
            onload: (() => void) | null = null;
            onerror: (() => void) | null = null;
            private currentSrc = "";

            set src(value: string) {
                this.currentSrc = value;
                queueMicrotask(() => this.onload?.());
            }

            get src(): string {
                return this.currentSrc;
            }

            decode(): Promise<void> {
                decoded.push(this.currentSrc);
                return Promise.resolve();
            }
        }

        vi.stubGlobal("Image", FakeImage);

        const result = await preloadRuntimePackAssets({
            pack,
            firstSurface: home,
            assetUrl: assetId => {
                started.push(assetId);
                return `nlgame://asset/${assetId}`;
            },
            timeoutMs: 100,
        });

        expect(result.timedOut).toBe(false);
        expect(result.loaded).toBe(3);
        expect(result.firstSurfaceLoaded).toBe(2);
        expect(started).toEqual(["first-bg", "nested-img", "credits-bg"]);
        expect(decoded).toEqual([
            "nlgame://asset/first-bg",
            "nlgame://asset/nested-img",
            "nlgame://asset/credits-bg",
        ]);
    });

    it("skips decode() in hidden pages so background-tab boots do not stall", async () => {
        const pack = makePack();
        delete pack.assets.items["component-font"];
        const home = pack.bundle.ui.uidoc.surfaces.find(surface => surface.id === "home")!;
        const decoded: string[] = [];

        class FakeImage {
            onload: (() => void) | null = null;
            onerror: (() => void) | null = null;
            private currentSrc = "";

            set src(value: string) {
                this.currentSrc = value;
                queueMicrotask(() => this.onload?.());
            }

            get src(): string {
                return this.currentSrc;
            }

            decode(): Promise<void> {
                decoded.push(this.currentSrc);
                // A hidden page's decode queue is tied to rendering and may
                // never settle; the preload must not depend on it.
                return new Promise(() => undefined);
            }
        }

        vi.stubGlobal("Image", FakeImage);
        vi.stubGlobal("document", { visibilityState: "hidden" });

        const result = await preloadRuntimePackAssets({
            pack,
            firstSurface: home,
            assetUrl: assetId => `nlgame://asset/${assetId}`,
            timeoutMs: 100,
        });

        expect(result.timedOut).toBe(false);
        expect(result.loaded).toBe(3);
        expect(decoded).toEqual([]);
    });

    /**
     * This is the one part of a boot whose size is known before it starts, so it is the one a
     * loading state can draw as a real bar rather than a sweep. It reports what has SETTLED rather
     * than what loaded: a broken asset is one this pass will never come back to, and counting it as
     * outstanding would leave the bar short of its end for the rest of the boot.
     */
    it("reports how far it has got, counting a failed asset as settled", async () => {
        const pack = makePack();
        delete pack.assets.items["component-font"];
        const home = pack.bundle.ui.uidoc.surfaces.find(surface => surface.id === "home")!;
        const ticks: Array<[number, number]> = [];

        class FakeImage {
            onload: (() => void) | null = null;
            onerror: (() => void) | null = null;
            private currentSrc = "";

            set src(value: string) {
                this.currentSrc = value;
                queueMicrotask(() => {
                    if (value.endsWith("nested-img")) {
                        this.onerror?.();
                    } else {
                        this.onload?.();
                    }
                });
            }

            get src(): string {
                return this.currentSrc;
            }

            decode(): Promise<void> {
                return Promise.resolve();
            }
        }

        vi.stubGlobal("Image", FakeImage);

        const result = await preloadRuntimePackAssets({
            pack,
            firstSurface: home,
            assetUrl: assetId => `nlgame://asset/${assetId}`,
            timeoutMs: 100,
            onProgress: (settled, total) => ticks.push([settled, total]),
        });

        expect(result.failed).toEqual(["nested-img"]);
        expect(ticks).toHaveLength(3);
        // Against the whole list from the first tick, and rising to it: two passes counted as one
        // wait, because one wait is what the player is looking at.
        expect(ticks.map(([settled]) => settled)).toEqual([1, 2, 3]);
        expect(ticks.every(([, total]) => total === 3)).toBe(true);
    });
});

/**
 * The project's default fonts are named in the bundle rather than in any widget, so the walk that
 * collects everything else cannot see them - and they are the one typeface the whole game is set in.
 */
describe("the project's default fonts", () => {
    function packWithDefaultFonts(): GameRuntimePackV1 {
        const pack = makePack();
        pack.assets.items["default-font"] = {
            id: "default-font",
            type: "font",
            name: "default",
            source: "local",
            relativePath: "assets/default-font.woff2",
            ext: ".woff2",
        };
        (pack.bundle as { fonts?: unknown }).fonts = [
            { assetId: "default-font" },
            // A built-in stack is a CSS literal with no bytes to fetch; it is not in the manifest
            // and must not be warmed.
            { assetId: "builtin:font:serif" },
        ];
        return pack;
    }

    it("warms with the first surface, ahead of what that surface names", () => {
        const pack = packWithDefaultFonts();
        const home = pack.bundle.ui.uidoc.surfaces.find(surface => surface.id === "home")!;

        expect(collectRuntimeSurfaceAssetIds(pack, home)[0]).toBe("default-font");
    });

    it("is carried by the whole-pack sweep too", () => {
        const pack = packWithDefaultFonts();
        const home = pack.bundle.ui.uidoc.surfaces.find(surface => surface.id === "home")!;

        const { assetIds } = collectRuntimePackAssetIds(pack, home);
        expect(assetIds).toContain("default-font");
        expect(assetIds).not.toContain("builtin:font:serif");
    });
});

/**
 * What the preload does with what the manifest already says.
 *
 * The kinds are warmed by four different browser primitives, so getting the kind wrong is either a
 * wasted round trip or a warm-up that warms nothing. An unprotected pack states the kind outright;
 * a protected one states nothing at all and has to be asked.
 */
describe("deciding what an asset is", () => {
    afterEach(() => {
        vi.unstubAllGlobals();
        resetRuntimeFontFacesForTest();
    });

    function stubImages(): void {
        class FakeImage {
            onload: (() => void) | null = null;
            onerror: (() => void) | null = null;
            set src(_value: string) {
                queueMicrotask(() => this.onload?.());
            }
        }
        vi.stubGlobal("Image", FakeImage);
    }

    it("takes an image from the manifest rather than asking the shell for it", async () => {
        // A real pack records `application/octet-stream` for every library asset - the packer renames
        // them all to a content-addressed `.bin` and does not sniff them - so `type` is the only thing
        // that knows a picture from a film, and reading it is what keeps a boot from opening a second
        // request per image.
        const pack = makePack();
        for (const entry of Object.values(pack.assets.items)) {
            entry.mimeType = "application/octet-stream";
            entry.ext = "bin";
        }
        const home = pack.bundle.ui.uidoc.surfaces.find(surface => surface.id === "home")!;
        const fetched: string[] = [];
        stubImages();
        vi.stubGlobal("fetch", (url: string) => {
            fetched.push(url);
            return Promise.resolve({ ok: true, status: 200, headers: { get: () => null }, arrayBuffer: () => Promise.resolve(new ArrayBuffer(0)) });
        });
        vi.stubGlobal("FontFace", class {
            constructor(public readonly family: string) {}
            load(): Promise<unknown> {
                return Promise.resolve(this);
            }
        });
        vi.stubGlobal("document", { fonts: { add: () => undefined } });

        const result = await preloadRuntimePackAssets({
            pack,
            firstSurface: home,
            assetUrl: assetId => `nlgame://asset/${assetId}`,
            timeoutMs: 200,
        });

        expect(result.failed).toEqual([]);
        expect(fetched).toEqual([]);
    });

    it("registers a warmed font where the widgets will look for it", async () => {
        const pack = makePack();
        const home = pack.bundle.ui.uidoc.surfaces.find(surface => surface.id === "home")!;
        stubImages();
        vi.stubGlobal("FontFace", class {
            constructor(public readonly family: string) {}
            load(): Promise<unknown> {
                return Promise.resolve(this);
            }
        });
        vi.stubGlobal("document", { fonts: { add: () => undefined } });

        await preloadRuntimePackAssets({
            pack,
            firstSurface: home,
            assetUrl: assetId => `nlgame://asset/${assetId}`,
            timeoutMs: 200,
        });

        // The seam the whole warm-up hangs on: a face nobody can find is a face that gets loaded
        // again by the first widget that needs it.
        expect(registeredRuntimeFontCssFamily("component-font")).toBe(runtimeFontCssFamily("component-font"));
    });
});
