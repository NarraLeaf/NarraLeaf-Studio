import { describe, expect, it } from "vitest";
import type { PsdLayerNode, PsdLayerReference } from "@shared/types/psdImport";
import { flattenLeaves, planImport, psdLayerKey, toBakeTargets } from "@shared/utils/psdLayerPlan";
import { CharacterAppearance, emptyAppearance } from "./CharacterAppearance";
import { nameBakeTargets, preparePsdImport } from "./psdImportBuilder";

function leaf(name: string, path: string[], extra: Partial<PsdLayerNode> = {}): PsdLayerNode {
    return {
        path, name,
        bounds: { left: 0, top: 0, right: 4, bottom: 4 },
        blendMode: "normal", opacity: 1, hidden: false, clipping: false,
        ...extra,
    };
}

/** A body layer plus a Mood group of two. */
function sheet(): PsdLayerNode[] {
    return [
        leaf("Body", ["Body"]),
        {
            ...leaf("Mood", ["Mood"]),
            bounds: undefined,
            children: [leaf("Happy", ["Mood", "Happy"]), leaf("Angry", ["Mood", "Angry"])],
        },
    ];
}

function planOf(nodes: PsdLayerNode[] = sheet()) {
    return planImport(flattenLeaves(nodes), {});
}

/** Stand-in for the assets the bake produced: one id per layer path. */
function assets(suffix = ""): (ref: PsdLayerReference) => string {
    return ref => `asset:${ref.path.join("/")}${suffix}`;
}

function layered(): CharacterAppearance {
    return new CharacterAppearance(emptyAppearance("layered"));
}

describe("applyPsdPlan", () => {
    it("builds a constant layer and an axis-driven layer from the default mapping", () => {
        const appearance = layered();
        preparePsdImport(appearance, planOf()).apply(assets());

        expect(appearance.getAxes().map(axis => axis.name)).toEqual(["Mood"]);
        expect(appearance.getAxes()[0].tags.map(tag => tag.name)).toEqual(["Happy", "Angry"]);

        const layers = appearance.getLayers();
        expect(layers.map(layer => layer.name)).toEqual(["Body", "Mood"]);
        expect(layers[0].axisId).toBeNull();
        expect(layers[0].assetId).toBe("asset:Body");
        expect(layers[1].axisId).toBe(appearance.getAxes()[0].id);
    });

    it("gives the bound layer an entry for every tag of its axis", () => {
        // The engine identifies a group by its tag set, so a layer offering only some of an axis's
        // tags would declare a second, colliding group.
        const appearance = layered();
        preparePsdImport(appearance, planOf()).apply(assets());
        const axis = appearance.getAxes()[0];
        const options = appearance.getLayers()[1].options ?? {};
        expect(Object.keys(options).sort()).toEqual(axis.tags.map(tag => tag.id).sort());
        expect(Object.values(options).every(Boolean)).toBe(true);
    });

    it("reports where every PSD layer landed", () => {
        const appearance = layered();
        const slots = preparePsdImport(appearance, planOf()).apply(assets());
        const axis = appearance.getAxes()[0];
        const moodLayer = appearance.getLayers()[1];

        expect(slots).toContainEqual({ path: ["Body"], layerId: appearance.getLayers()[0].id, assetId: "asset:Body" });
        expect(slots).toContainEqual({
            path: ["Mood", "Happy"],
            layerId: moodLayer.id,
            tagId: axis.tags[0].id,
            assetId: "asset:Mood/Happy",
        });
    });
});

