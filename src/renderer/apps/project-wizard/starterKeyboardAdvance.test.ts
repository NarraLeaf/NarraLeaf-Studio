/**
 * A game made from the starter template moves its story on with a click, with Space and with Enter.
 *
 * Every visual novel does, and a reader holding a key rather than a mouse is the common case, not
 * the edge one. The starter's dialogue box answers the project's Advance action, and Advance carried
 * only a click: a shipped game read on with the mouse and with nothing else, and every project made
 * from the template shipped that way. The keys are the template's to state - they are a binding of
 * one entry in the project's action vocabulary, where an author sees them, changes them or removes
 * them - so this holds the template to it, in each language the template is written in.
 *
 * What makes the binding reach the dialogue box at all is the stage owning the keyboard while the
 * story is on screen (see `runtime/app/keyboardOwner`); `stageKeyboard.test.tsx` holds that half.
 */
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
    BLUEPRINT_NODE_PARAM_INPUT_ACTION_ID,
    BLUEPRINT_NODE_TYPE_EVENT_HEAD_ACTION,
    BLUEPRINT_NODE_TYPE_GAME_NEXT,
} from "@shared/types/blueprint/graph";
import type { UIInputActionDef, UISurfaceActionEnablement } from "@shared/types/ui-editor/inputAction";

type GraphNode = { id: string; type: string; params?: Record<string, unknown> };
type GraphEdge = { from: { nodeId: string; port: string }; to: { nodeId: string; port: string } };
type Graph = { nodes: Record<string, GraphNode>; edges: GraphEdge[] };
type Blueprint = {
    owner: { kind: string; surfaceId?: string };
    graphs: { events: Record<string, { graph: Graph }> };
};
type Surface = {
    id: string;
    kind: string;
    mount?: { kind: string; slotId?: string };
    actions?: UISurfaceActionEnablement[];
};
type UIDoc = { surfaces: Surface[]; actions?: Record<string, UIInputActionDef> };

const TEMPLATES = ["content", "content.zh", "content.ja"] as const;

function read(tree: string, ...segments: string[]): unknown {
    const file = path.join(process.cwd(), "resources/templates/skeleton", tree, ...segments);
    return JSON.parse(fs.readFileSync(file, "utf-8"));
}

/** Whether `Next` runs somewhere downstream of `head`, following the execution edges. */
function reachesNext(graph: Graph, headId: string): boolean {
    const seen = new Set<string>();
    const queue = [headId];
    while (queue.length > 0) {
        const nodeId = queue.shift()!;
        if (seen.has(nodeId)) {
            continue;
        }
        seen.add(nodeId);
        if (graph.nodes[nodeId]?.type === BLUEPRINT_NODE_TYPE_GAME_NEXT) {
            return true;
        }
        for (const edge of graph.edges) {
            if (edge.from.nodeId === nodeId && graph.nodes[edge.to.nodeId]) {
                queue.push(edge.to.nodeId);
            }
        }
    }
    return false;
}

describe.each(TEMPLATES)("the starter template (%s)", tree => {
    const document = read(tree, "editor", "ui", "uidoc.json") as UIDoc;
    const blueprints = Object.values(
        (read(tree, "editor", "ui", "uigraphs.json") as { blueprintDocument: { blueprints: Record<string, Blueprint> } })
            .blueprintDocument.blueprints,
    );
    const dialogue = document.surfaces.find(surface => surface.kind === "stageSurface" && surface.mount?.slotId === "dialog");

    /** The actions the dialogue box answers with a graph that runs `Next`. */
    const advancing = (dialogue?.actions ?? [])
        .map(enablement => enablement.actionId)
        .filter(actionId => blueprints.some(blueprint =>
            blueprint.owner.kind === "surfaceMain"
            && blueprint.owner.surfaceId === dialogue?.id
            && Object.values(blueprint.graphs.events).some(({ graph }) =>
                Object.values(graph.nodes).some(node =>
                    node.type === BLUEPRINT_NODE_TYPE_EVENT_HEAD_ACTION
                    && node.params?.[BLUEPRINT_NODE_PARAM_INPUT_ACTION_ID] === actionId
                    && reachesNext(graph, node.id)))));

    it("has a dialogue box that answers an action with Next", () => {
        expect(dialogue).toBeDefined();
        expect(advancing).toHaveLength(1);
    });

    it("binds that action to a click, Space and Enter", () => {
        const bindings = document.actions?.[advancing[0]!]?.bindings ?? [];

        expect(bindings).toEqual(expect.arrayContaining([
            { kind: "pointer", gesture: "click" },
            { kind: "key", key: "Space" },
            { kind: "key", key: "Enter" },
        ]));
    });
});
