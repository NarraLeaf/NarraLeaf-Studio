/**
 * The Log page's replay button says what it does.
 *
 * The button on a voiced row of the backlog draws only "▶", and a player had nothing to tell them
 * it replays the line's voice: no word on it, no hint. A text beside it in the same row now names it
 * in the game's own words - shown while the pointer is over the button or the focus is on it, hidden
 * otherwise - in every tree the template is written in and every translation it carries.
 */
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { hashSourceText } from "@shared/utils/localizationText";

const ROOT = path.join(process.cwd(), "resources/templates/skeleton");
const TREES: Array<[tree: string, words: string]> = [
    ["content", "Replay voice"],
    ["content.zh", "重播语音"],
    ["content.ja", "ボイス再生"],
];
const LOG_SURFACE = "8a607acd-95dd-4af7-9994-686c20891c18";
const REPLAY_BUTTON = "352f20e9-3f47-41f2-85f0-3f5d95799d96";
const KEY = "log.replayVoice";

type Element = { id: string; type: string; parentId: string | null; layout: { x: number; y: number; width: number; height: number; visible: boolean }; props?: Record<string, unknown> };
type Node = { type: string; params?: Record<string, unknown> };
type Graph = { nodes: Record<string, Node>; edges: Array<{ from: { nodeId: string; port: string }; to: { nodeId: string; port: string } }> };

function read<T>(tree: string, file: string): T {
    return JSON.parse(fs.readFileSync(path.join(ROOT, tree, "editor", file), "utf-8")) as T;
}

describe.each(TREES)("the Log page's replay button in %s", (tree, words) => {
    const elements = read<{ elements: Record<string, Element> }>(tree, "ui/uidoc.json").elements;
    const button = elements[REPLAY_BUTTON];
    const hints = Object.values(elements).filter(element => element.props?.localizationKey === KEY);

    it("has a hidden text in its own row, above it, that names it", () => {
        expect(hints).toHaveLength(1);
        const hint = hints[0];
        expect(hint.type).toBe("nl.text");
        expect(hint.parentId).toBe(button.parentId);
        expect(hint.layout.visible).toBe(false);
        expect(hint.layout.y + hint.layout.height).toBeLessThanOrEqual(button.layout.y);
        expect(hint.layout.x + hint.layout.width).toBe(button.layout.x + button.layout.width);
    });

    it("reads the game's own words, in the tree's language and in each translation it carries", () => {
        const keys = read<{ keys: Record<string, { sourceText: string }> }>(tree, "localization/keys.json").keys;
        expect(keys[KEY]?.sourceText).toBe(words);
        const dir = path.join(ROOT, tree, "editor/localization");
        for (const file of fs.readdirSync(dir).filter(name => name !== "keys.json" && name.endsWith(".json"))) {
            const unit = read<{ units: Record<string, { sourceHash: string; target: string }> }>(tree, `localization/${file}`).units[`key:${KEY}`];
            expect(unit?.sourceHash, file).toBe(hashSourceText(words));
            expect(unit?.target.trim(), file).not.toBe("");
        }
    });

    it("shows it on Mouse Enter and Focus, and hides it on Mouse Leave and Blur", () => {
        const graphs = read<{ blueprintDocument: { blueprints: Record<string, { owner: { kind: string; surfaceId?: string; elementId?: string }; graphs: { events: Record<string, { graph: Graph }> } }> } }>(tree, "ui/uigraphs.json");
        const blueprint = Object.values(graphs.blueprintDocument.blueprints)
            .find(entry => entry.owner.kind === "widgetMain" && entry.owner.surfaceId === LOG_SURFACE && entry.owner.elementId === REPLAY_BUTTON);
        expect(blueprint).toBeDefined();
        const shown: Record<string, boolean> = {};
        for (const { graph } of Object.values(blueprint!.graphs.events)) {
            for (const [headId, head] of Object.entries(graph.nodes)) {
                if (!head.type.startsWith("blueprint.event.head.")) continue;
                const setter = graph.edges.find(edge => edge.from.nodeId === headId && edge.from.port === "then")?.to.nodeId;
                const node = setter ? graph.nodes[setter] : undefined;
                if (node?.type !== "blueprint.element.displayable.setProperty" || node.params?.property !== "visible") continue;
                const ref = graph.edges.find(edge => edge.to.nodeId === setter && edge.to.port === "element")?.from.nodeId;
                if (ref && graph.nodes[ref]?.params?.elementId === hints[0].id) {
                    shown[head.type.replace("blueprint.event.head.", "")] = node.params?.value === true;
                }
            }
        }
        expect(shown).toEqual({ mouseEnter: true, focus: true, mouseLeave: false, blur: false });
    });
});
