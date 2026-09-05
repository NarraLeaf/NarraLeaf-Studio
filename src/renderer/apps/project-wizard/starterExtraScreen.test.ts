/**
 * The EXTRA screen every project made from the starter template arrives with.
 *
 * Four things a player recognises - the CG board, the scenes worth looking back on, the music and
 * the voices - and one screen, because they share a chrome and differ only in what fills the pane.
 * Read off the shipped files rather than a fixture: what is asserted is what an author receives.
 *
 * Three of the claims here are the ones most likely to be undone by somebody tidying up:
 *
 * 1. **CG and Recollection wrap; Music and Voice do not.** A picture is what identifies a CG, so it
 *    gets a tile; a track is a title and something to press and a voice line is text to read, so
 *    they get rows. `src/builtin-plugins/gallery/design.md` (P2) is where the reasoning lives, and
 *    it names this as the decision most likely to be "simplified" into one uniform grid. It must
 *    not be.
 * 2. **Every cell reads its row, and no cell asks whether the row is locked.** The catalog's
 *    projection has already replaced a locked entry's picture with the placeholder and its name
 *    with the mask, so a condition in the template would be a second answer to a settled question -
 *    and the kind that fails open.
 * 3. **The screen is reached from the title menu and from nowhere else.** Playing a recollection
 *    goes through `Start Game`, which replaces the current playthrough; return semantics were never
 *    built. The line that makes that safe is not a check inside the screen - a control that
 *    silently does nothing is worse - it is that the only way in is a title-screen button, and the
 *    only way to the title screen from a running story ends the story first.
 */
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
    BLUEPRINT_NODE_TYPE_ELEMENT_LIST_SET_ITEMS,
    BLUEPRINT_NODE_TYPE_EVENT_HEAD_INIT,
    BLUEPRINT_NODE_TYPE_EVENT_HEAD_ITEM_CLICK,
    BLUEPRINT_NODE_TYPE_FLOW_IF,
    BLUEPRINT_NODE_TYPE_GAME_START_STORY,
    BLUEPRINT_NODE_TYPE_PAGE_GO,
} from "@shared/types/blueprint/graph";

type GraphNode = { id: string; type: string; params?: Record<string, unknown> };
type GraphEdge = { from: { nodeId: string; port: string }; to: { nodeId: string; port: string } };
type Graph = { nodes: Record<string, GraphNode>; edges: GraphEdge[] };
type Blueprint = {
    id: string;
    owner: { kind: string; surfaceId?: string; elementId?: string };
    graphs: { events: Record<string, { graph: Graph }> };
};
type Element = {
    id: string;
    name: string;
    type: string;
    childrenIds?: string[];
    props?: Record<string, unknown>;
    layout?: Record<string, unknown>;
    valueBindings?: Record<string, { kind: string; fieldId?: string }>;
};
type Surface = { id: string; name: string; rootElementId: string };
type UIDoc = {
    surfaces: Surface[];
    elements: Record<string, Element>;
    structs?: Record<string, { fields: { id: string; key: string; type: string }[] }>;
};

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

/** The Gallery plugin's node types, spelled from its own id rather than pasted in. */
const GALLERY = "narraleaf.gallery";
const GET_ENTRIES = `${GALLERY}.getEntries`;
const GET_STATS = `${GALLERY}.getStats`;

function surfaceNamed(name: string): Surface {
    const surface = document.surfaces.find(candidate => candidate.name === name);
    expect(surface, `no surface named ${name}`).toBeDefined();
    return surface!;
}

const EXTRA = surfaceNamed("Extra");

function descendants(rootId: string): Element[] {
    const found: Element[] = [];
    const walk = (id: string): void => {
        const element = document.elements[id];
        if (!element) {
            return;
        }
        found.push(element);
        for (const child of element.childrenIds ?? []) {
            walk(child);
        }
    };
    walk(rootId);
    return found;
}

const EXTRA_ELEMENTS = descendants(EXTRA.rootElementId);

function on(name: string, type: string): Element {
    const found = EXTRA_ELEMENTS.filter(element => element.name === name && element.type === type);
    expect(found, `Extra has ${found.length} ${type} named ${name}`).toHaveLength(1);
    return found[0]!;
}

/** Every graph hanging off one element, whatever layer it is on. */
function graphsFor(elementId: string): Graph[] {
    return blueprints
        .filter(candidate => candidate.owner.elementId === elementId)
        .flatMap(candidate => Object.values(candidate.graphs.events).map(entry => entry.graph));
}

