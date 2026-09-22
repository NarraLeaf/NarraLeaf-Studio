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
 * one version control already keeps. A script is a layer now, so the record has one field.
 *
 * A slot that already names a blueprint gives that blueprint up. A blueprint its own slot does not
 * name is not a valid document (`assertValidBlueprintDocument`), so the one it held cannot stay.
 * This is not hypothetical: writing new elements runs the lifecycle sweep, which gives each one an
 * empty blueprint on the spot, and a paste, a duplicate or a component write then points the same
 * slot at the copy it carried. Keeping the empty one failed validation half-way through the write -
 * the elements were in, the selection never moved to them, and every blueprint edit after that
 * failed the same check.
 */
export function setPrivateOwnerBlueprint(doc: BlueprintDocument, ownerKey: string, blueprintId: string): void {
    const displaced = doc.ownerRecords[ownerKey]?.blueprintId;
    if (displaced && displaced !== blueprintId) {
        delete doc.blueprints[displaced];
    }
    doc.ownerRecords[ownerKey] = { blueprintId };
}
