/**
 * The sounds the starter template makes when a player works its menus.
 *
 * Three clips ship with the template and for a long time nothing played any of them, which is the
 * failure mode a per-page assertion cannot catch: a screen with no sound reads, on its own, like a
 * screen whose author had not got to it yet. So this sweeps every sound from one list and fails on
 * the count as well as the wiring.
 *
 * Two shapes, and which one a press gets is the point. A sound that answers every press of an
 * element is that element's own - its Sound section in the inspector - because that is where an
 * author looks for it and where a copied button carries it. A sound that depends on something (a
 * locked card that opens nothing, a dialog whose first answer acts and whose others back out) stays
 * in the blueprint, behind the gate that decides it, because a property cannot say "only if".
 *
 * Everything comes from the real template and the real asset metadata, so renaming a clip or
 * deleting one breaks this rather than leaving the template pointing at something that is no longer
 * there.
 */
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
    BLUEPRINT_NODE_TYPE_DATA_MEMO,
    BLUEPRINT_NODE_TYPE_EVENT_HEAD_ITEM_CLICK,
    BLUEPRINT_NODE_TYPE_EVENT_HEAD_MOUSE_CLICK,
    BLUEPRINT_NODE_TYPE_EVENT_HEAD_MOUSE_ENTER,
    BLUEPRINT_NODE_TYPE_EVENT_HEAD_RIGHT_CLICK,
    BLUEPRINT_NODE_TYPE_FLOW_IF,
    BLUEPRINT_NODE_TYPE_FN_CALL,
    BLUEPRINT_NODE_TYPE_SOUND_PLAY,
} from "@shared/types/blueprint/graph";
import { AUDIO_TRACK_ID_SOUND } from "@shared/types/audioTrack";
import { readUIInteractionSoundAssetId, type UIInteractionSoundKind } from "@shared/types/ui-editor/interactionSounds";

type GraphNode = { id: string; type: string; params?: Record<string, unknown> };
type GraphEdge = { from: { nodeId: string; port: string }; to: { nodeId: string; port: string } };
type Graph = { nodes: Record<string, GraphNode>; edges: GraphEdge[] };
type Blueprint = {
    id: string;
    owner: { kind: string; surfaceId?: string; elementId?: string };
    graphs: { events: Record<string, { graph: Graph }> };
};
type Element = { id: string; name: string; type: string; childrenIds?: string[]; props?: Record<string, unknown> };
type Surface = { id: string; name: string; rootElementId: string };
type Component = { id: string; name: string; elements: Record<string, Element> };
type UIDoc = { surfaces: Surface[]; elements: Record<string, Element>; components: Component[] };
type AudioAsset = { id: string; name: string };

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
const audioAssets = readTemplate("assets", "assets.metadata.audio.json") as Record<string, AudioAsset>;

/** Every element the template authors, on a page or inside a component definition. */
const ALL_ELEMENTS: Element[] = [
    ...Object.values(document.elements),
    ...document.components.flatMap(component => Object.values(component.elements)),
];

function elementById(id: string): Element {
    const found = ALL_ELEMENTS.find(element => element.id === id);
    expect(found, `no element ${id}`).toBeDefined();
    return found!;
}

/** Clip ids resolved by the name an author sees in the asset panel, not pasted in. */
const CLIP = Object.fromEntries(
    Object.values(audioAssets).map(asset => [asset.name, asset.id]),
) as Record<string, string>;

function soundOf(element: Element, kind: UIInteractionSoundKind): string | null {
    return readUIInteractionSoundAssetId(element, kind);
}

/** Elements of one type on a named page, by the name they carry in the layer tree. */
function elementsOn(surfaceName: string, elementName: string, elementType: string): Element[] {
    const surface = document.surfaces.find(candidate => candidate.name === surfaceName);
    expect(surface, `no surface named ${surfaceName}`).toBeDefined();
    const found: Element[] = [];
    const walk = (id: string): void => {
        const element = document.elements[id];
        if (!element) {
            return;
        }
        if (element.name === elementName && element.type === elementType) {
            found.push(element);
        }
        for (const child of element.childrenIds ?? []) {
            walk(child);
        }
    };
    walk(surface!.rootElementId);
    return found;
}

