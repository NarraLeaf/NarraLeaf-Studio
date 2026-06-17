import { describe, expect, it } from "vitest";
import { UI_DOCUMENT_SCHEMA_VERSION, type UIDocument, type UIElement } from "@shared/types/ui-editor/document";
import type { UIElementSelection } from "@shared/types/ui-editor/selection";
import { resolvePasteTargetAfterSelection } from "./uiEditorCommands";

function element(id: string, type: string, parentId: string | null, childrenIds: string[] = []): UIElement {
    return {
        id,
        type,
        parentId,
        childrenIds,
        layout: { x: 0, y: 0, width: 100, height: 100 },
    };
}

function makeDocument(): UIDocument {
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
                designSize: { width: 800, height: 600 },
                rootElementId: "root",
            },
        ],
        elements: {
            root: element("root", "nl.root", null, ["source", "next"]),
            source: element("source", "nl.container", "root", ["source-child"]),
            "source-child": element("source-child", "nl.text", "source"),
            next: element("next", "nl.container", "root"),
        },
    };
}

function selection(ids: string[], primaryId = ids[ids.length - 1]): UIElementSelection {
    return {
        editor: "ui",
        surfaceId: "surface",
        elementIds: ids,
        primaryId,
    };
}

describe("UI editor paste target resolution", () => {
    it("pastes after a selected parent-capable element, not into it", () => {
        const doc = makeDocument();

        expect(resolvePasteTargetAfterSelection(doc, "surface", selection(["source"]))).toEqual({
            parentId: "root",
            beforeChildId: "next",
        });
    });

    it("uses the selected top-level ancestor when primary is inside the copied subtree", () => {
        const doc = makeDocument();

        expect(resolvePasteTargetAfterSelection(doc, "surface", selection(["source", "source-child"], "source-child"))).toEqual({
            parentId: "root",
            beforeChildId: "next",
        });
    });

    it("falls back to the effective root when there is no selection", () => {
        const doc = makeDocument();

        expect(resolvePasteTargetAfterSelection(doc, "surface", null)).toEqual({
            parentId: "root",
            beforeChildId: null,
        });
    });
});
