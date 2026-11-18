// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { UI_DOCUMENT_SCHEMA_VERSION, type UIDocument } from "@shared/types/ui-editor/document";
import { WidgetRuntimeStateProvider } from "@/lib/ui-editor/runtime/appearance/WidgetRuntimeStateContext";
import { WidgetRuntimeStateStore } from "@/lib/ui-editor/runtime/appearance/WidgetRuntimeStateStore";
import type { UIHostAdapter } from "@/lib/ui-editor/runtime/types";
import type { UIWidgetEventDispatch } from "@/lib/ui-editor/runtime/widgetEventDispatch";
import { SliderRenderer } from "./renderer";

afterEach(cleanup);

function mountSlider(dispatch: UIWidgetEventDispatch, interactionDisabled = false) {
    const document: UIDocument = {
        schemaVersion: UI_DOCUMENT_SCHEMA_VERSION,
        id: "doc",
        name: "Doc",
        surfaces: [{ id: "page", name: "Page", host: "app", kind: "appSurface", designSize: { width: 200, height: 50 }, rootElementId: "slider" }],
        elements: {
            slider: {
                id: "slider", type: "nl.slider", parentId: null, childrenIds: [],
                layout: { x: 0, y: 0, width: 200, height: 50 },
                props: { value: 50, min: 0, max: 100, step: 1, interactionDisabled },
            },
        },
    };
    const store = new WidgetRuntimeStateStore();
    const hostAdapter = { host: "app", blueprintRuntime: { surfaceId: "page" } } as unknown as UIHostAdapter;
    const view = render(
        <WidgetRuntimeStateProvider externalStore={store}>
            <SliderRenderer
                element={document.elements.slider!}
                document={document}
                surface={document.surfaces[0]!}
                hostAdapter={hostAdapter}
                dispatchEvent={dispatch}
            />
        </WidgetRuntimeStateProvider>,
    );
    const slider = view.container.firstElementChild as HTMLElement;
    slider.getBoundingClientRect = () => ({ left: 0, top: 0, width: 200, height: 50 } as DOMRect);
    return { store, view, slider };
}

describe("slider gesture lifetime", () => {
    it("does not change value when a blueprint disables interaction", async () => {
        const dispatch = vi.fn(async () => {});
        const { store, slider } = mountSlider(dispatch, true);
        await act(async () => {
            fireEvent.pointerDown(slider, { button: 0, clientX: 180, clientY: 25 });
            fireEvent.pointerUp(window);
        });
        expect(store.getSliderProperties("slider")).toBeUndefined();
        expect(dispatch).not.toHaveBeenCalled();
    });

    it("stops the drag when its surface unmounts", async () => {
        const dispatch = vi.fn(async () => {});
        const { store, view, slider } = mountSlider(dispatch);
        await act(async () => {
            fireEvent.pointerDown(slider, { button: 0, clientX: 100, clientY: 25 });
        });
        expect(dispatch).toHaveBeenCalledWith("dragStart", { value: 50 }, undefined);
        const valueBeforeUnmount = store.getSliderProperties("slider");
        view.unmount();
        dispatch.mockClear();

        await act(async () => {
            fireEvent.pointerMove(window, { clientX: 180, clientY: 25 });
            fireEvent.pointerUp(window, { clientX: 180, clientY: 25 });
        });
        expect(dispatch).not.toHaveBeenCalled();
        expect(store.getSliderProperties("slider")).toEqual(valueBeforeUnmount);
    });

    it("does not dispatch a drag start after an immediate unmount", async () => {
        const dispatch = vi.fn(async () => {});
        const { view, slider } = mountSlider(dispatch);
        await act(async () => {
            fireEvent.pointerDown(slider, { button: 0, clientX: 100, clientY: 25 });
            view.unmount();
        });
        expect(dispatch).not.toHaveBeenCalled();
    });

    it("keeps a value change after release while drag-start handlers are still running", async () => {
        let finishStart!: () => void;
        const startFinished = new Promise<void>(resolve => { finishStart = resolve; });
        const dispatch = vi.fn((event: string) => event === "dragStart" ? startFinished : Promise.resolve());
        const { slider } = mountSlider(dispatch);
        await act(async () => {
            fireEvent.pointerDown(slider, { button: 0, clientX: 180, clientY: 25 });
        });
        fireEvent.pointerUp(window);
        await act(async () => finishStart());
        await waitFor(() => expect(dispatch).toHaveBeenCalledWith("valueChanged", { value: 90, previousValue: 50 }, undefined));
    });
});
