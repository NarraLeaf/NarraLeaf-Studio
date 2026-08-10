import { describe, expect, it } from "vitest";
import {
    BRAND_CONTROL_GROUPS,
    BRAND_SCHEMA_VERSION,
    BUILTIN_BRAND_COLORS,
    builtinBrandColor,
    createEmptyProjectBrandDocument,
    isBuiltinBrandColorId,
    migrateProjectBrandDocument,
    normalizeProjectBrandColors,
} from "./brand";
import { parseBrandLink } from "@shared/brand/brandLink";

describe("the seeded palette", () => {
    it("gives every seed an id a link can address", () => {
        for (const seed of BUILTIN_BRAND_COLORS) {
            expect(parseBrandLink(`nlbrand:${seed.id}`), seed.id)
                .toEqual({ id: seed.id, alpha: 1, alphaExplicit: false });
        }
    });

    it("only ever links to another seed", () => {
        for (const seed of BUILTIN_BRAND_COLORS) {
            const link = parseBrandLink(seed.value);
            if (link) {
                expect(isBuiltinBrandColorId(link.id), `${seed.id} -> ${link.id}`).toBe(true);
            }
        }
    });

    it("names its seeds nowhere but the panel", () => {
        // A name here would be an English word inside a shared model, read verbatim by a zh project.
        expect(BUILTIN_BRAND_COLORS.every(seed => seed.name === undefined)).toBe(true);
        expect(BUILTIN_BRAND_COLORS.every(seed => seed.builtin === true)).toBe(true);
    });

    it("groups the dotted slots and leaves the flat semantic colours out", () => {
        expect(BRAND_CONTROL_GROUPS.map(group => group.id)).toEqual(["button", "container", "text", "textInput"]);
        expect(BRAND_CONTROL_GROUPS.flatMap(group => group.slotIds)).toEqual(
            BUILTIN_BRAND_COLORS.filter(seed => seed.id.includes(".")).map(seed => seed.id),
        );
    });
});

describe("normalizeProjectBrandColors", () => {
    it("seeds a palette that has never been written", () => {
        expect(normalizeProjectBrandColors([]).map(entry => entry.id))
            .toEqual(BUILTIN_BRAND_COLORS.map(seed => seed.id));
        expect(normalizeProjectBrandColors(null)).toHaveLength(BUILTIN_BRAND_COLORS.length);
    });

    it("puts a missing seed back, in front, in seed order", () => {
        const colors = normalizeProjectBrandColors([
            { id: "mine", value: "#123456" },
            { id: "primary", value: "#FF0000" },
        ]);

        // Everything but `primary` was missing, so the file's own two rows land after the re-seeded
        // ones and the seeded order is the order they come back in.
        const reseeded = BUILTIN_BRAND_COLORS.filter(seed => seed.id !== "primary").map(seed => seed.id);
        expect(colors.map(entry => entry.id)).toEqual([...reseeded, "mine", "primary"]);
        // The author's own value for a seed is kept; only the absent ones are re-seeded.
        expect(colors.find(entry => entry.id === "primary")?.value).toBe("#FF0000");
        expect(colors.find(entry => entry.id === "secondary")?.value).toBe("#2E6E80");
    });

    it("keeps the author's order when nothing is missing", () => {
        const authored = [...BUILTIN_BRAND_COLORS].reverse().map(seed => ({ ...seed }));

        expect(normalizeProjectBrandColors(authored).map(entry => entry.id))
            .toEqual(authored.map(entry => entry.id));
    });

    it("re-derives builtin from the id and never believes the file", () => {
        const colors = normalizeProjectBrandColors([
            { id: "mine", value: "#123456", builtin: true },
            { id: "primary", value: "#FF0000", builtin: false },
        ]);

        expect(colors.find(entry => entry.id === "mine")?.builtin).toBeUndefined();
        expect(colors.find(entry => entry.id === "primary")?.builtin).toBe(true);
    });

    it("drops rows nothing could point at or paint", () => {
        const colors = normalizeProjectBrandColors([
            null,
            42,
            "#123456",
            [],
            {},
            { value: "#123456" },
            { id: "   ", value: "#123456" },
            { id: "novalue" },
            { id: "blank", value: "   " },
            { id: "kept", value: "  #123456  " },
        ]);

        expect(colors.filter(entry => !entry.builtin).map(entry => entry.id)).toEqual(["kept"]);
        expect(colors.find(entry => entry.id === "kept")?.value).toBe("#123456");
    });

    it("re-seeds the value of a seeded entry the file blanked out", () => {
        const colors = normalizeProjectBrandColors([{ id: "primary", value: "" }]);

        expect(colors.find(entry => entry.id === "primary")?.value).toBe(builtinBrandColor("primary")?.value);
    });

    it("takes the first of a duplicated id", () => {
        const colors = normalizeProjectBrandColors([
            { id: "mine", value: "#111111", name: "First" },
            { id: "mine", value: "#222222", name: "Second" },
        ]);

        expect(colors.filter(entry => entry.id === "mine")).toEqual([
            { id: "mine", name: "First", value: "#111111" },
        ]);
    });

    it("keeps a name only when there is one", () => {
        const colors = normalizeProjectBrandColors([
            { id: "named", value: "#111111", name: "  Sunset  " },
            { id: "blank", value: "#222222", name: "   " },
            { id: "wrong", value: "#333333", name: 7 },
        ]);

        expect(colors.find(entry => entry.id === "named")?.name).toBe("Sunset");
        // Absent, not empty - the panel draws a translated default for a nameless entry, and `""`
        // would draw an empty row instead of that default.
        expect("name" in colors.find(entry => entry.id === "blank")!).toBe(false);
        expect("name" in colors.find(entry => entry.id === "wrong")!).toBe(false);
    });
});

describe("migrateProjectBrandDocument", () => {
    it("stamps the current schema whatever the file said", () => {
        expect(migrateProjectBrandDocument({ colors: [] }).schemaVersion).toBe(BRAND_SCHEMA_VERSION);
        expect(migrateProjectBrandDocument(null).schemaVersion).toBe(BRAND_SCHEMA_VERSION);
    });

    it("reads an empty document as a fresh palette", () => {
        expect(migrateProjectBrandDocument({})).toEqual(createEmptyProjectBrandDocument());
    });
});
