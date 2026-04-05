import type { BlueprintDocument, BlueprintFrontendKind, BlueprintOwnerRef } from "@shared/types/blueprint/document";
import { GLOBAL_MAIN_OWNER_KEY } from "./ownerKeys";

export function getActiveBlueprintId(doc: BlueprintDocument, ownerKey: string): string | undefined {
    return doc.ownerRecords[ownerKey]?.activeBlueprintId;
}

export function setPrivateOwnerActive(doc: BlueprintDocument, ownerKey: string, blueprintId: string): void {
    const rec = doc.ownerRecords[ownerKey];
    if (!rec) {
        throw new Error(`ownerRecords missing for key ${ownerKey}`);
    }
    if (!rec.privateBlueprintIds.includes(blueprintId)) {
        throw new Error(`Blueprint ${blueprintId} is not in privateBlueprintIds for ${ownerKey}`);
    }
    rec.activeBlueprintId = blueprintId;
}

/**
 * Parse a private owner slot key back to owner ref (excludes sharedAsset).
 */
export function parsePrivateOwnerKeyToRef(ownerKey: string): BlueprintOwnerRef | null {
    if (ownerKey === GLOBAL_MAIN_OWNER_KEY) {
        return { kind: "globalMain" };
    }
    const sm = /^surfaceMain:(.+)$/.exec(ownerKey);
    if (sm) {
        return { kind: "surfaceMain", surfaceId: sm[1] };
    }
    const wm = /^widgetMain:([^:]+):(.+)$/.exec(ownerKey);
    if (wm) {
        return { kind: "widgetMain", surfaceId: wm[1], elementId: wm[2] };
    }
    return null;
}

/**
 * Add or refresh a private blueprint as the active one for this owner slot.
 */
export function registerPrivateBlueprintAsActive(
    doc: BlueprintDocument,
    ownerKey: string,
    blueprintId: string,
    initializedFrontend?: BlueprintFrontendKind,
): void {
    const prev = doc.ownerRecords[ownerKey];
    const nextIds = prev?.privateBlueprintIds?.includes(blueprintId)
        ? prev.privateBlueprintIds
        : [...(prev?.privateBlueprintIds ?? []), blueprintId];
    doc.ownerRecords[ownerKey] = {
        activeBlueprintId: blueprintId,
        privateBlueprintIds: nextIds,
        initializedFrontend: prev?.initializedFrontend ?? initializedFrontend,
    };
}
