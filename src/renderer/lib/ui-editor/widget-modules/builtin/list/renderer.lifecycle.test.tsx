// @vitest-environment jsdom
import { cleanup, fireEvent, render } from "@testing-library/react";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { UI_DOCUMENT_SCHEMA_VERSION, type UIDocument } from "@shared/types/ui-editor/document";
import { ListRenderer } from "./renderer";

beforeAll(() => {
    vi.stubGlobal("ResizeObserver", class {
        observe() {}
        disconnect() {}
    });
});
afterEach(() => {
    cleanup();
    document.body.style.userSelect = "";
    document.body.style.cursor = "";
    vi.restoreAllMocks();
});
afterAll(() => vi.unstubAllGlobals());

function mountList() {
    const doc: UIDocument = {
        schemaVersion: UI_DOCUMENT_SCHEMA_VERSION,
        id: "doc", name: "Doc",
        surfaces: [{ id: "page", name: "Page", host: "app", kind: "appSurface", designSize: { width: 200, height: 100 }, rootElementId: "list" }],
        elements: {
            list: {
                id: "list", type: "nl.list", parentId: null, childrenIds: [],
                layout: { x: 0, y: 0, width: 200, height: 100 },
                props: { dragContentScroll: true, scrollbar: { enabled: true, visibility: "always" } },
            },
        },
    };
    const view = render(<ListRenderer element={doc.elements.list!} document={doc} surface={doc.surfaces[0]!} hostAdapter={{ host: "app" }} />);
    const viewport = view.container.querySelector<HTMLElement>("[data-ui-list-viewport]")!;
    Object.defineProperties(viewport, { clientHeight: { value: 100 }, scrollHeight: { value: 300 } });
    return { view, viewport };
}

describe("list gesture lifetime", () => {
    it("restores the pointer style when the list unmounts during content dragging", () => {
        document.body.style.userSelect = "text";
        document.body.style.cursor = "crosshair";
        const { view, viewport } = mountList();
        fireEvent.pointerDown(viewport, { button: 0, clientX: 20, clientY: 50 });
        fireEvent.pointerMove(window, { clientX: 20, clientY: 30 });
        expect(document.body.style.userSelect).toBe("none");
        expect(document.body.style.cursor).toBe("grabbing");

        view.unmount();
        expect(document.body.style.userSelect).toBe("text");
        expect(document.body.style.cursor).toBe("crosshair");
    });

    it("removes the scrollbar drag listener when the list unmounts", () => {
        const add = vi.spyOn(window, "addEventListener");
        const remove = vi.spyOn(window, "removeEventListener");
        const { view } = mountList();
        const thumb = view.container.querySelector<HTMLElement>('[data-ui-list-scrollbar-part="thumb"]')!;
        fireEvent.pointerDown(thumb, { button: 0, clientX: 20, clientY: 50 });
        const move = add.mock.calls.find(call => call[0] === "pointermove")?.[1];
        expect(move).toBeDefined();

        view.unmount();
        expect(remove).toHaveBeenCalledWith("pointermove", move);
    });
});
