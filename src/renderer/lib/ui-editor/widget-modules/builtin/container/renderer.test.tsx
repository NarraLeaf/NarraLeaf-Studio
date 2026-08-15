import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { UI_DOCUMENT_SCHEMA_VERSION, type UIDocument, type UIElement } from "@shared/types/ui-editor/document";
import { defaultContainerWidgetProps } from "@shared/types/ui-editor/container";
import { ContainerRenderer } from "./renderer";

vi.mock("@/apps/workspace/modules/properties/framework/utils/colorUtils", () => ({
    parseColorValue: (_raw: string | undefined, fallback: { hex: string; alpha?: number }) => fallback,
    colorValueToCss: (value: { hex: string; alpha?: number }) => value.hex,
}));

vi.mock("@/lib/workspace/hooks/useAssetObjectUrl", () => ({
    useAssetObjectUrl: () => ({ url: null, metadata: null, loading: false, error: null }),
}));

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
                childrenIds: ["container"],
                layout: { x: 0, y: 0, width: 320, height: 180 },
            },
            container: {
                id: "container",
                type: "nl.container",
                parentId: "root",
                childrenIds: ["child"],
                layout: { x: 0, y: 0, width: 100, height: 80 },
                props: {
                    ...defaultContainerWidgetProps,
                    layoutKind: "free",
                    transformOffsetX: 12,
                    transformOffsetY: -3,
                    transformScale: 1.5,
                    transformRotation: 10,
                },
            },
            child: {
                id: "child",
                type: "test.child",
                parentId: "container",
                childrenIds: [],
                layout: { x: 8, y: 8, width: 20, height: 20 },
            },
        },
    };
}

function renderContainer(document: UIDocument): string {
    const element = document.elements.container as UIElement;
    return renderToStaticMarkup(
        <ContainerRenderer
            element={element}
            document={document}
            surface={document.surfaces[0]!}
            hostAdapter={{ host: "app" }}
        >
            <span data-child-marker="true">Child</span>
        </ContainerRenderer>,
    );
}

describe("ContainerRenderer", () => {
    it("applies free layout transforms to chrome and absolute children together", () => {
        const markup = renderContainer(createDocument());

        expect(markup).toContain("translate(12px, -3px) scale(1.5) rotate(10deg)");
        expect(markup).toContain("data-child-marker=\"true\"");
    });

    it("paints a plain colour fill on the chrome root, with no fill layer", () => {
        const markup = renderContainer(createDocument());

        // The common case costs no extra DOM: no layer, and no stacking context forced on the root.
        expect(markup).not.toContain("data-ui-fill-layer");
        expect(markup).not.toContain("isolation:isolate");
    });

    it("paints a gradient fill on a layer, beneath the children", () => {
        const document = createDocument();
        const container = document.elements.container as UIElement;
        container.props = {
            ...container.props,
            fillType: "gradient",
            gradientFill: {
                kind: "linear",
                angle: 90,
                stops: [
                    { offset: 0, color: "#ff0000" },
                    { offset: 1, color: "#0000ff" },
                ],
            },
        };

        const markup = renderContainer(document);

        expect(markup).toContain("data-ui-fill-layer=\"current\"");
        expect(markup).toContain("data-ui-fill-layer-kind=\"gradient\"");
        // The stacking rule, asserted at the widget level too: an absolutely positioned layer paints
        // above in-flow children whatever the DOM order, so it takes a negative z-index inside a root
        // that is a stacking context. Either half alone puts the fill over the children, or behind an
        // ancestor.
        expect(markup).toContain("z-index:-1");
        expect(markup).toContain("isolation:isolate");
        expect(markup).toContain("data-child-marker=\"true\"");
    });
});
