import { describe, expect, it } from "vitest";
import { AssetCategory, AssetType } from "@/lib/workspace/services/assets/assetTypes";
import { Asset, AssetGroup, AssetSource } from "@/lib/workspace/services/assets/types";
import type { AssetActionTarget } from "./assetActionTargets";
import { assetExportFileName, buildAssetExportPlan } from "./assetExportPlan";

function asset(id: string, name: string, options: { ext?: string; groupId?: string } = {}): Asset {
  return {
    id,
    type: AssetType.Image,
    name,
    hash: `hash-${id}`,
    ext: options.ext,
    source: AssetSource.Local,
    meta: {},
    tags: [],
    description: "",
    groupId: options.groupId
  };
}

function group(id: string, name: string, parentGroupId?: string): AssetGroup {
  return { id, name, category: AssetCategory.Image, parentGroupId, createdAt: 0, updatedAt: 0 };
}

function tableOf<T>(images: T[]): Record<AssetCategory, T[]> {
  return {
    [AssetCategory.Image]: images,
    [AssetCategory.Media]: [],
    [AssetCategory.Data]: [],
    [AssetCategory.Font]: [],
    [AssetCategory.Model]: [],
    [AssetCategory.Other]: []
  } as Record<AssetCategory, T[]>;
}

function assetTarget(item: Asset): AssetActionTarget {
  return { isGroup: false, category: AssetCategory.Image, item };
}

function groupTarget(item: AssetGroup): AssetActionTarget {
  return { isGroup: true, category: AssetCategory.Image, item };
}

describe("assetExportFileName", () => {
  it("appends the real extension when the name does not already carry it", () => {
    expect(assetExportFileName(asset("a1", "room", { ext: "png" }))).toBe("room.png");
  });

  it("leaves a name that already ends in the extension alone, whatever its case", () => {
    expect(assetExportFileName(asset("a1", "room.PNG", { ext: "png" }))).toBe("room.PNG");
  });

  it("falls back to the id rather than exporting a file with no name", () => {
    expect(assetExportFileName(asset("a1", "   "))).toBe("a1");
  });
});

describe("buildAssetExportPlan", () => {
  it("puts loose assets at the top of the chosen folder", () => {
    const room = asset("a1", "room", { ext: "png" });
    const plan = buildAssetExportPlan({
      targets: [assetTarget(room)],
      assets: tableOf([room]),
      groups: tableOf<AssetGroup>([])
    });

    expect(plan).toEqual([{ asset: room, relativePath: "room.png" }]);
  });

  it("exports a group as a folder, nested groups and all", () => {
    const backdrops = group("g1", "backdrops");
    const night = group("g2", "night", "g1");
    const room = asset("a1", "room", { ext: "png", groupId: "g1" });
    const alley = asset("a2", "alley", { ext: "png", groupId: "g2" });

    const plan = buildAssetExportPlan({
      targets: [groupTarget(backdrops)],
      assets: tableOf([room, alley]),
      groups: tableOf([backdrops, night])
    });

    expect(plan.map((entry) => entry.relativePath).sort()).toEqual([
      "backdrops/night/alley.png",
      "backdrops/room.png"
    ]);
  });

  it("exports something inside a selected group once, in its place", () => {
    const backdrops = group("g1", "backdrops");
    const room = asset("a1", "room", { ext: "png", groupId: "g1" });

    const plan = buildAssetExportPlan({
      targets: [assetTarget(room), groupTarget(backdrops)],
      assets: tableOf([room]),
      groups: tableOf([backdrops])
    });

    expect(plan).toEqual([{ asset: room, relativePath: "backdrops/room.png" }]);
  });

  it("keeps a nested group's own row from also landing at the top level", () => {
    const backdrops = group("g1", "backdrops");
    const night = group("g2", "night", "g1");
    const alley = asset("a1", "alley", { ext: "png", groupId: "g2" });

    const plan = buildAssetExportPlan({
      // The child listed first: order must not decide where its contents land.
      targets: [groupTarget(night), groupTarget(backdrops)],
      assets: tableOf([alley]),
      groups: tableOf([backdrops, night])
    });

    expect(plan).toEqual([{ asset: alley, relativePath: "backdrops/night/alley.png" }]);
  });

  it("plans nothing for an empty folder", () => {
    const empty = group("g1", "empty");

    expect(
      buildAssetExportPlan({
        targets: [groupTarget(empty)],
        assets: tableOf([]),
        groups: tableOf([empty])
      })
    ).toEqual([]);
  });
});
