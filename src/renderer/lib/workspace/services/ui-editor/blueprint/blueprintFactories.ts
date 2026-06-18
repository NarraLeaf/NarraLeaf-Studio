import type { Blueprint, BlueprintDocument, BlueprintMemberIndex, BlueprintOwnerRef } from "@shared/types/blueprint/document";
import { BLUEPRINT_DOCUMENT_SCHEMA_VERSION } from "@shared/types/blueprint/schema";
import { GLOBAL_MAIN_OWNER_KEY, ownerRefToIndexKey } from "./ownerKeys";

export function emptyMemberIndex(): BlueprintMemberIndex {
    return {
        variables: {},
        fields: {},
        functions: {},
    };
}

const TYPESCRIPT_BLUEPRINT_DEFAULT_SOURCE = `import { events } from "narraleaf-studio";

events.on("mouseClick", async (ctx) => {
  await ctx.host.devtools.log("TypeScript Blueprint");
});
`;

export function createTypeScriptMainBlueprint(params: {
    id: string;
    name: string;
    owner: BlueprintOwnerRef;
}): Blueprint {
    return {
        id: params.id,
        name: params.name,
        owner: params.owner,
        frontend: "typescript",
        programKind: "scriptModule",
        program: {
            kind: "scriptModule",
            source: {
                language: "typescript",
                code: TYPESCRIPT_BLUEPRINT_DEFAULT_SOURCE,
            },
        },
        members: emptyMemberIndex(),
        bindings: {},
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
 * New project / empty graph file: one global main blueprint and owner record entry.
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
        ownerRecords: {
            [ownerKey]: {
                activeBlueprintId: globalId,
                privateBlueprintIds: [globalId],
                initializedFrontend: "visual",
            },
        },
        meta: {},
    };
}

export function repairGlobalMainIfMissing(doc: BlueprintDocument, generateId: () => string): BlueprintDocument {
    const key = GLOBAL_MAIN_OWNER_KEY;
    const rec = doc.ownerRecords[key];
    const existingId = rec?.activeBlueprintId;
    if (existingId && doc.blueprints[existingId]?.owner.kind === "globalMain") {
        return doc;
    }
    const globalId = generateId();
    const globalBp = createMainBlueprint({
        id: globalId,
        name: "Global",
        owner: { kind: "globalMain" },
    });
    const prevIds = rec?.privateBlueprintIds ?? [];
    const mergedIds = [...new Set([...prevIds, globalId])];
    return {
        ...doc,
        blueprints: { ...doc.blueprints, [globalId]: globalBp },
        ownerRecords: {
            ...doc.ownerRecords,
            [key]: {
                activeBlueprintId: globalId,
                privateBlueprintIds: mergedIds.length > 0 ? mergedIds : [globalId],
                initializedFrontend: rec?.initializedFrontend ?? "visual",
            },
        },
    };
}
