import { describe, expect, it, vi } from "vitest";
import {
    notebookLookup,
    notebookManifest,
    notebookPage,
} from "@shared/documents/__fixtures__/syntheticDocumentSet";
import type { VcsChangeKind, VcsFileChange, VcsStatus } from "@shared/types/vcs";
import { DIFF_UNIT_LIMIT, DOCUMENT_SET_MEMBER_LIMIT } from "./documentDiff";
import { diffRevisions, type RevisionDiffSource } from "./revisionDiff";
import { diffWorkingTree, type WorkingTreeDiffSource } from "./workingTreeDiff";

/**
 * A comparison over a document that is stored as several files.
 *
 * **The failure this file exists to catch is the one that looks like success.** Compared file by
 * file, a story split into scenes produces a perfectly plausible change list - one row per scene,
 * each with a JSON walk under it - and nothing on screen says that the document's own `diff` never
 * ran, that scene ordering was never consulted, and that resolving one of those rows settles a
 * third of a document. So the assertions here are about SHAPE: one row, at the manifest, at the
 * semantic tier, standing for the files that changed.
 *
 * Both comparisons are driven over the notebook fixture through the injected `sets` port. Nothing
 * registers a document set in the registry Studio uses, and `documentSet.test.ts` asserts that.
 */

const MANIFEST = "editor/notebooks/n1/notebook.json";
const P1 = "editor/notebooks/n1/pages/p1.json";
const P2 = "editor/notebooks/n1/pages/p2.json";

const bytes = (value: unknown): Buffer => Buffer.from(JSON.stringify(value), "utf-8");

const manifest = (pageOrder: string[], title = "Field notes"): Buffer =>
    bytes(notebookManifest({ id: "n1", title, pageOrder }));

const page = (title: string, lines: string[]): Buffer => bytes(notebookPage(title, lines));

function revisionSource(revisions: Record<string, Record<string, Buffer>>) {
    const readPaths: string[] = [];
    const source: RevisionDiffSource = {
        changedPaths: async (from, to) => {
            const all = new Set([...Object.keys(revisions[from] ?? {}), ...Object.keys(revisions[to] ?? {})]);
            return [...all].filter((path) => !equal(revisions[from]?.[path], revisions[to]?.[path]));
        },
        entriesAt: async (revision) => new Map(
            Object.entries(revisions[revision] ?? {}).map(([path, buffer]) => [
                path,
                { size: buffer.length, hash: buffer.toString("base64") },
            ]),
        ),
        readAt: async (revision, paths) => {
            readPaths.push(...paths);
            return new Map(paths.map((path) => [path, revisions[revision]?.[path] ?? null]));
        },
    };
    return { source, readPaths };
}

function equal(a: Buffer | undefined, b: Buffer | undefined): boolean {
    return a === b || Boolean(a && b && a.equals(b));
}

