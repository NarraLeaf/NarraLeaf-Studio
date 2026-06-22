import { describe, expect, it } from "vitest";
import type { BlueprintNodeEditorCatalogEntry } from "@/lib/ui-editor/blueprint-nodes/types";
import {
    BLUEPRINT_ADD_NODE_ALL_CATEGORY_ID,
    buildBlueprintAddNodeCategories,
    filterBlueprintAddNodeEntries,
} from "./BlueprintAddNodeMenuModel";

const entries = [
    entry({
        type: "nl.event.init",
        displayName: "On Init",
        category: "Events",
        keywords: ["startup"],
        isPure: false,
        inputs: 0,
        outputs: 1,
    }),
    entry({
        type: "nl.math.add",
        displayName: "Add",
        category: "Math",
        keywords: ["sum", "plus"],
        isPure: true,
        inputs: 2,
        outputs: 1,
    }),
    entry({
        type: "nl.data.string",
        displayName: "String Literal",
        category: "Data",
        keywords: ["text"],
        isPure: true,
        inputs: 0,
        outputs: 1,
    }),
] satisfies BlueprintNodeEditorCatalogEntry[];

describe("BlueprintAddNodeMenuModel", () => {
    it("builds an All category without dropping registry-filtered entries", () => {
        const categories = buildBlueprintAddNodeCategories(entries);

        expect(categories[0]).toEqual({ id: BLUEPRINT_ADD_NODE_ALL_CATEGORY_ID, label: "All", count: 3 });
        expect(categories.map(category => category.id)).toEqual(["all", "Events", "Data", "Math"]);
    });

    it("orders documented blueprint node categories before fallback categories", () => {
        const categories = buildBlueprintAddNodeCategories([
            ...entries,
            entry({
                type: "if",
                displayName: "If",
                category: "Flow",
                keywords: ["branch"],
                isPure: false,
                inputs: 1,
                outputs: 2,
            }),
            entry({
                type: "blueprint.string.concat",
                displayName: "Concat",
                category: "String",
                keywords: ["string"],
                isPure: true,
                inputs: 2,
                outputs: 1,
            }),
            entry({
                type: "blueprint.data.jsonMakeObject",
                displayName: "Make JSON Object",
                category: "JSON",
                keywords: ["json"],
                isPure: true,
                inputs: 2,
                outputs: 1,
            }),
            entry({
                type: "blueprint.text.setText",
                displayName: "Set Text",
                category: "Text",
                keywords: ["text"],
                isPure: false,
                inputs: 1,
                outputs: 0,
            }),
            entry({
                type: "blueprint.frame.emit",
                displayName: "Emit Page Event",
                category: "Page",
                keywords: ["page"],
                isPure: false,
                inputs: 1,
                outputs: 1,
            }),
            entry({
                type: "blueprint.local.get",
                displayName: "Get Var",
                category: "Variables",
                keywords: ["get", "local", "variable"],
                isPure: true,
                inputs: 0,
                outputs: 1,
            }),
        ]);

        expect(categories.map(category => category.id)).toEqual([
            "all",
            "Events",
            "Flow",
            "Page",
            "Variables",
            "Data",
            "JSON",
            "Math",
            "String",
            "Text",
        ]);
    });

    it("shows all entries in the active category when the query is empty", () => {
        const result = filterBlueprintAddNodeEntries(entries, "Math", "");

        expect(result.map(item => item.type)).toEqual(["nl.math.add"]);
    });

    it("matches display name, type, category, and keywords", () => {
        expect(filterBlueprintAddNodeEntries(entries, "all", "literal").map(item => item.type)).toEqual([
            "nl.data.string",
        ]);
        expect(filterBlueprintAddNodeEntries(entries, "all", "math.add").map(item => item.type)).toEqual([
            "nl.math.add",
        ]);
        expect(filterBlueprintAddNodeEntries(entries, "all", "events").map(item => item.type)).toEqual([
            "nl.event.init",
        ]);
        expect(filterBlueprintAddNodeEntries(entries, "all", "startup").map(item => item.type)).toEqual([
            "nl.event.init",
        ]);
    });

    it("applies category and query filters together", () => {
        expect(filterBlueprintAddNodeEntries(entries, "Data", "literal").map(item => item.type)).toEqual([
            "nl.data.string",
        ]);
        expect(filterBlueprintAddNodeEntries(entries, "Math", "literal")).toEqual([]);
    });
});

function entry(input: {
    type: string;
    displayName: string;
    category: string;
    keywords: string[];
    isPure: boolean;
    inputs: number;
    outputs: number;
}): BlueprintNodeEditorCatalogEntry {
    return {
        type: input.type,
        displayName: input.displayName,
        category: input.category,
        keywords: input.keywords,
        isPure: input.isPure,
        graphKinds: ["event", "function"],
        pins: [
            ...Array.from({ length: input.inputs }, (_, index) => ({
                id: `in${index}`,
                kind: "input" as const,
                semantic: "data" as const,
            })),
            ...Array.from({ length: input.outputs }, (_, index) => ({
                id: `out${index}`,
                kind: "output" as const,
                semantic: "data" as const,
            })),
        ],
    };
}
