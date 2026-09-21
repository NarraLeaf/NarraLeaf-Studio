/**
 * A running page with lists, rows and component placements on it, for the tests that ask what a
 * graph or a script running in one row can see and reach.
 *
 * What runs is what a game runs - the Dev Mode host adapter, the real host API, the built-in nodes
 * and the real dispatcher - and what comes back is what an author could observe: the lines `Log`
 * wrote, the addresses widget writes landed on, and any execution error. The defects these tests pin
 * all had the same shape - every node ran, nothing was reported, and the effect went nowhere - so
 * an assertion about anything less than the observable end would not have caught them.
 *
 * Only imported from *.test.ts files; it never ships in a product bundle.
 *
 * Comments in English per project convention.
 */

import { encodeBlueprintOwnerKey } from "@shared/blueprint/ownerKey";
import type { Blueprint, BlueprintDocument, BlueprintOwnerRef, BlueprintVariable } from "@shared/types/blueprint/document";
import { BLUEPRINT_DOCUMENT_SCHEMA_VERSION } from "@shared/types/blueprint/schema";
import { BLUEPRINT_NODE_TYPE_ELEMENT_REF } from "@shared/types/blueprint/graph";
import { buildUIComponentSurfaceId } from "@shared/types/ui-editor/componentInstanceKey";
import { UI_DOCUMENT_SCHEMA_VERSION, type UIDocument, type UIElement, type UISurface } from "@shared/types/ui-editor/document";
import { UI_GRAPH_DOCUMENT_SCHEMA_VERSION } from "@shared/types/ui-editor/graph";
import type { UIListItemScope } from "@shared/types/ui-editor/list";
import type { UIStructDef } from "@shared/types/ui-editor/struct";
import type { DevModeBundle } from "@shared/types/devMode";
import { createDevModeBlueprintHostApi, type DevModeWidgetRuntimePatch } from "@/lib/ui-editor/blueprint-runtime/BlueprintHostApiBridge";
import { DebugBridge } from "@/lib/ui-editor/blueprint-runtime/DebugBridge";
import { ScopeStoreBridge } from "@/lib/ui-editor/blueprint-runtime/ScopeStoreBridge";
import { releaseBlueprintWidgetLocals } from "@/lib/ui-editor/blueprint-runtime/blueprintWidgetLocals";
import { WidgetRuntimeStateStore } from "@/lib/ui-editor/runtime/appearance/WidgetRuntimeStateStore";
import { createDevModeBlueprintHostAdapter } from "@/lib/ui-editor/runtime/hostAdapters/devModeBlueprintHostAdapter";

export const PAGE = "page";

/** The item shape of every list below: one name per row. */
export const TILE_STRUCT: UIStructDef = {
    id: "tile",
    fields: [{ id: "f-name", key: "name", type: "string" }],
};

type Spec = { type: string; parent: string | null; template?: true; placesComponent?: string; hidden?: true };

function elementsOf(specs: Record<string, Spec>): Record<string, UIElement> {
    const out: Record<string, UIElement> = {};
    for (const [id, spec] of Object.entries(specs)) {
        const extra: Record<string, unknown> = {};
        if (spec.template) {
            extra.listSlot = "itemTemplate";
        }
        if (spec.placesComponent) {
            extra.componentLink = { componentId: spec.placesComponent, linked: true };
        }
        out[id] = {
            id,
            type: spec.type,
            parentId: spec.parent,
            childrenIds: Object.entries(specs).filter(([, child]) => child.parent === id).map(([childId]) => childId),
            layout: { x: 0, y: 0, width: 40, height: 40, visible: !spec.hidden },
            ...(Object.keys(extra).length > 0 ? { extra } : {}),
        };
    }
    return out;
}

/**
 * A gallery beside a viewer, and two shelves placed from one component that holds a list.
 *
 * - `grid` is a list on the page; each row is a `tile` holding a `mark` and a `card` placement.
 * - `cardDef` is a card: a `cardRoot` holding a `badge`.
 * - `shelfDef` is a shelf: a `shelfRoot` holding a list `shelf` whose rows are `book`s. It is placed
 *   twice, as `shelfA` and `shelfB`, so "this placement's list" is a question with two answers.
 */
