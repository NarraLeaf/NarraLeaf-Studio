import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { UI_DOCUMENT_SCHEMA_VERSION, type UIDocument, type UIElement } from "@shared/types/ui-editor/document";
import { UI_FRAME_ELEMENT_TYPE } from "@shared/types/ui-editor/frame";
import { FrameRenderer } from "./renderer";

function createDocument(): UIDocument {
    return {
        schemaVersion: UI_DOCUMENT_SCHEMA_VERSION,
        id: "doc",
        name: "Doc",
        surfaces: [
            {
                id: "host-page",
                name: "Host",
                host: "app",
                kind: "appSurface",
                designSize: { width: 320, height: 180 },
                rootElementId: "host-root",
            },
            {
                id: "target-page",
                name: "Target",
                host: "app",
                kind: "appSurface",
                designSize: { width: 1000, height: 600 },
                rootElementId: "target-root",
            },
        ],
        elements: {
            "host-root": {
                id: "host-root",
                type: "nl.root",
                parentId: null,
                childrenIds: ["frame"],
                layout: { x: 0, y: 0, width: 320, height: 180 },
            },
            frame: {
                id: "frame",
                type: UI_FRAME_ELEMENT_TYPE,
                parentId: "host-root",
                childrenIds: [],
                layout: { x: 0, y: 0, width: 320, height: 180 },
                props: {
                    targetSurfaceId: "target-page",
                    params: {},
                    navigationMode: "static",
                },
            },
            "target-root": {
                id: "target-root",
                type: "nl.root",
                parentId: null,
                childrenIds: [],
                layout: { x: 0, y: 0, width: 1000, height: 600 },
            },
        },
    };
}

describe("FrameRenderer", () => {
    it("fills the frame box instead of letterboxing mismatched target Page ratios", () => {
        const document = createDocument();
        const element = document.elements.frame as UIElement;
        const markup = renderToStaticMarkup(
            <FrameRenderer
                element={element}
                document={document}
                surface={document.surfaces[0]!}
                hostAdapter={{ host: "app" }}
                renderSurface={() => <div>Target Page</div>}
            />,
        );

        expect(markup).toContain("Target Page");
        expect(markup).toContain("background:transparent");
        expect(markup).toContain("top:-6px");
        expect(markup).toContain("transform:scale(0.32)");
    });
});
