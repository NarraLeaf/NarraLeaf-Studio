import { describe, expect, it } from "vitest";
import { ASSET_CATEGORY_ORDER, AssetCategory, AssetType } from "@/lib/workspace/services/assets/assetTypes";
import { Asset, AssetGroup, AssetSource } from "@/lib/workspace/services/assets/types";
import { createEmptyAssetCategoryRecord } from "./assetCategoryRecord";
import {
    iconViewRowOrder,
    listViewCategoryRows,
    type AssetSetRowCell,
    type AssetSetRows,
    type ListViewRowOrderInput,
} from "./assetRowOrder";

function asset(id: string, groupId?: string): Asset {
    return {
        id,
        type: AssetType.Image,
        name: `${id}.png`,
        hash: `hash-${id}`,
        source: AssetSource.Local,
        meta: {},
        tags: [],
        description: "",
        groupId,
    };
}

function group(id: string, parentGroupId?: string): AssetGroup {
    return { id, name: id, category: AssetCategory.Image, parentGroupId, createdAt: 0, updatedAt: 0 };
}

/** A set of cells, written the way the tree reads them: one file, one sub-set, or a hole. */
function cells(...entries: Array<string | string[] | { child: string } | null>): AssetSetRowCell[] {
    return entries.map(entry => {
        if (entry === null) {
            return { assetIds: [], childSetIds: [] };
        }
        if (typeof entry === "string") {
            return { assetIds: [entry], childSetIds: [] };
        }
        if (Array.isArray(entry)) {
            return { assetIds: entry, childSetIds: [] };
        }
        return { assetIds: [], childSetIds: [entry.child] };
    });
}

function assetSet(id: string, cellList: AssetSetRowCell[], groupId?: string): AssetSetRows {
    return { set: { id, ...(groupId ? { groupId } : {}) }, contents: { cells: cellList } };
}

function categoryRecord<T>(images: T[]): Record<AssetCategory, T[]> {
    const record = createEmptyAssetCategoryRecord<T>();
    record[AssetCategory.Image] = images;
    return record;
}

/**
 * The keys of every row the tree draws, which is the projection `AssetsListView` publishes as its
 * range: the sections it is drawing, in order, each walked once. The image section unless a test
 * says otherwise.
 */
function order(
    input: Partial<ListViewRowOrderInput> & Pick<ListViewRowOrderInput, "assets" | "groups">,
    openCategories: readonly AssetCategory[] = [AssetCategory.Image],
): string[] {
    const full: ListViewRowOrderInput = {
        rootAssetSets: createEmptyAssetCategoryRecord<AssetSetRows>(),
        assetSets: createEmptyAssetCategoryRecord<AssetSetRows>(),
        memberAssetIds: new Set<string>(),
        expandedGroups: new Set<string>(),
        expandedAssetSets: new Set<string>(),
        isNarrowed: false,
        ...input,
    };
    return ASSET_CATEGORY_ORDER
        .filter(category => openCategories.includes(category))
        .flatMap(category => listViewCategoryRows(category, full))
        .map(row => row.selectionKey)
        .filter((key): key is string => key !== null);
}

/** What a shift range from one row to another would mark. */
function range(keys: string[], from: string, to: string): string[] {
    const a = keys.indexOf(from);
    const b = keys.indexOf(to);
    expect(a).toBeGreaterThanOrEqual(0);
    expect(b).toBeGreaterThanOrEqual(0);
    return keys.slice(Math.min(a, b), Math.max(a, b) + 1);
}

/*
 * The reported library: a folder holding two loose files, and two more files that belong to a set
 * filed at the top of the section. The members were imported into the folder like everything else -
 * a set holds no files - but they are drawn inside the set and nowhere else.
 */
const BACKDROPS = group("g-backdrops");
const ROOM = asset("room", BACKDROPS.id);
const STREET = asset("street", BACKDROPS.id);
const ALICE_HAPPY = asset("alice-happy", BACKDROPS.id);
const ALICE_SAD = asset("alice-sad", BACKDROPS.id);
const ALICE = assetSet("set-alice", cells(ALICE_HAPPY.id, ALICE_SAD.id));

const reported = {
    assets: categoryRecord([ROOM, ALICE_HAPPY, ALICE_SAD, STREET]),
    groups: categoryRecord([BACKDROPS]),
    rootAssetSets: categoryRecord([ALICE]),
    assetSets: categoryRecord([ALICE]),
    memberAssetIds: new Set([ALICE_HAPPY.id, ALICE_SAD.id]),
    expandedGroups: new Set([BACKDROPS.id]),
};

