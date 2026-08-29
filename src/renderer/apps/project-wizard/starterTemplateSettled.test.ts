/**
 * The shipped starter template is already in the shape opening it would normalise it into.
 *
 * `UIDocumentService.load` does not only read `uidoc.json` - it migrates the schema, folds the
 * shapes that came before the current props, and writes the result straight back when any of that
 * changed anything. That convergence is deliberate: an old document is rewritten once and the
 * translation stops having to live at render time. What it costs is a file the author did not
 * touch, and on a project under version control that cost is visible - the version rail says one
 * change to the interface page before anybody has opened the interface editor.
 *
 * For a project created from this template that cost buys nothing, because the template can simply
 * be written in the settled shape. It went the other way once: for the projects that existed when
 * `nl.image` folded its legacy props, the first collaborator to open one on a new Studio found an
 * uncommitted 1.5 MB change of somebody else's making, and spent an afternoon deciding it was not
 * a defect. This is what stops a new project starting there.
 *
 * Each assertion below is one of the reasons `load` saves. The two it cannot reach need a service
 * container, and both are pinned by their observable precondition instead: the main surface has to
 * exist with a root element, or `ensureMainSurface` mints one.
 */
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { MAIN_APP_SURFACE_ID } from "@shared/constants/ui-editor";
import { UI_DOCUMENT_SCHEMA_VERSION, type UIDocument, type UIElement } from "@shared/types/ui-editor/document";
import { normalizeUIInputActionLibrary, normalizeUISurfaceActionEnablements } from "@shared/types/ui-editor/inputAction";
import { UI_IMAGE_ELEMENT_TYPE, foldLegacyImageProps } from "@shared/types/ui-editor/legacyImageProps";
import { normalizeFlowChildLayouts } from "@/lib/workspace/services/ui-editor/uiDocumentTreeMove";

const document = JSON.parse(
    fs.readFileSync(
        path.join(process.cwd(), "resources/templates/skeleton/content/editor/ui/uidoc.json"),
        "utf-8",
    ),
) as UIDocument;

/** Elements live in the document's own map and in each component's; a load walks both. */
const pools: { label: string; elements: Record<string, UIElement> }[] = [
    { label: "document", elements: document.elements },
    ...(document.components ?? []).map(component => ({
        label: `component ${component.name || component.id}`,
        elements: component.elements,
    })),
];

describe("the shipped starter template opens without being rewritten", () => {
    it("is written at the schema version this build reads", () => {
        // A lower version migrates on open, and the migration is a save. Every project made from
        // this template would start life with an uncommitted change to a file nobody had opened.
        expect(document.schemaVersion).toBe(UI_DOCUMENT_SCHEMA_VERSION);
    });

    it("has no image left in the shape that came before imageFill", () => {
        const legacy: string[] = [];
        for (const pool of pools) {
            for (const element of Object.values(pool.elements ?? {})) {
                if (element.type !== UI_IMAGE_ELEMENT_TYPE) {
                    continue;
                }
                if (foldLegacyImageProps(element.props as Record<string, unknown> | undefined)) {
                    legacy.push(`${pool.label}: ${element.name || element.id}`);
                }
            }
        }
        expect(legacy).toEqual([]);
    });

    it("has no surface carrying the input mode that was dropped in v12", () => {
        const carrying = document.surfaces
            .filter(surface => (surface as { input?: unknown }).input !== undefined)
            .map(surface => surface.name || surface.id);
        expect(carrying).toEqual([]);
    });

    it("spells its action vocabulary the way a load reads it", () => {
        // Non-vacuous: the template ships an action library and most of its surfaces answer to it.
        expect(Object.keys(document.actions ?? {}).length).toBeGreaterThan(0);
        expect(normalizeUIInputActionLibrary(document.actions)).toEqual(document.actions);
    });

    it("spells each surface's answer to that vocabulary the way a load reads it", () => {
        const answering = document.surfaces.filter(surface => surface.actions !== undefined);
        expect(answering.length).toBeGreaterThan(0);
        for (const surface of answering) {
            expect(normalizeUISurfaceActionEnablements(surface.actions)).toEqual(surface.actions);
        }
    });

    it("already has the main surface, with the root element a load would otherwise mint", () => {
        const main = document.surfaces.find(surface => surface.id === MAIN_APP_SURFACE_ID);
        expect(main).toBeDefined();
        expect(document.elements[main!.rootElementId]).toBeDefined();
    });

    it("has every flow child laid out where a load would put it", () => {
        // Mutates, so it is handed a copy: the point is the answer, not the document.
        expect(normalizeFlowChildLayouts(structuredClone(document))).toBe(false);
    });
});
