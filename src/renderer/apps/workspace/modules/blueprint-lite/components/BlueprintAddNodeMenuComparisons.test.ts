/**
 * The palette offers one set of comparison nodes, and an operator typed into its search finds it.
 *
 * There used to be two sets side by side - `blueprint.math.*` titled with the bare symbols and
 * `blueprint.compare.*` titled in words - and nothing said how they differed. The symbol set is kept
 * registered so the graphs holding it still load and run, and kept out of the palette. Which leaves
 * the symbols themselves as the thing an author types to find a comparison, and the search used to
 * drop a query with no letters in it and list the whole catalogue.
 */
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
    BLUEPRINT_NODE_TYPE_COMPARE_EQUAL,
    BLUEPRINT_NODE_TYPE_COMPARE_GREATER_THAN,
    BLUEPRINT_NODE_TYPE_COMPARE_GREATER_THAN_OR_EQUAL,
    BLUEPRINT_NODE_TYPE_COMPARE_LESS_THAN,
    BLUEPRINT_NODE_TYPE_COMPARE_LESS_THAN_OR_EQUAL,
    BLUEPRINT_NODE_TYPE_COMPARE_NOT_EQUAL,
    BLUEPRINT_NODE_TYPE_MATH_EQUAL,
    BLUEPRINT_NODE_TYPE_MATH_GREATER,
    BLUEPRINT_NODE_TYPE_MATH_GREATER_OR_EQUAL,
    BLUEPRINT_NODE_TYPE_MATH_LESS,
    BLUEPRINT_NODE_TYPE_MATH_LESS_OR_EQUAL,
    BLUEPRINT_NODE_TYPE_MATH_NOT_EQUAL,
} from "@shared/types/blueprint/graph";
import { blueprintNodeRegistry } from "@/lib/ui-editor/blueprint-nodes/BlueprintNodeRegistry";
import { registerCoreBlueprintNodes } from "@/lib/ui-editor/blueprint-nodes/registerCoreBlueprintNodes";
import type { BlueprintNodeEditorCatalogEntry } from "@/lib/ui-editor/blueprint-nodes/types";
import { filterBlueprintAddNodeEntries } from "./BlueprintAddNodeMenuModel";

const HIDDEN_MATH_COMPARISONS = [
    BLUEPRINT_NODE_TYPE_MATH_EQUAL,
    BLUEPRINT_NODE_TYPE_MATH_NOT_EQUAL,
    BLUEPRINT_NODE_TYPE_MATH_LESS,
    BLUEPRINT_NODE_TYPE_MATH_LESS_OR_EQUAL,
    BLUEPRINT_NODE_TYPE_MATH_GREATER,
    BLUEPRINT_NODE_TYPE_MATH_GREATER_OR_EQUAL,
];

const COMPARISONS = [
    BLUEPRINT_NODE_TYPE_COMPARE_EQUAL,
    BLUEPRINT_NODE_TYPE_COMPARE_NOT_EQUAL,
    BLUEPRINT_NODE_TYPE_COMPARE_LESS_THAN,
    BLUEPRINT_NODE_TYPE_COMPARE_LESS_THAN_OR_EQUAL,
    BLUEPRINT_NODE_TYPE_COMPARE_GREATER_THAN,
    BLUEPRINT_NODE_TYPE_COMPARE_GREATER_THAN_OR_EQUAL,
];

function paletteFor(owner: Parameters<typeof blueprintNodeRegistry.listPaletteEntries>[0]["owner"]): BlueprintNodeEditorCatalogEntry[] {
    registerCoreBlueprintNodes();
    return blueprintNodeRegistry.listPaletteEntries({ graphKind: "event", owner });
}

function firstFor(entries: readonly BlueprintNodeEditorCatalogEntry[], query: string): string | undefined {
    return filterBlueprintAddNodeEntries(entries, "all", query)[0]?.type;
}

