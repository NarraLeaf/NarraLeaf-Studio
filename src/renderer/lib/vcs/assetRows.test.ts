import { describe, expect, it } from "vitest";
import type { DocumentChange, DocumentChangeKind, DocumentDiffEntry } from "@shared/documents/diff";
import { ORPHAN_CONTENT_NAME_KEY } from "./assetRows";
import { buildChangeIndex } from "./changeIndex";

/**
 * One asset, one line.
 *
 * Every test here is a way the fold could stop being honest: the same asset drawn twice, a file
 * quietly dropped because nothing claimed it, a row named after a hash, or a shard split into rows
 * when the comparison never read it record by record. Read through `buildChangeIndex` rather than
 * through the join alone, because what has to be true is a property of the list an author sees.
 */

/** A real asset id, and the path its bytes are stored at. Both are arithmetic on the other. */
const PORTRAIT = "99553d15-abb5-4213-bad7-203798a1adc4";
const PORTRAIT_CONTENT = "assets/content/99/55/3d15abb54213bad7203798a1adc4";

/** The other id shape: a project old enough to have stored contents under a SHA-256 of them. */
const LEGACY = "ab".repeat(32);
const LEGACY_CONTENT = `assets/content/ab/ab/${LEGACY.slice(4)}`;

const SHARD = "assets/assets.metadata.image.json";

/**
  * The everyday comparison: every changed document listed. Anything less is stated per test, because
  * what the read managed is what decides whether an unpaired file may be called an orphan.
  */
const budget = { rowBudget: 1000, complete: true };

/** One asset's record, as `specs/assetsMetadata.ts` reports it: keyed by id, named by the author. */
function record(
    id: string,
    over: { kind?: DocumentChangeKind; subject?: string; children?: readonly DocumentChange[] } = {},
): DocumentChange {
    return {
        path: ["assets", id],
        kind: over.kind ?? "changed",
        label: { key: "documentDiff.assets.changed" },
        ...(over.subject === undefined ? {} : { subject: over.subject }),
        ...(over.children ? { children: over.children } : {}),
    };
}

function shard(changes: readonly DocumentChange[], over: Partial<DocumentDiffEntry> = {}): DocumentDiffEntry {
    return {
        path: SHARD,
        kind: "changed",
        documentKind: "assets-metadata",
        diff: { changes, complete: true, total: changes.length, tier: "semantic" },
        ...over,
    };
}

function content(path: string, over: Partial<DocumentDiffEntry> = {}): DocumentDiffEntry {
    return {
        path,
        kind: "changed",
        contentClass: "bitmap",
        diff: {
            changes: [{ path: [], kind: "changed", label: { key: "documentDiff.content.changed" } }],
            complete: true,
            total: 1,
            tier: "content",
        },
        ...over,
    };
}

