import { describe, expect, it } from "vitest";
import type {
    DocumentChange,
    DocumentDiffEntry,
    DocumentDiffTier,
} from "@shared/documents/diff";
import { buildChangeIndex, GROUP_COLLAPSE_THRESHOLD, splitDocumentPath } from "./changeIndex";

/**
 * The index's job is to stay an index.
 *
 * Every test here is a way it could stop being one: a row that grows with what is inside the file, a
 * heading whose number does not match what opening it costs, a caveat repeated per line, or a
 * comparison that quietly drops files at its budget. All four are what the surface this replaced
 * did, and none of them looks wrong in a screenshot of a small project.
 */

function change(path: string, children?: readonly DocumentChange[]): DocumentChange {
    return {
        path: [path],
        kind: "changed",
        label: { key: "documentDiff.structural.property", params: { name: path } },
        ...(children ? { children } : {}),
    };
}

function entry(init: {
    path: string;
    kind?: DocumentDiffEntry["kind"];
    tier?: DocumentDiffTier;
    changes?: number;
    total?: number;
    complete?: boolean;
    documentKind?: DocumentDiffEntry["documentKind"];
}): DocumentDiffEntry {
    const changes = Array.from({ length: init.changes ?? 1 }, (_, index) => change(`field${index}`));
    return {
        path: init.path,
        kind: init.kind ?? "changed",
        ...(init.documentKind ? { documentKind: init.documentKind } : {}),
        diff: {
            changes,
            complete: init.complete ?? true,
            total: init.total ?? changes.length,
            tier: init.tier ?? "semantic",
        },
    };
}

const budget = { rowBudget: 1000 };

