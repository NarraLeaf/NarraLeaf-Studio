// @vitest-environment jsdom
import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { UI_DOCUMENT_SCHEMA_VERSION, type UIDocument, type UIElement } from "@shared/types/ui-editor/document";
import { UIRuntimeBridgeService } from "@/lib/workspace/services/ui-editor/UIRuntimeBridgeService";
import { GAME_UI_REFERENCE_OPACITY, SurfaceReferenceLayer } from "./SurfaceReferenceLayer";

function element(id: string, type: string, parentId: string | null, childrenIds: string[]): UIElement {
    return {
        id,
        type,
        name: id,
        parentId,
        childrenIds,
        layout: { x: 40, y: 900, width: 200, height: 60, visible: true, opacity: 1 },
    };
}

const quickMenuDocument: UIDocument = {
    schemaVersion: UI_DOCUMENT_SCHEMA_VERSION,
    id: "doc",
    name: "doc",
    surfaces: [
        {
            id: "quick-menu",
            name: "Quick menu",
            host: "player",
            kind: "stageSurface",
            designSize: { width: 1920, height: 1080 },
            rootElementId: "root",
            mount: { kind: "slot", slotId: "onStage" },
        },
    ],
    elements: {
        root: { ...element("root", "nl.root", null, ["bar"]), layout: { x: 0, y: 0, width: 1920, height: 1080 } },
        bar: element("bar", "nl.container", "root", ["save"]),
        save: element("save", "nl.button", "bar", []),
    },
    meta: {},
} as unknown as UIDocument;

/** The real bridge, reading a fixed document - what the canvas hands the layer. */
function bridgeFor(document: UIDocument): UIRuntimeBridgeService {
    const bridge = new (UIRuntimeBridgeService as unknown as new () => UIRuntimeBridgeService)();
    (bridge as unknown as { documentService: { getDocument(): UIDocument } }).documentService = {
        getDocument: () => document,
    };
    return bridge;
}

afterEach(() => {
    cleanup();
});

describe("SurfaceReferenceLayer", () => {
    it("draws the surface faintly, out of reach of every editor gesture", () => {
        const { container } = render(
            <SurfaceReferenceLayer
                runtimeBridge={bridgeFor(quickMenuDocument)}
                slotId="onStage"
                surfaceId="quick-menu"
                contentRevision={1}
                brandRevision={0}
            />,
        );
        const layer = container.querySelector<HTMLElement>("[data-surface-reference-layer]");
        expect(layer?.getAttribute("data-surface-reference-layer")).toBe("onStage");
        // Out of hit testing as a whole; the widget wrappers inside set pointer-events back on.
        expect(layer?.hasAttribute("inert")).toBe(true);
        expect(layer?.getAttribute("aria-hidden")).toBe("true");
        expect(layer?.style.opacity).toBe(String(GAME_UI_REFERENCE_OPACITY));

        // Drawn - the frame and the elements are there ...
        expect(layer?.querySelector("[data-ui-surface-id=\"quick-menu\"]")).not.toBeNull();
        expect(layer?.querySelectorAll(".ui-editor-node-preview").length).toBeGreaterThanOrEqual(3);
        // ... without anything the selection tools, hover or the inspector look for.
        expect(layer?.querySelector("[data-ui-element-id]")).toBeNull();
        expect(layer?.querySelector(".ui-editor-node")).toBeNull();
    });

    it("rebuilds only when its own surface's content moves", () => {
        const renderSurface = vi.fn(() => <div data-probe="" />);
        const bridge = { renderSurface };
        const props = { runtimeBridge: bridge, slotId: "onStage" as const, surfaceId: "quick-menu", brandRevision: 0 };
        const { rerender } = render(<SurfaceReferenceLayer {...props} contentRevision={1} />);
        expect(renderSurface).toHaveBeenCalledTimes(1);

        // The canvas redraws on every edit to the surface being edited; this one stays.
        rerender(<SurfaceReferenceLayer {...props} contentRevision={1} />);
        expect(renderSurface).toHaveBeenCalledTimes(1);

        rerender(<SurfaceReferenceLayer {...props} contentRevision={2} />);
        expect(renderSurface).toHaveBeenCalledTimes(2);

        rerender(<SurfaceReferenceLayer {...props} contentRevision={2} brandRevision={1} />);
        expect(renderSurface).toHaveBeenCalledTimes(3);
        expect(renderSurface).toHaveBeenLastCalledWith(expect.objectContaining({ editorChrome: false }));
    });
});
