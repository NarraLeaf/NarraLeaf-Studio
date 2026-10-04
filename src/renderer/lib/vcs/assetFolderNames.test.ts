import { describe, expect, it } from "vitest";
import type { DocumentChange } from "@shared/documents/diff";
import { diffAssetsMetadata } from "@shared/documents/specs/assetsMetadata";
import {
    assetFolderPath,
    assetTopLevelName,
    changesAssetGroup,
    nameAssetFields,
    parseAssetFolders,
    type AssetFolderNames,
} from "./assetFolderNames";

/**
 * An asset's group, named the way the assets panel names it rather than by the id its record stores.
 */

const BACKGROUNDS = "group_1786075133079_orr40gkke";
const CHARACTERS = "group_1786075133091_s9hww4lcc";
const POSTERS = "group_1790873137719_pndem529z";

const t = (key: string) => ({
    "documentDiff.assets.fields.group": "Group",
    "documentDiff.assets.fields.missingGroup": "Missing group",
    "assets.categories.image": "Images",
    "assets.categories.media": "Media",
    "assets.categories.other": "Other",
}[key] ?? key);

function folders(before: Record<string, unknown>, after: Record<string, unknown>): AssetFolderNames {
    return { before: parseAssetFolders(JSON.stringify(before)), after: parseAssetFolders(JSON.stringify(after)) };
}

/** The changes the comparison really produces for one record whose group moved. */
function groupMove(from: string | undefined, to: string | undefined): DocumentChange[] {
    const record = (groupId: string | undefined) => ({
        id: "a1",
        name: "classroom",
        hash: "h",
        ...(groupId === undefined ? {} : { groupId }),
    });
    return [...diffAssetsMetadata(
        { type: "image", assets: { a1: record(from) } },
        { type: "image", assets: { a1: record(to) } },
        { limit: 200 },
    ).changes];
}

function groupLeaf(changes: readonly DocumentChange[]): DocumentChange {
    const leaf = changes[0]?.children?.[0];
    expect(leaf?.label.key).toBe("documentDiff.assets.field");
    return leaf!;
}

describe("assetFolderPath", () => {
    const list = parseAssetFolders(JSON.stringify({
        [BACKGROUNDS]: { id: BACKGROUNDS, name: "Backgrounds", category: "image" },
        [POSTERS]: { id: POSTERS, name: "Posters", category: "image", parentGroupId: BACKGROUNDS },
        loopA: { name: "A", parentGroupId: "loopB" },
        loopB: { name: "B", parentGroupId: "loopA" },
    }));

    it("names a group, and a nested one by its path from the top", () => {
        expect(assetFolderPath(list, BACKGROUNDS)).toBe("Backgrounds");
        expect(assetFolderPath(list, POSTERS)).toBe("Backgrounds / Posters");
    });

    it("says nothing for a group the list does not have, and survives a hand-made cycle", () => {
        expect(assetFolderPath(list, CHARACTERS)).toBeNull();
        expect(assetFolderPath(list, "loopA")).toBe("B / A");
    });
});

