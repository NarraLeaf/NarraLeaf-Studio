import { describe, expect, it } from "vitest";
import {
    createVariantId,
    isArtworkUnlocked,
    normalizeGalleryCatalog,
    readUnlockedVariantIds,
    resolveCoverVariant,
    toImageAssetValue,
    type GalleryArtwork,
} from "./catalog";

const LEGACY_ITEM = {
    id: "narraleaf.gallery.abc",
    name: "Sunset",
    imageAssetId: "asset-1",
    imageAssetName: "sunset.png",
    createdAt: 100,
    updatedAt: 200,
};

function artwork(overrides: Partial<GalleryArtwork> = {}): GalleryArtwork {
    return {
        id: "art-1",
        name: "Artwork",
        variants: [],
        coverVariantId: null,
        createdAt: 0,
        updatedAt: 0,
        ...overrides,
    };
}

describe("normalizeGalleryCatalog", () => {
    it("migrates a v1 item into one artwork holding a single variant", () => {
        const [migrated] = normalizeGalleryCatalog({ version: 1, items: [LEGACY_ITEM] });

        expect(migrated.id).toBe(LEGACY_ITEM.id);
        expect(migrated.name).toBe("Sunset");
        expect(migrated.variants).toEqual([{
            id: "narraleaf.gallery.abc.v1",
            name: "Sunset",
            imageAssetId: "asset-1",
            imageAssetName: "sunset.png",
        }]);
        expect(migrated.coverVariantId).toBe("narraleaf.gallery.abc.v1");
        expect(migrated.createdAt).toBe(100);
    });

    it("gives the migrated variant a stable id across repeated normalization", () => {
        // A random id would drift on every load, orphaning both player unlock
        // records and variant ids already authored into node params.
        const first = normalizeGalleryCatalog({ version: 1, items: [LEGACY_ITEM] });
        const second = normalizeGalleryCatalog(first);

        expect(second[0].variants[0].id).toBe(first[0].variants[0].id);
    });

    it("keeps a v1 item without an image as a variant with no asset", () => {
        const [migrated] = normalizeGalleryCatalog({
            version: 1,
            items: [{ id: "a", name: "Empty", imageAssetId: null }],
        });

        expect(migrated.variants).toHaveLength(1);
        expect(migrated.variants[0].imageAssetId).toBeNull();
    });

    it("reads v2 items and accepts a bare item array", () => {
        const items = [artwork({
            id: "a",
            variants: [{ id: "a.v.1", name: "One", imageAssetId: "asset-1" }],
            coverVariantId: "a.v.1",
        })];

        expect(normalizeGalleryCatalog({ version: 2, items })[0].variants).toHaveLength(1);
        expect(normalizeGalleryCatalog(items)[0].coverVariantId).toBe("a.v.1");
    });

    it("migrates per item, so a partially migrated store still loads", () => {
        const result = normalizeGalleryCatalog({
            version: 2,
            items: [
                LEGACY_ITEM,
                artwork({ id: "b", variants: [{ id: "b.v.1", name: "One", imageAssetId: null }] }),
            ],
        });

        expect(result).toHaveLength(2);
        expect(result[0].variants[0].id).toBe("narraleaf.gallery.abc.v1");
        expect(result[1].variants[0].id).toBe("b.v.1");
    });

    it("drops malformed entries instead of throwing", () => {
        const result = normalizeGalleryCatalog({
            version: 2,
            items: [null, "nope", { name: "no id" }, artwork({ id: "ok" })],
        });

        expect(result.map(entry => entry.id)).toEqual(["ok"]);
    });

    it("clears a coverVariantId that no longer points at a variant", () => {
        const [result] = normalizeGalleryCatalog([artwork({
            variants: [{ id: "v1", name: "One", imageAssetId: null }],
            coverVariantId: "deleted-variant",
        })]);

        expect(result.coverVariantId).toBeNull();
    });

    it("returns an empty catalog for junk input", () => {
        expect(normalizeGalleryCatalog(null)).toEqual([]);
        expect(normalizeGalleryCatalog(undefined)).toEqual([]);
        expect(normalizeGalleryCatalog({ items: "nope" })).toEqual([]);
    });
});

describe("resolveCoverVariant", () => {
    const first = { id: "v1", name: "One", imageAssetId: "a1" };
    const second = { id: "v2", name: "Two", imageAssetId: "a2" };

    it("prefers the explicit cover", () => {
        const result = resolveCoverVariant(artwork({ variants: [first, second], coverVariantId: "v2" }));
        expect(result?.id).toBe("v2");
    });

    it("falls back to the first variant when no cover is set", () => {
        const result = resolveCoverVariant(artwork({ variants: [first, second], coverVariantId: null }));
        expect(result?.id).toBe("v1");
    });

    it("returns null for an artwork with no variants", () => {
        expect(resolveCoverVariant(artwork())).toBeNull();
    });
});

describe("readUnlockedVariantIds", () => {
    const catalog = [artwork({
        id: "art-1",
        variants: [
            { id: "art-1.v.a", name: "A", imageAssetId: null },
            { id: "art-1.v.b", name: "B", imageAssetId: null },
        ],
    })];

    it("expands a v1 artwork-level unlock into every variant of that artwork", () => {
        // Before variants existed the record held artwork ids; a player who
        // unlocked a CG back then must keep seeing all of it.
        const unlocked = readUnlockedVariantIds(["art-1"], catalog);

        expect(unlocked).toEqual(new Set(["art-1.v.a", "art-1.v.b"]));
    });

    it("passes variant ids through untouched", () => {
        const unlocked = readUnlockedVariantIds(["art-1.v.b"], catalog);

        expect(unlocked).toEqual(new Set(["art-1.v.b"]));
    });

    it("keeps ids whose artwork is gone, so deleting an artwork is not destructive", () => {
        const unlocked = readUnlockedVariantIds(["removed.v.a"], catalog);

        expect(unlocked.has("removed.v.a")).toBe(true);
    });

    it("degrades to an empty set for a missing or corrupt record", () => {
        expect(readUnlockedVariantIds(undefined, catalog).size).toBe(0);
        expect(readUnlockedVariantIds("nope", catalog).size).toBe(0);
        expect(readUnlockedVariantIds([1, null], catalog).size).toBe(0);
    });
});

describe("isArtworkUnlocked", () => {
    const target = artwork({
        variants: [
            { id: "v1", name: "A", imageAssetId: null },
            { id: "v2", name: "B", imageAssetId: null },
        ],
    });

    it("is true when any variant is unlocked", () => {
        expect(isArtworkUnlocked(target, new Set(["v2"]))).toBe(true);
    });

    it("is false when none are", () => {
        expect(isArtworkUnlocked(target, new Set(["other"]))).toBe(false);
        expect(isArtworkUnlocked(artwork(), new Set(["v1"]))).toBe(false);
    });
});

describe("id shapes and value envelopes", () => {
    it("derives variant ids from the artwork so the two can never collide", () => {
        // readUnlockedVariantIds distinguishes the v1 record from the v2 one by
        // exact id match, which only holds if the namespaces stay disjoint.
        const artworkId = "narraleaf.gallery.xyz";
        const variantId = createVariantId(artworkId);

        expect(variantId.startsWith(`${artworkId}.v.`)).toBe(true);
        expect(variantId).not.toBe(artworkId);
    });

    it("builds the ImageAsset envelope only for a real asset id", () => {
        expect(toImageAssetValue("asset-1")).toEqual({ kind: "imageAsset", assetId: "asset-1" });
        expect(toImageAssetValue(null)).toBeNull();
        expect(toImageAssetValue("   ")).toBeNull();
    });
});
