/**
 * What `ui apply` does to the order of the document it writes back.
 *
 * Nothing in Studio reads the key order of the `elements` map - every element is addressed by id -
 * so this is not a correctness test in the usual sense. It is a diff test. The writer used to lift
 * a surface's whole tree out of the map and put it back in tree order, which turned "five elements
 * were added" into twenty thousand lines of moved JSON: the real change was invisible in review,
 * and every other branch touching the same document got a conflict over text nobody had edited.
 *
 * The skeleton is the document this matters most for, so the test applies a change to it.
 *
 * Comments in English per project convention.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { describe, expect, it } from "vitest";
import type { UIDocument } from "@shared/types/ui-editor/document";
import { applyCompiled, mergePreservingOrder } from "./apply";
import { compileUiFile } from "./dsl/compile";
import { parseUiFile } from "./dsl/parse";
import { printSurface } from "./dsl/print";

const SKELETON = path.resolve(
    __dirname,
    "../../../../resources/templates/skeleton/content/editor/ui/uidoc.json",
);

/**
 * The skeleton, with its element map deliberately out of tree order.
 *
 * Shuffled rather than loaded as-is, and that is the whole non-vacuity of this file: the writer
 * this test was written against rebuilt the map in tree order, so a fixture that already happened
 * to BE in tree order could not tell the two writers apart. Reversing is enough and is
 * deterministic - what a real project holds is whatever its editing history left, which is nothing
 * in particular.
 */
function loadSkeleton(): UIDocument {
    const document = JSON.parse(fs.readFileSync(SKELETON, "utf8")) as UIDocument;
    const shuffled: UIDocument["elements"] = {};
    for (const id of Object.keys(document.elements).reverse()) {
        shuffled[id] = document.elements[id]!;
    }
    document.elements = shuffled;
    return document;
}

/** The surface every case here edits: the settings page, and the biggest tree in the skeleton. */
function configSurfaceText(document: UIDocument): string {
    const surface = document.surfaces.find(item => item.name === "Config");
    if (!surface) {
        throw new Error("the skeleton has no Config surface any more; pick another and say why");
    }
    return printSurface(surface, document.elements);
}

/** Apply one surface's text to a fresh copy of the skeleton, and hand back the ids in file order. */
function applySurfaceText(text: string): { document: UIDocument; order: string[] } {
    const document = loadSkeleton();
    const compiled = compileUiFile(parseUiFile(text), { existing: document });
    const errors = compiled.diagnostics.filter(item => item.severity === "error");
    expect(errors.map(item => `${item.code} ${item.message}`)).toEqual([]);
    applyCompiled(document, compiled);
    return { document, order: Object.keys(document.elements) };
}

describe("applying a .ui file keeps the document's key order", () => {
    it("moves nothing at all when the file describes the surface unchanged", () => {
        const before = loadSkeleton();
        const { order } = applySurfaceText(configSurfaceText(before));
        expect(order).toEqual(Object.keys(before.elements));
    });

    it("keeps every untouched key in place, and appends the added ones", () => {
        const before = loadSkeleton();
        const text = configSurfaceText(before);

        // One more row on the page, written the way an author's file would carry it.
        const lines = text.split("\n");
        const paneIndex = lines.findIndex(line => /^ +"Sound pane": nl\.container/.test(line));
        expect(paneIndex, "the Config surface has no Sound pane to add a row to").toBeGreaterThan(-1);
        const paneIndent = (lines[paneIndex]!.match(/^ +/) ?? [""])[0].length;
        const rowIndent = " ".repeat(paneIndent + 4);
        // After the pane's last child: the next line at the pane's own indent, or the end.
        let end = paneIndex + 1;
        while (end < lines.length) {
            const line = lines[end]!;
            const indent = (line.match(/^ +/) ?? [""])[0].length;
            if (line.trim() !== "" && indent <= paneIndent) {
                break;
            }
            end += 1;
        }
        lines.splice(end, 0, `${rowIndent}"Test row": nl.container id=test-order-row @0,0 1140x63`);

        const { document, order } = applySurfaceText(lines.join("\n"));

        expect(document.elements["test-order-row"], "the added element was not written").toBeTruthy();
        // The order the document already had, with the one new id after all of it.
        expect(order.filter(id => id !== "test-order-row")).toEqual(Object.keys(before.elements));
        expect(order[order.length - 1]).toBe("test-order-row");
    });

    it("drops an element the file no longer holds without moving its neighbours", () => {
        const before = loadSkeleton();
        const text = configSurfaceText(before);
        const lines = text.split("\n");

        // The rule under the last volume row: a leaf, so removing its line removes the whole element.
        const leafIndex = lines.findIndex(line => /^ +"Voice rule": nl\.container id=(\S+)/.test(line));
        expect(leafIndex, "the Config surface has no Voice rule to remove").toBeGreaterThan(-1);
        const removedId = lines[leafIndex]!.match(/id=(\S+)/)![1]!;
        const indent = (lines[leafIndex]!.match(/^ +/) ?? [""])[0].length;
        let end = leafIndex + 1;
        while (end < lines.length) {
            const line = lines[end]!;
            const lineIndent = (line.match(/^ +/) ?? [""])[0].length;
            if (line.trim() !== "" && lineIndent <= indent) {
                break;
            }
            end += 1;
        }
        lines.splice(leafIndex, end - leafIndex);

        const { document, order } = applySurfaceText(lines.join("\n"));

        expect(document.elements[removedId]).toBeUndefined();
        expect(order).toEqual(Object.keys(before.elements).filter(id => id !== removedId));
    });
});

