/**
 * Which keys read the engine's NVL page on: the ones that read the dialogue box on.
 *
 * Read from the starter template itself as well as from fixtures, because the starter is the project
 * that has no NVL page of its own and reads on with Space and Enter - the one this exists for.
 *
 * Comments in English per project convention.
 */
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import type { BlueprintDocument } from "@shared/types/blueprint/document";
import {
    BLUEPRINT_NODE_TYPE_EVENT_HEAD_ACTION,
    BLUEPRINT_NODE_TYPE_GAME_NEXT,
    BLUEPRINT_NODE_TYPE_LOG,
} from "@shared/types/blueprint/graph";
import type { UIDocument } from "@shared/types/ui-editor/document";
import {
    createDialogueAdvanceRecord,
    isDialogueSlotSurface,
    projectDrawsNvlPage,
    resolveDialogueAdvanceActionIds,
    resolveEngineNvlKeys,
} from "./engineNvlKeys";

function readTemplate(tree: string, file: string): unknown {
    return JSON.parse(fs.readFileSync(path.join(process.cwd(), "resources/templates/skeleton", tree, "editor/ui", file), "utf-8"));
}

const DIALOGUE = "dialogue";

function documentWith(actions: string[], more: Partial<UIDocument> = {}): UIDocument {
    return {
        surfaces: [
            { id: DIALOGUE, kind: "stageSurface", mount: { kind: "slot", slotId: "dialog" }, actions: actions.map(actionId => ({ actionId })) },
        ],
        ...more,
    } as unknown as UIDocument;
}

/** A dialogue-box blueprint answering `actionId` with `then` - `Next`, or something else. */
function answering(actionId: string, then: string, surfaceId = DIALOGUE): BlueprintDocument["blueprints"][string] {
    return {
        id: `bp-${actionId}-${then}`,
        name: actionId,
        owner: { kind: "surfaceMain", surfaceId },
        graphs: {
            events: {
                layer: {
                    id: "layer",
                    graph: {
                        nodes: {
                            head: { id: "head", type: BLUEPRINT_NODE_TYPE_EVENT_HEAD_ACTION, params: { actionId } },
                            then: { id: "then", type: then },
                        },
                        edges: [{ from: { nodeId: "head", port: "then" }, to: { nodeId: "then", port: "in" } }],
                    },
                },
            },
        },
    } as unknown as BlueprintDocument["blueprints"][string];
}

function blueprints(...list: BlueprintDocument["blueprints"][string][]): BlueprintDocument {
    return { blueprints: Object.fromEntries(list.map(blueprint => [blueprint.id, blueprint])) } as unknown as BlueprintDocument;
}

describe("the actions the dialogue box reads on with", () => {
    it("is the starter's Advance, in each language the starter is written in", () => {
        for (const tree of ["content", "content.zh", "content.ja"]) {
            const document = readTemplate(tree, "uidoc.json") as UIDocument;
            const graphs = readTemplate(tree, "uigraphs.json") as { blueprintDocument: BlueprintDocument };

            expect([...resolveDialogueAdvanceActionIds(document, graphs.blueprintDocument)], tree).toEqual(["advance"]);
            // ...and the starter draws no NVL page, so the engine's stands in.
            expect(projectDrawsNvlPage(document), tree).toBe(false);
        }
    });

    it("is only what the box answers with Next, and only what the box has enabled", () => {
        const document = documentWith(["advance", "hide"]);
        const graphs = blueprints(
            answering("advance", BLUEPRINT_NODE_TYPE_GAME_NEXT),
            // Answered, but not by reading on.
            answering("hide", BLUEPRINT_NODE_TYPE_LOG),
            // Reads on, but the box does not have it enabled.
            answering("skip", BLUEPRINT_NODE_TYPE_GAME_NEXT),
            // Reads on, on some other surface.
            answering("menu", BLUEPRINT_NODE_TYPE_GAME_NEXT, "elsewhere"),
        );

        expect([...resolveDialogueAdvanceActionIds(document, graphs)]).toEqual(["advance"]);
    });

    it("is nothing for a project that has no dialogue box", () => {
        const document = { surfaces: [] } as unknown as UIDocument;

        expect(resolveDialogueAdvanceActionIds(document, blueprints(answering("advance", BLUEPRINT_NODE_TYPE_GAME_NEXT))).size).toBe(0);
    });
});

describe("the engine's NVL page as a keyboard target", () => {
    const actionIds = new Set(["advance"]);
    const advance = () => undefined;
    const surfaceOn = (slotId: string) => ({ surface: { kind: "stageSurface", mount: { kind: "slot", slotId } } });

    it("is one while the story is in NVL and nothing else answers for the dialogue", () => {
        const keys = resolveEngineNvlKeys({ nvlActive: true, projectDrawsNvlPage: false, stage: [surfaceOn("onStage")], actionIds, advance });

        expect(keys?.actionIds).toBe(actionIds);
    });

    it("is none outside NVL, in a project that draws its own NVL page, or with nothing to read on for", () => {
        expect(resolveEngineNvlKeys({ nvlActive: false, projectDrawsNvlPage: false, stage: [], actionIds, advance })).toBeNull();
        expect(resolveEngineNvlKeys({ nvlActive: true, projectDrawsNvlPage: true, stage: [], actionIds, advance })).toBeNull();
        expect(resolveEngineNvlKeys({ nvlActive: true, projectDrawsNvlPage: false, stage: [], actionIds: new Set(), advance })).toBeNull();
    });

    it("is none while a dialogue box or an NVL surface is on the stage, so one press reads on once", () => {
        expect(resolveEngineNvlKeys({ nvlActive: true, projectDrawsNvlPage: false, stage: [surfaceOn("dialog")], actionIds, advance })).toBeNull();
        expect(resolveEngineNvlKeys({ nvlActive: true, projectDrawsNvlPage: false, stage: [surfaceOn("nvl")], actionIds, advance })).toBeNull();
    });
});

describe("what playing shows about the dialogue box", () => {
    it("adds the actions seen reading on to the ones the graphs reach Next from, and only those", () => {
        const record = createDialogueAdvanceRecord();
        const fromGraphs = new Set(["advance"]);

        expect(record.actionIds(fromGraphs)).toBe(fromGraphs);
        const before = record.nextCalls();
        record.noteNext();
        expect(record.nextCalls()).toBe(before + 1);
        record.witnessed(["confirm"]);

        expect([...record.actionIds(fromGraphs)].sort()).toEqual(["advance", "confirm"]);
        expect([...record.actionIds(new Set())]).toEqual(["confirm"]);
    });

    it("knows the dialogue box among the stage's surfaces", () => {
        expect(isDialogueSlotSurface({ kind: "stageSurface", mount: { kind: "slot", slotId: "dialog" } })).toBe(true);
        expect(isDialogueSlotSurface({ kind: "stageSurface", mount: { kind: "slot", slotId: "nvl" } })).toBe(false);
        expect(isDialogueSlotSurface({ kind: "appSurface" })).toBe(false);
    });
});
