/**
 * BlueprintDocument disk migration (shared between Workspace UIGraphService and main-process Dev Mode reads).
 */
import type { BlueprintDocument, BlueprintPrivateOwnerRecord } from "@shared/types/blueprint/document";
import { BLUEPRINT_DOCUMENT_SCHEMA_VERSION } from "@shared/types/blueprint/schema";

/** Legacy v2 shape (ownerIndex only). */
export type BlueprintDocumentV2 = Omit<BlueprintDocument, "schemaVersion" | "ownerRecords"> & {
    schemaVersion: 2;
    ownerIndex: Record<string, string>;
};

function isRecord(v: unknown): v is Record<string, unknown> {
    return typeof v === "object" && v !== null && !Array.isArray(v);
}

/**
 * If document is v2, upgrade to v3 (ownerRecords). Idempotent for v3+.
 */
export function migrateBlueprintDocumentToLatest(raw: unknown): BlueprintDocument {
    if (!isRecord(raw)) {
        throw new Error("BlueprintDocument: expected object");
    }
    const sv = raw.schemaVersion;
    if (sv === BLUEPRINT_DOCUMENT_SCHEMA_VERSION) {
        return raw as BlueprintDocument;
    }
    if (sv === 2 && isRecord(raw.ownerIndex) && isRecord(raw.blueprints)) {
        const ownerIndex = raw.ownerIndex as Record<string, string>;
        const ownerRecords: Record<string, BlueprintPrivateOwnerRecord> = {};
        for (const [key, blueprintId] of Object.entries(ownerIndex)) {
            if (typeof blueprintId !== "string") {
                continue;
            }
            ownerRecords[key] = {
                activeBlueprintId: blueprintId,
                privateBlueprintIds: [blueprintId],
            };
        }
        const { ownerIndex: _drop, ...rest } = raw as BlueprintDocumentV2 & Record<string, unknown>;
        void _drop;
        return {
            ...(rest as Omit<BlueprintDocument, "schemaVersion" | "ownerRecords" | "ownerIndex">),
            schemaVersion: BLUEPRINT_DOCUMENT_SCHEMA_VERSION,
            ownerRecords,
        } as BlueprintDocument;
    }
    throw new Error(`Unsupported BlueprintDocument schemaVersion: ${String(sv)}`);
}
