import type { BlueprintDocument, BlueprintOwnerRef } from "@shared/types/blueprint/document";
import { decodeBlueprintOwnerKey } from "@shared/blueprint/ownerKey";

/** The blueprint this slot runs, or undefined when the slot has none. */
export function getSlotBlueprintId(doc: BlueprintDocument, ownerKey: string): string | undefined {
    return doc.ownerRecords[ownerKey]?.blueprintId;
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
 * Point a slot at a blueprint.
 *
 * One slot, one blueprint. The record used to hold a list with one entry marked active, so that a
 * slot written as a script could keep the graph it displaced - a private version history beside the
 * one version control already keeps. A script is a layer now, so nothing needs displacing and the
 * record has one field.
 */
export function setPrivateOwnerBlueprint(doc: BlueprintDocument, ownerKey: string, blueprintId: string): void {
    doc.ownerRecords[ownerKey] = { blueprintId };
}
