import { describe, expect, it } from "vitest";
import type { DocumentChange } from "@shared/documents/diff";
import type { UIDocument, UIElement } from "@shared/types/ui-editor/document";
import {
    buildComparisonElementSelection,
    comparisonElementAddress,
    isSameComparisonElement,
} from "./comparisonSelection";

/**
 * What a half is allowed to publish, and what it may not.
 *
 * The addressing is read as positions, never parsed out of a label, so the two cases that matter are
 * the four-segment element row and the five-segment property row under it - both of which are about
 * the same element. Everything else answers null, and answering null is what stops a row that names
 * nothing selectable from becoming a control.
 */

function element(id: string): UIElement {
    return {
        id,
        type: "nl.text",
        name: id,
        parentId: "root",
        childrenIds: [],
        layout: { x: 0, y: 0, width: 10, height: 10, opacity: 1, visible: true },
    } as UIElement;
}

function documentWith(ids: string[]): UIDocument {
    return {
        version: 11,
        name: "Interface",
        surfaces: [],
        elements: Object.fromEntries(ids.map(id => [id, element(id)])),
        components: [],
    } as unknown as UIDocument;
}

function change(path: string[]): DocumentChange {
    return { path, kind: "changed", label: { key: "documentDiff.uiDocument.elementChanged" } };
}

describe("comparisonElementAddress", () => {
    it("reads an element row and a property row of one as the same element", () => {
        expect(comparisonElementAddress(change(["surfaces", "main", "elements", "title"])))
            .toEqual({ surfaceId: "main", elementId: "title" });
        expect(comparisonElementAddress(change(["surfaces", "main", "elements", "title", "layout"])))
            .toEqual({ surfaceId: "main", elementId: "title" });
    });

    it("answers null for everything that is not an element of a Surface", () => {
        expect(comparisonElementAddress(change(["name"]))).toBeNull();
        expect(comparisonElementAddress(change(["surfaces", "main"]))).toBeNull();
        expect(comparisonElementAddress(change(["surfaces", "main", "designSize"]))).toBeNull();
        // A component definition's insides are on no Surface, and a detached element is on none.
        expect(comparisonElementAddress(change(["components", "card", "elements", "title"]))).toBeNull();
        expect(comparisonElementAddress(change(["elements", "orphan"]))).toBeNull();
    });
});

describe("buildComparisonElementSelection", () => {
    const address = { surfaceId: "main", elementId: "title" };

    it("is complete for an element only the older half holds", () => {
        const selection = buildComparisonElementSelection({
            documentPath: "ui/interface.json",
            half: "base",
            versionLabel: "#66",
            counterpartLabel: "This project",
            address,
            document: documentWith(["title"]),
            // The newer half deleted it, which is exactly the question an author opens the row to ask.
            counterpartDocument: documentWith([]),
        });
        expect(selection).not.toBeNull();
        expect(selection?.element.id).toBe("title");
        expect(selection?.versionLabel).toBe("#66");
        expect(selection?.counterpartLabel).toBe("This project");
        expect(selection?.counterpart).toBeNull();
    });

    it("finds the counterpart when both halves hold the element", () => {
        const selection = buildComparisonElementSelection({
            documentPath: "ui/interface.json",
            half: "head",
            versionLabel: "This project",
            counterpartLabel: "#66",
            address,
            document: documentWith(["title"]),
            counterpartDocument: documentWith(["title"]),
        });
        expect(selection?.counterpart?.id).toBe("title");
    });

    it("refuses a row whose element this half does not hold", () => {
        expect(buildComparisonElementSelection({
            documentPath: "ui/interface.json",
            half: "head",
            versionLabel: "This project",
            counterpartLabel: "#66",
            address,
            document: documentWith([]),
            counterpartDocument: documentWith(["title"]),
        })).toBeNull();
        expect(buildComparisonElementSelection({
            documentPath: "ui/interface.json",
            half: "head",
            versionLabel: "This project",
            counterpartLabel: "#66",
            address,
            document: null,
            counterpartDocument: null,
        })).toBeNull();
    });
});

describe("isSameComparisonElement", () => {
    it("tells the two halves apart for one element", () => {
        const make = (half: "base" | "head") => buildComparisonElementSelection({
            documentPath: "ui/interface.json",
            half,
            versionLabel: half,
            counterpartLabel: "other",
            address: { surfaceId: "main", elementId: "title" },
            document: documentWith(["title"]),
            counterpartDocument: documentWith(["title"]),
        });
        expect(isSameComparisonElement(make("base"), make("base"))).toBe(true);
        expect(isSameComparisonElement(make("base"), make("head"))).toBe(false);
        expect(isSameComparisonElement(null, make("base"))).toBe(false);
    });
});
