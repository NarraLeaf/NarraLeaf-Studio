import type { BlueprintDocument } from "@shared/types/blueprint/document";
import { BLUEPRINT_DOCUMENT_SCHEMA_VERSION } from "@shared/types/blueprint/schema";
import { ownerRefToIndexKey } from "./ownerKeys";

export class BlueprintDocumentValidationError extends Error {
    constructor(message: string) {
        super(message);
        this.name = "BlueprintDocumentValidationError";
    }
}

/**
 * Validates persisted BlueprintDocument shape and ownerIndex <-> blueprints consistency.
 */
export function assertValidBlueprintDocument(doc: BlueprintDocument): void {
    if (doc.schemaVersion !== BLUEPRINT_DOCUMENT_SCHEMA_VERSION) {
        throw new BlueprintDocumentValidationError(
            `BlueprintDocument schemaVersion ${String(doc.schemaVersion)} is not supported (expected ${BLUEPRINT_DOCUMENT_SCHEMA_VERSION})`,
        );
    }
    if (!doc.blueprints || typeof doc.blueprints !== "object") {
        throw new BlueprintDocumentValidationError("BlueprintDocument.blueprints is missing or invalid");
    }
    if (!doc.ownerIndex || typeof doc.ownerIndex !== "object") {
        throw new BlueprintDocumentValidationError("BlueprintDocument.ownerIndex is missing or invalid");
    }

    for (const [key, blueprintId] of Object.entries(doc.ownerIndex)) {
        const bp = doc.blueprints[blueprintId];
        if (!bp) {
            throw new BlueprintDocumentValidationError(
                `ownerIndex["${key}"] points to missing blueprint id "${blueprintId}"`,
            );
        }
        const expectedKey = ownerRefToIndexKey(bp.owner);
        if (expectedKey !== key) {
            throw new BlueprintDocumentValidationError(
                `ownerIndex key "${key}" does not match blueprint.owner derived key "${expectedKey}" for blueprint "${blueprintId}"`,
            );
        }
    }

    for (const bp of Object.values(doc.blueprints)) {
        const k = ownerRefToIndexKey(bp.owner);
        if (doc.ownerIndex[k] !== bp.id) {
            throw new BlueprintDocumentValidationError(
                `Blueprint "${bp.id}" owner key "${k}" is not mapped in ownerIndex to this id`,
            );
        }
    }
}
