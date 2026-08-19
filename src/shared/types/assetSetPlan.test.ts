import { describe, expect, it } from "vitest";
import {
    assetSetIdentityTag,
    planAssetSet,
    suggestAssetSetMembers,
    type AssetSetPlanFile,
    type AssetSetPlanValue,
} from "./assetSetPlan";
import { childAssetSets, resolveAssetSetContents, validateAssetSet, type AssetSet } from "./assetSet";

function file(id: string, name: string, tags: string[] = []): AssetSetPlanFile {
    return { id, name, tags };
}

const LOCALES: AssetSetPlanValue[] = [
    { value: "en", label: "English" },
    { value: "zh-CN", label: "简体中文" },
];

const EDITIONS: AssetSetPlanValue[] = [
    { value: "release", label: "main" },
    { value: "demo", label: "Demo" },
];

describe("suggestAssetSetMembers", () => {
    it("reads a value out of the file name", () => {
        const members = suggestAssetSetMembers([file("a", "title_en"), file("b", "title_zh-CN")], LOCALES);
        expect(members.get("en")).toBe("a");
        expect(members.get("zh-CN")).toBe("b");
    });

    it("matches the longer value first, so a code containing another does not lose", () => {
        const members = suggestAssetSetMembers(
            [file("a", "title_zh-CN"), file("b", "title_zh")],
            [{ value: "zh", label: "中文" }, { value: "zh-CN", label: "简体中文" }],
        );
        expect(members.get("zh-CN")).toBe("a");
        expect(members.get("zh")).toBe("b");
    });

    it("uses each file once", () => {
        const members = suggestAssetSetMembers([file("a", "title_en")], [
            { value: "en", label: "English" },
            { value: "en-GB", label: "British English" },
        ]);
        expect([...members.values()]).toEqual(["a"]);
    });

    it("leaves a value nothing answers unmatched", () => {
        const members = suggestAssetSetMembers([file("a", "title_en")], LOCALES);
        expect(members.has("zh-CN")).toBe(false);
    });
});

describe("planAssetSet", () => {
    const files = [file("a", "title_en"), file("b", "title_zh-CN")];

    it("declares the axis the kind describes, over the project's values", () => {
        const plan = planAssetSet({
            setId: "s1",
            kind: "locale",
            values: LOCALES,
            files,
            members: suggestAssetSetMembers(files, LOCALES),
        });
        expect(plan.axis).toEqual({
            kind: "locale",
            key: "locale",
            residency: "runtime",
            values: ["en", "zh-CN"],
        });
    });

    it("resolves an edition axis when the edition is built", () => {
        const plan = planAssetSet({ setId: "s1", kind: "release", values: EDITIONS, files, members: new Map() });
        expect(plan.axis.residency).toBe("build");
    });

    it("tags every member with the set's own tag and its value", () => {
        const plan = planAssetSet({
            setId: "s1",
            kind: "locale",
            values: LOCALES,
            files,
            members: suggestAssetSetMembers(files, LOCALES),
        });
        expect(plan.filter).toEqual([assetSetIdentityTag("s1")]);
        expect(plan.tagsByFile.get("a")).toEqual(["set:s1", "locale:en"]);
        expect(plan.tagsByFile.get("b")).toEqual(["set:s1", "locale:zh-CN"]);
    });

    it("keeps tags this set does not claim, and replaces the ones it does", () => {
        const plan = planAssetSet({
            setId: "s1",
            kind: "locale",
            values: LOCALES,
            files: [file("a", "title_en", ["locale:ja", "artist:mei", "wip"])],
            members: new Map([["en", "a"]]),
        });
        expect(plan.tagsByFile.get("a")).toEqual(["artist:mei", "wip", "set:s1", "locale:en"]);
    });

    it("writes nothing for a value nobody answers", () => {
        const plan = planAssetSet({
            setId: "s1",
            kind: "locale",
            values: LOCALES,
            files: [files[0]],
            members: new Map([["en", "a"]]),
        });
        expect(plan.members.has("zh-CN")).toBe(false);
        expect(plan.tagsByFile.size).toBe(1);
    });

    /**
     * The preview is a measurement of the planned tags, so the set the dialog draws and the set the
     * project gets have to be the same thing.
     */
    it("produces a set the model accepts and the planned library answers", () => {
        const plan = planAssetSet({
            setId: "s1",
            kind: "locale",
            values: LOCALES,
            files,
            members: suggestAssetSetMembers(files, LOCALES),
        });
        const declared: AssetSet = { id: "s1", name: "Title", type: "image", filter: plan.filter, axis: plan.axis };
        expect(validateAssetSet(declared)).toEqual([]);
        const contents = resolveAssetSetContents(declared, files.map(entry => ({
            id: entry.id,
            type: "image",
            tags: plan.tagsByFile.get(entry.id) ?? [],
        })));
        expect(contents.missing).toEqual([]);
        expect(contents.ambiguous).toEqual([]);
    });

    it("makes a sub-set the model reads as hanging under its parent's value", () => {
        const parent: AssetSet = {
            id: "p",
            name: "Title",
            type: "image",
            filter: [assetSetIdentityTag("p")],
            axis: { kind: "release", key: "release", residency: "build", values: ["release", "demo"] },
        };
        const plan = planAssetSet({
            setId: "c",
            kind: "locale",
            values: LOCALES,
            files,
            members: suggestAssetSetMembers(files, LOCALES),
            parent: { set: parent, value: "demo" },
        });
        expect(plan.filter).toEqual(["set:p", "release:demo"]);
        const child: AssetSet = { id: "c", name: "Title demo", type: "image", filter: plan.filter, axis: plan.axis };
        expect(childAssetSets(parent, "demo", [parent, child]).map(entry => entry.id)).toEqual(["c"]);
        expect(plan.tagsByFile.get("a")).toEqual(["set:p", "release:demo", "locale:en"]);
    });
});