describe("the tree's row order", () => {
    it("does not put a set's members in the folder they were imported into", () => {
        const keys = order(reported);

        expect(keys).toEqual(["group:g-backdrops", "asset:room", "asset:street"]);
        // The defect: ranging over two loose files used to sweep up every member filed between
        // them, and the set lit up on the other side of the panel.
        expect(range(keys, "asset:room", "asset:street")).toEqual(["asset:room", "asset:street"]);
    });

    it("draws a set's members inside the set once it is open", () => {
        const keys = order({ ...reported, expandedAssetSets: new Set([ALICE.set.id]) });

        expect(keys).toEqual([
            "asset:alice-happy",
            "asset:alice-sad",
            "group:g-backdrops",
            "asset:room",
            "asset:street",
        ]);
        expect(range(keys, "asset:room", "asset:street")).toEqual(["asset:room", "asset:street"]);
    });

    it("gives no key to a set's own row, so a range cannot mark one", () => {
        const keys = order({ ...reported, expandedAssetSets: new Set([ALICE.set.id]) });

        expect(keys).not.toContain("group:set-alice");
        expect(keys).not.toContain("asset:set-alice");
    });

    it("gives no key to a value no single file answers", () => {
        const holes = assetSet("set-holes", cells(ROOM.id, null, [ALICE_HAPPY.id, ALICE_SAD.id]));
        const keys = order({
            assets: categoryRecord([ROOM, ALICE_HAPPY, ALICE_SAD]),
            groups: categoryRecord([]),
            rootAssetSets: categoryRecord([holes]),
            assetSets: categoryRecord([holes]),
            // Both files carry the ambiguous value's tags, so both are members and neither is drawn
            // beside the set. The set draws one row saying so, and it answers to nothing.
            memberAssetIds: new Set([ROOM.id, ALICE_HAPPY.id, ALICE_SAD.id]),
            expandedAssetSets: new Set([holes.set.id]),
        });

        expect(keys).toEqual(["asset:room"]);
    });

    it("draws a sub-set where it hangs, and only while both sets are open", () => {
        const cover = asset("cover");
        const aliceEn = asset("alice-en");
        const aliceJa = asset("alice-ja");
        const title = asset("title");
        const locale = assetSet("set-locale", cells(aliceEn.id, aliceJa.id));
        const parent = assetSet("set-parent", cells(cover.id, { child: locale.set.id }));
        const input = {
            assets: categoryRecord([cover, aliceEn, aliceJa, title]),
            groups: categoryRecord<AssetGroup>([]),
            rootAssetSets: categoryRecord([parent]),
            assetSets: categoryRecord([parent, locale]),
            memberAssetIds: new Set([cover.id, aliceEn.id, aliceJa.id]),
        };

        expect(order({ ...input, expandedAssetSets: new Set([parent.set.id]) }))
            .toEqual(["asset:cover", "asset:title"]);
        expect(order({ ...input, expandedAssetSets: new Set([parent.set.id, locale.set.id]) }))
            .toEqual(["asset:cover", "asset:alice-en", "asset:alice-ja", "asset:title"]);
    });

    it("leaves out the files in a collapsed folder", () => {
        const loose = asset("title");
        const keys = order({
            assets: categoryRecord([loose, ROOM, STREET]),
            groups: categoryRecord([BACKDROPS]),
        });

        expect(keys).toEqual(["group:g-backdrops", "asset:title"]);
    });

    it("opens every folder while a search is narrowing the library", () => {
        const keys = order({
            assets: categoryRecord([ROOM, STREET]),
            groups: categoryRecord([BACKDROPS]),
            isNarrowed: true,
        });

        expect(keys).toEqual(["group:g-backdrops", "asset:room", "asset:street"]);
    });

    it("leaves out a section the accordion is drawing closed", () => {
        const library = createEmptyAssetCategoryRecord<Asset>();
        library[AssetCategory.Image] = [asset("title")];
        library[AssetCategory.Media] = [{ ...asset("theme"), type: AssetType.Audio }];
        const noGroups = createEmptyAssetCategoryRecord<AssetGroup>();

        expect(order({ assets: library, groups: noGroups })).toEqual(["asset:title"]);
        expect(order(
            { assets: library, groups: noGroups },
            [AssetCategory.Image, AssetCategory.Media],
        )).toEqual(["asset:title", "asset:theme"]);
    });

    it("orders a folder's own rows sets first, then folders, then files", () => {
        const inner = group("g-inner", BACKDROPS.id);
        const filed = assetSet("set-filed", cells(ALICE_HAPPY.id), BACKDROPS.id);
        const keys = order({
            assets: categoryRecord([ROOM, ALICE_HAPPY]),
            groups: categoryRecord([BACKDROPS, inner]),
            rootAssetSets: categoryRecord([filed]),
            assetSets: categoryRecord([filed]),
            memberAssetIds: new Set([ALICE_HAPPY.id]),
            expandedGroups: new Set([BACKDROPS.id, inner.id]),
            expandedAssetSets: new Set([filed.set.id]),
        });

        expect(keys).toEqual([
            "group:g-backdrops",
            "asset:alice-happy",
            "group:g-inner",
            "asset:room",
        ]);
    });
});

describe("iconViewRowOrder", () => {
    it("walks the sections the grid drew, folders before files", () => {
        const keys = iconViewRowOrder([
            { groups: [BACKDROPS], assets: [ROOM, STREET], setCells: [] },
            { groups: [], assets: [asset("theme")], setCells: [] },
        ]);

        expect(keys).toEqual(["group:g-backdrops", "asset:room", "asset:street", "asset:theme"]);
    });

    it("marks only the files a set answers with once the grid has stepped into one", () => {
        const keys = iconViewRowOrder([{
            groups: [],
            assets: [],
            setCells: cells(ALICE_HAPPY.id, null, { child: "set-locale" }, ALICE_SAD.id),
        }]);

        expect(keys).toEqual(["asset:alice-happy", "asset:alice-sad"]);
    });
});
