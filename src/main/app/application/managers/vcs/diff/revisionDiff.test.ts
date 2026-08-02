import { describe, expect, it, vi } from "vitest";
import { DIFF_PARSE_BYTE_CEILING, DIFF_PATH_LIMIT } from "./documentDiff";
import { diffRevisions, type RevisionDiffSource } from "./revisionDiff";

/**
 * The orchestration between two revisions: which reads happen, in what order, and what an
 * answer looks like when a budget or a failure stops it short.
 *
 * Everything here runs against a fake source, which is the point - the reading is Lore's
 * and is pinned by the integration tests next door. What is pinned here is the part that
 * has no way to announce itself when it goes wrong: an empty document list is what
 * "nothing changed", "we gave up", and "the bytes could not be read" all look like.
 */

const bytes = (value: unknown): Buffer => Buffer.from(JSON.stringify(value), "utf-8");

interface FakeRevisions {
    [revision: string]: Record<string, Buffer>;
}

function sourceOf(revisions: FakeRevisions, overrides: Partial<RevisionDiffSource> = {}) {
    const reads: { revision: string; paths: readonly string[] }[] = [];
    const source: RevisionDiffSource = {
        changedPaths: async (from, to) => {
            const all = new Set([...Object.keys(revisions[from] ?? {}), ...Object.keys(revisions[to] ?? {})]);
            return [...all].filter((path) => revisions[from]?.[path] !== revisions[to]?.[path]);
        },
        documentsAt: async (revision, paths) => {
            reads.push({ revision, paths });
            return new Map(paths.map((path) => [path, revisions[revision]?.[path] ?? null]));
        },
        ...overrides,
    };
    return { source, reads };
}

