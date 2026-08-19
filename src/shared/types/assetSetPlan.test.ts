import { describe, expect, it } from "vitest";
import {
    planAssetSet,
    planFileTags,
    segmentCount,
    segmentValues,
    splitAssetName,
    suggestSegmentRoles,
    type AssetSetPlanFile,
    type AssetSetSegmentRole,
} from "./assetSetPlan";
import { isLegalAxisOrder, resolveAssetSetContents, validateAssetSet, type AssetSet } from "./assetSet";

function file(id: string, name: string, tags: string[] = [], delimiters = ["-"]): AssetSetPlanFile {
    return { id, segments: splitAssetName(name, delimiters), tags };
}

function role(category: string, residency: AssetSetSegmentRole["residency"] = "build"): AssetSetSegmentRole {
    return { category, residency };
}

const ALICE = [
    file("a1", "alice-happy-en"),
    file("a2", "alice-happy-ja"),
    file("a3", "alice-sad-en"),
    file("a4", "alice-sad-ja"),
];

describe("splitAssetName", () => {
    it("splits on every chosen delimiter at once", () => {
        expect(splitAssetName("alice-happy_en", ["-", "_"])).toEqual(["alice", "happy", "en"]);
    });

    it("drops empty parts rather than counting them as positions", () => {
        expect(splitAssetName("alice--happy", ["-"])).toEqual(["alice", "happy"]);
    });

    it("answers the whole name when no delimiter is chosen", () => {
        expect(splitAssetName("alice happy", [])).toEqual(["alice happy"]);
    });

    it("answers nothing for a blank name", () => {
        expect(splitAssetName("   ", ["-"])).toEqual([]);
    });
});

describe("segmentValues", () => {
    it("answers the distinct values in first-seen order", () => {
        expect(segmentValues(ALICE, 1)).toEqual(["happy", "sad"]);
        expect(segmentValues(ALICE, 2)).toEqual(["en", "ja"]);
    });

    it("answers nothing for a position no file has", () => {
        expect(segmentValues(ALICE, 9)).toEqual([]);
    });

    it("counts positions on the longest name", () => {
        expect(segmentCount([file("a", "alice"), file("b", "alice-happy-en")])).toBe(3);
    });
});

describe("planFileTags", () => {
    it("writes one tag per named position", () => {
        const tags = planFileTags(file("a1", "alice-happy-en"), [role("char"), role("mood"), role("locale")]);
        expect(tags).toEqual(["char:alice", "mood:happy", "locale:en"]);
    });

    it("leaves a position nobody named out of the tags", () => {
        const tags = planFileTags(file("a1", "alice-happy-v2"), [role("char"), role("mood"), role("")]);
        expect(tags).toEqual(["char:alice", "mood:happy"]);
    });

    it("replaces the value a category already had rather than joining it", () => {
        const tags = planFileTags(
            file("a1", "alice-happy-ja", ["locale:en", "char:alice"]),
            [role("char"), role("mood"), role("locale")],
        );
        expect(tags).toContain("locale:ja");
        expect(tags).not.toContain("locale:en");
    });

    it("keeps tags no position claims, including plain labels", () => {
        const tags = planFileTags(
            file("a1", "alice-happy-en", ["wip", "artist:mei"]),
            [role("char"), role("mood"), role("locale")],
        );
        expect(tags).toContain("wip");
        expect(tags).toContain("artist:mei");
    });

    it("changes nothing when no position is named", () => {
        const tags = planFileTags(file("a1", "alice-happy-en", ["wip"]), [role(""), role("")]);
        expect(tags).toEqual(["wip"]);
    });
});

