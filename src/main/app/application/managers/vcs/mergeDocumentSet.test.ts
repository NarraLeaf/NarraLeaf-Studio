import fs from "fs";
import os from "os";
import path from "path";
import { afterAll, describe, expect, it } from "vitest";
import {
    NOTEBOOK_SCHEMA_VERSION,
    notebookLookup,
    notebookManifest,
    notebookPage,
    notebookSpec,
    type NotebookDocument,
} from "@shared/documents/__fixtures__/syntheticDocumentSet";
import { encodeCanonicalJson } from "@shared/documents/canonicalJson";
import { defineDocumentSetSpec, documentSetLookupOver } from "@shared/documents/documentSet";
import { mergeDecisionKey } from "@shared/documents/mergeApply";
import type { DocumentKind } from "@shared/documents/types";
import { readMergeDocument, resolveDocumentChanges } from "./mergeDocument";

/**
 * Settling one document that is stored as several files, against real files and no backend.
 *
 * It needs none, for the reason `mergeDocument.test.ts` gives: a conflicted merge leaves `~base`,
 * `~mine` and `~theirs` beside every file it could not settle (§4.23), so the three inputs are
 * files on disk. What is new here is that there are N of each, and that the files the merge DID
 * settle carry no sidecars at all - so a side has to be built out of two different kinds of file.
 *
 * The cases are the ones where being wrong is silent. A settle that wrote only the file the author
 * clicked would leave the rest of the document in conflict and the commit would be refused (§4.32)
 * after the settled files had already lost their sidecars. A member folded back in after the author
 * accepted its deletion would undo their decision with nothing on screen. And an automerged member
 * re-offered as a decision would ask the author about a change neither side made.
 */

const MANIFEST = "editor/notebooks/n1/notebook.json";
const STRICT_MANIFEST = "editor/ledgers/l1/ledger.json";
const roots: string[] = [];

/**
 * A second synthetic set, differing from the notebook in one decision: its `assemble` honours the
 * manifest and drops a member file the manifest does not list.
 *
 * Both answers are legitimate - rule 1 says the layer hands `assemble` whatever files it found and
 * the FORMAT decides - and the two produce different merges, which is the point of having both
 * here. Only a manifest-driven format can lose a member to a merge, so only this one can exercise
 * the delete branch of the write-back.
 */
const strictNotebookSpec = defineDocumentSetSpec<NotebookDocument>({
    kind: "test-ledger" as unknown as DocumentKind,
    version: NOTEBOOK_SCHEMA_VERSION,
    manifestPath: "editor/ledgers/<ledgerId>/ledger.json",
    memberPath: "editor/ledgers/<ledgerId>/pages/<pageId>.json",
    assemble: (parts, context) => {
        const manifest = parts.manifest as { pageOrder?: unknown } | null;
        if (!manifest || typeof manifest !== "object") {
            return context.corrupt("the manifest is not an object");
        }
        const order = Array.isArray(manifest.pageOrder) ? manifest.pageOrder.filter((id): id is string => typeof id === "string") : [];
        return {
            ...manifest,
            pageOrder: order.filter((id) => parts.members.has(id)),
            pages: Object.fromEntries(order.filter((id) => parts.members.has(id)).map((id) => [id, parts.members.get(id)])),
        };
    },
    disassemble: (document) => {
        const { pages, ...manifest } = document;
        return { manifest: { ...manifest, pageOrder: [...document.pageOrder] }, members: new Map(Object.entries(pages)) };
    },
    parse: (raw, context) => notebookSpec.parse(raw, context),
    summarize: (document) => notebookSpec.summarize(document),
    merge3: (base, mine, theirs) => notebookSpec.merge3?.(base, mine, theirs) as never,
});

const strictLookup = documentSetLookupOver([strictNotebookSpec]);
const strictPagePath = (id: string): string => `editor/ledgers/l1/pages/${id}.json`;
const strictManifest = (pageOrder: string[]): Record<string, unknown> => ({
    ...notebookManifest({ id: "l1", title: "Ledger", pageOrder }),
});

function tmp(): string {
    const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "nl-docset-merge-")));
    roots.push(root);
    return root;
}

/** Canonical bytes, because that is what a settle writes - see the note on `writeDocumentSet`. */
function write(root: string, relative: string, value: unknown): void {
    const file = path.join(root, relative);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, encodeCanonicalJson(value), "utf-8");
}

