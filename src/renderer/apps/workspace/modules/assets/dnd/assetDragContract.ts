import { AssetType } from "@/lib/workspace/services/assets/assetTypes";
import type { Asset, AssetGroup, AssetsMap } from "@/lib/workspace/services/assets/types";

/** Custom MIME for cross-workspace HTML5 DnD (renderer-local). */
export const ASSET_DRAG_MIME = "application/x-narraleaf-assets+json";

/** Wire format v1 — keep keys short for dataTransfer limits. */
export interface AssetDragWirePayloadV1 {
    v: 1;
    /** Primary dragged asset id (for consumers that only handle one). */
    p: string;
    /** Asset entries: id + type discriminator. */
    i: { id: string; t: AssetType }[];
    /** Optional source panel id for telemetry / future use. */
    s?: string;
}

export type AssetDragWirePayload = AssetDragWirePayloadV1;

/**
 * Encode assets for dataTransfer. Caller must pass non-empty list; primaryId must exist in list.
 */
export function encodeAssetDragPayload(assets: Asset[], primaryId: string, sourcePanelId?: string): string {
    const i = assets.map(a => ({ id: a.id, t: a.type }));
    const payload: AssetDragWirePayloadV1 = {
        v: 1,
        p: primaryId,
        i,
        ...(sourcePanelId ? { s: sourcePanelId } : {}),
    };
    return JSON.stringify(payload);
}

export function decodeAssetDragPayload(raw: string | null | undefined): AssetDragWirePayloadV1 | null {
    if (!raw || typeof raw !== "string") {
        return null;
    }
    try {
        const parsed = JSON.parse(raw) as unknown;
        if (!parsed || typeof parsed !== "object") {
            return null;
        }
        const o = parsed as Record<string, unknown>;
        if (o.v !== 1 || typeof o.p !== "string" || !Array.isArray(o.i)) {
            return null;
        }
        const items: { id: string; t: AssetType }[] = [];
        for (const row of o.i) {
            if (!row || typeof row !== "object") {
                return null;
            }
            const r = row as Record<string, unknown>;
            if (typeof r.id !== "string" || typeof r.t !== "string") {
                return null;
            }
            if (!Object.values(AssetType).includes(r.t as AssetType)) {
                return null;
            }
            items.push({ id: r.id, t: r.t as AssetType });
        }
        if (items.length === 0) {
            return null;
        }
        const primaryOk = items.some(x => x.id === o.p);
        if (!primaryOk) {
            return null;
        }
        const out: AssetDragWirePayloadV1 = {
            v: 1,
            p: o.p,
            i: items,
        };
        if (typeof o.s === "string") {
            out.s = o.s;
        }
        return out;
    } catch {
        return null;
    }
}

/**
 * Resolve wire items to full Asset objects using current project metadata (order preserved).
 */
export function resolveAssetsFromDragPayload(payload: AssetDragWirePayloadV1, map: AssetsMap): Asset[] {
    const out: Asset[] = [];
    for (const { id, t } of payload.i) {
        const a = map[t]?.[id];
        if (a) {
            out.push(a as Asset);
        }
    }
    return out;
}

/**
 * Build stable ordering of `asset:id` keys matching the assets panel tree walk (root groups then assets per type).
 */
export function buildOrderedAssetSelectionKeys(
    groupsByType: Record<AssetType, AssetGroup[]>,
    assetsByType: Record<AssetType, Asset[]>
): string[] {
    const orderedKeys: string[] = [];
    const traverseGroups = (grpList: AssetGroup[], assetList: Asset[], parentId?: string) => {
        grpList.filter(g => g.parentGroupId === parentId).forEach(g => {
            orderedKeys.push(`group:${g.id}`);
            traverseGroups(grpList, assetList, g.id);
        });
        assetList.filter(a => (a.groupId || undefined) === (parentId || undefined)).forEach(a => {
            orderedKeys.push(`asset:${a.id}`);
        });
    };
    for (const t of Object.values(AssetType)) {
        traverseGroups(groupsByType[t] ?? [], assetsByType[t] ?? []);
    }
    return orderedKeys;
}

/**
 * Pick which assets participate in an external workspace drag when starting from one asset row.
 * - If the dragged asset is part of a multi asset selection, drag all selected assets in list order.
 * - Otherwise drag only the primary asset.
 * - Group-only selections do not add assets; falls back to [primaryAsset].
 */
export function collectAssetsForWorkspaceDrag(
    primaryAsset: Asset,
    selectedItems: Set<string>,
    filteredGroups: Record<AssetType, AssetGroup[]>,
    filteredAssets: Record<AssetType, Asset[]>
): Asset[] {
    const selectedAssetIds = new Set<string>();
    for (const key of selectedItems) {
        if (key.startsWith("asset:")) {
            selectedAssetIds.add(key.slice("asset:".length));
        }
    }

    // Drag may start before click updates selection; if primary is not in the multi-selection, drag only it.
    if (!selectedAssetIds.has(primaryAsset.id)) {
        return [primaryAsset];
    }

    if (selectedAssetIds.size <= 1) {
        return [primaryAsset];
    }

    const orderedKeys = buildOrderedAssetSelectionKeys(filteredGroups, filteredAssets);
    const orderedAssets: Asset[] = [];
    for (const key of orderedKeys) {
        if (!key.startsWith("asset:")) {
            continue;
        }
        const id = key.slice("asset:".length);
        if (!selectedAssetIds.has(id)) {
            continue;
        }
        const asset = Object.values(filteredAssets)
            .flat()
            .find(a => a.id === id);
        if (asset) {
            orderedAssets.push(asset);
        }
    }

    if (orderedAssets.length === 0) {
        return [primaryAsset];
    }
    return orderedAssets;
}

export function isWorkspaceAssetDragEvent(dt: DataTransfer | null | undefined): boolean {
    if (!dt) {
        return false;
    }
    return Array.from(dt.types).includes(ASSET_DRAG_MIME);
}
