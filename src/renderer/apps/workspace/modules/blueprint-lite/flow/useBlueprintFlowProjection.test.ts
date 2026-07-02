import { describe, expect, it } from "vitest";
import { blueprintElementPreviewsSignature } from "./useBlueprintFlowProjection";
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
