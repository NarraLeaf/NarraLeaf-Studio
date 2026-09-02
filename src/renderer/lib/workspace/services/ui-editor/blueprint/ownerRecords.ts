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
 * Drop one of a slot's revisions.
 *
 * The record keeps a list and one active id, so removing the active one has to choose a successor:
 * the revision before it, which is the one an author was looking at before they made this. The last
 * revision is not removable here - callers refuse it - because the slot's record is what a value
 * binding is addressed through, and a slot with no record is a binding pointing at nothing.
 *
 * A script's file is never touched. Studio wrote it once and the disk owns it from then on; an
 * author who wants it gone deletes it themselves, and until they do it is listed as a file nothing
 * runs.
 */
export function removePrivateBlueprint(doc: BlueprintDocument, ownerKey: string, blueprintId: string): void {
    const rec = doc.ownerRecords[ownerKey];
    const index = rec?.privateBlueprintIds.indexOf(blueprintId) ?? -1;
    if (!rec || index < 0) {
        return;
    }
    if (rec.privateBlueprintIds.length <= 1) {
        throw new Error(`Cannot remove the only revision of ${ownerKey}`);
    }
    rec.privateBlueprintIds.splice(index, 1);
    delete doc.blueprints[blueprintId];
    if (rec.activeBlueprintId === blueprintId) {
        rec.activeBlueprintId = rec.privateBlueprintIds[Math.max(0, index - 1)] ?? rec.privateBlueprintIds[0]!;
    }
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
