import { describe, expect, it } from "vitest";
import type { DocumentDiffEntry } from "@shared/documents/diff";
import { en } from "@shared/i18n/catalog/en";
import { zh } from "@shared/i18n/catalog/zh";
import { DEFAULT_FONT_SAMPLE_SIZE, FONT_SAMPLE_SIZES, isFontEntry, nextFontFamily } from "./fontPreview";

/**
 * The two decisions a type comparison is made of, plus the one property of the specimen that has
 * to hold in every locale.
 */

const entry = (path: string, over: Partial<DocumentDiffEntry> = {}): DocumentDiffEntry => ({
    path,
    kind: "changed",
    diff: { changes: [], complete: true, total: 0, tier: "content" },
    ...over,
});

describe("which files this draws", () => {
    it("claims what the comparison classified as a font, name or no name", () => {
        expect(isFontEntry(entry("assets/content/99/55/3d15abb54213bad7203798a1adc4", {
            contentClass: "font",
        }))).toBe(true);
        expect(isFontEntry(entry("assets/content/SourceHanSans.otf"))).toBe(true);
        expect(isFontEntry(entry("assets/content/ui.woff2"))).toBe(true);
    });

    it("declines everything else, including an SVG the asset browser also files as a font", () => {
        // An SVG is XML and is compared as text, where a comparison can say which line changed.
        expect(isFontEntry(entry("assets/content/logo.svg"))).toBe(false);
        expect(isFontEntry(entry("assets/content/sprite.png"))).toBe(false);
        expect(isFontEntry(entry("assets/content/fake.ttf", { contentClass: "bitmap" }))).toBe(false);
    });
});

describe("installing two versions of one typeface", () => {
    it("never gives the two sides the same family name", () => {
        // Both files call themselves the same thing, so installed under their own name the second
        // would win and both specimens would draw the newer version - a comparison of one file
        // with itself, with nothing on screen to say so.
        const names = new Set([nextFontFamily(), nextFontFamily(), nextFontFamily()]);

        expect(names.size).toBe(3);
    });
});

describe("the specimen", () => {
    it("opens at a size that is on the list", () => {
        expect(FONT_SAMPLE_SIZES).toContain(DEFAULT_FONT_SAMPLE_SIZE);
        expect([...FONT_SAMPLE_SIZES].sort((a, b) => a - b)).toEqual([...FONT_SAMPLE_SIZES]);
    });

    for (const [locale, catalog] of [["en", en], ["zh", zh]] as const) {
        it(`carries both scripts in ${locale}`, () => {
            // A font in a project of this kind is usually installed to set Chinese, and a Latin
            // pangram cannot show whether the Chinese glyphs came with it: with none in the file
            // the browser draws them from a system face and both sides look correct.
            const sample = catalog.documentDiff.presenter.font.sample;

            expect(sample).toMatch(/[A-Za-z]/);
            expect(sample).toMatch(/[一-鿿]/);
        });
    }
});
