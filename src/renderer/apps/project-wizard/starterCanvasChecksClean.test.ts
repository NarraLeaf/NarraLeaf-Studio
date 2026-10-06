/**
 * Every page of the starter template opens on the interface editor's canvas with nothing flagged,
 * in each of the three languages the template is written in.
 *
 * These are the editor's own checks rather than the project linter's: the ones that draw a box over
 * an element on the canvas and list it in the Properties panel when it is selected. The template
 * builds its tabs, its picture viewer and its gallery tiles the way any author would - panels that
 * rest hidden and are shown by a blueprint, pictures handed over by a list row or a blueprint - and
 * the checks used to judge those by what they rest at. The Extra page opened under two warning boxes
 * that covered it, on a project nobody had touched yet.
 *
 * A clean sweep is also what a check that reads nothing produces, so the Extra page is checked once
 * more with its blueprints' element literals removed, and has to report its viewer as unreachable.
 *
 * Comments in English per project convention.
 */
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import type { BlueprintDocument } from "@shared/types/blueprint/document";
import type { UIDocument } from "@shared/types/ui-editor/document";
import { migrateBlueprintDocumentToLatest } from "@shared/blueprint/migrateBlueprintDocument";
import { collectSurfaceDiagnostics } from "@/lib/ui-editor/diagnostics/collectSurfaceDiagnostics";

const TEMPLATE = path.join(process.cwd(), "resources/templates/skeleton");

const LANGUAGES = [
    { name: "English", variant: "content" },
    { name: "Chinese", variant: "content.zh" },
    { name: "Japanese", variant: "content.ja" },
] as const;

/** The page the player opens from the title's Extra button; its id is the same in every language. */
const EXTRA_SURFACE_ID = "afa4f872-ce72-4456-a86b-a8edc1594316";
const VIEWER_ELEMENT_ID = "5107c0a1-0000-4000-8000-000000000400";

/** The file a project made in this language ends up with: the variant's copy when it has one. */
function landed(variant: string, relative: string): string {
    const override = path.join(TEMPLATE, variant, relative);
    return fs.existsSync(override) ? override : path.join(TEMPLATE, "content", relative);
}

function readInterface(variant: string): { document: UIDocument; blueprintDocument: BlueprintDocument } {
    const document = JSON.parse(fs.readFileSync(landed(variant, "editor/ui/uidoc.json"), "utf-8")) as UIDocument;
    const graphs = JSON.parse(fs.readFileSync(landed(variant, "editor/ui/uigraphs.json"), "utf-8")) as {
        blueprintDocument: unknown;
    };
    return { document, blueprintDocument: migrateBlueprintDocumentToLatest(graphs.blueprintDocument) };
}

/** The same document with every element literal gone: nothing in it shows or re-pictures anything. */
function withoutElementLiterals(blueprintDocument: BlueprintDocument): BlueprintDocument {
    const copy = structuredClone(blueprintDocument);
    for (const blueprint of Object.values(copy.blueprints ?? {})) {
        for (const layer of Object.values(blueprint.graphs.events ?? {})) {
            const nodes = layer?.graph?.nodes;
            for (const [nodeId, node] of Object.entries(nodes ?? {})) {
                if (node.type === "blueprint.element.ref") {
                    delete nodes![nodeId];
                }
            }
        }
    }
    return copy;
}

describe.each(LANGUAGES)("the starter template's canvas checks ($name)", ({ variant }) => {
    const { document, blueprintDocument } = readInterface(variant);

    it.each(document.surfaces.map(surface => [surface.name, surface.id] as const))("%s opens with nothing flagged", (_name, surfaceId) => {
        const findings = collectSurfaceDiagnostics(document, surfaceId, { blueprintDocument });

        expect(findings.map(finding => finding.message)).toEqual([]);
    });

    it("still reports the Extra page's viewer when nothing shows it", () => {
        const findings = collectSurfaceDiagnostics(document, EXTRA_SURFACE_ID, {
            blueprintDocument: withoutElementLiterals(blueprintDocument),
        });

        expect(findings.map(finding => finding.id)).toContain(`ix:hidden-events:${VIEWER_ELEMENT_ID}`);
    });
});
