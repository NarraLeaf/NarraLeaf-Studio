import type { BlueprintOwnerRef } from "@shared/types/blueprint/document";

export const GLOBAL_MAIN_OWNER_KEY = "globalMain";

export function surfaceMainOwnerKey(surfaceId: string): string {
    return `surfaceMain:${surfaceId}`;
}

export function widgetMainOwnerKey(surfaceId: string, elementId: string): string {
    return `widgetMain:${surfaceId}:${elementId}`;
}

export function componentWidgetMainOwnerKey(componentId: string, elementId: string): string {
    return `componentWidgetMain:${componentId}:${elementId}`;
}

function encodeOwnerPart(value: string): string {
    return encodeURIComponent(value);
}

function decodeOwnerPart(value: string): string {
    try {
        return decodeURIComponent(value);
    } catch {
        return value;
    }
}

export function widgetValueOwnerKey(surfaceId: string, elementId: string, propPath: string): string {
    return `widgetValue:${surfaceId}:${elementId}:${encodeOwnerPart(propPath)}`;
}

export function decodeWidgetValueOwnerKey(ownerKey: string): {
    surfaceId: string;
    elementId: string;
    propPath: string;
} | null {
    const match = /^widgetValue:([^:]+):([^:]+):(.+)$/.exec(ownerKey);
    if (!match) {
        return null;
    }
    return {
        surfaceId: match[1],
        elementId: match[2],
        propPath: decodeOwnerPart(match[3]),
    };
}

export function ownerRefToIndexKey(owner: BlueprintOwnerRef): string {
    switch (owner.kind) {
        case "globalMain":
            return GLOBAL_MAIN_OWNER_KEY;
        case "surfaceMain":
            return surfaceMainOwnerKey(owner.surfaceId);
        case "widgetMain":
            return widgetMainOwnerKey(owner.surfaceId, owner.elementId);
        case "widgetValue":
            return widgetValueOwnerKey(owner.surfaceId, owner.elementId, owner.propPath);
        case "componentWidgetMain":
            return componentWidgetMainOwnerKey(owner.componentId, owner.elementId);
        case "sharedAsset":
            return `sharedAsset:${owner.assetId}`;
        default: {
            const _exhaustive: never = owner;
            return _exhaustive;
        }
    }
}
