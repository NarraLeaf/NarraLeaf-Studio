/**
 * The Log page replays a voiced line from its row.
 *
 * Each row of the log carries a replay button at its right. It is drawn only on a row whose line has
 * a take to play - its visibility reads the row's `hasVoice` field - and pressing it plays that line
 * through Play Voice, by the unit id the row carries. What has to hold, in the English template and
 * in the two generated from it, is that wiring, and that the line's text stops short of the button.
 */
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import type { BlueprintDocument } from "@shared/types/blueprint/document";
import {
    BLUEPRINT_NODE_TYPE_EVENT_HEAD_MOUSE_CLICK,
    BLUEPRINT_NODE_TYPE_LIST_GET_ITEM_FIELD,
} from "@shared/types/blueprint/graph";
import { resolveUIStruct } from "@shared/types/ui-editor/builtinStructs";
import type { UIDocument } from "@shared/types/ui-editor/document";

const LOG_ENTRIES = "5aab5352-98e9-4d9e-af03-1938fa5b5032";
const ENTRY = "e1e45cc5-f9bf-48da-b126-555dcc1abcf6";
const LINE = "465a62e7-7bbc-475d-8002-929ada7ee70b";
const REPLAY = "352f20e9-3f47-41f2-85f0-3f5d95799d96";
const PLAY_VOICE = "blueprint.voice.play";

const ROOT = path.join(process.cwd(), "resources/templates/skeleton");

describe.each(["content", "content.zh", "content.ja"])("the Log page's replay button in %s", tree => {
    const read = (file: string) => JSON.parse(fs.readFileSync(path.join(ROOT, tree, "editor/ui", file), "utf-8"));
    const document = read("uidoc.json") as UIDocument;
    const blueprints = (read("uigraphs.json") as { blueprintDocument: BlueprintDocument }).blueprintDocument;
    const replay = document.elements[REPLAY];

    it("sits in every row, drawn only on a row whose line has a take to play", () => {
        expect(replay?.type).toBe("nl.button");
        expect(replay?.parentId).toBe(ENTRY);
        expect(document.elements[LOG_ENTRIES]?.childrenIds).toEqual([ENTRY]);
        expect(replay?.valueBindings?.["layout.visible"]).toEqual({ kind: "listItemField", fieldId: "hasVoice" });
        const struct = resolveUIStruct(document, String(document.elements[LOG_ENTRIES]?.props?.itemStructId));
        expect(struct?.fields.find(field => field.id === "hasVoice")?.type).toBe("boolean");
    });

    it("leaves the line's text room to its left", () => {
        const line = document.elements[LINE]!.layout;
        expect(line.x + line.width).toBeLessThanOrEqual(replay!.layout.x);
        const entry = document.elements[ENTRY]!.layout;
        expect(replay!.layout.x + replay!.layout.width).toBeLessThanOrEqual(entry.width);
    });

    it("plays the row's line through Play Voice when pressed", () => {
        const owned = Object.values(blueprints.blueprints).filter(
            blueprint => blueprint.owner.kind === "widgetMain" && blueprint.owner.elementId === REPLAY,
        );
        expect(owned).toHaveLength(1);
        const graphs = Object.values(owned[0]!.graphs.events).map(event => event.graph);
        expect(graphs).toHaveLength(1);
        const { nodes, edges } = graphs[0]!;
        const head = Object.values(nodes).find(node => node.type === BLUEPRINT_NODE_TYPE_EVENT_HEAD_MOUSE_CLICK);
        const play = Object.values(nodes).find(node => node.type === PLAY_VOICE);
        const field = Object.values(nodes).find(node => node.type === BLUEPRINT_NODE_TYPE_LIST_GET_ITEM_FIELD);
        expect(head && play && field).toBeTruthy();
        expect(edges).toContainEqual({ from: { nodeId: head!.id, port: "then" }, to: { nodeId: play!.id, port: "in" } });
        // Get Field left unwired inside a list row reads the row it is pressed in.
        expect(field!.params?.field).toBe("voiceId");
        expect(edges.some(edge => edge.to.nodeId === field!.id)).toBe(false);
        expect(edges).toContainEqual({ from: { nodeId: field!.id, port: "value" }, to: { nodeId: play!.id, port: "voiceId" } });
    });
});
