import { describe, expect, it } from "vitest";
import { planSubtreeDuplicateBlueprintRemap } from "./blueprintCopyRemap";

describe("blueprint copy remap", () => {
    it("allocates ids for widgetValue blueprints in copied subtrees", () => {
        const ids = ["new-element", "new-widget-main", "new-widget-value"];
        const plan = planSubtreeDuplicateBlueprintRemap({
            oldElementIds: ["old-element"],
            getWidgetMainBlueprintId: () => "old-widget-main",
            getWidgetValueBlueprintIds: () => ["old-widget-value"],
            generateId: () => ids.shift()!,
        });

        expect(plan.elementIdMap).toEqual({ "old-element": "new-element" });
        expect(plan.widgetMainBlueprintIdMap).toEqual({ "old-widget-main": "new-widget-main" });
        expect(plan.widgetValueBlueprintIdMap).toEqual({ "old-widget-value": "new-widget-value" });
    });
});
