import { describe, expect, it } from "vitest";
import { applyPackDelta, diffPack, PACK_DELTA_VERSION } from "./packDelta";

/**
 * Composing patches, which is the whole reason a delta exists.
 *
 * Every case here is two patches made against the same build, because that is the shape a player
 * ends up with: an episode and a language pack, downloaded separately, neither aware of the other.
 * A patch that carried the whole pack made the second one erase the first, and it did so silently.
 */

type Pack = Record<string, unknown>;

const scene = (id: string, text: string) => ({ id, blocks: [{ id: `${id}-1`, text }] });

function basePack(): Pack {
    return {
        schemaVersion: 2,
        generatedAt: "2026-01-01T00:00:00.000Z",
        runtimeVersion: "0.7.0",
        assets: { items: {}, modelBundles: ["model-a"] },
        plugins: [],
        bundle: {
            storyHash: "base",
            storyLibrary: {
                documents: {
                    "story-1": {
                        id: "story-1",
                        chapters: [{ id: "ch-1", name: "One", sceneIds: ["sc-1", "sc-2"] }],
                        scenes: { "sc-1": scene("sc-1", "hello"), "sc-2": scene("sc-2", "world") },
                    },
                },
                characters: [{ id: "chr-1", name: "Ann" }],
            },
            localization: { tables: { ja: { "unit-1": "こんにちは" } } },
            ui: { uidoc: { surfaces: [{ id: "srf-1", name: "Title" }], elements: { "el-1": { id: "el-1", kind: "text" } } } },
        },
    };
}

/** Apply patches in the order a game would, lowest layer first. */
function compose(base: Pack, ...patches: Pack[]): Pack {
    const composed = JSON.parse(JSON.stringify(base)) as Pack;
    for (const patch of patches) {
        applyPackDelta(composed, diffPack(base, patch));
    }
    return composed;
}

/** One edit to a deep copy of the base, the way a patch build produces its pack. */
function edited(edit: (pack: Pack) => void): Pack {
    const pack = basePack();
    edit(pack);
    return pack;
}

const documents = (pack: Pack) => (pack.bundle as Pack).storyLibrary as Pack;
const scenesOf = (pack: Pack, storyId: string) =>
    ((documents(pack).documents as Pack)[storyId] as Pack).scenes as Record<string, { blocks: { text: string }[] }>;

describe("diffPack", () => {
    it("says nothing about two packs that agree", () => {
        expect(diffPack(basePack(), basePack()).ops).toEqual([]);
    });

    it("ignores the order the keys happened to be written in", () => {
        const reordered = JSON.parse(JSON.stringify(basePack())) as Pack;
        const bundle = reordered.bundle as Pack;
        const { storyHash, ...rest } = bundle;
        reordered.bundle = { ...rest, storyHash };
        expect(diffPack(basePack(), reordered).ops).toEqual([]);
    });

    it("addresses a changed scene rather than the story that holds it", () => {
        const next = edited(pack => {
            scenesOf(pack, "story-1")["sc-2"] = scene("sc-2", "moon") as never;
        });
        const delta = diffPack(basePack(), next);
        expect(delta.version).toBe(PACK_DELTA_VERSION);
        expect(delta.ops.map(op => op.at.join("/"))).toContain("bundle/storyLibrary/documents/story-1/scenes/sc-2");
        // The story itself is never carried whole, or the second patch to touch it would take the
        // first one's scenes back out.
        expect(delta.ops.some(op => op.at.join("/") === "bundle/storyLibrary/documents/story-1")).toBe(false);
    });
});