describe("an asset that is one record and one file", () => {
    it("is one line, named by the author, carrying its bytes as a member", () => {
        // The case the fold exists for: a background was replaced and renamed in the same edit. The
        // comparison reports two files that share nothing on paper - a JSON shard and a hash with no
        // extension - and the author has to be able to see that they are one picture.
        const replaced = record(PORTRAIT, {
            subject: "Hero portrait",
            children: [
                { path: ["assets", PORTRAIT, "name"], kind: "changed", label: { key: "documentDiff.assets.renamed" } },
                { path: ["assets", PORTRAIT, "hash"], kind: "changed", label: { key: "documentDiff.assets.content" } },
            ],
        });

        const index = buildChangeIndex([shard([replaced]), content(PORTRAIT_CONTENT)], budget);

        expect(index.rows).toHaveLength(1);
        const row = index.rows[0];
        expect(row.name).toBe("Hero portrait");
        expect(row.path).toBe(SHARD);
        expect(row.member?.path).toBe(PORTRAIT_CONTENT);
        expect(row.memberCount).toBe(1);
        // Both halves of the edit are on the one row, counted as the record counts them.
        expect(row.changeCount).toBe(2);
        // The shard is gone from the list rather than drawn a second time under a hash.
        expect(index.rows.map(item => item.path)).not.toContain(PORTRAIT_CONTENT);
    });

    it("folds a content file that arrives before the record naming it", () => {
        // `assets/content/…` sorts before `assets/assets.metadata.…`, so the ordinary comparison
        // hands the bytes over first. A single pass that paired as it walked would list them alone.
        const index = buildChangeIndex(
            [content(PORTRAIT_CONTENT), shard([record(PORTRAIT, { subject: "Hero portrait" })])],
            budget,
        );

        expect(index.rows).toHaveLength(1);
        expect(index.rows[0].member?.path).toBe(PORTRAIT_CONTENT);
    });

    it("answers the same for a legacy hash id as for a uuid", () => {
        const index = buildChangeIndex(
            [shard([record(LEGACY, { subject: "Old sprite" })]), content(LEGACY_CONTENT)],
            budget,
        );

        expect(index.rows).toHaveLength(1);
        expect(index.rows[0].name).toBe("Old sprite");
        expect(index.rows[0].member?.path).toBe(LEGACY_CONTENT);
    });

    it("gives a row no member when only the record changed", () => {
        // A rename, a retag, a description: the bytes are untouched and there is no second file in
        // the comparison at all. The row must not claim one, or the tooltip counts a file nobody
        // changed - and the detail pane has no bytes to draw and has to fall back to the rows.
        const index = buildChangeIndex([shard([record(PORTRAIT, { subject: "Hero portrait" })])], budget);

        expect(index.rows).toHaveLength(1);
        expect(index.rows[0].member).toBeUndefined();
        expect(index.rows[0].memberCount).toBe(0);
    });

    it("takes what happened from the record rather than from the shard", () => {
        // The shard is `changed` for all four of these. An asset added to it is an addition, and a
        // row that read the file's kind would draw every one of them as an edit.
        const index = buildChangeIndex([
            shard([
                record(PORTRAIT, { kind: "added", subject: "Added" }),
                record("11111111-1111-4111-8111-111111111111", { kind: "removed", subject: "Removed" }),
                record("22222222-2222-4222-8222-222222222222", { kind: "changed", subject: "Retagged" }),
            ]),
        ], budget);

        expect(index.rows.map(row => [row.name, row.kind])).toEqual([
            ["Added", "added"],
            ["Removed", "removed"],
            ["Retagged", "changed"],
        ]);
        // Added and removed are facts about the asset, so they are exempt from every caveat for the
        // same reason a whole file that appeared is.
        expect(index.rows.map(row => row.wholeDocument)).toEqual([true, true, false]);
    });

    it("gives every row a selection handle of its own, even sharing one path", () => {
        const index = buildChangeIndex([
            shard([
                record(PORTRAIT, { subject: "A" }),
                record("11111111-1111-4111-8111-111111111111", { subject: "B" }),
            ]),
        ], budget);

        expect(index.rows.map(row => row.path)).toEqual([SHARD, SHARD]);
        expect(new Set(index.rows.map(row => row.key)).size).toBe(2);
    });

    it("names a record with no authored name after the file it is reported at", () => {
        const index = buildChangeIndex([shard([record(PORTRAIT)])], budget);

        expect(index.rows[0].name).toBe("assets.metadata.image.json");
        expect(index.rows[0].nameKey).toBeUndefined();
    });
});

