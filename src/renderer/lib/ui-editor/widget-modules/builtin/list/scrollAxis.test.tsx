// @vitest-environment jsdom
import { cleanup, fireEvent, render } from "@testing-library/react";
import { afterAll, afterEach, beforeAll, expect, it, vi } from "vitest";
import { UI_DOCUMENT_SCHEMA_VERSION, type UIDocument } from "@shared/types/ui-editor/document";
import { WidgetRuntimeStateProvider } from "@/lib/ui-editor/runtime/appearance/WidgetRuntimeStateContext";
import { WidgetRuntimeStateStore } from "@/lib/ui-editor/runtime/appearance/WidgetRuntimeStateStore";
import type { UIHostAdapter } from "@/lib/ui-editor/runtime/types";
import { ListRenderer } from "./renderer";

beforeAll(() => vi.stubGlobal("ResizeObserver", class { observe() {} disconnect() {} }));
afterEach(cleanup);
afterAll(() => vi.unstubAllGlobals());

it("uses the list's scroll axis even when the scrollbar is placed on another side", () => {
    const document: UIDocument = {
        schemaVersion: UI_DOCUMENT_SCHEMA_VERSION, id: "doc", name: "Doc",
        surfaces: [{ id: "page", name: "Page", host: "app", kind: "appSurface", designSize: { width: 200, height: 100 }, rootElementId: "list" }],
        elements: {
            list: {
                id: "list", type: "nl.list", parentId: null, childrenIds: [],
                layout: { x: 0, y: 0, width: 200, height: 100 },
                props: { repeatDirection: "horizontal", scrollbar: { side: "right", enabled: true, visibility: "auto" } },
            },
        },
    };
    const store = new WidgetRuntimeStateStore();
    const dispatch = vi.fn(async () => {});
    const hostAdapter = { host: "app", blueprintRuntime: { surfaceId: "page" } } as unknown as UIHostAdapter;
    const view = render(
        <WidgetRuntimeStateProvider externalStore={store}>
            <ListRenderer element={document.elements.list!} document={document} surface={document.surfaces[0]!} hostAdapter={hostAdapter} dispatchEvent={dispatch} />
        </WidgetRuntimeStateProvider>,
    );
    const viewport = view.container.querySelector<HTMLElement>("[data-ui-list-viewport]")!;
    Object.defineProperties(viewport, {
        clientWidth: { value: 100 }, scrollWidth: { value: 300 },
        clientHeight: { value: 200 }, scrollHeight: { value: 200 },
    });
    viewport.scrollLeft = 50;
    fireEvent.scroll(viewport);

    expect(store.getListScrollMetrics("list")).toEqual({ offset: 50, maxOffset: 200, progress: 0.25 });
    expect(dispatch).toHaveBeenCalledWith("scroll", { offset: 50, maxOffset: 200, progress: 0.25 }, undefined);
    const track = view.container.querySelector<HTMLElement>('[data-ui-list-scrollbar-part="track"]')!;
    expect(track).not.toBeNull();
    const thumb = view.container.querySelector<HTMLElement>('[data-ui-list-scrollbar-part="thumb"]')!;
    expect(thumb.style.height).toBe("64px");
    track.getBoundingClientRect = () => ({ left: 0, top: 0, width: 8, height: 192 } as DOMRect);
    fireEvent.pointerDown(track, { button: 0, clientX: 4, clientY: 180 });
    expect(viewport.scrollLeft).toBeGreaterThan(50);
    expect(viewport.scrollTop).toBe(0);
});
