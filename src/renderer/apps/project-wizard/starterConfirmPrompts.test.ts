/**
 * Every place the starter template asks before it takes something away.
 *
 * There are thirty-one of them and they are a handful of shapes repeated, which is exactly the
 * condition under which a per-page assertion stops being worth anything: one slot quietly wired
 * straight through reads, on its own page, like a page nobody got round to. So this sweeps all
 * thirty-one from one list and fails on the count as well as the wiring.
 *
 * What each one has to prove is not "a Show Confirm exists in this graph" - these graphs hold fifty
 * nodes and a stray one would satisfy that - but that the click reaches the confirm through the
 * branch that decides whether the question is worth asking, and that answering it lands on the very
 * node the click used to reach directly. The condition matters as much as the prompt: a confirm
 * that fires unconditionally is one players learn to click through, which costs the mechanism
 * exactly when it matters.
 *
 * Node types and pin ids come from the real catalogue, so renaming either breaks this rather than
 * leaving the template pointing at something that no longer exists.
 */
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
    BLUEPRINT_NODE_TYPE_COLLECTION_ARRAY_CONTAINS,
    BLUEPRINT_NODE_TYPE_EVENT_HEAD_ITEM_CLICK,
    BLUEPRINT_NODE_TYPE_EVENT_HEAD_MOUSE_CLICK,
    BLUEPRINT_NODE_TYPE_EVENT_HEAD_RIGHT_CLICK,
    BLUEPRINT_NODE_TYPE_FLOW_IF,
    BLUEPRINT_NODE_TYPE_GAME_IS_IN_GAME,
    BLUEPRINT_NODE_TYPE_GAME_SAVE_LIST_IDS,
    BLUEPRINT_NODE_TYPE_GAME_HISTORY_RESTORE,
    BLUEPRINT_NODE_TYPE_GAME_SAVE_DELETE,
    BLUEPRINT_NODE_TYPE_GAME_SAVE_LOAD,
    BLUEPRINT_NODE_TYPE_LAYER_CONFIRM,
    BLUEPRINT_NODE_TYPE_PAGE_QUIT,
    BLUEPRINT_NODE_TYPE_LITERAL_STRING,
    BLUEPRINT_NODE_TYPE_PAGE_GO,
    BLUEPRINT_NODE_TYPE_PERSISTENT_GET,
} from "@shared/types/blueprint/graph";
import { blueprintNodeRegistry } from "@/lib/ui-editor/blueprint-nodes/BlueprintNodeRegistry";
import { registerCoreBlueprintNodes } from "@/lib/ui-editor/blueprint-nodes/registerCoreBlueprintNodes";

type GraphNode = { id: string; type: string; params?: Record<string, unknown> };
type GraphEdge = { from: { nodeId: string; port: string }; to: { nodeId: string; port: string } };
type Graph = { nodes: Record<string, GraphNode>; edges: GraphEdge[] };
type Blueprint = {
    id: string;
    owner: { kind: string; surfaceId?: string; elementId?: string };
    program: { graphs: { events: Record<string, { graph: Graph }> } };
};
type Surface = { id: string; name: string };
type UIDoc = { surfaces: Surface[]; elements: Record<string, { id: string; name: string }> };

function readTemplate(file: string): unknown {
    return JSON.parse(
        fs.readFileSync(path.join(process.cwd(), "resources/templates/skeleton/content/editor/ui", file), "utf-8"),
    );
}

const document = readTemplate("uidoc.json") as UIDoc;
const blueprints = Object.values(
    (readTemplate("uigraphs.json") as { blueprintDocument: { blueprints: Record<string, Blueprint> } })
        .blueprintDocument.blueprints,
);
const confirmSurfaceId = document.surfaces.find(surface => surface.name === "Confirm")!.id;

