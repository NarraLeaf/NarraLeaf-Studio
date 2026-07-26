import { describe, expect, it } from "vitest";
import { AssetType } from "@/lib/workspace/services/assets/assetTypes";
import { Asset, AssetGroup, AssetSource } from "@/lib/workspace/services/assets/types";
import {
    contextMenuActsOnSelection,
    resolveAssetActionTargets,
    type ContextMenuTargetState,
} from "./assetActionTargets";

function asset(id: string, name: string, groupId?: string): Asset {
    return {
        id,
        type: AssetType.Image,
        name,
        hash: `hash-${id}`,
        source: AssetSource.Local,
        meta: {},
        tags: [],
        description: "",
        groupId,
    };
}

function group(id: string, name: string, parentGroupId?: string): AssetGroup {
    return { id, name, type: AssetType.Image, parentGroupId, createdAt: 0, updatedAt: 0 };
}

const room = asset("a1", "room.jpg");
const outside = asset("a2", "outside.jpg");
const backdrops = group("g1", "backdrops");

const assets = {
    [AssetType.Image]: [room, outside],
    [AssetType.Audio]: [],
    [AssetType.Video]: [],
    [AssetType.JSON]: [],
    [AssetType.Blueprint]: [],
    [AssetType.Font]: [],
    [AssetType.Other]: [],
} as Record<AssetType, Asset[]>;

const groups = {
    [AssetType.Image]: [backdrops],
    [AssetType.Audio]: [],
    [AssetType.Video]: [],
    [AssetType.JSON]: [],
    [AssetType.Blueprint]: [],
    [AssetType.Font]: [],
    [AssetType.Other]: [],
} as Record<AssetType, AssetGroup[]>;

function menuOn(item: Asset | AssetGroup | null, isGroup = false): ContextMenuTargetState {
    return { type: AssetType.Image, item, isGroup };
}

function resolve(params: {
    selectedItems?: string[];
    contextMenuTarget?: ContextMenuTargetState | null;
    focusedItemId?: string | null;
}) {
    return resolveAssetActionTargets({
        selectedItems: new Set(params.selectedItems ?? []),
        contextMenuTarget: params.contextMenuTarget ?? null,
        focusedItemId: params.focusedItemId ?? null,
        assets,
        groups,
    });
}

describe("resolveAssetActionTargets", () => {
    it("acts on the right-clicked row when it is not part of the selection", () => {
        const targets = resolve({
            selectedItems: ["asset:a1"],
            contextMenuTarget: menuOn(outside),
        });

        expect(targets).toEqual([{ isGroup: false, type: AssetType.Image, item: outside }]);
    });

    it("acts on the whole selection when the right-clicked row is part of it", () => {
        const targets = resolve({
            selectedItems: ["asset:a1", "asset:a2"],
            contextMenuTarget: menuOn(room),
        });

        expect(targets.map(target => target.item)).toEqual([room, outside]);
    });

    it("does not confuse a group with an asset that shares its id", () => {
        const sameId = group("a1", "a1 folder");
        const targets = resolveAssetActionTargets({
            selectedItems: new Set(["asset:a1"]),
            contextMenuTarget: menuOn(sameId, true),
            focusedItemId: null,
            assets,
            groups: { ...groups, [AssetType.Image]: [sameId] },
        });

        expect(targets).toEqual([{ isGroup: true, type: AssetType.Image, item: sameId }]);
    });

    it("acts on the right-clicked row when nothing is selected", () => {
        const targets = resolve({ contextMenuTarget: menuOn(backdrops, true) });

        expect(targets).toEqual([{ isGroup: true, type: AssetType.Image, item: backdrops }]);
    });

    it("acts on the selection when no context menu is open", () => {
        const targets = resolve({ selectedItems: ["group:g1", "asset:a2"], focusedItemId: "asset:a1" });

        expect(targets.map(target => target.item)).toEqual([backdrops, outside]);
    });

    it("falls back to the focused row only when nothing is selected or right-clicked", () => {
        expect(resolve({ focusedItemId: "asset:a1" }).map(target => target.item)).toEqual([room]);
        expect(resolve({ focusedItemId: "asset:missing" })).toEqual([]);
        expect(resolve({})).toEqual([]);
    });

    it("drops selection keys whose row no longer exists", () => {
        const targets = resolve({ selectedItems: ["asset:a1", "asset:gone", "group:gone"] });

        expect(targets.map(target => target.item)).toEqual([room]);
    });
});

describe("contextMenuActsOnSelection", () => {
    it("is false for a right-click outside the selection", () => {
        expect(contextMenuActsOnSelection(menuOn(outside), new Set(["asset:a1"]))).toBe(false);
    });

    it("is true for a right-click on a selected row", () => {
        expect(contextMenuActsOnSelection(menuOn(outside), new Set(["asset:a1", "asset:a2"]))).toBe(true);
    });

    it("is true when no row was right-clicked", () => {
        expect(contextMenuActsOnSelection(null, new Set(["asset:a1"]))).toBe(true);
        expect(contextMenuActsOnSelection(menuOn(null), new Set(["asset:a1"]))).toBe(true);
    });
});
