import { describe, expect, it } from "vitest";
import type { LayeredAppearance } from "../character/types";
import {
    buildLayeredAppearance,
    checkLayeredSpec,
    describeLayered,
    layeredSpecFromNames,
    readLayeredSpec,
    selectionByName,
    type LayeredSpec,
} from "./layeredSpec";

/**
 * The agent's spelling of a layered character and its translation into the stored model: what is
 * refused before anything resolves, which ids survive a restatement, and how a set of files named by
 * convention becomes a stack.
 */

const MEI: LayeredSpec = {
    axes: [
        { name: "expression", tags: ["normal", "smile", "angry"] },
        { name: "outfit", tags: ["school", "casual"], default: "school" },
    ],
    layers: [
        { name: "body", asset: "mei_body" },
        { name: "outfit", axis: "outfit", options: { school: "mei_outfit_school", casual: "mei_outfit_casual" } },
        { name: "jacket", axis: "outfit", options: { school: null, casual: "mei_jacket_casual" } },
        { name: "eyes", axis: "expression", options: { normal: "mei_eyes_normal", smile: "mei_eyes_smile", angry: "mei_eyes_angry" } },
        { name: "mouth", axis: "expression", options: { normal: "mei_mouth_normal", smile: "mei_mouth_smile", angry: "mei_mouth_angry" } },
    ],
};

/** Asset references resolve to `id:<name>`; a name starting with `missing` does not. */
const resolver = (ref: string) => {
    if (ref.startsWith("missing")) {
        throw new Error(`No image asset "${ref}".`);
    }
    return `id:${ref}`;
};

function counterIds() {
    let n = 0;
    return (prefix: "x" | "t" | "l") => `${prefix}${++n}`;
}

function build(spec: LayeredSpec, previous: LayeredAppearance | null = null) {
    const result = buildLayeredAppearance(previous, spec, resolver, { width: 1000, height: 1800 }, counterIds());
    if ("errors" in result) {
        throw new Error(result.errors.join("\n"));
    }
    return result.built;
}

describe("checkLayeredSpec", () => {
    it("accepts a stack where one axis drives several layers and a layer draws nothing for some tags", () => {
        expect(checkLayeredSpec(MEI)).toEqual([]);
    });

    it("refuses a layer that does not account for every tag of its axis, and names the missing ones", () => {
        const spec: LayeredSpec = {
            ...MEI,
            layers: [...MEI.layers.slice(0, 4), { name: "mouth", axis: "expression", options: { normal: "mei_mouth_normal" } }],
        };
        const errors = checkLayeredSpec(spec);
        expect(errors).toHaveLength(1);
        expect(errors[0]).toMatch(/Layer "mouth" does not say what it draws for "smile", "angry"/);
        expect(errors[0]).toMatch(/null where this layer draws nothing/);
    });

    it("refuses an option for a tag the axis does not have", () => {
        const spec: LayeredSpec = {
            ...MEI,
            layers: [...MEI.layers.slice(0, 2), { name: "jacket", axis: "outfit", options: { school: null, casual: "a", swim: "b" } }],
        };
        expect(checkLayeredSpec(spec).join("\n")).toMatch(/"swim" is not a tag of axis "outfit"/);
    });

    it("refuses a tag name on two axes, because a /char row names a tag alone", () => {
        const spec: LayeredSpec = {
            axes: [{ name: "hat", tags: ["none", "cap"] }, { name: "glasses", tags: ["none", "round"] }],
            layers: [
                { name: "hat", axis: "hat", options: { none: null, cap: "cap" } },
                { name: "glasses", axis: "glasses", options: { none: null, round: "round" } },
            ],
        };
        const errors = checkLayeredSpec(spec);
        expect(errors).toEqual([expect.stringMatching(/tag "none" is on both axis "hat" and axis "glasses"/)]);
    });

    it("refuses an unused axis, an empty axis, an unknown axis, a layer empty everywhere and duplicate names", () => {
        const errors = checkLayeredSpec({
            axes: [{ name: "pose", tags: ["stand"] }, { name: "mood", tags: [] }, { name: "outfit", tags: ["a", "b"] }, { name: "Outfit", tags: ["c"] }],
            layers: [
                { name: "body", asset: "body" },
                { name: "Body", asset: "body2" },
                { name: "arm", axis: "gesture", options: {} },
                { name: "coat", axis: "outfit", options: { a: null, b: null } },
                { name: "fixed" },
            ],
        }).join("\n");
        expect(errors).toMatch(/Two axes are called "Outfit"/);
        expect(errors).toMatch(/Axis "mood" has no tags/);
        expect(errors).toMatch(/Two layers are called "Body"/);
        expect(errors).toMatch(/follows axis "gesture", which is not in `axes`/);
        expect(errors).toMatch(/Layer "coat" draws nothing for any tag/);
        expect(errors).toMatch(/Layer "fixed" draws nothing: a layer without an axis needs an `asset`/);
        expect(errors).toMatch(/Axis "pose" drives no layer/);
    });

    it("refuses a default that is not one of the axis's tags", () => {
        const spec: LayeredSpec = { ...MEI, axes: [MEI.axes[0], { ...MEI.axes[1], default: "swim" }] };
        expect(checkLayeredSpec(spec)).toEqual([expect.stringMatching(/default "swim" is not one of its tags/)]);
    });
});

