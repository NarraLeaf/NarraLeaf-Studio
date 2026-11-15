// @vitest-environment jsdom
import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { UI_DOCUMENT_SCHEMA_VERSION, type UIDocument } from "@shared/types/ui-editor/document";
import { useMoveableHandlers } from "./useMoveableHandlers";

afterEach(cleanup);

describe("resize snapping after crossing the anchor", () => {
    it.each([
        { direction: [-1, 0], pointer: [110, 0], guide: { x: 212, y: 400 }, axis: "vertical", value: 212, size: "width", extent: "12px", transform: "translate(100px, 0px)" },
        { direction: [1, 0], pointer: [-110, 0], guide: { x: 38, y: 400 }, axis: "vertical", value: 88, size: "width", extent: "12px", transform: "translate(-12px, 0px)" },
        { direction: [0, -1], pointer: [0, 60], guide: { x: 400, y: 162 }, axis: "horizontal", value: 162, size: "height", extent: "12px", transform: "translate(0px, 50px)" },
        { direction: [0, 1], pointer: [0, -60], guide: { x: 400, y: 38 }, axis: "horizontal", value: 88, size: "height", extent: "12px", transform: "translate(0px, -12px)" },
        { direction: [-1, 0], pointer: [110, 0], guide: { x: 212, y: 400 }, axis: "vertical", value: 212, size: "width", extent: "12px", transform: "translate(100px, 22px)", locked: true },
    ])("snaps the moving edge after crossing in direction $direction", ({ direction, pointer, guide, axis, value, size, extent, transform, locked }) => {
        const doc: UIDocument = {
            schemaVersion: UI_DOCUMENT_SCHEMA_VERSION,
            id: "doc", name: "Doc",
            surfaces: [{ id: "surface", name: "Surface", host: "app", kind: "appSurface", designSize: { width: 800, height: 600 }, rootElementId: "root" }],
            elements: {
                root: { id: "root", type: "nl.root", parentId: null, childrenIds: ["box", "guide"], layout: { x: 0, y: 0, width: 800, height: 600 } },
                box: { id: "box", type: "nl.container", parentId: "root", childrenIds: [], layout: { x: 100, y: 100, width: 100, height: 50, lockAspectRatio: locked } },
                guide: { id: "guide", type: "nl.container", parentId: "root", childrenIds: [], layout: { ...guide, width: 50, height: 50 } },
            },
        };
        const target = document.createElement("div");
        target.dataset.uiElementId = "box";
        const setGuides = vi.fn();
        const view = renderHook(() => useMoveableHandlers({
            documentService: { getDocument: () => doc } as never,
            selectionIds: ["box"], selectedTargets: [target], isGroupSelection: false,
            viewportScale: 1, scheduleMoveableRectUpdate: vi.fn(), beginTransform: vi.fn(), endTransform: vi.fn(),
            smartSnap: {
                surfaceId: "surface", designSize: { width: 800, height: 600 },
                isEnabled: () => true, isSuspended: () => false, setGuides,
                getExcludedElementIds: () => new Set(["box"]),
                getDetailSettings: () => ({ snapElementLayout: true, snapElementBorder: true, snapCanvasLayout: true, snapGrid: false }),
                getGridSpacing: () => null,
            },
        }));

        act(() => view.result.current.handleResizeStart({ clientX: 0, clientY: 0, direction } as never));
        act(() => view.result.current.handleResize({ clientX: pointer[0], clientY: pointer[1], target } as never));

        expect(target.style.getPropertyValue(size)).toBe(extent);
        expect(target.style.transform).toBe(transform);
        expect(setGuides).toHaveBeenLastCalledWith(expect.objectContaining({
            [axis]: [{ value, kind: "element-edge" }],
        }));
    });
});
