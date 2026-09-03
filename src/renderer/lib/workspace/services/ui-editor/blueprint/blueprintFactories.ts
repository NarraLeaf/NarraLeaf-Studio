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
import {
    scriptEventExportNamesForOwner,
    scriptOwnerUsesDefaultExport,
} from "@/lib/ui-editor/blueprint-runtime/script/scriptEventDispatch";
import { SCRIPTS_DIR } from "@shared/project/scriptsDirectory";

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

/**
 * The module a script blueprint's types come from.
 *
 * Declared by the generated `scripts/.narraleaf/project.d.ts` rather than installed, so a script
 * type-checks with no dependencies at all - and imported with `import type`, so esbuild erases the
 * line and the build never looks for a package to resolve. Scoped to our own organisation because
 * a bare name is one a real package could take out from under it.
 */
export const SCRIPT_TYPES_MODULE = "@narraleaf/script";

/**
 * The two lines at the top of every starter file.
 *
 * They answer the only two questions the file itself cannot: where to open it, and what to call the
 * functions in it. Opening the single file resolves no types - the tsconfig and the declarations sit
 * beside it in the folder - and an export named anything the runtime does not look for is simply
 * never called, which from inside the editor looks exactly like working code.
 */
function starterHeader(owner: BlueprintOwnerRef, widgetType: string | undefined): string[] {
    const names = scriptOwnerUsesDefaultExport(owner)
        ? ["default"]
        : scriptEventExportNamesForOwner(owner, widgetType);
    return [
        `// Open the whole ${SCRIPTS_DIR}/ folder in your editor - types resolve from the files beside this one.`,
        `// Called from here: ${names.join(", ")}`,
        "",
    ];
}

/**
 * The file a new script starts as.
 *
 * One handler, named the way every handler is named, and the event chosen so it exists wherever this
 * script sits: `onInit` for a widget - every widget type has it - `onSurfaceInit` for a page,
 * `onAppBoot` for the project, and the default export for a story row, which has no others.
 *
 * Written once, when the script is created, and never rewritten: from that moment the file is the
 * author's. See `@shared/project/scriptsDirectory`.
 */
export function renderStarterScript(params: {
    owner: BlueprintOwnerRef;
    /** The element's widget type, for the owners that hang off one. */
    widgetType?: string;
}): string {
    const widget = params.widgetType ?? "nl.container";
    const header = starterHeader(params.owner, params.widgetType);
    switch (params.owner.kind) {
        case "globalMain":
            return [
                ...header,
                `import type { GlobalCtx } from "${SCRIPT_TYPES_MODULE}";`,
                "",
                "export function onAppBoot(ctx: GlobalCtx): void {",
                '    ctx.host.devtools.log("info", "the game booted");',
                "}",
                "",
            ].join("\n");
        case "surfaceMain":
            return [
                ...header,
                `import type { SurfaceCtx } from "${SCRIPT_TYPES_MODULE}";`,
                "",
                "export function onSurfaceInit(ctx: SurfaceCtx): void {",
                '    ctx.host.devtools.log("info", `this page is ${ctx.self.surfaceId}`);',
                "}",
                "",
            ].join("\n");
        case "componentWidgetMain":
            return [
                ...header,
                `import type { ComponentWidgetCtx } from "${SCRIPT_TYPES_MODULE}";`,
                "",
                `export function onInit(ctx: ComponentWidgetCtx<"${widget}">): void {`,
                "    ctx.vars.ready = true;",
                "}",
                "",
            ].join("\n");
        // A story row enters its script through the default export, and what that export must be
        // differs by mode: an action may wait, while a value and a condition are evaluated where the
        // story cannot - so theirs return rather than await.
        case "storyAction":
            if (params.owner.mode === "condition") {
                return [
                    ...header,
                    `import type { StorySyncCtx } from "${SCRIPT_TYPES_MODULE}";`,
                    "",
                    "export default function (ctx: StorySyncCtx): boolean {",
                    '    return ctx.saved.get("visitedIntro") === true;',
                    "}",
                    "",
                ].join("\n");
            }
            if (params.owner.mode === "value") {
                return [
                    ...header,
                    `import type { StorySyncCtx } from "${SCRIPT_TYPES_MODULE}";`,
                    "",
                    "export default function (ctx: StorySyncCtx): string {",
                    '    return String(ctx.scene.get("playerName") ?? "");',
                    "}",
                    "",
                ].join("\n");
            }
            return [
                ...header,
                `import type { StoryCtx } from "${SCRIPT_TYPES_MODULE}";`,
                "",
                "export default async function (ctx: StoryCtx): Promise<void> {",
                '    ctx.saved.set("visitedIntro", true);',
                '    ctx.devtools.log("info", "the intro row ran");',
                "}",
                "",
            ].join("\n");
        default:
            return [
                ...header,
                `import type { WidgetCtx } from "${SCRIPT_TYPES_MODULE}";`,
                "",
                `export function onInit(ctx: WidgetCtx<"${widget}">): void {`,
                "    ctx.vars.ready = true;",
                "}",
                "",
            ].join("\n");
    }
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
        graphs: {
            eventIds: [],
            events: {},
            functionIds: [],
            functions: {},
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
    blueprint.graphs.eventIds = [DEFAULT_GLOBAL_BOOT_LAYER_ID];
    blueprint.graphs.events = {
        [DEFAULT_GLOBAL_BOOT_LAYER_ID]: {
            id: DEFAULT_GLOBAL_BOOT_LAYER_ID,
            name: DEFAULT_GLOBAL_BOOT_LAYER_NAME,
            graph: createDefaultGlobalBootGraph(),
        },
    };
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
                blueprintId: globalId,
            },
        },
        meta: {},
    };
}

export function repairGlobalMainIfMissing(doc: BlueprintDocument, generateId: () => string): BlueprintDocument {
    const key = GLOBAL_MAIN_OWNER_KEY;
    const rec = doc.ownerRecords[key];
    const existingId = rec?.blueprintId;
    if (existingId && doc.blueprints[existingId]?.owner.kind === "globalMain") {
        return doc;
    }
    const globalId = generateId();
    const globalBp = createDefaultGlobalMainBlueprint({
        id: globalId,
        name: "Global",
    });
    return {
        ...doc,
        blueprints: { ...doc.blueprints, [globalId]: globalBp },
        ownerRecords: { ...doc.ownerRecords, [key]: { blueprintId: globalId } },
    };
}