describe("readLayeredSpec", () => {
    it("rejects shapes the schema cannot express", () => {
        const read = readLayeredSpec({ axes: [{ name: "x", tags: [""] }], layers: [{ name: "a", options: { t: 3 } }] });
        expect("errors" in read && read.errors.join("\n")).toMatch(/axis "x": `tags`[\s\S]*layer "a": `options`/);
        expect(readLayeredSpec({ axes: [], layers: [] })).toEqual({ errors: [expect.stringMatching(/`layers` must be a non-empty array/)] });
    });
});

describe("buildLayeredAppearance", () => {
    it("writes the stored model: bound layers keyed by tag id with null holes, constants by asset, defaults by id", () => {
        const { appearance, placements } = build(MEI);
        const [expression, outfit] = appearance.axes;
        expect(outfit.defaultTagId).toBe(outfit.tags[0].id);
        expect(expression.defaultTagId).toBe(expression.tags[0].id);
        expect(appearance.layers.map(layer => layer.name)).toEqual(["body", "outfit", "jacket", "eyes", "mouth"]);
        expect(appearance.layers[0]).toMatchObject({ axisId: null, assetId: "id:mei_body" });
        expect(appearance.layers[2]).toMatchObject({
            axisId: outfit.id,
            options: { [outfit.tags[0].id]: null, [outfit.tags[1].id]: "id:mei_jacket_casual" },
        });
        expect(appearance.canvas).toEqual({ width: 1000, height: 1800 });
        expect(placements).toContainEqual({ assetId: "id:mei_mouth_angry", where: 'layer "mouth" for angry' });
    });

    it("keeps every id whose name survives, so story rows keep their looks, and reports removed tags", () => {
        const first = build(MEI);
        const smileId = first.appearance.axes[0].tags[1].id;
        const angryId = first.appearance.axes[0].tags[2].id;
        const eyesId = first.appearance.layers[3].id;
        const restated: LayeredSpec = {
            axes: [{ name: "Expression", tags: ["smile", "normal", "sad"] }, MEI.axes[1]],
            layers: [
                ...MEI.layers.slice(0, 3),
                { name: "eyes", axis: "expression", options: { normal: "e1", smile: "e2", sad: "e3" } },
                { name: "mouth", axis: "expression", options: { normal: "m1", smile: "m2", sad: "m3" } },
            ],
        };
        const second = build(restated, { ...first.appearance, snapshots: [{ id: "s1", name: "grin", tags: {} }] });
        expect(second.appearance.axes[0].id).toBe(first.appearance.axes[0].id);
        expect(second.appearance.axes[0].tags.find(tag => tag.name === "smile")?.id).toBe(smileId);
        expect(second.appearance.layers[3].id).toBe(eyesId);
        expect(second.removedTagIds).toEqual([angryId]);
        // The previous default ("normal") still exists, so it stays the default.
        expect(second.appearance.axes[0].defaultTagId).toBe(first.appearance.axes[0].tags[0].id);
        // Editor-side work rides along.
        expect(second.appearance.snapshots).toEqual([{ id: "s1", name: "grin", tags: {} }]);
    });

    it("collects every reference that does not resolve instead of writing a half stack", () => {
        const spec: LayeredSpec = {
            ...MEI,
            layers: [{ name: "body", asset: "missing_body" }, ...MEI.layers.slice(1, 4), { name: "mouth", axis: "expression", options: { normal: "missing_m", smile: "a", angry: "b" } }],
        };
        const result = buildLayeredAppearance(null, spec, resolver, null);
        expect(result).toEqual({
            errors: ['layer "body": No image asset "missing_body".', 'layer "mouth" for normal: No image asset "missing_m".'],
        });
    });
});

