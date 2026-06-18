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
 * Validates persisted BlueprintDocument shape and ownerRecords <-> blueprints consistency.
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
    if (!doc.ownerRecords || typeof doc.ownerRecords !== "object") {
        throw new BlueprintDocumentValidationError("BlueprintDocument.ownerRecords is missing or invalid");
    }

    for (const [key, rec] of Object.entries(doc.ownerRecords)) {
        if (!rec || typeof rec !== "object") {
            throw new BlueprintDocumentValidationError(`ownerRecords["${key}"] is invalid`);
        }
        const { activeBlueprintId, privateBlueprintIds } = rec;
        if (typeof activeBlueprintId !== "string" || !activeBlueprintId) {
            throw new BlueprintDocumentValidationError(`ownerRecords["${key}"].activeBlueprintId is missing`);
        }
        if (!Array.isArray(privateBlueprintIds) || privateBlueprintIds.length === 0) {
            throw new BlueprintDocumentValidationError(`ownerRecords["${key}"].privateBlueprintIds is empty`);
        }
        if (!privateBlueprintIds.includes(activeBlueprintId)) {
            throw new BlueprintDocumentValidationError(
                `ownerRecords["${key}"].activeBlueprintId is not listed in privateBlueprintIds`,
            );
        }
        for (const blueprintId of privateBlueprintIds) {
            const bp = doc.blueprints[blueprintId];
            if (!bp) {
                throw new BlueprintDocumentValidationError(
                    `ownerRecords["${key}"] lists missing blueprint id "${blueprintId}"`,
                );
            }
            const expectedKey = ownerRefToIndexKey(bp.owner);
            if (expectedKey !== key) {
                throw new BlueprintDocumentValidationError(
                    `ownerRecords key "${key}" does not match blueprint.owner derived key "${expectedKey}" for blueprint "${blueprintId}"`,
                );
            }
        }
    }

    for (const bp of Object.values(doc.blueprints)) {
        if (bp.owner.kind === "sharedAsset") {
            continue;
        }
        const k = ownerRefToIndexKey(bp.owner);
        const rec = doc.ownerRecords[k];
        if (!rec) {
            throw new BlueprintDocumentValidationError(
                `Blueprint "${bp.id}" owner key "${k}" has no ownerRecords entry`,
            );
        }
        if (!rec.privateBlueprintIds.includes(bp.id)) {
            throw new BlueprintDocumentValidationError(
                `Blueprint "${bp.id}" is not listed in ownerRecords["${k}"].privateBlueprintIds`,
            );
        }
    }

    for (const bp of Object.values(doc.blueprints)) {
        if (bp.program.kind !== "graph") {
            continue;
        }
        const events = bp.program.graphs.events ?? {};
        for (const [key, eg] of Object.entries(events)) {
            if (eg.id !== key) {
                throw new BlueprintDocumentValidationError(
                    `Blueprint "${bp.id}" event graph key "${key}" does not match event id "${eg.id}"`,
                );
            }
        }
    }

    for (const bp of Object.values(doc.blueprints)) {
        for (const bind of Object.values(bp.bindings ?? {})) {
            if (bind.source.kind !== "field") {
                continue;
            }
            const srcBp = doc.blueprints[bind.source.blueprintId];
            const field = srcBp?.members?.fields?.[bind.source.fieldId];
            if (bind.status === "broken") {
                continue;
            }
            if (!field) {
                throw new BlueprintDocumentValidationError(
                    `Binding "${bind.id}" references missing field "${bind.source.fieldId}" on blueprint "${bind.source.blueprintId}"`,
                );
            }
        }
    }

    for (const bp of Object.values(doc.blueprints)) {
        for (const field of Object.values(bp.members?.fields ?? {})) {
            const vs = field.valueSource;
            if (!vs) {
                continue;
            }
            if (vs.kind === "surfaceState" || vs.kind === "globalState") {
                const stateKey = String(vs.key ?? "").trim();
                if (!stateKey) {
                    throw new BlueprintDocumentValidationError(
                        `Field "${field.id}" on blueprint "${bp.id}" has ${vs.kind} valueSource with empty key`,
                    );
                }
            } else if (vs.kind === "listItem") {
                if (vs.path != null && typeof vs.path !== "string") {
                    throw new BlueprintDocumentValidationError(
                        `Field "${field.id}" on blueprint "${bp.id}" has listItem valueSource with invalid path`,
                    );
                }
            } else if (vs.kind !== "listIndex" && vs.kind !== "listCount") {
                throw new BlueprintDocumentValidationError(
                    `Field "${field.id}" on blueprint "${bp.id}" has unsupported valueSource kind`,
                );
            }
        }
    }
}
