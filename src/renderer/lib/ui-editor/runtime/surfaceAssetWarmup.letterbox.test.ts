import { describe, expect, it } from "vitest";
import { UI_DOCUMENT_SCHEMA_VERSION, type UIDocument } from "@shared/types/ui-editor/document";
import { collectSurfaceWarmupAssetIds, collectWarmupAssetIds, type SurfaceWarmupSource } from "./surfaceAssetWarmup";

/**
 * The letterbox picture is on screen with the first page - beside it, on any screen of another
 * shape - so it is warmed with that page, the way the project fonts are, rather than popping in a
 * moment after the game appears.
 */
const document = {
    schemaVersion: UI_DOCUMENT_SCHEMA_VERSION,
    id: "doc",
    name: "Doc",
    surfaces: [
        { id: "title", name: "Title", kind: "appSurface", rootElementId: "title-root", designSize: { width: 1920, height: 1080 }, settings: {} },
    ],
    elements: {
        "title-root": { id: "title-root", type: "nl.container", props: {}, childrenIds: ["title-bg"] },
        "title-bg": { id: "title-bg", type: "nl.image", props: { assetId: "title-picture" }, childrenIds: [] },
    },
    components: [],
} as unknown as UIDocument;

describe("letterbox warm-up", () => {
    const source: SurfaceWarmupSource = {
        uidoc: document,
        fontAssetIds: [],
        letterboxAssetIds: ["bars-picture"],
        manifestIds: new Set(["title-picture", "bars-picture"]),
    };

    it("warms the letterbox picture with the first screen", () => {
        expect(collectSurfaceWarmupAssetIds(source, "title")).toEqual(["bars-picture", "title-picture"]);
        expect(collectWarmupAssetIds(source, "title").firstSurfaceAssetIds).toContain("bars-picture");
    });

    it("leaves out a letterbox picture the build does not carry", () => {
        expect(collectSurfaceWarmupAssetIds({ ...source, manifestIds: new Set(["title-picture"]) }, "title"))
            .toEqual(["title-picture"]);
    });

    it("warms nothing extra for a source that names no letterbox", () => {
        const { letterboxAssetIds: _omitted, ...withoutLetterbox } = source;
        expect(collectSurfaceWarmupAssetIds(withoutLetterbox, "title")).toEqual(["title-picture"]);
    });
});