function graphWith(elementId: string, headType: string): Graph {
    const found = graphsFor(elementId).filter(graph =>
        Object.values(graph.nodes).some(node => node.type === headType));
    expect(found, `${elementId} has ${found.length} graphs answering ${headType}`).toHaveLength(1);
    return found[0]!;
}

function only(graph: Graph, type: string): GraphNode {
    const found = Object.values(graph.nodes).filter(node => node.type === type);
    expect(found, `expected one ${type}, found ${found.length}`).toHaveLength(1);
    return found[0]!;
}

/** Whether an edge runs from one node's port into another node's port. */
function wired(graph: Graph, from: string, fromPort: string, to: string, toPort: string): boolean {
    return graph.edges.some(edge =>
        edge.from.nodeId === from && edge.from.port === fromPort
        && edge.to.nodeId === to && edge.to.port === toPort);
}

/** The four segments, the kind each reads, and whether its pane is a grid or a list of rows. */
const SEGMENTS = [
    { button: "CG", list: "CG grid", kind: "cg", wraps: true },
    { button: "Recollection", list: "Recollection grid", kind: "scene", wraps: true },
    { button: "Music", list: "Music rows", kind: "music", wraps: false },
    { button: "Voice", list: "Voice rows", kind: "voice", wraps: false },
] as const;

