/**
 * The skeleton's palette carries colours of its own beside the seeded ones - the page background,
 * the panels, the fill above them, the subtle text, the hover border and the selected fill its
 * screens are painted in - and Project ▸ Design is where an author finds and changes them.
 *
 * The page lists every colour but the control slots Studio seeds, which it draws under their control
 * (`isBrandControlSlotId` in `@shared/types/brand`). A dot in an id reads as one of those slots
 * (`button.primary`), so the template's own colours have ids without one. And the page shows a
 * colour's name rather than its id, so each one is named in the language the project is written in.
 *
 * Read the way the wizard lands a project: the English content, with a variant's own files laid
 * over it when the author writes in that language.
 *
 * Comments in English per project convention.
 */
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { collectBrandLinkReferences } from "@shared/brand/brandReferences";
import { BrandPalette } from "@shared/brand/brandRegistry";
import { isBrandControlSlotId, normalizeProjectBrandColors, type BrandColor } from "@shared/types/brand";
import { collectBrokenBrandLinks } from "@/lib/lint/rules/brand";

const TEMPLATE = path.join(process.cwd(), "resources/templates/skeleton");

const LANGUAGES = [
    { name: "English", variant: null },
    { name: "Chinese", variant: "content.zh" },
    { name: "Japanese", variant: "content.ja" },
] as const;

/** The file a project made in this language ends up with: the variant's copy when it has one. */
function landed(variant: string | null, relative: string): string {
    const override = variant ? path.join(TEMPLATE, variant, relative) : null;
    return override && fs.existsSync(override) ? override : path.join(TEMPLATE, "content", relative);
}

function readJson<T>(file: string): T {
    return JSON.parse(fs.readFileSync(file, "utf-8")) as T;
}

function palette(variant: string | null): BrandColor[] {
    return normalizeProjectBrandColors(readJson<{ colors: unknown }>(landed(variant, "editor/brand.json")).colors);
}

/** The colours the template adds to the seeded palette. */
function ownColors(variant: string | null): BrandColor[] {
    return palette(variant).filter(color => !color.builtin);
}

describe.each(LANGUAGES)("the skeleton's palette in $name", ({ variant }) => {
    it("lists every colour of its own on Project ▸ Design", () => {
        const own = ownColors(variant);
        expect(own.length).toBeGreaterThan(0);
        for (const color of own) {
            expect(isBrandControlSlotId(color.id), `${color.id} is drawn as a control slot`).toBe(false);
            expect(color.id.includes("."), `${color.id} reads as a control slot`).toBe(false);
        }
    });

    it("names each one, in the language the project is written in", () => {
        const english = new Map(ownColors(null).map(color => [color.id, color.name]));
        const own = ownColors(variant);
        expect(own.map(color => color.id)).toEqual([...english.keys()]);
        for (const color of own) {
            expect(color.name?.trim(), `${color.id} has no name`).toBeTruthy();
            if (variant) {
                expect(color.name, `${color.id} is still named in English`).not.toBe(english.get(color.id));
            }
        }
    });

    it("paints every link in the interface, and each of its own colours paints something", () => {
        const references = collectBrandLinkReferences({ uidoc: readJson(landed(variant, "editor/ui/uidoc.json")) });
        const colors = palette(variant);
        expect(collectBrokenBrandLinks(references, new BrandPalette(colors))).toEqual([]);
        const used = new Set(references.map(reference => reference.id));
        for (const color of ownColors(variant)) {
            expect(used.has(color.id), `nothing is painted in ${color.id}`).toBe(true);
        }
        // And the check above can fail: without the template's own colours, links break.
        expect(collectBrokenBrandLinks(references, new BrandPalette(colors.filter(color => color.builtin))).length)
            .toBeGreaterThan(0);
    });
});
