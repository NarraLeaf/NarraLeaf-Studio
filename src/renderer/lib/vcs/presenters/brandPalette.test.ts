import { describe, expect, it } from "vitest";
import type { DocumentDiffEntry } from "@shared/documents/diff";
import type { BrandColor } from "@shared/types/brand";
import { comparePalettes, isBrandEntry, readPalette } from "./brandPalette";

/**
 * What a palette comparison has to get right, and each way of getting it wrong looks fine on
 * screen: claiming the wrong document, seeding entries that are not in the file, resolving both
 * sides against one palette, and burying the one row that changed under sixteen that did not.
 */

const entry = (over: Partial<DocumentDiffEntry> = {}): DocumentDiffEntry => ({
    path: "editor/brand.json",
    kind: "changed",
    diff: { changes: [], complete: true, total: 0, tier: "summary" },
    ...over,
});

const bytesOf = (value: unknown): Uint8Array => new TextEncoder().encode(JSON.stringify(value));
const color = (id: string, value: string, name?: string): BrandColor => ({ id, value, ...(name ? { name } : {}) });

describe("which document this draws", () => {
    it("claims the palette by its kind", () => {
        expect(isBrandEntry(entry({ documentKind: "brand" }))).toBe(true);
    });

    it("declines every other document, including one at a path that looks like it", () => {
        expect(isBrandEntry(entry())).toBe(false);
        expect(isBrandEntry(entry({ documentKind: "story" }))).toBe(false);
    });
});

describe("reading a palette out of a file", () => {
    it("reads the entries exactly as the document stores them", () => {
        const palette = readPalette(bytesOf({
            schemaVersion: 1,
            colors: [{ id: "primary", value: "#40A8C4" }, { id: "accent", value: "#123456", name: "Accent" }],
        }));

        // No seeding: the normalizer would put every built-in entry back, and a comparison that
        // seeds both sides can never show that one went away.
        expect(palette).toEqual([
            { id: "primary", value: "#40A8C4" },
            { id: "accent", value: "#123456", name: "Accent" },
        ]);
    });

    it("answers with nothing at all for bytes that are not a palette", () => {
        expect(readPalette(new TextEncoder().encode("not json"))).toBeNull();
        expect(readPalette(bytesOf([1, 2, 3]))).toBeNull();
        expect(readPalette(bytesOf({ schemaVersion: 1 }))).toBeNull();
    });

    it("keeps the entries it can read out of a file that also holds rubbish", () => {
        const palette = readPalette(bytesOf({ colors: [{ id: "primary", value: "#fff" }, 7, { id: 3 }] }));

        expect(palette).toEqual([{ id: "primary", value: "#fff" }]);
    });
});

describe("aligning the two palettes", () => {
    it("reports what the document stores, and counts the rest", () => {
        const before = [color("primary", "#40A8C4"), color("secondary", "#2E6E80"), color("mood", "#101317")];
        const after = [color("primary", "#B4553C"), color("secondary", "#2E6E80"), color("extra", "#FFFFFF")];

        const { rows, unchanged } = comparePalettes(before, after);

        expect(rows.map(row => [row.id, row.state])).toEqual([
            ["primary", "changed"],
            ["extra", "added"],
            ["mood", "removed"],
        ]);
        // Listing the sixteen entries that did not move puts the one that did somewhere in the
        // middle of a screenful that says nothing.
        expect(unchanged).toBe(1);
    });

    it("treats a rename as a change, even when the colour is the same", () => {
        const { rows } = comparePalettes([color("primary", "#fff")], [color("primary", "#fff", "Paper")]);

        expect(rows.map(row => row.state)).toEqual(["changed"]);
        expect(rows[0].after?.name).toBe("Paper");
    });

    it("resolves each side's links against its OWN palette", () => {
        // The failure that would hide the change completely: resolved against one palette, the
        // older `button.primary` paints the NEW primary and the two swatches match.
        const before = [color("primary", "#40A8C4"), color("button.primary", "nlbrand:primary")];
        const after = [color("primary", "#B4553C"), color("button.primary", "nlbrand:primary")];

        const { rows, unchanged } = comparePalettes(before, after);

        expect(rows.map(row => [row.id, row.before?.css, row.after?.css]))
            .toEqual([["primary", "#40A8C4", "#B4553C"]]);
        // The link itself did not change, which is what the document says. The swatch beside it
        // still moves, because it is resolved per side.
        expect(unchanged).toBe(1);
    });

    it("says a value that lands on no colour lands on no colour", () => {
        const { rows } = comparePalettes([color("a", "#fff")], [color("a", "nlbrand:nothing")]);

        expect(rows[0].after).toEqual({ value: "nlbrand:nothing", name: null, css: null });
    });

    it("calls every entry of a palette that only exists on one side by what happened to it", () => {
        const colors = [color("primary", "#fff"), color("secondary", "#000")];

        expect(comparePalettes(null, colors).rows.map(row => row.state)).toEqual(["added", "added"]);
        expect(comparePalettes(colors, null).rows.map(row => row.state)).toEqual(["removed", "removed"]);
        expect(comparePalettes(null, null)).toEqual({ rows: [], unchanged: 0 });
    });

    it("keeps the newer side's own order, which is the order the panel draws", () => {
        const before = [color("a", "#1"), color("b", "#2")];
        const after = [color("b", "#3"), color("a", "#4")];

        expect(comparePalettes(before, after).rows.map(row => row.id)).toEqual(["b", "a"]);
    });
});
