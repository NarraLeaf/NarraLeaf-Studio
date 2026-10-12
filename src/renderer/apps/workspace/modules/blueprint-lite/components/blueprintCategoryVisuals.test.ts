/**
 * Every built-in palette category is drawn with an icon of its own.
 *
 * The table used to name fourteen categories and draw the other fifteen - Game, Time, Sound, Voice,
 * Network, every widget's - with one shared gear, so the chip row read as a row of identical icons.
 */
import { describe, expect, it } from "vitest";
import { blueprintNodeRegistry } from "@/lib/ui-editor/blueprint-nodes/BlueprintNodeRegistry";
import { registerCoreBlueprintNodes } from "@/lib/ui-editor/blueprint-nodes/registerCoreBlueprintNodes";
import { BLUEPRINT_ADD_NODE_ALL_CATEGORY_ID } from "./BlueprintAddNodeMenuModel";
import { getBlueprintCategoryVisual, hasOwnBlueprintCategoryVisual } from "./blueprintCategoryVisuals";

function builtInCategories(): string[] {
    registerCoreBlueprintNodes();
    return [...new Set(blueprintNodeRegistry.list().map(def => def.category))].sort();
}

describe("blueprint category visuals", () => {
    it("gives every built-in category an icon of its own", () => {
        const categories = builtInCategories();
        expect(categories.length).toBeGreaterThan(20);
        expect(categories.filter(category => !hasOwnBlueprintCategoryVisual(category))).toEqual([]);
    });

    it("draws no two built-in categories, nor the All chip, with the same icon", () => {
        const categories = [BLUEPRINT_ADD_NODE_ALL_CATEGORY_ID, ...builtInCategories()];
        const byIcon = new Map<unknown, string[]>();
        for (const category of categories) {
            const icon = getBlueprintCategoryVisual(category).icon;
            byIcon.set(icon, [...(byIcon.get(icon) ?? []), category]);
        }
        expect([...byIcon.values()].filter(group => group.length > 1)).toEqual([]);
    });

    it("draws a category a plugin brings with the plugin icon", () => {
        expect(hasOwnBlueprintCategoryVisual("Steam Achievements")).toBe(false);
        expect(getBlueprintCategoryVisual("Steam Achievements").icon).toBe(getBlueprintCategoryVisual("Another Plugin").icon);
    });
});
