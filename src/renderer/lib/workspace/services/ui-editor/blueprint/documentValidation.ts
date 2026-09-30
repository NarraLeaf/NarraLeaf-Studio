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
    // Persistent variables left the blueprint document for the M-VAR registry; nothing to validate here.

    for (const [key, rec] of Object.entries(doc.ownerRecords)) {
        if (!rec || typeof rec !== "object") {
            throw new BlueprintDocumentValidationError(`ownerRecords["${key}"] is invalid`);
        }
        const { blueprintId } = rec;
        if (typeof blueprintId !== "string" || !blueprintId) {
            throw new BlueprintDocumentValidationError(`ownerRecords["${key}"].blueprintId is missing`);
        }
        const bp = doc.blueprints[blueprintId];
        if (!bp) {
            throw new BlueprintDocumentValidationError(
                `ownerRecords["${key}"] names missing blueprint id "${blueprintId}"`,
            );
        }
        const expectedKey = ownerRefToIndexKey(bp.owner);
        if (expectedKey !== key) {
            throw new BlueprintDocumentValidationError(
                `ownerRecords key "${key}" does not match blueprint.owner derived key "${expectedKey}" for blueprint "${blueprintId}"`,
            );
        }
    }

    for (const bp of Object.values(doc.blueprints)) {
        const k = ownerRefToIndexKey(bp.owner);
        const rec = doc.ownerRecords[k];
        if (!rec) {
            throw new BlueprintDocumentValidationError(
                `Blueprint "${bp.id}" owner key "${k}" has no ownerRecords entry`,
            );
        }
        // One slot, one blueprint. A blueprint its own slot does not name is unreachable: nothing
        // resolves a blueprint by walking the map, so it would sit in the document being saved,
        // linted and diffed while never running - which is exactly the state the revision list used
        // to make reachable on purpose.
        if (rec.blueprintId !== bp.id) {
            throw new BlueprintDocumentValidationError(
                `Blueprint "${bp.id}" is not the blueprint ownerRecords["${k}"] names`,
            );
        }
    }

    for (const bp of Object.values(doc.blueprints)) {
        for (const [key, layer] of Object.entries(bp.graphs.events ?? {})) {
            if (layer.id !== key) {
                throw new BlueprintDocumentValidationError(
                    `Blueprint "${bp.id}" layer key "${key}" does not match layer id "${layer.id}"`,
                );
            }
            // A layer is one thing or the other. Both set would leave every reader free to pick,
            // and they would not all pick the same one: a graph walker sees a graph, the dispatcher
            // sees a script, and the author sees whichever the editor drew.
            if (layer.script && layer.graph) {
                throw new BlueprintDocumentValidationError(
                    `Blueprint "${bp.id}" layer "${key}" is both a graph and a script`,
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
