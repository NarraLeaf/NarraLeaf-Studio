import type {
    Blueprint,
    BlueprintDocument,
    BlueprintGraphIr,
    BlueprintMemberIndex,
    BlueprintOwnerRef,
} from "@shared/types/blueprint/document";
import {
    BLUEPRINT_GRAPH_IR_META_KIND,
    BLUEPRINT_NODE_TYPE_EVENT_HEAD_APP_BOOT,
    BLUEPRINT_NODE_TYPE_LITERAL_STRING,
    BLUEPRINT_NODE_TYPE_LOG,
} from "@shared/types/blueprint/graph";
import { BLUEPRINT_DOCUMENT_SCHEMA_VERSION } from "@shared/types/blueprint/schema";
import { GLOBAL_MAIN_OWNER_KEY, ownerRefToIndexKey } from "./ownerKeys";

const DEFAULT_GLOBAL_BOOT_LAYER_ID = "global";
const DEFAULT_GLOBAL_BOOT_LAYER_NAME = "Global";
const DEFAULT_GLOBAL_APP_BOOT_NODE_ID = "global.appBoot";
const DEFAULT_GLOBAL_WELCOME_TEXT_NODE_ID = "global.welcomeText";
const DEFAULT_GLOBAL_LOG_NODE_ID = "global.log";
const DEFAULT_GLOBAL_WELCOME_MESSAGE = "Hello, World! Welcome to NarraLeaf Studio";

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

function createDefaultGlobalBootGraph(): BlueprintGraphIr {
    return {
        nodes: {
            [DEFAULT_GLOBAL_APP_BOOT_NODE_ID]: {
                id: DEFAULT_GLOBAL_APP_BOOT_NODE_ID,
                type: BLUEPRINT_NODE_TYPE_EVENT_HEAD_APP_BOOT,
                params: {},
                meta: { editorLayout: { x: 80, y: 120 } },
            },
            [DEFAULT_GLOBAL_WELCOME_TEXT_NODE_ID]: {
                id: DEFAULT_GLOBAL_WELCOME_TEXT_NODE_ID,
                type: BLUEPRINT_NODE_TYPE_LITERAL_STRING,
                params: { value: DEFAULT_GLOBAL_WELCOME_MESSAGE },
                meta: { editorLayout: { x: 300, y: 40 } },
            },
            [DEFAULT_GLOBAL_LOG_NODE_ID]: {
                id: DEFAULT_GLOBAL_LOG_NODE_ID,
                type: BLUEPRINT_NODE_TYPE_LOG,
                params: {},
                meta: { editorLayout: { x: 540, y: 120 } },
            },
        },
        edges: [
            {
                from: { nodeId: DEFAULT_GLOBAL_APP_BOOT_NODE_ID, port: "then" },
                to: { nodeId: DEFAULT_GLOBAL_LOG_NODE_ID, port: "in" },
            },
            {
                from: { nodeId: DEFAULT_GLOBAL_WELCOME_TEXT_NODE_ID, port: "value" },
                to: { nodeId: DEFAULT_GLOBAL_LOG_NODE_ID, port: "value" },
            },
        ],
        meta: { [BLUEPRINT_GRAPH_IR_META_KIND]: "event" },
    };
}

export function createDefaultGlobalMainBlueprint(params: {
    id: string;
    name: string;
}): Blueprint {
    const blueprint = createMainBlueprint({
        id: params.id,
        name: params.name,
        owner: { kind: "globalMain" },
    });
    if (blueprint.program.kind === "graph") {
        blueprint.program.graphs.events = {
            [DEFAULT_GLOBAL_BOOT_LAYER_ID]: {
                id: DEFAULT_GLOBAL_BOOT_LAYER_ID,
                name: DEFAULT_GLOBAL_BOOT_LAYER_NAME,
                graph: createDefaultGlobalBootGraph(),
            },
        };
    }
    return blueprint;
}

/**
 * New project / empty graph file: one global main blueprint and owner record entry.
 */
export function createInitialBlueprintDocument(generateId: () => string): BlueprintDocument {
    const globalId = generateId();
    const owner: BlueprintOwnerRef = { kind: "globalMain" };
    const globalBp = createDefaultGlobalMainBlueprint({
        id: globalId,
        name: "Global",
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
        persistentVariables: {},
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
    const globalBp = createDefaultGlobalMainBlueprint({
        id: globalId,
        name: "Global",
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