/** The one event graph on the blueprint that answers for an element, with lookups over it. */
function graphFor(elementId: string) {
    const blueprint = blueprints.find(
        candidate => candidate.owner.kind === "widgetMain" && candidate.owner.elementId === elementId,
    );
    expect(blueprint, `no blueprint answers for element ${elementId}`).toBeDefined();
    const graphs = Object.values(blueprint!.program.graphs.events);
    expect(graphs).toHaveLength(1);
    const { nodes, edges } = graphs[0]!.graph;

    /** The node an exec output leads to, asserted to be the only one and of the expected type. */
    const step = (fromId: string, port: string, type: string): GraphNode => {
        const out = edges.filter(edge => edge.from.nodeId === fromId && edge.from.port === port);
        expect(out, `${fromId}.${port} leads to ${out.length} nodes`).toHaveLength(1);
        const target = nodes[out[0]!.to.nodeId]!;
        expect(target?.type, `${fromId}.${port} leads to ${target?.type}`).toBe(type);
        return target;
    };
    /** The node feeding a data input, asserted to be the only one and of the expected type. */
    const source = (toId: string, port: string, type: string): GraphNode => {
        const incoming = edges.filter(edge => edge.to.nodeId === toId && edge.to.port === port);
        expect(incoming, `${toId}.${port} is fed by ${incoming.length} nodes`).toHaveLength(1);
        const from = nodes[incoming[0]!.from.nodeId]!;
        expect(from?.type, `${toId}.${port} is fed by ${from?.type}`).toBe(type);
        return from;
    };
    const leadsTo = (fromId: string, port: string, toId: string): boolean =>
        edges.some(edge => edge.from.nodeId === fromId && edge.from.port === port && edge.to.nodeId === toId);
    const only = (type: string): GraphNode => {
        const found = Object.values(nodes).filter(node => node.type === type);
        expect(found, `expected one ${type}, found ${found.length}`).toHaveLength(1);
        return found[0]!;
    };
    return { nodes, edges, step, source, leadsTo, only };
}

/**
 * The prompt itself: the page it puts up, the words on it, and the branch its first answer takes.
 *
 * Pins are resolved for the node's own params rather than the bare definition, because the answers
 * are pins the author added - reading them off the definition would assert nothing about whether
 * the template's stored pin list produces the ports it wires.
 */
function assertPrompt(confirm: GraphNode, message: string, answer: string): void {
    registerCoreBlueprintNodes();
    expect(confirm.params?.surfaceId).toBe(confirmSurfaceId);
    expect(confirm.params?.message).toBe(message);
    expect(confirm.params?.button_1_label).toBe(answer);
    // The way out. Every question the template asks offers one, and it is never the destructive one.
    expect(confirm.params?.button_2_label).toBe("Cancel");
    const pins = blueprintNodeRegistry
        .resolveCatalogEntryForNode(BLUEPRINT_NODE_TYPE_LAYER_CONFIRM, confirm.params)
        .pins.map(pin => pin.id);
    expect(pins).toEqual(expect.arrayContaining(["in", "message", "button_1_label", "button_1_pressed", "dismissed"]));
}

/** The four nav buttons that go back to the title, by the page each one sits on. */
const TITLE_BUTTONS: readonly { page: string; elementId: string }[] = [
    { page: "Log", elementId: "d68d4baa-b176-426a-874d-a9c66269e0da" },
    { page: "Config", elementId: "0f7bed84-816e-4cfd-b840-72ffe92356af" },
    { page: "Load", elementId: "3b48abce-4359-40fc-ad3e-808cc8dc7f05" },
    { page: "Save", elementId: "8bad6736-b4c1-4eaf-94e0-3b2fe0b07dc5" },
];

/** The six save slots, in the order they are laid out on the page. */
const SAVE_SLOTS: readonly string[] = [
    "387326a1-5514-4ee2-9d73-48fbe03de0b8",
    "fbc2bd42-7a0d-4528-8087-ecb494e50100",
    "ad28642d-321a-4422-9689-d51e103e6a9b",
    "25a9e39d-4ed9-4499-beb7-5d22c3d3b3a5",
    "9eed63ce-3aef-478b-9a07-54b25c76739e",
    "68f93492-5608-4cd1-9e6b-5ad3f158e4ca",
];

/** The six load slots, likewise. */
const LOAD_SLOTS: readonly string[] = [
    "437fc707-729e-4024-b756-3dd15f800223",
    "7b5f0ee2-a325-4063-9716-f62a91c6008d",
    "15bcd9c6-f1dd-4930-926c-a0f293bd1455",
    "fcd9b8c1-194d-450e-92b6-5124ca8a6fd9",
    "a3d414fd-6c74-4ea8-882a-1a0646543627",
    "c75bf9d9-7d38-4b74-ab1d-10816e2a1f14",
];

