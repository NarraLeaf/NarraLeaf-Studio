/**
 * The text format against the whole interface the shipped skeleton holds.
 *
 * A format that can only express what its own examples use is a format that will lose someone's page
 * the first time it meets a real one. The skeleton is twelve surfaces, eleven component definitions
 * and 260 elements of real authored work - appearance variants, list item templates, component
 * instances with params, value bindings of both kinds, a stage surface per player slot - so printing
 * all of it and compiling the result back is the only claim worth making about round-tripping: not
 * that it works, but that it works on everything that exists.
 *
 * Comments in English per project convention.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { describe, expect, it } from "vitest";
import { UI_DOCUMENT_SCHEMA_VERSION, type UIDocument } from "@shared/types/ui-editor/document";
import { compileUiFile } from "./compile";
import { parseUiFile } from "./parse";
import { printUiDocument } from "./print";

const SKELETON = path.resolve(
    __dirname,
    "../../../../../resources/templates/skeleton/content/editor/ui/uidoc.json",
);

function loadSkeleton(): UIDocument {
    return JSON.parse(fs.readFileSync(SKELETON, "utf8")) as UIDocument;
}

describe("the .ui text format", () => {
    it("prints the shipped skeleton and compiles the result back into the same document", () => {
        const document = loadSkeleton();
        const text = printUiDocument(document);
        const compiled = compileUiFile(parseUiFile(text), { existing: document });

        const errors = compiled.diagnostics
            .filter(item => item.severity === "error")
            .map(item => `${item.line ?? "?"}: ${item.code} ${item.message}`);
        expect(errors).toEqual([]);

        expect(compiled.surfaces.map(entry => entry.surface)).toEqual(document.surfaces);
        expect(compiled.components.map(entry => entry.component)).toEqual(document.components);
        expect(compiled.actions).toEqual(document.actions ?? {});

        // The elements come back in tree order per surface rather than in the order the project's
        // editing history left them, so they are compared as a set of records rather than as a map
        // whose key order means something. Nothing reads that order.
        const written: Record<string, unknown> = {};
        for (const surface of compiled.surfaces) {
            Object.assign(written, surface.elements);
        }
        expect(Object.keys(written).sort()).toEqual(Object.keys(document.elements).sort());
        for (const [id, element] of Object.entries(written)) {
            expect(element, `element ${id}`).toEqual(document.elements[id]);
        }
    });

    it("drops nothing when a surface is printed and compiled on its own", () => {
        const document = loadSkeleton();
        const surface = document.surfaces[0];
        const text = printUiDocument(document, { surfaceIds: [surface.id], includeSharedTables: false });
        const compiled = compileUiFile(parseUiFile(text), { existing: document });

        expect(compiled.surfaces).toHaveLength(1);
        expect(compiled.surfaces[0].dropped).toEqual([]);
        expect(compiled.surfaces[0].surface).toEqual(surface);
    });

    it("carries a label's marks through, spelled the same way on a button as on a text label", () => {
        const runs = [{ text: "山田", marks: { ruby: "やまだ" } }, { text: "さん", marks: { bold: true } }];
        const source = [
            'surface "S" id=s kind=appSurface size=800x600',
            "    Root: nl.root id=root @0,0 800x600",
            "        Name: nl.text id=name @0,0 200x40",
            "            text = 山田さん",
            `            rich = ${JSON.stringify(runs)}`,
            "        Go: nl.button id=go @0,60 200x40",
            "            label = 山田さん",
            `            rich = ${JSON.stringify(runs)}`,
            "",
        ].join("\n");
        const first = compileUiFile(parseUiFile(source));
        expect(first.diagnostics.filter(item => item.severity === "error")).toEqual([]);
        expect(first.surfaces[0].elements.go.props).toEqual({ label: "山田さん", rich: runs });
        expect(first.surfaces[0].elements.name.props).toEqual({ text: "山田さん", rich: runs });

        const document: UIDocument = {
            schemaVersion: UI_DOCUMENT_SCHEMA_VERSION,
            id: "d",
            name: "d",
            surfaces: [first.surfaces[0].surface],
            elements: first.surfaces[0].elements,
        };
        const printed = printUiDocument(document, { includeSharedTables: false });
        const richLines = printed.split("\n").map(line => line.trim()).filter(line => line.startsWith("rich = "));
        expect(richLines).toEqual([`rich = ${JSON.stringify(runs)}`, `rich = ${JSON.stringify(runs)}`]);

        const second = compileUiFile(parseUiFile(printed), { existing: document });
        expect(second.surfaces[0].dropped).toEqual([]);
        expect(second.surfaces[0].elements.go).toEqual(document.elements.go);
        expect(second.surfaces[0].elements.name).toEqual(document.elements.name);
    });
});
