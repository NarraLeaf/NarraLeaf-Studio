import { describe, expect, it, vi } from "vitest";
import { UI_DOCUMENT_SCHEMA_VERSION, type UIDocument, type UIElement } from "@shared/types/ui-editor/document";
import { UI_FRAME_ELEMENT_TYPE } from "@shared/types/ui-editor/frame";
import {
    applyFrameScalePercent,
    getFrameScalePercent,
    resolveFrameTargetPage,
} from "./layoutInspector";

function createDocument(targetSurfaceId: string | null = "target-page"): UIDocument {
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
                designSize: { width: 800, height: 600 },
                rootElementId: "target-root",
            },
            {
                id: "stage",
                name: "Stage",
                host: "player",
                kind: "stageSurface",
                designSize: { width: 1280, height: 720 },
                rootElementId: "stage-root",
                mount: { kind: "slot", slotId: "onStage" },
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
                layout: { x: 0, y: 0, width: 400, height: 300 },
                props: {
                    targetSurfaceId,
                    params: {},
                    navigationMode: "static",
                },
            },
            "target-root": {
                id: "target-root",
                type: "nl.root",
                parentId: null,
                childrenIds: [],
                layout: { x: 0, y: 0, width: 800, height: 600 },
            },
            "stage-root": {
                id: "stage-root",
                type: "nl.root",
                parentId: null,
                childrenIds: [],
                layout: { x: 0, y: 0, width: 1280, height: 720 },
            },
        },
    };
}

function getFrame(document: UIDocument): UIElement {
    return document.elements.frame!;
}

describe("Frame layout inspector", () => {
    it("computes Scale from the target Page design width", () => {
        const document = createDocument();
        const scale = getFrameScalePercent({
            element: getFrame(document),
            documentService: { getDocument: () => document } as any,
        });

        expect(scale).toBe(50);
    });

    it("sets 100% Scale to the target Page's real resolution", () => {
        const document = createDocument();
        const updateElementLayout = vi.fn();

        applyFrameScalePercent({
            element: getFrame(document),
            documentService: { getDocument: () => document, updateElementLayout } as any,
            percent: 100,
        });

        expect(updateElementLayout).toHaveBeenCalledWith("frame", {
            width: 800,
            height: 600,
            lockAspectRatio: true,
        });
    });

    it("does not write layout when no app Page target is available", () => {
        const document = createDocument(null);
        const updateElementLayout = vi.fn();

        expect(resolveFrameTargetPage({
            element: getFrame(document),
            documentService: { getDocument: () => document } as any,
        })).toBeNull();
        expect(getFrameScalePercent({
            element: getFrame(document),
            documentService: { getDocument: () => document } as any,
        })).toBeNull();

        applyFrameScalePercent({
            element: getFrame(document),
            documentService: { getDocument: () => document, updateElementLayout } as any,
            percent: 100,
        });

        expect(updateElementLayout).not.toHaveBeenCalled();
    });

    it("rejects Game UI targets for Scale", () => {
        const document = createDocument("stage");
        const updateElementLayout = vi.fn();

        expect(resolveFrameTargetPage({
            element: getFrame(document),
            documentService: { getDocument: () => document } as any,
        })).toBeNull();

        applyFrameScalePercent({
            element: getFrame(document),
            documentService: { getDocument: () => document, updateElementLayout } as any,
            percent: 100,
        });

        expect(updateElementLayout).not.toHaveBeenCalled();
    });
});
