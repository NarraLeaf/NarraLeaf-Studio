import { describe, expect, it, vi } from "vitest";
import { UI_DOCUMENT_SCHEMA_VERSION, type UIDocument } from "@shared/types/ui-editor/document";
import { UI_FRAME_ELEMENT_TYPE } from "@shared/types/ui-editor/frame";
import { createFrameFloatingToolbarItems } from "./frame/floatingToolbar";

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
                name: "Settings",
                host: "app",
                kind: "appSurface",
                designSize: { width: 320, height: 180 },
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
                layout: { x: 0, y: 0, width: 320, height: 180 },
            },
        },
    };
}

describe("FrameWidgetModule floating toolbar", () => {
    it("adds a Share action that opens the target Page editor", () => {
        const document = createDocument();
        const openSurfaceEditor = vi.fn();
        const items = createFrameFloatingToolbarItems({
            element: document.elements.frame!,
            documentService: { getDocument: () => document } as any,
            surfaceId: "host-page",
            openSurfaceEditor,
        });

        expect(items).toHaveLength(1);
        const item = items[0]!;
        expect(item).toMatchObject({
            kind: "button",
            id: "frame.open-target-page",
            tooltip: "Open Settings",
        });

        item.onClick();
        expect(openSurfaceEditor).toHaveBeenCalledWith("target-page");
    });
});
