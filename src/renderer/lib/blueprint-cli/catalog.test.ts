/**
 * What the catalogue commands promise: that a search finds a node by the words someone would think
 * to type, that the palette filter is the palette's own answer, and that a node's pins are the ones
 * that node instance actually has rather than the ones its definition lists.
 *
 * Comments in English per project convention.
 */

import { describe, expect, it } from "vitest";
import { registerCoreBlueprintNodes } from "@/lib/ui-editor/blueprint-nodes";
import { describeNode, listNodeCategories, queryNodes } from "./catalog";

registerCoreBlueprintNodes();

describe("the node catalogue", () => {
    it("finds a node by a keyword rather than by its type id", () => {
        const found = queryNodes({ search: "sfx" });
        expect(found.map(node => node.type)).toContain("blueprint.sound.play");
    });

    it("requires every word of a search to match", () => {
        expect(queryNodes({ search: "play sound" }).map(node => node.type)).toContain("blueprint.sound.play");
        expect(queryNodes({ search: "play sound nonsense" })).toEqual([]);
    });

    it("leaves out nodes the palette hides, until asked", () => {
        const shown = queryNodes({});
        const all = queryNodes({ includeHidden: true });
        expect(all.length).toBeGreaterThan(shown.length);
        expect(shown.every(node => !node.hideInPalette)).toBe(true);
    });

    it("filters by the owner a blueprint would have", () => {
        // Send Broadcast is scoped to surfaces and widgets; a global blueprint is not offered it.
        const forWidget = queryNodes({ ownerKind: "widgetMain", widgetElementType: "nl.button" });
        const forGlobal = queryNodes({ ownerKind: "globalMain" });
        expect(forWidget.map(node => node.type)).toContain("blueprint.broadcast.send");
        expect(forGlobal.map(node => node.type)).not.toContain("blueprint.broadcast.send");
    });

    it("answers with the pins an instance has, not only the ones declared", () => {
        const plain = describeNode("blueprint.layer.confirm");
        const withButtons = describeNode("blueprint.layer.confirm", {
            __confirmButtonPins: ["button_1_label", "button_1_pressed"],
        });
        expect(plain?.pins.map(pin => pin.id)).not.toContain("button_1_pressed");
        expect(withButtons?.pins.map(pin => pin.id)).toContain("button_1_pressed");
        expect(withButtons?.dynamicPins?.storageKey).toBe("__confirmButtonPins");
    });

    it("says nothing about a node type that does not exist", () => {
        expect(describeNode("blueprint.no.such.thing")).toBeNull();
    });

    it("counts every registered node across its categories", () => {
        const categories = listNodeCategories();
        const total = categories.reduce((sum, item) => sum + item.count, 0);
        expect(total).toBe(queryNodes({ includeHidden: true }).length);
    });
});
