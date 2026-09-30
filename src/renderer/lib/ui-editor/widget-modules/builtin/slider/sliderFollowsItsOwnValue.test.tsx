// @vitest-environment jsdom
/**
 * A slider keeps its value in the widget runtime store, beside every other widget's hover, press and
 * focus. It must draw again when its own value moves - and only then: it used to follow the whole
 * store, so on a page of sliders every pointer movement redrew all of them and every part each one
 * places.
 */
import { act, cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { UI_DOCUMENT_SCHEMA_VERSION, type UIDocument, type UIElement } from "@shared/types/ui-editor/document";
import { WidgetRuntimeStateProvider } from "@/lib/ui-editor/runtime/appearance/WidgetRuntimeStateContext";
import { WidgetRuntimeStateStore } from "@/lib/ui-editor/runtime/appearance/WidgetRuntimeStateStore";
import { SliderRenderer } from "./renderer";

afterEach(() => cleanup());

function sliderDocument(): UIDocument {
    return {
        schemaVersion: UI_DOCUMENT_SCHEMA_VERSION,
        id: "doc",
        name: "Doc",
        surfaces: [
            {
                id: "surface",
                name: "Surface",
                host: "app",
                kind: "appSurface",
                designSize: { width: 320, height: 180 },
                rootElementId: "root",
            },
        ],
        elements: {
            root: {
                id: "root",
                type: "nl.root",
                parentId: null,
                childrenIds: ["slider"],
                layout: { x: 0, y: 0, width: 320, height: 180 },
            },
            slider: {
                id: "slider",
                type: "nl.slider",
                parentId: "root",
                childrenIds: ["track", "handle"],
                layout: { x: 0, y: 0, width: 260, height: 40 },
                props: {
                    value: 50,
                    min: 0,
                    max: 100,
                    step: 1,
                    orientation: "horizontal",
                    trackElementId: "track",
                    handleElementId: "handle",
                },
            },
            track: {
                id: "track",
                type: "nl.container",
                parentId: "slider",
                childrenIds: [],
                extra: { sliderSlot: "track" },
                layout: { x: 16, y: 17, width: 228, height: 6 },
            },
            handle: {
                id: "handle",
                type: "nl.container",
                parentId: "slider",
                childrenIds: [],
                extra: { sliderSlot: "handle" },
                layout: { x: 16, y: 9, width: 18, height: 22 },
            },
        },
    };
}

describe("a slider and the runtime store", () => {
    it("draws again for its own value, and not for a hover or focus anywhere else", () => {
        const document = sliderDocument();
        const element = document.elements.slider as UIElement;
        const store = new WidgetRuntimeStateStore();
        const handleDraws: number[] = [];
        render(
            <WidgetRuntimeStateProvider externalStore={store}>
                <SliderRenderer
                    element={element}
                    document={document}
                    surface={document.surfaces[0]!}
                    hostAdapter={{ host: "app" }}
                    renderChildren={options => {
                        const handle = options?.elementOverrides?.handle;
                        if (handle) {
                            handleDraws.push(handle.layout.x);
                        }
                        return [];
                    }}
                />
            </WidgetRuntimeStateProvider>,
        );
        const mounted = handleDraws.length;
        expect(handleDraws[mounted - 1]).toBe(121);

        act(() => {
            store.setHoverTarget("elsewhere");
            store.setActivePointerTarget("elsewhere");
            store.setFocusedTarget("elsewhere");
        });
        expect(handleDraws.length).toBe(mounted);

        act(() => {
            store.setSliderProperties("slider", element.props ?? {}, { value: 0 });
        });
        expect(handleDraws.length).toBe(mounted + 1);
        expect(handleDraws[handleDraws.length - 1]).toBe(7);
    });
});
