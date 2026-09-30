import type { BlueprintOwnerRef } from "@shared/types/blueprint/document";
import {
    decodeBlueprintOwnerKey,
    encodeBlueprintOwnerKey,
    GLOBAL_MAIN_OWNER_KEY,
} from "@shared/blueprint/ownerKey";

/**
 * The editor's names for owner keys, spelled by the one encoder in `@shared/blueprint/ownerKey`.
 *
 * These are convenience wrappers and nothing more. The format lives in shared because the disk
 * migration has to write the same spelling the editor looks up, and the defect that made this file
 * worth rewriting was exactly two implementations of one format drifting: the built-in surface's id
 * contains the separator, so `widgetMain:narraleaf-studio:main-surface:<elementId>` read as three
 * different things in three places.
 *
 * Nothing here escapes anything itself. A wrapper that did would be the third implementation.
 */

export { GLOBAL_MAIN_OWNER_KEY };

export function surfaceMainOwnerKey(surfaceId: string): string {
    return encodeBlueprintOwnerKey({ kind: "surfaceMain", surfaceId });
}

export function widgetMainOwnerKey(surfaceId: string, elementId: string): string {
    return encodeBlueprintOwnerKey({ kind: "widgetMain", surfaceId, elementId });
}

export function componentWidgetMainOwnerKey(componentId: string, elementId: string): string {
    return encodeBlueprintOwnerKey({ kind: "componentWidgetMain", componentId, elementId });
}

export function storyActionOwnerKey(blueprintId: string): string {
    return encodeBlueprintOwnerKey({ kind: "storyAction", blueprintId });
}

export function widgetValueOwnerKey(surfaceId: string, elementId: string, propPath: string): string {
    return encodeBlueprintOwnerKey({ kind: "widgetValue", surfaceId, elementId, propPath });
}

export function decodeWidgetValueOwnerKey(ownerKey: string): {
    surfaceId: string;
    elementId: string;
    propPath: string;
} | null {
    const owner = decodeBlueprintOwnerKey(ownerKey);
    return owner?.kind === "widgetValue"
        ? { surfaceId: owner.surfaceId, elementId: owner.elementId, propPath: owner.propPath }
        : null;
}

export function ownerRefToIndexKey(owner: BlueprintOwnerRef): string {
    return encodeBlueprintOwnerKey(owner);
}