function oneOn(surfaceName: string, elementName: string, elementType = "nl.button"): Element {
    const found = elementsOn(surfaceName, elementName, elementType);
    expect(found, `${surfaceName} has ${found.length} ${elementType} named ${elementName}`).toHaveLength(1);
    return found[0]!;
}

/** Every element under `rootId`, itself included. */
function subtree(rootId: string): Element[] {
    const out: Element[] = [];
    const walk = (id: string): void => {
        const element = document.elements[id];
        if (!element) {
            return;
        }
        out.push(element);
        for (const child of element.childrenIds ?? []) {
            walk(child);
        }
    };
    walk(rootId);
    return out;
}

/** The graphs on the blueprint that answers for an element, holding `headType` when one is named. */
function graphsFor(elementId: string, headType?: string): Graph[] {
    const blueprint = blueprints.find(
        candidate =>
            (candidate.owner.kind === "widgetMain" || candidate.owner.kind === "componentWidgetMain")
            && candidate.owner.elementId === elementId,
    );
    if (!blueprint) {
        return [];
    }
    return Object.values(blueprint.graphs.events)
        .map(event => event.graph)
        .filter(graph => !headType || Object.values(graph.nodes).some(node => node.type === headType));
}

/**
 * The one graph on the blueprint that answers for an element, or - when the blueprint carries more
 * than one layer - the one holding `headType`. Layers are how an author separates two unrelated
 * things a widget answers, so a helper that insisted on a single layer would fail the moment one
 * gained a second, without anything about the wiring under test having changed.
 */
function graphFor(elementId: string, headType?: string): Graph {
    const graphs = graphsFor(elementId, headType);
    expect(graphs, `${elementId} has ${graphs.length} graphs answering ${headType ?? "anything"}`).toHaveLength(1);
    return graphs[0]!;
}

function only(graph: Graph, type: string): GraphNode {
    const found = Object.values(graph.nodes).filter(node => node.type === type);
    expect(found, `expected one ${type}, found ${found.length}`).toHaveLength(1);
    return found[0]!;
}

/**
 * The single node an exec output runs, stepping over a Memo.
 *
 * A Memo does nothing a player can hear; it is there because a value is read twice and a pure pin
 * may only feed one consumer. Stopping at one would make these assertions about where a graph holds
 * its values rather than about which sound answers which press.
 */
function next(graph: Graph, fromId: string, port: string): GraphNode {
    const out = graph.edges.filter(edge => edge.from.nodeId === fromId && edge.from.port === port);
    expect(out, `${fromId}.${port} leads to ${out.length} nodes`).toHaveLength(1);
    const node = graph.nodes[out[0]!.to.nodeId]!;
    return node.type === BLUEPRINT_NODE_TYPE_DATA_MEMO ? next(graph, node.id, "next") : node;
}

/**
 * The cues the project declares, by the reference a call names, each with the clip it plays.
 *
 * Derived from the template rather than listed here: what a cue plays is one fact, and a list beside
 * it would be a second place for that fact to be written down.
 */
const CUE_PLAYS: Map<string, GraphNode> = (() => {
    const out = new Map<string, GraphNode>();
    for (const blueprint of blueprints) {
        for (const event of Object.values(blueprint.graphs.events)) {
            const { nodes, edges } = event.graph;
            for (const head of Object.values(nodes)) {
                if (head.type !== "blueprint.fn.head") {
                    continue;
                }
                const body = edges.find(edge => edge.from.nodeId === head.id && edge.from.port === "then");
                const played = body ? nodes[body.to.nodeId] : undefined;
                if (played?.type === BLUEPRINT_NODE_TYPE_SOUND_PLAY) {
                    out.set(`fn:${blueprint.id}:${head.id}`, played);
                }
            }
        }
    }
    return out;
})();

/** Whether a node is a call to one of those cues, as opposed to any other function the template calls. */
function isCueCall(node: GraphNode): boolean {
    return node.type === BLUEPRINT_NODE_TYPE_FN_CALL && CUE_PLAYS.has(String(node.params?.fnRef ?? ""));
}

