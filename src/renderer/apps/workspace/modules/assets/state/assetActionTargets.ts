import { Asset, AssetGroup } from "@/lib/workspace/services/assets/types";
import { AssetType } from "@/lib/workspace/services/assets/assetTypes";

export interface ContextMenuTargetState {
    type: AssetType;
    item: Asset | AssetGroup | null;
    isGroup: boolean;
}

/** One row an action will act on, carrying enough to call the group or asset service method. */
export interface AssetActionTarget {
    isGroup: boolean;
    type: AssetType;
    item: Asset | AssetGroup;
}

export interface ResolveAssetActionTargetsParams {
    /** Selection keys (`asset:id` / `group:id`). */
    selectedItems: ReadonlySet<string>;
    /** The row the context menu was opened on, or null when no menu is open. */
    contextMenuTarget: ContextMenuTargetState | null;
    /** Selection key of the focused row, used only when nothing else points anywhere. */
    focusedItemId: string | null;
    assets: Record<AssetType, Asset[]>;
    groups: Record<AssetType, AssetGroup[]>;
}

const ASSET_KEY_PREFIX = "asset:";
const GROUP_KEY_PREFIX = "group:";

/** Selection key for a row, matching the keys `useMultiSelection` stores. */
export function assetSelectionKey(id: string, isGroup: boolean): string {
    return `${isGroup ? GROUP_KEY_PREFIX : ASSET_KEY_PREFIX}${id}`;
}

/**
 * Whether an action invoked from the context menu should act on the whole selection.
 *
 * Right-clicking a row does not change the selection, so the row under the cursor and the selected
 * rows can disagree. A right-click on a row that is *not* selected means that row - the same rule
 * the drag path already follows in `collectAssetsForWorkspaceDrag`. Anything else (a right-click on
 * a selected row, or away from any row) leaves the selection in charge.
 */
export function contextMenuActsOnSelection(
    contextMenuTarget: ContextMenuTargetState | null,
    selectedItems: ReadonlySet<string>,
): boolean {
    const item = contextMenuTarget?.item;
    if (!contextMenuTarget || !item) {
        return true;
    }
    return selectedItems.has(assetSelectionKey(item.id, contextMenuTarget.isGroup));
}

function resolveSelectionKeys(
    keys: Iterable<string>,
    assets: Record<AssetType, Asset[]>,
    groups: Record<AssetType, AssetGroup[]>,
): AssetActionTarget[] {
    const assetById = new Map<string, Asset>();
    for (const asset of Object.values(assets).flat()) {
        assetById.set(asset.id, asset);
    }

    const groupById = new Map<string, { group: AssetGroup; type: AssetType }>();
    for (const [type, groupList] of Object.entries(groups)) {
        for (const group of groupList) {
            groupById.set(group.id, { group, type: type as AssetType });
        }
    }

    const targets: AssetActionTarget[] = [];
    const seen = new Set<string>();
    for (const key of keys) {
        if (key.startsWith(ASSET_KEY_PREFIX)) {
            const asset = assetById.get(key.slice(ASSET_KEY_PREFIX.length));
            if (asset && !seen.has(key)) {
                seen.add(key);
                targets.push({ isGroup: false, type: asset.type, item: asset });
            }
        } else if (key.startsWith(GROUP_KEY_PREFIX)) {
            const entry = groupById.get(key.slice(GROUP_KEY_PREFIX.length));
            if (entry && !seen.has(key)) {
                seen.add(key);
                targets.push({ isGroup: true, type: entry.type, item: entry.group });
            }
        }
    }

    return targets;
}

/**
 * The rows a panel action (copy, cut, rename, delete) applies to.
 *
 * Every action resolves through here so the menu label and the work agree: selecting one asset and
 * then right-clicking another used to delete the *selected* one, because each handler re-derived
 * its own targets and put the selection first.
 */
export function resolveAssetActionTargets({
    selectedItems,
    contextMenuTarget,
    focusedItemId,
    assets,
    groups,
}: ResolveAssetActionTargetsParams): AssetActionTarget[] {
    if (contextMenuTarget?.item && !contextMenuActsOnSelection(contextMenuTarget, selectedItems)) {
        return [{ isGroup: contextMenuTarget.isGroup, type: contextMenuTarget.type, item: contextMenuTarget.item }];
    }

    if (selectedItems.size > 0) {
        return resolveSelectionKeys(selectedItems, assets, groups);
    }

    if (focusedItemId) {
        return resolveSelectionKeys([focusedItemId], assets, groups);
    }

    return [];
}
