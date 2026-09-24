/**
 * A write made from inside a list row lands on the drawing of its target, whichever that is.
 *
 * The screen every gallery, save page and backlog is built from: press an item in a list, change
 * something - the item itself, or a panel beside the list. The write used to be addressed to the
 * pressed row's copy of whatever the graph named, so "show the viewer" wrote to a viewer inside row
 * three that nothing draws, the press did nothing, and nothing said so. The same node fired from an
 * ordinary button worked, which is what made it look like the author's mistake.
 *
 * Driven end to end through what a running game uses - the Dev Mode host adapter, the real host API
 * and the built-in nodes - and asserted on where the writes land, because that is the whole defect:
 * every node ran, every write succeeded, and the address was the one thing wrong.
 *
 * Comments in English per project convention.
 */

import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { encodeBlueprintOwnerKey } from "@shared/blueprint/ownerKey";
import type { BlueprintDocument, BlueprintOwnerRef } from "@shared/types/blueprint/document";
import { BLUEPRINT_DOCUMENT_SCHEMA_VERSION } from "@shared/types/blueprint/schema";
import {
    BLUEPRINT_NODE_TYPE_DISPLAYABLE_SET_PROPERTY,
    BLUEPRINT_NODE_TYPE_ELEMENT_DISPLAYABLE_GET_VISIBLE,
    BLUEPRINT_NODE_TYPE_ELEMENT_DISPLAYABLE_SET_PROPERTY,
    BLUEPRINT_NODE_TYPE_ELEMENT_REF,
    BLUEPRINT_NODE_TYPE_EVENT_HEAD_ITEM_CLICK,
    BLUEPRINT_NODE_TYPE_EVENT_HEAD_MOUSE_CLICK,
} from "@shared/types/blueprint/graph";
import { buildUIComponentInstanceKey, buildUIComponentSurfaceId } from "@shared/types/ui-editor/componentInstanceKey";
import { UI_DOCUMENT_SCHEMA_VERSION, type UIDocument, type UIElement, type UISurface } from "@shared/types/ui-editor/document";
import { UI_GRAPH_DOCUMENT_SCHEMA_VERSION } from "@shared/types/ui-editor/graph";
import { buildUIListItemInstanceKey, type UIListItemScope } from "@shared/types/ui-editor/list";
import { buildUIWidgetAddress } from "@shared/types/ui-editor/widgetAddress";
import type { DevModeBundle } from "@shared/types/devMode";
import { createDevModeBlueprintHostApi, type DevModeWidgetRuntimePatch } from "@/lib/ui-editor/blueprint-runtime/BlueprintHostApiBridge";
import { DebugBridge } from "@/lib/ui-editor/blueprint-runtime/DebugBridge";
import { ScopeStoreBridge } from "@/lib/ui-editor/blueprint-runtime/ScopeStoreBridge";
import { WidgetRuntimeStateStore } from "@/lib/ui-editor/runtime/appearance/WidgetRuntimeStateStore";
import { registerCoreBlueprintNodes } from "@/lib/ui-editor/blueprint-nodes/registerCoreBlueprintNodes";
import { resolveDataPinValue } from "@/lib/ui-editor/blueprint-nodes/built-in/graphParamResolvers";
import { createDevModeBlueprintHostAdapter } from "./devModeBlueprintHostAdapter";

const PAGE = "page";

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
 * A gallery beside a viewer, a tile holding a card component, and chapters holding scene lists.
 *
 * Everything a row can reach sits here at once, so one document covers every case: a row's own
 * widget, the page, the list itself, a placement's insides, and the outer row of a nested list.
 */
