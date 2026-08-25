import { describe, expect, it } from "vitest";
import {
    applyBlueprintFlowNodeSelection,
    blueprintElementPreviewsSignature,
    blueprintIrToFlowNodes,
    BLUEPRINT_FLOW_Z_NODE,
} from "./useBlueprintFlowProjection";
import type { BlueprintFlowNodeData } from "./components/BlueprintFlowNode";

type ElementPreview = NonNullable<BlueprintFlowNodeData["elementPreview"]>;

describe("blueprintElementPreviewsSignature", () => {
    it("changes when an Element preview revision changes", () => {
        const first: Record<string, ElementPreview> = {
            refNode: {
                revisionKey: "refNode:surface-a:element-a:1",
                name: "Confirm",
                type: "nl.button",
                layout: { width: 120, height: 32 },
            },
        };
        const second: Record<string, ElementPreview> = {
            refNode: {
                ...first.refNode,
                revisionKey: "refNode:surface-a:element-a:2",
            },
        };

        expect(blueprintElementPreviewsSignature(first)).not.toBe(blueprintElementPreviewsSignature(second));
    });

    it("is stable across object entry order", () => {
        const a: ElementPreview = { revisionKey: "a:1", name: "A", type: "nl.text" };
        const b: ElementPreview = { revisionKey: "b:1", name: "B", type: "nl.image" };

        expect(blueprintElementPreviewsSignature({ a, b })).toBe(blueprintElementPreviewsSignature({ b, a }));
    });
});

describe("blueprintIrToFlowNodes", () => {
    it("lets per-node dynamic select options override shared sources", () => {
        const nodes = blueprintIrToFlowNodes(
            {
                nodes: {
                    target: { id: "target", type: "test.node", params: {} },
                },
                edges: [],
            },
            {
                resolveCatalogEntryForNode: () => ({
                    type: "test.node",
                    displayName: "Test",
                    category: "Test",
                    pins: [],
                }),
            } as any,
            // onPatchNodeParam, memberVariables, persistentVariables, savedVariables,
            // onAddDynamicInputPin, onRemoveDynamicInputPin - then the two option maps under test.
            undefined,
            undefined,
            undefined,
            undefined,
            undefined,
            undefined,
            {
                pages: [{ value: "global", label: "Global" }],
            },
            {
                target: {
                    pages: [{ value: "node", label: "Node" }],
                },
            },
        );

        expect(nodes[0]?.data.dynamicSelectOptions?.pages).toEqual([{ value: "node", label: "Node" }]);
    });
});

describe("group frame stacking", () => {
    /** Two frames, the inner one listed first, so document order alone would draw it underneath. */
    function nestedFrames() {
        const frame = (id: string, x: number, y: number, size: number) => ({
            id,
            type: "flow.comment",
            params: { frame: true, background: false, width: size, height: size },
            meta: { editorLayout: { x, y } },
        });
        return blueprintIrToFlowNodes(
            {
                nodes: {
                    inner: frame("inner", 100, 100, 200),
                    outer: frame("outer", 0, 0, 600),
                    card: {
                        id: "card",
                        type: "test.node",
                        params: {},
                        meta: { editorLayout: { x: 150, y: 150 } },
                    },
                },
                edges: [],
            } as any,
            {
                resolveCatalogEntryForNode: (type: string) => ({
                    type,
                    displayName: type,
                    category: "Test",
                    pins: [],
                    role: type === "flow.comment" ? "comment" : undefined,
                }),
            } as any,
        );
    }

    it("draws a frame inside another frame on top of it, and both under the cards", () => {
        const byId = new Map(nestedFrames().map(n => [n.id, n]));

        expect(byId.get("outer")?.zIndex).toBeLessThan(byId.get("inner")!.zIndex!);
        expect(byId.get("inner")?.zIndex).toBeLessThan(BLUEPRINT_FLOW_Z_NODE);
        expect(byId.get("card")?.zIndex).toBe(BLUEPRINT_FLOW_Z_NODE);
    });

    it("keeps a frame behind the cards even with the note layer switched on", () => {
        // `background` is the note's switch and a frame can carry it from an older document or a
        // stray click. A frame level with the cards covers whatever the document listed first.
        const nodes = blueprintIrToFlowNodes(
            {
                nodes: {
                    card: { id: "card", type: "test.node", params: {}, meta: { editorLayout: { x: 150, y: 150 } } },
                    frame: {
                        id: "frame",
                        type: "flow.comment",
                        params: { frame: true, background: true, width: 600, height: 600 },
                        meta: { editorLayout: { x: 0, y: 0 } },
                    },
                },
                edges: [],
            } as any,
            {
                resolveCatalogEntryForNode: (type: string) => ({
                    type,
                    displayName: type,
                    category: "Test",
                    pins: [],
                    role: type === "flow.comment" ? "comment" : undefined,
                }),
            } as any,
        );
        const byId = new Map(nodes.map(n => [n.id, n]));

        expect(byId.get("frame")?.zIndex).toBeLessThan(BLUEPRINT_FLOW_Z_NODE);
        expect(byId.get("card")?.zIndex).toBe(BLUEPRINT_FLOW_Z_NODE);
    });

    it("keeps a selected frame behind the cards it encloses", () => {
        const selected = applyBlueprintFlowNodeSelection(nestedFrames(), ["outer", "inner"]);
        const byId = new Map(selected.map(n => [n.id, n]));

        expect(byId.get("outer")?.zIndex).toBeLessThan(byId.get("inner")!.zIndex!);
        expect(byId.get("inner")?.zIndex).toBeLessThan(BLUEPRINT_FLOW_Z_NODE);
    });
});