describe("re-importing the same PSD", () => {
    /** Import once, record the fingerprint, then hand back the appearance the author has edited. */
    function imported(): CharacterAppearance {
        const appearance = layered();
        const slots = preparePsdImport(appearance, planOf()).apply(assets());
        appearance.setPsdFingerprint({
            fileName: "sheet.psd", width: 4, height: 4, slots, importedAt: 1,
        });
        return appearance;
    }

    it("refreshes the art in place and leaves the author's renames alone", () => {
        const appearance = imported();
        appearance.rename(appearance.getAxes()[0], "表情");
        appearance.rename(appearance.getLayers()[0], "躯干");

        preparePsdImport(appearance, planOf()).apply(assets("-v2"));

        expect(appearance.getAxes()).toHaveLength(1);
        expect(appearance.getAxes()[0].name).toBe("表情");
        expect(appearance.getLayers().map(layer => layer.name)).toEqual(["躯干", "Mood"]);
        expect(appearance.getLayers()[0].assetId).toBe("asset:Body-v2");
        const options = appearance.getLayers()[1].options ?? {};
        expect(Object.values(options)).toEqual(["asset:Mood/Happy-v2", "asset:Mood/Angry-v2"]);
    });

    it("keeps a layer the author reordered where they put it", () => {
        const appearance = imported();
        appearance.moveLayer(appearance.getLayers()[1].id, 0);
        preparePsdImport(appearance, planOf()).apply(assets("-v2"));
        expect(appearance.getLayers().map(layer => layer.name)).toEqual(["Mood", "Body"]);
    });

    it("adds a tag the PSD has grown without disturbing the others", () => {
        const appearance = imported();
        const grown = sheet();
        (grown[1].children as PsdLayerNode[]).push(leaf("Sad", ["Mood", "Sad"]));

        preparePsdImport(appearance, planOf(grown)).apply(assets("-v2"));

        expect(appearance.getAxes()).toHaveLength(1);
        expect(appearance.getAxes()[0].tags.map(tag => tag.name)).toEqual(["Happy", "Angry", "Sad"]);
        // The invariant still holds after the axis grew.
        expect(Object.keys(appearance.getLayers()[1].options ?? {})).toHaveLength(3);
    });

    it("builds fresh when the author has deleted what the fingerprint pointed at", () => {
        const appearance = imported();
        appearance.removeAxis(appearance.getAxes()[0].id);
        preparePsdImport(appearance, planOf()).apply(assets("-v2"));
        // The stale slots are misses, so the axis comes back rather than the import silently
        // dropping the group.
        expect(appearance.getAxes().map(axis => axis.name)).toEqual(["Mood"]);
    });

    it("does not create a second set of layers", () => {
        const appearance = imported();
        preparePsdImport(appearance, planOf()).apply(assets("-v2"));
        expect(appearance.getLayers()).toHaveLength(2);
    });
});

