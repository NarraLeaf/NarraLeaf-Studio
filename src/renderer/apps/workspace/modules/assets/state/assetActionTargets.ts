import { Asset, AssetGroup } from "@/lib/workspace/services/assets/types";
import { AssetCategory, categoryOfAssetType } from "@/lib/workspace/services/assets/assetTypes";

export interface ContextMenuTargetState {
    /** The sidebar section the row was drawn in — what every group-level service call takes. */
    category: AssetCategory;
    item: Asset | AssetGroup | null;
    isGroup: boolean;
    /**
     * The set value this row is being drawn as the answer to, when it is drawn inside a set.
     *
     * A member is an ordinary file and its menu is the ordinary one; this is what adds the single
     * row that belongs to the place rather than to the file — the sub-set that hangs at this value.
     */
    assetSetValue?: { setId: string; value: string };
}

/** One row an action will act on, carrying enough to call the group or asset service method. */
export interface AssetActionTarget {
    isGroup: boolean;
    category: AssetCategory;
    item: Asset | AssetGroup;
}

export interface ResolveAssetActionTargetsParams {
    /** Selection keys (`asset:id` / `group:id`). */
    selectedItems: ReadonlySet<string>;
    /** The row the context menu was opened on, or null when no menu is open. */
    contextMenuTarget: ContextMenuTargetState | null;
    /** Selection key of the focused row, used only when nothing else points anywhere. */
    focusedItemId: string | null;
    assets: Record<AssetCategory, Asset[]>;
    groups: Record<AssetCategory, AssetGroup[]>;
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
    assets: Record<AssetCategory, Asset[]>,
    groups: Record<AssetCategory, AssetGroup[]>,
): AssetActionTarget[] {
    const assetById = new Map<string, Asset>();
    for (const asset of Object.values(assets).flat()) {
        assetById.set(asset.id, asset);
    }

    const groupById = new Map<string, { group: AssetGroup; category: AssetCategory }>();
    for (const [category, groupList] of Object.entries(groups)) {
        for (const group of groupList) {
            groupById.set(group.id, { group, category: category as AssetCategory });
        }
    }

    const targets: AssetActionTarget[] = [];
    const seen = new Set<string>();
    for (const key of keys) {
        if (key.startsWith(ASSET_KEY_PREFIX)) {
            const asset = assetById.get(key.slice(ASSET_KEY_PREFIX.length));
            if (asset && !seen.has(key)) {
                seen.add(key);
                targets.push({ isGroup: false, category: categoryOfAssetType(asset.type), item: asset });
            }
        } else if (key.startsWith(GROUP_KEY_PREFIX)) {
            const entry = groupById.get(key.slice(GROUP_KEY_PREFIX.length));
            if (entry && !seen.has(key)) {
                seen.add(key);
                targets.push({ isGroup: true, category: entry.category, item: entry.group });
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
        return [{ isGroup: contextMenuTarget.isGroup, category: contextMenuTarget.category, item: contextMenuTarget.item }];
    }

    if (selectedItems.size > 0) {
        return resolveSelectionKeys(selectedItems, assets, groups);
    }

    if (focusedItemId) {
        return resolveSelectionKeys([focusedItemId], assets, groups);
    }

    return [];
}

/**
 * Whether the menu on this target is about a file that has not arrived yet.
 *
 * ❗ **The one case where the menu is a single row.** Every command an asset row offers is about a
 * file - export it, copy it, swap its bytes, rename the thing it is - and a record whose file is
 * still crossing the room has none of that to act on. So while it is arriving the menu offers the
 * one thing that does mean something, which is to stop it.
 *
 * A folder is never this: a folder has no bytes, so nothing about it can be in flight. Neither is a
 * multi-row menu, which is offering counts rather than one file.
 */
export function contextMenuTargetIsArriving(
    target: ContextMenuTargetState | null,
    transfers: Readonly<Record<string, number>>,
): boolean {
    if (!target || target.isGroup || !target.item) {
        return false;
    }
    return transfers[target.item.id] !== undefined;
}
