/**
 * The EXTRA screen every project made from the starter template arrives with.
 *
 * Four things a player recognises - the CG board, the scenes worth looking back on, the music and
 * the voices - and one screen, because they share a chrome and differ only in what fills the pane.
 * Read off the shipped files rather than a fixture: what is asserted is what an author receives.
 *
 * Four of the claims here are the ones most likely to be undone by somebody tidying up:
 *
 * 1. **CG and Recollection wrap; Music and Voice do not.** A picture is what identifies a CG, so it
 *    gets a tile; a track is a title and something to press and a voice line is text to read, so
 *    they get rows. `src/builtin-plugins/gallery/design.md` (P2) is where the reasoning lives, and
 *    it names this as the decision most likely to be "simplified" into one uniform grid. It must
 *    not be.
 * 2. **Every cell reads its row, and what a locked row withholds is the catalog's answer alone.**
 *    The catalog's projection has already replaced a locked entry's picture with the placeholder
 *    (or with nothing) and its name with the mask, so no picture or name in the template is
 *    conditioned on the lock - that would be a second answer to a settled question, and the kind
 *    that fails open. The lock state is read for one thing only: to make a locked cell *look*
 *    locked rather than empty. A tile gets a dark backdrop with a padlock drawn from plain
 *    containers, and a row gets the same padlock at a third of the size where its play mark would
 *    be. It is built from no picture, because the project that most needs it - a new one, where
 *    nothing is unlocked - has no art to give it. The backdrop sits *beneath* the art, so a
 *    silhouette the author did set (`lockedImageAssetId`) paints over it; and it is not drawn at
 *    all on an unlocked row, so an unlocked tile is exactly what it was without it.
 * 3. **A CG tile answers nothing yet, and advertises nothing.** Opening the picture at full size is
 *    the obvious next thing and is not here yet. The tiles were built when a write made from inside
 *    a list row was addressed to that row's own drawing whatever it named, so a row could not show,
 *    fill or hide anything outside itself. A row now addresses the drawing its target is really in
 *    (`resolveUIWidgetAddressFromDrawing` in `@shared/types/ui-editor/widgetDrawing`), so a viewer
 *    can be written plainly; until one is, the tiles keep advertising nothing - no pointer cursor,
 *    no hover state, no cue - because a cue for a press that does nothing is worse than none.
 * 4. **The screen is reached from the title menu and from nowhere else.** Playing a recollection
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

    it("reads each cell off its row, and leaves what a locked row withholds to the catalog", () => {
        const struct = document.structs?.["extra.galleryEntry"];
        expect(struct, "the screen declares the row shape Get Gallery hands over").toBeDefined();
        const fields = new Set(struct!.fields.map(field => field.key));
        // Both halves of the lock state are declared: a row that is not unlocked is not necessarily
        // locked (a placeholder row on the canvas is neither), and a binding can only read a field,
        // never its negation.
        expect(fields).toContain("unlocked");
        expect(fields).toContain("locked");

        let bound = 0;
        const shownOnlyWhen: string[] = [];
        for (const { list } of SEGMENTS) {
            const pane = on(list, "nl.list");
            for (const element of descendants(pane.id)) {
                for (const [prop, binding] of Object.entries(element.valueBindings ?? {})) {
                    expect(binding.kind, `${list} ▸ ${element.name} ▸ ${prop}`).toBe("listItemField");
                    expect(fields, `${list} ▸ ${element.name} ▸ ${prop}`).toContain(binding.fieldId);
                    bound += 1;
                    if (prop === "layout.visible") {
                        shownOnlyWhen.push(`${list} ▸ ${element.name} ▸ ${binding.fieldId}`);
                    }
                }
            }
            // Masking is the catalog's answer, so nothing that shows the row's content branches on
            // it: the picture and the name are drawn whatever the lock state, and no gallery node is
            // read a second time per cell.
            for (const element of descendants(pane.id).slice(1)) {
                if (["Art", "Name", "Name plate"].includes(element.name)) {
                    expect(Object.keys(element.valueBindings ?? {}), `${list} ▸ ${element.name}`)
                        .not.toContain("layout.visible");
                }
                for (const graph of graphsFor(element.id)) {
                    const gallery = Object.values(graph.nodes).filter(node => node.type.startsWith(GALLERY));
                    expect(gallery, `${list} ▸ ${element.name} reads the gallery again`).toEqual([]);
                }
            }
        }
        // The lock state decides only the locked look, and on a row, whether the play mark
        // promises a press that would do something.
        expect(shownOnlyWhen).toEqual([
            "CG grid ▸ Locked backdrop ▸ locked",
            "Recollection grid ▸ Locked backdrop ▸ locked",
            "Music rows ▸ Play mark ▸ unlocked",
            "Music rows ▸ Locked mark ▸ locked",
            "Voice rows ▸ Play mark ▸ unlocked",
            "Voice rows ▸ Locked mark ▸ locked",
        ]);
        // Two tiles' picture, name and locked backdrop; two rows' name, play mark and lock.
        expect(bound).toBe(12);
    });

    it.each(SEGMENTS.filter(segment => segment.wraps))(
        "draws a locked $button tile as a dark block with a padlock, beneath the art and from no picture",
        ({ list }) => {
            const tile = document.elements[on(list, "nl.list").childrenIds?.[0] ?? ""]!;
            const children = (tile.childrenIds ?? []).map(id => document.elements[id]!);
            const backdrop = children.find(child => child.name === "Locked backdrop");
            const art = children.find(child => child.name === "Art");
            expect(backdrop, `${list} has no locked backdrop`).toBeDefined();
            expect(art?.type).toBe("nl.image");

            // Beneath the art: a silhouette the author set for a locked entry paints over the
            // backdrop and is never covered by it. With no silhouette the image draws nothing, and
            // the backdrop is what shows.
            expect(children.indexOf(backdrop!)).toBeLessThan(children.indexOf(art!));
            expect(backdrop!.valueBindings?.["layout.visible"]).toEqual({ kind: "listItemField", fieldId: "locked" });

            // A flat slab inside the tile's one-pixel border, so a locked tile keeps its outline.
            const tileBox = tile.layout as { width: number; height: number };
            const tileBorder = (tile.props?.borderWidth as number | undefined) ?? 0;
            expect(backdrop!.layout).toMatchObject({
                x: tileBorder,
                y: tileBorder,
                width: tileBox.width - 2 * tileBorder,
                height: tileBox.height - 2 * tileBorder,
            });
            expect(backdrop!.props?.fillVisible).toBe(true);
            expect(String(backdrop!.props?.backgroundColor)).toMatch(/^nlbrand:/);

            // Drawn from plain containers: no picture to ship, and no glyph whose look depends on
            // which fonts the player's machine has.
            for (const part of descendants(backdrop!.id)) {
                expect(part.type, `${list} ▸ ${part.name}`).toBe("nl.container");
                expect(part.props?.fillType ?? "color", `${list} ▸ ${part.name}`).toBe("color");
                expect(part.props?.imageFill ?? null, `${list} ▸ ${part.name}`).toBeNull();
                expect(part.props?.backgroundImage ?? "", `${list} ▸ ${part.name}`).toBe("");
            }

            // The padlock sits in the middle of the part of the tile the name plate leaves open.
            const mark = descendants(backdrop!.id).find(part => part.name === "Locked mark")!;
            const plate = children.find(child => child.name === "Name plate")!;
            const box = mark.layout as { x: number; y: number; width: number; height: number };
            const open = { width: tileBox.width, height: (plate.layout as { y: number }).y };
            const centreX = tileBorder + box.x + box.width / 2;
            const centreY = tileBorder + box.y + box.height / 2;
            expect(Math.abs(centreX - open.width / 2)).toBeLessThanOrEqual(1);
            expect(Math.abs(centreY - open.height / 2)).toBeLessThanOrEqual(1);
        },
    );

    it("gives a locked row the tile's padlock at a third of the size, in place of the play mark", () => {
        const tileMark = descendants(on("CG grid", "nl.list").id).find(element => element.name === "Locked mark")!;
        const tileParts = descendants(tileMark.id).slice(1);
        for (const { list } of SEGMENTS.filter(segment => !segment.wraps)) {
            const row = document.elements[on(list, "nl.list").childrenIds?.[0] ?? ""]!;
            const children = (row.childrenIds ?? []).map(id => document.elements[id]!);
            const play = children.find(child => child.name === "Play mark")!;
            const lock = children.find(child => child.name === "Locked mark");
            expect(lock, `${list} has no lock mark`).toBeDefined();

            // One slot, two tenants that never meet: the play mark promises a press that plays, and
            // on a locked row that press does nothing, so the lock takes its place.
            expect(play.valueBindings?.["layout.visible"]).toEqual({ kind: "listItemField", fieldId: "unlocked" });
            expect(lock!.valueBindings?.["layout.visible"]).toEqual({ kind: "listItemField", fieldId: "locked" });
            const slot = play.layout as { x: number; y: number; width: number; height: number };
            const box = lock!.layout as { x: number; y: number; width: number; height: number };
            expect(Math.abs(box.x + box.width / 2 - (slot.x + slot.width / 2))).toBeLessThanOrEqual(1);
            expect(Math.abs(box.y + box.height / 2 - (slot.y + slot.height / 2))).toBeLessThanOrEqual(1);

            // The same construct, not a second visual language: the same parts in the same order,
            // the same colours, and every measurement a third of the tile's, give or take the pixel
            // a small shape has to be rounded to.
            const rowParts = descendants(lock!.id).slice(1);
            expect(rowParts.map(part => part.name)).toEqual(tileParts.map(part => part.name));
            rowParts.forEach((part, index) => {
                const big = tileParts[index]!;
                expect(part.type).toBe("nl.container");
                expect(part.props?.borderColor).toBe(big.props?.borderColor);
                if (part.name !== "Keyhole") {
                    // The keyhole is cut in the colour behind it, which differs between a tile and a row.
                    expect(part.props?.backgroundColor).toBe(big.props?.backgroundColor);
                }
                for (const key of ["x", "y", "width", "height"] as const) {
                    const small = (part.layout as Record<string, number>)[key]!;
                    const large = (big.layout as Record<string, number>)[key]!;
                    expect(Math.abs(small * 3 - large), `${list} ▸ ${part.name} ▸ ${key}`).toBeLessThanOrEqual(3);
                }
            });
        }
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

    it("leaves a CG tile answering nothing, rather than half-answering", () => {
        // See the note at the top: a row cannot address anything outside itself, so the press that
        // would open the picture is left out entirely rather than wired to something that half
        // works. Nothing on the tile advertises one.
        const grid = on("CG grid", "nl.list");
        expect(graphsFor(grid.id).flatMap(graph =>
            Object.values(graph.nodes).filter(node => node.type === BLUEPRINT_NODE_TYPE_EVENT_HEAD_ITEM_CLICK)))
            .toEqual([]);
        for (const element of descendants(grid.id)) {
            expect((element.props ?? {}).cursor, `${element.name} offers a pointer`).toBeUndefined();
        }
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