describe("re-importing same-named PSD layers", () => {
    const duplicates = (ids: number[]) => planOf(ids.map((sourceId, occurrence) =>
        leaf("Body", ["Body"], { sourceId, occurrence })));

    it("reconnects older repeated path records to their original slots in order", () => {
        const appearance = layered();
        const first = appearance.createLayer("first edited")!;
        const second = appearance.createLayer("second edited")!;
        appearance.setLayerAsset(first.id, "asset-first");
        appearance.setLayerAsset(second.id, "asset-second");
        appearance.setPsdFingerprint({
            fileName: "sheet.psd", width: 4, height: 4, importedAt: 1,
            slots: [
                { path: ["Body"], layerId: first.id, assetId: "asset-first" },
                { path: ["Body"], layerId: second.id, assetId: "asset-second" },
            ],
        });
        const plan = duplicates([11, 22]);
        expect(preparePsdImport(appearance, plan).summary).toEqual({ created: 0, refreshed: 2 });
        expect(preparePsdImport(appearance, plan).refreshTargets(new Map(), () => null)).toEqual(new Map([
            [psdLayerKey({ path: ["Body"], occurrence: 0 }), "asset-first"],
            [psdLayerKey({ path: ["Body"], occurrence: 1 }), "asset-second"],
        ]));
        const slots = preparePsdImport(appearance, plan).apply(ref => `new-${ref.sourceId}`);
        expect(slots.map(slot => slot.layerId)).toEqual([first.id, second.id]);
        expect(appearance.getLayers().map(layer => [layer.name, layer.assetId])).toEqual([
            ["first edited", "new-11"], ["second edited", "new-22"],
        ]);
    });

    it("reconnects an older slot when an earlier same-named layer is hidden", () => {
        const appearance = layered();
        const existing = appearance.createLayer("edited")!;
        appearance.setLayerAsset(existing.id, "original-image");
        appearance.setPsdFingerprint({
            fileName: "sheet.psd", width: 4, height: 4, importedAt: 1,
            slots: [{ path: ["Body"], layerId: existing.id, assetId: "original-image" }],
        });
        const plan = planOf([
            leaf("Body", ["Body"], { sourceId: 11, occurrence: 0, hidden: true }),
            leaf("Body", ["Body"], { sourceId: 22, occurrence: 1 }),
        ]);
        expect(preparePsdImport(appearance, plan).summary).toEqual({ created: 0, refreshed: 1 });
        expect(preparePsdImport(appearance, plan).refreshTargets(new Map(), () => null).get(psdLayerKey({ path: ["Body"], occurrence: 1 })))
            .toBe("original-image");
        expect(preparePsdImport(appearance, plan).apply(() => "updated")[0].layerId).toBe(existing.id);
    });

    it("uses PSD layer ids to reconnect after the siblings change order", () => {
        let appearance = layered();
        const slots = preparePsdImport(appearance, duplicates([11, 22])).apply(ref => `asset-${ref.sourceId}`);
        appearance.setPsdFingerprint({ fileName: "sheet.psd", width: 4, height: 4, slots, importedAt: 1 });
        appearance = new CharacterAppearance(JSON.parse(JSON.stringify(appearance.toJSON())));
        const [first, second] = appearance.getLayers();
        appearance.rename(first, "first edited");
        const reordered = duplicates([22, 11]);

        expect(preparePsdImport(appearance, reordered).refreshTargets(new Map(), () => null)).toEqual(new Map([
            [psdLayerKey({ path: ["Body"], occurrence: 0 }), "asset-22"],
            [psdLayerKey({ path: ["Body"], occurrence: 1 }), "asset-11"],
        ]));
        const updated = preparePsdImport(appearance, reordered).apply(ref => `updated-${ref.sourceId}`);
        expect(updated.map(slot => slot.layerId)).toEqual([second.id, first.id]);
        expect(appearance.getLayers().map(layer => [layer.name, layer.assetId])).toEqual([
            ["first edited", "updated-11"], ["Body", "updated-22"],
        ]);
    });

    it("reserves the known id before reconnecting an id-less sibling after a reorder", () => {
        const appearance = layered();
        const original = planOf([
            leaf("Body", ["Body"], { occurrence: 0, sourceId: 11 }),
            leaf("Body", ["Body"], { occurrence: 1 }),
        ]);
        const slots = preparePsdImport(appearance, original).apply(ref => ref.sourceId ? "known" : "without-id");
        appearance.setPsdFingerprint({ fileName: "sheet.psd", width: 4, height: 4, slots, importedAt: 1 });
        const reordered = planOf([
            leaf("Body", ["Body"], { occurrence: 0 }),
            leaf("Body", ["Body"], { occurrence: 1, sourceId: 11 }),
        ]);
        const prepared = preparePsdImport(appearance, reordered);

        expect(prepared.summary).toEqual({ created: 0, refreshed: 2 });
        expect(prepared.refreshTargets(new Map(), () => null)).toEqual(new Map([
            ["Body~20", "without-id"], ["Body~21", "known"],
        ]));
        const updated = prepared.apply(ref => ref.sourceId ? "known-new" : "without-id-new");
        expect(updated.map(slot => slot.layerId)).toEqual([slots[1].layerId, slots[0].layerId]);
    });

    it("reconnects same-named layers without ids by their recorded order", () => {
        const appearance = layered();
        const plan = planOf([
            leaf("Body", ["Body"], { occurrence: 0 }),
            leaf("Body", ["Body"], { occurrence: 1 }),
        ]);
        const slots = preparePsdImport(appearance, plan).apply(ref => `asset-${ref.occurrence}`);
        appearance.setPsdFingerprint({ fileName: "sheet.psd", width: 4, height: 4, slots, importedAt: 1 });
        const prepared = preparePsdImport(appearance, plan);

        expect(prepared.refreshTargets(new Map(), () => null)).toEqual(new Map([
            ["Body~20", "asset-0"], ["Body~21", "asset-1"],
        ]));
        expect(prepared.apply(ref => `new-${ref.occurrence}`).map(slot => slot.layerId))
            .toEqual(slots.map(slot => slot.layerId));
    });

    it("does not move an id-less slot to a different occurrence when visibility changes", () => {
        const appearance = layered();
        const original = planOf([
            leaf("Body", ["Body"], { occurrence: 0, hidden: true }),
            leaf("Body", ["Body"], { occurrence: 1 }),
        ]);
        const slots = preparePsdImport(appearance, original).apply(() => "second-image");
        appearance.setPsdFingerprint({ fileName: "sheet.psd", width: 4, height: 4, slots, importedAt: 1 });
        const changedVisibility = planOf([
            leaf("Body", ["Body"], { occurrence: 0 }),
            leaf("Body", ["Body"], { occurrence: 1, hidden: true }),
        ]);

        expect(preparePsdImport(appearance, changedVisibility).summary).toEqual({ created: 1, refreshed: 0 });
        const onlyOne = planOf([leaf("Body", ["Body"])]);
        expect(preparePsdImport(appearance, onlyOne).summary).toEqual({ created: 1, refreshed: 0 });
        expect(appearance.getLayer(slots[0].layerId)?.assetId).toBe("second-image");
    });

    it("keeps a unique name as the reconnect key when its PSD id changes", () => {
        const appearance = layered();
        const old = preparePsdImport(appearance, planOf([leaf("Body", ["Body"], { sourceId: 11 })]))
            .apply(() => "asset-11");
        appearance.setPsdFingerprint({ fileName: "sheet.psd", width: 4, height: 4, slots: old, importedAt: 1 });
        const prepared = preparePsdImport(appearance, planOf([leaf("Body", ["Body"], { sourceId: 22 })]));

        expect(prepared.summary).toEqual({ created: 0, refreshed: 1 });
        expect(prepared.refreshTargets(new Map(), () => null)).toEqual(new Map([["Body", "asset-11"]]));
        expect(prepared.apply(() => "updated")[0].layerId).toBe(old[0].layerId);
    });

    it("does not reuse one old slot twice when an old fingerprint points both paths at it", () => {
        const appearance = layered();
        const old = appearance.createLayer("kept")!;
        appearance.setPsdFingerprint({
            fileName: "sheet.psd", width: 4, height: 4, importedAt: 1,
            slots: [{ path: ["Body"], layerId: old.id }, { path: ["Body"], layerId: old.id }],
        });
        const plan = duplicates([11, 22]);
        expect(preparePsdImport(appearance, plan).summary).toEqual({ created: 1, refreshed: 1 });
        const slots = preparePsdImport(appearance, plan).apply(ref => `asset-${ref.sourceId}`);
        expect(new Set(slots.map(slot => slot.layerId)).size).toBe(2);
        expect(appearance.getLayers().map(layer => layer.name)).toEqual(["kept", "Body"]);
    });

    it("does not refresh an author's replacement image or a different PSD layer id", () => {
        const appearance = layered();
        const slots = preparePsdImport(appearance, duplicates([11, 22])).apply(ref => `asset-${ref.sourceId}`);
        appearance.setPsdFingerprint({ fileName: "sheet.psd", width: 4, height: 4, slots, importedAt: 1 });
        appearance.setLayerAsset(slots[0].layerId, "author-image");
        const plan = duplicates([11, 33]);
        const prepared = preparePsdImport(appearance, plan);
        expect(prepared.refreshTargets(new Map(), () => null).size).toBe(0);
        expect(prepared.summary).toEqual({ created: 1, refreshed: 1 });
        const updated = prepared.apply(ref => `new-${ref.sourceId}`);
        expect(updated[0].layerId).toBe(slots[0].layerId);
        expect(updated[0].assetId).toBe("new-11");
    });

    it("does not assign a removed sibling's slot to a different layer that kept its name", () => {
        const appearance = layered();
        const slots = preparePsdImport(appearance, duplicates([11, 22])).apply(ref => `asset-${ref.sourceId}`);
        appearance.setPsdFingerprint({ fileName: "sheet.psd", width: 4, height: 4, slots, importedAt: 1 });
        const replacement = planOf([leaf("Body", ["Body"], { sourceId: 33 })]);
        expect(preparePsdImport(appearance, replacement).summary).toEqual({ created: 1, refreshed: 0 });
        expect(preparePsdImport(appearance, replacement).refreshTargets(new Map(), () => null).size).toBe(0);
    });

    it("does not refresh a removed layer when its hidden namesake becomes the only layer", () => {
        const appearance = layered();
        const original = planOf([
            leaf("Body", ["Body"], { occurrence: 0, sourceId: 11 }),
            leaf("Body", ["Body"], { occurrence: 1, sourceId: 22, hidden: true }),
        ]);
        const slots = preparePsdImport(appearance, original).apply(() => "asset-11");
        appearance.setPsdFingerprint({ fileName: "sheet.psd", width: 4, height: 4, slots, importedAt: 1 });
        const remaining = planOf([leaf("Body", ["Body"], { sourceId: 22 })]);

        expect(preparePsdImport(appearance, remaining).summary).toEqual({ created: 1, refreshed: 0 });
        expect(preparePsdImport(appearance, remaining).refreshTargets(new Map(), () => null).size).toBe(0);
        const updated = preparePsdImport(appearance, remaining).apply(() => "asset-22");
        expect(updated[0].layerId).not.toBe(slots[0].layerId);
        expect(appearance.getLayer(slots[0].layerId)?.assetId).toBe("asset-11");
        expect(appearance.getLayer(updated[0].layerId)?.assetId).toBe("asset-22");
    });

    it("keeps both ids distinct after a hidden namesake was the only prior import", () => {
        const appearance = layered();
        const original = planOf([
            leaf("Body", ["Body"], { occurrence: 0, sourceId: 11 }),
            leaf("Body", ["Body"], { occurrence: 1, sourceId: 22, hidden: true }),
        ]);
        const old = preparePsdImport(appearance, original).apply(() => "asset-11");
        appearance.setPsdFingerprint({ fileName: "sheet.psd", width: 4, height: 4, slots: old, importedAt: 1 });
        const remaining = planOf([leaf("Body", ["Body"], { sourceId: 22 })]);
        const next = preparePsdImport(appearance, remaining).apply(() => "asset-22");
        appearance.setPsdFingerprint({ fileName: "sheet.psd", width: 4, height: 4, slots: next, importedAt: 2 });
        const restored = preparePsdImport(appearance, duplicates([11, 22]));

        expect(restored.summary).toEqual({ created: 1, refreshed: 1 });
        expect(restored.refreshTargets(new Map(), () => null)).toEqual(new Map([["Body~21", "asset-22"]]));
        const slots = restored.apply(ref => `new-${ref.sourceId}`);
        expect(slots[0].layerId).not.toBe(old[0].layerId);
        expect(slots[1].layerId).toBe(next[0].layerId);
        expect(appearance.getLayer(old[0].layerId)?.assetId).toBe("asset-11");
    });

    it("records separate tag identities when same-named layers are in one group", () => {
        const appearance = layered();
        const group = [{
            ...leaf("Mood", ["Mood"]),
            children: [
                leaf("Happy", ["Mood", "Happy"], { occurrence: 0, sourceId: 11 }),
                leaf("Happy", ["Mood", "Happy"], { occurrence: 1, sourceId: 22 }),
            ],
        }];
        const plan = planOf(group);
        const slots = preparePsdImport(appearance, plan).apply(ref => `asset-${ref.sourceId}`);
        appearance.setPsdFingerprint({ fileName: "sheet.psd", width: 4, height: 4, slots, importedAt: 1 });
        expect(new Set(slots.map(slot => slot.tagId)).size).toBe(2);
        expect(Object.values(appearance.getLayers()[0].options ?? {})).toEqual(["asset-11", "asset-22"]);
        const updated = preparePsdImport(appearance, plan).apply(ref => `updated-${ref.sourceId}`);
        expect(updated.map(slot => slot.tagId)).toEqual(slots.map(slot => slot.tagId));
        expect(Object.values(appearance.getLayers()[0].options ?? {})).toEqual(["updated-11", "updated-22"]);
    });

    it("keeps an id-less tag separate from its known-id sibling after a reorder", () => {
        const appearance = layered();
        const group = (children: PsdLayerNode[]) => planOf([{ ...leaf("Mood", ["Mood"]), children }]);
        const original = group([
            leaf("Happy", ["Mood", "Happy"], { occurrence: 0, sourceId: 11 }),
            leaf("Happy", ["Mood", "Happy"], { occurrence: 1 }),
        ]);
        const slots = preparePsdImport(appearance, original).apply(ref => ref.sourceId ? "known" : "without-id");
        appearance.setPsdFingerprint({ fileName: "sheet.psd", width: 4, height: 4, slots, importedAt: 1 });
        const reordered = group([
            leaf("Happy", ["Mood", "Happy"], { occurrence: 0 }),
            leaf("Happy", ["Mood", "Happy"], { occurrence: 1, sourceId: 11 }),
        ]);
        const prepared = preparePsdImport(appearance, reordered);

        expect(prepared.summary).toEqual({ created: 0, refreshed: 2 });
        expect(prepared.refreshTargets(new Map(), () => null)).toEqual(new Map([
            ["Mood/Happy~20", "without-id"], ["Mood/Happy~21", "known"],
        ]));
        const updated = prepared.apply(ref => ref.sourceId ? "new-known" : "new-without-id");
        expect(updated.map(slot => slot.tagId)).toEqual([slots[1].tagId, slots[0].tagId]);
        expect(appearance.getLayer(slots[0].layerId)?.options).toMatchObject({
            [slots[0].tagId!]: "new-known", [slots[1].tagId!]: "new-without-id",
        });
    });
});

