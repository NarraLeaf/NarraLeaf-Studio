/**
 * BlueprintDocument disk migration (shared between Workspace UIGraphService and main-process Dev Mode reads).
 */
import type {
    BindingSourceRef,
    BlueprintDocument,
    BlueprintField,
    BlueprintMemberIndex,
    BlueprintPrivateOwnerRecord,
} from "@shared/types/blueprint/document";
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

/** v4 binding source before fields rename. */
type LegacyDeclarationBindingSource = {
    kind: "declaration";
    blueprintId: string;
    declarationId: string;
};

function isRecord(v: unknown): v is Record<string, unknown> {
    return typeof v === "object" && v !== null && !Array.isArray(v);
}

/**
 * Merge legacy `members.declarations` into `members.fields`, rewrite binding sources, normalize member shape.
 * Idempotent for documents already on v5.
 */
export function migrateLegacyDeclarationsToFields(doc: BlueprintDocument): BlueprintDocument {
    const blueprints = { ...doc.blueprints };
    for (const bp of Object.values(blueprints)) {
        if (!bp.members) {
            continue;
        }
        const mem = bp.members as BlueprintMemberIndex & { declarations?: Record<string, BlueprintField> };
        const legacyDecls = mem.declarations;
        const existingFields = mem.fields ?? {};
        if (legacyDecls && Object.keys(legacyDecls).length > 0) {
            bp.members = {
                variables: mem.variables ?? {},
                fields: { ...existingFields, ...legacyDecls },
                functions: mem.functions ?? {},
            };
        } else if (!mem.fields) {
            bp.members = {
                variables: mem.variables ?? {},
                fields: existingFields,
                functions: mem.functions ?? {},
            };
        }
        delete (bp.members as Record<string, unknown>).declarations;

        for (const bind of Object.values(bp.bindings ?? {})) {
            const src = bind.source as BindingSourceRef | LegacyDeclarationBindingSource;
            if (src.kind === "declaration") {
                bind.source = {
                    kind: "field",
                    blueprintId: src.blueprintId,
                    fieldId: src.declarationId,
                };
            }
        }
    }
    return { ...doc, blueprints };
}

/**
 * If document is v2/v3/v4, upgrade to latest. Idempotent for current schema.
 */
export function migrateBlueprintDocumentToLatest(raw: unknown): BlueprintDocument {
    if (!isRecord(raw)) {
        throw new Error("BlueprintDocument: expected object");
    }
    const sv = raw.schemaVersion;
    if (sv === BLUEPRINT_DOCUMENT_SCHEMA_VERSION) {
        return migrateLegacyDeclarationsToFields(raw as BlueprintDocument);
    }
    if (sv === 5 && isRecord(raw.blueprints)) {
        const migrated = migrateLegacyDeclarationsToFields(raw as BlueprintDocument);
        return { ...migrated, schemaVersion: BLUEPRINT_DOCUMENT_SCHEMA_VERSION };
    }
    if (sv === 4 && isRecord(raw.blueprints)) {
        const migrated = migrateLegacyDeclarationsToFields(raw as BlueprintDocument);
        return { ...migrated, schemaVersion: BLUEPRINT_DOCUMENT_SCHEMA_VERSION };
    }
    if (sv === 3 && isRecord(raw.blueprints)) {
        let seq = 0;
        const generateId = () => `nl_mig_${++seq}`;
        const withBodies = upgradeBlueprintGraphBodiesToV4(raw as BlueprintDocument, generateId);
        const migrated = migrateLegacyDeclarationsToFields(withBodies);
        return { ...migrated, schemaVersion: BLUEPRINT_DOCUMENT_SCHEMA_VERSION };
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
        const migrated = migrateLegacyDeclarationsToFields(upgraded);
        return {
            ...migrated,
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
