import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { UI_DOCUMENT_SCHEMA_VERSION, type UIDocument, type UIElement } from "@shared/types/ui-editor/document";
import { SliderRenderer } from "./renderer";

function createDocument(): UIDocument {
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

describe("SliderRenderer", () => {
    it("renders internal parts and positions the handle from the mapped value", () => {
        const document = createDocument();
        const element = document.elements.slider as UIElement;
        const renderCalls: {
            childrenIds?: string[];
            elementOverrides?: Record<string, UIElement>;
        }[] = [];

        const markup = renderToStaticMarkup(
            <SliderRenderer
                element={element}
                document={document}
                surface={document.surfaces[0]!}
                hostAdapter={{ host: "app" }}
                renderChildren={options => {
                    renderCalls.push(options ?? {});
                    const ids = options?.childrenIds ?? [];
                    return ids.map(id => {
                        const rendered = options?.elementOverrides?.[id] ?? document.elements[id]!;
                        return <div key={id} data-ui-element-id={id} style={{ left: rendered.layout.x }} />;
                    });
                }}
            />,
        );

        expect(markup).toContain('data-ui-element-id="track"');
        expect(markup).toContain('data-ui-element-id="handle"');
        expect(renderCalls[0]?.childrenIds).toEqual(["track"]);
        expect(renderCalls[1]?.childrenIds).toEqual(["handle"]);
        expect(renderCalls[1]?.elementOverrides?.handle.layout.x).toBe(121);
    });

    it("aligns the handle center with the track value position", () => {
        const document = createDocument();
        const element = {
            ...document.elements.slider!,
            props: {
                ...document.elements.slider!.props,
                value: 0,
            },
        } as UIElement;
        const renderCalls: {
            childrenIds?: string[];
            elementOverrides?: Record<string, UIElement>;
        }[] = [];

        renderToStaticMarkup(
            <SliderRenderer
                element={element}
                document={document}
                surface={document.surfaces[0]!}
                hostAdapter={{ host: "app" }}
                renderChildren={options => {
                    renderCalls.push(options ?? {});
                    return [];
                }}
            />,
        );

        expect(renderCalls[1]?.elementOverrides?.handle.layout.x).toBe(7);
    });
});
