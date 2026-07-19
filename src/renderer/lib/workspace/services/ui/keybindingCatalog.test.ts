import { describe, expect, it } from "vitest";
import { KEYBINDING_CATALOG, getKeybindingCatalogEntry } from "./keybindingCatalog";
import { parseKeybinding } from "./KeybindingService";

describe("KEYBINDING_CATALOG", () => {
    it("has unique ids", () => {
        const ids = KEYBINDING_CATALOG.map(entry => entry.id);
        expect(new Set(ids).size).toBe(ids.length);
    });

    it("declares parseable default chords", () => {
        for (const entry of KEYBINDING_CATALOG) {
            const parsed = parseKeybinding(entry.key, true);
            expect(parsed.key, `catalog entry ${entry.id} has no base key`).not.toBe("");
        }
    });

    it("resolves entries by id", () => {
        expect(getKeybindingCatalogEntry("story.duplicate")).toMatchObject({ key: "mod+d" });
        expect(getKeybindingCatalogEntry("nope")).toBeUndefined();
    });

    it("gives every entry an i18n label and category", () => {
        for (const entry of KEYBINDING_CATALOG) {
            expect(entry.labelKey.length, entry.id).toBeGreaterThan(0);
            expect(entry.categoryKey.startsWith("workspace.shell.keybindings.categories."), entry.id).toBe(true);
        }
    });
});
