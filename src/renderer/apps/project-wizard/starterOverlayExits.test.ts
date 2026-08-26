/**
 * How the starter template's screens get out of the way of a running game.
 *
 * A screen opened over a playthrough is not a page in a menu tree — it is something covering the
 * story, and the way out of it is back to the story. `Go back` alone cannot say that: it removes
 * one page, so a player who reached Save through Config through the quick menu presses it three
 * times, watching two screens they did not ask for on the way. `Clear Page` is the node that says
 * "whatever this game is wearing, take it off", and does nothing at all when no game is running —
 * which is what lets the same pair be wired everywhere: over a game it returns to the story, and on
 * the title screen it degrades to exactly the `Go back` it is followed by.
 *
 * Both ways out have to agree, which is the half that was wrong: Escape cleared the overlay and the
 * Back button beside it removed one page, so the same intent got two different answers depending on
 * which the player reached for.
 *
 * The key itself is no longer written on the five screens either. "Escape means dismiss" is one
 * entry of the project's action vocabulary, and each screen answers `dismiss` — so the binding is
 * checked once here, and each screen is only asked whether it answers the action at all.
 *
 * Swept from the surface list rather than named one page at a time — a screen added without a way
 * out reads, on its own, like a screen nobody had got to yet.
 */
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
    BLUEPRINT_NODE_PARAM_INPUT_ACTION_ID,
    BLUEPRINT_NODE_TYPE_EVENT_HEAD_ACTION,
    BLUEPRINT_NODE_TYPE_EVENT_HEAD_MOUSE_CLICK,
    BLUEPRINT_NODE_TYPE_FLOW_IF,
    BLUEPRINT_NODE_TYPE_PAGE_BACK,
    BLUEPRINT_NODE_TYPE_PAGE_CLEAR,
    BLUEPRINT_NODE_TYPE_SOUND_PLAY,
} from "@shared/types/blueprint/graph";
import type { UIInputActionDef, UISurfaceActionEnablement } from "@shared/types/ui-editor/inputAction";

type GraphNode = { id: string; type: string; params?: Record<string, unknown> };
type GraphEdge = { from: { nodeId: string; port: string }; to: { nodeId: string; port: string } };
type Graph = { nodes: Record<string, GraphNode>; edges: GraphEdge[] };
type Blueprint = {
    id: string;
    owner: { kind: string; surfaceId?: string; elementId?: string };
    program: { graphs: { events: Record<string, { graph: Graph }> } };
};
type Element = { id: string; name: string; type: string; childrenIds?: string[] };
type Surface = { id: string; name: string; rootElementId: string; actions?: UISurfaceActionEnablement[] };
type UIDoc = {
    surfaces: Surface[];
    elements: Record<string, Element>;
    actions?: Record<string, UIInputActionDef>;
};

/** The vocabulary entry the five screens answer. */
const DISMISS = "dismiss";

const TEMPLATE = path.join(process.cwd(), "resources/templates/skeleton/content");

function readTemplate(...segments: string[]): unknown {
    return JSON.parse(fs.readFileSync(path.join(TEMPLATE, ...segments), "utf-8"));
}

const document = readTemplate("editor", "ui", "uidoc.json") as UIDoc;
const blueprints = Object.values(
    (readTemplate("editor", "ui", "uigraphs.json") as {
        blueprintDocument: { blueprints: Record<string, Blueprint> };
    }).blueprintDocument.blueprints,
);

/**
 * The screens a player can be standing on with a game running underneath.
 *
 * Not the title (nothing is ever under it), and not the Game UI slot surfaces — a dialogue band or
 * a quick menu is drawn by the stage rather than opened over it, so there is no page to close.
 */
const SCREENS = ["Log", "Config", "Load", "Save", "Scenes"] as const;

function surfaceNamed(name: string): Surface {
    const surface = document.surfaces.find(candidate => candidate.name === name);
    expect(surface, `no surface named ${name}`).toBeDefined();
    return surface!;
}

function buttonsOn(surfaceName: string, elementName: string): Element[] {
    const found: Element[] = [];
    const walk = (id: string): void => {
        const element = document.elements[id];
        if (!element) {
            return;
        }
        if (element.name === elementName && element.type === "nl.button") {
            found.push(element);
        }
        for (const child of element.childrenIds ?? []) {
            walk(child);
        }
    };
    walk(surfaceNamed(surfaceName).rootElementId);
    return found;
}

function graphsOf(owner: (blueprint: Blueprint) => boolean): Graph[] {
    return blueprints
        .filter(owner)
        .flatMap(blueprint => Object.values(blueprint.program.graphs.events).map(event => event.graph));
}

/**
 * The cues the project declares, by the reference a call names.
 *
 * A cue is a call to a global function that plays a clip, so "step over the cue" can no longer be a
 * node-type test - `Call Fn` is also how a save card refreshes itself, and stepping over that would
 * make this file walk past the thing it is checking.
 */
