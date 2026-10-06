import { beforeAll, describe, expect, it } from "vitest";
import type { BlueprintDocument } from "@shared/types/blueprint/document";
import { registerCoreBlueprintNodes } from "../ui-editor/blueprint-nodes/registerCoreBlueprintNodes";
import { BLUEPRINT_NODE_TYPE_GAME_START_STORY } from "@shared/types/blueprint/graph";
import { annotateBlueprintLocation, createBlueprintNodeLocator } from "./blueprintLocator";
import { describeLintLocation } from "./locationText";
import type { LintFinding } from "./types";

/**
 * Blueprint findings carry the layer and the node they are about, so two findings of one rule in one
 * blueprint - two Start Game nodes pointing at deleted stories, say - stop reading as one line twice.
 */

function documentWithTwoLayers(): BlueprintDocument {
    const node = (id: string) => ({ id, type: BLUEPRINT_NODE_TYPE_GAME_START_STORY, params: { storyId: "gone" } });
    return {
        schemaVersion: 1,
        blueprints: {
            bp: {
                id: "bp",
                name: "Start",
                owner: { kind: "widget" } as never,
                graphs: {
                    eventIds: ["layer-a", "layer-b"],
                    events: {
                        "layer-a": { id: "layer-a", name: "New game", graph: { nodes: { start: node("start") } } },
                        "layer-b": { id: "layer-b", graph: { nodes: { start: node("start") } } },
                    },
                    functions: {},
                },
            },
        },
    } as unknown as BlueprintDocument;
}

function finding(graphId: string, nodeId?: string): LintFinding {
    return {
        ruleId: "blueprint/reference-missing",
        messageKey: "lint.rule.blueprintReferenceMissing.messageStory",
        location: { kind: "blueprint", blueprintId: "bp", blueprintName: "Start", graphId, ...(nodeId ? { nodeId } : {}) },
    } as LintFinding;
}

beforeAll(() => {
    registerCoreBlueprintNodes();
});

describe("annotateBlueprintLocation", () => {
    it("fills in the layer's name and the node's catalogue title", () => {
        const locate = createBlueprintNodeLocator(documentWithTwoLayers());
        const annotated = annotateBlueprintLocation(finding("layer-a", "start"), locate);

        expect(annotated.location).toMatchObject({ layerName: "New game", nodeTitle: "Start Game" });
    });

    it("leaves the layer out for a layer with no name, and keeps the node", () => {
        const locate = createBlueprintNodeLocator(documentWithTwoLayers());
        const annotated = annotateBlueprintLocation(finding("layer-b", "start"), locate);

        expect(annotated.location).not.toHaveProperty("layerName");
        expect(annotated.location).toMatchObject({ nodeTitle: "Start Game" });
    });

    it("leaves a finding about a graph the document does not hold unchanged", () => {
        const locate = createBlueprintNodeLocator(documentWithTwoLayers());
        const original = finding("elsewhere", "start");

        expect(annotateBlueprintLocation(original, locate)).toBe(original);
    });

    it("tells two findings of one rule in one blueprint apart in the build console", () => {
        const locate = createBlueprintNodeLocator(documentWithTwoLayers());
        const first = describeLintLocation(annotateBlueprintLocation(finding("layer-a", "start"), locate).location);
        const second = describeLintLocation(annotateBlueprintLocation(finding("layer-b", "start"), locate).location);

        expect(first).toBe("Start / New game / Start Game");
        expect(second).toBe("Start / Start Game");
        expect(first).not.toBe(second);
    });
});
