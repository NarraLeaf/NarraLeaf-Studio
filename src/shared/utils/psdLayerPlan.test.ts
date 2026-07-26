import { describe, expect, it } from "vitest";
import type { PsdLayerNode } from "@shared/types/psdImport";
import { canMergeBlendMode, flattenLeaves, isUnsupportedBlend, planImport, toBakeTargets, unsupportedBlends } from "./psdLayerPlan";

function leaf(name: string, path: string[], extra: Partial<PsdLayerNode> = {}): PsdLayerNode {
    return {
        path,
        name,
        bounds: { left: 0, top: 0, right: 10, bottom: 10 },
        blendMode: "normal",
        opacity: 1,
        hidden: false,
        clipping: false,
        ...extra,
    };
}

/** A body layer at the root, an Outfit group of two, a Mood group of two, one of them multiply. */
function tree(): PsdLayerNode[] {
    return [
        leaf("Body", ["Body"]),
        {
            ...leaf("Outfit", ["Outfit"]),
            bounds: undefined,
            blendMode: "passThrough",
            children: [leaf("Uniform", ["Outfit", "Uniform"]), leaf("Casual", ["Outfit", "Casual"])],
        },
        {
            ...leaf("Mood", ["Mood"]),
            bounds: undefined,
            blendMode: "passThrough",
            children: [
                leaf("Happy", ["Mood", "Happy"]),
                leaf("Blush", ["Mood", "Blush"], { blendMode: "multiply" }),
            ],
        },
    ];
}

describe("flattenLeaves", () => {
    it("returns drawable layers only, tagged with their top-level group", () => {
        const leaves = flattenLeaves(tree());
        expect(leaves.map(l => `${l.group ?? "-"}:${l.name}`)).toEqual([
            "-:Body", "Outfit:Uniform", "Outfit:Casual", "Mood:Happy", "Mood:Blush",
        ]);
    });

    it("credits a nested group's layers to the top-level group, not the nested one", () => {
        const nested: PsdLayerNode[] = [{
            ...leaf("Mood", ["Mood"]),
            bounds: undefined,
            children: [{
                ...leaf("Eyes", ["Mood", "Eyes"]),
                bounds: undefined,
                children: [leaf("Open", ["Mood", "Eyes", "Open"])],
            }],
        }];
        expect(flattenLeaves(nested).map(l => l.group)).toEqual(["Mood"]);
    });
});

describe("unsupportedBlends", () => {
    it("names every layer the engine cannot reproduce, and nothing else", () => {
        expect(unsupportedBlends(flattenLeaves(tree())).map(l => l.name)).toEqual(["Blush"]);
    });
});

describe("planImport", () => {
    it("makes a top-level group an axis and a rootless layer a constant", () => {
        const plan = planImport(flattenLeaves(tree()), { "Mood/Blush": "merge" });
        expect(plan.axes).toEqual([
            { name: "Outfit", tags: ["Uniform", "Casual"] },
            { name: "Mood", tags: ["Happy", "Blush"] },
        ]);
        expect(plan.constants.map(l => l.name)).toEqual(["Body"]);
    });

    it("does not make an axis out of a group of one — it would drive nothing", () => {
        const single: PsdLayerNode[] = [{
            ...leaf("Hat", ["Hat"]),
            bounds: undefined,
            children: [leaf("Beret", ["Hat", "Beret"])],
        }];
        const plan = planImport(flattenLeaves(single), {});
        expect(plan.axes).toEqual([]);
        expect(plan.constants.map(l => l.name)).toEqual(["Beret"]);
    });

    it("drops hidden layers and blend-skipped ones, and says which was which", () => {
        const withHidden = flattenLeaves([
            leaf("Body", ["Body"]),
            leaf("Scratch", ["Scratch"], { hidden: true }),
            leaf("Shade", ["Shade"], { blendMode: "multiply" }),
        ]);
        const plan = planImport(withHidden, { Shade: "skip" });
        expect(plan.baking.map(l => l.name)).toEqual(["Body"]);
        expect(plan.dropped).toEqual([
            { leaf: expect.objectContaining({ name: "Scratch" }), reason: "hidden" },
            { leaf: expect.objectContaining({ name: "Shade" }), reason: "blend-skipped" },
        ]);
    });

    it("keeps a merged blend layer in the bake", () => {
        const plan = planImport(flattenLeaves(tree()), { "Mood/Blush": "merge" });
        expect(plan.baking.map(l => l.name)).toContain("Blush");
        expect(plan.dropped).toEqual([]);
    });
});

describe("toBakeTargets", () => {
    it("attaches a merged layer to the one below it and drops its own slot", () => {
        const leaves = flattenLeaves([
            leaf("Body", ["Body"]),
            leaf("Shade", ["Shade"], { blendMode: "multiply" }),
            leaf("Hat", ["Hat"]),
        ]);
        const resolutions = { Shade: "merge" as const };
        const targets = toBakeTargets(planImport(leaves, resolutions), resolutions);
        expect(targets).toEqual([
            { path: ["Body"], mergeFrom: [["Shade"]] },
            { path: ["Hat"] },
        ]);
    });

    it("keeps a merged layer that has nothing underneath as a layer of its own", () => {
        const leaves = flattenLeaves([leaf("Shade", ["Shade"], { blendMode: "multiply" }), leaf("Body", ["Body"])]);
        const resolutions = { Shade: "merge" as const };
        expect(toBakeTargets(planImport(leaves, resolutions), resolutions))
            .toEqual([{ path: ["Shade"] }, { path: ["Body"] }]);
    });
});

describe("canMergeBlendMode", () => {
    it("accepts separable modes and refuses the ones that mix channels", () => {
        expect(canMergeBlendMode("multiply")).toBe(true);
        expect(canMergeBlendMode("softLight")).toBe(true);
        expect(canMergeBlendMode("hue")).toBe(false);
        expect(canMergeBlendMode("luminosity")).toBe(false);
    });
});

describe("isUnsupportedBlend", () => {
    it("accepts both spellings of a group's pass-through default", () => {
        // ag-psd reports "pass through" with a space; the type name in Photoshop's docs has neither.
        expect(isUnsupportedBlend("pass through")).toBe(false);
        expect(isUnsupportedBlend("passThrough")).toBe(false);
        expect(isUnsupportedBlend("normal")).toBe(false);
        expect(isUnsupportedBlend("multiply")).toBe(true);
    });
});
