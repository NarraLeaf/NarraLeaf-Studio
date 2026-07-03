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

describe("ContainerRenderer", () => {
    it("applies free layout transforms to chrome and absolute children together", () => {
        const document = createDocument();
        const element = document.elements.container as UIElement;

        const markup = renderToStaticMarkup(
            <ContainerRenderer
                element={element}
                document={document}
                surface={document.surfaces[0]!}
                hostAdapter={{ host: "app" }}
            >
                <span data-child-marker="true">Child</span>
            </ContainerRenderer>,
        );

        expect(markup).toContain("translate(12px, -3px) scale(1.5) rotate(10deg)");
        expect(markup).toContain("data-child-marker=\"true\"");
    });
});