function read(root: string, relative: string): unknown {
    return JSON.parse(fs.readFileSync(path.join(root, relative), "utf-8"));
}

const pagePath = (id: string): string => `editor/notebooks/n1/pages/${id}.json`;

/** One conflicted page, its three sides beside it, and one page the merge settled by itself. */
function conflictedNotebook(root: string, options: { base?: boolean } = {}): void {
    write(root, MANIFEST, notebookManifest({ id: "n1", title: "Field notes", pageOrder: ["p1", "p2"] }));
    // The conflicted file itself holds diff3 markers and is not JSON at all (§4.23). Nothing reads
    // it, and writing something unparseable here is what proves that.
    fs.mkdirSync(path.dirname(path.join(root, pagePath("p1"))), { recursive: true });
    fs.writeFileSync(path.join(root, pagePath("p1")), "<<<<<<< ours\n not json\n", "utf-8");
    if (options.base !== false) {
        write(root, `${pagePath("p1")}~base`, notebookPage("One", ["a"]));
    }
    write(root, `${pagePath("p1")}~mine`, notebookPage("One", ["a", "mine"]));
    write(root, `${pagePath("p1")}~theirs`, notebookPage("One", ["a", "theirs"]));
    // Settled by the automerge: no sidecars, and the bytes on disk are what the commit records.
    write(root, pagePath("p2"), notebookPage("Two", ["c"]));
}

afterAll(() => {
    for (const root of roots) {
        fs.rmSync(root, { recursive: true, force: true });
    }
});

describe("reading a conflicted document that is several files", () => {
    it("composes the whole document from the sidecars and the files beside them", async () => {
        const root = tmp();
        conflictedNotebook(root);

        const result = await readMergeDocument(root, pagePath("p1"), notebookLookup);

        expect(result.blocked).toBeUndefined();
        expect(result.documentKind).toBe("test-notebook");
        expect(result.conflicts).toBe(1);
        expect(result.decisions.map((decision) => decision.path)).toEqual([["pages", "p1"]]);
        // The automerged page produced no decision: all three sides hold the bytes the backend
        // left, so there is nothing to ask about - and asking would be asking about a change
        // neither author made.
        expect(result.decisions.every((decision) => decision.path[1] !== "p2")).toBe(true);
    });

    it("names every conflicted file the one answer settles", async () => {
        const root = tmp();
        conflictedNotebook(root);
        write(root, `${pagePath("p2")}~base`, notebookPage("Two", ["c"]));
        write(root, `${pagePath("p2")}~mine`, notebookPage("Two", ["c", "mine"]));
        write(root, `${pagePath("p2")}~theirs`, notebookPage("Two", ["c", "theirs"]));

        const result = await readMergeDocument(root, pagePath("p1"), notebookLookup);

        expect(result.members).toEqual([pagePath("p1"), pagePath("p2")]);
        expect(result.conflicts).toBe(2);
    });

    it("answers the same for any file of the document, including the manifest", async () => {
        const root = tmp();
        conflictedNotebook(root);

        const viaMember = await readMergeDocument(root, pagePath("p1"), notebookLookup);
        const viaManifest = await readMergeDocument(root, MANIFEST, notebookLookup);

        // The manifest is not itself conflicted here, so this is also the case where the path the
        // panel would name has no sidecars of its own.
        expect(viaManifest.decisions).toEqual(viaMember.decisions);
        expect(viaManifest.members).toEqual(viaMember.members);
    });

    it("treats a manifest with no base as add/add rather than as an empty document", async () => {
        // Two authors made this notebook independently. Every page is on both sides and none of
        // them auto-merges: an empty base would read each side's pages as additions and merge the
        // lot, handing the author a document neither of them wrote with nothing reporting it.
        const root = tmp();
        write(root, MANIFEST, "<<<<<<< ours");
        write(root, `${MANIFEST}~mine`, notebookManifest({ id: "n1", title: "Mine", pageOrder: ["p1"] }));
        write(root, `${MANIFEST}~theirs`, notebookManifest({ id: "n1", title: "Theirs", pageOrder: ["p1"] }));
        write(root, pagePath("p1"), "<<<<<<< ours");
        write(root, `${pagePath("p1")}~mine`, notebookPage("One", ["mine"]));
        write(root, `${pagePath("p1")}~theirs`, notebookPage("One", ["theirs"]));

        const result = await readMergeDocument(root, MANIFEST, notebookLookup);

        expect(result.conflicts).toBe(1);
        expect(result.decisions[0]).toMatchObject({ path: ["pages", "p1"], outcome: "conflict" });
    });

    it("refuses the document when one side's copy of a file is missing", async () => {
        const root = tmp();
        conflictedNotebook(root);
        fs.rmSync(path.join(root, `${pagePath("p1")}~theirs`));

        const result = await readMergeDocument(root, pagePath("p1"), notebookLookup);

        // Not "no conflict here": settling with the markers still in the file would record them.
        expect(result.blocked).toBe("unreadable");
        expect(result.detail).toContain("their side");
    });

    it("refuses the document when a member exists but cannot be read", async () => {
        // **The silent version of this loses the author's file.** `documentSetFilesOnDisk` has
        // already proved the member exists, so a null read is an existing file that could not be
        // OPENED - a Windows lock, a directory in its place, a race with another writer. Skipping
        // it dropped the member from all three sides with no signal, the assembled document came
        // out without it, and the write-back's delete loop - which walks the set's files and
        // removes whatever the settled document no longer holds - then deleted it. The single-file
        // path refuses outright in exactly this situation.
        const root = tmp();
        conflictedNotebook(root);
        // A directory where a member file should be: it exists, and `readFileSync` cannot read it.
        fs.mkdirSync(path.join(root, pagePath("p3")));

        const result = await readMergeDocument(root, pagePath("p1"), notebookLookup);

        expect(result.blocked).toBe("unreadable");
        expect(result.detail).toContain(pagePath("p3"));
    });
});