describe("the questions the starter template asks before it takes something away", () => {
    it("asks them in thirty-one places and nowhere else", () => {
        const asking = blueprints.flatMap(blueprint =>
            Object.values(blueprint.program.graphs.events).flatMap(event =>
                Object.values(event.graph.nodes)
                    .filter(node => node.type === BLUEPRINT_NODE_TYPE_LAYER_CONFIRM)
                    .map(node => `${blueprint.owner.elementId ?? blueprint.id}:${node.id}`),
            ),
        );
        // Counted rather than sampled: the suites below each know which of these they mean, and
        // this is what says nobody added a thirty-second prompt outside them.
        expect(asking).toHaveLength(31);
    });

    it.each(TITLE_BUTTONS)(
        "asks before leaving the $page page for the title, and only while a game is running",
        ({ elementId }) => {
            const { step, source, leadsTo, only } = graphFor(elementId);
            const click = only(BLUEPRINT_NODE_TYPE_EVENT_HEAD_MOUSE_CLICK);
            const branch = step(click.id, "then", BLUEPRINT_NODE_TYPE_FLOW_IF);
            source(branch.id, "condition", BLUEPRINT_NODE_TYPE_GAME_IS_IN_GAME);

            const confirm = step(branch.id, "true", BLUEPRINT_NODE_TYPE_LAYER_CONFIRM);
            assertPrompt(confirm, "Return to the title screen? Unsaved progress is lost.", "Return to title");

            // Both ways out reach the same Go Page: opened from the title, nothing is lost, so the
            // false branch is the old wiring untouched rather than a second copy of it.
            const go = step(branch.id, "false", BLUEPRINT_NODE_TYPE_PAGE_GO);
            expect(go.params?.surfaceId).toBe("narraleaf-studio:main-surface");
            expect(leadsTo(confirm.id, "button_1_pressed", go.id)).toBe(true);
        },
    );

    it.each(SAVE_SLOTS.map((elementId, index) => ({ slot: index + 1, elementId })))(
        "asks before overwriting save slot $slot, and only when that slot holds one",
        ({ slot, elementId }) => {
            const { step, source, leadsTo, only } = graphFor(elementId);
            const click = only(BLUEPRINT_NODE_TYPE_EVENT_HEAD_MOUSE_CLICK);

            // The gate reads the same question the slot's own refresh asks: is this id among the
            // saves that exist? An empty slot is written without a word.
            const listIds = step(click.id, "then", BLUEPRINT_NODE_TYPE_GAME_SAVE_LIST_IDS);
            const branch = step(listIds.id, "next", BLUEPRINT_NODE_TYPE_FLOW_IF);
            const contains = source(branch.id, "condition", BLUEPRINT_NODE_TYPE_COLLECTION_ARRAY_CONTAINS);
            expect(source(contains.id, "array", BLUEPRINT_NODE_TYPE_GAME_SAVE_LIST_IDS).id).toBe(listIds.id);
            expect(source(contains.id, "item", BLUEPRINT_NODE_TYPE_LITERAL_STRING).params?.value).toBe(String(slot));

            const confirm = step(branch.id, "true", BLUEPRINT_NODE_TYPE_LAYER_CONFIRM);
            assertPrompt(confirm, "This slot already holds a save. Overwrite it?", "Overwrite");

            const write = step(branch.id, "false", BLUEPRINT_NODE_TYPE_PERSISTENT_GET);
            expect(leadsTo(confirm.id, "button_1_pressed", write.id)).toBe(true);
        },
    );

    it.each(LOAD_SLOTS.map((elementId, index) => ({ slot: index + 1, elementId })))(
        "asks before loading save slot $slot over a running game, and not from the title",
        ({ slot, elementId }) => {
            const { step, source, leadsTo, only } = graphFor(elementId);
            const click = only(BLUEPRINT_NODE_TYPE_EVENT_HEAD_MOUSE_CLICK);

            // The slot-exists branch was already here; the question goes inside it, so pressing an
            // empty slot still does nothing at all.
            const listIds = step(click.id, "then", BLUEPRINT_NODE_TYPE_GAME_SAVE_LIST_IDS);
            const exists = step(listIds.id, "next", BLUEPRINT_NODE_TYPE_FLOW_IF);
            const contains = source(exists.id, "condition", BLUEPRINT_NODE_TYPE_COLLECTION_ARRAY_CONTAINS);
            expect(source(contains.id, "item", BLUEPRINT_NODE_TYPE_LITERAL_STRING).params?.value).toBe(String(slot));

            const branch = step(exists.id, "true", BLUEPRINT_NODE_TYPE_FLOW_IF);
            source(branch.id, "condition", BLUEPRINT_NODE_TYPE_GAME_IS_IN_GAME);

            const confirm = step(branch.id, "true", BLUEPRINT_NODE_TYPE_LAYER_CONFIRM);
            assertPrompt(confirm, "Load this save? Unsaved progress is lost.", "Load");

            const load = step(branch.id, "false", BLUEPRINT_NODE_TYPE_GAME_SAVE_LOAD);
            expect(leadsTo(confirm.id, "button_1_pressed", load.id)).toBe(true);
        },
    );

    // A right click deletes the slot under the cursor, and it is the one act here that nothing can
    // put back - the save screen can rewrite a slot, but a deleted one is gone. It was also the only
    // one of the sixteen shapes that asked nothing at all, which is why the sweep covers both pages
    // at once: the two graphs are the same graph, and a page that lost the question would read like
    // a page nobody got round to.
    it.each(
        [...SAVE_SLOTS.map((elementId, index) => ({ page: "Save", slot: index + 1, elementId })),
         ...LOAD_SLOTS.map((elementId, index) => ({ page: "Load", slot: index + 1, elementId }))],
    )(
        "asks before deleting $page slot $slot, and only when that slot holds one",
        ({ slot, elementId }) => {
            const { step, source, leadsTo, only } = graphFor(elementId);
            const rightClick = only(BLUEPRINT_NODE_TYPE_EVENT_HEAD_RIGHT_CLICK);

            // Same gate as the overwrite: an empty slot has nothing to lose, so it is deleted -
            // which deletes nothing - without a word.
            const listIds = step(rightClick.id, "then", BLUEPRINT_NODE_TYPE_GAME_SAVE_LIST_IDS);
            const branch = step(listIds.id, "next", BLUEPRINT_NODE_TYPE_FLOW_IF);
            const contains = source(branch.id, "condition", BLUEPRINT_NODE_TYPE_COLLECTION_ARRAY_CONTAINS);
            expect(source(contains.id, "item", BLUEPRINT_NODE_TYPE_LITERAL_STRING).params?.value).toBe(String(slot));

            const confirm = step(branch.id, "true", BLUEPRINT_NODE_TYPE_LAYER_CONFIRM);
            assertPrompt(confirm, "Delete this save? It cannot be brought back.", "Delete");

            // Unlike the other shapes there is no false branch to the act: a slot with nothing in it
            // is left alone rather than deleted quietly.
            const remaining = Object.values(graphFor(elementId).nodes).filter(
                node => node.type === BLUEPRINT_NODE_TYPE_GAME_SAVE_DELETE,
            );
            expect(remaining).toHaveLength(1);
            expect(leadsTo(confirm.id, "button_1_pressed", remaining[0].id)).toBe(true);
        },
    );

    it("asks before going back to a line in the log, because everything after it is undone", () => {
        const { step, leadsTo, only } = graphFor("5aab5352-98e9-4d9e-af03-1938fa5b5032");
        const itemClick = only(BLUEPRINT_NODE_TYPE_EVENT_HEAD_ITEM_CLICK);
        const confirm = step(itemClick.id, "then", BLUEPRINT_NODE_TYPE_LAYER_CONFIRM);
        assertPrompt(confirm, "Go back to this line? Everything after it is undone.", "Go back");

        // Unconditional on purpose: every row in the log is behind the play head, so there is always
        // something after it to lose.
        const restore = Object.values(graphFor("5aab5352-98e9-4d9e-af03-1938fa5b5032").nodes).filter(
            node => node.type === BLUEPRINT_NODE_TYPE_GAME_HISTORY_RESTORE,
        );
        expect(restore).toHaveLength(1);
        expect(leadsTo(confirm.id, "button_1_pressed", restore[0].id)).toBe(true);
    });

    it("asks before quitting, because the window closing is not something a click can take back", () => {
        const { step, leadsTo, only } = graphFor("281a47c0-277d-4ffb-83b9-8bee6a984480");
        const click = only(BLUEPRINT_NODE_TYPE_EVENT_HEAD_MOUSE_CLICK);
        const confirm = step(click.id, "then", BLUEPRINT_NODE_TYPE_LAYER_CONFIRM);
        assertPrompt(confirm, "Quit the game?", "Quit");
        const quit = only(BLUEPRINT_NODE_TYPE_PAGE_QUIT);
        expect(leadsTo(confirm.id, "button_1_pressed", quit.id)).toBe(true);
    });

    it("asks before loading an auto save over a running game, and not from the title", () => {
        const { step, source, leadsTo, only } = graphFor("3d379905-7bf0-4070-b528-d2098ce9034e");
        const itemClick = only(BLUEPRINT_NODE_TYPE_EVENT_HEAD_ITEM_CLICK);
        const branch = step(itemClick.id, "then", BLUEPRINT_NODE_TYPE_FLOW_IF);
        source(branch.id, "condition", BLUEPRINT_NODE_TYPE_GAME_IS_IN_GAME);

        const confirm = step(branch.id, "true", BLUEPRINT_NODE_TYPE_LAYER_CONFIRM);
        assertPrompt(confirm, "Load this auto save? The game you are in is left behind.", "Load");

        const load = step(branch.id, "false", BLUEPRINT_NODE_TYPE_GAME_SAVE_LOAD);
        expect(leadsTo(confirm.id, "button_1_pressed", load.id)).toBe(true);
    });
});
