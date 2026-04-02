import type { Blueprint, BlueprintDocument, BlueprintMemberIndex, BlueprintOwnerRef } from "@shared/types/blueprint/document";
import { BLUEPRINT_DOCUMENT_SCHEMA_VERSION } from "@shared/types/blueprint/schema";
import { GLOBAL_MAIN_OWNER_KEY, ownerRefToIndexKey } from "./ownerKeys";

export function emptyMemberIndex(): BlueprintMemberIndex {
    return {
        variables: {},
        declarations: {},
        functions: {},
    };
}

export function createMainBlueprint(params: {
    id: string;
    name: string;
    owner: BlueprintOwnerRef;
}): Blueprint {
    return {
        id: params.id,
        name: params.name,
        owner: params.owner,
        frontend: "visual",
        programKind: "graph",
        program: {
            kind: "graph",
            graphs: {
                events: {},
                functions: {},
            },
        },
        members: emptyMemberIndex(),
        bindings: {},
    };
}

/**
 * New project / empty graph file: one global main blueprint and owner index entry.
 */
export function createInitialBlueprintDocument(generateId: () => string): BlueprintDocument {
    const globalId = generateId();
    const owner: BlueprintOwnerRef = { kind: "globalMain" };
    const globalBp = createMainBlueprint({
        id: globalId,
        name: "Global",
        owner,
    });
    const ownerKey = ownerRefToIndexKey(owner);
    return {
        schemaVersion: BLUEPRINT_DOCUMENT_SCHEMA_VERSION,
        blueprints: { [globalId]: globalBp },
        ownerIndex: { [ownerKey]: globalId },
        meta: {},
    };
}

export function repairGlobalMainIfMissing(doc: BlueprintDocument, generateId: () => string): BlueprintDocument {
    const key = GLOBAL_MAIN_OWNER_KEY;
    const existingId = doc.ownerIndex[key];
    if (existingId && doc.blueprints[existingId]?.owner.kind === "globalMain") {
        return doc;
    }
    const globalId = generateId();
    const globalBp = createMainBlueprint({
        id: globalId,
        name: "Global",
        owner: { kind: "globalMain" },
    });
    return {
        ...doc,
        blueprints: { ...doc.blueprints, [globalId]: globalBp },
        ownerIndex: { ...doc.ownerIndex, [key]: globalId },
    };
}
