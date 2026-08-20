import { describe, expect, it } from "vitest";
import type { AssetSet } from "@shared/types/assetSet";
import { AssetCategory } from "@/lib/workspace/services/assets/assetTypes";
import type { AssetGroup } from "@/lib/workspace/services/assets/types";
import { planAssetSetReveal, type AssetSetPlacement } from "./assetSetRevealPlan";

/**
 * What has to be open before a jumped-to set is on screen.
 *
 * The failure this guards is the one a reveal exists to prevent and cannot report: everything runs,
 * the panel comes up, and the row is inside a folder nobody opened - which reads exactly like a
 * jump that did nothing. Nothing throws, and no other test would notice.
 */

function group(id: string, parentGroupId?: string): AssetGroup {
    return { id, name: id, category: AssetCategory.Image, parentGroupId, createdAt: 0, updatedAt: 0 };
}

function set(id: string, filter: string[], values: string[], groupId?: string): AssetSet {
    return {
        id,
        name: id,
        type: "image",
        filter,
        axis: { kind: "locale", key: "locale", residency: "runtime", values, fallback: values[0] ?? "" },
        ...(groupId ? { groupId } : {}),
    };
}

function placements(...sets: AssetSet[]): AssetSetPlacement[] {
    return sets.map(entry => ({ set: entry, category: AssetCategory.Image }));
}

describe("planAssetSetReveal", () => {
    it("opens every folder above the set, outermost first", () => {
        const plan = planAssetSetReveal({
            setId: "s1",
            placements: placements(set("s1", ["char:alice"], ["en", "ja"], "inner")),
            groups: [group("outer"), group("inner", "outer")],
        });
        expect(plan).toEqual({
            category: AssetCategory.Image,
            groupPathIds: ["outer", "inner"],
            ancestorSetIds: [],
        });
    });

    it("opens the sets a sub-set hangs under, and reads the folder off the OUTERMOST one", () => {
        // A sub-set is drawn inside its parent and nowhere else, so its own folder says nothing about
        // where its row appears. Filed here in a folder that is deliberately not the parent's, which
        // is what tells the two readings apart.
        const parent = set("parent", ["char:alice"], ["en", "ja"], "outer");
        const child = set("child", ["char:alice", "locale:ja"], ["en", "ja"], "elsewhere");
        expect(planAssetSetReveal({
            setId: "child",
            placements: placements(parent, child),
            groups: [group("outer"), group("elsewhere")],
        })).toEqual({
            category: AssetCategory.Image,
            groupPathIds: ["outer"],
            ancestorSetIds: ["parent"],
        });
    });

    it("says nothing about a set the project no longer holds", () => {
        // A reference outlives the set it names, so "reveal this" arrives for sets that are gone. The
        // caller has to be able to tell that apart from a set at the top of its section.
        expect(planAssetSetReveal({ setId: "gone", placements: placements(set("s1", [], ["en"])), groups: [] }))
            .toBeNull();
    });

    it("leaves a folder that is its own ancestor without hanging", () => {
        // `parentGroupId` is a plain field with nothing stopping it pointing back down the tree, and
        // a document edited by hand can say so. Walking it would hang the panel rather than fail a
        // jump, which is a worse answer than a short path.
        const plan = planAssetSetReveal({
            setId: "s1",
            placements: placements(set("s1", [], ["en"], "a")),
            groups: [group("a", "b"), group("b", "a")],
        });
        expect(plan?.groupPathIds).toEqual(["b", "a"]);
    });
});
