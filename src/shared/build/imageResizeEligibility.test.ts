import { describe, expect, it } from "vitest";
import type { DevModeBundle } from "@shared/types/devMode";
import { findResizableImages, withoutLibraryTables } from "./imageResizeEligibility";

const BACKGROUND = "11111111-1111-4111-8111-111111111111";
const SPRITE = "22222222-2222-4222-8222-222222222222";
const CG = "33333333-3333-4333-8333-333333333333";
const PANEL = "44444444-4444-4444-8444-444444444444";

/** A bundle holding one scene with `blocks`, an interface document, and whatever `extra` adds. */
function bundle(input: {
    blocks?: Record<string, unknown>;
    scene?: Record<string, unknown>;
    elements?: Record<string, unknown>;
    surfaces?: unknown[];
    characters?: unknown[];
    assetNames?: Record<string, string>;
    blueprints?: Record<string, unknown>;
}): DevModeBundle {
    return {
        bundleId: "b",
        revision: 1,
        timestamp: "t",
        ui: {
            uidoc: { elements: input.elements ?? {}, surfaces: input.surfaces ?? [] },
            uigraphs: {},
            localBlueprints: { blueprints: input.blueprints ?? {} },
            persistentVariables: {},
            savedVariables: {},
        },
        storyLibrary: {
            index: {},
            documents: {
                s: { id: "s", scenes: { a: { id: "a", ...(input.scene ?? {}), blocks: input.blocks ?? {} } } },
            },
            characters: input.characters ?? [],
            animations: {},
            assetNames: input.assetNames ?? {},
        },
    } as unknown as DevModeBundle;
}

const row = (payload: Record<string, unknown>) => ({ payload });

describe("findResizableImages", () => {
    it("takes a scene's background and a /bg row's picture", () => {
        const found = findResizableImages({
            bundle: bundle({
                scene: { defaultBackgroundAssetId: BACKGROUND },
                blocks: { b1: row({ action: "setBackground", assetId: CG }) },
            }),
        });
        expect(found).toEqual(new Set([BACKGROUND, CG]));
    });

    it("takes an /image row only when it creates the image with auto-fit on", () => {
        const fitted = findResizableImages({
            bundle: bundle({ blocks: { b1: row({ action: "image", operation: "create", autoFit: true, assetId: CG }) } }),
        });
        expect(fitted).toEqual(new Set([CG]));

        for (const payload of [
            { action: "image", operation: "create", assetId: CG },
            { action: "image", operation: "create", autoFit: false, assetId: CG },
        ]) {
            expect(findResizableImages({ bundle: bundle({ blocks: { b1: row(payload) } }) })).toEqual(new Set());
        }
    });

    it("keeps a background at its size when anything else names it too", () => {
        // A row that changes an image's source draws it however that image was created, which this
        // row does not say; a character draws its sprites at their own pixels.
        const sourced = findResizableImages({
            bundle: bundle({
                scene: { defaultBackgroundAssetId: BACKGROUND },
                blocks: { b1: row({ action: "image", operation: "setSource", objectName: "cg", assetId: BACKGROUND }) },
            }),
        });
        expect(sourced).toEqual(new Set());

        const cast = findResizableImages({
            bundle: bundle({
                scene: { defaultBackgroundAssetId: BACKGROUND },
                characters: [{ id: "c", sprites: [{ assetId: BACKGROUND }] }],
            }),
        });
        expect(cast).toEqual(new Set());
    });

    it("never takes a character's sprite, however it is placed", () => {
        const found = findResizableImages({
            bundle: bundle({
                blocks: { b1: row({ action: "character", operation: "enter", characterId: "c", assetId: SPRITE }) },
                characters: [{ id: "c", presets: { normal: SPRITE } }],
            }),
        });
        expect(found).toEqual(new Set());
    });

    it("takes interface pictures their box sizes, and not a tile", () => {
        const found = findResizableImages({
            bundle: bundle({
                elements: {
                    image: { id: "image", props: { fillType: "image", imageFill: { mode: "cover", assetId: PANEL } } },
                    cropped: { id: "cropped", props: { imageFill: { mode: "crop", assetId: CG, cropPlacement: {} } } },
                    tiled: { id: "tiled", props: { imageFill: { mode: "tile", assetId: SPRITE } } },
                },
                surfaces: [
                    { id: "title", backgroundImage: { assetId: BACKGROUND, fillMode: "stretch" } },
                ],
            }),
        });
        expect(found).toEqual(new Set([PANEL, CG, BACKGROUND]));

        const tiledSurface = findResizableImages({
            bundle: bundle({ surfaces: [{ id: "title", backgroundImage: { assetId: BACKGROUND, fillMode: "tile" } }] }),
        });
        expect(tiledSurface).toEqual(new Set());
    });

    it("keeps a picture a blueprint or a plugin names", () => {
        const scene = { defaultBackgroundAssetId: BACKGROUND };
        const graphs = findResizableImages({
            bundle: bundle({ scene, blueprints: { bp: { graphs: { nodes: { n: { params: { assetId: BACKGROUND } } } } } } }),
        });
        expect(graphs).toEqual(new Set());

        const plugin = findResizableImages({
            bundle: bundle({ scene }),
            extra: [{ gallery: [{ picture: BACKGROUND }] }],
        });
        expect(plugin).toEqual(new Set());
    });

    it("is not stopped by the library's name table, which lists every asset", () => {
        const found = findResizableImages({
            bundle: bundle({
                scene: { defaultBackgroundAssetId: BACKGROUND },
                assetNames: { [BACKGROUND]: "kitchen", [SPRITE]: "girl" },
            }),
        });
        expect(found).toEqual(new Set([BACKGROUND]));
    });

    it("answers in lower case, and only for ids the sweep can find", () => {
        const found = findResizableImages({
            bundle: bundle({
                scene: { defaultBackgroundAssetId: BACKGROUND.toUpperCase() },
                blocks: { b1: row({ action: "setBackground", assetId: "kitchen-night" }) },
            }),
        });
        expect(found).toEqual(new Set([BACKGROUND]));
    });
});

describe("withoutLibraryTables", () => {
    it("empties the name and clip tables and leaves the rest as it was", () => {
        const source = {
            ...bundle({ assetNames: { [BACKGROUND]: "kitchen" } }),
            audio: { clips: { [CG]: {} }, tracks: [] },
        } as unknown as DevModeBundle;
        const swept = withoutLibraryTables(source);
        expect(swept.storyLibrary?.assetNames).toEqual({});
        expect((swept.audio as unknown as { clips: unknown; tracks: unknown }).clips).toEqual({});
        expect((swept.audio as unknown as { tracks: unknown }).tracks).toEqual([]);
        expect(swept.ui).toBe(source.ui);
        expect(source.storyLibrary?.assetNames).toEqual({ [BACKGROUND]: "kitchen" });
    });
});
