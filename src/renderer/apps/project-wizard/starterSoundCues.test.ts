/**
 * The sounds the starter template makes when a player works its menus.
 *
 * Three clips ship with the template and for a long time nothing played any of them, which is the
 * failure mode a per-page assertion cannot catch: a screen with no cue reads, on its own, like a
 * screen whose author had not got to it yet. So this sweeps every cue from one list and fails on the
 * count as well as the wiring. The save card and the Title button are asserted once each rather
 * than per placement, because the pages place one component rather than holding copies of it.
 *
 * What each one has to prove is not "a Play Sound exists in this graph" but that it is the first
 * thing the interaction runs - a cue behind a `Go Page` is a cue the player never hears, because the
 * page it belongs to is gone by then - and that whatever the interaction used to run still runs
 * after it.
 *
 * Everything comes from the real catalogue and the real asset metadata, so renaming a node type or
 * deleting a clip breaks this rather than leaving the template pointing at something that is no
 * longer there.
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

type GraphNode = { id: string; type: string; params?: Record<string, unknown> };
type GraphEdge = { from: { nodeId: string; port: string }; to: { nodeId: string; port: string } };
type Graph = { nodes: Record<string, GraphNode>; edges: GraphEdge[] };
type Blueprint = {
    id: string;
    owner: { kind: string; surfaceId?: string; elementId?: string };
    program: { graphs: { events: Record<string, { graph: Graph }> } };
};
type Element = { id: string; name: string; type: string; childrenIds?: string[] };
type Surface = { id: string; name: string; rootElementId: string };
type UIDoc = { surfaces: Surface[]; elements: Record<string, Element> };
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

/** Clip ids resolved by the name an author sees in the asset panel, not pasted in. */
const CLIP = Object.fromEntries(
    Object.values(audioAssets).map(asset => [asset.name, asset.id]),
) as Record<string, string>;

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

/**
 * The one graph on the blueprint that answers for an element, or - when the blueprint carries more
 * than one layer - the one holding `headType`. Layers are how an author separates two unrelated
 * things a widget answers, so a helper that insisted on a single layer would fail the moment one
 * gained a second, without anything about the wiring under test having changed.
 */
