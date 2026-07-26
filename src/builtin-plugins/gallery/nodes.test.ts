import { beforeEach, describe, expect, it } from "vitest";
import { RUNTIME_UNLOCKED_KEY } from "./catalog";
import { createGalleryBlueprintNodes } from "./nodes";

/** The v1 store layout, so these tests also cover the migration on read. */
const LEGACY_CATALOG = {
    version: 1,
    items: [
        { id: "art.a", name: "Alpha", imageAssetId: "asset-a", imageAssetName: "a.png" },
        { id: "art.b", name: "Beta", imageAssetId: "asset-b", imageAssetName: "b.png" },
    ],
};

const V2_CATALOG = {
    version: 2,
    items: [{
        id: "art.a",
        name: "Alpha",
        variants: [
            { id: "art.a.v.1", name: "Day", imageAssetId: "asset-day" },
            { id: "art.a.v.2", name: "Night", imageAssetId: "asset-night" },
            { id: "art.a.v.3", name: "No image", imageAssetId: null },
        ],
        coverVariantId: "art.a.v.2",
    }],
};

let persistence: Record<string, unknown>;

function nodesFor(catalog: unknown) {
    const defs = createGalleryBlueprintNodes(() => catalog);
    return new Map(defs.map(def => [def.type, def] as const));
}

/**
 * Minimal execution context: inspector params, wired input pins, and the
 * capability-gated `game` - which is all a plugin node ever sees. Note there is
 * no `hostAdapter` to fake: the narrowed context has no route to the host API.
 */
function ctx(params: Record<string, unknown> = {}, inputs: Record<string, unknown> = {}) {
    return {
        params,
        resolveInput: (pinId: string) => inputs[pinId],
        game: {
            log: () => undefined,
            store: {
                get: async (key: string) => persistence[key] ?? null,
                set: async (key: string, value: unknown) => {
                    persistence[key] = value;
                },
            },
        },
    } as never;
}

/** The same context minus plugin storage, i.e. what the editor hands a node. */
function ctxWithoutStore(params: Record<string, unknown> = {}) {
    return { params, resolveInput: () => undefined, game: { log: () => undefined } } as never;
}

async function run(catalog: unknown, type: string, params?: Record<string, unknown>, inputs?: Record<string, unknown>) {
    const def = nodesFor(catalog).get(type);
    if (!def) {
        throw new Error(`missing node: ${type}`);
    }
    return await def.execute(ctx(params, inputs)) as { outputValues?: Record<string, unknown> };
}

const P = "narraleaf.gallery";

beforeEach(() => {
    persistence = {};
});

describe("unlock / lock nodes", () => {
    it("unlocks every variant of the artwork when no variant is picked", async () => {
        await run(LEGACY_CATALOG, `${P}.add`, { galleryItemId: "art.a" });

        // The v1 item migrated to one variant, so its id is what gets stored.
        expect(persistence[RUNTIME_UNLOCKED_KEY]).toEqual(["art.a.v1"]);
    });

    it("unlocks only the picked variant", async () => {
        await run(V2_CATALOG, `${P}.add`, { galleryItemId: "art.a", galleryVariantId: "art.a.v.2" });

        expect(persistence[RUNTIME_UNLOCKED_KEY]).toEqual(["art.a.v.2"]);
    });

    it("locks a single variant without touching its siblings", async () => {
        persistence[RUNTIME_UNLOCKED_KEY] = ["art.a.v.1", "art.a.v.2"];

        await run(V2_CATALOG, `${P}.remove`, { galleryItemId: "art.a", galleryVariantId: "art.a.v.1" });

        expect(persistence[RUNTIME_UNLOCKED_KEY]).toEqual(["art.a.v.2"]);
    });

    it("clears the whole record", async () => {
        persistence[RUNTIME_UNLOCKED_KEY] = ["art.a.v.1"];

        await run(V2_CATALOG, `${P}.clear`);

        expect(persistence[RUNTIME_UNLOCKED_KEY]).toEqual([]);
    });

    it("rejects an artwork that is not picked or not found", async () => {
        await expect(run(V2_CATALOG, `${P}.add`, {})).rejects.toThrow(/Pick a gallery artwork/);
        await expect(run(V2_CATALOG, `${P}.add`, { galleryItemId: "nope" })).rejects.toThrow(/not found/);
    });
});

describe("isUnlocked", () => {
    it("treats a v1 artwork-level record as unlocking every variant", async () => {
        // Written before variants existed; the player must keep their CG.
        persistence[RUNTIME_UNLOCKED_KEY] = ["art.a"];

        const result = await run(V2_CATALOG, `${P}.isUnlocked`, {
            galleryItemId: "art.a",
            galleryVariantId: "art.a.v.3",
        });

        expect(result.outputValues?.unlocked).toBe(true);
    });

    it("reports the artwork as unlocked when any variant is", async () => {
        persistence[RUNTIME_UNLOCKED_KEY] = ["art.a.v.2"];

        const result = await run(V2_CATALOG, `${P}.isUnlocked`, { galleryItemId: "art.a" });

        expect(result.outputValues?.unlocked).toBe(true);
    });

    it("reports a specific locked variant as locked", async () => {
        persistence[RUNTIME_UNLOCKED_KEY] = ["art.a.v.2"];

        const result = await run(V2_CATALOG, `${P}.isUnlocked`, {
            galleryItemId: "art.a",
            galleryVariantId: "art.a.v.1",
        });

        expect(result.outputValues?.unlocked).toBe(false);
    });
});