describe("composing two patches", () => {
    it("keeps both when they change different scenes of one story", () => {
        const first = edited(pack => {
            scenesOf(pack, "story-1")["sc-1"] = scene("sc-1", "first") as never;
        });
        const second = edited(pack => {
            scenesOf(pack, "story-1")["sc-2"] = scene("sc-2", "second") as never;
        });

        const composed = compose(basePack(), first, second);
        expect(scenesOf(composed, "story-1")["sc-1"].blocks[0].text).toBe("first");
        expect(scenesOf(composed, "story-1")["sc-2"].blocks[0].text).toBe("second");
    });

    it("keeps both when they add different scenes", () => {
        const first = edited(pack => {
            scenesOf(pack, "story-1")["sc-3"] = scene("sc-3", "third") as never;
        });
        const second = edited(pack => {
            scenesOf(pack, "story-1")["sc-4"] = scene("sc-4", "fourth") as never;
        });

        const composed = compose(basePack(), first, second);
        expect(Object.keys(scenesOf(composed, "story-1")).sort()).toEqual(["sc-1", "sc-2", "sc-3", "sc-4"]);
    });

    it("lets the later one win where they change the same scene", () => {
        const first = edited(pack => {
            scenesOf(pack, "story-1")["sc-1"] = scene("sc-1", "first") as never;
        });
        const second = edited(pack => {
            scenesOf(pack, "story-1")["sc-1"] = scene("sc-1", "second") as never;
        });

        expect(scenesOf(compose(basePack(), first, second), "story-1")["sc-1"].blocks[0].text).toBe("second");
        expect(scenesOf(compose(basePack(), second, first), "story-1")["sc-1"].blocks[0].text).toBe("first");
    });

    it("keeps an added language and an added scene from two separate patches", () => {
        const languagePack = edited(pack => {
            ((pack.bundle as Pack).localization as Pack).tables = {
                ja: { "unit-1": "こんにちは" },
                fr: { "unit-1": "bonjour" },
            };
        });
        const episode = edited(pack => {
            scenesOf(pack, "story-1")["sc-3"] = scene("sc-3", "third") as never;
        });

        const composed = compose(basePack(), languagePack, episode);
        const tables = ((composed.bundle as Pack).localization as Pack).tables as Record<string, unknown>;
        expect(Object.keys(tables).sort()).toEqual(["fr", "ja"]);
        expect(Object.keys(scenesOf(composed, "story-1"))).toContain("sc-3");
    });

    it("keeps a character each patch adds", () => {
        const first = edited(pack => {
            (documents(pack).characters as unknown[]).push({ id: "chr-2", name: "Bea" });
        });
        const second = edited(pack => {
            (documents(pack).characters as unknown[]).push({ id: "chr-3", name: "Cal" });
        });

        const composed = compose(basePack(), first, second);
        expect((documents(composed).characters as { id: string }[]).map(entry => entry.id))
            .toEqual(["chr-1", "chr-2", "chr-3"]);
    });

    it("keeps a page element each patch adds and lets the later one redraw a shared surface", () => {
        const first = edited(pack => {
            const uidoc = ((pack.bundle as Pack).ui as Pack).uidoc as Pack;
            (uidoc.elements as Pack)["el-2"] = { id: "el-2", kind: "image" };
        });
        const second = edited(pack => {
            const uidoc = ((pack.bundle as Pack).ui as Pack).uidoc as Pack;
            (uidoc.elements as Pack)["el-3"] = { id: "el-3", kind: "button" };
            (uidoc.surfaces as { id: string; name: string }[])[0].name = "Main menu";
        });

        const composed = compose(basePack(), first, second);
        const uidoc = ((composed.bundle as Pack).ui as Pack).uidoc as Pack;
        expect(Object.keys(uidoc.elements as Pack).sort()).toEqual(["el-1", "el-2", "el-3"]);
        expect((uidoc.surfaces as { name: string }[])[0].name).toBe("Main menu");
    });
});

describe("removals and order", () => {
    it("removes a scene the patch removed", () => {
        const next = edited(pack => {
            delete scenesOf(pack, "story-1")["sc-2"];
        });
        const composed = compose(basePack(), next);
        expect(Object.keys(scenesOf(composed, "story-1"))).toEqual(["sc-1"]);
    });

    it("removes a keyed list member", () => {
        const next = edited(pack => {
            documents(pack).characters = [];
        });
        const composed = compose(basePack(), next);
        expect(documents(composed).characters).toEqual([]);
    });

    it("states a new order only when one is meant, and appends what it does not name", () => {
        const reordered = edited(pack => {
            documents(pack).characters = [{ id: "chr-1", name: "Ann" }, { id: "chr-0", name: "Abe" }];
        });
        // Written the other way round, so only a stated order can put chr-0 last.
        const moved = edited(pack => {
            documents(pack).characters = [{ id: "chr-0", name: "Abe" }, { id: "chr-1", name: "Ann" }];
        });

        expect((documents(compose(basePack(), reordered)).characters as { id: string }[]).map(entry => entry.id))
            .toEqual(["chr-1", "chr-0"]);
        expect((documents(compose(basePack(), moved)).characters as { id: string }[]).map(entry => entry.id))
            .toEqual(["chr-0", "chr-1"]);
    });

    it("unions a plain id list", () => {
        const first = edited(pack => {
            (pack.assets as Pack).modelBundles = ["model-a", "model-b"];
        });
        const second = edited(pack => {
            (pack.assets as Pack).modelBundles = ["model-a", "model-c"];
        });
        const composed = compose(basePack(), first, second);
        expect(composed.assets).toEqual({ items: {}, modelBundles: ["model-a", "model-b", "model-c"] });
    });
});

describe("applying to a build the patch was not made for", () => {
    it("skips what it cannot address and reports it, leaving the rest applied", () => {
        const next = edited(pack => {
            scenesOf(pack, "story-1")["sc-1"] = scene("sc-1", "first") as never;
            ((pack.bundle as Pack).localization as Pack).tables = { ja: { "unit-1": "やあ" } };
        });
        const delta = diffPack(basePack(), next);

        const stranger = basePack();
        delete (documents(stranger).documents as Pack)["story-1"];
        const report = applyPackDelta(stranger, delta);

        expect(report.applied).toBeGreaterThan(0);
        expect(report.skipped.length).toBeGreaterThan(0);
        expect(report.touchedStory).toBe(false);
    });

    it("reports that the story moved, so a composed pack can restate its fingerprint", () => {
        const next = edited(pack => {
            scenesOf(pack, "story-1")["sc-1"] = scene("sc-1", "first") as never;
        });
        const composed = basePack();
        expect(applyPackDelta(composed, diffPack(basePack(), next)).touchedStory).toBe(true);
    });

    it("ignores a delta of a version it does not know", () => {
        const composed = basePack();
        expect(applyPackDelta(composed, { version: 99, ops: [{ op: "drop", at: ["assets"] }] }).applied).toBe(0);
        expect(composed.assets).toBeDefined();
    });
});
