import type { BlueprintOwnerRef } from "@shared/types/blueprint/document";

export const GLOBAL_MAIN_OWNER_KEY = "globalMain";

export function surfaceMainOwnerKey(surfaceId: string): string {
    return `surfaceMain:${surfaceId}`;
}

export function widgetMainOwnerKey(surfaceId: string, elementId: string): string {
    return `widgetMain:${surfaceId}:${elementId}`;
}

export function ownerRefToIndexKey(owner: BlueprintOwnerRef): string {
    switch (owner.kind) {
        case "globalMain":
            return GLOBAL_MAIN_OWNER_KEY;
        case "surfaceMain":
            return surfaceMainOwnerKey(owner.surfaceId);
        case "widgetMain":
            return widgetMainOwnerKey(owner.surfaceId, owner.elementId);
        case "sharedAsset":
            return `sharedAsset:${owner.assetId}`;
        default: {
            const _exhaustive: never = owner;
            return _exhaustive;
        }
    }
}
