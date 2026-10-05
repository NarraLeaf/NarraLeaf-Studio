/**
 * What the starter template's Continue button does.
 *
 * Continue means "back to where I left off", and the newest auto save is that place: the game writes
 * one every few seconds of play while auto saving is on. Without one there is no save the button can
 * call newest - the player's own saves come back from `List Saves` in the order the save store keeps
 * them, which is not the order they were written - so the button opens the Load page for the player
 * to pick from, and does nothing when there is no save at all. It used to load the last id of that
 * list, which read like "the newest save" and was whichever save the store happened to list last.
 *
 * Node types and pin ids come from the real catalogue, so renaming either breaks this rather than
 * leaving the template pointing at something that no longer exists.
 */
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
    BLUEPRINT_NODE_TYPE_COLLECTION_ARRAY_IS_EMPTY,
    BLUEPRINT_NODE_TYPE_EVENT_HEAD_MOUSE_CLICK,
    BLUEPRINT_NODE_TYPE_FLOW_IF,
    BLUEPRINT_NODE_TYPE_GAME_AUTO_SAVE_LATEST,
    BLUEPRINT_NODE_TYPE_GAME_SAVE_LIST_IDS,
    BLUEPRINT_NODE_TYPE_GAME_SAVE_LOAD,
    BLUEPRINT_NODE_TYPE_PAGE_GO,
} from "@shared/types/blueprint/graph";

type GraphNode = { id: string; type: string; params?: Record<string, unknown> };
type GraphEdge = { from: { nodeId: string; port: string }; to: { nodeId: string; port: string } };
type Graph = { nodes: Record<string, GraphNode>; edges: GraphEdge[] };
type Blueprint = { owner: { kind: string; elementId?: string }; graphs: { events: Record<string, { graph: Graph }> } };

const UI_DIR = path.join(process.cwd(), "resources/templates/skeleton/content/editor/ui");
const CONTINUE_BUTTON = "ac7c2f86-e356-4592-9dbf-04c0e55154da";

function continueGraph(): Graph {
    const blueprints = Object.values(
        (JSON.parse(fs.readFileSync(path.join(UI_DIR, "uigraphs.json"), "utf8")) as {
            blueprintDocument: { blueprints: Record<string, Blueprint> };
        }).blueprintDocument.blueprints,
    );
    const owned = blueprints.filter(item => item.owner.kind === "widgetMain" && item.owner.elementId === CONTINUE_BUTTON);
    expect(owned).toHaveLength(1);
    const layers = Object.values(owned[0]!.graphs.events);
    expect(layers).toHaveLength(1);
    return layers[0]!.graph;
}

describe("the starter template's Continue button", () => {
    const { nodes, edges } = continueGraph();
    const next = (fromId: string, port: string, type: string): GraphNode => {
        const out = edges.filter(edge => edge.from.nodeId === fromId && edge.from.port === port);
        expect(out, `${fromId}.${port} leads to ${out.length} nodes`).toHaveLength(1);
        const target = nodes[out[0]!.to.nodeId]!;
        expect(target.type).toBe(type);
        return target;
    };
    const feeds = (toId: string, port: string): { node: GraphNode; port: string } => {
        const incoming = edges.filter(edge => edge.to.nodeId === toId && edge.to.port === port);
        expect(incoming, `${toId}.${port} is fed by ${incoming.length} nodes`).toHaveLength(1);
        return { node: nodes[incoming[0]!.from.nodeId]!, port: incoming[0]!.from.port };
    };
    const click = Object.values(nodes).find(node => node.type === BLUEPRINT_NODE_TYPE_EVENT_HEAD_MOUSE_CLICK)!;

    it("loads the latest auto save when there is one", () => {
        const latest = next(click.id, "then", BLUEPRINT_NODE_TYPE_GAME_AUTO_SAVE_LATEST);
        const found = next(latest.id, "next", BLUEPRINT_NODE_TYPE_FLOW_IF);
        expect(feeds(found.id, "condition")).toEqual({ node: latest, port: "hasAutoSave" });
        const load = next(found.id, "true", BLUEPRINT_NODE_TYPE_GAME_SAVE_LOAD);
        expect(feeds(load.id, "id")).toEqual({ node: latest, port: "id" });
    });

    it("without one, opens the Load page when the player has saves, and does nothing when there are none", () => {
        const latest = next(click.id, "then", BLUEPRINT_NODE_TYPE_GAME_AUTO_SAVE_LATEST);
        const found = next(latest.id, "next", BLUEPRINT_NODE_TYPE_FLOW_IF);
        const list = next(found.id, "false", BLUEPRINT_NODE_TYPE_GAME_SAVE_LIST_IDS);
        const none = next(list.id, "next", BLUEPRINT_NODE_TYPE_FLOW_IF);
        const empty = feeds(none.id, "condition").node;
        expect(empty.type).toBe(BLUEPRINT_NODE_TYPE_COLLECTION_ARRAY_IS_EMPTY);
        expect(feeds(empty.id, "array")).toEqual({ node: list, port: "ids" });

        const open = next(none.id, "false", BLUEPRINT_NODE_TYPE_PAGE_GO);
        const surfaces = (JSON.parse(fs.readFileSync(path.join(UI_DIR, "uidoc.json"), "utf8")) as {
            surfaces: { id: string; name: string }[];
        }).surfaces;
        expect(surfaces.find(surface => surface.id === open.params?.surfaceId)?.name).toBe("Load");
        expect(edges.filter(edge => edge.from.nodeId === none.id && edge.from.port === "true")).toEqual([]);
        // Nothing loads a save picked out of the list: the list's order is not the order of play.
        expect(Object.values(nodes).filter(node => node.type === BLUEPRINT_NODE_TYPE_GAME_SAVE_LOAD)).toHaveLength(1);
    });
});
