import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
    BLUEPRINT_NODE_TYPE_DISPLAYABLE_ANIMATE_PROPERTY,
    BLUEPRINT_NODE_TYPE_ELEMENT_REF,
    BLUEPRINT_NODE_TYPE_FLOW_COMMENT,
    BLUEPRINT_NODE_TYPE_GAME_SAVE_WRITE,
    BLUEPRINT_NODE_TYPE_LITERAL_BOOLEAN,
} from "@shared/types/blueprint/graph";
import { resolveBlueprintNodeEditorCatalogEntry } from "@/lib/ui-editor/behavior-graph/nodeEditorCatalog";
import { registerCoreBlueprintNodes } from "@/lib/ui-editor/blueprint-nodes/registerCoreBlueprintNodes";
import { BLUEPRINT_NODE_PARAMS_INLINE_LITERAL_PINS_KEY } from "@/lib/ui-editor/blueprint-nodes/types";
import { BlueprintFlowNode } from "./BlueprintFlowNode";

function renderSaveGameCapturePin(screenshot: unknown): string {
    registerCoreBlueprintNodes();
    const catalog = resolveBlueprintNodeEditorCatalogEntry(BLUEPRINT_NODE_TYPE_GAME_SAVE_WRITE);
    return renderToStaticMarkup(
        <BlueprintFlowNode
            {...({
                selected: false,
                data: {
                    catalog,
                    nodeId: "write",
                    params: {
                        id: "slot-a",
                        screenshot,
                        [BLUEPRINT_NODE_PARAMS_INLINE_LITERAL_PINS_KEY]: ["screenshot"],
                    },
                    onPatchNodeParam: vi.fn(),
                },
            } as any)}
        />,
    );
}

function renderBooleanLiteral(value: unknown): string {
    registerCoreBlueprintNodes();
    const catalog = resolveBlueprintNodeEditorCatalogEntry(BLUEPRINT_NODE_TYPE_LITERAL_BOOLEAN);
    return renderToStaticMarkup(
        <BlueprintFlowNode
            {...({
                selected: false,
                data: { catalog, nodeId: "flag", params: { value }, onPatchNodeParam: vi.fn() },
            } as any)}
        />,
    );
}

function renderComment(params: Record<string, unknown>): string {
    registerCoreBlueprintNodes();
    const catalog = resolveBlueprintNodeEditorCatalogEntry(BLUEPRINT_NODE_TYPE_FLOW_COMMENT);
    return renderToStaticMarkup(
        <BlueprintFlowNode
            {...({
                selected: false,
                data: {
                    catalog,
                    nodeId: "note",
                    params,
                    onPatchNodeParam: vi.fn(),
                    onFitGroupFrame: vi.fn(),
                },
            } as any)}
        />,
    );
}

function renderElementCard(params: Record<string, unknown>, elementPreview?: unknown): string {
    registerCoreBlueprintNodes();
    const catalog = resolveBlueprintNodeEditorCatalogEntry(BLUEPRINT_NODE_TYPE_ELEMENT_REF);
    return renderToStaticMarkup(
        <BlueprintFlowNode
            {...({
                selected: false,
                data: {
                    catalog,
                    nodeId: "ref",
                    params,
                    elementPreview,
                    onBindElementLiteral: vi.fn(),
                },
            } as any)}
        />,
    );
}

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

/**
 * The freeze, stubbed at the hook rather than by standing up a workspace: this suite renders one
 * node with no provider around it, which is the point - a node card has to be renderable on its own.
 */
let frozen = false;
vi.mock("@/apps/workspace/hooks/useWorkspaceFrozen", () => ({
    useWorkspaceFrozen: () => frozen,
    // The guard reads the whole reason now, so it can ask whether a partial freeze spares the
    // document a surface names. A node card names none, so any kind will do.
    useWorkspaceFreeze: () => (frozen ? { kind: "manual" } : null),
}));