describe("comparison nodes in the add-node palette", () => {
    it("keeps the symbol-titled Math comparisons registered but out of every palette", () => {
        registerCoreBlueprintNodes();
        for (const type of HIDDEN_MATH_COMPARISONS) {
            expect(blueprintNodeRegistry.get(type)?.hideInPalette, type).toBe(true);
        }
        for (const owner of [
            { kind: "globalMain" as const },
            { kind: "surfaceMain" as const, surfaceId: "surface" },
            { kind: "widgetMain" as const, surfaceId: "surface", elementId: "button" },
        ]) {
            const types = new Set(paletteFor(owner).map(entry => entry.type));
            expect(HIDDEN_MATH_COMPARISONS.filter(type => types.has(type)), owner.kind).toEqual([]);
            expect(COMPARISONS.filter(type => !types.has(type)), owner.kind).toEqual([]);
        }
    });

    it("finds each comparison by the operator an author types", () => {
        const entries = paletteFor({ kind: "globalMain" });
        const cases: Array<[string, string]> = [
            [">", BLUEPRINT_NODE_TYPE_COMPARE_GREATER_THAN],
            [">=", BLUEPRINT_NODE_TYPE_COMPARE_GREATER_THAN_OR_EQUAL],
            ["≥", BLUEPRINT_NODE_TYPE_COMPARE_GREATER_THAN_OR_EQUAL],
            ["<", BLUEPRINT_NODE_TYPE_COMPARE_LESS_THAN],
            ["<=", BLUEPRINT_NODE_TYPE_COMPARE_LESS_THAN_OR_EQUAL],
            ["≤", BLUEPRINT_NODE_TYPE_COMPARE_LESS_THAN_OR_EQUAL],
            ["=", BLUEPRINT_NODE_TYPE_COMPARE_EQUAL],
            ["==", BLUEPRINT_NODE_TYPE_COMPARE_EQUAL],
            ["!=", BLUEPRINT_NODE_TYPE_COMPARE_NOT_EQUAL],
            ["≠", BLUEPRINT_NODE_TYPE_COMPARE_NOT_EQUAL],
            ["gt", BLUEPRINT_NODE_TYPE_COMPARE_GREATER_THAN],
            ["gte", BLUEPRINT_NODE_TYPE_COMPARE_GREATER_THAN_OR_EQUAL],
            ["lt", BLUEPRINT_NODE_TYPE_COMPARE_LESS_THAN],
            ["lte", BLUEPRINT_NODE_TYPE_COMPARE_LESS_THAN_OR_EQUAL],
            ["neq", BLUEPRINT_NODE_TYPE_COMPARE_NOT_EQUAL],
            // What a Chinese or Japanese keyboard types for the same keys.
            ["＞", BLUEPRINT_NODE_TYPE_COMPARE_GREATER_THAN],
            ["》", BLUEPRINT_NODE_TYPE_COMPARE_GREATER_THAN],
            ["《", BLUEPRINT_NODE_TYPE_COMPARE_LESS_THAN],
            ["＝", BLUEPRINT_NODE_TYPE_COMPARE_EQUAL],
        ];
        for (const [query, type] of cases) {
            expect(firstFor(entries, query), query).toBe(type);
        }
    });

    it("narrows an operator search to the entries that carry the operator", () => {
        const entries = paletteFor({ kind: "globalMain" });
        const found = filterBlueprintAddNodeEntries(entries, "all", ">").map(entry => entry.type);

        expect(found.length).toBeLessThan(entries.length);
        expect(found.slice(0, 2)).toEqual([
            BLUEPRINT_NODE_TYPE_COMPARE_GREATER_THAN,
            BLUEPRINT_NODE_TYPE_COMPARE_GREATER_THAN_OR_EQUAL,
        ]);
        expect(found).not.toContain(BLUEPRINT_NODE_TYPE_COMPARE_LESS_THAN);
    });

    it("leaves a query with words in it to the word search, separators and all", () => {
        const entries = paletteFor({ kind: "globalMain" });

        expect(firstFor(entries, "compare.greaterThan")).toBe(BLUEPRINT_NODE_TYPE_COMPARE_GREATER_THAN);
        expect(firstFor(entries, "greater-than")).toBe(BLUEPRINT_NODE_TYPE_COMPARE_GREATER_THAN);
    });

    it("ships no palette-hidden comparison in the skeleton project, in any of its languages", () => {
        // A template is what an author learns the palette from; a node in it that the palette
        // cannot give them back is one they can copy but never find.
        const root = path.join(process.cwd(), "resources/templates/skeleton");
        for (const variant of ["content", "content.zh", "content.ja"]) {
            const text = fs.readFileSync(path.join(root, variant, "editor/ui/uigraphs.json"), "utf8");
            expect(HIDDEN_MATH_COMPARISONS.filter(type => text.includes(`"${type}"`)), variant).toEqual([]);
        }
    });

    it("gives every comparison a description", () => {
        registerCoreBlueprintNodes();
        for (const type of COMPARISONS) {
            expect(blueprintNodeRegistry.get(type)?.description, type).toBeTruthy();
        }
    });
});
