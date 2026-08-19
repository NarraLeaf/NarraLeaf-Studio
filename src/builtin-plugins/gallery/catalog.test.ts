import { describe, expect, it } from "vitest";
import {
    DEFAULT_LOCKED_NAME_MASK,
    collectAudioAssetVariantIds,
    collectSceneVariantIds,
    collectVoiceUnitVariantIds,
    computeGalleryStats,
    createVariantId,
    isArtworkUnlocked,
    normalizeGalleryCatalog,
    normalizeGalleryStore,
    projectGalleryEntries,
    projectGalleryVariants,
    readUnlockedVariantIds,
    resolveCoverVariant,
    toImageAssetValue,
    type GalleryArtwork,
    type GalleryStoreData,
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
        kind: "cg",
        description: "",
        groupId: null,
        variants: [],
        coverVariantId: null,
        lockedImageAssetId: null,
        hidden: false,
        createdAt: 0,
        updatedAt: 0,
        ...overrides,
    };
}

function storeOf(overrides: Partial<GalleryStoreData> = {}): GalleryStoreData {
    return normalizeGalleryStore({
        version: 4,
        groups: [],
        items: [],
        settings: { lockedImageAssetId: null, lockedNameMask: DEFAULT_LOCKED_NAME_MASK },
        ...overrides,
    });
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

describe("normalizeGalleryStore", () => {
    it("defaults a v1/v2 store to no groups, no placeholder and the standard mask", () => {
        const store = normalizeGalleryStore({ version: 2, items: [LEGACY_ITEM] });

        expect(store.version).toBe(4);
        expect(store.groups).toEqual([]);
        expect(store.settings).toEqual({
            lockedImageAssetId: null,
            lockedImageAssetName: null,
            lockedNameMask: DEFAULT_LOCKED_NAME_MASK,
        });
        expect(store.items[0]!.kind).toBe("cg");
        expect(store.items[0]!.hidden).toBe(false);
    });

    it("releases an artwork whose group was deleted rather than stranding it", () => {
        const store = normalizeGalleryStore({
            groups: [{ id: "g1", name: "Chapter 1" }],
            items: [artwork({ id: "a", groupId: "g1" }), artwork({ id: "b", groupId: "gone" })],
        });

        expect(store.items[0]!.groupId).toBe("g1");
        expect(store.items[1]!.groupId).toBeNull();
    });

    it("drops duplicate and malformed groups", () => {
        const store = normalizeGalleryStore({
            groups: [{ id: "g1", name: "A" }, { id: "g1", name: "dup" }, null, { name: "no id" }],
            items: [],
        });

        expect(store.groups).toEqual([{ id: "g1", name: "A" }]);
    });

    it("keeps an explicitly empty mask, so a gallery can show real titles while locked", () => {
        // Only a *missing* field falls back to the default; "" is a choice.
        expect(normalizeGalleryStore({ settings: { lockedNameMask: "" } }).settings.lockedNameMask).toBe("");
        expect(normalizeGalleryStore({ settings: {} }).settings.lockedNameMask).toBe(DEFAULT_LOCKED_NAME_MASK);
    });
});

describe("projectGalleryEntries", () => {
    const locked = artwork({
        id: "locked",
        name: "Secret Beach",
        description: "The ending scene",
        variants: [{ id: "locked.v.1", name: "Day", imageAssetId: "asset-real" }],
        lockedImageAssetId: "asset-silhouette",
    });
    const opened = artwork({
        id: "opened",
        name: "Sunrise",
        variants: [
            { id: "opened.v.1", name: "Day", imageAssetId: "asset-day" },
            { id: "opened.v.2", name: "Night", imageAssetId: "asset-night" },
        ],
        coverVariantId: "opened.v.2",
    });

    it("withholds the art, the title and the description of a locked artwork", () => {
        const [row] = projectGalleryEntries(storeOf({ items: [locked] }), new Set());

        expect(row!.locked).toBe(true);
        expect(row!.name).toBe(DEFAULT_LOCKED_NAME_MASK);
        expect(row!.description).toBe("");
        expect(row!.assetId).toBe("asset-silhouette");
        // The real art must not leak through the thumbnail slot either.
        expect(row!.thumbnailAssetId).toBe("asset-silhouette");
    });

    it("serves the cover variant and the real title once unlocked", () => {
        const [row] = projectGalleryEntries(storeOf({ items: [opened] }), new Set(["opened.v.2"]));

        expect(row!.unlocked).toBe(true);
        expect(row!.name).toBe("Sunrise");
        expect(row!.assetId).toBe("asset-night");
        expect(row!.image).toEqual({ kind: "imageAsset", assetId: "asset-night" });
        expect(row!.unlockedCount).toBe(1);
        expect(row!.variantCount).toBe(2);
    });

    it("falls back to the catalog placeholder when the artwork has none", () => {
        const bare = artwork({ id: "bare", variants: [{ id: "bare.v.1", name: "A", imageAssetId: "real" }] });
        const store = storeOf({
            items: [bare],
            settings: { lockedImageAssetId: "asset-default", lockedNameMask: DEFAULT_LOCKED_NAME_MASK },
        });

        expect(projectGalleryEntries(store, new Set())[0]!.assetId).toBe("asset-default");
    });

    it("hides a hidden artwork until it is unlocked", () => {
        const secret = artwork({
            id: "secret",
            hidden: true,
            variants: [{ id: "secret.v.1", name: "A", imageAssetId: "a" }],
        });
        const store = storeOf({ items: [secret] });

        expect(projectGalleryEntries(store, new Set())).toHaveLength(0);
        expect(projectGalleryEntries(store, new Set(["secret.v.1"]))).toHaveLength(1);
    });

    it("filters by group and by unlock state", () => {
        const store = storeOf({
            groups: [{ id: "g1", name: "Chapter 1" }],
            items: [
                artwork({ id: "a", groupId: "g1", variants: [{ id: "a.v", name: "A", imageAssetId: "x" }] }),
                artwork({ id: "b", variants: [{ id: "b.v", name: "B", imageAssetId: "y" }] }),
            ],
        });

        expect(projectGalleryEntries(store, new Set(), { groupId: "g1" }).map(r => r.id)).toEqual(["a"]);
        expect(projectGalleryEntries(store, new Set(["b.v"]), { onlyUnlocked: true }).map(r => r.id)).toEqual(["b"]);
    });

    it("numbers rows by their position after filtering", () => {
        // The index must address the array the List widget actually receives.
        const store = storeOf({
            items: [
                artwork({ id: "a", variants: [{ id: "a.v", name: "A", imageAssetId: "x" }] }),
                artwork({ id: "b", variants: [{ id: "b.v", name: "B", imageAssetId: "y" }] }),
                artwork({ id: "c", variants: [{ id: "c.v", name: "C", imageAssetId: "z" }] }),
            ],
        });

        const rows = projectGalleryEntries(store, new Set(["c.v"]), { onlyUnlocked: true });
        expect(rows.map(row => [row.id, row.index])).toEqual([["c", 0]]);
    });

    it("carries the group name so a row can label itself", () => {
        const store = storeOf({
            groups: [{ id: "g1", name: "Chapter 1" }],
            items: [artwork({ id: "a", groupId: "g1" })],
        });

        expect(projectGalleryEntries(store, new Set())[0]!.groupName).toBe("Chapter 1");
    });
});

describe("projectGalleryVariants", () => {
    const target = artwork({
        id: "art",
        variants: [
            { id: "art.v.1", name: "Day", imageAssetId: "asset-day" },
            { id: "art.v.2", name: "Night", imageAssetId: "asset-night" },
        ],
        coverVariantId: "art.v.2",
        lockedImageAssetId: "asset-silhouette",
    });

    it("applies the same lock discipline per differential", () => {
        const rows = projectGalleryVariants(storeOf({ items: [target] }), target, new Set(["art.v.1"]));

        expect(rows[0]!.unlocked).toBe(true);
        expect(rows[0]!.assetId).toBe("asset-day");
        expect(rows[1]!.locked).toBe(true);
        expect(rows[1]!.name).toBe(DEFAULT_LOCKED_NAME_MASK);
        expect(rows[1]!.assetId).toBe("asset-silhouette");
    });

    it("marks the cover and can drop locked differentials", () => {
        const store = storeOf({ items: [target] });

        expect(projectGalleryVariants(store, target, new Set()).map(r => r.isCover)).toEqual([false, true]);
        expect(projectGalleryVariants(store, target, new Set(["art.v.1"]), { onlyUnlocked: true }))
            .toHaveLength(1);
    });
});

describe("computeGalleryStats", () => {
    const store = storeOf({
        items: [
            artwork({ id: "a", variants: [{ id: "a.v", name: "A", imageAssetId: "x" }] }),
            artwork({
                id: "b",
                variants: [
                    { id: "b.v1", name: "B1", imageAssetId: "y" },
                    { id: "b.v2", name: "B2", imageAssetId: "z" },
                ],
            }),
        ],
    });

    it("counts artworks and differentials separately", () => {
        const stats = computeGalleryStats(store, new Set(["b.v1"]));

        expect(stats).toEqual({
            total: 2,
            unlocked: 1,
            variantTotal: 3,
            variantUnlocked: 1,
            percent: 50,
        });
    });

    it("leaves a hidden artwork out of the denominator until it is found", () => {
        // A counter reading 1/2 would betray that a secret CG exists at all.
        const withSecret = storeOf({
            items: [
                artwork({ id: "a", variants: [{ id: "a.v", name: "A", imageAssetId: "x" }] }),
                artwork({ id: "s", hidden: true, variants: [{ id: "s.v", name: "S", imageAssetId: "y" }] }),
            ],
        });

        expect(computeGalleryStats(withSecret, new Set()).total).toBe(1);
        expect(computeGalleryStats(withSecret, new Set(["s.v"])).total).toBe(2);
    });

    it("reports 0% rather than dividing by zero on an empty gallery", () => {
        expect(computeGalleryStats(storeOf(), new Set()).percent).toBe(0);
    });
});

describe("v4 kinds", () => {
    const track = artwork({
        id: "album",
        name: "OST",
        kind: "music",
        variants: [
            {
                id: "album.v.1",
                name: "Opening Theme",
                imageAssetId: null,
                audioAssetId: "asset-mp3",
                audioAssetName: "opening.mp3",
                durationSec: 154.5,
            },
        ],
    });
    const recollection = artwork({
        id: "recall",
        name: "The Confession",
        kind: "scene",
        variants: [{ id: "recall.v.1", name: "Cover", imageAssetId: "asset-shot" }],
        scene: { storyId: "story-1", sceneId: "scene-7", startBlockId: "block-3" },
    });
    const line = artwork({
        id: "vo",
        name: "Nattou",
        kind: "voice",
        variants: [{
            id: "vo.v.1",
            name: "Greeting",
            imageAssetId: null,
            voiceUnitId: "text-uuid-1",
            lineText: "Good morning!",
        }],
    });

    it("keeps a v3 store readable without a migration step", () => {
        // Every v3 entry already carries kind:"cg" and the new fields are
        // optional, so v3 output is already valid v4.
        const store = normalizeGalleryStore({ version: 3, items: [artwork({ id: "a" })] });

        expect(store.version).toBe(4);
        expect(store.items[0]!.kind).toBe("cg");
    });

    it("reads an unknown kind as cg rather than dropping the entry", () => {
        // A project from a newer Studio must still show its entries.
        const store = normalizeGalleryStore({ items: [{ ...artwork({ id: "x" }), kind: "hologram" }] });

        expect(store.items).toHaveLength(1);
        expect(store.items[0]!.kind).toBe("cg");
    });

    it("omits kind-specific fields rather than nulling them", () => {
        // A CG variant must not carry four empty audio keys through every save.
        const store = normalizeGalleryStore({ items: [artwork({
            id: "a",
            variants: [{ id: "a.v", name: "One", imageAssetId: "img" }],
        })] });
        const variant = store.items[0]!.variants[0]!;

        expect("audioAssetId" in variant).toBe(false);
        expect("voiceUnitId" in variant).toBe(false);
        expect("durationSec" in variant).toBe(false);
    });

    it("drops a scene payload naming neither story nor scene", () => {
        const store = normalizeGalleryStore({ items: [{
            ...recollection,
            scene: { storyId: "", sceneId: "" },
        }] });

        expect(store.items[0]!.scene).toBeUndefined();
    });

    it("only keeps a scene payload on a scene entry", () => {
        // A CG carrying stale scene coordinates would project them onto rows.
        const store = normalizeGalleryStore({ items: [{
            ...artwork({ id: "cg" }),
            scene: { storyId: "s", sceneId: "sc" },
        }] });

        expect(store.items[0]!.scene).toBeUndefined();
    });

    it("carries audio, voice and scene fields onto unlocked rows", () => {
        const store = storeOf({ items: [track, recollection, line] });
        const rows = projectGalleryEntries(store, new Set(["album.v.1", "recall.v.1", "vo.v.1"]));

        expect(rows[0]).toMatchObject({ kind: "music", audioAssetId: "asset-mp3", durationSec: 154.5 });
        expect(rows[1]).toMatchObject({
            kind: "scene",
            storyId: "story-1",
            sceneId: "scene-7",
            startBlockId: "block-3",
        });
        expect(rows[2]).toMatchObject({ kind: "voice", voiceUnitId: "text-uuid-1" });
    });

    it("withholds the clip, the unit id and the scene coordinates while locked", () => {
        // A scene id names the chapter the player has not reached, so it is a
        // spoiler exactly like the art is.
        const store = storeOf({ items: [track, recollection, line] });
        const rows = projectGalleryEntries(store, new Set());

        expect(rows[0]!.audioAssetId).toBe("");
        expect(rows[0]!.durationSec).toBe(0);
        expect(rows[1]!.storyId).toBe("");
        expect(rows[1]!.sceneId).toBe("");
        expect(rows[1]!.startBlockId).toBe("");
        expect(rows[2]!.voiceUnitId).toBe("");
    });

    it("carries the line text onto an unlocked voice member and withholds it when locked", () => {
        const store = storeOf({ items: [line] });

        expect(projectGalleryVariants(store, line, new Set(["vo.v.1"]))[0])
            .toMatchObject({ lineText: "Good morning!", voiceUnitId: "text-uuid-1" });
        expect(projectGalleryVariants(store, line, new Set())[0]!.lineText).toBe("");
    });

    it("filters entries and progress by kind", () => {
        const store = storeOf({ items: [track, recollection, line, artwork({
            id: "cg",
            variants: [{ id: "cg.v", name: "A", imageAssetId: "i" }],
        })] });

        expect(projectGalleryEntries(store, new Set(), { kind: "music" }).map(r => r.id)).toEqual(["album"]);
        expect(projectGalleryEntries(store, new Set(), { kind: "cg" }).map(r => r.id)).toEqual(["cg"]);
        expect(computeGalleryStats(store, new Set(["album.v.1"]), { kind: "music" }))
            .toMatchObject({ total: 1, unlocked: 1, percent: 100 });
        expect(computeGalleryStats(store, new Set(["album.v.1"]), { kind: "voice" }))
            .toMatchObject({ total: 1, unlocked: 0, percent: 0 });
    });

    it("rejects a non-positive duration", () => {
        const store = normalizeGalleryStore({ items: [{
            ...track,
            variants: [{ ...track.variants[0], durationSec: -5 }],
        }] });

        expect("durationSec" in store.items[0]!.variants[0]!).toBe(false);
    });
});

describe("what an automatic signal collects", () => {
    const items = normalizeGalleryStore({
        items: [
            artwork({
                id: "cg",
                kind: "cg",
                variants: [{ id: "cg.v", name: "One", imageAssetId: "asset-shared" }],
            }),
            artwork({
                id: "recall",
                kind: "scene",
                scene: { storyId: "story-1", sceneId: "scene-7" },
                variants: [
                    { id: "recall.v.1", name: "One", imageAssetId: null },
                    { id: "recall.v.2", name: "Two", imageAssetId: null },
                ],
            }),
            artwork({
                id: "album",
                kind: "music",
                variants: [
                    { id: "album.v.1", name: "Opening", imageAssetId: null, audioAssetId: "asset-op" },
                    { id: "album.v.2", name: "Ending", imageAssetId: null, audioAssetId: "asset-ed" },
                ],
            }),
            artwork({
                id: "vo",
                kind: "voice",
                variants: [
                    { id: "vo.v.1", name: "Greeting", imageAssetId: null, voiceUnitId: "text-1" },
                    { id: "vo.v.2", name: "Loose", imageAssetId: null, audioAssetId: "asset-loose" },
                ],
            }),
        ],
    }).items;

    it("takes a recollection whole and a track one at a time", () => {
        // A scene is the finest thing a recollection has; a track is not, and an album that jumped
        // from 0 to 12 collected on its first track would be reporting progress nobody made.
        expect(collectSceneVariantIds(items, "scene-7")).toEqual(["recall.v.1", "recall.v.2"]);
        expect(collectAudioAssetVariantIds(items, "asset-op")).toEqual(["album.v.1"]);
    });

    it("reaches a voice line authored as a loose clip", () => {
        expect(collectAudioAssetVariantIds(items, "asset-loose")).toEqual(["vo.v.2"]);
        expect(collectVoiceUnitVariantIds(items, "text-1")).toEqual(["vo.v.1"]);
    });

    it("never collects a CG", () => {
        // CG is the one column with no moment of its own, so it stays on Unlock Gallery. An audio
        // matcher that walked every kind would collect it from a sound effect sharing the id.
        expect(collectAudioAssetVariantIds(items, "asset-shared")).toEqual([]);
        expect(collectSceneVariantIds(items, "cg")).toEqual([]);
    });

    it("collects nothing for an empty or unknown key", () => {
        expect(collectSceneVariantIds(items, "   ")).toEqual([]);
        expect(collectAudioAssetVariantIds(items, "")).toEqual([]);
        expect(collectVoiceUnitVariantIds(items, "text-missing")).toEqual([]);
    });
});
