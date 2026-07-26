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
        const plan = planImport(flattenLeaves(tree()), {});
        expect(plan.axes).toEqual([
            { name: "Outfit", tags: ["Uniform", "Casual"] },
            { name: "Mood", tags: ["Happy", "Blush"] },
        ]);
        expect(plan.constants.map(l => l.name)).toEqual(["Body"]);
    });

    it("does not count a merged layer as a tag — it has no art of its own", () => {
        // Merging Blush down leaves Mood with a single member, and a one-member group is not an
        // axis. Counting it would declare a tag that no baked image ever fills.
        const plan = planImport(flattenLeaves(tree()), { "Mood/Blush": "merge" });
        expect(plan.axes).toEqual([{ name: "Outfit", tags: ["Uniform", "Casual"] }]);
        expect(plan.constants.map(l => l.name)).toEqual(["Body", "Happy"]);
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
        const targets = toBakeTargets(planImport(leaves, { Shade: "merge" }));
        expect(targets).toEqual([
            { path: ["Body"], mergeFrom: [{ path: ["Shade"], clip: false }] },
            { path: ["Hat"] },
        ]);
    });

    it("keeps a merged layer that has nothing underneath as a layer of its own", () => {
        const leaves = flattenLeaves([leaf("Shade", ["Shade"], { blendMode: "multiply" }), leaf("Body", ["Body"])]);
        expect(toBakeTargets(planImport(leaves, { Shade: "merge" })))
            .toEqual([{ path: ["Shade"] }, { path: ["Body"] }]);
    });

    it("emits one target per tag of an axis, in stack order", () => {
        const targets = toBakeTargets(planImport(flattenLeaves(tree()), { "Mood/Blush": "skip" }));
        expect(targets.map(target => target.path.join("/"))).toEqual([
            "Body", "Outfit/Uniform", "Outfit/Casual", "Mood/Happy",
        ]);
    });
});

describe("clipping masks", () => {
    /** Body, a blush clipped to it, then a hat. */
    function clipped(extra: Partial<PsdLayerNode> = {}): PsdLayerNode[] {
        return [
            leaf("Body", ["Body"], extra),
            leaf("Blush", ["Blush"], { clipping: true }),
            leaf("Hat", ["Hat"]),
        ];
    }

    it("folds a clipped layer into its base instead of giving it a slot", () => {
        const plan = planImport(flattenLeaves(clipped()), {});
        expect(plan.slots.map(slot => (slot.kind === "constant" ? slot.name : slot.axis))).toEqual(["Body", "Hat"]);
        expect(toBakeTargets(plan)).toEqual([
            { path: ["Body"], mergeFrom: [{ path: ["Blush"], clip: true }] },
            { path: ["Hat"] },
        ]);
    });

    it("does not let a clipped layer become a tag of its base's axis", () => {
        // The blush is art belonging to Happy, not a third mood. Counting it would both invent a tag
        // and make a two-member group look like a three-member one.
        const plan = planImport(flattenLeaves([{
            ...leaf("Mood", ["Mood"]),
            bounds: undefined,
            children: [
                leaf("Happy", ["Mood", "Happy"]),
                leaf("Blush", ["Mood", "Blush"], { clipping: true }),
                leaf("Angry", ["Mood", "Angry"]),
            ],
        }]), {});
        expect(plan.axes).toEqual([{ name: "Mood", tags: ["Happy", "Angry"] }]);
        expect(plan.attachments["Mood/Happy"]).toEqual([
            { leaf: expect.objectContaining({ name: "Blush" }), clip: true },
        ]);
    });

    it("drops a clipped layer whose base is not imported rather than spreading it", () => {
        // Photoshop hides a clip when its base is hidden; importing it anyway would turn a blush
        // clipped to a face into a rectangle across the whole sprite.
        const plan = planImport(flattenLeaves(clipped({ hidden: true })), {});
        expect(plan.dropped.map(entry => `${entry.leaf.name}:${entry.reason}`))
            .toEqual(["Body:hidden", "Blush:clip-base-dropped"]);
        expect(plan.slots.map(slot => (slot.kind === "constant" ? slot.name : slot.axis))).toEqual(["Hat"]);
    });

    it("follows a merged base to the layer that absorbed it", () => {
        // Blush clips to Shade, but Shade is being flattened onto Body — so the blush has to land on
        // Body too, or it would be attached to a layer that never gets baked.
        const plan = planImport(flattenLeaves([
            leaf("Body", ["Body"]),
            leaf("Shade", ["Shade"], { blendMode: "multiply" }),
            leaf("Blush", ["Blush"], { clipping: true }),
        ]), { Shade: "merge" });
        expect(toBakeTargets(plan)).toEqual([{
            path: ["Body"],
            mergeFrom: [{ path: ["Shade"], clip: false }, { path: ["Blush"], clip: true }],
        }]);
    });
});

describe("planImport slots", () => {
    it("puts an axis where its first member sits, not at the end", () => {
        const plan = planImport(flattenLeaves(tree()), {});
        expect(plan.slots.map(slot => (slot.kind === "constant" ? slot.name : slot.axis)))
            .toEqual(["Body", "Outfit", "Mood"]);
    });

    it("lists every tag of an axis with the leaf it comes from", () => {
        const plan = planImport(flattenLeaves(tree()), {});
        const outfit = plan.slots.find(slot => slot.kind === "switch" && slot.axis === "Outfit");
        expect(outfit?.kind === "switch" && outfit.options.map(option => option.tag))
            .toEqual(["Uniform", "Casual"]);
    });
});

describe("unsupportedBlends and hidden layers", () => {
    it("does not ask about a layer that is being dropped anyway", () => {
        const leaves = flattenLeaves([leaf("Scratch", ["Scratch"], { hidden: true, blendMode: "multiply" })]);
        expect(unsupportedBlends(leaves)).toEqual([]);
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