describe("two revisions of a document stored as several files", () => {
    it("folds every member into one row, at the manifest, compared by the format's own diff", async () => {
        const { source } = revisionSource({
            r1: {
                [MANIFEST]: manifest(["p1", "p2"]),
                [P1]: page("One", ["a"]),
                [P2]: page("Two", ["c"]),
            },
            r2: {
                [MANIFEST]: manifest(["p1", "p2"]),
                [P1]: page("One", ["a", "b"]),
                [P2]: page("Two", ["c"]),
            },
        });

        const result = await diffRevisions(source, { from: "r1", to: "r2", sets: notebookLookup });

        expect(result.documents).toHaveLength(1);
        const [entry] = result.documents;
        expect(entry.path).toBe(MANIFEST);
        expect(entry.kind).toBe("changed");
        // The set's own kind, from the fold - nothing read the manifest to find it out.
        expect(entry.documentKind).toBe("test-notebook");
        // Semantic: `notebookSpec.diff` ran over two WHOLE documents, which is the whole point.
        expect(entry.diff.tier).toBe("semantic");
        expect(entry.diff.changes.map((change) => change.path)).toEqual([["pages", "p1"]]);
        // The row stands for the file that changed, and says so rather than implying one file.
        expect(entry.members).toEqual([P1]);
    });

    it("reads the members that did not change, because the document is compared whole", async () => {
        const { source, readPaths } = revisionSource({
            r1: { [MANIFEST]: manifest(["p1", "p2"]), [P1]: page("One", ["a"]), [P2]: page("Two", ["c"]) },
            r2: { [MANIFEST]: manifest(["p1", "p2"]), [P1]: page("One", ["a", "b"]), [P2]: page("Two", ["c"]) },
        });

        await diffRevisions(source, { from: "r1", to: "r2", sets: notebookLookup });

        // The manifest and the untouched page are read too. That is the price of "one document",
        // and it is what makes the scene ordering in the manifest available to the format's diff.
        expect([...new Set(readPaths)].sort()).toEqual([MANIFEST, P1, P2]);
    });

    it("keeps the manifest's row when only the manifest changed", async () => {
        const { source } = revisionSource({
            r1: { [MANIFEST]: manifest(["p1", "p2"]), [P1]: page("One", ["a"]), [P2]: page("Two", ["c"]) },
            r2: { [MANIFEST]: manifest(["p2", "p1"]), [P1]: page("One", ["a"]), [P2]: page("Two", ["c"]) },
        });

        const result = await diffRevisions(source, { from: "r1", to: "r2", sets: notebookLookup });

        expect(result.documents).toHaveLength(1);
        expect(result.documents[0].members).toEqual([MANIFEST]);
    });

    it("reports an added document as one row rather than one per file", async () => {
        const { source } = revisionSource({
            r1: { "editor/brand.json": bytes({ a: 1 }) },
            r2: {
                "editor/brand.json": bytes({ a: 1 }),
                [MANIFEST]: manifest(["p1"]),
                [P1]: page("One", ["a"]),
            },
        });

        const result = await diffRevisions(source, { from: "r1", to: "r2", sets: notebookLookup });

        expect(result.documents.map((entry) => `${entry.path}:${entry.kind}`)).toEqual([`${MANIFEST}:added`]);
        // The summary tier, because the one side there is was read and summarised - and the title
        // is the author's own word for the document, which no single file's name carries.
        expect(result.documents[0].diff.tier).toBe("summary");
        expect(result.documents[0].diff.changes[0].subject).toBe("Field notes");
    });

    it("does not fold a member of another document into this one", async () => {
        const { source } = revisionSource({
            r1: {
                [P1]: page("One", ["a"]),
                [MANIFEST]: manifest(["p1"]),
                "editor/notebooks/n2/notebook.json": manifest(["p1"], "Other"),
                "editor/notebooks/n2/pages/p1.json": page("Other one", ["x"]),
            },
            r2: {
                [P1]: page("One", ["a", "b"]),
                [MANIFEST]: manifest(["p1"]),
                "editor/notebooks/n2/notebook.json": manifest(["p1"], "Other"),
                "editor/notebooks/n2/pages/p1.json": page("Other one", ["x", "y"]),
            },
        });

        const result = await diffRevisions(source, { from: "r1", to: "r2", sets: notebookLookup });

        expect(result.documents.map((entry) => entry.path)).toEqual([
            MANIFEST,
            "editor/notebooks/n2/notebook.json",
        ]);
    });

    it("counts a set as ONE document against the comparison limit", async () => {
        // The case the limit was re-unitised for: four stories of 560 scenes each are 2,244 files
        // and four documents. Counted in paths, every document in the project - including the
        // three the author never opened - came back uninspected.
        const pages = Array.from({ length: 40 }, (_, index) => `p${index}`);
        const before: Record<string, Buffer> = { [MANIFEST]: manifest(pages) };
        const after: Record<string, Buffer> = { [MANIFEST]: manifest(pages) };
        for (const id of pages) {
            before[`editor/notebooks/n1/pages/${id}.json`] = page(id, ["a"]);
            after[`editor/notebooks/n1/pages/${id}.json`] = page(id, ["a", "b"]);
        }
        // Plus enough standalone files to sit exactly on the limit once the set counts as one.
        for (let index = 0; index < DIFF_UNIT_LIMIT - 1; index += 1) {
            before[`editor/f${index}.json`] = bytes({ n: index });
            after[`editor/f${index}.json`] = bytes({ n: index + 1 });
        }
        const { source } = revisionSource({ r1: before, r2: after });
        const onDegrade = vi.fn();

        const result = await diffRevisions(source, { from: "r1", to: "r2", sets: notebookLookup, onDegrade });

        expect(result.documents).toHaveLength(DIFF_UNIT_LIMIT);
        expect(onDegrade).not.toHaveBeenCalledWith(expect.stringContaining("document limit"));
        expect(result.documents.find((entry) => entry.path === MANIFEST)?.diff.tier).toBe("semantic");
    });

    it("degrades a set with too many files to ONE row, saying why", async () => {
        const many = Array.from({ length: DOCUMENT_SET_MEMBER_LIMIT + 2 }, (_, index) => `p${index}`);
        const before: Record<string, Buffer> = { [MANIFEST]: manifest(many) };
        const after: Record<string, Buffer> = { [MANIFEST]: manifest(many) };
        for (const id of many) {
            before[`editor/notebooks/n1/pages/${id}.json`] = page(id, ["a"]);
            after[`editor/notebooks/n1/pages/${id}.json`] = page(id, id === "p0" ? ["a", "b"] : ["a"]);
        }
        const { source, readPaths } = revisionSource({ r1: before, r2: after });
        const onDegrade = vi.fn();

        const result = await diffRevisions(source, { from: "r1", to: "r2", sets: notebookLookup, onDegrade });

        // One row, not two thousand: falling back to per-file rows would be the flood the unit
        // limit exists to prevent, arriving through the other door.
        expect(result.documents).toHaveLength(1);
        expect(result.documents[0].path).toBe(MANIFEST);
        expect(result.documents[0].diff.changes[0].label.key).toBe("documentDiff.opaque.unread");
        expect(readPaths).toEqual([]);
        expect(onDegrade).toHaveBeenCalledWith(expect.stringContaining("one document made of"));
    });
});

