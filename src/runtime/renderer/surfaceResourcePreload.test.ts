import { afterEach, describe, expect, it, vi } from "vitest";
import { GAME_RUNTIME_PACK_SCHEMA_VERSION, type GameRuntimePackV1 } from "@shared/types/gameRuntime";
import { UI_DOCUMENT_SCHEMA_VERSION, type UIDocument } from "@shared/types/ui-editor/document";
import { UI_FRAME_ELEMENT_TYPE } from "@shared/types/ui-editor/frame";
import {
    collectRuntimePackAssetIds,
    collectRuntimeSurfaceAssetIds,
    preloadRuntimePackAssets,
} from "./surfaceResourcePreload";

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
                sharedBlueprints: [],
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
});