function graphFor(elementId: string, headType?: string): Graph {
    const blueprint = blueprints.find(
        candidate =>
            (candidate.owner.kind === "widgetMain" || candidate.owner.kind === "componentWidgetMain")
            && candidate.owner.elementId === elementId,
    );
    expect(blueprint, `no blueprint answers for element ${elementId}`).toBeDefined();
    const graphs = Object.values(blueprint!.program.graphs.events).filter(
        candidate => !headType || Object.values(candidate.graph.nodes).some(node => node.type === headType),
    );
    expect(graphs, `${elementId} has ${graphs.length} graphs answering ${headType ?? "anything"}`).toHaveLength(1);
    return graphs[0]!.graph;
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
 * Derived from the template rather than listed here: what a cue plays is one fact now, and a list
 * beside it would be a second place for that fact to be written down. Sixty nodes used to name a
 * clip; three do.
 */
const CUE_PLAYS: Map<string, GraphNode> = (() => {
    const out = new Map<string, GraphNode>();
    for (const blueprint of blueprints) {
        for (const event of Object.values(blueprint.program.graphs.events)) {
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

/** A cue answering a click, with the action it used to run still behind it. */
function assertClickCue(graph: Graph, headType: string, clipName: string): void {
    const head = only(graph, headType);
    const cue = next(graph, head.id, "then");
    assertCue(cue, clipName);
    expect(isCueCall(next(graph, cue.id, "next"))).toBe(false);
}

/**
 * The rail entries each in-game page authors for itself, and the one the Scenes page carries.
 *
 * Title is not among them: it is the one entry that is the same on every rail - never the page you
 * are standing on, so never wearing the active look - and the four pages place one component
 * instead of holding four copies of its graph. Its cues are asserted once, below.
 */
const RAIL_ENTRIES = ["Save", "Load", "Config", "Back"];

/** Every button that answers a click, and the clip it uses. Back is the one that means undo. */
const CLICKS: readonly { page: string; button: string; clip: string }[] = [
    ...["Start", "Continue", "Load", "Config", "Quit", "Scenes"].map(button => ({
        page: "Title",
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
    { page: "Scenes", button: "Back", clip: "ui-back" },
];

/** The entries that answer the pointer arriving. Rails only: a settings toggle is not a menu. */
const HOVERS: readonly { page: string; button: string }[] = [
    ...["Start", "Continue", "Load", "Config", "Quit", "Scenes"].map(button => ({ page: "Title", button })),
    ...["Config", "Log", "Save", "Load"].flatMap(page => RAIL_ENTRIES.map(button => ({ page, button }))),
    { page: "Scenes", button: "Back" },
];

/** The card the save and load pages both place; its Hit area is what answers a press. */
const SAVE_CARD = "387326a1-5514-4ee2-9d73-48fbe03de0b8";

/** The card the Scenes page places once per scene. */
const SCENE_CARD = "03921db3-a8f5-4399-9146-232d076891e1";

/** The button the four in-game page rails all place to get back to the title. */
const TITLE_BUTTON = "5107c0a1-0000-4000-8000-000000000201";

describe("the sounds the starter template makes", () => {
    it("declares each cue once, on the track the player can turn down", () => {
        // Three clips ship, and each is named in exactly one place now. This is what says the
        // indirection is real: a fourth entry here would mean somebody wrote a clip id back into a
        // widget's own graph, which is the sixty-edit shape the cues exist to end.
        expect([...CUE_PLAYS.values()].map(played => played.params?.soundAssetId).sort()).toEqual(
            [CLIP["ui-back"], CLIP["ui-confirm"], CLIP["ui-hover"]].sort(),
        );
        for (const played of CUE_PLAYS.values()) {
            expect(played.params?.audioTrackId).toBe(AUDIO_TRACK_ID_SOUND);
        }
    });

    it("makes them in sixty places and nowhere else", () => {
        const cues = blueprints.flatMap(blueprint =>
            Object.values(blueprint.program.graphs.events).flatMap(event =>
                Object.values(event.graph.nodes)
                    .filter(node => isCueCall(node))
                    .map(node => `${blueprint.owner.elementId ?? blueprint.id}:${node.id}`),
            ),
        );
        // Counted rather than sampled: the cases below each know which of these they mean, and this
        // is what says nobody sprinkled one more somewhere outside them.
        // 1 save/load card + 1 scene card + 2 list rows + 2 dialog answers, plus the Title button's
        // click and hover, plus the buttons each page still authors for itself. Each of the three
        // was one cue per placement while the pages held copies of it; they place them now.
        expect(cues).toHaveLength(CLICKS.length + HOVERS.length + 6 + 2);
    });

    it.each(CLICKS)("$page ▸ $button answers a click with $clip, before it acts", ({ page, button, clip }) => {
        assertClickCue(graphFor(oneOn(page, button).id), BLUEPRINT_NODE_TYPE_EVENT_HEAD_MOUSE_CLICK, clip);
    });

    it.each(HOVERS)("$page ▸ $button answers the pointer arriving", ({ page, button }) => {
        const graph = graphFor(oneOn(page, button).id);
        assertCue(next(graph, only(graph, BLUEPRINT_NODE_TYPE_EVENT_HEAD_MOUSE_ENTER).id, "then"), "ui-hover");
    });

    it("the title button answers wherever a rail places it", () => {
        // One button, placed on all four in-game page rails. The cues are on it, so a rail cannot
        // have a way back to the title that answers and one that does not.
        const graph = graphFor(TITLE_BUTTON);
        assertClickCue(graph, BLUEPRINT_NODE_TYPE_EVENT_HEAD_MOUSE_CLICK, "ui-confirm");
        assertCue(next(graph, only(graph, BLUEPRINT_NODE_TYPE_EVENT_HEAD_MOUSE_ENTER).id, "then"), "ui-hover");
    });

    it("the save card answers being picked, wherever it is placed", () => {
        // One card, placed six times on Save and six times on Load. The cue is on the card, so a
        // page cannot have a slot that answers and a slot that does not.
        const graph = graphFor(SAVE_CARD, BLUEPRINT_NODE_TYPE_EVENT_HEAD_MOUSE_CLICK);
        assertClickCue(graph, BLUEPRINT_NODE_TYPE_EVENT_HEAD_MOUSE_CLICK, "ui-confirm");

        // Deleting a slot is a right-click, and it stays silent: it is not a selection, and the
        // question it raises answers with a cue of its own.
        const removeGraph = graphFor(SAVE_CARD, BLUEPRINT_NODE_TYPE_EVENT_HEAD_RIGHT_CLICK);
        const remove = only(removeGraph, BLUEPRINT_NODE_TYPE_EVENT_HEAD_RIGHT_CLICK);
        expect(isCueCall(next(removeGraph, remove.id, "then"))).toBe(false);
    });

    it.each([
        { page: "Log", list: "Entries" },
        { page: "Load", list: "Auto saves" },
    ])("a row of $page ▸ $list answers being picked", ({ page, list }) => {
        const graph = graphFor(oneOn(page, list, "nl.list").id, BLUEPRINT_NODE_TYPE_EVENT_HEAD_ITEM_CLICK);
        assertClickCue(graph, BLUEPRINT_NODE_TYPE_EVENT_HEAD_ITEM_CLICK, "ui-confirm");
    });

    it("a scene card answers only when it has a scene to open", () => {
        // One card, placed once per scene. Which scene it opens and what that scene is called are
        // its params, so a page cannot have a card that answers and a card that does not.
        const graph = graphFor(SCENE_CARD, BLUEPRINT_NODE_TYPE_EVENT_HEAD_MOUSE_CLICK);
        const click = only(graph, BLUEPRINT_NODE_TYPE_EVENT_HEAD_MOUSE_CLICK);
        // The cue sits past the visited gate rather than in front of it. A locked card's click
        // ends at that gate, and a cue answering a press that does nothing is the one thing a UI
        // sound must not teach.
        const gate = next(graph, click.id, "then");
        expect(gate.type).toBe(BLUEPRINT_NODE_TYPE_FLOW_IF);
        assertCue(next(graph, gate.id, "true"), "ui-confirm");
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
    });
});
