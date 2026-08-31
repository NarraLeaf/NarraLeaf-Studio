/**
 * The layer the compiler cannot see: whether the interface still agrees with the blueprints beside it.
 *
 * The mismatch case is the one worth pinning. The shipped skeleton once had two texts on the Confirm
 * page bound to blueprints owned by a different surface's elements, so neither one showed anything,
 * and no test caught it because every test asked the blueprint who owned it rather than asking the
 * element what it pointed at.
 *
 * Comments in English per project convention.
 */

import { describe, expect, it } from "vitest";
import type { BlueprintOwnerRef } from "@shared/types/blueprint/document";
import { checkProjectDocument, checkUiSource } from "./check";
import type { BlueprintIndex } from "./project";

function index(entries: { id: string; name: string; owner: BlueprintOwnerRef }[]): BlueprintIndex {
    const byId = new Map<string, { name: string; owner: BlueprintOwnerRef }>();
    const byElement = new Map<string, { id: string; name: string; owner: BlueprintOwnerRef }[]>();
    for (const entry of entries) {
        byId.set(entry.id, { name: entry.name, owner: entry.owner });
        const elementId = (entry.owner as { elementId?: string }).elementId;
        if (elementId) {
            byElement.set(elementId, [...(byElement.get(elementId) ?? []), entry]);
        }
    }
    return { byId, byElement };
}

const SOURCE = `surface "S" id=s kind=appSurface size=8x6
    Root: nl.root @0,0 8x6
        Label: nl.text id=label @0,0 8x6
            bind text = blueprint bp-1
`;

describe("checking a .ui file against the project", () => {
    it("refuses a binding whose blueprint belongs to another element", () => {
        const result = checkUiSource(SOURCE, {
            blueprints: index([
                { id: "bp-1", name: "Someone else's text", owner: { kind: "widgetValue", surfaceId: "s", elementId: "other", propPath: "text" } },
            ]),
        });
        expect(result.diagnostics.map(item => item.code)).toContain("ui.binding_owner_mismatch");
        expect(result.ok).toBe(false);
    });

    it("refuses a binding whose blueprint drives another prop of the same element", () => {
        const result = checkUiSource(SOURCE, {
            blueprints: index([
                { id: "bp-1", name: "Label", owner: { kind: "widgetValue", surfaceId: "s", elementId: "label", propPath: "label" } },
            ]),
        });
        expect(result.diagnostics.map(item => item.code)).toContain("ui.binding_owner_mismatch");
    });

    it("accepts a binding whose blueprint is owned by this element and this prop", () => {
        const result = checkUiSource(SOURCE, {
            blueprints: index([
                { id: "bp-1", name: "Label", owner: { kind: "widgetValue", surfaceId: "s", elementId: "label", propPath: "text" } },
            ]),
        });
        expect(result.diagnostics.map(item => item.code)).not.toContain("ui.binding_owner_mismatch");
        expect(result.ok).toBe(true);
    });

    it("notes rather than refuses a blueprint that has not been written yet", () => {
        const result = checkUiSource(SOURCE, { blueprints: index([]) });
        expect(result.diagnostics.map(item => item.code)).toContain("ui.binding_blueprint_missing");
        expect(result.ok).toBe(true);
    });

    it("warns before applying would leave a blueprint with nothing to hang off", () => {
        const first = checkUiSource(
            `surface "S" id=s kind=appSurface size=8x6\n    Root: nl.root @0,0 8x6\n        Gone: nl.button id=gone @0,0 1x1\n`,
        );
        const existing = {
            schemaVersion: 12,
            id: "d",
            name: "d",
            surfaces: [(first.compiled as NonNullable<typeof first.compiled>).surfaces[0].surface],
            elements: (first.compiled as NonNullable<typeof first.compiled>).surfaces[0].elements,
        };
        const result = checkUiSource('surface "S" id=s kind=appSurface size=8x6\n    Root: nl.root @0,0 8x6\n', {
            existing,
            blueprints: index([
                { id: "bp-2", name: "On click", owner: { kind: "widgetMain", surfaceId: "s", elementId: "gone" } },
            ]),
        });
        expect(result.diagnostics.map(item => item.code)).toContain("ui.orphaned_blueprint");
    });
});

describe("checking a document as it stands", () => {
    it("reports an element no surface reaches", () => {
        const diagnostics = checkProjectDocument(
            {
                schemaVersion: 12,
                id: "d",
                name: "d",
                surfaces: [
                    {
                        id: "narraleaf-studio:main-surface",
                        name: "Title",
                        host: "app",
                        kind: "appSurface",
                        designSize: { width: 8, height: 6 },
                        rootElementId: "root",
                    },
                ],
                elements: {
                    root: { id: "root", type: "nl.root", parentId: null, childrenIds: [], layout: { x: 0, y: 0, width: 8, height: 6 } },
                    stray: { id: "stray", type: "nl.text", parentId: null, childrenIds: [], layout: { x: 0, y: 0, width: 1, height: 1 } },
                },
            },
            null,
        );
        expect(diagnostics.map(item => item.code)).toContain("ui.unreachable_element");
    });

    it("reports a document with no surface the game can boot into", () => {
        const diagnostics = checkProjectDocument(
            { schemaVersion: 12, id: "d", name: "d", surfaces: [], elements: {} },
            null,
        );
        expect(diagnostics.map(item => item.code)).toContain("ui.no_main_surface");
    });
});
