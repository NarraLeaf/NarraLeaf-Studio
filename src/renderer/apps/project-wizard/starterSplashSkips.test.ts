/**
 * A game made from the starter template leaves its splash for the title on any press.
 *
 * The splash is two timed beats - the logo, then the fiction disclaimer - before the title. A player
 * who has seen them wants past them, and the press they reach for is a click, Space, Enter or
 * Escape. Each press used to end only the beat on screen: the next beat still played in full, and a
 * press made between the two beats ended nothing, so the page read as one that could not be
 * skipped. The page now answers Advance and Dismiss by opening the title at once.
 *
 * The timed sequence and the press both open the title through one function that records it has
 * run, so a press made as the sequence ends does not open the title a second time. This holds the
 * template to both halves, in each language the template is written in.
 */
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
    BLUEPRINT_NODE_PARAM_FN_REF,
    BLUEPRINT_NODE_PARAM_INPUT_ACTION_ID,
    BLUEPRINT_NODE_TYPE_EVENT_HEAD_ACTION,
    BLUEPRINT_NODE_TYPE_EVENT_HEAD_SURFACE_INIT,
    BLUEPRINT_NODE_TYPE_FN_CALL,
    BLUEPRINT_NODE_TYPE_FN_HEAD,
    BLUEPRINT_NODE_TYPE_FLOW_DELAY,
    BLUEPRINT_NODE_TYPE_LOCAL_SET,
    BLUEPRINT_NODE_TYPE_PAGE_REPLACE,
} from "@shared/types/blueprint/graph";
import type { UISurfaceActionEnablement } from "@shared/types/ui-editor/inputAction";

type GraphNode = { id: string; type: string; params?: Record<string, unknown> };
type GraphEdge = { from: { nodeId: string; port: string }; to: { nodeId: string; port: string } };
type Graph = { nodes: Record<string, GraphNode>; edges: GraphEdge[] };
type Blueprint = {
    id: string;
    owner: { kind: string; surfaceId?: string };
    graphs: { events: Record<string, { graph: Graph }> };
};
type Surface = { id: string; actions?: UISurfaceActionEnablement[] };
type UIDoc = { surfaces: Surface[]; entrySurfaceId?: string };

const TEMPLATES = ["content", "content.zh", "content.ja"] as const;
const TITLE = "narraleaf-studio:main-surface";

function read(tree: string, ...segments: string[]): unknown {
    const file = path.join(process.cwd(), "resources/templates/skeleton", tree, ...segments);
    return JSON.parse(fs.readFileSync(file, "utf-8"));
}

/** The nodes `Next`-style execution reaches from `headId`, in order of discovery. */
function reached(graph: Graph, headId: string): GraphNode[] {
    const seen = new Set<string>();
    const queue = [headId];
    const out: GraphNode[] = [];
    while (queue.length > 0) {
        const nodeId = queue.shift()!;
        if (seen.has(nodeId) || !graph.nodes[nodeId]) {
            continue;
        }
        seen.add(nodeId);
        out.push(graph.nodes[nodeId]!);
        for (const edge of graph.edges) {
            if (edge.from.nodeId === nodeId && graph.nodes[edge.to.nodeId]) {
                queue.push(edge.to.nodeId);
            }
        }
    }
    return out;
}

describe.each(TEMPLATES)("the starter template's splash (%s)", tree => {
    const document = read(tree, "editor", "ui", "uidoc.json") as UIDoc;
    const blueprints = Object.values(
        (read(tree, "editor", "ui", "uigraphs.json") as { blueprintDocument: { blueprints: Record<string, Blueprint> } })
            .blueprintDocument.blueprints,
    );
    const splashId = document.entrySurfaceId!;
    const splash = document.surfaces.find(surface => surface.id === splashId);
    const blueprint = blueprints.find(item => item.owner.kind === "surfaceMain" && item.owner.surfaceId === splashId)!;
    const graphs = Object.values(blueprint?.graphs.events ?? {}).map(layer => layer.graph);
    const heads = graphs.flatMap(graph => Object.values(graph.nodes).map(node => ({ graph, node })));

    /** The function every way off the page calls, found from its head. */
    const openTitle = heads.find(({ node }) => node.type === BLUEPRINT_NODE_TYPE_FN_HEAD);
    const openTitleRef = openTitle ? `fn:${blueprint.id}:${openTitle.node.id}` : null;
    const callsOpenTitle = (graph: Graph, headId: string) =>
        reached(graph, headId).some(node =>
            node.type === BLUEPRINT_NODE_TYPE_FN_CALL && node.params?.[BLUEPRINT_NODE_PARAM_FN_REF] === openTitleRef);

    it("is the page the game opens on", () => {
        expect(splash).toBeDefined();
        expect(blueprint).toBeDefined();
    });

    it("opens the title from one function that remembers it ran", () => {
        expect(openTitle).toBeDefined();
        const body = reached(openTitle!.graph, openTitle!.node.id);
        const remember = body.findIndex(node => node.type === BLUEPRINT_NODE_TYPE_LOCAL_SET);
        const replace = body.findIndex(node =>
            node.type === BLUEPRINT_NODE_TYPE_PAGE_REPLACE && node.params?.surfaceId === TITLE);

        expect(remember).toBeGreaterThanOrEqual(0);
        expect(replace).toBeGreaterThan(remember);
    });

    it.each(["advance", "dismiss"])("answers %s by opening the title at once", actionId => {
        expect(splash?.actions?.map(enablement => enablement.actionId)).toContain(actionId);
        const head = heads.find(({ node }) =>
            node.type === BLUEPRINT_NODE_TYPE_EVENT_HEAD_ACTION && node.params?.[BLUEPRINT_NODE_PARAM_INPUT_ACTION_ID] === actionId);

        expect(head).toBeDefined();
        const path = reached(head!.graph, head!.node.id);
        // No wait between the press and the title.
        expect(path.some(node => node.type === BLUEPRINT_NODE_TYPE_FLOW_DELAY)).toBe(false);
        expect(callsOpenTitle(head!.graph, head!.node.id)).toBe(true);
    });

    it("opens the title through the same function when its beats run out", () => {
        const init = heads.find(({ node }) => node.type === BLUEPRINT_NODE_TYPE_EVENT_HEAD_SURFACE_INIT);

        expect(init).toBeDefined();
        expect(callsOpenTitle(init!.graph, init!.node.id)).toBe(true);
        // Nothing on the page replaces it except through that function.
        const directReplaces = heads.filter(({ node }) => node.type === BLUEPRINT_NODE_TYPE_PAGE_REPLACE);
        expect(directReplaces).toHaveLength(1);
    });
});
