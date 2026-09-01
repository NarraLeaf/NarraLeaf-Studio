import type { BlueprintDocument, BlueprintFrontendKind, BlueprintOwnerRef } from "@shared/types/blueprint/document";
import { decodeBlueprintOwnerKey } from "@shared/blueprint/ownerKey";

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
 * The owner slot a private key names, or null.
 *
 * Reads the one decoder in `@shared/blueprint/ownerKey`; there used to be a second regular
 * expression here, and it took `narraleaf-studio` for the surface and `main-surface:<elementId>` for
 * the element on every widget of the built-in surface.
 *
 * **Private slots only.** A `storyAction` blueprint is its own key rather than a slot
 * `ownerRecords` describes, so answering for it would hand a caller a ref this document has nothing
 * to say about.
 */
export function parsePrivateOwnerKeyToRef(ownerKey: string): BlueprintOwnerRef | null {
    const owner = decodeBlueprintOwnerKey(ownerKey);
    if (!owner || owner.kind === "storyAction") {
        return null;
    }
    return owner;
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