describe("the starter template's EXTRA screen", () => {
    it("puts four segments beside one content pane, and the chrome does not move between them", () => {
        // The Config page's shape, reused rather than restated: a 240-wide rail of segments at the
        // top-left of the content area, and one pane behind it that every segment fills.
        const rail = on("Category rail", "nl.container");
        expect(rail.layout).toMatchObject({ x: 360, y: 190, width: 240, height: 700 });
        SEGMENTS.forEach(({ button, list }, index) => {
            expect(on(button, "nl.button").layout)
                .toMatchObject({ x: 0, y: index * 62, width: 240, height: 52 });
            expect(on(list, "nl.list").layout)
                .toMatchObject({ x: 660, y: 190, width: 1140, height: 700 });
        });
        // One visible at rest, so the screen is never blank before a press.
        const visible = SEGMENTS.filter(({ list }) => on(list, "nl.list").layout?.visible !== false);
        expect(visible.map(segment => segment.list)).toEqual(["CG grid"]);
    });

    it.each(SEGMENTS)("$button lays its rows out as the content deserves", ({ list, wraps }) => {
        // The claim design.md P2 makes, in the two props that carry it. A grid is one item template
        // flowing along a direction and breaking at the pane's edge; a row list is the same widget
        // with the second axis switched off.
        const props = on(list, "nl.list").props ?? {};
        expect(props.repeatWrap).toBe(wraps);
        expect(props.repeatDirection).toBe(wraps ? "horizontal" : "vertical");
        expect(props.itemGap).toBe(wraps ? 20 : 12);
    });

    it("makes three tiles fit a row, at the aspect a picture is drawn in", () => {
        for (const { list, wraps } of SEGMENTS.filter(segment => segment.wraps)) {
            expect(wraps).toBe(true);
            const tile = document.elements[on(list, "nl.list").childrenIds?.[0] ?? ""]!;
            const { width, height } = tile.layout as { width: number; height: number };
            // Three across the 1140-wide pane with the authored 20px gap between them.
            expect(width * 3 + 20 * 2).toBeLessThanOrEqual(1140);
            expect(width * 4 + 20 * 3).toBeGreaterThan(1140);
            expect(Math.abs(width / height - 16 / 9)).toBeLessThan(0.01);
        }
    });

    it.each(SEGMENTS)("$button fills its pane from Get Gallery, set to $kind", ({ list, kind }) => {
        const pane = on(list, "nl.list");
        const graph = graphWith(pane.id, BLUEPRINT_NODE_TYPE_EVENT_HEAD_INIT);
        const entries = only(graph, GET_ENTRIES);
        expect(entries.params?.galleryKind).toBe(kind);
        // Straight into the widget, with nothing in between: every row the node hands over already
        // carries its own lock state, its resolved picture and a masked name.
        const fill = only(graph, BLUEPRINT_NODE_TYPE_ELEMENT_LIST_SET_ITEMS);
        expect(wired(graph, entries.id, "entries", fill.id, "items")).toBe(true);

        // On Init rather than on the surface: a pane that is not visible is not mounted, so each
        // one fills itself when its segment is shown - and shows what is unlocked by then.
        const head = only(graph, BLUEPRINT_NODE_TYPE_EVENT_HEAD_INIT);
        expect(wired(graph, head.id, "then", entries.id, "in")).toBe(true);

        // And the count beside the title is the same segment's, from the node whose whole job it is.
        expect(only(graph, GET_STATS).params?.galleryKind).toBe(kind);
    });

    it("reads each cell off its row, and never asks a cell whether the row is locked", () => {
        const struct = document.structs?.["extra.galleryEntry"];
        expect(struct, "the screen declares the row shape Get Gallery hands over").toBeDefined();
        const fields = new Set(struct!.fields.map(field => field.key));

        let bound = 0;
        for (const { list } of SEGMENTS) {
            const pane = on(list, "nl.list");
            for (const element of descendants(pane.id)) {
                for (const [prop, binding] of Object.entries(element.valueBindings ?? {})) {
                    expect(binding.kind, `${list} ▸ ${element.name} ▸ ${prop}`).toBe("listItemField");
                    expect(fields, `${list} ▸ ${element.name} ▸ ${prop}`).toContain(binding.fieldId);
                    bound += 1;
                }
            }
            // Masking is the catalog's answer, so nothing inside a template branches on it: no cell
            // is hidden by a row's lock state, and no gallery node is read a second time per cell.
            for (const element of descendants(pane.id).slice(1)) {
                expect(Object.keys(element.valueBindings ?? {})).not.toContain("layout.visible");
                for (const graph of graphsFor(element.id)) {
                    const gallery = Object.values(graph.nodes).filter(node => node.type.startsWith(GALLERY));
                    expect(gallery, `${list} ▸ ${element.name} reads the gallery again`).toEqual([]);
                }
            }
        }
        // Two tiles' picture and name, and two rows' name.
        expect(bound).toBe(6);
    });

    it("is reached from the title menu and from nowhere else", () => {
        // The line that makes `Start Game` safe here. A recollection replaces the playthrough, and
        // return semantics do not exist - so the screen is not reachable with a story running, and
        // this is what says so. `Go Page` naming the Extra surface is the only way onto it.
        const entrances = blueprints.flatMap(blueprint =>
            Object.values(blueprint.graphs.events).flatMap(event =>
                Object.values(event.graph.nodes)
                    .filter(node => node.type === BLUEPRINT_NODE_TYPE_PAGE_GO && node.params?.surfaceId === EXTRA.id)
                    .map(() => blueprint.owner.elementId ?? blueprint.id)));
        const title = document.surfaces.find(surface => surface.name === "Title")!;
        const titleMenu = descendants(title.rootElementId).find(element => element.name === "Extra")!;
        expect(entrances).toEqual([titleMenu.id]);

        // And the screen's own rail offers only the way back, never the in-game entries that would
        // put it one press from a running story.
        const rail = on("Nav rail", "nl.container");
        const buttons = descendants(rail.id).filter(element => element.type === "nl.button");
        expect(buttons.map(button => button.name)).toEqual(["Back"]);
    });

    it("starts a recollection from the row that was pressed, once it is unlocked", () => {
        const graph = graphWith(on("Recollection grid", "nl.list").id, BLUEPRINT_NODE_TYPE_EVENT_HEAD_ITEM_CLICK);
        const gate = only(graph, BLUEPRINT_NODE_TYPE_FLOW_IF);
        const start = only(graph, BLUEPRINT_NODE_TYPE_GAME_START_STORY);
        // Where it goes comes off the row rather than out of the node's own pickers, which is what
        // makes one graph answer for every recollection there will ever be.
        for (const pin of ["storyId", "sceneId", "startBlockId"]) {
            const feeding = graph.edges.filter(edge => edge.to.nodeId === start.id && edge.to.port === pin);
            expect(feeding, `Start Game's ${pin} is not fed by the row`).toHaveLength(1);
            expect(graph.nodes[feeding[0]!.from.nodeId]?.type).toBe("blueprint.list.getItemField");
        }
        expect(start.params?.storyId ?? "").toBe("");
        // Nothing runs on the locked side of the gate.
        expect(graph.edges.some(edge => edge.from.nodeId === gate.id && edge.from.port === "false")).toBe(false);
    });
});
