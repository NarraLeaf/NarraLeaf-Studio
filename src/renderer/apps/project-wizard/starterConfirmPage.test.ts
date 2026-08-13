/**
 * The Confirm page every project made from the starter template arrives with.
 *
 * Read off the shipped files rather than a fixture, for the same reason the asset-pin sweep does:
 * what is asserted here is what an author actually receives. The page is ordinary - a text, a list,
 * an item template - and that is the claim under test. `Show Confirm` hands it a message and a
 * `buttons` array as page props and waits; the page reads them through bindings any author could
 * have drawn, and answers by closing itself with the index of the row that was pressed. Nothing in
 * it is reserved, so redrawing the whole page is a supported thing to do, and these assertions are
 * the contract that survives the redraw.
 *
 * Pin ids come from the real node catalogue, so renaming one breaks this rather than quietly
 * leaving the template wired to a pin that no longer exists.
 */
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
    BLUEPRINT_NODE_TYPE_DATA_JSON_GET,
    BLUEPRINT_NODE_TYPE_DATA_RETURN_VALUE,
    BLUEPRINT_NODE_TYPE_EVENT_HEAD_INIT,
    BLUEPRINT_NODE_TYPE_EVENT_HEAD_ITEM_CLICK,
    BLUEPRINT_NODE_TYPE_LAYER_CLOSE_SELF,
    BLUEPRINT_NODE_TYPE_LIST_GET_ITEM_PROPS,
    BLUEPRINT_NODE_TYPE_PAGE_GET_PROPS,
} from "@shared/types/blueprint/graph";
import { blueprintNodeRegistry } from "@/lib/ui-editor/blueprint-nodes/BlueprintNodeRegistry";
import { registerCoreBlueprintNodes } from "@/lib/ui-editor/blueprint-nodes/registerCoreBlueprintNodes";

type Element = {
    id: string;
    type: string;
    parentId: string | null;
    childrenIds?: string[];
    props?: Record<string, unknown>;
    extra?: Record<string, unknown>;
};
type Surface = { id: string; name: string; kind: string; rootElementId: string; settings?: Record<string, unknown> };
type GraphNode = { id: string; type: string; params?: Record<string, unknown> };
type GraphEdge = { from: { nodeId: string; port: string }; to: { nodeId: string; port: string } };
type Blueprint = {
    id: string;
    owner: { kind: string; surfaceId?: string; elementId?: string; propPath?: string };
    program: { graphs: { events: Record<string, { graph: { nodes: Record<string, GraphNode>; edges: GraphEdge[] } }> } };
};

function readTemplate(file: string): unknown {
    return JSON.parse(
        fs.readFileSync(path.join(process.cwd(), "resources/templates/skeleton/content/editor/ui", file), "utf-8"),
    );
}

const document = readTemplate("uidoc.json") as { surfaces: Surface[]; elements: Record<string, Element> };
const blueprints = Object.values(
    (readTemplate("uigraphs.json") as { blueprintDocument: { blueprints: Record<string, Blueprint> } })
        .blueprintDocument.blueprints,
);

const confirm = document.surfaces.find(surface => surface.name === "Confirm")!;

/** Every element on this page, walked from the root the way the renderer mounts it. */
function pageElements(): Element[] {
    const out: Element[] = [];
    const walk = (id: string) => {
        const element = document.elements[id];
        expect(element, `element ${id} is referenced but missing`).toBeDefined();
        out.push(element);
        for (const childId of element.childrenIds ?? []) {
            expect(document.elements[childId]?.parentId).toBe(id);
            walk(childId);
        }
    };
    walk(confirm.rootElementId);
    return out;
}

/** The one graph on a blueprint, flattened to the lookups the assertions want. */
function onlyGraph(blueprint: Blueprint) {
    const graphs = Object.values(blueprint.program.graphs.events);
    expect(graphs).toHaveLength(1);
    const { nodes, edges } = graphs[0]!.graph;
    const byType = (type: string) => Object.values(nodes).find(node => node.type === type);
    const wired = (from: { nodeId: string; port: string }, to: { nodeId: string; port: string }) =>
        edges.some(
            edge =>
                edge.from.nodeId === from.nodeId &&
                edge.from.port === from.port &&
                edge.to.nodeId === to.nodeId &&
                edge.to.port === to.port,
        );
    return { nodes, edges, byType, wired };
}

