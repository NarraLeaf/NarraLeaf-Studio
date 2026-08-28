import { describe, expect, it } from "vitest";
import { buildUIListItemInstanceKey } from "@shared/types/ui-editor/list";
import { buildUIComponentInstanceKey } from "@shared/types/ui-editor/componentInstanceKey";
import type { BlueprintDocument } from "@shared/types/blueprint/document";
import { BLUEPRINT_DOCUMENT_SCHEMA_VERSION } from "@shared/types/blueprint/schema";
import {
    BLUEPRINT_NODE_TYPE_EVENT_HEAD_MOUSE_CLICK,
    BLUEPRINT_NODE_TYPE_EVENT_HEAD_MOUSE_ENTER,
    BLUEPRINT_NODE_TYPE_LITERAL_STRING,
    BLUEPRINT_NODE_TYPE_LOCAL_SET,
} from "@shared/types/blueprint/graph";
import { UI_DOCUMENT_SCHEMA_VERSION, type UIDocument, type UIElement, type UISurface } from "@shared/types/ui-editor/document";
import { UI_GRAPH_DOCUMENT_SCHEMA_VERSION } from "@shared/types/ui-editor/graph";
import type { DevModeBundle } from "@shared/types/devMode";
import { createDevModeBlueprintHostApi } from "@/lib/ui-editor/blueprint-runtime/BlueprintHostApiBridge";
import { DebugBridge } from "@/lib/ui-editor/blueprint-runtime/DebugBridge";
import { ScopeStoreBridge } from "@/lib/ui-editor/blueprint-runtime/ScopeStoreBridge";
import {
    acquireBlueprintWidgetLocals,
    releaseBlueprintWidgetLocals,
} from "@/lib/ui-editor/blueprint-runtime/blueprintWidgetLocals";
import { WidgetRuntimeStateStore } from "@/lib/ui-editor/runtime/appearance/WidgetRuntimeStateStore";
import { createDevModeBlueprintHostAdapter } from "./devModeBlueprintHostAdapter";

/** One element of a nesting chain, root first. */
type ChainNode = {
    id: string;
    type: string;
    /** The event this element's private blueprint declares a head for, if any. */
    listensTo?: "mouseClick" | "mouseEnter";
    /**
     * Make this element a placement of a component whose root is the next node in the chain.
     *
     * The chain then crosses a boundary the document tree does not span: the definition's root has
     * no parent, so a walk that only reads `parentId` stops inside the component and the container
     * that placed it never hears the press.
     */
    placesComponent?: string;
};

const HEAD_TYPE_BY_EVENT = {
    mouseClick: BLUEPRINT_NODE_TYPE_EVENT_HEAD_MOUSE_CLICK,
    mouseEnter: BLUEPRINT_NODE_TYPE_EVENT_HEAD_MOUSE_ENTER,
} as const;

/**
 * A chain of nested elements, each optionally listening for one pointer event.
 *
 * Every listener writes the same local (`fired`), so "did this element hear it" is one read; the
 * order they ran in comes off the debug bus rather than out of the graphs, because a graph that
 * could observe its own position in the walk would be an author-facing promise about that order -
 * and there deliberately is not one.
 */
