import { describe, expect, it } from "vitest";
import type { UIDocument, UIElement, UISurface } from "@shared/types/ui-editor/document";
import { UI_DOCUMENT_SCHEMA_VERSION } from "@shared/types/ui-editor/document";
import { collectLayoutDiagnostics } from "./layoutDiagnostics";

function element(id: string, parentId: string | null, x: number, childrenIds: string[], props = {}): UIElement {
    return {
        id,
        type: id === "root" ? "nl.root" : "nl.container",
        name: id,
        parentId,
        childrenIds,
        layout: { x, y: 0, width: 100, height: 100, visible: true },
        props,
    };
}

describe("collectLayoutDiagnostics", () => {
    it("does not use stored positions of a flow item for its descendants", () => {
        const surface = {
            id: "page", name: "Page", host: "app", kind: "appSurface",
            designSize: { width: 500, height: 500 }, rootElementId: "root",
        } as UISurface;
        const elements = [
            element("root", null, 0, ["stack", "outside"]),
            element("stack", "root", 0, ["item"], { layoutKind: "stack" }),
            element("item", "stack", 1000, ["nested"]),
            element("nested", "item", 0, []),
            element("outside", "root", 1000, []),
        ];
        const document = {
            schemaVersion: UI_DOCUMENT_SCHEMA_VERSION,
            id: "doc", name: "Doc", surfaces: [surface],
            elements: Object.fromEntries(elements.map(el => [el.id, el])),
        } as UIDocument;

        expect(collectLayoutDiagnostics(document, surface, elements).map(d => d.id))
            .toEqual(["layout:oob:outside"]);

        elements[1].layout.x = 1000;
        expect(collectLayoutDiagnostics(document, surface, elements).map(d => d.id))
            .toEqual(["layout:oob:stack", "layout:oob:outside"]);
    });
});
