// @vitest-environment jsdom
import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { UI_DOCUMENT_SCHEMA_VERSION, type UIDocument, type UISurface } from "@shared/types/ui-editor/document";
import type { UIDocumentService } from "@/lib/workspace/services/ui-editor/UIDocumentService";
import type { UIEditorStateService } from "@/lib/workspace/services/ui-editor/UIEditorStateService";
import type { UITool } from "@/lib/ui-editor/editor/types";
import { useSurfaceInteractionEvents, type InsertPreview, type InsertToolDragState } from "./useSurfaceInteractionEvents";

const surface: UISurface = {
    id: "page", name: "Page", host: "app", kind: "appSurface",
    designSize: { width: 800, height: 600 }, rootElementId: "root",
};
const documentModel: UIDocument = {
    schemaVersion: UI_DOCUMENT_SCHEMA_VERSION,
    id: "doc", name: "Doc", surfaces: [surface],
    elements: { root: { id: "root", type: "nl.root", parentId: null, childrenIds: [], layout: { x: 0, y: 0, width: 800, height: 600 } } },
};

let canvas: HTMLDivElement;
beforeEach(() => {
    canvas = document.createElement("div");
    document.body.appendChild(canvas);
});
afterEach(() => {
    cleanup();
    canvas.remove();
});

function pointer(type: string, target: EventTarget, x: number, y: number): void {
    act(() => {
        target.dispatchEvent(new MouseEvent(type, { bubbles: true, button: 0, clientX: x, clientY: y }));
    });
}

function setup() {
    const createElement = vi.fn(() => ({ id: "created" }));
    const documentService = { getDocument: () => documentModel, createElement } as unknown as UIDocumentService;
    const setSnapGuides = vi.fn();
    const stateService = {
        getSelection: () => ({ type: "scene", data: "page" }),
        setSelection: vi.fn(), setUIElementSelection: vi.fn(), setTool: vi.fn(), setSnapGuides,
    } as unknown as UIEditorStateService;
    const insertPreviewRef = { current: null as InsertPreview | null };
    const insertStateRef = { current: null as InsertToolDragState | null };
    const setInsertPreview = vi.fn();
    const panStateRef = { current: { active: false, startX: 0, startY: 0, startOffsetX: 0, startOffsetY: 0 } };
    const tool = { kind: "insert", nodeType: "nl.text" } as UITool;
    const view = renderHook(({ readOnly }) => useSurfaceInteractionEvents({
        surfaceElement: canvas, surfaceId: "page", surface, tool,
        viewport: { scale: 1, offsetX: 0, offsetY: 0 }, selectionData: null,
        clientToSurfaceCoords: (x, y) => ({ x, y }), setInsertPreview,
        insertPreviewRef, insertStateRef, panStateRef, documentService, stateService, readOnly,
    }), { initialProps: { readOnly: { active: false } } });
    return { view, createElement, insertPreviewRef, insertStateRef, setInsertPreview, setSnapGuides };
}

describe("insert gesture lifetime", () => {
    it("inserts on release while the surface stays writable", () => {
        const { createElement } = setup();
        pointer("pointerdown", canvas, 20, 30);
        pointer("pointermove", window, 80, 90);
        pointer("pointerup", window, 80, 90);
        expect(createElement).toHaveBeenCalledOnce();
    });

    it("discards the preview when a pointer gesture is cancelled", () => {
        const { createElement, insertPreviewRef, insertStateRef } = setup();
        pointer("pointerdown", canvas, 20, 30);
        pointer("pointermove", window, 80, 90);
        pointer("pointercancel", window, 80, 90);
        expect(createElement).not.toHaveBeenCalled();
        expect(insertPreviewRef.current).toBeNull();
        expect(insertStateRef.current).toBeNull();
        pointer("pointerup", window, 80, 90);
        expect(createElement).not.toHaveBeenCalled();
        pointer("pointerdown", canvas, 10, 10);
        pointer("pointermove", window, 40, 40);
        pointer("pointerup", window, 40, 40);
        expect(createElement).toHaveBeenCalledOnce();
    });

    it("abandons an unfinished insertion as soon as the surface becomes read-only", () => {
        const { view, createElement, insertPreviewRef, insertStateRef } = setup();
        pointer("pointerdown", canvas, 20, 30);
        pointer("pointermove", window, 80, 90);
        view.rerender({ readOnly: { active: true } });
        expect(insertPreviewRef.current).toBeNull();
        expect(insertStateRef.current).toBeNull();
        pointer("pointerup", window, 80, 90);
        expect(createElement).not.toHaveBeenCalled();
    });
});