describe("nameAssetFields", () => {
    const lists = folders(
        {
            [BACKGROUNDS]: { name: "Backgrounds" },
            [CHARACTERS]: { name: "Characters" },
        },
        {
            [BACKGROUNDS]: { name: "Backgrounds" },
            [CHARACTERS]: { name: "Cast" },
            [POSTERS]: { name: "Posters", parentGroupId: BACKGROUNDS },
        },
    );

    it("names the field and both groups instead of showing their ids", () => {
        const changes = groupMove(BACKGROUNDS, CHARACTERS);
        expect(groupLeaf(changes).label.params).toMatchObject({ field: "groupId", from: BACKGROUNDS, to: CHARACTERS });

        const named = groupLeaf(nameAssetFields(changes, t, lists));
        // Each side by its own list: the group was renamed in the same change, and reads as both.
        expect(named.label.params).toEqual({ field: "Group", from: "Backgrounds", to: "Cast" });
        expect(JSON.stringify(nameAssetFields(changes, t, lists))).not.toContain("group_");
    });

    it("names a new nested group by its path", () => {
        expect(groupLeaf(nameAssetFields(groupMove(BACKGROUNDS, POSTERS), t, lists)).label.params)
            .toEqual({ field: "Group", from: "Backgrounds", to: "Backgrounds / Posters" });
    });

    /**
     * No group is the top of the asset's category, which the panel names by the category's name. A
     * move out of a group names where the asset went, and a move into one names where it came from,
     * so the row reads as the move it is - and wears the mark of one, not of a removal or addition.
     */
    it("names the top of the category for a move out of a group, or into one", () => {
        const out = groupLeaf(nameAssetFields(groupMove(BACKGROUNDS, undefined), t, lists, "Images"));
        expect(out.label.params).toEqual({ field: "Group", from: "Backgrounds", to: "Images" });
        expect(out.kind).toBe("changed");

        const into = groupLeaf(nameAssetFields(groupMove(undefined, POSTERS), t, lists, "Images"));
        expect(into.label.params).toEqual({ field: "Group", from: "Images", to: "Backgrounds / Posters" });
        expect(into.kind).toBe("changed");
    });

    it("leaves that end off, and the row's mark as it was, when the top is not named", () => {
        const out = groupLeaf(nameAssetFields(groupMove(BACKGROUNDS, undefined), t, lists));
        expect(out.label.params).toEqual({ field: "Group", from: "Backgrounds" });
        expect(out.kind).toBe("removed");
    });

    it("falls back to the other side, then to a stand-in, never to the id", () => {
        // Deleted in the same change that moved the asset out of it: only the older list names it.
        const deleted = folders({ [POSTERS]: { name: "Posters" } }, {});
        expect(groupLeaf(nameAssetFields(groupMove(BACKGROUNDS, POSTERS), t, deleted)).label.params)
            .toEqual({ field: "Group", from: "Missing group", to: "Posters" });
    });

    it("draws no value at all until the lists have been read", () => {
        expect(groupLeaf(nameAssetFields(groupMove(BACKGROUNDS, CHARACTERS), t, null)).label.params)
            .toEqual({ field: "Group" });
        // Not the top either: one end of a move shown before the other would read as the whole move.
        const out = groupLeaf(nameAssetFields(groupMove(BACKGROUNDS, undefined), t, null, "Images"));
        expect(out.label.params).toEqual({ field: "Group" });
        expect(out.kind).toBe("removed");
    });

    it("leaves every other change as it was", () => {
        const renamed: DocumentChange[] = [...diffAssetsMetadata(
            { type: "image", assets: { a1: { id: "a1", name: "old", tags: ["x"] } } },
            { type: "image", assets: { a1: { id: "a1", name: "new", tags: ["y"] } } },
            { limit: 200 },
        ).changes];
        expect(changesAssetGroup(renamed)).toBe(false);
        expect(nameAssetFields(renamed, t, lists)).toEqual(renamed);
        expect(changesAssetGroup(groupMove(BACKGROUNDS, CHARACTERS))).toBe(true);
    });
});

describe("assetTopLevelName", () => {
    it("names the top of the category a shard's type is filed under, as the panel does", () => {
        expect(assetTopLevelName("assets/assets.metadata.image.json", t)).toBe("Images");
        // Sound and video share one category, and so one top.
        expect(assetTopLevelName("assets/assets.metadata.audio.json", t)).toBe("Media");
        expect(assetTopLevelName("assets/assets.metadata.video.json", t)).toBe("Media");
    });

    it("names nothing for a path that is not a shard of a known type", () => {
        expect(assetTopLevelName("assets/assets.metadata.hologram.json", t)).toBeUndefined();
        expect(assetTopLevelName("assets/assets.groups.image.json", t)).toBeUndefined();
        expect(assetTopLevelName("editor/story/stories.json", t)).toBeUndefined();
    });
});
