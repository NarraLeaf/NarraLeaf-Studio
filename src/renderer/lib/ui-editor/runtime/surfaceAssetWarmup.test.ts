import { afterEach, describe, expect, it, vi } from "vitest";
import { UI_DOCUMENT_SCHEMA_VERSION, type UIDocument } from "@shared/types/ui-editor/document";
import { warmSurfaceAssets, type SurfaceWarmupSource } from "./surfaceAssetWarmup";

/**
 * The pass as a Dev Mode window runs it: one screen, no pack.
 *
 * The packaged game's two-pass form is covered through its own adapter
 * (`src/runtime/renderer/surfaceResourcePreload.test.ts`). What has to hold here is the shape the
 * window depends on - that it waits on the screen it opens on and nothing else, that a typeface goes
 * to the registry it is handed rather than being fetched as a picture, and that the library's word
 * for an asset is enough to say which is which.
 */

function makeDocument(): UIDocument {
    return {
        schemaVersion: UI_DOCUMENT_SCHEMA_VERSION,
        id: "doc",
        name: "Doc",
        surfaces: [
            { id: "title", name: "Title", kind: "appSurface", rootElementId: "title-root", designSize: { width: 1920, height: 1080 }, settings: {} },
            { id: "gallery", name: "Gallery", kind: "appSurface", rootElementId: "gallery-root", designSize: { width: 1920, height: 1080 }, settings: {} },
        ],
        elements: {
            "title-root": { id: "title-root", type: "nl.container", props: {}, childrenIds: ["title-bg", "title-label"] },
            "title-bg": { id: "title-bg", type: "nl.image", props: { assetId: "title-picture" }, childrenIds: [] },
            "title-label": { id: "title-label", type: "nl.text", props: { fontAssetId: "display-face" }, childrenIds: [] },
            "gallery-root": { id: "gallery-root", type: "nl.container", props: {}, childrenIds: ["gallery-bg"] },
            "gallery-bg": { id: "gallery-bg", type: "nl.image", props: { assetId: "gallery-picture" }, childrenIds: [] },
        },
        components: [],
    } as unknown as UIDocument;
}

function stubImages(started: string[]): void {
    class FakeImage {
        onload: (() => void) | null = null;
        onerror: (() => void) | null = null;
        private currentSrc = "";

        set src(value: string) {
            this.currentSrc = value;
            started.push(value);
            queueMicrotask(() => this.onload?.());
        }

        get src(): string {
            return this.currentSrc;
        }

        decode(): Promise<void> {
            return Promise.resolve();
        }
    }
    vi.stubGlobal("Image", FakeImage);
}

afterEach(() => {
    vi.unstubAllGlobals();
});

describe("warmSurfaceAssets", () => {
    const types: Record<string, string> = {
        "title-picture": "image",
        "gallery-picture": "image",
        "display-face": "font",
        "body-face": "font",
    };
    const source: SurfaceWarmupSource = {
        uidoc: makeDocument(),
        fontAssetIds: ["body-face"],
        manifestIds: new Set(Object.keys(types)),
    };

    it("waits on the screen it opens on and the project fonts, and not on the rest", async () => {
        const images: string[] = [];
        stubImages(images);
        const fonts: string[] = [];

        const result = await warmSurfaceAssets({
            source,
            surfaceId: "title",
            assetUrl: assetId => `app://fs/${assetId}`,
            entryFor: assetId => ({ type: types[assetId] }),
            loadFont: async assetId => { fonts.push(assetId); },
            timeoutMs: 500,
        });

        expect(result.timedOut).toBe(false);
        expect(new Set(result.assetIds)).toEqual(new Set(["title-picture", "display-face", "body-face"]));
        expect(images).toEqual(["app://fs/title-picture"]);
        expect(new Set(fonts)).toEqual(new Set(["display-face", "body-face"]));
    });

    it("counts a typeface that will not load as failed rather than waiting on it", async () => {
        stubImages([]);

        const result = await warmSurfaceAssets({
            source,
            surfaceId: "title",
            assetUrl: assetId => `app://fs/${assetId}`,
            entryFor: assetId => ({ type: types[assetId] }),
            loadFont: async () => { throw new Error("unsupported format"); },
            timeoutMs: 500,
        });

        expect(result.timedOut).toBe(false);
        expect(new Set(result.failed)).toEqual(new Set(["display-face", "body-face"]));
        expect(result.loaded).toBe(1);
    });

    it("leaves out an id the library cannot answer for, instead of waiting for it to fail", async () => {
        stubImages([]);

        const result = await warmSurfaceAssets({
            source: { ...source, manifestIds: new Set(["title-picture"]) },
            surfaceId: "title",
            assetUrl: assetId => `app://fs/${assetId}`,
            entryFor: assetId => ({ type: types[assetId] }),
            loadFont: async () => undefined,
            timeoutMs: 500,
        });

        expect(result.assetIds).toEqual(["title-picture"]);
    });

    it("says how far it has got after every asset, against a total that does not move", async () => {
        stubImages([]);
        const reports: Array<[number, number]> = [];

        await warmSurfaceAssets({
            source,
            surfaceId: "title",
            assetUrl: assetId => `app://fs/${assetId}`,
            entryFor: assetId => ({ type: types[assetId] }),
            loadFont: async () => undefined,
            onProgress: (settled, total) => reports.push([settled, total]),
            timeoutMs: 500,
        });

        expect(reports.map(([, total]) => total)).toEqual([3, 3, 3]);
        expect(reports.map(([settled]) => settled)).toEqual([1, 2, 3]);
    });
});