describe("planAssetSet", () => {
    const roles = [role("char"), role("mood"), role("locale", "runtime")];

    it("makes a position every file agrees on the filter, and the rest axes", () => {
        const plan = planAssetSet(ALICE, roles, "image");
        expect(plan.filter).toEqual(["char:alice"]);
        expect(plan.axes.map(axis => axis.key)).toEqual(["mood", "locale"]);
        expect(plan.axes[0].values).toEqual(["happy", "sad"]);
        expect(plan.axes[1].values).toEqual(["en", "ja"]);
    });

    it("takes residency from the roles rather than from the names", () => {
        const plan = planAssetSet(ALICE, roles, "image");
        expect(plan.axes.find(axis => axis.key === "mood")?.residency).toBe("build");
        expect(plan.axes.find(axis => axis.key === "locale")?.residency).toBe("runtime");
    });

    it("orders build axes outside runtime ones whatever order they were named in", () => {
        const plan = planAssetSet(ALICE, [role("char"), role("mood", "runtime"), role("locale")], "image");
        expect(plan.axes.map(axis => axis.key)).toEqual(["locale", "mood"]);
        expect(isLegalAxisOrder(plan.axes)).toBe(true);
    });

    it("never produces a set the model would refuse", () => {
        const plan = planAssetSet(ALICE, [role("char"), role("mood", "runtime"), role("locale", "build")], "image");
        const set: AssetSet = { id: "s", name: "Alice", type: "image", filter: plan.filter, axes: plan.axes };
        expect(validateAssetSet(set)).toEqual([]);
    });

    it("keeps the author's naming order within one residency", () => {
        const plan = planAssetSet(
            [
                file("a1", "alice-happy-school"),
                file("a2", "alice-sad-casual"),
            ],
            [role("char"), role("mood"), role("outfit")],
            "image",
        );
        expect(plan.axes.map(axis => axis.key)).toEqual(["mood", "outfit"]);
    });

    it("drops a category a file has no segment for", () => {
        // `alice` has no third position, so `locale` is carried by three of the four files. A
        // category not every member has is neither a filter nor an axis - as an axis it would
        // promise a coordinate that file can never answer.
        const plan = planAssetSet(
            [...ALICE.slice(0, 3), file("a5", "alice-plain")],
            roles,
            "image",
        );
        expect(plan.axes.map(axis => axis.key)).toEqual(["mood"]);
    });

    it("plans the tags it derives the set from", () => {
        const plan = planAssetSet(ALICE, roles, "image");
        expect(plan.tagsByFile.get("a1")).toEqual(["char:alice", "mood:happy", "locale:en"]);
        expect(plan.tagsByFile.size).toBe(4);
    });

    /**
     * The wizard shows the author which coordinates resolve before anything is written, and it does
     * that by measuring the planned tags. If the plan and the measurement could disagree, the
     * preview would be a promise the project does not keep.
     */
    it("produces a set that resolves every planned file", () => {
        const plan = planAssetSet(ALICE, roles, "image");
        const set: AssetSet = { id: "s", name: "Alice", type: "image", filter: plan.filter, axes: plan.axes };
        const candidates = ALICE.map(entry => ({
            id: entry.id,
            type: "image",
            tags: plan.tagsByFile.get(entry.id) ?? [],
        }));
        const contents = resolveAssetSetContents(set, candidates);
        expect(contents.cells).toHaveLength(4);
        expect(contents.missing).toEqual([]);
        expect(contents.ambiguous).toEqual([]);
    });

    it("reports the hole a missing file leaves, without inventing one for it", () => {
        const plan = planAssetSet(ALICE.slice(0, 3), roles, "image");
        const set: AssetSet = { id: "s", name: "Alice", type: "image", filter: plan.filter, axes: plan.axes };
        const candidates = ALICE.slice(0, 3).map(entry => ({
            id: entry.id,
            type: "image",
            tags: plan.tagsByFile.get(entry.id) ?? [],
        }));
        const contents = resolveAssetSetContents(set, candidates);
        expect(contents.missing.map(cell => cell.label)).toEqual(["mood:sad · locale:ja"]);
    });
});

describe("suggestSegmentRoles", () => {
    it("suggests the category the files already read a position as", () => {
        const tagged = [
            file("a1", "alice-happy-en", ["char:alice", "mood:happy", "locale:en"]),
            file("a2", "alice-sad-ja", ["char:alice", "mood:sad", "locale:ja"]),
        ];
        expect(suggestSegmentRoles(tagged, []).map(entry => entry.category)).toEqual(["char", "mood", "locale"]);
    });

    it("suggests nothing where the files carry no tag for that value", () => {
        expect(suggestSegmentRoles(ALICE, []).map(entry => entry.category)).toEqual(["", "", ""]);
    });

    it("suggests nothing where only some files read the position that way", () => {
        const mixed = [
            file("a1", "alice-happy-en", ["mood:happy"]),
            file("a2", "alice-sad-ja", []),
        ];
        expect(suggestSegmentRoles(mixed, []).map(entry => entry.category)).toEqual(["", "", ""]);
    });

    it("suggests runtime residency for a position whose values are this project's languages", () => {
        const roles = suggestSegmentRoles(ALICE, ["en", "ja"]);
        expect(roles.map(entry => entry.residency)).toEqual(["build", "build", "runtime"]);
    });

    it("keeps build residency when only some of the values are languages", () => {
        const roles = suggestSegmentRoles(ALICE, ["en"]);
        expect(roles[2].residency).toBe("build");
    });

    it("keeps build residency for a position that never varies", () => {
        const roles = suggestSegmentRoles([file("a1", "en-alice"), file("a2", "en-bob")], ["en"]);
        expect(roles[0].residency).toBe("build");
    });
});