function fileChange(path: string, kind: VcsChangeKind, extra: Partial<VcsFileChange> = {}): VcsFileChange {
    return {
        path,
        kind,
        directory: false,
        size: 0,
        staged: false,
        dirty: true,
        conflicted: false,
        conflictUnresolved: false,
        ...extra,
    };
}

function statusOf(files: VcsFileChange[]): VcsStatus {
    return {
        branch: "main",
        head: "r1",
        revisionNumber: 1,
        clean: files.length === 0,
        files,
        counts: { added: 0, modified: 0, deleted: 0, moved: 0, copied: 0 },
        sync: {
            remoteAvailable: false,
            remoteAuthorized: false,
            remoteBranchExists: false,
            localAhead: false,
            remoteAhead: false,
        },
    };
}

function workingSource(
    status: VcsStatus,
    recorded: Record<string, Buffer>,
    working: Record<string, Buffer>,
) {
    const calls: string[] = [];
    const source: WorkingTreeDiffSource = {
        status: async () => status,
        entriesAt: async () => new Map(Object.entries(recorded).map(([path, buffer]) => [
            path,
            { size: buffer.length, hash: buffer.toString("base64") },
        ])),
        readAt: async (_revision, paths) => {
            calls.push(...paths.map((path) => `readAt:${path}`));
            return new Map(paths.map((path) => [path, recorded[path] ?? null]));
        },
        statWorking: async (path) => {
            calls.push(`stat:${path}`);
            return working[path] ? { size: working[path].length } : null;
        },
        readWorkingHead: async (path, length) => working[path]?.subarray(0, length) ?? null,
        readWorking: async (path) => {
            calls.push(`working:${path}`);
            return working[path] ?? null;
        },
    };
    return { source, calls };
}