describe("getVariant", () => {
    it("returns the ImageAsset envelope for an unlocked variant", async () => {
        persistence[RUNTIME_UNLOCKED_KEY] = ["art.a.v.2"];

        const result = await run(V2_CATALOG, `${P}.getVariant`, { galleryItemId: "art.a" }, { index: 1 });

        expect(result.outputValues).toEqual({
            image: { kind: "imageAsset", assetId: "asset-night" },
            unlocked: true,
            name: "Night",
            variantId: "art.a.v.2",
        });
    });

    it("returns a null image for a locked variant, but still names it", async () => {
        // The UI draws a silhouette from the null image and labels the slot.
        const result = await run(V2_CATALOG, `${P}.getVariant`, { galleryItemId: "art.a" }, { index: 0 });

        expect(result.outputValues?.image).toBeNull();
        expect(result.outputValues?.unlocked).toBe(false);
        expect(result.outputValues?.name).toBe("Day");
    });

    it("returns a null image for an unlocked variant that has no asset", async () => {
        persistence[RUNTIME_UNLOCKED_KEY] = ["art.a.v.3"];

        const result = await run(V2_CATALOG, `${P}.getVariant`, { galleryItemId: "art.a" }, { index: 2 });

        expect(result.outputValues?.image).toBeNull();
        expect(result.outputValues?.unlocked).toBe(true);
    });

    it("returns empty outputs for an out-of-range index instead of throwing", async () => {
        const result = await run(V2_CATALOG, `${P}.getVariant`, { galleryItemId: "art.a" }, { index: 99 });

        expect(result.outputValues).toEqual({ image: null, unlocked: false, name: "", variantId: "" });
    });

    it("defaults to index 0 when the pin is unwired", async () => {
        const result = await run(V2_CATALOG, `${P}.getVariant`, { galleryItemId: "art.a" }, {});

        expect(result.outputValues?.variantId).toBe("art.a.v.1");
    });
});

describe("getCover", () => {
    it("uses the explicit cover variant", async () => {
        persistence[RUNTIME_UNLOCKED_KEY] = ["art.a.v.2"];

        const result = await run(V2_CATALOG, `${P}.getCover`, { galleryItemId: "art.a" });

        expect(result.outputValues?.image).toEqual({ kind: "imageAsset", assetId: "asset-night" });
        expect(result.outputValues?.name).toBe("Alpha");
    });

    it("hides the cover image while it is locked", async () => {
        const result = await run(V2_CATALOG, `${P}.getCover`, { galleryItemId: "art.a" });

        expect(result.outputValues?.image).toBeNull();
        expect(result.outputValues?.unlocked).toBe(false);
    });
});

describe("artwork iteration", () => {
    it("counts artworks and reads one by index", async () => {
        persistence[RUNTIME_UNLOCKED_KEY] = ["art.b"];

        const count = await run(LEGACY_CATALOG, `${P}.getArtworkCount`);
        const second = await run(LEGACY_CATALOG, `${P}.getArtworkAt`, {}, { index: 1 });

        expect(count.outputValues?.count).toBe(2);
        expect(second.outputValues).toEqual({
            artworkId: "art.b",
            name: "Beta",
            unlocked: true,
            variantCount: 1,
        });
    });

    it("returns empty outputs past the end", async () => {
        const result = await run(LEGACY_CATALOG, `${P}.getArtworkAt`, {}, { index: 5 });

        expect(result.outputValues).toEqual({ artworkId: "", name: "", unlocked: false, variantCount: 0 });
    });

    it("feeds a wired artworkId into an artwork-scoped node, overriding the picker", async () => {
        // This is the loop that makes a gallery grid possible: getArtworkAt ->
        // artworkId -> getVariantCount.
        const result = await run(
            LEGACY_CATALOG,
            `${P}.getVariantCount`,
            { galleryItemId: "art.a" },
            { artworkId: "art.b" },
        );

        expect(result.outputValues?.count).toBe(1);
    });
});

describe("degradation", () => {
    it("treats a missing catalog as an empty gallery rather than crashing", async () => {
        const result = await run(null, `${P}.getArtworkCount`);

        expect(result.outputValues?.count).toBe(0);
    });

    it("counts locked variants too, so the UI can draw placeholder slots", async () => {
        const result = await run(V2_CATALOG, `${P}.getVariantCount`, { galleryItemId: "art.a" });

        expect(result.outputValues?.count).toBe(3);
    });

    it("reads as locked and swallows writes when plugin storage is unavailable", async () => {
        // The editor backs no runtime capability, so app.game.store is absent
        // there. A gallery previewed in Studio must render, not throw.
        const defs = nodesFor(V2_CATALOG);
        const read = await defs.get(`${P}.isUnlocked`)!.execute(
            ctxWithoutStore({ galleryItemId: "art.a" }),
        ) as { outputValues?: Record<string, unknown> };
        expect(read.outputValues?.unlocked).toBe(false);

        await expect(defs.get(`${P}.add`)!.execute(
            ctxWithoutStore({ galleryItemId: "art.a" }),
        )).resolves.toEqual({ nextPort: "next" });
        expect(persistence).toEqual({});
    });
});