describe("layeredSpecFromNames", () => {
    const files = [
        "mei_body", "mei_eyes_normal", "mei_eyes_smile", "mei_eyes_wink", "mei_mouth_normal", "mei_mouth_smile",
        "mei_outfit_school", "mei_outfit_casual", "mei_jacket_casual", "lin_body", "Mei_back-hair.png",
    ].map(name => ({ id: `id:${name}`, name }));

    it("reads layers and tags off the names, groups the layers an axis drives, and fills gaps with null", () => {
        const derived = layeredSpecFromNames(files, {
            prefix: "Mei",
            order: ["back-hair", "body", "outfit", "jacket", "eyes", "mouth"],
            axes: { expression: ["eyes", "mouth"], outfit: ["outfit", "jacket"] },
        });
        if ("errors" in derived) throw new Error(derived.errors.join("\n"));
        expect(derived.ignored).toEqual(["lin_body"]);
        expect(derived.spec.axes).toEqual([
            { name: "outfit", tags: ["school", "casual"] },
            { name: "expression", tags: ["normal", "smile", "wink"], default: "normal" },
        ]);
        expect(derived.spec.layers[0]).toEqual({ name: "back-hair", axis: null, asset: "id:Mei_back-hair.png" });
        expect(derived.spec.layers.find(layer => layer.name === "jacket")).toEqual({
            name: "jacket", axis: "outfit", options: { school: null, casual: "id:mei_jacket_casual" },
        });
        expect(derived.spec.layers.find(layer => layer.name === "mouth")?.options).toEqual({
            normal: "id:mei_mouth_normal", smile: "id:mei_mouth_smile", wink: null,
        });
        expect(checkLayeredSpec(derived.spec)).toEqual([]);
    });

    it("needs the stacking order once there is more than one layer, and says which layers it found", () => {
        const derived = layeredSpecFromNames(files, { prefix: "mei" });
        expect("errors" in derived && derived.errors[0]).toMatch(/Found 6 layers \(body, eyes, mouth, outfit, jacket, back-hair\)[\s\S]*pass `order`/);
        expect(derived.layersFound).toContain("back-hair");
    });

    it("refuses an order that leaves a layer out or names one no image provides", () => {
        const derived = layeredSpecFromNames(files, { prefix: "mei", order: ["body", "eyes", "mouth", "outfit", "jacket", "hat"] });
        expect("errors" in derived && derived.errors.join("\n")).toMatch(/leaves out "back-hair"[\s\S]*names "hat"/);
    });

    it("gives an ungrouped varying layer an axis of its own name and honours stated defaults", () => {
        const derived = layeredSpecFromNames(
            [{ id: "a", name: "kai_face_calm" }, { id: "b", name: "kai_face_grin" }],
            { prefix: "kai", defaults: { face: "grin" } },
        );
        if ("errors" in derived) throw new Error(derived.errors.join("\n"));
        expect(derived.spec).toEqual({
            axes: [{ name: "face", tags: ["calm", "grin"], default: "grin" }],
            layers: [{ name: "face", axis: "face", options: { calm: "a", grin: "b" } }],
        });
    });

    it("refuses a layer that is both fixed and tagged", () => {
        const derived = layeredSpecFromNames(
            [{ id: "a", name: "kai_face" }, { id: "b", name: "kai_face_grin" }],
            { prefix: "kai" },
        );
        expect("errors" in derived && derived.errors[0]).toMatch(/both a fixed image .* and tagged ones/);
    });
});

describe("describing and selecting", () => {
    it("describes a stored stack in the words character_layered_set takes, so it round-trips", () => {
        const { appearance } = build(MEI);
        const described = describeLayered(appearance, id => id.replace(/^id:/, ""));
        expect(described.axes[1]).toEqual({ name: "outfit", tags: ["school", "casual"], default: "school" });
        expect(described.layers[2]).toEqual({ name: "jacket", axis: "outfit", options: { school: null, casual: "mei_jacket_casual" } });
        const again = build(described as LayeredSpec, appearance);
        expect(again.appearance.axes).toEqual(appearance.axes);
        expect(again.appearance.layers.map(layer => layer.id)).toEqual(appearance.layers.map(layer => layer.id));
    });

    it("turns a look by name into the stored selection, by axis or as bare tags", () => {
        const { appearance } = build(MEI);
        const [expression, outfit] = appearance.axes;
        expect(selectionByName(appearance, { Outfit: "casual" })).toEqual({ tags: { [outfit.id]: outfit.tags[1].id } });
        expect(selectionByName(appearance, ["angry", "casual"])).toEqual({
            tags: { [expression.id]: expression.tags[2].id, [outfit.id]: outfit.tags[1].id },
        });
        expect(selectionByName(appearance, { outfit: "swim", pose: "x" })).toEqual({
            errors: ['No tag "swim" on axis "outfit".', 'No axis "pose" (axes: expression, outfit).'],
        });
    });
});