describe("old fingerprints with literal slashes", () => {
    const slashPlan = () => planOf([
        leaf("Mood/Happy", ["Mood/Happy"]),
        { ...leaf("Mood", ["Mood"]), children: [leaf("Happy", ["Mood", "Happy"])] },
    ]);

    it("reconnects literal slashes and group separators independently", () => {
        const appearance = layered();
        const slash = appearance.createLayer("slash")!;
        const group = appearance.createLayer("group")!;
        appearance.setLayerAsset(slash.id, "slash-image");
        appearance.setLayerAsset(group.id, "group-image");
        appearance.setPsdFingerprint({
            fileName: "sheet.psd", width: 4, height: 4, importedAt: 1,
            slots: [
                { path: ["Mood/Happy"], layerId: slash.id, assetId: "slash-image" },
                { path: ["Mood", "Happy"], layerId: group.id, assetId: "group-image" },
            ],
        });
        const prepared = preparePsdImport(appearance, slashPlan());
        expect(prepared.refreshTargets(new Map(), () => null)).toEqual(new Map([
            ["Mood~1Happy", "slash-image"], ["Mood/Happy", "group-image"],
        ]));
        expect(prepared.apply(ref => `new-${psdLayerKey(ref)}`).map(slot => slot.layerId)).toEqual([slash.id, group.id]);
    });

    it("does not reuse one destination for two different paths", () => {
        const appearance = layered();
        const old = appearance.createLayer("old")!;
        appearance.setPsdFingerprint({
            fileName: "sheet.psd", width: 4, height: 4, importedAt: 1,
            slots: [{ path: ["Mood/Happy"], layerId: old.id }, { path: ["Mood", "Happy"], layerId: old.id }],
        });
        const prepared = preparePsdImport(appearance, slashPlan());
        expect(prepared.summary).toEqual({ created: 1, refreshed: 1 });
        expect(new Set(prepared.apply(ref => `new-${psdLayerKey(ref)}`).map(slot => slot.layerId)).size).toBe(2);
    });
});

