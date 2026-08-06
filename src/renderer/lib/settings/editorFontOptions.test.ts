import { describe, expect, it } from "vitest";
import {
    EDITOR_FONT_FAMILY_DEFAULT,
    EDITOR_FONT_FAMILY_PRESETS,
    EDITOR_FONT_PRESET_STACKS,
    editorFontCssFamily,
    isEditorFontPreset,
    sanitizeFontFamilyName,
} from "./editorFontOptions";

/**
 * The stored value is untyped JSON off global state and, since the picker opens onto whatever fonts
 * a machine happens to have, it is no longer drawn from a list this build knows. So every value has
 * to land on a usable CSS `font-family`: a preset written by an older build, a family name from a
 * machine that has since been reinstalled, or the `undefined` a first run hands back.
 */
describe("editorFontCssFamily", () => {
    it("resolves every preset the settings page can produce", () => {
        for (const preset of EDITOR_FONT_FAMILY_PRESETS) {
            expect(editorFontCssFamily(preset), preset).toBe(EDITOR_FONT_PRESET_STACKS[preset]);
        }
    });

    it("falls back to the default for anything it cannot use", () => {
        const fallback = EDITOR_FONT_PRESET_STACKS[EDITOR_FONT_FAMILY_DEFAULT];
        for (const stored of [undefined, null, "", "   ", true, 1, {}, []]) {
            expect(editorFontCssFamily(stored), JSON.stringify(stored)).toBe(fallback);
        }
    });

    it("quotes a chosen family and leaves a tail behind it", () => {
        const css = editorFontCssFamily("PingFang SC");
        expect(css.startsWith("\"PingFang SC\", ")).toBe(true);
        // A picked face is rarely complete; without a tail its gaps fall to Chromium's standard
        // font rather than to the one the rest of Studio is set in.
        expect(css.length).toBeGreaterThan("\"PingFang SC\", ".length);
    });

    /**
     * The name is interpolated into a CSS value, so the characters that could end the declaration
     * (or the quoted string around it) must not survive the trip. A name is user-facing data — it
     * arrives from the OS font table, or from a hand-edited global.json.
     */
    it("cannot be talked out of the font-family declaration", () => {
        const injected = editorFontCssFamily("Evil\"; background: url(x); font-family: \"Comic");
        expect(injected).not.toContain(";");
        expect(injected).not.toContain("url(");
        // Same number of quotes as an innocent name resolves to: the two around the family, plus
        // whatever the fallback stack quotes for itself. One more would be an escaped string.
        const innocent = editorFontCssFamily("Comic Sans MS");
        expect(injected.match(/"/g)).toHaveLength(innocent.match(/"/g)!.length);
    });
});

describe("sanitizeFontFamilyName", () => {
    it("keeps ordinary family names, spaces, digits and CJK included", () => {
        expect(sanitizeFontFamilyName("Alibaba PuHuiTi 3.0")).toBe("Alibaba PuHuiTi 3.0");
        expect(sanitizeFontFamilyName("思源黑体 CN")).toBe("思源黑体 CN");
    });

    it("collapses the whitespace a stripped character leaves behind", () => {
        expect(sanitizeFontFamilyName("  Fira   Code  ")).toBe("Fira Code");
        expect(sanitizeFontFamilyName("Fira\nCode")).toBe("Fira Code");
    });

    it("returns nothing usable for a name that is only punctuation", () => {
        expect(sanitizeFontFamilyName("\";{}")).toBe("");
        expect(sanitizeFontFamilyName(undefined)).toBe("");
    });

    it("bounds the length, so a pathological value cannot become the style attribute", () => {
        expect(sanitizeFontFamilyName("a".repeat(500))).toHaveLength(120);
    });
});

describe("isEditorFontPreset", () => {
    it("recognises the presets and nothing else", () => {
        for (const preset of EDITOR_FONT_FAMILY_PRESETS) {
            expect(isEditorFontPreset(preset), preset).toBe(true);
        }
        for (const other of ["Helvetica", "default", "", undefined, 3]) {
            expect(isEditorFontPreset(other), JSON.stringify(other)).toBe(false);
        }
    });
});
