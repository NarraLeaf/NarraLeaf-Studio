import { describe, expect, it } from "vitest";
import type { Node } from "@xyflow/react";
import { BLUEPRINT_COMMENT_COLORS } from "@/lib/ui-editor/blueprint-comment-colors";
import type { BlueprintFlowNodeData } from "./components/BlueprintFlowNode";
import { blueprintMinimapNodeFill, blueprintMinimapNodeStroke } from "./blueprintMinimapNodeColors";

function node(role: string, params: Record<string, unknown> = {}, selected = false): Node<BlueprintFlowNodeData> {
    return {
        id: `n-${role}-${selected}`,
        position: { x: 0, y: 0 },
        selected,
        data: { catalog: { role }, params },
    } as unknown as Node<BlueprintFlowNodeData>;
}

describe("blueprintMinimapNodeFill", () => {
    it("paints a group frame in the colour the author chose for it", () => {
        expect(blueprintMinimapNodeFill(node("comment", { frame: true, color: "violet" })))
            .toBe(BLUEPRINT_COMMENT_COLORS.violet!.header);
    });

    it("falls back to the default group colour for a frame with none stored", () => {
        expect(blueprintMinimapNodeFill(node("comment", { color: "not-a-colour" })))
            .toBe(BLUEPRINT_COMMENT_COLORS.amber!.header);
    });

    it("keeps cards neutral, and lifts only the selected one", () => {
        expect(blueprintMinimapNodeFill(node("normal"))).toBe("rgb(var(--nl-fg-subtle))");
        expect(blueprintMinimapNodeFill(node("eventHead"))).toBe("rgb(var(--nl-fg-subtle))");
        expect(blueprintMinimapNodeFill(node("normal", {}, true))).toBe("rgb(var(--nl-fg))");
    });
});

describe("blueprintMinimapNodeStroke", () => {
    it("outlines a region and nothing else", () => {
        expect(blueprintMinimapNodeStroke(node("comment", { color: "cyan" })))
            .toBe(BLUEPRINT_COMMENT_COLORS.cyan!.border);
        expect(blueprintMinimapNodeStroke(node("normal"))).toBe("transparent");
    });
});