/** Pin ids the shipping catalogue declares for a node type. */
function pinIds(nodeType: string): string[] {
    registerCoreBlueprintNodes();
    return blueprintNodeRegistry.resolveCatalogEntry(nodeType).pins.map(pin => pin.id);
}

describe("the Confirm page in the starter template", () => {
    it("is an ordinary page, transparent so the screen it asks about stays visible", () => {
        expect(confirm.kind).toBe("appSurface");
        // The composite dims what is underneath a modal layer; a page colour here would cover it.
        expect(confirm.settings?.backgroundColor).toBe("transparent");
    });

    it("is a message and a row of buttons, and nothing else", () => {
        expect(pageElements().map(element => element.type)).toEqual([
            "nl.root",
            "nl.container",
            "nl.text",
            "nl.list",
            "nl.container",
            "nl.text",
        ]);
    });

    it("reads its buttons from the props the layer was shown with", () => {
        const list = pageElements().find(element => element.type === "nl.list")!;
        expect(list.props?.itemsBinding).toEqual({ kind: "pageProp", key: "buttons" });
        expect(list.props?.repeatDirection).toBe("horizontal");
        // Keyed by index, because two buttons may well read the same.
        expect(list.props?.itemKeyPath).toBe("index");
        const template = (list.childrenIds ?? []).map(id => document.elements[id]);
        expect(template.map(element => element.extra?.listSlot)).toEqual(["itemTemplate"]);
    });

    it("answers by closing itself with the index of the row that was pressed", () => {
        const list = pageElements().find(element => element.type === "nl.list")!;
        const blueprint = blueprints.find(
            candidate => candidate.owner.kind === "widgetMain" && candidate.owner.elementId === list.id,
        )!;
        const { byType, wired } = onlyGraph(blueprint);
        const click = byType(BLUEPRINT_NODE_TYPE_EVENT_HEAD_ITEM_CLICK)!;
        const close = byType(BLUEPRINT_NODE_TYPE_LAYER_CLOSE_SELF)!;
        expect(pinIds(BLUEPRINT_NODE_TYPE_EVENT_HEAD_ITEM_CLICK)).toEqual(expect.arrayContaining(["then", "index"]));
        expect(pinIds(BLUEPRINT_NODE_TYPE_LAYER_CLOSE_SELF)).toEqual(expect.arrayContaining(["in", "result"]));
        expect(wired({ nodeId: click.id, port: "then" }, { nodeId: close.id, port: "in" })).toBe(true);
        expect(wired({ nodeId: click.id, port: "index" }, { nodeId: close.id, port: "result" })).toBe(true);
    });

    it.each([
        ["message", 0, BLUEPRINT_NODE_TYPE_PAGE_GET_PROPS, "message"],
        ["button label", 1, BLUEPRINT_NODE_TYPE_LIST_GET_ITEM_PROPS, "text"],
    ])("draws its %s from a value binding rather than a literal", (_name, textIndex, sourceType, jsonPath) => {
        const text = pageElements().filter(element => element.type === "nl.text")[textIndex]!;
        // Blank on the element, so nothing is left on screen when the binding is what speaks.
        expect(text.props?.text).toBe("");
        const blueprint = blueprints.find(
            candidate => candidate.owner.kind === "widgetValue" && candidate.owner.elementId === text.id,
        )!;
        expect(blueprint.owner.propPath).toBe("text");
        const { byType, wired } = onlyGraph(blueprint);
        const source = byType(sourceType as string)!;
        const read = byType(BLUEPRINT_NODE_TYPE_DATA_JSON_GET)!;
        const value = byType(BLUEPRINT_NODE_TYPE_DATA_RETURN_VALUE)!;
        expect(byType(BLUEPRINT_NODE_TYPE_EVENT_HEAD_INIT)).toBeDefined();
        expect(read.params?.path).toBe(jsonPath);
        expect(wired({ nodeId: source.id, port: "props" }, { nodeId: read.id, port: "json" })).toBe(true);
        expect(wired({ nodeId: read.id, port: "result" }, { nodeId: value.id, port: "value" })).toBe(true);
    });
});