describe("summarisePlan", () => {
    it("counts what is new against what will be refreshed", () => {
        const appearance = layered();
        expect(preparePsdImport(appearance, planOf()).summary).toEqual({ created: 3, refreshed: 0 });

        const slots = preparePsdImport(appearance, planOf()).apply(assets());
        appearance.setPsdFingerprint({ fileName: "sheet.psd", width: 4, height: 4, slots, importedAt: 1 });
        expect(preparePsdImport(appearance, planOf()).summary).toEqual({ created: 0, refreshed: 3 });
    });
});

describe("nameBakeTargets", () => {
    it("names a file after the character, the layer and the tag", () => {
        const plan = planOf();
        const named = nameBakeTargets(toBakeTargets(plan), plan, "Alice");
        expect(named.map(target => target.name)).toEqual(["Alice_Body", "Alice_Mood_Happy", "Alice_Mood_Angry"]);
    });

    it("falls back to a usable prefix when the character has no name yet", () => {
        const plan = planOf();
        expect(nameBakeTargets(toBakeTargets(plan), plan, "  ")[0].name).toBe("character_Body");
    });
});

/**
 * Which images a re-import writes its layers into rather than importing a second file beside them.
 * Two imports of a six-layer sheet used to leave twelve images in the library, the first six linked
 * to nothing.
 */
