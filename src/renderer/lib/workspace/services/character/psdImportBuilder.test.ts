import { describe, expect, it } from "vitest";
import type { PsdLayerNode } from "@shared/types/psdImport";
import { flattenLeaves, planImport, toBakeTargets } from "@shared/utils/psdLayerPlan";
import { CharacterAppearance, emptyAppearance } from "./CharacterAppearance";
import { applyPsdPlan, nameBakeTargets, psdRefreshTargets, summarisePlan } from "./psdImportBuilder";

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
function assets(suffix = ""): (path: string[]) => string {
    return path => `asset:${path.join("/")}${suffix}`;
}

function layered(): CharacterAppearance {
    return new CharacterAppearance(emptyAppearance("layered"));
}

describe("applyPsdPlan", () => {
    it("builds a constant layer and an axis-driven layer from the default mapping", () => {
        const appearance = layered();
        applyPsdPlan(appearance, planOf(), assets());

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
        applyPsdPlan(appearance, planOf(), assets());
        const axis = appearance.getAxes()[0];
        const options = appearance.getLayers()[1].options ?? {};
        expect(Object.keys(options).sort()).toEqual(axis.tags.map(tag => tag.id).sort());
        expect(Object.values(options).every(Boolean)).toBe(true);
    });

    it("reports where every PSD layer landed", () => {
        const appearance = layered();
        const slots = applyPsdPlan(appearance, planOf(), assets());
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
        const slots = applyPsdPlan(appearance, planOf(), assets());
        appearance.setPsdFingerprint({
            fileName: "sheet.psd", width: 4, height: 4, slots, importedAt: 1,
        });
        return appearance;
    }

    it("refreshes the art in place and leaves the author's renames alone", () => {
        const appearance = imported();
        appearance.rename(appearance.getAxes()[0], "表情");
        appearance.rename(appearance.getLayers()[0], "躯干");

        applyPsdPlan(appearance, planOf(), assets("-v2"));

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
        applyPsdPlan(appearance, planOf(), assets("-v2"));
        expect(appearance.getLayers().map(layer => layer.name)).toEqual(["Mood", "Body"]);
    });

    it("adds a tag the PSD has grown without disturbing the others", () => {
        const appearance = imported();
        const grown = sheet();
        (grown[1].children as PsdLayerNode[]).push(leaf("Sad", ["Mood", "Sad"]));

        applyPsdPlan(appearance, planOf(grown), assets("-v2"));

        expect(appearance.getAxes()).toHaveLength(1);
        expect(appearance.getAxes()[0].tags.map(tag => tag.name)).toEqual(["Happy", "Angry", "Sad"]);
        // The invariant still holds after the axis grew.
        expect(Object.keys(appearance.getLayers()[1].options ?? {})).toHaveLength(3);
    });

    it("builds fresh when the author has deleted what the fingerprint pointed at", () => {
        const appearance = imported();
        appearance.removeAxis(appearance.getAxes()[0].id);
        applyPsdPlan(appearance, planOf(), assets("-v2"));
        // The stale slots are misses, so the axis comes back rather than the import silently
        // dropping the group.
        expect(appearance.getAxes().map(axis => axis.name)).toEqual(["Mood"]);
    });

    it("does not create a second set of layers", () => {
        const appearance = imported();
        applyPsdPlan(appearance, planOf(), assets("-v2"));
        expect(appearance.getLayers()).toHaveLength(2);
    });
});

describe("summarisePlan", () => {
    it("counts what is new against what will be refreshed", () => {
        const appearance = layered();
        expect(summarisePlan(appearance, planOf())).toEqual({ created: 3, refreshed: 0 });

        const slots = applyPsdPlan(appearance, planOf(), assets());
        appearance.setPsdFingerprint({ fileName: "sheet.psd", width: 4, height: 4, slots, importedAt: 1 });
        expect(summarisePlan(appearance, planOf())).toEqual({ created: 0, refreshed: 3 });
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
        const slots = applyPsdPlan(appearance, planOf(), assets());
        appearance.setPsdFingerprint({ fileName: "sheet.psd", width: 4, height: 4, slots, importedAt: 1 });
        return appearance;
    }

    it("answers the image the last import put in each slot", () => {
        expect(psdRefreshTargets(imported(), planOf(), BAKE_NAMES, noNames)).toEqual(new Map([
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

        const targets = psdRefreshTargets(appearance, planOf(grown), BAKE_NAMES, noNames);
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

        const targets = psdRefreshTargets(appearance, planOf(), BAKE_NAMES, id => names[id] ?? null);
        expect(targets).toEqual(new Map([["Body", "asset:Body"], ["Mood/Happy", "asset:Mood/Happy"]]));

        // An import once numbered its files, and the library named the images after them.
        names["asset:Mood/Angry"] = "002-Alice_Mood_Angry.png";
        expect(psdRefreshTargets(appearance, planOf(), BAKE_NAMES, id => names[id] ?? null).get("Mood/Angry"))
            .toBe("asset:Mood/Angry");
    });

    it("answers nothing for a first import", () => {
        expect(psdRefreshTargets(layered(), planOf(), BAKE_NAMES, noNames).size).toBe(0);
    });
});