function createChainFixture(chain: readonly ChainNode[]) {
    const blueprintIdOf = (elementId: string) => `bp-${elementId}`;
    /** The component a node is authored in, walking back up the chain to the placement that opens one. */
    const componentIdOf = (node: ChainNode): string | undefined => {
        for (let i = chain.indexOf(node) - 1; i >= 0; i--) {
            const owner = chain[i]!.placesComponent;
            if (owner) {
                return owner;
            }
        }
        return undefined;
    };
    const ownerOf = (node: ChainNode) => {
        const componentId = componentIdOf(node);
        return componentId
            ? ({ kind: "componentWidgetMain" as const, componentId, elementId: node.id })
            : ({ kind: "widgetMain" as const, surfaceId: "surface", elementId: node.id });
    };
    const ownerKeyOf = (node: ChainNode) => {
        const componentId = componentIdOf(node);
        return componentId ? `componentWidgetMain:${componentId}:${node.id}` : `widgetMain:surface:${node.id}`;
    };
    const listeners = chain.filter(node => node.listensTo);
    for (const node of listeners) {
        releaseBlueprintWidgetLocals("surface", node.id, blueprintIdOf(node.id));
    }

    const blueprintDocument: BlueprintDocument = {
        schemaVersion: BLUEPRINT_DOCUMENT_SCHEMA_VERSION,
        blueprints: Object.fromEntries(
            listeners.map(node => [
                blueprintIdOf(node.id),
                {
                    id: blueprintIdOf(node.id),
                    name: `${node.id} logic`,
                    owner: ownerOf(node),
                    frontend: "visual" as const,
                    programKind: "graph" as const,
                    members: {
                        variables: {
                            fired: { id: "fired", name: "fired", valueType: "string" as const, defaultValue: "no" },
                        },
                        fields: {},
                        functions: {},
                    },
                    bindings: {},
                    program: {
                        kind: "graph" as const,
                        graphs: {
                            events: {
                                [node.listensTo!]: {
                                    id: node.listensTo!,
                                    graph: {
                                        nodes: {
                                            head: { id: "head", type: HEAD_TYPE_BY_EVENT[node.listensTo!] },
                                            literal: {
                                                id: "literal",
                                                type: BLUEPRINT_NODE_TYPE_LITERAL_STRING,
                                                params: { value: "yes" },
                                            },
                                            set: {
                                                id: "set",
                                                type: BLUEPRINT_NODE_TYPE_LOCAL_SET,
                                                params: { variableId: "fired" },
                                            },
                                        },
                                        edges: [
                                            { from: { nodeId: "head", port: "then" }, to: { nodeId: "set", port: "in" } },
                                            { from: { nodeId: "literal", port: "value" }, to: { nodeId: "set", port: "value" } },
                                        ],
                                    },
                                },
                            },
                            functions: {},
                        },
                    },
                },
            ]),
        ),
        ownerRecords: Object.fromEntries(
            listeners.map(node => [
                ownerKeyOf(node),
                {
                    activeBlueprintId: blueprintIdOf(node.id),
                    privateBlueprintIds: [blueprintIdOf(node.id)],
                    initializedFrontend: "visual" as const,
                },
            ]),
        ),
    };

    const elements: Record<string, UIElement> = {
        root: {
            id: "root",
            type: "nl.root",
            parentId: null,
            childrenIds: [chain[0]!.id],
            layout: { x: 0, y: 0, width: 320, height: 180 },
        },
    };
    /** Nodes that live in a component definition rather than on the Surface, by component id. */
    const componentElements = new Map<string, Record<string, UIElement>>();
    const componentOfNode = new Map<string, string>();
    chain.forEach((node, index) => {
        const parent = index === 0 ? null : chain[index - 1]!;
        const insideComponent = parent?.placesComponent ?? (parent ? componentOfNode.get(parent.id) : undefined);
        const element: UIElement = {
            id: node.id,
            type: node.type,
            // A definition's root has no parent: which page it lands on is the placement's business.
            parentId: parent?.placesComponent ? null : (parent?.id ?? "root"),
            childrenIds: index === chain.length - 1 || node.placesComponent ? [] : [chain[index + 1]!.id],
            layout: { x: 0, y: 0, width: 120, height: 80 },
        };
        if (insideComponent) {
            componentOfNode.set(node.id, insideComponent);
            const pool = componentElements.get(insideComponent) ?? {};
            pool[node.id] = element;
            componentElements.set(insideComponent, pool);
            return;
        }
        elements[node.id] = node.placesComponent
            ? { ...element, extra: { componentLink: { componentId: node.placesComponent, linked: true } } }
            : element;
    });

    const document: UIDocument = {
        schemaVersion: UI_DOCUMENT_SCHEMA_VERSION,
        id: "doc",
        name: "Doc",
        surfaces: [
            {
                id: "surface",
                name: "Surface",
                host: "player",
                kind: "stageSurface",
                designSize: { width: 320, height: 180 },
                rootElementId: "root",
                mount: { kind: "slot", slotId: "onStage" },
            },
        ],
        elements,
        components: [...componentElements].map(([id, pool]) => ({
            id,
            name: id,
            rootElementId: Object.values(pool).find(element => element.parentId === null)!.id,
            elements: pool,
        })),
    };
    const bundle: DevModeBundle = {
        bundleId: "bundle",
        revision: 1,
        timestamp: "2026-07-02T00:00:00.000Z",
        ui: {
            uidoc: document,
            uigraphs: {
                schemaVersion: UI_GRAPH_DOCUMENT_SCHEMA_VERSION,
                blueprintDocument,
            },
            localBlueprints: blueprintDocument,
            sharedBlueprints: [],
            persistentVariables: {},
            savedVariables: {},
            saveSchema: [],
        },
    };
    const debug = new DebugBridge();
    // `execution.started` is a tracing event, and the bus drops those unless somebody has asked for
    // them. Asking is what makes the order observable here without a graph that can see it.
    debug.setVerboseCaptureEnabled(true);
    const startedBlueprintIds: string[] = [];
    debug.subscribeEvents(event => {
        if (event.type === "execution.started" && event.blueprintId) {
            startedBlueprintIds.push(event.blueprintId);
        }
    });
    const scope = new ScopeStoreBridge();
    const hostApi = createDevModeBlueprintHostApi({
        document,
        scope,
        activeSurfaceId: "surface",
        emit: event => debug.emit(event),
        onOpenSurface: () => undefined,
        onPageBack: () => undefined,
        onWidgetPatch: () => undefined,
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
        /** Whether this element's own blueprint ran. */
        heard: (elementId: string) =>
            acquireBlueprintWidgetLocals(
                "surface",
                elementId,
                blueprintIdOf(elementId),
                blueprintDocument.blueprints[blueprintIdOf(elementId)]!,
            ).fired === "yes",
        /** The elements whose blueprints ran, in the order they started. */
        firedOrder: () => startedBlueprintIds.map(id => id.replace(/^bp-/, "")),
        cleanup: () => {
            for (const node of listeners) {
                releaseBlueprintWidgetLocals("surface", node.id, blueprintIdOf(node.id));
            }
        },
    };
}

describe("createDevModeBlueprintHostAdapter", () => {
    /**
     * The rule this whole walk exists for. A head says the element wants the event, not that it owns
     * it, so a panel that listens no longer takes every click away from the page it sits in - which
     * is what the old "first listener keeps it" rule did, silently, with no way to see the cause.
     */
    it("fires every head from the hit element up to the root", async () => {
        const fixture = createChainFixture([
            { id: "page", type: "nl.container", listensTo: "mouseClick" },
            { id: "panel", type: "nl.container", listensTo: "mouseClick" },
            { id: "label", type: "nl.text" },
        ]);

        await fixture.adapter.blueprintRuntime?.dispatchElementBlueprintEvent("label", "mouseClick", { x: 4, y: 5, button: 0 });

        expect(fixture.heard("panel")).toBe(true);
        expect(fixture.heard("page")).toBe(true);
        fixture.cleanup();
    });

    it("fires them innermost first", async () => {
        const fixture = createChainFixture([
            { id: "page", type: "nl.container", listensTo: "mouseClick" },
            { id: "panel", type: "nl.container", listensTo: "mouseClick" },
            { id: "label", type: "nl.text" },
        ]);

        await fixture.adapter.blueprintRuntime?.dispatchElementBlueprintEvent("label", "mouseClick", { x: 4, y: 5, button: 0 });

        expect(fixture.firedOrder()).toEqual(["panel", "page"]);
        fixture.cleanup();
    });

    it("steps over an element with no head", async () => {
        // The decorative element every author drops onto a clickable panel. It has no blueprint and
        // no owner record at all, so there is nothing to run and nothing to report - the walk simply
        // continues past it.
        const fixture = createChainFixture([
            { id: "page", type: "nl.container", listensTo: "mouseClick" },
            { id: "decoration", type: "nl.image" },
            { id: "label", type: "nl.text" },
        ]);

        await fixture.adapter.blueprintRuntime?.dispatchElementBlueprintEvent("label", "mouseClick", { x: 4, y: 5, button: 0 });

        expect(fixture.firedOrder()).toEqual(["page"]);
        fixture.cleanup();
    });

    it("keeps hover to the element it happened on", async () => {
        // Forwarding this one would report the whole ancestry as hovered at once, so the walk is
        // deliberately narrower than "any interaction event".
        const fixture = createChainFixture([
            { id: "page", type: "nl.container", listensTo: "mouseEnter" },
            { id: "label", type: "nl.text" },
        ]);

        await fixture.adapter.blueprintRuntime?.dispatchElementBlueprintEvent("label", "mouseEnter", {});

        expect(fixture.heard("page")).toBe(false);
        fixture.cleanup();
    });

    it("sheds the row context when the event leaves the list that made it", async () => {
        // A wheel or a click inside a row carries that row's instance key, and the blueprint
        // variable record is keyed by it. Carrying the key past the list would hand the container
        // around it a private, freshly defaulted copy of its own variables for as long as the
        // pointer sat over a row - so the parent would run, and remember nothing.
        const fixture = createChainFixture([
            { id: "page", type: "nl.container", listensTo: "mouseClick" },
            { id: "rows", type: "nl.list" },
            { id: "label", type: "nl.text" },
        ]);

        await fixture.adapter.blueprintRuntime?.dispatchElementBlueprintEvent("label", "mouseClick", { x: 4, y: 5, button: 0 }, {
            instanceKey: buildUIListItemInstanceKey("rows", "row-1"),
            listItemScope: { item: {}, index: 0, count: 1, key: "row-1" },
        });

        expect(fixture.heard("page")).toBe(true);
        fixture.cleanup();
    });

    it("carries a press out of a component and on up the page that placed it", async () => {
        // A definition's root has no parent, so the walk would end inside the component and the
        // container that placed it would never hear a press over the card it holds. The instance
        // key names the element that placed it, which is where the walk carries on from.
        const fixture = createChainFixture([
            { id: "page", type: "nl.container", listensTo: "mouseClick" },
            { id: "card", type: "nl.container", placesComponent: "slot" },
            { id: "card-root", type: "nl.container", listensTo: "mouseClick" },
        ]);

        await fixture.adapter.blueprintRuntime?.dispatchElementBlueprintEvent("card-root", "mouseClick", { x: 1, y: 2, button: 0 }, {
            componentId: "slot",
            componentParams: { slot: "3" },
            instanceKey: buildUIComponentInstanceKey(undefined, "card"),
        });

        // Read off the debug bus rather than the blueprint's own locals: a component blueprint's
        // variables are stored per instance under a key of their own, and what this is about is
        // which graphs ran, not where either of them keeps its state.
        expect(fixture.firedOrder()).toEqual(["card-root", "page"]);
        fixture.cleanup();
    });

    it("leaves the component's own context behind when it does", async () => {
        // Past the placement, `componentId` would send every lookup back inside the definition and
        // the params belong to a drawing the event has just left. The placement is on the Surface,
        // so it has to be found there - which is what this asserts by giving it something to hear.
        const fixture = createChainFixture([
            { id: "page", type: "nl.container" },
            { id: "card", type: "nl.container", placesComponent: "slot", listensTo: "mouseClick" },
            { id: "card-root", type: "nl.container" },
        ]);

        await fixture.adapter.blueprintRuntime?.dispatchElementBlueprintEvent("card-root", "mouseClick", { x: 1, y: 2, button: 0 }, {
            componentId: "slot",
            instanceKey: buildUIComponentInstanceKey(undefined, "card"),
        });

        expect(fixture.heard("card")).toBe(true);
        expect(fixture.firedOrder()).toEqual(["card"]);
        fixture.cleanup();
    });
});