describe("psdRefreshTargets", () => {
    const BAKE_NAMES = new Map([["Body", "Alice_Body"], ["Mood/Happy", "Alice_Mood_Happy"], ["Mood/Angry", "Alice_Mood_Angry"]]);
    const noNames = () => null;

    function imported(): CharacterAppearance {
        const appearance = layered();
        const slots = preparePsdImport(appearance, planOf()).apply(assets());
        appearance.setPsdFingerprint({ fileName: "sheet.psd", width: 4, height: 4, slots, importedAt: 1 });
        return appearance;
    }

    it("answers the image the last import put in each slot", () => {
        expect(preparePsdImport(imported(), planOf()).refreshTargets(BAKE_NAMES, noNames)).toEqual(new Map([
            ["Body", "asset:Body"],
            ["Mood/Happy", "asset:Mood/Happy"],
            ["Mood/Angry", "asset:Mood/Angry"],
        ]));
    });

    it("leaves out a slot the author has pointed at an image of their own, and a layer new to the sheet", () => {
        const appearance = imported();
        appearance.setLayerAsset(appearance.getLayers()[0].id, "their-own");
        const grown = sheet();
        (grown[1].children as PsdLayerNode[]).push(leaf("Sad", ["Mood", "Sad"]));

        const targets = preparePsdImport(appearance, planOf(grown)).refreshTargets(BAKE_NAMES, noNames);
        expect(targets.has("Body")).toBe(false);
        expect(targets.has("Mood/Sad")).toBe(false);
        expect(targets.get("Mood/Happy")).toBe("asset:Mood/Happy");
    });

    it("recognises an older import's images by the name the library gave them", () => {
        // A fingerprint written before it recorded the images: slots with no asset id.
        const appearance = imported();
        const fingerprint = appearance.getPsdFingerprint()!;
        appearance.setPsdFingerprint({ ...fingerprint, slots: fingerprint.slots.map(({ assetId: _dropped, ...slot }) => slot) });
        const names: Record<string, string> = {
            "asset:Body": "Alice_Body.png",
            "asset:Mood/Happy": "Alice_Mood_Happy-1.png",
            "asset:Mood/Angry": "Angry, drawn by hand.png",
        };

        const targets = preparePsdImport(appearance, planOf()).refreshTargets(BAKE_NAMES, id => names[id] ?? null);
        expect(targets).toEqual(new Map([["Body", "asset:Body"], ["Mood/Happy", "asset:Mood/Happy"]]));

        // An import once numbered its files, and the library named the images after them.
        names["asset:Mood/Angry"] = "002-Alice_Mood_Angry.png";
        expect(preparePsdImport(appearance, planOf()).refreshTargets(BAKE_NAMES, id => names[id] ?? null).get("Mood/Angry"))
            .toBe("asset:Mood/Angry");
    });

    it("answers nothing for a first import", () => {
        expect(preparePsdImport(layered(), planOf()).refreshTargets(BAKE_NAMES, noNames).size).toBe(0);
    });
});