describe("a content file nothing claims", () => {
    it("stays on the list and says what it is", () => {
        // A real state after a bad merge: the bytes survived and the record naming them did not.
        // Hiding the row would make the one case where the fold is wrong the one case nobody sees.
        const index = buildChangeIndex([
            shard([record("11111111-1111-4111-8111-111111111111", { subject: "Hero portrait" })]),
            content(PORTRAIT_CONTENT),
        ], budget);

        expect(index.rows).toHaveLength(2);
        const orphan = index.rows.find(row => row.path === PORTRAIT_CONTENT);
        expect(orphan?.nameKey).toBe(ORPHAN_CONTENT_NAME_KEY);
        expect(orphan?.member).toBeUndefined();
        // Still filed with the assets, so it is found where an author would look for it.
        expect(index.groups.map(group => group.category)).toEqual(["assets"]);
    });

    it("says nothing of the sort when the comparison did not list every document", () => {
        // The shard naming these bytes may be one of the documents the unit budget dropped, and the
        // renderer cannot tell that from a shard that never changed - both arrive as an absence.
        // "File with no asset record" would then be a claim about the repository whose cause is a
        // read limit, so the row falls back to what it was before the fold existed.
        const index = buildChangeIndex([content(PORTRAIT_CONTENT)], { rowBudget: 1000, complete: false });

        expect(index.rows).toHaveLength(1);
        expect(index.rows[0].nameKey).toBeUndefined();
        expect(index.rows[0].name).toBe("3d15abb54213bad7203798a1adc4");
    });

    it("says nothing of the sort when no metadata was compared at all", () => {
        // A complete comparison that carries no shard is not evidence about shards: nothing here
        // read a record, so nothing here can report one missing.
        const index = buildChangeIndex([content(PORTRAIT_CONTENT)], budget);

        expect(index.rows).toHaveLength(1);
        expect(index.rows[0].nameKey).toBeUndefined();
    });

    it("says nothing of the sort when a shard was not read record by record", () => {
        // The shard's list was cut short at the budget, so the record naming these bytes may well be
        // one of the ones that was dropped. "No asset record" would then be a statement about this
        // pass rather than about the project.
        const cut = shard([record("11111111-1111-4111-8111-111111111111", { subject: "A" })], {
            diff: {
                changes: [record("11111111-1111-4111-8111-111111111111", { subject: "A" })],
                complete: false,
                total: 900,
                tier: "semantic",
            },
        });

        const index = buildChangeIndex([cut, content(PORTRAIT_CONTENT)], budget);

        // The shard is one row, whole, still carrying the count and the caveat it is owed.
        expect(index.rows.map(row => row.path)).toEqual([SHARD, PORTRAIT_CONTENT]);
        expect(index.rows[0].changeCount).toBe(900);
        expect(index.rows[1].nameKey).toBeUndefined();
        expect(index.groups[0].caveats.partialDocuments).toBe(2);
    });

    it("leaves a path that was never one of these alone", () => {
        // Nothing under `assets/content` is guaranteed to be a shard of an id - an author may have
        // put a file there - and a name that does not decode is not an orphan, it is a file.
        const index = buildChangeIndex([content("assets/content/ab/cd/notes.txt")], budget);

        expect(index.rows).toHaveLength(1);
        expect(index.rows[0].name).toBe("notes.txt");
        expect(index.rows[0].nameKey).toBeUndefined();
    });
});

describe("what the fold does not touch", () => {
    it("leaves a shard that appeared or went away whole", () => {
        // One row about a file, not one row per asset inside it: an added shard is compared against
        // nothing, so its change list is a fact about the file rather than a list of records.
        const added: DocumentDiffEntry = {
            path: SHARD,
            kind: "added",
            documentKind: "assets-metadata",
            diff: {
                changes: [{ path: [], kind: "added", label: { key: "documentDiff.content.added" } }],
                complete: true,
                total: 1,
                tier: "opaque",
            },
        };

        const index = buildChangeIndex([added, content(PORTRAIT_CONTENT, { kind: "added" })], budget);

        expect(index.rows.map(row => row.path)).toEqual([SHARD, PORTRAIT_CONTENT]);
        expect(index.rows[0].wholeDocument).toBe(true);
    });

    it("leaves a shard compared below the semantic tier whole", () => {
        // A structural diff keys its rows by JSON path, not by asset id, so splitting one would put
        // rows named after nothing in front of the author.
        const structural = shard([record(PORTRAIT, { subject: "Hero portrait" })], {
            diff: {
                changes: [{ path: ["assets"], kind: "changed", label: { key: "documentDiff.structural.property" } }],
                complete: true,
                total: 1,
                tier: "structural",
            },
        });

        const index = buildChangeIndex([structural], budget);

        expect(index.rows).toHaveLength(1);
        expect(index.rows[0].name).toBe("assets.metadata.image.json");
    });

    it("counts a folded row once against the budget and the heading", () => {
        const index = buildChangeIndex(
            [shard([record(PORTRAIT, { subject: "Hero portrait" })]), content(PORTRAIT_CONTENT)],
            budget,
        );

        expect(index.groups[0].count).toBe(1);
        expect(index.omitted).toBe(0);
    });
});
