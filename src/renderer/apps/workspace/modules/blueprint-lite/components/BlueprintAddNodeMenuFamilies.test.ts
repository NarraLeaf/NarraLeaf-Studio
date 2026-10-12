/**
 * The palette lists a node family as one row while it is browsed, and every member while it is
 * searched.
 *
 * Browsing is where the length of the catalogue is felt - six comparison rows, eighteen preference
 * getters - and a search names the one node the author wants, which the family row would only put
 * one click further away.
 */
import { describe, expect, it } from "vitest";
import {
    BLUEPRINT_NODE_TYPE_COMPARE_EQUAL,
    BLUEPRINT_NODE_TYPE_COMPARE_GREATER_THAN,
    BLUEPRINT_NODE_TYPE_EVENT_HEAD_KEY_DOWN,
} from "@shared/types/blueprint/graph";
import { blueprintNodeRegistry } from "@/lib/ui-editor/blueprint-nodes/BlueprintNodeRegistry";
import { registerCoreBlueprintNodes } from "@/lib/ui-editor/blueprint-nodes/registerCoreBlueprintNodes";
import { blueprintNodeFamilyOf } from "@/lib/ui-editor/blueprint-nodes/blueprintNodeFamilies";
import type { BlueprintNodeEditorCatalogEntry } from "@/lib/ui-editor/blueprint-nodes/types";
import {
    buildBlueprintAddNodeCategories,
    filterBlueprintAddNodeEntries,
    foldBlueprintAddNodeFamilies,
} from "./BlueprintAddNodeMenuModel";

function globalPalette(): BlueprintNodeEditorCatalogEntry[] {
    registerCoreBlueprintNodes();
    return blueprintNodeRegistry.listPaletteEntries({ graphKind: "event", owner: { kind: "globalMain" } });
}

const COMPARE_TYPES = [...blueprintNodeFamilyOf(BLUEPRINT_NODE_TYPE_COMPARE_EQUAL)!.members];

describe("node families in the add-node palette", () => {
    it("lists each family as one row, placing its first member", () => {
        const entries = globalPalette();
        const folded = foldBlueprintAddNodeFamilies(entries);

        const compareRows = folded.filter(entry => COMPARE_TYPES.includes(entry.type));
        expect(compareRows).toHaveLength(1);
        expect(compareRows[0]!.type).toBe(BLUEPRINT_NODE_TYPE_COMPARE_EQUAL);
        expect(compareRows[0]!.family?.id).toBe("compare");
        expect(compareRows[0]!.family?.members.map(member => member.type)).toEqual(COMPARE_TYPES);

        const keyRows = folded.filter(entry => blueprintNodeFamilyOf(entry.type)?.id === "key");
        expect(keyRows.map(entry => entry.type)).toEqual([BLUEPRINT_NODE_TYPE_EVENT_HEAD_KEY_DOWN]);

        expect(folded.length).toBeLessThan(entries.length - 40);
    });

    it("counts a category's chip in the rows it opens on", () => {
        const folded = foldBlueprintAddNodeFamilies(globalPalette());
        const math = buildBlueprintAddNodeCategories(folded).find(category => category.id === "Math");
        expect(math?.count).toBe(folded.filter(entry => entry.category === "Math").length);
    });

    it("answers a search from every member, not from the family's row", () => {
        const entries = globalPalette();
        expect(filterBlueprintAddNodeEntries(entries, "all", ">")[0]?.type).toBe(BLUEPRINT_NODE_TYPE_COMPARE_GREATER_THAN);
        expect(filterBlueprintAddNodeEntries(entries, "all", "greater than")[0]?.type).toBe(BLUEPRINT_NODE_TYPE_COMPARE_GREATER_THAN);
    });

    it("finds every member by the family's name", () => {
        const entries = globalPalette();
        const results = filterBlueprintAddNodeEntries(entries, "all", "比较", {
            title: displayName => displayName,
            category: category => category,
            familyTitle: type => (blueprintNodeFamilyOf(type)?.id === "compare" ? "比较" : undefined),
        });
        expect(results.slice(0, COMPARE_TYPES.length).map(entry => entry.type).sort()).toEqual([...COMPARE_TYPES].sort());
    });

    it("leaves an entry made for one struct field as it is", () => {
        const entries = globalPalette();
        const greater = entries.find(entry => entry.type === BLUEPRINT_NODE_TYPE_COMPARE_GREATER_THAN)!;
        const preset: BlueprintNodeEditorCatalogEntry = {
            ...greater,
            preset: { key: "field", params: {}, title: "Field", subtitle: "Fields" },
        };
        const folded = foldBlueprintAddNodeFamilies([preset, ...entries]);
        expect(folded[0]).toBe(preset);
    });
});
