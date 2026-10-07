import { describe, expect, it } from "vitest";
import { translate } from "@/lib/i18n";
import {
    BUILTIN_EDITOR_FONT_ID_PREFIX,
    editorBuiltinFontVirtualGroup,
    getBuiltinEditorFontCssFamily,
    getBuiltinEditorFontDisplayName,
} from "./builtinVirtualEditorFonts";

describe("the font picker's built-in group", () => {
    it("names its generic stacks and itself from the catalog, and keeps a typeface's own name", () => {
        const group = editorBuiltinFontVirtualGroup();
        expect(group.title).toBe(translate("brand.fonts.builtin.group"));
        const names = Object.fromEntries(group.assets.map(asset => [asset.id, asset.name]));
        expect(names[`${BUILTIN_EDITOR_FONT_ID_PREFIX}system-ui`]).toBe(translate("brand.fonts.builtin.systemUi"));
        expect(names[`${BUILTIN_EDITOR_FONT_ID_PREFIX}serif`]).toBe(translate("brand.fonts.builtin.serif"));
        expect(names[`${BUILTIN_EDITOR_FONT_ID_PREFIX}georgia`]).toBe("Georgia");
    });

    it("prints the kind of typeface under each row, not bookkeeping tags", () => {
        for (const asset of editorBuiltinFontVirtualGroup().assets) {
            expect(asset.tags).toEqual([]);
            expect(asset.description).not.toBe("");
        }
        const consolas = editorBuiltinFontVirtualGroup().assets.find(asset => asset.id.endsWith("consolas"));
        expect(consolas?.description).toBe(translate("brand.fonts.builtin.kind.monospace"));
    });

    it("answers a stack's name and CSS family by id, wherever the id is shown", () => {
        const id = `${BUILTIN_EDITOR_FONT_ID_PREFIX}monospace`;
        expect(getBuiltinEditorFontDisplayName(id)).toBe(translate("brand.fonts.builtin.monospace"));
        expect(getBuiltinEditorFontCssFamily(id)).toBe("monospace");
        expect(getBuiltinEditorFontDisplayName("not-a-builtin")).toBeNull();
    });
});
