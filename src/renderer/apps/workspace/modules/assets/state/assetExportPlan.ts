import { Asset, AssetGroup } from "@/lib/workspace/services/assets/types";
import { AssetCategory } from "@/lib/workspace/services/assets/assetTypes";
import type { AssetActionTarget } from "./assetActionTargets";

/**
 * What an export writes: one library file, and the name it takes outside the project.
 *
 * The two halves are separate because nothing on disk carries the author-facing name - an asset's
 * bytes live at an id-sharded path with no extension - so the name has to be rebuilt from the
 * record, and the folder structure from wherever the row sat in the library.
 */
export interface AssetExportPlanEntry {
    asset: Asset;
    /** Relative to the folder the author picks, `/`-separated. */
    relativePath: string;
}

export interface BuildAssetExportPlanParams {
    /** Rows the action applies to, from `resolveAssetActionTargets`. */
    targets: readonly AssetActionTarget[];
    assets: Record<AssetCategory, Asset[]>;
    groups: Record<AssetCategory, AssetGroup[]>;
}

/**
 * The filename an asset is exported under.
 *
 * `name` is what the author typed and may or may not already carry the extension, while `ext` is
 * what the bytes actually are; appending unconditionally would produce `hero.png.png` for half the
 * library. Matches `assetFileName` in the portability lint, which answers the same question about
 * the same records.
 */
export function assetExportFileName(asset: Asset): string {
    const name = asset.name.trim() || asset.id;
    const ext = asset.ext?.trim().replace(/^\./, "");
    if (!ext) {
        return name;
    }
    return name.toLowerCase().endsWith(`.${ext.toLowerCase()}`) ? name : `${name}.${ext}`;
}

/** Whether any ancestor of `groupId` is itself being exported, walking up until the tree runs out. */
function hasTargetedAncestor(
    groupId: string | undefined,
    targetedGroupIds: ReadonlySet<string>,
    groupById: ReadonlyMap<string, AssetGroup>,
): boolean {
    const seen = new Set<string>();
    let current = groupId;
    while (current && !seen.has(current)) {
        if (targetedGroupIds.has(current)) {
            return true;
        }
        seen.add(current);
        current = groupById.get(current)?.parentGroupId;
    }
    return false;
}

/**
 * The files an export of `targets` writes, and where each lands.
 *
 * A selected folder exports as a folder: its assets keep their place under a directory named after
 * it, nested groups and all. Flattening would be the wrong answer for the case the structure exists
 * for - a hundred sprites in a dozen folders, all landing beside each other with names that only
 * ever had to be unique within their own folder.
 *
 * Rows already covered by a selected folder drop out, so selecting a group *and* something inside it
 * exports that thing once, in its place - the same de-duplication copy and cut already do.
 */
export function buildAssetExportPlan({ targets, assets, groups }: BuildAssetExportPlanParams): AssetExportPlanEntry[] {
    const allGroups = Object.values(groups).flat();
    const groupById = new Map<string, AssetGroup>(allGroups.map(group => [group.id, group]));

    const targetedGroupIds = new Set(
        targets.filter(target => target.isGroup).map(target => target.item.id),
    );

    const entries: AssetExportPlanEntry[] = [];
    const taken = new Set<string>();

    const pushAsset = (asset: Asset, prefix: readonly string[]): void => {
        if (taken.has(asset.id)) {
            return;
        }
        taken.add(asset.id);
        entries.push({ asset, relativePath: [...prefix, assetExportFileName(asset)].join("/") });
    };

    const pushGroup = (group: AssetGroup, category: AssetCategory, prefix: readonly string[]): void => {
        const folder = [...prefix, group.name.trim() || group.id];
        for (const asset of assets[category] ?? []) {
            if (asset.groupId === group.id) {
                pushAsset(asset, folder);
            }
        }
        for (const child of groups[category] ?? []) {
            if (child.parentGroupId === group.id) {
                pushGroup(child, category, folder);
            }
        }
    };

    for (const target of targets) {
        if (target.isGroup) {
            const group = target.item as AssetGroup;
            if (hasTargetedAncestor(group.parentGroupId, targetedGroupIds, groupById)) {
                continue;
            }
            pushGroup(group, target.category, []);
            continue;
        }

        const asset = target.item as Asset;
        if (hasTargetedAncestor(asset.groupId, targetedGroupIds, groupById)) {
            continue;
        }
        pushAsset(asset, []);
    }

    return entries;
}
