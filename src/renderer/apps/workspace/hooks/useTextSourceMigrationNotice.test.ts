import { describe, expect, it } from "vitest";
import type { UIDocument } from "@shared/types/ui-editor/document";
import { describeTextSourceMigrationChanges } from "./useTextSourceMigrationNotice";

/**
 * The upgrade notice names each place by what the author calls it - a page or a component, and the
 * widget's name or its kind - and never by an id.
 */

const layout = { x: 0, y: 0, width: 10, height: 10 };

const document = {
    schemaVersion: 13,
    id: "doc",
    name: "UI",
    surfaces: [{ id: "page-1", name: "Title", host: "app", kind: "appSurface", designSize: { width: 10, height: 10 }, rootElementId: "root" }],
    elements: {
        root: { id: "root", type: "nl.root", parentId: null, childrenIds: ["start", "untitled"], layout },
        start: { id: "start", type: "nl.button", name: "Start", parentId: "root", childrenIds: [], layout },
        untitled: { id: "0b2c6f4e-1111-4222-8333-944455556666", type: "nl.text", parentId: "root", childrenIds: [], layout },
    },
    components: [{
        id: "comp-1",
        name: "Save slot",
        rootElementId: "place",
        elements: { place: { id: "place", type: "nl.text", name: "Place", parentId: null, childrenIds: [], layout } },
    }],
} as unknown as UIDocument;

describe("describeTextSourceMigrationChanges", () => {
    it("numbers each place and names it by page or component and widget, never by id", () => {
        const lines = describeTextSourceMigrationChanges([
            { kind: "missingKey", elementId: "start", prop: "label", keyName: "menu.continue", surfaceId: "page-1" },
            { kind: "marksKept", elementId: "place", prop: "text", keyName: "slot.place", componentId: "comp-1" },
            { kind: "keyDiffered", elementId: "untitled", prop: "text", keyName: "menu.title", surfaceId: "page-1" },
        ], document).map(place => place.line);

        expect(lines).toHaveLength(3);
        expect(lines[0]).toMatch(/^1\. Title ▸ Start/);
        expect(lines[0]).toContain("menu.continue");
        expect(lines[1]).toMatch(/^2\. Save slot ▸ Place/);
        expect(lines[2]).toMatch(/^3\. Title ▸ /);
        for (const line of lines) {
            expect(line).not.toMatch(/page-1|comp-1|0b2c6f4e/);
        }
    });
});