beforeEach(() => {
    frozen = false;
});

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

    it("shows a Boolean card's stored value whether it was stored as a word or as a boolean", () => {
        // Studio seeds a new condition graph with `value: false`, and a written file says `true`; the
        // dropdown's options are the words, so it read "-" for a value the graph was using.
        expect(renderBooleanLiteral(true)).toContain("True");
        expect(renderBooleanLiteral(false)).toContain("False");
        expect(renderBooleanLiteral("true")).toContain("True");
        expect(renderBooleanLiteral(undefined)).not.toContain("True");
    });

    it("renders the Save Game Capture pin as an on-card true/false dropdown", () => {
        expect(renderSaveGameCapturePin(true)).toContain("True");
        // Unset reads as False, matching the runtime's `value === true` check.
        expect(renderSaveGameCapturePin(undefined)).toContain("False");
        expect(renderSaveGameCapturePin(false)).toContain("False");
    });

    /**
     * A frozen workspace, and the reason this is asserted on the CARD rather than on each control:
     * the clamp is one `<fieldset disabled>` around the whole card, so a node type added later
     * inherits it. Measured before it existed - every dropdown on every node still took a change and
     * threw it away on thaw.
     */
    it("wraps the whole card in a disabled fieldset while the workspace is frozen", () => {
        frozen = true;
        const markup = renderSaveGameCapturePin(true);
        expect(markup).toContain("<fieldset disabled");
        // `display: contents`, so React Flow measures the card exactly as it did before.
        expect(markup).toContain("display:contents");
        // Still drawn: reading a frozen graph is the point.
        expect(markup).toContain("True");
    });

    it("leaves the card alone when the workspace is writable", () => {
        expect(renderSaveGameCapturePin(true)).not.toContain("<fieldset");
    });

    /**
     * The layer switch is a note's affordance. On a frame it is the one control that can put the
     * rectangle in front of the cards it was drawn around, which is why the frame is not offered it
     * - the toggle is the only element on the card carrying `aria-pressed`.
     */
    it("offers the layer switch on a note and not on a group frame", () => {
        expect(renderComment({ text: "note" })).toContain("aria-pressed");
        expect(renderComment({ text: "group", frame: true, background: false })).not.toContain("aria-pressed");
    });

    /**
     * Fit is the way back from a frame that only ever grows, so it belongs on the frame and only
     * there - a note encloses nothing to be fitted to.
     */
    it("offers Fit on a group frame and not on a note", () => {
        expect(renderComment({ text: "group", frame: true, background: false })).toContain("lucide-shrink");
        expect(renderComment({ text: "note" })).not.toContain("lucide-shrink");
    });

    /**
     * A node whose type the editor does not have - a plugin that is not loaded. The card must not
     * pass for an ordinary one: it names itself unknown, shows the raw type, and wears a dashed
     * warning frame no real card has.
     */
    it("draws an unknown node as unmistakably unknown", () => {
        registerCoreBlueprintNodes();
        const catalog = resolveBlueprintNodeEditorCatalogEntry("com.example.plugin.doThing");
        expect(catalog.unknown).toBe(true);
        const markup = renderToStaticMarkup(
            <BlueprintFlowNode
                {...({
                    selected: false,
                    data: {
                        catalog,
                        nodeId: "mystery",
                        params: {},
                    },
                } as any)}
            />,
        );
        expect(markup).toContain("Unknown node");
        expect(markup).toContain("com.example.plugin.doThing");
        expect(markup).toContain("border-dashed");
    });

    /**
     * An Element card whose element the editor cannot find. It used to print the id it holds in place
     * of the name - a UUID on the canvas - over a placeholder asking the author to pick an element, so
     * a broken reference read as an unbound one with a stray id on it.
     */
    it("draws an Element card it cannot resolve as missing, and never prints the id it holds", () => {
        const elementId = "4dafd6a8-af4b-433b-9572-02fa59295531";
        const markup = renderElementCard({ surfaceId: "component:slot", elementId, elementType: "nl.text" });

        expect(markup).toContain("Missing element");
        expect(markup).not.toContain(elementId);
        expect(markup).not.toContain("Select element</div>");
    });

    it("still asks for an element on a card that names none", () => {
        const markup = renderElementCard({});

        expect(markup).toContain("Select element");
        expect(markup).not.toContain("Missing element");
    });

    it("names the element and draws its preview on a card that resolves", () => {
        const markup = renderElementCard(
            { surfaceId: "page", elementId: "title", elementType: "nl.text" },
            { revisionKey: "k", name: "Title", type: "nl.text", layout: { width: 10, height: 10 }, preview: <i data-preview="title" /> },
        );

        expect(markup).toContain("Title");
        expect(markup).toContain('data-preview="title"');
        expect(markup).not.toContain("Missing element");
    });
});