export const rowDocument: UIDocument = {
    schemaVersion: UI_DOCUMENT_SCHEMA_VERSION,
    id: "doc",
    name: "Doc",
    surfaces: [
        {
            id: PAGE,
            name: "Extra",
            host: "app",
            kind: "appSurface",
            designSize: { width: 640, height: 360 },
            rootElementId: "root",
        },
    ],
    structs: { [TILE_STRUCT.id]: TILE_STRUCT },
    elements: elementsOf({
        root: { type: "nl.root", parent: null },
        viewer: { type: "nl.container", parent: "root", hidden: true },
        grid: { type: "nl.list", parent: "root" },
        tile: { type: "nl.container", parent: "grid", template: true },
        mark: { type: "nl.text", parent: "tile" },
        card: { type: "nl.container", parent: "tile", placesComponent: "cardDef" },
        shelfA: { type: "nl.container", parent: "root", placesComponent: "shelfDef" },
        shelfB: { type: "nl.container", parent: "root", placesComponent: "shelfDef" },
    }),
    components: [
        {
            id: "cardDef",
            name: "Card",
            rootElementId: "cardRoot",
            elements: elementsOf({
                cardRoot: { type: "nl.container", parent: null },
                badge: { type: "nl.text", parent: "cardRoot" },
            }),
        },
        {
            id: "shelfDef",
            name: "Shelf",
            rootElementId: "shelfRoot",
            elements: elementsOf({
                shelfRoot: { type: "nl.container", parent: null },
                shelf: { type: "nl.list", parent: "shelfRoot" },
                book: { type: "nl.container", parent: "shelf", template: true },
            }),
        },
    ],
};

function elementTypeOf(elementId: string): string {
    for (const table of [rowDocument.elements, ...(rowDocument.components ?? []).map(component => component.elements)]) {
        const element = table[elementId];
        if (element) {
            return element.type;
        }
    }
    throw new Error(`no element ${elementId} in the fixture`);
}

/** An `Element` node naming an element of the page, or of the component definition that holds it. */
export function elementRefNode(elementId: string): GraphNode {
    const component = rowDocument.components?.find(item => Object.prototype.hasOwnProperty.call(item.elements, elementId));
    const surfaceId = component ? buildUIComponentSurfaceId(component.id) : PAGE;
    return { type: BLUEPRINT_NODE_TYPE_ELEMENT_REF, params: { surfaceId, elementId, elementType: elementTypeOf(elementId) } };
}

export type GraphNode = { type: string; params?: Record<string, unknown> };

/**
 * A graph from its nodes, the exec chain from the head down, and its data wires.
 *
 * The chain is followed out of each node's usual exec output - `then` from a head (an event head or
 * a Fn head), `next` from anything else - into `in`. A data wire is `[from, port, to, port]`.
 */
export function graphOf(input: {
    nodes: Record<string, GraphNode>;
    exec: readonly string[];
    data?: ReadonlyArray<readonly [string, string, string, string]>;
}) {
    const nodes = Object.fromEntries(Object.entries(input.nodes).map(([id, node]) => [id, { id, ...node }]));
    const edges: { from: { nodeId: string; port: string }; to: { nodeId: string; port: string } }[] = [];
    input.exec.forEach((nodeId, index) => {
        const next = input.exec[index + 1];
        if (next) {
            edges.push({ from: { nodeId, port: index === 0 ? "then" : "next" }, to: { nodeId: next, port: "in" } });
        }
    });
    for (const [from, fromPort, to, toPort] of input.data ?? []) {
        edges.push({ from: { nodeId: from, port: fromPort }, to: { nodeId: to, port: toPort } });
    }
    return { nodes, edges };
}

export type LayerSpec = { graph: ReturnType<typeof graphOf> } | { script: string };

/** One blueprint on one owner: its layers by id, and the variables it declares, by id, with their defaults. */
export function blueprintOf(
    id: string,
    owner: Extract<BlueprintOwnerRef, { kind: "widgetMain" | "componentWidgetMain" }>,
    layers: Record<string, LayerSpec>,
    variables: Record<string, BlueprintVariable["defaultValue"]> = {},
): Blueprint {
    return {
        id,
        name: id,
        owner,
        members: {
            variables: Object.fromEntries(
                Object.entries(variables).map(([variableId, defaultValue]) => [
                    variableId,
                    { id: variableId, name: variableId, valueType: typeof defaultValue === "boolean" ? "boolean" : "string", defaultValue },
                ]),
            ),
            fields: {},
            functions: {},
        },
        bindings: {},
        graphs: {
            events: Object.fromEntries(
                Object.entries(layers).map(([layerId, layer]) => [
                    layerId,
                    "graph" in layer ? { id: layerId, graph: layer.graph } : { id: layerId, script: { scriptRef: layer.script } },
                ]),
            ),
            functions: {},
        },
    } as unknown as Blueprint;
}

