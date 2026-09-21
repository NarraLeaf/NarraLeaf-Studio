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
 *    that fails open. The lock state is read for two things only: to make a locked cell *look*
 *    locked rather than empty, and to decide whether a cell offers a press at all (claim 3). A
 *    tile gets a dark backdrop with a padlock drawn from plain containers, and a row gets the same
 *    padlock at a third of the size where its play mark would be. It is built from no picture,
 *    because the project that most needs it - a new one, where nothing is unlocked - has no art to
 *    give it. The backdrop sits *beneath* the art, so a silhouette the author did set
 *    (`lockedImageAssetId`) paints over it; and it is not drawn at all on an unlocked row, so an
 *    unlocked tile is exactly what it was without it.
 * 3. **An unlocked CG tile opens its picture at full size; a locked one does nothing and promises
 *    nothing.** The press is the grid's Item Click, and it writes straight out of the row: the
 *    pressed artwork's unlocked pictures, read off the row and starting at the one the tile shows,
 *    into a page variable, and then the viewer - an element the row does not contain - shown. No
 *    broadcast, no relay. That is only possible because a row addresses the drawing its target is
 *    really in (`resolveUIWidgetAddressFromDrawing` in `@shared/types/ui-editor/widgetDrawing`); a
 *    row used to be unable to show, fill or hide anything outside itself. The viewer's picture is
 *    drawn the way the tile's art is - a row whose `image` field an image reads - and fills itself
 *    as it appears, the way every pane here does. From there it is the GalGame convention: each
 *    press steps to the artwork's next unlocked variant and the one after the last closes the
 *    viewer, as does a right click or the page's dismiss action, and the board under it is never
 *    touched. The pointer and the hover frame live on a hit area drawn only for an unlocked row, so
 *    a locked tile advertises nothing - a cue for a press that does nothing is worse than none. The
 *    recollection tile, whose unlocked press starts its scene, carries the same hit area.
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
    BLUEPRINT_NODE_TYPE_COLLECTION_ARRAY_FIND,
    BLUEPRINT_NODE_TYPE_COLLECTION_ARRAY_IS_EMPTY,
    BLUEPRINT_NODE_TYPE_COLLECTION_ARRAY_REMOVE_AT,
    BLUEPRINT_NODE_TYPE_COLLECTION_ARRAY_SLICE,
    BLUEPRINT_NODE_TYPE_ELEMENT_DISPLAYABLE_SET_PROPERTY,
    BLUEPRINT_NODE_TYPE_ELEMENT_LIST_SET_ITEMS,
    BLUEPRINT_NODE_TYPE_ELEMENT_REF,
    BLUEPRINT_NODE_TYPE_EVENT_HEAD_ACTION,
    BLUEPRINT_NODE_TYPE_EVENT_HEAD_INIT,
    BLUEPRINT_NODE_TYPE_EVENT_HEAD_ITEM_CLICK,
    BLUEPRINT_NODE_TYPE_EVENT_HEAD_MOUSE_CLICK,
    BLUEPRINT_NODE_TYPE_EVENT_HEAD_RIGHT_CLICK,
    BLUEPRINT_NODE_TYPE_FLOW_IF,
    BLUEPRINT_NODE_TYPE_GAME_START_STORY,
    BLUEPRINT_NODE_TYPE_LIST_GET_ITEM_FIELD,
    BLUEPRINT_NODE_TYPE_LOCAL_SET,
    BLUEPRINT_NODE_TYPE_PAGE_BACK,
    BLUEPRINT_NODE_TYPE_PAGE_GO,
} from "@shared/types/blueprint/graph";

