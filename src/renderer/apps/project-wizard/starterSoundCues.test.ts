/**
 * The sounds the starter template makes when a player works its menus.
 *
 * Three clips ship with the template and for a long time nothing played any of them, which is the
 * failure mode a per-page assertion cannot catch: a screen with no cue reads, on its own, like a
 * screen whose author had not got to it yet. So this sweeps every cue from one list and fails on the
 * count as well as the wiring.
 *
 * What each one has to prove is not "a Play Sound exists in this graph" but that it is the first
 * thing the interaction runs - a cue behind a `Go Page` is a cue the player never hears, because the
 * page it belongs to is gone by then - and that whatever the click used to run still runs after it.
 *
 * Everything comes from the real catalogue and the real asset metadata, so renaming a node type or
 * deleting a clip breaks this rather than leaving the template pointing at something that is no
 * longer there.
 */
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
    BLUEPRINT_NODE_TYPE_EVENT_HEAD_MOUSE_CLICK,
    BLUEPRINT_NODE_TYPE_EVENT_HEAD_MOUSE_ENTER,
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

/** A button on a named page, by the name it carries in the layer tree. */
function buttonOn(surfaceName: string, elementName: string): Element {
    const surface = document.surfaces.find(candidate => candidate.name === surfaceName);
    expect(surface, `no surface named ${surfaceName}`).toBeDefined();
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
    walk(surface!.rootElementId);
    expect(found, `${surfaceName} has ${found.length} buttons named ${elementName}`).toHaveLength(1);
    return found[0]!;
}

function graphFor(elementId: string): Graph {
    const blueprint = blueprints.find(
        candidate => candidate.owner.kind === "widgetMain" && candidate.owner.elementId === elementId,
    );
    expect(blueprint, `no blueprint answers for element ${elementId}`).toBeDefined();
    const graphs = Object.values(blueprint!.program.graphs.events);
    expect(graphs).toHaveLength(1);
    return graphs[0]!.graph;
}

function only(graph: Graph, type: string): GraphNode {
    const found = Object.values(graph.nodes).filter(node => node.type === type);
    expect(found, `expected one ${type}, found ${found.length}`).toHaveLength(1);
    return found[0]!;
}

/** The single node an exec output runs. */
function next(graph: Graph, fromId: string, port: string): GraphNode {
    const out = graph.edges.filter(edge => edge.from.nodeId === fromId && edge.from.port === port);
    expect(out, `${fromId}.${port} leads to ${out.length} nodes`).toHaveLength(1);
    return graph.nodes[out[0]!.to.nodeId]!;
}

function assertCue(cue: GraphNode, clipName: string): void {
    expect(cue.type).toBe(BLUEPRINT_NODE_TYPE_SOUND_PLAY);
    expect(CLIP[clipName], `the template ships no clip named ${clipName}`).toBeDefined();
    expect(cue.params?.soundAssetId).toBe(CLIP[clipName]);
    // The SFX track, so the player's own effects slider and mute reach it. A cue the settings page
    // cannot turn down is the one thing a UI sound must never be.
    expect(cue.params?.audioTrackId).toBe(AUDIO_TRACK_ID_SOUND);
}

/** Every menu entry that answers a click with a cue, and the clip each one uses. */
const CLICKS: readonly { page: string; button: string; clip: string }[] = [
    ...["Start", "Continue", "Load", "Config", "Quit", "Scenes"].map(button => ({
        page: "Title",
        button,
        clip: "ui-confirm",
    })),
    ...["Save", "Load", "Config", "Title", "Text", "Sound", "All text", "Read only", "On", "Off"].map(button => ({
        page: "Config",
        button,
        clip: "ui-confirm",
    })),
    // The one control on the page whose whole job is to undo the last move.
    { page: "Config", button: "Back", clip: "ui-back" },
];

/** The menu entries that answer the pointer arriving. Rails only: a settings toggle is not a menu. */
const HOVERS: readonly { page: string; button: string }[] = [
    ...["Start", "Continue", "Load", "Config", "Quit", "Scenes"].map(button => ({ page: "Title", button })),
    ...["Save", "Load", "Config", "Back", "Title"].map(button => ({ page: "Config", button })),
];

describe("the sounds the starter template makes", () => {
    it("makes them in twenty-eight places and nowhere else", () => {
        const cues = blueprints.flatMap(blueprint =>
            Object.values(blueprint.program.graphs.events).flatMap(event =>
                Object.values(event.graph.nodes)
                    .filter(node => node.type === BLUEPRINT_NODE_TYPE_SOUND_PLAY)
                    .map(node => `${blueprint.owner.elementId ?? blueprint.id}:${node.id}`),
            ),
        );
        // Counted rather than sampled: the cases below each know which of these they mean, and this
        // is what says nobody sprinkled a twenty-ninth somewhere outside them.
        expect(cues).toHaveLength(CLICKS.length + HOVERS.length);
    });

    it.each(CLICKS)("$page ▸ $button answers a click with $clip, before it acts", ({ page, button, clip }) => {
        const graph = graphFor(buttonOn(page, button).id);
        const click = only(graph, BLUEPRINT_NODE_TYPE_EVENT_HEAD_MOUSE_CLICK);
        const cue = next(graph, click.id, "then");
        assertCue(cue, clip);
        // The action is still there, now behind the cue: a button that only makes a noise is worse
        // than a silent one.
        expect(next(graph, cue.id, "next").type).not.toBe(BLUEPRINT_NODE_TYPE_SOUND_PLAY);
    });

    it.each(HOVERS)("$page ▸ $button answers the pointer arriving", ({ page, button }) => {
        const graph = graphFor(buttonOn(page, button).id);
        const enter = only(graph, BLUEPRINT_NODE_TYPE_EVENT_HEAD_MOUSE_ENTER);
        assertCue(next(graph, enter.id, "then"), "ui-hover");
    });
});
