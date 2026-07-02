import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { BLUEPRINT_NODE_TYPE_DISPLAYABLE_ANIMATE_PROPERTY } from "@shared/types/blueprint/graph";
import { resolveBlueprintNodeEditorCatalogEntry } from "@/lib/ui-editor/behavior-graph/nodeEditorCatalog";
import { registerCoreBlueprintNodes } from "@/lib/ui-editor/blueprint-nodes/registerCoreBlueprintNodes";
import { BlueprintFlowNode } from "./BlueprintFlowNode";

vi.mock("@xyflow/react", () => ({
    Handle: () => null,
    Position: {
        Bottom: "bottom",
        Left: "left",
        Right: "right",
        Top: "top",
    },
    useReactFlow: () => ({ getZoom: () => 1 }),
}));

describe("BlueprintFlowNode", () => {
    it("renders Animate opacity From/To as stored percent values", () => {
        registerCoreBlueprintNodes();
        const catalog = resolveBlueprintNodeEditorCatalogEntry(BLUEPRINT_NODE_TYPE_DISPLAYABLE_ANIMATE_PROPERTY);
        const markup = renderToStaticMarkup(
            <BlueprintFlowNode
                {...({
                    selected: false,
                    data: {
                        catalog,
                        nodeId: "animate",
                        params: {
                            property: "opacity",
                            from: 1,
                            to: 1,
                            duration: 0.3,
                            delay: 0,
                            easing: "easeOut",
                            after: "hold",
                        },
                        onPatchNodeParam: vi.fn(),
                    },
                } as any)}
            />,
        );

        expect(markup).toContain('aria-label="Animation start value"');
        expect(markup).toContain('aria-label="Animation target value"');
        expect(markup).toContain('value="1"');
        expect(markup).not.toContain('value="100"');
    });
});