type GraphNode = { id: string; type: string; params?: Record<string, unknown> };
type GraphEdge = { from: { nodeId: string; port: string }; to: { nodeId: string; port: string } };
type Graph = { nodes: Record<string, GraphNode>; edges: GraphEdge[] };
type Blueprint = {
    id: string;
    owner: { kind: string; surfaceId?: string; elementId?: string };
    graphs: { events: Record<string, { graph: Graph }> };
    members?: { variables?: Record<string, { id: string; name: string; valueType?: string }> };
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

/** The one node wired into a data input. */
function feeding(graph: Graph, nodeId: string, port: string): GraphNode {
    const edges = graph.edges.filter(edge => edge.to.nodeId === nodeId && edge.to.port === port);
    expect(edges, `${nodeId}.${port} is fed ${edges.length} times`).toHaveLength(1);
    return graph.nodes[edges[0]!.from.nodeId]!;
}

/** The element an element input points at, read off the `Element` node wired into it. */
function elementAt(graph: Graph, nodeId: string, port = "element"): string {
    const ref = feeding(graph, nodeId, port);
    expect(ref.type).toBe(BLUEPRINT_NODE_TYPE_ELEMENT_REF);
    return String(ref.params?.elementId ?? "");
}

/**
 * Every node that runs once an execution output fires. Every node on these screens takes execution
 * on a pin named `in`, so following the edges into `in` walks the execution path and nothing else.
 */
function runsAfter(graph: Graph, nodeId: string, port: string): Set<string> {
    const reached = new Set<string>();
    const pending = graph.edges
        .filter(edge => edge.from.nodeId === nodeId && edge.from.port === port && edge.to.port === "in")
        .map(edge => edge.to.nodeId);
    while (pending.length > 0) {
        const next = pending.pop()!;
        if (reached.has(next)) {
            continue;
        }
        reached.add(next);
        for (const edge of graph.edges) {
            if (edge.from.nodeId === next && edge.to.port === "in") {
                pending.push(edge.to.nodeId);
            }
        }
    }
    return reached;
}

/** The nodes of one type that run once an execution output fires. */
function ranAfter(graph: Graph, nodeId: string, port: string, type: string): GraphNode[] {
    const reached = runsAfter(graph, nodeId, port);
    return Object.values(graph.nodes).filter(node => node.type === type && reached.has(node.id));
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
        // The lock state decides only the locked look, and whether a cell promises a press that
        // would do something: a tile's hit area, a row's play mark.
        expect(shownOnlyWhen).toEqual([
            "CG grid ▸ Locked backdrop ▸ locked",
            "CG grid ▸ Hit area ▸ unlocked",
            "Recollection grid ▸ Locked backdrop ▸ locked",
            "Recollection grid ▸ Hit area ▸ unlocked",
            "Music rows ▸ Play mark ▸ unlocked",
            "Music rows ▸ Locked mark ▸ locked",
            "Voice rows ▸ Play mark ▸ unlocked",
            "Voice rows ▸ Locked mark ▸ locked",
        ]);
        // Two tiles' picture, name, locked backdrop and hit area; two rows' name, play mark and lock.
        expect(bound).toBe(14);
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

    it.each(SEGMENTS.filter(segment => segment.wraps))(
        "gives an unlocked $button tile a pointer and a hover frame, and a locked one neither",
        ({ list }) => {
            // Both tiles answer an unlocked press - a CG opens, a recollection plays - and nothing
            // else. The cue lives on a hit area drawn over the whole tile (last child, so over the
            // art and the name plate) and only for an unlocked row, so a locked tile shows no
            // pointer and no hover state: it promises nothing because it does nothing.
            const grid = on(list, "nl.list");
            const tile = document.elements[grid.childrenIds?.[0] ?? ""]!;
            const children = (tile.childrenIds ?? []).map(id => document.elements[id]!);
            const hit = children.at(-1)!;
            expect(hit.name).toBe("Hit area");
            // A button because it is the one widget that owns a pointer; its label stays empty.
            expect(hit.type).toBe("nl.button");
            expect(hit.props?.label).toBe("");
            expect(hit.props?.cursor).toBe("pointer");
            expect(hit.valueBindings?.["layout.visible"]).toEqual({ kind: "listItemField", fieldId: "unlocked" });
            const box = tile.layout as { width: number; height: number };
            expect(hit.layout).toMatchObject({ x: 0, y: 0, width: box.width, height: box.height });

            // At rest it paints nothing, so an unlocked tile that is not hovered is the tile it was.
            expect(hit.props?.fillVisible).toBe(false);
            expect(hit.props?.borderColor).toBe("transparent");
            // Hovered, it takes the look the screen's other pressable things take: a brand wash and
            // the strong border.
            const appearance = hit.props?.appearance as {
                variants: { id: string; propertyGroups: { key: string; rows: { conditions: unknown; value: unknown }[] }[] }[];
            };
            const groups = appearance.variants.find(variant => variant.id === "default")?.propertyGroups ?? [];
            const hovered = (key: string): unknown =>
                groups.find(group => group.key === key)?.rows
                    .find(row => (row.conditions as { hovered?: boolean } | null)?.hovered === true)?.value;
            expect(hovered("borderColor")).toBe("nlbrand:border.strong");
            expect(hovered("backgroundColor")).toBe("nlbrand:primary");
            expect(hovered("fillVisible")).toBe(true);

            // And nothing else in the grid offers a pointer, so the cue cannot leak onto a locked row.
            for (const element of descendants(grid.id)) {
                if (element.id !== hit.id) {
                    expect((element.props ?? {}).cursor, `${element.name} offers a pointer`).toBeUndefined();
                }
            }
        },
    );

    describe("the CG viewer", () => {
        /**
         * The pieces every claim below is about. Looked up per test rather than once for the block,
         * so a screen that lost one of them fails the claims that need it instead of the whole file.
         */
        const parts = () => {
            const grid = on("CG grid", "nl.list");
            const page = blueprints.find(candidate =>
                candidate.owner.kind === "surfaceMain" && candidate.owner.surfaceId === EXTRA.id);
            expect(page, "the Extra page has no blueprint").toBeDefined();
            return {
                viewer: on("Viewer", "nl.container"),
                picture: on("Picture", "nl.list"),
                open: graphWith(grid.id, BLUEPRINT_NODE_TYPE_EVENT_HEAD_ITEM_CLICK),
                page: page!,
                queue: Object.values(page!.members?.variables ?? {})
                    .find(variable => variable.name === "Viewer pictures"),
            };
        };

        /** A `Set Var` or `Get Var` naming the page's queue, from whichever blueprint it sits in. */
        const namesQueue = (node: GraphNode): boolean => {
            const { page, queue } = parts();
            const ref = String(node.params?.variableId ?? "");
            return Boolean(queue) && (ref === queue!.id || ref === `bp:${page.id}:${queue!.id}`);
        };

        /** What an element write does, as `[element, property, value]`. */
        const writes = (graph: Graph, nodes: GraphNode[]): unknown[][] =>
            nodes.map(node => [elementAt(graph, node.id), node.params?.property, node.params?.value]);

        it("is one full-screen picture above the whole screen, hidden until a tile is pressed", () => {
            const { viewer, picture } = parts();
            // Outside every list and drawn last, so it covers the rail, the board and the title, and
            // a press anywhere lands on it.
            const screen = on("Extra", "nl.container");
            expect(screen.childrenIds?.at(-1)).toBe(viewer.id);
            expect(viewer.layout).toMatchObject({ x: 0, y: 0, width: 1920, height: 1080, visible: false });
            expect(viewer.childrenIds).toEqual([picture.id]);
            expect(String(viewer.props?.backgroundColor)).toMatch(/^nlbrand:/);

            // The picture is a row, drawn the way a tile draws its art: a list holding the one row
            // on screen, whose image reads that row's `image` field. Not an image widget the graph
            // writes an asset into - an asset pin fed a computed value is a hole in the reference
            // index, so every project made from this template would ask before deleting any image
            // and have every build refused (`refuseOnTrimCoverageGaps` in `BuildService`; the
            // template is held to no holes by `referenceCatalogPins.test.ts`).
            expect(picture.layout).toMatchObject({ x: 0, y: 0, width: 1920, height: 1080 });
            expect(picture.props?.itemStructId).toBe("extra.galleryPicture");
            expect((picture.props?.scrollbar as { enabled?: boolean } | undefined)?.enabled).toBe(false);
            expect(picture.props?.dragContentScroll).toBe(false);
            const fields = document.structs?.["extra.galleryPicture"]?.fields.map(field => [field.key, field.type]);
            expect(fields).toEqual([["id", "string"], ["image", "image"]]);

            const art = document.elements[picture.childrenIds?.[0] ?? ""]!;
            expect(picture.childrenIds).toHaveLength(1);
            expect(art.type).toBe("nl.image");
            expect(art.valueBindings?.["imageFill.assetId"]).toEqual({ kind: "listItemField", fieldId: "image" });
            // The whole stage, fitted rather than cropped: a CG that is not 16:9 is letterboxed.
            expect(art.layout).toMatchObject({ x: 0, y: 0, width: 1920, height: 1080 });
            expect((art.props?.imageFill as { mode?: string } | undefined)?.mode).toBe("contain");
        });

        it("opens on the pressed tile's own picture, straight from the Item Click, and not at all when locked", () => {
            const { viewer, picture, open } = parts();
            const head = only(open, BLUEPRINT_NODE_TYPE_EVENT_HEAD_ITEM_CLICK);
            const gate = only(open, BLUEPRINT_NODE_TYPE_FLOW_IF);
            expect(wired(open, head.id, "then", gate.id, "in")).toBe(true);
            const condition = feeding(open, gate.id, "condition");
            expect(condition.type).toBe(BLUEPRINT_NODE_TYPE_LIST_GET_ITEM_FIELD);
            expect(condition.params?.field).toBe("unlocked");

            // A locked tile is inert: nothing at all runs on that side of the gate.
            expect(open.edges.some(edge => edge.from.nodeId === gate.id && edge.from.port === "false")).toBe(false);

            // Unlocked: the press queues the pressed artwork's pictures, read off the row - its `id`,
            // and the variant it is showing, `coverVariantId`, which the queue starts at - and then
            // shows the viewer. Both writes leave the row: one to the page, one to an element the
            // row does not contain, addressed directly. No broadcast and no relay.
            const fill = ranAfter(open, gate.id, "true", BLUEPRINT_NODE_TYPE_LOCAL_SET).filter(namesQueue);
            expect(fill).toHaveLength(1);
            expect(feeding(open, only(open, `${GALLERY}.getVariants`).id, "artworkId").params?.field).toBe("id");
            expect(feeding(open, only(open, BLUEPRINT_NODE_TYPE_COLLECTION_ARRAY_FIND).id, "value").params?.field)
                .toBe("coverVariantId");
            const reveal = ranAfter(open, fill[0]!.id, "next", BLUEPRINT_NODE_TYPE_ELEMENT_DISPLAYABLE_SET_PROPERTY);
            expect(writes(open, reveal)).toEqual([[viewer.id, "visible", true]]);
            expect(Object.values(open.nodes).filter(node => node.type.startsWith("blueprint.broadcast"))).toEqual([]);

            // The picture fills itself as it appears, with the head of the queue - the way every
            // pane on this screen fills itself on Init. The press cannot hand the hidden viewer its
            // row instead: a list drops its content when it unmounts, and in Dev Mode React unmounts
            // it once on the way in, so content given to a list before it is drawn is gone by the
            // time it is.
            const own = graphWith(picture.id, BLUEPRINT_NODE_TYPE_EVENT_HEAD_INIT);
            const init = only(own, BLUEPRINT_NODE_TYPE_EVENT_HEAD_INIT);
            const [set] = ranAfter(own, init.id, "then", BLUEPRINT_NODE_TYPE_ELEMENT_LIST_SET_ITEMS);
            expect(set, "the viewer's picture never fills itself").toBeDefined();
            expect(elementAt(own, set!.id, "list")).toBe(picture.id);
            const first = feeding(own, set!.id, "items");
            expect(first.type).toBe(BLUEPRINT_NODE_TYPE_COLLECTION_ARRAY_SLICE);
            expect([first.params?.start, first.params?.end]).toEqual([0, 1]);
            expect(namesQueue(feeding(own, first.id, "array"))).toBe(true);
        });

        it("steps through the artwork's unlocked pictures, from the one on the tile, and closes after the last", () => {
            const { viewer, picture, open, queue } = parts();
            // The pictures still to show belong to the page, so the grid that opens the viewer and
            // the viewer that steps through it read and write the same list.
            expect(queue, "the Extra page declares the viewer's queue").toBeDefined();
            expect(queue!.valueType).toBe("array");

            const gate = only(open, BLUEPRINT_NODE_TYPE_FLOW_IF);
            const pictures = only(open, `${GALLERY}.getVariants`);
            expect(runsAfter(open, gate.id, "true").has(pictures.id)).toBe(true);
            // Only what the player has unlocked, of the artwork whose tile was pressed.
            expect(pictures.params?.onlyUnlocked).toBe(true);
            // Turned to start at the variant the tile shows, so the head of the queue is the picture
            // that was pressed and every unlocked one comes up once: the pictures from it to the end,
            // then the ones before it.
            const start = only(open, BLUEPRINT_NODE_TYPE_COLLECTION_ARRAY_FIND);
            expect(start.params?.key).toBe("id");
            const [keep] = ranAfter(open, gate.id, "true", BLUEPRINT_NODE_TYPE_LOCAL_SET).filter(namesQueue);
            const order = feeding(open, keep!.id, "value");
            expect(order.type).toBe("blueprint.collection.arrayConcat");
            const after = feeding(open, order.id, "a");
            const before = feeding(open, order.id, "b");
            expect([after.type, before.type]).toEqual([
                BLUEPRINT_NODE_TYPE_COLLECTION_ARRAY_SLICE,
                BLUEPRINT_NODE_TYPE_COLLECTION_ARRAY_SLICE,
            ]);
            expect(open.edges.some(edge => edge.to.nodeId === after.id && edge.to.port === "start")).toBe(true);
            expect(open.edges.some(edge => edge.to.nodeId === before.id && edge.to.port === "end")).toBe(true);
            expect(before.params?.start).toBe(0);

            // Each press drops the picture on screen from the queue; an empty queue closes the
            // viewer, and anything else hands the viewer the new head.
            const step = graphWith(viewer.id, BLUEPRINT_NODE_TYPE_EVENT_HEAD_MOUSE_CLICK);
            const click = only(step, BLUEPRINT_NODE_TYPE_EVENT_HEAD_MOUSE_CLICK);
            const drop = only(step, BLUEPRINT_NODE_TYPE_LOCAL_SET);
            expect(namesQueue(drop)).toBe(true);
            expect(wired(step, click.id, "then", drop.id, "in")).toBe(true);
            const rest = feeding(step, drop.id, "value");
            expect(rest.type).toBe(BLUEPRINT_NODE_TYPE_COLLECTION_ARRAY_REMOVE_AT);
            expect(rest.params?.index).toBe(0);
            expect(namesQueue(feeding(step, rest.id, "array"))).toBe(true);

            const branch = only(step, BLUEPRINT_NODE_TYPE_FLOW_IF);
            expect(wired(step, drop.id, "next", branch.id, "in")).toBe(true);
            const empty = feeding(step, branch.id, "condition");
            expect(empty.type).toBe(BLUEPRINT_NODE_TYPE_COLLECTION_ARRAY_IS_EMPTY);
            expect(namesQueue(feeding(step, empty.id, "array"))).toBe(true);

            const closes = ranAfter(step, branch.id, "true", BLUEPRINT_NODE_TYPE_ELEMENT_DISPLAYABLE_SET_PROPERTY);
            expect(writes(step, closes)).toEqual([[viewer.id, "visible", false]]);
            expect(ranAfter(step, branch.id, "false", BLUEPRINT_NODE_TYPE_ELEMENT_DISPLAYABLE_SET_PROPERTY)).toEqual([]);
            const [next] = ranAfter(step, branch.id, "false", BLUEPRINT_NODE_TYPE_ELEMENT_LIST_SET_ITEMS);
            expect(next, "a press with pictures left does not put the next one up").toBeDefined();
            expect(elementAt(step, next!.id, "list")).toBe(picture.id);
            // The next picture is the head of what is left, and only the head.
            const head = feeding(step, next!.id, "items");
            expect(head.type).toBe(BLUEPRINT_NODE_TYPE_COLLECTION_ARRAY_SLICE);
            expect([head.params?.start, head.params?.end]).toEqual([0, 1]);
            expect(namesQueue(feeding(step, head.id, "array"))).toBe(true);
        });

        it("closes on a right click and on the page's dismiss action, and only leaves the screen when it is shut", () => {
            const { viewer, page } = parts();
            // A right click on the picture closes it at once, emptying the queue as it goes so the
            // page never takes a closed viewer for an open one.
            const cancel = graphWith(viewer.id, BLUEPRINT_NODE_TYPE_EVENT_HEAD_RIGHT_CLICK);
            const right = only(cancel, BLUEPRINT_NODE_TYPE_EVENT_HEAD_RIGHT_CLICK);
            expect(ranAfter(cancel, right.id, "then", BLUEPRINT_NODE_TYPE_LOCAL_SET).filter(namesQueue)).toHaveLength(1);
            expect(writes(cancel, ranAfter(cancel, right.id, "then", BLUEPRINT_NODE_TYPE_ELEMENT_DISPLAYABLE_SET_PROPERTY)))
                .toEqual([[viewer.id, "visible", false]]);

            // Escape is the page's dismiss action. With the viewer open it closes the viewer and the
            // page stays; with nothing open it leaves the screen, as it always did.
            //
            // The page asks its queue, not the viewer's visibility, and that is load-bearing: a key
            // press is dispatched through the host GameApp keeps for the active page, which is not
            // the host the page's own widget graphs write through, and it does not see their writes.
            // Asked whether the viewer is visible it answers "no", and Escape leaves the screen from
            // under an open picture. Page variables live in one store that every host reads.
            const dismiss = Object.values(page.graphs.events).map(entry => entry.graph).find(graph =>
                Object.values(graph.nodes).some(node =>
                    node.type === BLUEPRINT_NODE_TYPE_EVENT_HEAD_ACTION && node.params?.actionId === "dismiss"));
            expect(dismiss, "the Extra page does not answer dismiss").toBeDefined();
            const head = only(dismiss!, BLUEPRINT_NODE_TYPE_EVENT_HEAD_ACTION);
            const branch = only(dismiss!, BLUEPRINT_NODE_TYPE_FLOW_IF);
            expect(wired(dismiss!, head.id, "then", branch.id, "in")).toBe(true);
            const shut = feeding(dismiss!, branch.id, "condition");
            expect(shut.type).toBe(BLUEPRINT_NODE_TYPE_COLLECTION_ARRAY_IS_EMPTY);
            expect(namesQueue(feeding(dismiss!, shut.id, "array"))).toBe(true);

            expect(ranAfter(dismiss!, branch.id, "true", BLUEPRINT_NODE_TYPE_PAGE_BACK)).toHaveLength(1);
            expect(ranAfter(dismiss!, branch.id, "false", BLUEPRINT_NODE_TYPE_PAGE_BACK)).toEqual([]);
            expect(ranAfter(dismiss!, branch.id, "false", BLUEPRINT_NODE_TYPE_LOCAL_SET).filter(namesQueue)).toHaveLength(1);
            expect(writes(dismiss!, ranAfter(dismiss!, branch.id, "false", BLUEPRINT_NODE_TYPE_ELEMENT_DISPLAYABLE_SET_PROPERTY)))
                .toEqual([[viewer.id, "visible", false]]);
        });
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
