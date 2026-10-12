import { afterEach, describe, expect, it, vi } from "vitest";
import { UI_DOCUMENT_SCHEMA_VERSION, type UIDocument } from "@shared/types/ui-editor/document";
import {
    heldWarmupImageUrlsForTest,
    resetHeldWarmupImagesForTest,
    warmInterfaceAssets,
    warmSurfaceAssets,
    type SurfaceWarmupSource,
} from "./surfaceAssetWarmup";

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
    resetHeldWarmupImagesForTest();
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

/**
 * The hold on decoded pictures: what keeps a page's backdrop decoded until the page opens, within a
 * budget of 48 megapixels.
 *
 * A picture is decoded only when it is held, and held only while there is room - one beyond the
 * budget is fetched and left undecoded, because a bitmap nothing keeps is memory nothing can reuse.
 * Nothing held is let go for a later picture, which is what keeps the first screen's pictures (warmed
 * first) from being the ones pushed out by a gallery warmed after them.
 */
describe("the warm-up's hold on decoded pictures", () => {
    const types: Record<string, string> = {
        "title-picture": "image",
        "gallery-picture": "image",
    };

    /** An `Image` that knows its size from its URL, as a loaded picture does from its header. */
    function stubSizedImages(sizes: Record<string, [number, number]>): { started: string[]; decoded: string[] } {
        const log = { started: [] as string[], decoded: [] as string[] };
        class SizedImage {
            onload: (() => void) | null = null;
            onerror: (() => void) | null = null;
            naturalWidth = 0;
            naturalHeight = 0;
            private currentSrc = "";

            set src(value: string) {
                this.currentSrc = value;
                log.started.push(value);
                [this.naturalWidth, this.naturalHeight] = sizes[value] ?? [1, 1];
                queueMicrotask(() => this.onload?.());
            }

            get src(): string {
                return this.currentSrc;
            }

            decode(): Promise<void> {
                log.decoded.push(this.currentSrc);
                return Promise.resolve();
            }
        }
        vi.stubGlobal("Image", SizedImage);
        return log;
    }

    function access() {
        return {
            source: { uidoc: makeDocument(), fontAssetIds: [], manifestIds: new Set(Object.keys(types)) } satisfies SurfaceWarmupSource,
            assetUrl: (assetId: string) => `app://fs/${assetId}`,
            entryFor: (assetId: string) => ({ type: types[assetId] }),
            loadFont: async () => undefined,
            timeoutMs: 500,
        };
    }

    it("fetches a picture the hold has no room for without decoding or holding it", async () => {
        // 36 + 24 megapixels: the gallery's picture does not fit beside the title's.
        const log = stubSizedImages({
            "app://fs/title-picture": [6000, 6000],
            "app://fs/gallery-picture": [6000, 4000],
        });

        const result = await warmInterfaceAssets({ ...access(), firstSurfaceId: "title" });

        expect(result.failed).toEqual([]);
        expect(result.loaded).toBe(2);
        expect(log.started).toEqual(["app://fs/title-picture", "app://fs/gallery-picture"]);
        expect(log.decoded).toEqual(["app://fs/title-picture"]);
        expect(heldWarmupImageUrlsForTest()).toEqual(["app://fs/title-picture"]);
    });

    it("keeps the first screen's pictures when a page warmed after them would not fit beside them", async () => {
        // The screen the game opens on is second in the document; it is still the one held.
        const log = stubSizedImages({
            "app://fs/title-picture": [6000, 4000],
            "app://fs/gallery-picture": [6000, 6000],
        });

        await warmInterfaceAssets({ ...access(), firstSurfaceId: "gallery" });

        expect(log.decoded).toEqual(["app://fs/gallery-picture"]);
        expect(heldWarmupImageUrlsForTest()).toEqual(["app://fs/gallery-picture"]);
    });

    it("never lets an earlier picture go to make room for a later one", async () => {
        const log = stubSizedImages({
            "app://fs/title-picture": [4000, 3000],
            "app://fs/gallery-picture": [8000, 5000],
        });

        await warmSurfaceAssets({ ...access(), surfaceId: "title" });
        await warmSurfaceAssets({ ...access(), surfaceId: "gallery" });

        expect(heldWarmupImageUrlsForTest()).toEqual(["app://fs/title-picture"]);
        expect(log.decoded).toEqual(["app://fs/title-picture"]);
        expect(log.started).toContain("app://fs/gallery-picture");
    });

    it("counts a picture warmed twice once, as Dev Mode warms its first screen and then the whole interface", async () => {
        // 30 + 18 megapixels fill the hold exactly, which they would not if the title counted twice.
        const log = stubSizedImages({
            "app://fs/title-picture": [6000, 5000],
            "app://fs/gallery-picture": [6000, 3000],
        });

        await warmSurfaceAssets({ ...access(), surfaceId: "title" });
        await warmInterfaceAssets({ ...access(), firstSurfaceId: "title" });

        expect(heldWarmupImageUrlsForTest()).toEqual(["app://fs/title-picture", "app://fs/gallery-picture"]);
        expect(log.decoded).toContain("app://fs/gallery-picture");
    });
});
