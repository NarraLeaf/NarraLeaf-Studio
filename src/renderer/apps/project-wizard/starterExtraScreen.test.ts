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
 *    row's picture into the viewer's image with `Set Image Asset`, which artwork it is and where
 *    that picture sits among the artwork's variants into page variables, and then the viewer - an
 *    element the row does not contain - shown. No broadcast, no relay, no list standing in for an
 *    image. That is only possible because a row addresses the drawing its target is really in
 *    (`resolveUIWidgetAddressFromDrawing` in `@shared/types/ui-editor/widgetDrawing`), and because a
 *    picture taken off a gallery row counts as a name the author wrote down (`assetNameGaps`), so
 *    the reference index follows it instead of refusing every build. From there it is the GalGame
 *    convention: each press steps along the variants from the one on screen, skipping a locked one
 *    and wrapping at the end, with `Get Gallery Variant At` handing over each picture, and the press
 *    that comes back to the first picture closes the viewer - as does a right click or the page's
 *    dismiss action, and the board under it is never touched. `starterCgViewerPlays.test.ts` runs
 *    that walk. The pointer and the hover frame live on a hit area drawn only for an unlocked row, so
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
    BLUEPRINT_NODE_TYPE_DATA_TO_INTEGER,
    BLUEPRINT_NODE_TYPE_ELEMENT_DISPLAYABLE_GET_PROPERTY,
    BLUEPRINT_NODE_TYPE_ELEMENT_DISPLAYABLE_SET_PROPERTY,
    BLUEPRINT_NODE_TYPE_ELEMENT_IMAGE_SET_ASSET,
    BLUEPRINT_NODE_TYPE_ELEMENT_LIST_SET_ITEMS,
    BLUEPRINT_NODE_TYPE_ELEMENT_REF,
    BLUEPRINT_NODE_TYPE_EVENT_HEAD_ACTION,
    BLUEPRINT_NODE_TYPE_EVENT_HEAD_INIT,
    BLUEPRINT_NODE_TYPE_EVENT_HEAD_ITEM_CLICK,
    BLUEPRINT_NODE_TYPE_EVENT_HEAD_MOUSE_CLICK,
    BLUEPRINT_NODE_TYPE_EVENT_HEAD_RIGHT_CLICK,
    BLUEPRINT_NODE_TYPE_FLOW_FOR_LOOP,
    BLUEPRINT_NODE_TYPE_FLOW_IF,
    BLUEPRINT_NODE_TYPE_GAME_START_STORY,
    BLUEPRINT_NODE_TYPE_LIST_GET_ITEM_FIELD,
    BLUEPRINT_NODE_TYPE_LOCAL_SET,
    BLUEPRINT_NODE_TYPE_MATH_EQUAL,
    BLUEPRINT_NODE_TYPE_MATH_INCREMENT,
    BLUEPRINT_NODE_TYPE_MATH_MODULO,
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
const GET_VARIANTS = `${GALLERY}.getVariants`;
const GET_VARIANT_AT = `${GALLERY}.getVariant`;

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
        /** The page variables the viewer keeps, by the name the member tree shows. */
        const VARIABLES = {
            artwork: "Viewer artwork",
            count: "Viewer variant count",
            first: "Viewer first variant",
            shown: "Viewer variant",
        } as const;

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
                open: graphWith(grid.id, BLUEPRINT_NODE_TYPE_EVENT_HEAD_ITEM_CLICK),
                page: page!,
            };
        };

        /** A page variable by the name it is declared under. */
        const variable = (key: keyof typeof VARIABLES) => {
            const { page } = parts();
            const found = Object.values(page.members?.variables ?? {}).find(item => item.name === VARIABLES[key]);
            expect(found, `the Extra page declares no "${VARIABLES[key]}"`).toBeDefined();
            return found!;
        };

        /** Whether a `Set Var` or `Get Var` names one of the page's variables, from whichever blueprint it sits in. */
        const names = (node: GraphNode | undefined, key: keyof typeof VARIABLES): boolean => {
            const { page } = parts();
            const id = variable(key).id;
            const ref = String(node?.params?.variableId ?? "");
            return ref === id || ref === `bp:${page.id}:${id}`;
        };

        /** What an element write does, as `[element, property, value]`. */
        const writes = (graph: Graph, nodes: GraphNode[]): unknown[][] =>
            nodes.map(node => [elementAt(graph, node.id), node.params?.property, node.params?.value]);

        /** The one node an execution output runs next. */
        const after = (graph: Graph, nodeId: string, port: string): GraphNode => {
            const out = graph.edges.filter(edge => edge.from.nodeId === nodeId && edge.from.port === port);
            expect(out, `${nodeId}.${port} leads to ${out.length} nodes`).toHaveLength(1);
            return graph.nodes[out[0]!.to.nodeId]!;
        };

        it("is one full-screen picture above the whole screen, hidden until a tile is pressed", () => {
            const { viewer } = parts();
            // Outside every list and drawn last, so it covers the rail, the board and the title, and
            // a press anywhere lands on it.
            const screen = on("Extra", "nl.container");
            expect(screen.childrenIds?.at(-1)).toBe(viewer.id);
            expect(viewer.layout).toMatchObject({ x: 0, y: 0, width: 1920, height: 1080, visible: false });
            expect(String(viewer.props?.backgroundColor)).toMatch(/^nlbrand:/);

            // One image and nothing else: the viewer holds one picture at a time, and the graphs put
            // each one there with `Set Image Asset`. Nothing is bound - no list stands in for it.
            expect(viewer.childrenIds).toHaveLength(1);
            const art = document.elements[viewer.childrenIds![0]!]!;
            expect(art.type).toBe("nl.image");
            expect(art.valueBindings ?? {}).toEqual({});
            // The whole stage, fitted rather than cropped: a CG that is not 16:9 is letterboxed.
            expect(art.layout).toMatchObject({ x: 0, y: 0, width: 1920, height: 1080 });
            expect((art.props?.imageFill as { mode?: string } | undefined)?.mode).toBe("contain");
        });

        it("leaves no list-item shape behind that nothing uses", () => {
            // A shape no list names is invisible to an author, and is picked up again under its old
            // name the next time someone declares the same fields (`findCompatibleUIStructId`).
            const named = new Set<string>();
            const components = (document as { components?: { elements: Record<string, Element> }[] }).components ?? [];
            for (const pool of [document.elements, ...components.map(component => component.elements)]) {
                for (const element of Object.values(pool)) {
                    const id = element.props?.itemStructId;
                    if (typeof id === "string") {
                        named.add(id);
                    }
                }
            }
            expect(Object.keys(document.structs ?? {}).filter(id => !named.has(id))).toEqual([]);
        });

        it("opens on the pressed tile's own picture, straight from the Item Click, and not at all when locked", () => {
            const { viewer, open } = parts();
            const art = viewer.childrenIds![0]!;
            const head = only(open, BLUEPRINT_NODE_TYPE_EVENT_HEAD_ITEM_CLICK);
            const gate = only(open, BLUEPRINT_NODE_TYPE_FLOW_IF);
            expect(wired(open, head.id, "then", gate.id, "in")).toBe(true);
            const condition = feeding(open, gate.id, "condition");
            expect(condition.type).toBe(BLUEPRINT_NODE_TYPE_LIST_GET_ITEM_FIELD);
            expect(condition.params?.field).toBe("unlocked");

            // A locked tile is inert: nothing at all runs on that side of the gate.
            expect(open.edges.some(edge => edge.from.nodeId === gate.id && edge.from.port === "false")).toBe(false);

            // Unlocked: the row's own picture - the variant the tile shows - goes into the viewer's
            // image, and then the viewer is shown. Both writes leave the row, to elements it does not
            // contain, addressed directly. No broadcast and no relay.
            const [show] = ranAfter(open, gate.id, "true", BLUEPRINT_NODE_TYPE_ELEMENT_IMAGE_SET_ASSET);
            expect(show, "the press never puts a picture up").toBeDefined();
            expect(elementAt(open, show!.id)).toBe(art);
            const picture = feeding(open, show!.id, "asset");
            expect(picture.type).toBe(BLUEPRINT_NODE_TYPE_LIST_GET_ITEM_FIELD);
            expect(picture.params?.field).toBe("image");
            expect(writes(open, ranAfter(open, gate.id, "true", BLUEPRINT_NODE_TYPE_ELEMENT_DISPLAYABLE_SET_PROPERTY)))
                .toEqual([[viewer.id, "visible", true]]);
            // The picture is in place before the viewer fades in, so the last one never shows.
            expect(ranAfter(open, show!.id, "next", BLUEPRINT_NODE_TYPE_ELEMENT_DISPLAYABLE_SET_PROPERTY)).toHaveLength(1);
            expect(Object.values(open.nodes).filter(node => node.type.startsWith("blueprint.broadcast"))).toEqual([]);
        });

        it("remembers which artwork is open, how many variants it has and where the pressed picture sits", () => {
            const { open } = parts();
            const gate = only(open, BLUEPRINT_NODE_TYPE_FLOW_IF);
            // Positions are counted over every variant, locked ones included, because that is what
            // `Get Gallery Variant At` indexes - so the list asked for here is the whole artwork.
            const variants = only(open, GET_VARIANTS);
            expect(runsAfter(open, gate.id, "true").has(variants.id)).toBe(true);
            expect(feeding(open, variants.id, "artworkId").params?.field).toBe("id");
            expect(variants.params?.onlyUnlocked).not.toBe(true);
            expect(open.edges.some(edge => edge.to.nodeId === variants.id && edge.to.port === "onlyUnlocked")).toBe(false);

            const sets = ranAfter(open, gate.id, "true", BLUEPRINT_NODE_TYPE_LOCAL_SET);
            const setting = (key: keyof typeof VARIABLES): GraphNode => {
                const found = sets.filter(node => names(node, key));
                expect(found, `the press sets "${VARIABLES[key]}" ${found.length} times`).toHaveLength(1);
                return found[0]!;
            };
            const artwork = feeding(open, setting("artwork").id, "value");
            expect([artwork.type, artwork.params?.field]).toEqual([BLUEPRINT_NODE_TYPE_LIST_GET_ITEM_FIELD, "id"]);
            expect(wired(open, variants.id, "count", setting("count").id, "value")).toBe(true);

            // The first picture's position: the row's `coverVariantId` - the variant the tile shows -
            // found among the artwork's variants by id.
            const found = feeding(open, setting("first").id, "value");
            expect(found.type).toBe(BLUEPRINT_NODE_TYPE_COLLECTION_ARRAY_FIND);
            expect(found.params?.key).toBe("id");
            expect(wired(open, variants.id, "entries", found.id, "array")).toBe(true);
            expect(feeding(open, found.id, "value").params?.field).toBe("coverVariantId");
            // And the picture on screen starts as that one.
            expect(names(feeding(open, setting("shown").id, "value"), "first")).toBe(true);

            // All of it is in place before the viewer can be pressed.
            const [reveal] = ranAfter(open, gate.id, "true", BLUEPRINT_NODE_TYPE_ELEMENT_DISPLAYABLE_SET_PROPERTY);
            for (const key of Object.keys(VARIABLES) as (keyof typeof VARIABLES)[]) {
                expect(runsAfter(open, setting(key).id, "next").has(reveal!.id)).toBe(true);
            }
            expect(variable("artwork").valueType).toBe("string");
            for (const key of ["count", "first", "shown"] as const) {
                expect(variable(key).valueType).toBe("integer");
            }
        });

        it("steps past locked variants and round the end, and closes on coming back to the first", () => {
            const { viewer } = parts();
            const art = viewer.childrenIds![0]!;
            const step = graphWith(viewer.id, BLUEPRINT_NODE_TYPE_EVENT_HEAD_MOUSE_CLICK);
            const click = only(step, BLUEPRINT_NODE_TYPE_EVENT_HEAD_MOUSE_CLICK);

            // A walk of at most as many steps as the artwork has variants, so it cannot run away
            // whatever the catalog says.
            const walk = only(step, BLUEPRINT_NODE_TYPE_FLOW_FOR_LOOP);
            expect(wired(step, click.id, "then", walk.id, "in")).toBe(true);
            expect(walk.params?.start).toBe(1);
            expect(names(feeding(step, walk.id, "end"), "count")).toBe(true);

            // Each pass moves one along and wraps at the end: (shown + 1) mod count, as a whole number.
            const advance = after(step, walk.id, "loop");
            expect(advance.type).toBe(BLUEPRINT_NODE_TYPE_LOCAL_SET);
            expect(names(advance, "shown")).toBe(true);
            const whole = feeding(step, advance.id, "value");
            expect(whole.type).toBe(BLUEPRINT_NODE_TYPE_DATA_TO_INTEGER);
            const wrap = feeding(step, whole.id, "value");
            expect(wrap.type).toBe(BLUEPRINT_NODE_TYPE_MATH_MODULO);
            const next = feeding(step, wrap.id, "a");
            expect(next.type).toBe(BLUEPRINT_NODE_TYPE_MATH_INCREMENT);
            expect(names(feeding(step, next.id, "value"), "shown")).toBe(true);
            expect(names(feeding(step, wrap.id, "b"), "count")).toBe(true);

            // Back at the picture it opened on: every unlocked one has been shown once, so it closes.
            const home = after(step, advance.id, "next");
            expect(home.type).toBe(BLUEPRINT_NODE_TYPE_FLOW_IF);
            const same = feeding(step, home.id, "condition");
            expect(same.type).toBe(BLUEPRINT_NODE_TYPE_MATH_EQUAL);
            const compared = [feeding(step, same.id, "a"), feeding(step, same.id, "b")];
            expect(compared.some(node => names(node, "shown")) && compared.some(node => names(node, "first"))).toBe(true);
            expect(writes(step, ranAfter(step, home.id, "true", BLUEPRINT_NODE_TYPE_ELEMENT_DISPLAYABLE_SET_PROPERTY)))
                .toEqual([[viewer.id, "visible", false]]);
            expect(ranAfter(step, home.id, "true", GET_VARIANT_AT)).toEqual([]);

            // Anywhere else: the artwork's variant at that position, shown if the player has found it.
            const look = after(step, home.id, "false");
            expect(look.type).toBe(GET_VARIANT_AT);
            expect(names(feeding(step, look.id, "artworkId"), "artwork")).toBe(true);
            expect(names(feeding(step, look.id, "index"), "shown")).toBe(true);
            const found = after(step, look.id, "next");
            expect(found.type).toBe(BLUEPRINT_NODE_TYPE_FLOW_IF);
            expect(wired(step, look.id, "unlocked", found.id, "condition")).toBe(true);

            const shown = after(step, found.id, "true");
            expect(shown.type).toBe(BLUEPRINT_NODE_TYPE_ELEMENT_IMAGE_SET_ASSET);
            expect(elementAt(step, shown.id)).toBe(art);
            expect(wired(step, look.id, "image", shown.id, "asset")).toBe(true);
            // Showing a picture ends the press: the walk does not go on, and nothing closes.
            expect([...runsAfter(step, found.id, "true")]).toEqual([shown.id]);

            // A locked one is stepped over: back round the walk for the next position.
            expect(after(step, found.id, "false").id).toBe(walk.id);
            // A walk that runs out without coming home - a catalog changed under it - closes too.
            expect(writes(step, [after(step, walk.id, "completed")])).toEqual([[viewer.id, "visible", false]]);
        });

        it("closes on a right click and on the page's dismiss action, and only leaves the screen when it is shut", () => {
            const { viewer, page } = parts();
            // A right click on the picture closes it at once. There is nothing to reset: a press on
            // a tile sets every page variable the viewer reads before it opens.
            const cancel = graphWith(viewer.id, BLUEPRINT_NODE_TYPE_EVENT_HEAD_RIGHT_CLICK);
            const right = only(cancel, BLUEPRINT_NODE_TYPE_EVENT_HEAD_RIGHT_CLICK);
            expect(writes(cancel, ranAfter(cancel, right.id, "then", BLUEPRINT_NODE_TYPE_ELEMENT_DISPLAYABLE_SET_PROPERTY)))
                .toEqual([[viewer.id, "visible", false]]);

            // Escape is the page's dismiss action. With the viewer open it closes the viewer and the
            // page stays; with nothing open it leaves the screen, as it always did.
            //
            // The page asks the viewer itself whether it is showing. A key press runs on the same
            // host the page's own graphs write through (`hostAdapterBundleFor` in the game runtime),
            // so it reads the visibility the tile's press wrote.
            const dismiss = Object.values(page.graphs.events).map(entry => entry.graph).find(graph =>
                Object.values(graph.nodes).some(node =>
                    node.type === BLUEPRINT_NODE_TYPE_EVENT_HEAD_ACTION && node.params?.actionId === "dismiss"));
            expect(dismiss, "the Extra page does not answer dismiss").toBeDefined();
            const head = only(dismiss!, BLUEPRINT_NODE_TYPE_EVENT_HEAD_ACTION);
            const branch = only(dismiss!, BLUEPRINT_NODE_TYPE_FLOW_IF);
            expect(wired(dismiss!, head.id, "then", branch.id, "in")).toBe(true);
            const showing = feeding(dismiss!, branch.id, "condition");
            expect(showing.type).toBe(BLUEPRINT_NODE_TYPE_ELEMENT_DISPLAYABLE_GET_PROPERTY);
            expect(showing.params?.property).toBe("visible");
            expect(elementAt(dismiss!, showing.id)).toBe(viewer.id);

            expect(writes(dismiss!, ranAfter(dismiss!, branch.id, "true", BLUEPRINT_NODE_TYPE_ELEMENT_DISPLAYABLE_SET_PROPERTY)))
                .toEqual([[viewer.id, "visible", false]]);
            expect(ranAfter(dismiss!, branch.id, "true", BLUEPRINT_NODE_TYPE_PAGE_BACK)).toEqual([]);
            expect(ranAfter(dismiss!, branch.id, "false", BLUEPRINT_NODE_TYPE_PAGE_BACK)).toHaveLength(1);
            expect(ranAfter(dismiss!, branch.id, "false", BLUEPRINT_NODE_TYPE_ELEMENT_DISPLAYABLE_SET_PROPERTY)).toEqual([]);
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
