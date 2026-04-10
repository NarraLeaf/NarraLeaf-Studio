/**
 * BlueprintDocument disk migration (shared between Workspace UIGraphService and main-process Dev Mode reads).
 */
import type { BlueprintDocument, BlueprintPrivateOwnerRecord } from "@shared/types/blueprint/document";
import { BLUEPRINT_DOCUMENT_SCHEMA_VERSION } from "@shared/types/blueprint/schema";
import {
    ensureBlueprintEventGraphIrStructure,
    ensureBlueprintFunctionGraphIrStructure,
} from "./normalizeBlueprintGraphIr";

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
    if (sv === 3 && isRecord(raw.blueprints)) {
        return migrateBlueprintDocumentV3ToV4(raw as BlueprintDocument);
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
        let seq = 0;
        const generateId = () => `nl_mig_${++seq}`;
        const interim = {
            ...rest,
            ownerRecords,
        } as unknown as BlueprintDocument;
        const upgraded = upgradeBlueprintGraphBodiesToV4(interim, generateId);
        return {
            ...upgraded,
            schemaVersion: BLUEPRINT_DOCUMENT_SCHEMA_VERSION,
        };
    }
    throw new Error(`Unsupported BlueprintDocument schemaVersion: ${String(sv)}`);
}

/** Ensures graph IR shape: function graphs get a Function entry; event layers normalize meta (Event nodes are user-placed). */
export function upgradeBlueprintGraphBodiesToV4(doc: BlueprintDocument, generateId: () => string): BlueprintDocument {
    const blueprints = { ...doc.blueprints };
    for (const bp of Object.values(blueprints)) {
        if (bp.program.kind !== "graph") {
            continue;
        }
        const graphs = bp.program.graphs;
        const events = { ...(graphs.events ?? {}) };
        for (const [eid, eg] of Object.entries(events)) {
            if (eg.graph) {
                events[eid] = {
                    ...eg,
                    graph: ensureBlueprintEventGraphIrStructure(eg.graph, generateId),
                };
            }
        }
        const functions = { ...(graphs.functions ?? {}) };
        for (const [fid, fg] of Object.entries(functions)) {
            if (fg.graph) {
                functions[fid] = {
                    ...fg,
                    graph: ensureBlueprintFunctionGraphIrStructure(fg.graph, generateId),
                };
            }
        }
        bp.program.graphs = { ...graphs, events, functions };
    }
    return { ...doc, blueprints };
}

function migrateBlueprintDocumentV3ToV4(doc: BlueprintDocument): BlueprintDocument {
    let seq = 0;
    const generateId = () => `nl_mig_${++seq}`;
    return {
        ...upgradeBlueprintGraphBodiesToV4(doc, generateId),
        schemaVersion: BLUEPRINT_DOCUMENT_SCHEMA_VERSION,
    };
}
