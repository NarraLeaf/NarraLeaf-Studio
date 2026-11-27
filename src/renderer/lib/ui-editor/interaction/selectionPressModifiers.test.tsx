// @vitest-environment jsdom
/**
 * What a press with Cmd/Ctrl or Shift does to the selection on the canvas.
 *
 * Cmd/Ctrl selects the deepest element under the pointer in one press - past the outermost-frame
 * pick and the one-level-per-double-click drill. Shift adds or takes away, at the level the selection
 * is already at, so a panel and its own button never end up in one selection.
 */
import { cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { UI_DOCUMENT_SCHEMA_VERSION, type UIDocument, type UIElement, type UISurface } from "@shared/types/ui-editor/document";
import type { UIElementSelection } from "@shared/types/ui-editor/selection";
import type { UIDocumentService } from "@/lib/workspace/services/ui-editor/UIDocumentService";
import type { UIEditorStateService } from "@/lib/workspace/services/ui-editor/UIEditorStateService";
import { useSurfaceInteractionEvents } from "./useSurfaceInteractionEvents";

function element(id: string, type: string, parentId: string | null, childrenIds: string[] = []): UIElement {
    return { id, type, parentId, childrenIds, layout: { x: 0, y: 0, width: 100, height: 100 } } as UIElement;
}

const surface = { id: "page", name: "Page", host: "app", kind: "appSurface", designSize: { width: 1920, height: 1080 }, rootElementId: "root" } as unknown as UISurface;
const document_: UIDocument = {
    schemaVersion: UI_DOCUMENT_SCHEMA_VERSION,
    id: "doc",
    name: "Doc",
    surfaces: [surface],
    elements: {
        root: element("root", "nl.root", null, ["panel"]),
        panel: element("panel", "nl.container", "root", ["start", "quit"]),
        start: element("start", "nl.container", "panel", ["startLabel"]),
        startLabel: element("startLabel", "nl.text", "start"),
        quit: element("quit", "nl.container", "panel"),
    },
} as unknown as UIDocument;

let surfaceElement: HTMLDivElement;
let nodes: Record<string, HTMLElement>;
let setUIElementSelection: ReturnType<typeof vi.fn>;

/** The canvas drawn as the editor draws it: one `.ui-editor-node` per element, nested like the tree. */
function drawCanvas(): void {
    nodes = {};
    const draw = (id: string, parent: HTMLElement) => {
        const node = document.createElement("div");
        node.className = id === "root" ? "ui-editor-node ui-editor-node-root" : "ui-editor-node";
        node.dataset.uiElementId = id;
        parent.appendChild(node);
        nodes[id] = node;
        for (const child of document_.elements[id].childrenIds) {
            draw(child, node);
        }
    };
    draw("root", surfaceElement);
}

function renderCanvas(selection: UIElementSelection | null) {
    return renderHook(() =>
        useSurfaceInteractionEvents({
            surfaceElement,
            surfaceId: surface.id,
            surface,
            tool: { kind: "select" },
            viewport: { scale: 1, offsetX: 0, offsetY: 0 },
            selectionData: selection,
            clientToSurfaceCoords: (x, y) => ({ x, y }),
            setInsertPreview: () => {},
            insertPreviewRef: { current: null },
            insertStateRef: { current: null },
            panStateRef: { current: { active: false, startX: 0, startY: 0, startOffsetX: 0, startOffsetY: 0 } },
            documentService: { getDocument: () => document_ } as unknown as UIDocumentService,
            stateService: {
                setUIElementSelection,
                setSelection: vi.fn(),
                setSnapGuides: vi.fn(),
                getViewportTransform: () => ({ scale: 1, offsetX: 0, offsetY: 0 }),
            } as unknown as UIEditorStateService,
        }),
    );
}

function pressOn(id: string, modifiers: { metaKey?: boolean; ctrlKey?: boolean; shiftKey?: boolean } = {}) {
    nodes[id].dispatchEvent(new MouseEvent("pointerdown", { bubbles: true, button: 0, ...modifiers }));
}

function selected(...ids: string[]): UIElementSelection {
    return { editor: "ui", surfaceId: surface.id, elementIds: ids, primaryId: ids[ids.length - 1] };
}

beforeEach(() => {
    surfaceElement = document.createElement("div");
    document.body.appendChild(surfaceElement);
    drawCanvas();
    setUIElementSelection = vi.fn();
});

afterEach(() => {
    cleanup();
    surfaceElement.remove();
});

describe("a plain press", () => {
    it("still picks the outermost frame", () => {
        renderCanvas(null);
        pressOn("startLabel");
        expect(setUIElementSelection).toHaveBeenCalledWith(selected("panel"));
    });
});

describe("Cmd/Ctrl press", () => {
    it("selects the deepest element under the pointer in one press", () => {
        renderCanvas(null);
        pressOn("startLabel", { metaKey: true });
        expect(setUIElementSelection).toHaveBeenCalledWith(selected("startLabel"));
    });

    it("replaces the selection rather than toggling into it", () => {
        renderCanvas(selected("quit"));
        pressOn("startLabel", { ctrlKey: true });
        expect(setUIElementSelection).toHaveBeenCalledWith(selected("startLabel"));
    });
});

describe("Shift press", () => {
    it("adds the element at the selection's level", () => {
        renderCanvas(selected("quit"));
        pressOn("startLabel", { shiftKey: true });
        expect(setUIElementSelection).toHaveBeenCalledWith(selected("quit", "start"));
    });

    it("takes a selected element away again - on release, so Shift-dragging the selection still moves it", () => {
        vi.useFakeTimers();
        try {
            renderCanvas(selected("quit", "start"));
            pressOn("startLabel", { shiftKey: true });
            expect(setUIElementSelection).not.toHaveBeenCalled();
            window.dispatchEvent(new MouseEvent("pointerup", { bubbles: true, button: 0 }));
            vi.runAllTimers();
            expect(setUIElementSelection).toHaveBeenCalledWith(selected("quit"));
        } finally {
            vi.useRealTimers();
        }
    });

    it("leaves the selection alone when a Shift press on it becomes a drag", () => {
        vi.useFakeTimers();
        try {
            renderCanvas(selected("quit", "start"));
            pressOn("startLabel", { shiftKey: true });
            window.dispatchEvent(new MouseEvent("pointerup", { bubbles: true, button: 0, clientX: 200, clientY: 0 }));
            vi.runAllTimers();
            expect(setUIElementSelection).not.toHaveBeenCalled();
        } finally {
            vi.useRealTimers();
        }
    });

    it("with Cmd/Ctrl too, adds the deepest element", () => {
        renderCanvas(selected("quit"));
        pressOn("startLabel", { shiftKey: true, metaKey: true });
        expect(setUIElementSelection).toHaveBeenCalledWith(selected("quit", "startLabel"));
    });
});
