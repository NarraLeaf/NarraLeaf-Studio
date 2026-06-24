import { describe, expect, it } from "vitest";
import { UI_DOCUMENT_SCHEMA_VERSION, type UIDocument, type UIElement } from "./document";
import { UI_FRAME_ELEMENT_TYPE, getUIFrameTargetInvalidReason, normalizeUIFrameWidgetProps } from "./frame";

function root(id: string, childrenIds: string[] = []): UIElement {
    return {
        id,
        type: "nl.root",
        parentId: null,
        childrenIds,
        layout: { x: 0, y: 0, width: 320, height: 180 },
    };
}

function frame(id: string, parentId: string, targetSurfaceId: string | null): UIElement {
    return {
        id,
        type: UI_FRAME_ELEMENT_TYPE,
        parentId,
        childrenIds: [],
        layout: { x: 0, y: 0, width: 160, height: 90 },
        props: normalizeUIFrameWidgetProps({ targetSurfaceId }),
    };
}

function createDocument(): UIDocument {
    return {
        schemaVersion: UI_DOCUMENT_SCHEMA_VERSION,
        id: "doc",
        name: "Doc",
        surfaces: [
            {
                id: "page-a",
                name: "Page A",
                host: "app",
                kind: "appSurface",
                designSize: { width: 320, height: 180 },
                rootElementId: "root-a",
            },
            {
                id: "page-b",
                name: "Page B",
                host: "app",
                kind: "appSurface",
                designSize: { width: 320, height: 180 },
                rootElementId: "root-b",
            },
            {
                id: "page-c",
                name: "Page C",
                host: "app",
                kind: "appSurface",
                designSize: { width: 320, height: 180 },
                rootElementId: "root-c",
            },
            {
                id: "game-ui",
                name: "HUD",
                host: "player",
                kind: "stageSurface",
                designSize: { width: 320, height: 180 },
                rootElementId: "root-game",
                mount: { kind: "slot", slotId: "onStage" },
            },
        ],
        elements: {
            "root-a": root("root-a", ["frame-a"]),
            "frame-a": frame("frame-a", "root-a", null),
            "root-b": root("root-b", ["frame-b"]),
            "frame-b": frame("frame-b", "root-b", "page-a"),
            "root-c": root("root-c"),
            "root-game": root("root-game"),
        },
    };
}

describe("UI Frame target validation", () => {
    it("accepts another Page target", () => {
        const document = createDocument();

        expect(
            getUIFrameTargetInvalidReason({
                document,
                sourceSurfaceId: "page-a",
                frameElementId: "frame-a",
                targetSurfaceId: "page-c",
            }),
        ).toBeNull();
    });

    it("rejects missing, non-Page, self, and cyclic targets", () => {
        const document = createDocument();

        expect(
            getUIFrameTargetInvalidReason({
                document,
                sourceSurfaceId: "page-a",
                frameElementId: "frame-a",
                targetSurfaceId: "missing-page",
            }),
        ).toBe("missing");
        expect(
            getUIFrameTargetInvalidReason({
                document,
                sourceSurfaceId: "page-a",
                frameElementId: "frame-a",
                targetSurfaceId: "game-ui",
            }),
        ).toBe("not_page");
        expect(
            getUIFrameTargetInvalidReason({
                document,
                sourceSurfaceId: "page-a",
                frameElementId: "frame-a",
                targetSurfaceId: "page-a",
            }),
        ).toBe("self");
        expect(
            getUIFrameTargetInvalidReason({
                document,
                sourceSurfaceId: "page-a",
                frameElementId: "frame-a",
                targetSurfaceId: "page-b",
            }),
        ).toBe("cycle");
    });

    it("normalizes optional Page component animation settings", () => {
        expect(normalizeUIFrameWidgetProps({ targetSurfaceId: "page-b" }).animation).toBeUndefined();
        expect(
            normalizeUIFrameWidgetProps({
                targetSurfaceId: "page-b",
                animation: {
                    enter: "fade",
                    exit: "slide",
                    direction: "up",
                    speed: "fast",
                },
            }).animation,
        ).toEqual({
            enter: "fade",
            exit: "slide",
            direction: "up",
            speed: "fast",
        });
        expect(
            normalizeUIFrameWidgetProps({
                animation: {
                    enter: "spin",
                    exit: "explode",
                },
            }).animation,
        ).toEqual({
            enter: "none",
            exit: "none",
            direction: "auto",
            speed: "normal",
        });
    });
});