describe("buildChangeIndex", () => {
    it("gives every file exactly one row, whatever is inside it", () => {
        // The invariant the whole layout rests on. A two-change file and a two-hundred-change file
        // are one row each, and so is a file nothing could read - the tier does not buy extra lines.
        const entries = [
            entry({ path: "editor/story/stories/a/storydoc.json", changes: 2 }),
            entry({ path: "editor/story/stories/b/storydoc.json", changes: 200, total: 200 }),
            entry({ path: "editor/story/stories/c/storydoc.json", tier: "opaque", changes: 1 }),
            entry({ path: "editor/story/stories/d/storydoc.json", tier: "structural", changes: 60, total: 400, complete: false }),
        ];

        const index = buildChangeIndex(entries, budget);

        expect(index.rows).toHaveLength(entries.length);
        expect(index.groups).toHaveLength(1);
        expect(index.groups[0].rows).toHaveLength(entries.length);
        expect(index.rows.map(row => row.path)).toEqual(entries.map(item => item.path));
    });

    it("carries a count rather than the changes themselves", () => {
        // A row holding its own change list is how the old surface grew a thousand lines. What a row
        // may say about the inside of a file is a number.
        const index = buildChangeIndex(
            [entry({ path: "editor/brand.json", changes: 3, total: 7 })],
            budget,
        );

        const row = index.rows[0];
        expect(row.changeCount).toBe(7);
        expect(row.name).toBe("brand.json");
        expect(row.directory).toBe("editor");
        // Nothing on the row is a list of anything. The entry is carried whole for the detail pane
        // to read; the row itself has no per-change field for a renderer to loop over.
        expect(Object.entries(row).filter(([, value]) => Array.isArray(value))).toEqual([]);
    });

    it("says Added rather than a count for a file that appeared whole", () => {
        const index = buildChangeIndex([
            entry({ path: "editor/story/stories/new/storydoc.json", kind: "added" }),
            entry({ path: "editor/story/stories/old/storydoc.json", kind: "removed" }),
            entry({ path: "editor/story/stories/edited/storydoc.json", kind: "changed" }),
        ], budget);

        expect(index.rows.map(row => row.wholeDocument)).toEqual([true, true, false]);
    });

    it("groups by category, in a fixed order, with the count opening the group costs", () => {
        const index = buildChangeIndex([
            entry({ path: "assets/assets.metadata.image.json" }),
            entry({ path: "editor/story/index.json" }),
            entry({ path: "editor/localization/en.json" }),
            entry({ path: "editor/story/stories/a/storydoc.json" }),
        ], budget);

        expect(index.groups.map(group => group.category)).toEqual(["story", "assets", "localization"]);
        for (const group of index.groups) {
            expect(group.count).toBe(group.rows.length);
        }
        // Arrival order is kept inside a group: the budget and the grouping must not reorder the
        // comparison the main process handed over.
        expect(index.groups[0].rows.map(row => row.path))
            .toEqual(["editor/story/index.json", "editor/story/stories/a/storydoc.json"]);
    });

    it("starts a group closed once it is bigger than the threshold", () => {
        const many = Array.from(
            { length: GROUP_COLLAPSE_THRESHOLD + 1 },
            (_, index) => entry({ path: `assets/content/ab/cd/file${index}` }),
        );
        const few = Array.from(
            { length: GROUP_COLLAPSE_THRESHOLD },
            (_, index) => entry({ path: `editor/story/stories/s${index}/storydoc.json` }),
        );

        const index = buildChangeIndex([...many, ...few], budget);
        const assets = index.groups.find(group => group.category === "assets")!;
        const story = index.groups.find(group => group.category === "story")!;

        expect(assets.collapsed).toBe(true);
        expect(story.collapsed).toBe(false);
    });

    it("closes a group of two hundred, so it costs one line before it is opened", () => {
        const entries = Array.from(
            { length: 200 },
            (_, index) => entry({ path: `assets/content/ab/cd/file${index}`, changes: 5 }),
        );

        const group = buildChangeIndex(entries, budget).groups[0];

        expect(group.category).toBe("assets");
        expect(group.count).toBe(200);
        expect(group.collapsed).toBe(true);
    });

    it("sums a caveat onto the group once, never onto the rows", () => {
        // Two hundred asset records compared by structure alone are one sentence. Drawn per row it
        // is two hundred sentences, which is the noise this layout exists to remove - and the tier
        // set is deduped, so a group cannot report the same caveat twice either.
        const entries = Array.from(
            { length: 200 },
            (_, index) => entry({ path: `assets/content/ab/cd/file${index}`, tier: "structural" }),
        );

        const group = buildChangeIndex(entries, budget).groups[0];

        expect(group.caveats.tiers).toEqual(["structural"]);
        expect(group.caveats.partialDocuments).toBe(200);
        for (const row of group.rows) {
            expect(row).not.toHaveProperty("tier");
            expect(row).not.toHaveProperty("caveats");
        }
    });

    it("counts a file as not fully compared when it was cut short as well as when it was skimmed", () => {
        const index = buildChangeIndex([
            entry({ path: "editor/story/stories/a/storydoc.json" }),
            entry({ path: "editor/story/stories/b/storydoc.json", complete: false, total: 900 }),
            entry({ path: "editor/story/stories/c/storydoc.json", tier: "summary" }),
            entry({ path: "editor/story/stories/d/storydoc.json", tier: "opaque" }),
        ], budget);

        const group = index.groups[0];
        expect(group.caveats.partialDocuments).toBe(3);
        // Weakest last, and only the tiers that are actually a caveat: `semantic` is the one tier
        // whose rows mean what they appear to mean.
        expect(group.caveats.tiers).toEqual(["summary", "opaque"]);
    });

    it("does not count a file with no other side as one it could not finish comparing", () => {
        // Measured in the app: a 26-byte new `.txt` whose own detail was perfectly correct - one
        // "+ Added (26 B)" row and no caption - counted under a heading reading "2 files here
        // were not compared in full". The engine reports an addition as one `opaque` row because
        // there is nothing to compare it against, not because it gave up part way.
        const index = buildChangeIndex([
            entry({ path: "notes/new-note.txt", kind: "added", tier: "opaque" }),
            entry({ path: "notes/old-note.txt", kind: "removed", tier: "opaque" }),
            entry({ path: "notes/edited.txt", tier: "structural" }),
        ], budget);

        const group = index.groups[0];
        expect(group.count).toBe(3);
        // One, and it is the one that really was compared and came back weaker than semantic.
        expect(group.caveats.partialDocuments).toBe(1);
        expect(group.caveats.tiers).toEqual(["structural"]);
    });

    it("treats a renamed file as a whole-file fact, not as a comparison that fell short", () => {
        // The same judgement one kind further: `notes/note-01.txt` moved to `notes-archive/`.
        // Nothing inside it changed - and its bytes were read IN FULL on both sides to prove the
        // move - so "not compared in full" is false twice over. The detail pane suppresses the
        // caption for the same three kinds; this is the counting half of that agreement.
        const index = buildChangeIndex([
            entry({ path: "notes-archive/note-01.txt", kind: "moved", tier: "opaque" }),
        ], budget);

        const group = index.groups[0];
        expect(group.caveats.partialDocuments).toBe(0);
        expect(group.caveats.tiers).toEqual([]);
        expect(index.rows[0].wholeDocument).toBe(true);
    });

    it("reports nothing to caveat about when every file was read in full", () => {
        const group = buildChangeIndex([entry({ path: "editor/brand.json" })], budget).groups[0];

        expect(group.caveats.tiers).toEqual([]);
        expect(group.caveats.partialDocuments).toBe(0);
    });

    it("counts what the budget left out instead of stopping in silence", () => {
        const entries = Array.from(
            { length: 30 },
            (_, index) => entry({ path: `assets/content/ab/cd/file${index}` }),
        );

        const index = buildChangeIndex(entries, { rowBudget: 10 });

        expect(index.rows).toHaveLength(10);
        expect(index.omitted).toBe(20);
        // Spent in arrival order, before grouping: the files that survive are the ones the author's
        // own tree lists first, not the ones that happened to fall in a small category.
        expect(index.rows[0].path).toBe("assets/content/ab/cd/file0");
    });

    it("holds nothing at all rather than an empty group", () => {
        const index = buildChangeIndex([], budget);

        expect(index.groups).toEqual([]);
        expect(index.rows).toEqual([]);
        expect(index.omitted).toBe(0);
    });
});

describe("splitDocumentPath", () => {
    it("names the file and locates it separately", () => {
        expect(splitDocumentPath("editor/story/index.json")).toEqual({
            directory: "editor/story",
            name: "index.json",
        });
        expect(splitDocumentPath("project.json")).toEqual({ directory: null, name: "project.json" });
        expect(splitDocumentPath("editor\\ui\\uidoc.json")).toEqual({
            directory: "editor/ui",
            name: "uidoc.json",
        });
    });
});
