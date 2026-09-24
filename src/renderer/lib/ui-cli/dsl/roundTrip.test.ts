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
import { UI_DOCUMENT_SCHEMA_VERSION, type UIDocument, type UIElement } from "@shared/types/ui-editor/document";
import { DEFAULT_UI_PAGE_ANIMATION_SETTINGS, type UIPageAnimationSettings } from "@shared/types/ui-editor/pageAnimation";
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

    describe("a Page widget's animation override beside an element's own enter/exit", () => {
        // Two records of one shape in two places: `props.animation` is how the Page a frame shows
        // enters and leaves inside it, `element.animation` is how an element itself does. Distinct
        // values, so a record that lands in the other place cannot pass for the right one.
        const override: UIPageAnimationSettings = {
            ...DEFAULT_UI_PAGE_ANIMATION_SETTINGS,
            enter: "slide",
            enterDirection: "left",
            exit: "fade",
        };
        const own: UIPageAnimationSettings = {
            ...DEFAULT_UI_PAGE_ANIMATION_SETTINGS,
            enter: "zoom",
            exit: "pop",
            exitWaitsForChildren: false,
        };

        function element(id: string, type: string, extra: Partial<UIElement>): UIElement {
            return {
                id,
                type,
                name: id,
                parentId: "root",
                childrenIds: [],
                layout: { x: 0, y: 0, width: 32, height: 18 },
                ...extra,
            };
        }

        const document: UIDocument = {
            schemaVersion: UI_DOCUMENT_SCHEMA_VERSION,
            id: "d",
            name: "d",
            surfaces: [
                {
                    id: "home",
                    name: "Home",
                    host: "app",
                    kind: "appSurface",
                    designSize: { width: 64, height: 36 },
                    rootElementId: "root",
                },
            ],
            elements: {
                root: {
                    id: "root",
                    type: "nl.root",
                    name: "Root",
                    parentId: null,
                    childrenIds: ["window", "badge", "both"],
                    layout: { x: 0, y: 0, width: 64, height: 36 },
                },
                window: element("window", "nl.frame", {
                    props: { targetSurfaceId: "gallery", params: {}, navigationMode: "static", animation: override },
                }),
                badge: element("badge", "nl.text", { props: { text: "New" }, animation: own }),
                both: element("both", "nl.frame", {
                    props: { targetSurfaceId: "gallery", params: {}, navigationMode: "static", animation: override },
                    animation: own,
                }),
            },
        };

        function assignmentsOf(printed: string, id: string): string[] {
            const lines = printed.split("\n");
            const start = lines.findIndex(line => line.includes(`id=${id} `));
            const out: string[] = [];
            for (const line of lines.slice(start + 1)) {
                if (!line.startsWith(" ".repeat(12))) {
                    break;
                }
                out.push(line.trim().split(" = ")[0]);
            }
            return out;
        }

        it("prints the override with a props. prefix and the element's record without one", () => {
            const printed = printUiDocument(document, { includeSharedTables: false });
            expect(assignmentsOf(printed, "window")).toEqual([
                "targetSurfaceId", "params", "navigationMode", "props.animation",
            ]);
            expect(assignmentsOf(printed, "badge")).toEqual(["text", "animation"]);
            expect(assignmentsOf(printed, "both")).toEqual([
                "targetSurfaceId", "params", "navigationMode", "props.animation", "animation",
            ]);
        });

        it("reads each record back into the place it came from", () => {
            const printed = printUiDocument(document, { includeSharedTables: false });
            const compiled = compileUiFile(parseUiFile(printed), { existing: document });

            // A frame's override is a declared prop of the type, so writing it is not a stray key.
            expect(compiled.diagnostics.map(item => `${item.severity} ${item.code} ${item.message}`)).toEqual([]);
            expect(compiled.surfaces[0].dropped).toEqual([]);
            expect(compiled.surfaces[0].surface).toEqual(document.surfaces[0]);
            expect(compiled.surfaces[0].elements).toEqual(document.elements);
            expect(compiled.surfaces[0].elements.window.animation).toBeUndefined();
            expect(compiled.surfaces[0].elements.badge.props).not.toHaveProperty("animation");
        });

        it("lets the first segment of a hand-written key decide which record it writes", () => {
            const source = [
                'surface "Home" id=home kind=appSurface size=64x36',
                "    Root: nl.root id=root @0,0 64x36",
                "        Bare: nl.frame id=bare @0,0 32x18",
                '            animation = {"enter": "fade"}',
                "        Dotted: nl.frame id=dotted @0,0 32x18",
                "            animation.enter = fade",
                "        Override: nl.frame id=override @0,0 32x18",
                '            props.animation = {"enter": "fade"}',
                "        OverrideDotted: nl.frame id=override-dotted @0,0 32x18",
                "            props.animation.enter = fade",
                "",
            ].join("\n");
            const { elements } = compileUiFile(parseUiFile(source)).surfaces[0];
            for (const id of ["bare", "dotted"]) {
                expect(elements[id].animation, id).toEqual({ enter: "fade" });
                expect(elements[id].props, id).toBeUndefined();
            }
            for (const id of ["override", "override-dotted"]) {
                expect(elements[id].props, id).toEqual({ animation: { enter: "fade" } });
                expect(elements[id].animation, id).toBeUndefined();
            }
        });
    });
});
