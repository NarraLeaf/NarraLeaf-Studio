// @vitest-environment jsdom
import { cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { UISurface } from "@shared/types/ui-editor/document";
import type { UIDocumentService } from "@/lib/workspace/services/ui-editor/UIDocumentService";
import type { UIEditorStateService } from "@/lib/workspace/services/ui-editor/UIEditorStateService";
import { GESTURE_DEADZONE_PX } from "./gestureDeadzone";
import { useSurfaceInteractionEvents } from "./useSurfaceInteractionEvents";

/**
 * A press inside the frame of a selected element that a clipping container hides is given to the
 * selection's drag (`pressLandsOnClippedSelection`), so that an element dragged past the container's
 * edge can be dragged back. Only the drag is new: the same press released where it went down is the
 * click it always was, which on empty canvas puts the page in the properties panel.
 */

const surface = { id: "title", name: "Title", kind: "page", designSize: { width: 1920, height: 1080 } } as unknown as UISurface;

let surfaceElement: HTMLDivElement;
let stateService: UIEditorStateService & { setSelection: ReturnType<typeof vi.fn> };

function press(type: "pointerdown" | "pointerup", target: EventTarget, x: number, y: number) {
    target.dispatchEvent(new MouseEvent(type, { bubbles: true, clientX: x, clientY: y, button: 0 }));
}

function renderCanvas(pressDragsClippedSelection?: (event: PointerEvent) => boolean) {
    return renderHook(() =>
        useSurfaceInteractionEvents({
            surfaceElement,
            surfaceId: surface.id,
            surface,
            tool: { kind: "select" },
            viewport: { scale: 1, offsetX: 0, offsetY: 0 },
            selectionData: { editor: "ui", surfaceId: surface.id, elementIds: ["title-text"], primaryId: "title-text" },
            clientToSurfaceCoords: (x, y) => ({ x, y }),
            setInsertPreview: () => {},
            insertPreviewRef: { current: null },
            insertStateRef: { current: null },
            panStateRef: { current: { active: false, startX: 0, startY: 0, startOffsetX: 0, startOffsetY: 0 } },
            documentService: { getDocument: () => ({ elements: {} }) } as unknown as UIDocumentService,
            stateService,
            pressDragsClippedSelection,
        }),
    );
}

beforeEach(() => {
    vi.useFakeTimers();
    surfaceElement = document.createElement("div");
    document.body.appendChild(surfaceElement);
    const selection = { type: "ui-element", data: { surfaceId: surface.id, elementIds: ["title-text"] } };
    stateService = {
        getSelection: () => selection,
        setSelection: vi.fn(),
        setSnapGuides: vi.fn(),
    } as unknown as typeof stateService;
});

afterEach(() => {
    cleanup();
    surfaceElement.remove();
    vi.useRealTimers();
});

describe("a press on a clipped selection's frame", () => {
    it("on empty canvas, outside any frame, selects the page straight away", () => {
        renderCanvas(() => false);
        press("pointerdown", surfaceElement, 300, 700);
        expect(stateService.setSelection).toHaveBeenCalledWith({ type: "scene", data: surface.id });
    });

    it("leaves the selection alone while it may still become a drag", () => {
        renderCanvas(() => true);
        press("pointerdown", surfaceElement, 300, 700);
        vi.runAllTimers();
        expect(stateService.setSelection).not.toHaveBeenCalled();
    });

    it("is still a click when released where it went down", () => {
        renderCanvas(() => true);
        press("pointerdown", surfaceElement, 300, 700);
        press("pointerup", window, 301, 701);
        // After the mouseup that ends Moveable's drag, not before it.
        expect(stateService.setSelection).not.toHaveBeenCalled();
        vi.runAllTimers();
        expect(stateService.setSelection).toHaveBeenCalledWith({ type: "scene", data: surface.id });
    });

    it("is a drag, and selects nothing, once it travels past the deadzone", () => {
        renderCanvas(() => true);
        press("pointerdown", surfaceElement, 300, 700);
        press("pointerup", window, 300, 700 - GESTURE_DEADZONE_PX - 300);
        vi.runAllTimers();
        expect(stateService.setSelection).not.toHaveBeenCalled();
    });
});