describe("settling it", () => {
    it("writes only the file the change landed in, and names every path it settled", async () => {
        const root = tmp();
        conflictedNotebook(root);
        const before = fs.readFileSync(path.join(root, pagePath("p2")), "utf-8");
        const manifestBefore = fs.readFileSync(path.join(root, MANIFEST), "utf-8");

        const settled = await resolveDocumentChanges(
            root,
            pagePath("p1"),
            { [mergeDecisionKey(["pages", "p1"])]: "theirs" },
            notebookLookup,
        );

        expect(settled).toEqual([pagePath("p1")]);
        expect(read(root, pagePath("p1"))).toEqual({ title: "One", lines: ["a", "theirs"] });
        // Untouched, byte for byte: the automerged page and the manifest are what the backend left
        // and what the commit will record.
        expect(fs.readFileSync(path.join(root, pagePath("p2")), "utf-8")).toBe(before);
        expect(fs.readFileSync(path.join(root, MANIFEST), "utf-8")).toBe(manifestBefore);
    });

    it("settles every conflicted file of the document in one act", async () => {
        const root = tmp();
        conflictedNotebook(root);
        write(root, `${pagePath("p2")}~base`, notebookPage("Two", ["c"]));
        write(root, `${pagePath("p2")}~mine`, notebookPage("Two", ["c", "mine"]));
        write(root, `${pagePath("p2")}~theirs`, notebookPage("Two", ["c", "theirs"]));

        const settled = await resolveDocumentChanges(
            root,
            pagePath("p1"),
            {
                [mergeDecisionKey(["pages", "p1"])]: "mine",
                [mergeDecisionKey(["pages", "p2"])]: "theirs",
            },
            notebookLookup,
        );

        // Both, from one call on one of them - which is why the caller must pass this list to the
        // resolve verb rather than the path it asked about.
        expect(settled).toEqual([pagePath("p1"), pagePath("p2")]);
        expect(read(root, pagePath("p1"))).toEqual({ title: "One", lines: ["a", "mine"] });
        expect(read(root, pagePath("p2"))).toEqual({ title: "Two", lines: ["c", "theirs"] });
    });

    it("deletes a member file the settled document no longer holds", async () => {
        // **Members are enumerated by path, so a file left behind would be folded straight back
        // in** and the author's accepted deletion would silently undo itself on the next read.
        //
        // Reaching this needs a format whose `assemble` honours the manifest rather than the
        // directory - `strictNotebookSpec` below - because the notebook fixture deliberately folds
        // in every file it finds, and with one working tree that means every side has every file.
        // Both are legitimate answers to "a member the manifest does not list"; this is the one
        // where a merge can drop a member, and it is the branch worth pinning.
        const root = tmp();
        write(root, STRICT_MANIFEST, "<<<<<<< ours");
        write(root, `${STRICT_MANIFEST}~base`, strictManifest(["p1", "p2"]));
        write(root, `${STRICT_MANIFEST}~mine`, strictManifest(["p1", "p2"]));
        write(root, `${STRICT_MANIFEST}~theirs`, strictManifest(["p1"]));
        write(root, strictPagePath("p1"), notebookPage("One", ["a"]));
        write(root, strictPagePath("p2"), notebookPage("Two", ["c"]));

        const document = await readMergeDocument(root, STRICT_MANIFEST, strictLookup);
        // Their side dropped the page and mine left it alone, so there is a right answer and it
        // was taken - the author may still flip it, which is why the row is there at all.
        expect(document.decisions).toEqual([
            expect.objectContaining({ path: ["pages", "p2"], outcome: "auto-theirs" }),
        ]);

        const settled = await resolveDocumentChanges(root, STRICT_MANIFEST, {}, strictLookup);

        expect(settled).toEqual([STRICT_MANIFEST]);
        expect(fs.existsSync(path.join(root, strictPagePath("p2")))).toBe(false);
        expect(fs.existsSync(path.join(root, strictPagePath("p1")))).toBe(true);
        // Its sidecars are left alone: the commit removes them, and the path is still on the list
        // the caller settles with the backend.
        expect(read(root, STRICT_MANIFEST)).toMatchObject({ pageOrder: ["p1"] });
    });

    it("keeps a member the author flips back to their own side", async () => {
        const root = tmp();
        write(root, STRICT_MANIFEST, "<<<<<<< ours");
        write(root, `${STRICT_MANIFEST}~base`, strictManifest(["p1", "p2"]));
        write(root, `${STRICT_MANIFEST}~mine`, strictManifest(["p1", "p2"]));
        write(root, `${STRICT_MANIFEST}~theirs`, strictManifest(["p1"]));
        write(root, strictPagePath("p1"), notebookPage("One", ["a"]));
        write(root, strictPagePath("p2"), notebookPage("Two", ["c"]));

        await resolveDocumentChanges(
            root,
            STRICT_MANIFEST,
            { [mergeDecisionKey(["pages", "p2"])]: "mine" },
            strictLookup,
        );

        // The file stays. The manifest's ORDER does not gain it back, because the fixture's
        // `merge3` builds the order from the merged page map before the author's flips are applied
        // - a crudeness of the fixture, not of the layer, and `merge3Story` is where a real format
        // settles an order it owns. What is under test here is the write-back's delete branch, and
        // it is the absence of a delete that matters.
        expect(fs.existsSync(path.join(root, strictPagePath("p2")))).toBe(true);
    });

    it("refuses to settle rather than deleting a member it could not read", async () => {
        // The other half of the same defect: a member skipped because it could not be opened is
        // absent from the settled document, and the delete loop removes whatever the settled
        // document does not hold. Refusing is what keeps the author's file where it is.
        const root = tmp();
        conflictedNotebook(root);
        fs.mkdirSync(path.join(root, pagePath("p3")));

        await expect(resolveDocumentChanges(
            root,
            pagePath("p1"),
            { [mergeDecisionKey(["pages", "p1"])]: "mine" },
            notebookLookup,
        )).rejects.toThrow(/cannot be settled change by change/);

        expect(fs.existsSync(path.join(root, pagePath("p3")))).toBe(true);
        // And nothing else was written either: a refusal is all-or-nothing.
        expect(fs.readFileSync(path.join(root, pagePath("p1")), "utf-8")).toContain("<<<<<<<");
    });

    it("refuses to settle a document whose sides cannot be read", async () => {
        const root = tmp();
        conflictedNotebook(root);
        fs.writeFileSync(path.join(root, `${pagePath("p1")}~mine`), "{ not json", "utf-8");

        await expect(resolveDocumentChanges(root, pagePath("p1"), {}, notebookLookup))
            .rejects.toThrow(/cannot be settled change by change/);
    });
});