const CUE_FN_REFS: ReadonlySet<string> = new Set(
    blueprints.flatMap(blueprint =>
        Object.values(blueprint.program.graphs.events).flatMap(event => {
            const { nodes, edges } = event.graph;
            return Object.values(nodes)
                .filter(head => head.type === "blueprint.fn.head")
                .filter(head => {
                    const body = edges.find(edge => edge.from.nodeId === head.id && edge.from.port === "then");
                    return body ? nodes[body.to.nodeId]?.type === BLUEPRINT_NODE_TYPE_SOUND_PLAY : false;
                })
                .map(head => `fn:${blueprint.id}:${head.id}`);
        }),
    ),
);

/** The single node an exec output runs, stepping over a sound cue that decorates the route. */
function next(graph: Graph, fromId: string, port: string): GraphNode {
    const out = graph.edges.filter(edge => edge.from.nodeId === fromId && edge.from.port === port);
    expect(out, `${fromId}.${port} leads to ${out.length} nodes`).toHaveLength(1);
    const node = graph.nodes[out[0]!.to.nodeId]!;
    return CUE_FN_REFS.has(String(node.params?.fnRef ?? "")) ? next(graph, node.id, "next") : node;
}

function only(graph: Graph, type: string): GraphNode {
    const found = Object.values(graph.nodes).filter(node => node.type === type);
    expect(found, `expected one ${type}, found ${found.length}`).toHaveLength(1);
    return found[0]!;
}

/** `head → … → Clear Page → Go back`, which is the whole shape under test. */
function assertClearsThenSteps(graph: Graph, headId: string, port: string): void {
    const clear = next(graph, headId, port);
    expect(clear.type).toBe(BLUEPRINT_NODE_TYPE_PAGE_CLEAR);
    const back = next(graph, clear.id, "next");
    expect(back.type).toBe(BLUEPRINT_NODE_TYPE_PAGE_BACK);
}

describe("every starter screen leaves a running game the same way", () => {
    it("says once, for the whole project, that Escape means dismiss", () => {
        const dismiss = document.actions?.[DISMISS];
        expect(dismiss, "the template declares no dismiss action").toBeDefined();
        expect(dismiss!.bindings).toContainEqual({ kind: "key", key: "Escape" });
    });

    it.each(SCREENS)("%s answers the dismiss action by taking the overlay off", screenName => {
        const surface = surfaceNamed(screenName);
        expect(
            surface.actions?.map(entry => entry.actionId),
            `${screenName} does not answer ${DISMISS}`,
        ).toContain(DISMISS);

        const graphs = graphsOf(
            blueprint => blueprint.owner.kind === "surfaceMain" && blueprint.owner.surfaceId === surface.id,
        ).filter(graph =>
            Object.values(graph.nodes).some(
                node => node.type === BLUEPRINT_NODE_TYPE_EVENT_HEAD_ACTION
                    && node.params?.[BLUEPRINT_NODE_PARAM_INPUT_ACTION_ID] === DISMISS,
            ),
        );
        expect(graphs, `${screenName} has ${graphs.length} graphs answering ${DISMISS}`).toHaveLength(1);

        const graph = graphs[0]!;
        const head = only(graph, BLUEPRINT_NODE_TYPE_EVENT_HEAD_ACTION);
        // The log is the one screen whose answer is conditional — the key closes it from anywhere,
        // the wheel only once the entries are at the bottom — so the route out starts one node
        // further along. It is the same pair of nodes at the end of it either way.
        const first = next(graph, head.id, "then");
        if (first.type === BLUEPRINT_NODE_TYPE_FLOW_IF) {
            assertClearsThenSteps(graph, first.id, "true");
        } else {
            assertClearsThenSteps(graph, head.id, "then");
        }
    });

    it.each(SCREENS)("%s answers its Back button the same way Escape does", screenName => {
        const buttons = buttonsOn(screenName, "Back");
        expect(buttons, `${screenName} has ${buttons.length} Back buttons`).toHaveLength(1);

        const graphs = graphsOf(
            blueprint => blueprint.owner.kind === "widgetMain" && blueprint.owner.elementId === buttons[0]!.id,
        ).filter(graph =>
            Object.values(graph.nodes).some(node => node.type === BLUEPRINT_NODE_TYPE_EVENT_HEAD_MOUSE_CLICK),
        );
        expect(graphs, `Back on ${screenName} has ${graphs.length} graphs answering a click`).toHaveLength(1);

        const graph = graphs[0]!;
        assertClearsThenSteps(graph, only(graph, BLUEPRINT_NODE_TYPE_EVENT_HEAD_MOUSE_CLICK).id, "then");
    });
});
