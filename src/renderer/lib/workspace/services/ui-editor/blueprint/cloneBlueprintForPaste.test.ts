import { describe, expect, it } from "vitest";
import type { Blueprint } from "@shared/types/blueprint/document";
import { BLUEPRINT_NODE_TYPE_ELEMENT_REF, BLUEPRINT_NODE_TYPE_EVENT_HEAD_ELEMENT_CLICK } from "@shared/types/blueprint/graph";
import { cloneWidgetMainBlueprintForPaste } from "./cloneBlueprintForPaste";

/**
 * Whether a copied widget's logic drives the copy or the original.
 *
 * The failure this guards is invisible on the page: the duplicate is drawn correctly, and only the
 * thing its graph reaches gives it away - the original widget moves when the copy is pressed.
 */

function blueprintNamingElement(elementId: string): Blueprint {
    return {
        id: "bp-old",
        name: "Main",
        owner: { kind: "widgetMain", surfaceId: "surface-old", elementId: "el-old" },
        frontend: "graph",
        programKind: "graph",
        program: {
            kind: "graph",
            graphs: {
                events: {
                    "ev-1": {
                        id: "ev-1",
                        graph: {
                            nodes: {
                                head: {
                                    id: "head",
                                    type: BLUEPRINT_NODE_TYPE_EVENT_HEAD_ELEMENT_CLICK,
                                    params: { surfaceId: "surface-old", elementId, elementType: "nl.button" },
                                },
                                literal: {
                                    id: "literal",
                                    type: BLUEPRINT_NODE_TYPE_ELEMENT_REF,
                                    params: { surfaceId: "surface-old", elementId: "el-outside", elementType: "nl.text" },
                                },
                            },
                        },
                    },
                },
                functions: {},
            },
        },
    } as unknown as Blueprint;
}

function paramsOf(blueprint: Blueprint, nodeId: string): Record<string, unknown> {
    const program = blueprint.program as Extract<Blueprint["program"], { kind: "graph" }>;
    return program.graphs.events["ev-1"].graph!.nodes![nodeId].params as Record<string, unknown>;
}

describe("cloning a widget's blueprint for a paste", () => {
    const clone = () => cloneWidgetMainBlueprintForPaste({
        source: blueprintNamingElement("el-old"),
        newBlueprintId: "bp-new",
        surfaceId: "surface-new",
        newOwnerElementId: "el-new",
        elementIdMap: { "el-old": "el-new" },
        oldBlueprintId: "bp-old",
        newBlueprintIdForSourceRemap: "bp-new",
    });

    it("points the graph at the widget that was pasted, not the one it was copied from", () => {
        expect(paramsOf(clone(), "head")).toMatchObject({ elementId: "el-new", surfaceId: "surface-new" });
    });

    // A reference out of the copied subtree names a widget that is still there and still meant.
    it("leaves a reference to a widget outside the copied subtree alone", () => {
        expect(paramsOf(clone(), "literal")).toMatchObject({ elementId: "el-outside", surfaceId: "surface-old" });
    });

    it("still moves the blueprint onto the pasted widget", () => {
        expect(clone().owner).toEqual({ kind: "widgetMain", surfaceId: "surface-new", elementId: "el-new" });
    });
});
