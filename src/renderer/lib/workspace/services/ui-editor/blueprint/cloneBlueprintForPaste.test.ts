import { describe, expect, it } from "vitest";
import type { Blueprint } from "@shared/types/blueprint/document";
import { BLUEPRINT_NODE_TYPE_ELEMENT_REF, BLUEPRINT_NODE_TYPE_EVENT_HEAD_ELEMENT_CLICK } from "@shared/types/blueprint/graph";
import { cloneStoryActionBlueprintForPaste, cloneWidgetMainBlueprintForPaste } from "./cloneBlueprintForPaste";

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
    } as unknown as Blueprint;
}

function paramsOf(blueprint: Blueprint, nodeId: string): Record<string, unknown> {
    return blueprint.graphs.events["ev-1"].graph!.nodes![nodeId].params as Record<string, unknown>;
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

describe("cloning a story blueprint for a copied row", () => {
    const SOURCE = "11111111-1111-4111-8111-111111111111";
    const COPY = "22222222-2222-4222-8222-222222222222";
    const source = {
        id: SOURCE,
        name: "Open the gallery",
        owner: { kind: "storyAction", blueprintId: SOURCE, mode: "action" },
        graphs: {
            events: {
                onCall: {
                    id: "onCall",
                    name: "On Call",
                    graph: {
                        nodes: {
                            call: { id: "call", type: "blueprint.fn.call", params: { fnRef: `fn:${SOURCE}:head` } },
                            global: { id: "global", type: "blueprint.fn.call", params: { fnRef: "fn:33333333-3333-4333-8333-333333333333:head" } },
                        },
                        edges: [],
                    },
                },
            },
            functions: {},
        },
    } as unknown as Blueprint;

    it("names itself by the new id, its owner and its own function calls with it", () => {
        const cloned = cloneStoryActionBlueprintForPaste(source, COPY)!;
        expect(cloned.id).toBe(COPY);
        expect(cloned.owner).toEqual({ kind: "storyAction", blueprintId: COPY, mode: "action" });
        expect(cloned.name).toBe("Open the gallery");
        const nodes = (cloned.graphs.events.onCall as any).graph.nodes;
        expect(nodes.call.params.fnRef).toBe(`fn:${COPY}:head`);
        // A call into another blueprint keeps pointing there.
        expect(nodes.global.params.fnRef).toBe("fn:33333333-3333-4333-8333-333333333333:head");
        // The source is untouched.
        expect((source.graphs.events.onCall as any).graph.nodes.call.params.fnRef).toBe(`fn:${SOURCE}:head`);
    });

    it("declines anything that is not a story blueprint", () => {
        expect(cloneStoryActionBlueprintForPaste({ ...source, owner: { kind: "globalMain" } } as Blueprint, COPY)).toBeNull();
    });
});