function assertCue(cue: GraphNode, clipName: string): void {
    expect(cue.type).toBe(BLUEPRINT_NODE_TYPE_FN_CALL);
    const played = CUE_PLAYS.get(String(cue.params?.fnRef ?? ""));
    expect(played, `${String(cue.params?.fnRef)} is not one of the cues this project declares`).toBeDefined();
    expect(CLIP[clipName], `the template ships no clip named ${clipName}`).toBeDefined();
    expect(played!.params?.soundAssetId).toBe(CLIP[clipName]);
    // The SFX track, so the player's own effects slider and mute reach it. A cue the settings page
    // cannot turn down is the one thing a UI sound must never be.
    expect(played!.params?.audioTrackId).toBe(AUDIO_TRACK_ID_SOUND);
}

/**
 * An element whose own property answers its clicks, with what the click used to run still running.
 *
 * The blueprint's click head must lead straight to the action, not to a cue: a cue there as well is
 * one press sounding twice.
 */
function assertClickSound(
    element: Element,
    clipName: string,
    headType: string = BLUEPRINT_NODE_TYPE_EVENT_HEAD_MOUSE_CLICK,
    graphOwnerId: string = element.id,
): void {
    expect(CLIP[clipName], `the template ships no clip named ${clipName}`).toBeDefined();
    expect(soundOf(element, "click"), `${element.name} click sound`).toBe(CLIP[clipName]);
    const graph = graphFor(graphOwnerId, headType);
    const acted = next(graph, only(graph, headType).id, "then");
    expect(isCueCall(acted), `${element.name} still plays a cue from its blueprint`).toBe(false);
}

function assertHoverSound(element: Element): void {
    expect(soundOf(element, "hover"), `${element.name} hover sound`).toBe(CLIP["ui-hover"]);
    // A hover head left behind would be the sound twice, or a graph with nothing left to do.
    expect(graphsFor(element.id, BLUEPRINT_NODE_TYPE_EVENT_HEAD_MOUSE_ENTER)).toHaveLength(0);
}

/**
 * The rail entries each in-game page authors for itself, and the one the Extra page carries.
 *
 * Title is not among them: it is the one entry that is the same on every rail - never the page you
 * are standing on, so never wearing the active look - and the four pages place one component
 * instead of holding four copies of it. Its sounds are asserted once, below.
 */
const RAIL_ENTRIES = ["Save", "Load", "Config", "Back"];

/** Every button that answers a click, and the clip it uses. Back is the one that means undo. */
const CLICKS: readonly { page: string; button: string; clip: string }[] = [
    ...["Start", "Continue", "Load", "Config", "Quit", "Extra"].map(button => ({
        page: "Title",
        button,
        clip: "ui-confirm",
    })),
    // The Extra page's four segments, which switch its content pane the way Config's two do.
    ...["CG", "Recollection", "Music", "Voice"].map(button => ({
        page: "Extra",
        button,
        clip: "ui-confirm",
    })),
    ...[
        "Save", "Load", "Config", "Text", "Sound", "All text", "Read only", "On", "Off",
        // The sound page's own pair, named apart from the fullscreen pair above because two
        // buttons on one screen cannot both be called On.
        "Mute on", "Mute off",
    ].map(button => ({
        page: "Config",
        button,
        clip: "ui-confirm",
    })),
    // The Config page's other rail entries are in the block above, among its controls.
    { page: "Config", button: "Back", clip: "ui-back" },
    ...["Log", "Save", "Load"].flatMap(page =>
        RAIL_ENTRIES.map(button => ({ page, button, clip: button === "Back" ? "ui-back" : "ui-confirm" })),
    ),
    { page: "Extra", button: "Back", clip: "ui-back" },
];

/** The entries that answer the pointer arriving. Rails only: a settings toggle is not a menu. */
const HOVERS: readonly { page: string; button: string }[] = [
    ...["Start", "Continue", "Load", "Config", "Quit", "Extra"].map(button => ({ page: "Title", button })),
    ...["Config", "Log", "Save", "Load"].flatMap(page => RAIL_ENTRIES.map(button => ({ page, button }))),
    { page: "Extra", button: "Back" },
    // The segment rail is a menu, so it answers the pointer the way the nav rails do.
    ...["CG", "Recollection", "Music", "Voice"].map(button => ({ page: "Extra", button })),
];

/** The rows whose every press is a pick, so their row carries the sound. */
const ROW_CLICKS: readonly { page: string; list: string }[] = [
    { page: "Log", list: "Entries" },
    { page: "Load", list: "Auto saves" },
];

/** The card the save and load pages both place; its Hit area is what answers a press. */
const SAVE_CARD = "387326a1-5514-4ee2-9d73-48fbe03de0b8";

