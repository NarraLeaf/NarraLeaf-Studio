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
import type { UIDocument } from "@shared/types/ui-editor/document";
import { applyCompiled } from "./apply";
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

/**
 * Page widgets: the two questions Studio's project lint asks as `ui/frame-target-missing` and
 * `ui/frame-loop`, asked here of the same shared model - including of a Page widget inside a
 * component definition, which both used to skip.
 */
describe("checking Page widgets", () => {
    const GALLERY = `surface "Gallery" id=gallery kind=appSurface size=64x36
    Root: nl.root @0,0 64x36
`;
    const PAGES = `surface "Home" id=home kind=appSurface size=64x36
    Root: nl.root @0,0 64x36

${GALLERY}`;

    /** A card whose Page widget "Window" names `target`. */
    function card(target: string): string {
        return `component "Card" id=card size=32x18
    Card: nl.container id=card-root @0,0 32x18
        Window: nl.frame id=window @0,0 32x18
            targetSurfaceId = ${target}
`;
    }

    /** Home placing the card, and Gallery as it was. */
    const HOME_PLACES_CARD = `surface "Home" id=home kind=appSurface size=64x36
    Root: nl.root @0,0 64x36
        Slot: nl.container id=slot @0,0 32x18
            component card
`;

    /** A document holding exactly what `source` declares. */
    function documentFrom(source: string): UIDocument {
        const compiled = checkUiSource(source).compiled;
        if (!compiled) {
            throw new Error("the fixture does not compile");
        }
        const document: UIDocument = { schemaVersion: 12, id: "d", name: "d", surfaces: [], elements: {} };
        applyCompiled(document, compiled);
        return document;
    }

    function frameDiagnostics(diagnostics: { code: string; message: string }[]) {
        return diagnostics
            .filter(item => item.code === "ui.frame_loop" || item.code === "ui.frame_target_missing")
            .map(item => `${item.code}: ${item.message}`);
    }

    it("refuses a card whose Page widget names the page the card is placed on, naming the card", () => {
        const document = documentFrom(`${card("home")}\n${HOME_PLACES_CARD}`);

        expect(frameDiagnostics(checkProjectDocument(document, null))).toEqual([
            'ui.frame_loop: "Card / Window" in component "Card" embeds page "Home", which leads back to it.',
        ]);
    });

    it("refuses a Page widget in a card that names a page the project does not have", () => {
        const document = documentFrom(`${card("gone")}\n${PAGES}`);

        expect(frameDiagnostics(checkProjectDocument(document, null))).toEqual([
            'ui.frame_target_missing: "Card / Window" in component "Card" embeds page "gone", which this document does not have.',
        ]);
    });

    it("says nothing about a card whose Page widget leads nowhere back", () => {
        const document = documentFrom(`${card("gallery")}\n${HOME_PLACES_CARD}\n${GALLERY}`);

        expect(frameDiagnostics(checkProjectDocument(document, null))).toEqual([]);
    });

    it("refuses a file that places a card on the page the card's Page widget names", () => {
        // The Page widget that leads back is in the card, which the file does not mention: the file
        // only places the card on Home. That is still this file's doing, so it is reported.
        const existing = documentFrom(`${card("home")}\n${PAGES}`);
        expect(frameDiagnostics(checkProjectDocument(existing, null))).toEqual([]);

        const result = checkUiSource(HOME_PLACES_CARD, { existing });

        expect(frameDiagnostics(result.diagnostics)).toEqual([
            'ui.frame_loop: "Card / Window" in component "Card" embeds page "Home", which leads back to it.',
        ]);
        expect(result.ok).toBe(false);
    });

    it("leaves a finding the file has nothing to do with to the whole-project check", () => {
        const existing = documentFrom(`${card("gone")}\n${PAGES}`);

        const result = checkUiSource(GALLERY, { existing });

        expect(frameDiagnostics(result.diagnostics)).toEqual([]);
    });
});