export function blueprintDocumentOf(blueprints: readonly Blueprint[]): BlueprintDocument {
    return {
        schemaVersion: BLUEPRINT_DOCUMENT_SCHEMA_VERSION,
        blueprints: Object.fromEntries(blueprints.map(blueprint => [blueprint.id, blueprint])),
        ownerRecords: Object.fromEntries(
            blueprints.map(blueprint => [encodeBlueprintOwnerKey(blueprint.owner), { blueprintId: blueprint.id }]),
        ),
    } as unknown as BlueprintDocument;
}

/** A row of a list of tiles, as the list renderer hands it to an event. */
export function tileRow(key: string, index: number, name = key): UIListItemScope {
    return { item: { name }, index, count: 4, key, struct: TILE_STRUCT, selected: false };
}

let runtimeCount = 0;

/**
 * The page running `blueprints`, and everything an author could see come out of it.
 *
 * Variable records live in one module-level store for the life of the renderer, as they do in a
 * game, so each runtime runs under a scope of its own and `release()` drops what it kept: a test
 * that read a variable another test had set would pass or fail on the order they ran in.
 */
export function createRowRuntime(blueprints: readonly Blueprint[]) {
    runtimeCount += 1;
    const runtimeScopeId = `${PAGE}#${runtimeCount}`;
    const blueprintDocument = blueprintDocumentOf(blueprints);
    const patches: [string, DevModeWidgetRuntimePatch][] = [];
    const bundle: DevModeBundle = {
        bundleId: "bundle",
        revision: 1,
        timestamp: "2026-09-20T00:00:00.000Z",
        ui: {
            uidoc: rowDocument,
            uigraphs: { schemaVersion: UI_GRAPH_DOCUMENT_SCHEMA_VERSION, blueprintDocument },
            localBlueprints: blueprintDocument,
            persistentVariables: {},
            savedVariables: {},
            saveSchema: [],
        },
    };
    const debug = new DebugBridge();
    const errors: string[] = [];
    const logs: string[] = [];
    debug.subscribeEvents(event => {
        if (event.type === "execution.error") {
            errors.push(event.message);
        }
        if (event.type === "devtools.log") {
            logs.push(event.message);
        }
    });
    const scope = new ScopeStoreBridge();
    const hostApi = createDevModeBlueprintHostApi({
        document: rowDocument,
        scope,
        activeSurfaceId: PAGE,
        emit: event => debug.emit(event),
        onOpenSurface: () => undefined,
        onPageBack: () => undefined,
        onWidgetPatch: (address, patch) => {
            patches.push([address, patch]);
        },
        widgetRuntimeStore: new WidgetRuntimeStateStore(),
    });
    const adapter = createDevModeBlueprintHostAdapter({
        bundle,
        surface: rowDocument.surfaces[0] as UISurface,
        runtimeScopeId,
        scopeBridge: scope,
        debug,
        hostApi,
    });
    return {
        adapter,
        runtime: adapter.blueprintRuntime!,
        hostApi,
        blueprintDocument,
        errors,
        /** Every line a `Log` node (or `ctx.host.devtools.log`) wrote, in order. */
        logs,
        /** Every address a visibility write landed on, with the value it wrote. */
        visibleWrites: () =>
            patches.filter(([, patch]) => patch.visible !== undefined).map(([address, patch]) => [address, patch.visible]),
        /** Drop every variable record these blueprints kept, as unmounting their widgets would. */
        release: () => {
            for (const blueprint of blueprints) {
                const owner = blueprint.owner;
                if (owner.kind === "widgetMain" || owner.kind === "componentWidgetMain") {
                    releaseBlueprintWidgetLocals(PAGE, owner.elementId, blueprint.id, runtimeScopeId, {
                        componentId: owner.kind === "componentWidgetMain" ? owner.componentId : undefined,
                    });
                }
            }
        },
    };
}