/**
 * The scene card, which the component library still holds and no page places any more: the Scenes
 * page became the Extra screen's Recollection segment, whose rows come out of the gallery. It is
 * asserted here because its cue is still one of the cues the template declares, and because the
 * gate in front of it is the shape a row that may be locked has to keep.
 */
const SCENE_CARD = "03921db3-a8f5-4399-9146-232d076891e1";

/** The Extra screen's recollection grid, whose rows start the scene they point at. */
const RECOLLECTION_GRID = "5107c0a1-0000-4000-8000-000000000320";

/** The Extra screen's CG grid, whose rows open their picture in the screen's viewer. */
const CG_GRID = "5107c0a1-0000-4000-8000-000000000310";

/** The button the four in-game page rails all place to get back to the title. */
const TITLE_BUTTON = "5107c0a1-0000-4000-8000-000000000201";

describe("the sounds the starter template makes", () => {
    it("declares the cues its gated sounds call once, on the track the player can turn down", () => {
        // Two left: what a gated sound plays is still one fact, named in one place. The hover cue
        // went with the last graph that called it - every hover in the template is unconditional.
        expect([...CUE_PLAYS.values()].map(played => played.params?.soundAssetId).sort()).toEqual(
            [CLIP["ui-back"], CLIP["ui-confirm"]].sort(),
        );
        for (const played of CUE_PLAYS.values()) {
            expect(played.params?.audioTrackId).toBe(AUDIO_TRACK_ID_SOUND);
        }
    });

    it("makes them in these places and nowhere else", () => {
        // Counted rather than sampled: the cases below each know which of these they mean, and this
        // is what says nobody added one somewhere outside them.
        const clicks = ALL_ELEMENTS.filter(element => soundOf(element, "click") !== null);
        const hovers = ALL_ELEMENTS.filter(element => soundOf(element, "hover") !== null);
        // The buttons each page authors, the Title button and the save card's hit area, and the
        // rows of the two lists whose every press is a pick.
        expect(clicks).toHaveLength(CLICKS.length + 1 + 1 + ROW_CLICKS.length);
        expect(hovers).toHaveLength(HOVERS.length + 1);

        // The music and voice rows are deliberately not among them: the sound such a row makes is
        // the clip it plays, and two sounds for one press is one too many. Nor is a press inside
        // the CG viewer: stepping to the next picture and closing after the last are paging, not
        // choosing, and a confirm sound on every page turn is noise.
        const cues = blueprints.flatMap(blueprint =>
            Object.values(blueprint.graphs.events).flatMap(event =>
                Object.values(event.graph.nodes).filter(node => isCueCall(node)),
            ),
        );
        // The scene card, the recollection and CG rows, and the confirm dialog's two answers: the
        // sounds that depend on something.
        expect(cues).toHaveLength(5);
    });

    it("plays every clip on a sound that names one the template ships", () => {
        const shipped = new Set(Object.values(CLIP));
        for (const element of ALL_ELEMENTS) {
            for (const kind of ["hover", "click"] as const) {
                const assetId = soundOf(element, kind);
                if (assetId !== null) {
                    expect(shipped.has(assetId), `${element.name} ${kind}`).toBe(true);
                }
            }
        }
    });

    it.each(CLICKS)("$page ▸ $button answers a click with $clip", ({ page, button, clip }) => {
        assertClickSound(oneOn(page, button), clip);
    });

    it.each(HOVERS)("$page ▸ $button answers the pointer arriving", ({ page, button }) => {
        assertHoverSound(oneOn(page, button));
    });

    it("the title button answers wherever a rail places it", () => {
        // One button, placed on all four in-game page rails. The sounds are on its definition, so a
        // rail cannot have a way back to the title that answers and one that does not.
        const button = elementById(TITLE_BUTTON);
        assertClickSound(button, "ui-confirm");
        assertHoverSound(button);
    });

    it("the save card answers being picked, wherever it is placed", () => {
        // One card, placed six times on Save and six times on Load. The sound is on the card, so a
        // page cannot have a slot that answers and a slot that does not.
        assertClickSound(elementById(SAVE_CARD), "ui-confirm");

        // Deleting a slot is a right-click, and it stays silent: a click sound answers clicks
        // alone, and the question a right-click raises answers with a cue of its own.
        const removeGraph = graphFor(SAVE_CARD, BLUEPRINT_NODE_TYPE_EVENT_HEAD_RIGHT_CLICK);
        const remove = only(removeGraph, BLUEPRINT_NODE_TYPE_EVENT_HEAD_RIGHT_CLICK);
        expect(isCueCall(next(removeGraph, remove.id, "then"))).toBe(false);
    });

    it.each(ROW_CLICKS)("a row of $page ▸ $list answers being picked", ({ page, list }) => {
        // On the row rather than on the list: the list's own sound would answer a press on the
        // space between and below its rows too, which picks nothing.
        const listElement = oneOn(page, list, "nl.list");
        expect(soundOf(listElement, "click")).toBeNull();
        expect(listElement.childrenIds).toHaveLength(1);
        assertClickSound(elementById(listElement.childrenIds![0]!), "ui-confirm", BLUEPRINT_NODE_TYPE_EVENT_HEAD_ITEM_CLICK, listElement.id);
    });

    it("a CG tile answers only when the row is unlocked", () => {
        // A locked tile opens nothing, so it must not answer as if it had - which is why this one
        // is a blueprint's, behind the gate, and nothing in the row has a click sound of its own.
        const graph = graphFor(CG_GRID, BLUEPRINT_NODE_TYPE_EVENT_HEAD_ITEM_CLICK);
        const click = only(graph, BLUEPRINT_NODE_TYPE_EVENT_HEAD_ITEM_CLICK);
        const gate = next(graph, click.id, "then");
        expect(gate.type).toBe(BLUEPRINT_NODE_TYPE_FLOW_IF);
        assertCue(next(graph, gate.id, "true"), "ui-confirm");
        expect(subtree(CG_GRID).filter(element => soundOf(element, "click") !== null)).toEqual([]);
    });

    it("a recollection tile answers only when the row is unlocked", () => {
        // The same shape as the scene card below, for the same reason: a locked row's press ends at
        // the gate, and a sound in front of it would answer a press that does nothing.
        const graph = graphFor(RECOLLECTION_GRID, BLUEPRINT_NODE_TYPE_EVENT_HEAD_ITEM_CLICK);
        const click = only(graph, BLUEPRINT_NODE_TYPE_EVENT_HEAD_ITEM_CLICK);
        const gate = next(graph, click.id, "then");
        expect(gate.type).toBe(BLUEPRINT_NODE_TYPE_FLOW_IF);
        assertCue(next(graph, gate.id, "true"), "ui-confirm");
        expect(subtree(RECOLLECTION_GRID).filter(element => soundOf(element, "click") !== null)).toEqual([]);
    });

    it("a scene card answers only when it has a scene to open", () => {
        // One card, placed once per scene. Which scene it opens and what that scene is called are
        // its params, so a page cannot have a card that answers and a card that does not.
        const graph = graphFor(SCENE_CARD, BLUEPRINT_NODE_TYPE_EVENT_HEAD_MOUSE_CLICK);
        const click = only(graph, BLUEPRINT_NODE_TYPE_EVENT_HEAD_MOUSE_CLICK);
        // The cue sits past the visited gate rather than in front of it. A locked card's click
        // ends at that gate, and a sound answering a press that does nothing is the one thing a UI
        // sound must not teach.
        const gate = next(graph, click.id, "then");
        expect(gate.type).toBe(BLUEPRINT_NODE_TYPE_FLOW_IF);
        assertCue(next(graph, gate.id, "true"), "ui-confirm");
        expect(soundOf(elementById(SCENE_CARD), "click")).toBeNull();
    });

    it("the confirm dialog answers in two voices, one per kind of answer", () => {
        const list = oneOn("Confirm", "Buttons", "nl.list");
        const graph = graphFor(list.id);
        const click = only(graph, BLUEPRINT_NODE_TYPE_EVENT_HEAD_ITEM_CLICK);
        const branch = next(graph, click.id, "then");
        expect(branch.type).toBe(BLUEPRINT_NODE_TYPE_FLOW_IF);
        // The first answer is the one that acts; anything after it is a way out.
        assertCue(next(graph, branch.id, "false"), "ui-confirm");
        assertCue(next(graph, branch.id, "true"), "ui-back");
        expect(subtree(list.id).filter(element => soundOf(element, "click") !== null)).toEqual([]);
    });
});