describe("diffing two revisions", () => {
    it("tells an addition, a removal and an edit apart", async () => {
        const { source } = sourceOf({
            r1: { "editor/kept.json": bytes({ a: 1 }), "editor/gone.json": bytes({ a: 1 }) },
            r2: { "editor/kept.json": bytes({ a: 2 }), "editor/fresh.json": bytes({ a: 1 }) },
        });

        const result = await diffRevisions(source, { from: "r1", to: "r2" });

        expect(result.documents.map((entry) => `${entry.path}:${entry.kind}`)).toEqual([
            "editor/fresh.json:added",
            "editor/gone.json:removed",
            "editor/kept.json:changed",
        ]);
        expect(result.complete).toBe(true);
        expect(result.readFailure).toBeNull();
        expect(result.pathCount).toBe(3);
    });

    it("reads each side once, and one after the other", async () => {
        // Batched because the first read of a revision on a project with a remote goes to the
        // network; sequential because one session holds one store handle and re-entering the
        // binding on it is not a contract it makes.
        const { source, reads } = sourceOf({
            r1: { "a.json": bytes({ a: 1 }), "b.json": bytes({ a: 1 }) },
            r2: { "a.json": bytes({ a: 2 }), "b.json": bytes({ a: 2 }) },
        });

        await diffRevisions(source, { from: "r1", to: "r2" });

        expect(reads.map((read) => read.revision)).toEqual(["r1", "r2"]);
        expect(reads[0].paths).toEqual(["a.json", "b.json"]);
    });

    it("names the spec that owns a path, so the surface can say what kind of document it is", async () => {
        const { source } = sourceOf({
            r1: { "editor/audio-tracks.json": bytes({ version: 2, tracks: [] }) },
            r2: { "editor/audio-tracks.json": bytes({ version: 2, tracks: [{ id: "bgm" }] }) },
        });

        const result = await diffRevisions(source, { from: "r1", to: "r2" });

        expect(result.documents[0].documentKind).toBe("audio-tracks");
        // Registered spec, no `diff` of its own yet: tier 2 is what that gets, and it is the
        // whole reason registering a spec is worth doing before D4.
        expect(result.documents[0].diff.tier).toBe("summary");
    });

    it("skips a path neither revision holds bytes for", async () => {
        // A directory. The backend reports it as a changed path in its own right.
        const { source } = sourceOf({ r1: {}, r2: {} }, { changedPaths: async () => ["editor/story"] });

        const result = await diffRevisions(source, { from: "r1", to: "r2" });

        expect(result.documents).toEqual([]);
        expect(result.pathCount).toBe(0);
    });

    it("orders and de-duplicates the paths before spending anything on them", async () => {
        const { source, reads } = sourceOf(
            { r1: { "b.json": bytes(1) }, r2: { "b.json": bytes(2) } },
            { changedPaths: async () => ["z.json", "a.json", "z.json", "m.json"] },
        );

        await diffRevisions(source, { from: "r1", to: "r2" });

        expect(reads[0].paths).toEqual(["a.json", "m.json", "z.json"]);
    });

    it("lists the paths without reading them past the path limit", async () => {
        const many = Array.from({ length: DIFF_PATH_LIMIT + 5 }, (_, index) => `editor/f${index}.json`);
        const { source, reads } = sourceOf({}, { changedPaths: async () => many });
        const onDegrade = vi.fn();

        const result = await diffRevisions(source, { from: "r1", to: "r2", onDegrade });

        expect(reads).toEqual([]);
        expect(result.documents).toHaveLength(DIFF_PATH_LIMIT);
        expect(result.pathCount).toBe(many.length);
        expect(result.complete).toBe(false);
        // "Changed, not inspected" rather than an empty diff, which would read as unchanged.
        expect(result.documents[0].diff.changes[0].label.key).toBe("documentDiff.opaque.unread");
        expect(onDegrade).toHaveBeenCalledWith(expect.stringContaining("path limit"));
    });

    it("stops parsing once the total byte budget is spent, and says which documents it skipped", async () => {
        // Two buffers over the parse ceiling, reused for every path: they are reported by size
        // without being parsed, which keeps this test about the TOTAL budget alone.
        const before = Buffer.alloc(DIFF_PARSE_BYTE_CEILING + 1, 0x61);
        const after = Buffer.alloc(DIFF_PARSE_BYTE_CEILING + 1, 0x62);
        const paths = Array.from({ length: 8 }, (_, index) => `editor/big${index}.json`);
        const { source } = sourceOf({}, {
            changedPaths: async () => paths,
            documentsAt: async (revision, requested) => new Map(
                requested.map((path) => [path, revision === "r1" ? before : after]),
            ),
        });

        const result = await diffRevisions(source, { from: "r1", to: "r2" });

        const unread = result.documents.filter(
            (entry) => entry.diff.changes[0]?.label.key === "documentDiff.opaque.unread",
        );
        expect(unread.length).toBeGreaterThan(0);
        expect(unread.length).toBeLessThan(paths.length);
        // Everything still appears, in order: the budget decides how much is looked at, never
        // which changes exist.
        expect(result.documents).toHaveLength(paths.length);
        expect(result.complete).toBe(false);
    });

    it("reports a failed read as a failed read, not as an unchanged pair", async () => {
        // Measured, not imagined: content written by an online commit cannot be fetched back by
        // the process that wrote it (docs/version-control.md §4.29). The revision TREE still
        // answers - paths, sizes and addresses all correct - and only `storageGet` fails.
        const { source } = sourceOf({}, {
            changedPaths: async () => ["editor/a.json", "editor/b.json"],
            documentsAt: async () => {
                throw new Error("1/1 get items failed");
            },
        });
        const onDegrade = vi.fn();

        const result = await diffRevisions(source, { from: "r1", to: "r2", onDegrade });

        expect(result.readFailure).toBe("1/1 get items failed");
        expect(result.documents).toHaveLength(2);
        expect(result.documents[0].diff.changes[0].label.key).toBe("documentDiff.opaque.unread");
        expect(result.complete).toBe(false);
        expect(onDegrade).toHaveBeenCalled();
    });

    it("answers the same thing twice for the same pair", async () => {
        const { source } = sourceOf({
            r1: { "a.json": bytes({ x: [1, 2] }) },
            r2: { "a.json": bytes({ x: [1, 3] }) },
        });

        expect(await diffRevisions(source, { from: "r1", to: "r2" }))
            .toEqual(await diffRevisions(source, { from: "r1", to: "r2" }));
    });
});