const document: UIDocument = {
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
    elements: elementsOf({
        root: { type: "nl.root", parent: null },
        viewer: { type: "nl.container", parent: "root", hidden: true },
        grid: { type: "nl.list", parent: "root" },
        tile: { type: "nl.container", parent: "grid", template: true },
        mark: { type: "nl.text", parent: "tile" },
        card: { type: "nl.container", parent: "tile", placesComponent: "cardDef" },
        chapters: { type: "nl.list", parent: "root" },
        chapter: { type: "nl.container", parent: "chapters", template: true },
        chapterTitle: { type: "nl.text", parent: "chapter" },
        scenes: { type: "nl.list", parent: "chapter" },
        scene: { type: "nl.container", parent: "scenes", template: true },
        sceneLabel: { type: "nl.text", parent: "scene" },
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
    ],
};

const typeOf = (elementId: string): string =>
    document.elements[elementId]?.type ?? document.components![0]!.elements[elementId]!.type;

function ref(elementId: string, surfaceId = PAGE) {
    return { type: BLUEPRINT_NODE_TYPE_ELEMENT_REF, params: { surfaceId, elementId, elementType: typeOf(elementId) } };
}

type Write = { target: string; surfaceId?: string; visible: boolean };

/** A graph that runs `writes` in order when its head fires: one Set Visible per target. */
function graphFor(head: string, writes: Write[], selfOpacity?: number) {
    const nodes: Record<string, { id: string; type: string; params?: Record<string, unknown> }> = {
        head: { id: "head", type: head },
    };
    const edges: { from: { nodeId: string; port: string }; to: { nodeId: string; port: string } }[] = [];
    let previous = "head";
    let previousPort = "then";
    writes.forEach((write, index) => {
        const setId = `set${index}`;
        const refId = `ref${index}`;
        nodes[refId] = { id: refId, ...ref(write.target, write.surfaceId) };
        nodes[setId] = {
            id: setId,
            type: BLUEPRINT_NODE_TYPE_ELEMENT_DISPLAYABLE_SET_PROPERTY,
            params: { property: "visible", value: write.visible },
        };
        edges.push({ from: { nodeId: previous, port: previousPort }, to: { nodeId: setId, port: "in" } });
        edges.push({ from: { nodeId: refId, port: "element" }, to: { nodeId: setId, port: "element" } });
        previous = setId;
        previousPort = "next";
    });
    if (selfOpacity !== undefined) {
        nodes.self = {
            id: "self",
            type: BLUEPRINT_NODE_TYPE_DISPLAYABLE_SET_PROPERTY,
            params: { property: "opacity", value: selfOpacity },
        };
        edges.push({ from: { nodeId: previous, port: previousPort }, to: { nodeId: "self", port: "in" } });
    }
    return { nodes, edges };
}

/** The owners a widget event reaches: an element on the page, or one inside a component definition. */
type WidgetOwner = Extract<BlueprintOwnerRef, { kind: "widgetMain" | "componentWidgetMain" }>;

function blueprintOf(owner: WidgetOwner, eventName: string, graph: ReturnType<typeof graphFor>) {
    return {
        id: `bp-${owner.elementId}`,
        name: owner.elementId,
        owner,
        members: { variables: {}, fields: {}, functions: {} },
        bindings: {},
        graphs: { events: { [eventName]: { id: eventName, graph } }, functions: {} },
    };
}

const owners: { owner: WidgetOwner; eventName: string; graph: ReturnType<typeof graphFor> }[] = [
    {
        // Press a tile: open the viewer beside the list, clear this tile's mark, dim the list itself.
        owner: { kind: "widgetMain", surfaceId: PAGE, elementId: "grid" },
        eventName: "itemClick",
        graph: graphFor(
            BLUEPRINT_NODE_TYPE_EVENT_HEAD_ITEM_CLICK,
            [
                { target: "viewer", visible: true },
                { target: "mark", visible: false },
            ],
            0.5,
        ),
    },
    {
        // A card component placed in each tile: hide its own badge, open the page's viewer.
        owner: { kind: "componentWidgetMain", componentId: "cardDef", elementId: "cardRoot" },
        eventName: "mouseClick",
        graph: graphFor(BLUEPRINT_NODE_TYPE_EVENT_HEAD_MOUSE_CLICK, [
            { target: "badge", surfaceId: buildUIComponentSurfaceId("cardDef"), visible: false },
            { target: "viewer", visible: true },
        ]),
    },
    {
        // A scene in a chapter: its own label, its chapter's heading, and the page's viewer.
        owner: { kind: "widgetMain", surfaceId: PAGE, elementId: "scenes" },
        eventName: "itemClick",
        graph: graphFor(BLUEPRINT_NODE_TYPE_EVENT_HEAD_ITEM_CLICK, [
            { target: "sceneLabel", visible: false },
            { target: "chapterTitle", visible: false },
            { target: "viewer", visible: true },
        ]),
    },
];

const blueprintDocument: BlueprintDocument = {
    schemaVersion: BLUEPRINT_DOCUMENT_SCHEMA_VERSION,
    blueprints: Object.fromEntries(owners.map(({ owner, eventName, graph }) => [`bp-${owner.elementId}`, blueprintOf(owner, eventName, graph)])),
    ownerRecords: Object.fromEntries(owners.map(({ owner }) => [encodeBlueprintOwnerKey(owner), { blueprintId: `bp-${owner.elementId}` }])),
} as unknown as BlueprintDocument;

function createRuntime() {
    const patches: [string, DevModeWidgetRuntimePatch][] = [];
    const bundle: DevModeBundle = {
        bundleId: "bundle",
        revision: 1,
        timestamp: "2026-09-20T00:00:00.000Z",
        ui: {
            uidoc: document,
            uigraphs: { schemaVersion: UI_GRAPH_DOCUMENT_SCHEMA_VERSION, blueprintDocument },
            localBlueprints: blueprintDocument,
            persistentVariables: {},
            savedVariables: {},
            saveSchema: [],
        },
    };
    const debug = new DebugBridge();
    const errors: string[] = [];
    debug.subscribeEvents(event => {
        if (event.type === "execution.error") {
            errors.push(event.message);
        }
    });
    const scope = new ScopeStoreBridge();
    const hostApi = createDevModeBlueprintHostApi({
        document,
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
        surface: document.surfaces[0] as UISurface,
        scopeBridge: scope,
        debug,
        hostApi,
    });
    return {
        adapter,
        hostApi,
        errors,
        /** Every address a visibility write landed on, with the value it wrote. */
        visibleWrites: () =>
            patches.filter(([, patch]) => patch.visible !== undefined).map(([address, patch]) => [address, patch.visible]),
        opacityWrites: () =>
            patches.filter(([, patch]) => patch.layout?.opacity !== undefined).map(([address, patch]) => [address, patch.layout?.opacity]),
    };
}

function rowScope(key: string, index: number): UIListItemScope {
    return { item: { id: key }, index, count: 4, key };
}

beforeAll(() => {
    registerCoreBlueprintNodes();
});

let runtime: ReturnType<typeof createRuntime>;
afterEach(() => {
    expect(runtime.errors).toEqual([]);
});

describe("a list's Item Click", () => {
    const row = buildUIListItemInstanceKey(undefined, "grid", "cg-2");

    it("shows a panel outside the list on the panel itself", async () => {
        runtime = createRuntime();
        await runtime.adapter.blueprintRuntime!.dispatchElementBlueprintEvent("grid", "itemClick", { index: 1 }, {
            listItemScope: rowScope("cg-2", 1),
            instanceKey: row,
        });

        expect(runtime.visibleWrites()).toContainEqual(["viewer", true]);
        // And not on the row's copy of it, which is the address nothing draws.
        expect(runtime.visibleWrites().map(([address]) => address)).not.toContain(buildUIWidgetAddress("viewer", row));
        expect(runtime.hostApi.widget.getDisplayableProperties("viewer").visible).toBe(true);
    });

    it("still changes the pressed row's own widget in that row only", async () => {
        runtime = createRuntime();
        await runtime.adapter.blueprintRuntime!.dispatchElementBlueprintEvent("grid", "itemClick", { index: 1 }, {
            listItemScope: rowScope("cg-2", 1),
            instanceKey: row,
        });

        expect(runtime.visibleWrites()).toContainEqual([buildUIWidgetAddress("mark", row), false]);
        expect(runtime.visibleWrites().map(([address]) => address)).not.toContain("mark");
    });

    it("writes to its own list as the list, not as the pressed row's copy of it", async () => {
        runtime = createRuntime();
        await runtime.adapter.blueprintRuntime!.dispatchElementBlueprintEvent("grid", "itemClick", { index: 1 }, {
            listItemScope: rowScope("cg-2", 1),
            instanceKey: row,
        });

        expect(runtime.opacityWrites()).toEqual([["grid", 0.5]]);
    });

    it("reads back what it wrote, at the same address a setter uses", async () => {
        runtime = createRuntime();
        await runtime.adapter.blueprintRuntime!.dispatchElementBlueprintEvent("grid", "itemClick", { index: 1 }, {
            listItemScope: rowScope("cg-2", 1),
            instanceKey: row,
        });

        const readVisible = (target: string) =>
            resolveDataPinValue(
                {
                    nodes: { target: ref(target), get: { type: BLUEPRINT_NODE_TYPE_ELEMENT_DISPLAYABLE_GET_VISIBLE, params: {} } },
                    edges: [{ from: { nodeId: "target", port: "element" }, to: { nodeId: "get", port: "element" } }],
                },
                "get",
                "visible",
                {},
                undefined,
                0,
                {
                    hostAdapter: runtime.adapter,
                    instanceKey: row,
                    listItemScope: rowScope("cg-2", 1),
                    executionOwner: { surfaceId: PAGE, elementId: "grid", blueprintId: "bp-grid" },
                },
            );

        // The viewer was authored hidden and shown by the press: a getter still reading the row's
        // copy would answer with the authored value and contradict what is on screen.
        expect(readVisible("viewer")).toBe(true);
        expect(readVisible("mark")).toBe(false);
    });
});

describe("a component placed in a list row", () => {
    const row = buildUIListItemInstanceKey(undefined, "grid", "cg-2");
    const placement = buildUIComponentInstanceKey(row, "card");

    it("keeps its own widgets in this placement and reaches the page beyond the list", async () => {
        runtime = createRuntime();
        await runtime.adapter.blueprintRuntime!.dispatchElementBlueprintEvent("cardRoot", "mouseClick", { x: 1, y: 1, button: 0 }, {
            componentId: "cardDef",
            instanceKey: placement,
        });

        expect(runtime.visibleWrites()).toEqual([
            [buildUIWidgetAddress("badge", placement), false],
            ["viewer", true],
        ]);
    });
});

describe("a list inside another list's row", () => {
    const chapter = buildUIListItemInstanceKey(undefined, "chapters", "ch-1");
    const scene = buildUIListItemInstanceKey(chapter, "scenes", "s-3");

    it("lands each write in the nearest row that holds the target", async () => {
        runtime = createRuntime();
        await runtime.adapter.blueprintRuntime!.dispatchElementBlueprintEvent("scenes", "itemClick", { index: 2 }, {
            listItemScope: rowScope("s-3", 2),
            instanceKey: scene,
        });

        expect(runtime.visibleWrites()).toEqual([
            // The scene's own label: that scene, of that chapter.
            [buildUIWidgetAddress("sceneLabel", scene), false],
            // The heading of the chapter the scene is in - not every chapter's, not a copy inside the scene.
            [buildUIWidgetAddress("chapterTitle", chapter), false],
            ["viewer", true],
        ]);
    });
});