describe("the working tree against the last version", () => {
    it("folds the changed member into one row at the manifest", async () => {
        const recorded = { [MANIFEST]: manifest(["p1", "p2"]), [P1]: page("One", ["a"]), [P2]: page("Two", ["c"]) };
        const working = { ...recorded, [P1]: page("One", ["a", "b"]) };
        const { source } = workingSource(statusOf([fileChange(P1, "modified")]), recorded, working);

        const result = await diffWorkingTree(source, { sets: notebookLookup });

        expect(result.documents).toHaveLength(1);
        expect(result.documents[0].path).toBe(MANIFEST);
        expect(result.documents[0].diff.tier).toBe("semantic");
        expect(result.documents[0].diff.changes.map((change) => change.path)).toEqual([["pages", "p1"]]);
        expect(result.documents[0].members).toEqual([P1]);
    });

    it("takes an untouched member from the recorded side rather than stat-ing every file", async () => {
        const recorded = { [MANIFEST]: manifest(["p1", "p2"]), [P1]: page("One", ["a"]), [P2]: page("Two", ["c"]) };
        const working = { ...recorded, [P1]: page("One", ["a", "b"]) };
        const { source, calls } = workingSource(statusOf([fileChange(P1, "modified")]), recorded, working);

        await diffWorkingTree(source, { sets: notebookLookup });

        // A file `status` does not name holds exactly the recorded bytes, so there is nothing to
        // learn from the disk about it. On a five-hundred-scene story the other rule would be five
        // hundred syscalls on every look at the Changes tab.
        expect(calls.filter((call) => call.startsWith("stat:"))).toEqual([`stat:${P1}`]);
        expect(calls.filter((call) => call.startsWith("working:"))).toEqual([`working:${P1}`]);
        expect(calls).toContain(`readAt:${MANIFEST}`);
        expect(calls).toContain(`readAt:${P2}`);
    });

    it("finds the rest of the document when the only change is a new member", async () => {
        // The case where every changed file is an ADDITION, so the recorded listing would not have
        // been fetched at all: the set's manifest and its other members would be invisible and a
        // story that gained a scene would come back as a stray file with no document.
        const recorded = { [MANIFEST]: manifest(["p1"]), [P1]: page("One", ["a"]) };
        const working = { ...recorded, [P2]: page("Two", ["c"]) };
        const { source } = workingSource(statusOf([fileChange(P2, "added")]), recorded, working);

        const result = await diffWorkingTree(source, { sets: notebookLookup });

        expect(result.documents).toHaveLength(1);
        expect(result.documents[0].path).toBe(MANIFEST);
        expect(result.documents[0].kind).toBe("changed");
        expect(result.documents[0].diff.tier).toBe("semantic");
        expect(result.documents[0].diff.changes).toEqual([
            expect.objectContaining({ path: ["pages", "p2"], kind: "added" }),
        ]);
    });

    it("sees a renamed member as one page leaving and another arriving", async () => {
        // **Lore reports an explicit move only at its DESTINATION** (§4.18 names the other
        // spelling, delete+add, which arrives as two entries). So the source path is in the
        // recorded tree and in no status entry at all - which is exactly the shape of an untouched
        // member. Read as untouched it lands on both sides, the destination borrows the source's
        // recorded bytes for its base, and a renamed scene reports NO CHANGES AT ALL.
        const recorded = { [MANIFEST]: manifest(["p1"]), [P1]: page("One", ["a"]) };
        const working = { [MANIFEST]: manifest(["p1"]), [P2]: page("One", ["a"]) };
        const { source } = workingSource(
            statusOf([fileChange(P2, "moved", { fromPath: P1 })]),
            recorded,
            working,
        );

        const result = await diffWorkingTree(source, { sets: notebookLookup });

        expect(result.documents).toHaveLength(1);
        expect(result.documents[0].path).toBe(MANIFEST);
        expect(result.documents[0].diff.tier).toBe("semantic");
        expect(result.documents[0].diff.changes.map((change) => [change.path[1], change.kind]).sort())
            .toEqual([["p1", "removed"], ["p2", "added"]]);
    });

    it("spends no read budget on a set it has already decided not to assemble", async () => {
        // A set over the member limit is reported as one unread row, so none of its bytes are worth
        // reading - but its members are still not standalone files. Left out of the "belongs to a
        // set" list they went back into the rename pairing and into the read plan, both of which
        // read in full out of the one shared DIFF_TOTAL_BYTE_BUDGET, and the entry then discarded
        // every byte. One large story the author never touched could push documents they DID touch
        // out of the plan and flip `complete` to false, with the reason nowhere on screen.
        const ids = Array.from({ length: DOCUMENT_SET_MEMBER_LIMIT + 2 }, (_, index) => `p${index}`);
        const recorded: Record<string, Buffer> = { [MANIFEST]: manifest(ids) };
        for (const id of ids) recorded[`editor/notebooks/n1/pages/${id}.json`] = page(id, ["a"]);
        const changedPage = "editor/notebooks/n1/pages/p0.json";
        const working = { ...recorded, [changedPage]: page("p0", ["a", "b"]) };
        const { source, calls } = workingSource(statusOf([fileChange(changedPage, "modified")]), recorded, working);
        const onDegrade = vi.fn();

        const result = await diffWorkingTree(source, { sets: notebookLookup, onDegrade });

        expect(result.documents).toHaveLength(1);
        expect(result.documents[0].diff.changes[0].label.key).toBe("documentDiff.opaque.unread");
        expect(calls.filter((call) => call.startsWith("readAt:"))).toEqual([]);
        expect(calls.filter((call) => call.startsWith("working:"))).toEqual([]);
        expect(result.complete).toBe(true);
        expect(onDegrade).toHaveBeenCalledWith(expect.stringContaining("one document made of"));
    });

    it("sees a member the author deleted as a change to the document, not as a removed file", async () => {
        const recorded = { [MANIFEST]: manifest(["p1", "p2"]), [P1]: page("One", ["a"]), [P2]: page("Two", ["c"]) };
        const working = { [MANIFEST]: manifest(["p1", "p2"]), [P1]: page("One", ["a"]) };
        const { source } = workingSource(statusOf([fileChange(P2, "deleted")]), recorded, working);

        const result = await diffWorkingTree(source, { sets: notebookLookup });

        expect(result.documents).toHaveLength(1);
        expect(result.documents[0].path).toBe(MANIFEST);
        expect(result.documents[0].kind).toBe("changed");
        expect(result.documents[0].diff.changes).toEqual([
            expect.objectContaining({ path: ["pages", "p2"], kind: "removed" }),
        ]);
    });
});