/**
 * A page of its own, so the list on it is the only thing that names its item shape. The skeleton's
 * own shapes are named by several lists each, which would hide whether the last one leaving is what
 * drops a shape.
 */
function shelfPage(withList: boolean): string {
    return [
        "struct demo.shelfItem",
        "    field id: string",
        "    field title: string",
        "",
        "surface Shelf id=demo-shelf kind=appSurface size=1920x1080",
        "    Root: nl.root id=demo-shelf-root @0,0 1920x1080",
        ...(withList
            ? [
                "        Shelf: nl.list id=demo-shelf-list @0,0 800x600",
                "            itemStructId = demo.shelfItem",
                "            itemKeyFieldId = id",
            ]
            : ["        Blank: nl.container id=demo-shelf-blank @0,0 800x600"]),
    ].join("\n");
}

/** Apply `text` to `document` in place, as `ui apply` does, and say what it reported. */
function applyText(document: UIDocument, text: string) {
    const compiled = compileUiFile(parseUiFile(text), { existing: document });
    expect(compiled.diagnostics.filter(item => item.severity === "error").map(item => item.message)).toEqual([]);
    return applyCompiled(document, compiled);
}

describe("applying a .ui file to the item shapes", () => {
    it("drops a shape when the apply takes away the last list that named it", () => {
        const document = loadSkeleton();
        applyText(document, shelfPage(true));
        expect(document.structs?.["demo.shelfItem"]).toBeDefined();

        // The same page without its list, and without the struct block: the shape goes with the list.
        const withoutList = shelfPage(false).split("\n").slice(4).join("\n");
        const result = applyText(document, withoutList);

        expect(result.structsRemoved).toEqual(["demo.shelfItem"]);
        expect(document.structs?.["demo.shelfItem"]).toBeUndefined();
        // Every other shape is still named by the lists it was named by, and stays.
        expect(Object.keys(document.structs ?? {})).toEqual(Object.keys(loadSkeleton().structs ?? {}));
    });

    it("keeps a shape the file itself declares, whether or not anything names it yet", () => {
        const document = loadSkeleton();
        applyText(document, shelfPage(true));
        // Declared in the file and named by nothing after it: an author writing the shape before
        // the list that will use it.
        const result = applyText(document, shelfPage(false));
        expect(result.structsRemoved).toEqual([]);
        expect(document.structs?.["demo.shelfItem"]).toBeDefined();
    });

    it("leaves alone a shape nothing named before the apply either", () => {
        const document = loadSkeleton();
        document.structs = { ...document.structs, "demo.unnamed": { id: "demo.unnamed", fields: [] } };
        const result = applyText(document, shelfPage(false).split("\n").slice(4).join("\n"));
        expect(result.structsRemoved).toEqual([]);
        expect(document.structs["demo.unnamed"]).toBeDefined();
    });
});

describe("mergePreservingOrder", () => {
    it("keeps the order it was given, appends what is new, drops what is gone", () => {
        const merged = mergePreservingOrder(
            { a: 1, b: 2, c: 3 },
            { c: 30, a: 10, d: 40 },
        );
        expect(Object.keys(merged)).toEqual(["a", "c", "d"]);
        expect(merged).toEqual({ a: 10, c: 30, d: 40 });
    });
});
