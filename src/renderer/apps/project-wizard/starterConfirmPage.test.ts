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
    BLUEPRINT_NODE_TYPE_DATA_MEMO,
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
    valueBindings?: Record<string, unknown>;
};
type Surface = { id: string; name: string; kind: string; rootElementId: string; settings?: Record<string, unknown> };
type GraphNode = { id: string; type: string; params?: Record<string, unknown> };
type GraphEdge = { from: { nodeId: string; port: string }; to: { nodeId: string; port: string } };
type Blueprint = {
    id: string;
    owner: { kind: string; surfaceId?: string; elementId?: string; propPath?: string };
    graphs: { events: Record<string, { graph: { nodes: Record<string, GraphNode>; edges: GraphEdge[] } }> };
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
    const graphs = Object.values(blueprint.graphs.events);
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
    /**
     * Whether an exec output eventually runs a node, following every branch it opens.
     *
     * Weaker than {@link wired} on purpose, and only where the route is allowed to grow: a cue or a
     * branch inserted between two nodes does not change which node ends up running.
     */
    const reaches = (from: { nodeId: string; port: string }, targetId: string): boolean => {
        const seen = new Set<string>();
        const queue = edges.filter(edge => edge.from.nodeId === from.nodeId && edge.from.port === from.port);
        while (queue.length > 0) {
            const edge = queue.shift()!;
            if (edge.to.nodeId === targetId) {
                return true;
            }
            if (seen.has(edge.to.nodeId)) {
                continue;
            }
            seen.add(edge.to.nodeId);
            queue.push(...edges.filter(candidate => candidate.from.nodeId === edge.to.nodeId));
        }
        return false;
    };
    /**
     * Whether a value reaches a pin, allowed to pass through a Memo on the way.
     *
     * Narrower than {@link reaches}: only a Memo may sit in between, and only by taking the value in
     * and handing the same one back. It is there because the pressed index is read twice - once as
     * the answer, once to pick which sound to play - and a pure pin may feed only one consumer.
     */
    const carries = (from: { nodeId: string; port: string }, to: { nodeId: string; port: string }): boolean => {
        if (wired(from, to)) {
            return true;
        }
        return edges.some(edge => {
            if (edge.from.nodeId !== from.nodeId || edge.from.port !== from.port) {
                return false;
            }
            const hop = nodes[edge.to.nodeId];
            if (hop?.type !== BLUEPRINT_NODE_TYPE_DATA_MEMO || edge.to.port !== "value") {
                return false;
            }
            return carries({ nodeId: hop.id, port: "result" }, to);
        });
    };
    return { nodes, edges, byType, wired, reaches, carries };
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
        expect(list.props?.itemKeyFieldId).toBe("index");
        const template = (list.childrenIds ?? []).map(id => document.elements[id]);
        expect(template.map(element => element.extra?.listSlot)).toEqual(["itemTemplate"]);
    });

    it("answers by closing itself with the index of the row that was pressed", () => {
        const list = pageElements().find(element => element.type === "nl.list")!;
        const blueprint = blueprints.find(
            candidate => candidate.owner.kind === "widgetMain" && candidate.owner.elementId === list.id,
        )!;
        const { byType, carries, reaches } = onlyGraph(blueprint);
        const click = byType(BLUEPRINT_NODE_TYPE_EVENT_HEAD_ITEM_CLICK)!;
        const close = byType(BLUEPRINT_NODE_TYPE_LAYER_CLOSE_SELF)!;
        expect(pinIds(BLUEPRINT_NODE_TYPE_EVENT_HEAD_ITEM_CLICK)).toEqual(expect.arrayContaining(["then", "index"]));
        expect(pinIds(BLUEPRINT_NODE_TYPE_LAYER_CLOSE_SELF)).toEqual(expect.arrayContaining(["in", "result"]));
        // Reached rather than wired straight through: the page sounds its own answer, and the two
        // answers do not sound alike, so a branch and a cue sit between the press and the close.
        // Every route still ends there - an answer that closed nothing would be a dead dialog.
        expect(reaches({ nodeId: click.id, port: "then" }, close.id)).toBe(true);
        expect(carries({ nodeId: click.id, port: "index" }, { nodeId: close.id, port: "result" })).toBe(true);
    });

    /**
     * The message is not a row's own data - it belongs to the whole layer - so it is still read from
     * the page props by a graph, which is the shape a value that has to be computed always takes.
     */
    it("draws its message from the props the layer was shown with", () => {
        const text = pageElements().filter(element => element.type === "nl.text")[0]!;
        // Blank on the element, so nothing is left on screen when the binding is what speaks.
        expect(text.props?.text).toBe("");
        const blueprint = blueprints.find(
            candidate => candidate.owner.kind === "widgetValue" && candidate.owner.elementId === text.id,
        )!;
        expect(blueprint.owner.propPath).toBe("text");
        const { byType, wired } = onlyGraph(blueprint);
        const source = byType(BLUEPRINT_NODE_TYPE_PAGE_GET_PROPS)!;
        const read = byType(BLUEPRINT_NODE_TYPE_DATA_JSON_GET)!;
        const value = byType(BLUEPRINT_NODE_TYPE_DATA_RETURN_VALUE)!;
        expect(byType(BLUEPRINT_NODE_TYPE_EVENT_HEAD_INIT)).toBeDefined();
        expect(read.params?.path).toBe("message");
        expect(wired({ nodeId: source.id, port: "props" }, { nodeId: read.id, port: "json" })).toBe(true);
        expect(wired({ nodeId: read.id, port: "result" }, { nodeId: value.id, port: "value" })).toBe(true);
    });

    /**
     * The button label is a row's own data, so it is a field of the declared shape and nothing else -
     * no graph, no dotted path typed into a pin. That the button rows have a declared shape at all is
     * the other half of the claim: a list that declares none can offer nothing to bind to.
     */
    it("draws its button label from a field of the row", () => {
        const list = pageElements().find(element => element.type === "nl.list")!;
        expect(list.props?.itemStructId).toBe("nl.confirmButton");
        const text = pageElements().filter(element => element.type === "nl.text")[1]!;
        expect(text.props?.text).toBe("");
        expect(text.valueBindings?.text).toEqual({ kind: "listItemField", fieldId: "text" });
        // And no blueprint left behind saying the same thing a second time.
        expect(
            blueprints.some(
                candidate => candidate.owner.kind === "widgetValue" && candidate.owner.elementId === text.id,
            ),
        ).toBe(false);
    });
});
