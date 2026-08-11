import { describe, expect, it, vi } from "vitest";
import { CONTENT_HEAD_READ_CEILING, DIFF_PARSE_BYTE_CEILING, DIFF_PATH_LIMIT } from "./documentDiff";
import { diffRevisions, type RevisionDiffSource } from "./revisionDiff";

/**
 * The orchestration between two revisions: which reads happen, in what order, and what an
 * answer looks like when a budget or a failure stops it short.
 *
 * Everything here runs against a fake source, which is the point - the reading is Lore's
 * and is pinned by the integration tests next door. What is pinned here is the part that
 * has no way to announce itself when it goes wrong: an empty document list is what
 * "nothing changed", "we gave up", and "the bytes could not be read" all look like.
 *
 * **The fake counts its reads, and several tests assert on the count rather than on the
 * output.** That is the only shape that catches a regression here: a comparison that reads a
 * 200 MB video and then reports its size produces exactly the same change list as one that
 * never touched it, so an output-only test would pass through the defect that motivated the
 * whole content tier.
 */

const bytes = (value: unknown): Buffer => Buffer.from(JSON.stringify(value), "utf-8");

interface FakeRevisions {
    [revision: string]: Record<string, Buffer>;
}

function sourceOf(revisions: FakeRevisions, overrides: Partial<RevisionDiffSource> = {}) {
    const reads: { revision: string; paths: readonly string[] }[] = [];
    const walks: string[] = [];
    const source: RevisionDiffSource = {
        changedPaths: async (from, to) => {
            const all = new Set([...Object.keys(revisions[from] ?? {}), ...Object.keys(revisions[to] ?? {})]);
            return [...all].filter((path) => revisions[from]?.[path] !== revisions[to]?.[path]);
        },
        entriesAt: async (revision) => {
            walks.push(revision);
            return new Map(Object.entries(revisions[revision] ?? {}).map(([path, buffer]) => [
                path,
                // A stand-in for Lore's content address: two files with the same bytes get the
                // same one, which is exactly the property rename pairing rests on.
                { size: buffer.length, hash: buffer.toString("base64") },
            ]));
        },
        readAt: async (revision, paths) => {
            reads.push({ revision, paths });
            return new Map(paths.map((path) => [path, revisions[revision]?.[path] ?? null]));
        },
        ...overrides,
    };
    /** Every path whose bytes were pulled, on either side. */
    const readPaths = (): string[] => [...new Set(reads.flatMap((read) => [...read.paths]))].sort();
    return { source, reads, walks, readPaths };
}

describe("diffing two revisions", () => {
    it("tells an addition, a removal and an edit apart", async () => {
        const { source } = sourceOf({
            r1: { "editor/kept.json": bytes({ a: 1 }), "editor/gone.json": bytes({ a: 1 }) },
            r2: { "editor/kept.json": bytes({ a: 2 }), "editor/fresh.json": bytes({ a: 3 }) },
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

    it("walks each side once and reads each side once, one after the other", async () => {
        // Batched because the first read of a revision on a project with a remote goes to the
        // network; sequential because one session holds one store handle and re-entering the
        // binding on it is not a contract it makes. One walk per side because the walk is what
        // may go to the network in the first place (docs/version-control.md §6).
        const { source, reads, walks } = sourceOf({
            r1: { "a.json": bytes({ a: 1 }), "b.json": bytes({ a: 1 }) },
            r2: { "a.json": bytes({ a: 2 }), "b.json": bytes({ a: 2 }) },
        });

        await diffRevisions(source, { from: "r1", to: "r2" });

        expect(walks).toEqual(["r1", "r2"]);
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
        // whole reason registering a spec is worth doing.
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
            {
                r1: { "z.json": bytes(1), "a.json": bytes(1), "m.json": bytes(1) },
                r2: { "z.json": bytes(2), "a.json": bytes(2), "m.json": bytes(2) },
            },
            { changedPaths: async () => ["z.json", "a.json", "z.json", "m.json"] },
        );

        await diffRevisions(source, { from: "r1", to: "r2" });

        expect(reads[0].paths).toEqual(["a.json", "m.json", "z.json"]);
    });

    it("lists the paths without reading them past the path limit", async () => {
        const many = Array.from({ length: DIFF_PATH_LIMIT + 5 }, (_, index) => `editor/f${index}.json`);
        const { source, reads, walks } = sourceOf({}, { changedPaths: async () => many });
        const onDegrade = vi.fn();

        const result = await diffRevisions(source, { from: "r1", to: "r2", onDegrade });

        expect(reads).toEqual([]);
        // Not even the trees are walked: the answer past the limit is the list of paths.
        expect(walks).toEqual([]);
        expect(result.documents).toHaveLength(DIFF_PATH_LIMIT);
        expect(result.pathCount).toBe(many.length);
        expect(result.complete).toBe(false);
        // "Changed, not inspected" rather than an empty diff, which would read as unchanged.
        expect(result.documents[0].diff.changes[0].label.key).toBe("documentDiff.opaque.unread");
        expect(onDegrade).toHaveBeenCalledWith(expect.stringContaining("path limit"));
    });

    it("stops reading once the total byte budget is spent, and still lists every path", async () => {
        const before = Buffer.alloc(DIFF_PARSE_BYTE_CEILING - 1, 0x61);
        const after = Buffer.alloc(DIFF_PARSE_BYTE_CEILING - 1, 0x62);
        const paths = Array.from({ length: 12 }, (_, index) => `editor/big${index}.json`);
        const { source, readPaths } = sourceOf({
            r1: Object.fromEntries(paths.map((path) => [path, before])),
            r2: Object.fromEntries(paths.map((path) => [path, after])),
        });

        const result = await diffRevisions(source, { from: "r1", to: "r2" });

        // The budget now decides what is READ, not what is thrown away after reading.
        expect(readPaths().length).toBeLessThan(paths.length);
        // Everything still appears, in order: the budget decides how much is looked at, never
        // which changes exist.
        expect(result.documents).toHaveLength(paths.length);
        expect(result.complete).toBe(false);
    });

    it("reports a failed read as a failed read, not as an unchanged pair", async () => {
        // Measured, not imagined: content written by an online commit cannot be fetched back by
        // the process that wrote it (docs/version-control.md §4.29). The revision TREE still
        // answers - paths, sizes and addresses all correct - and only `storageGet` fails.
        const { source } = sourceOf({
            r1: { "editor/a.json": bytes(1), "editor/b.json": bytes(1) },
            r2: { "editor/a.json": bytes(2), "editor/b.json": bytes(2) },
        }, {
            readAt: async () => {
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

    it("reports a failed tree walk without claiming to know any sizes", async () => {
        // The other half of §4.29's shape: when the WALK fails, nothing at all is known. The
        // content tier must not be handed made-up probes just because it can run without bytes.
        const { source } = sourceOf({}, {
            changedPaths: async () => ["assets/content/a.png"],
            entriesAt: async () => {
                throw new Error("tree unavailable");
            },
        });

        const result = await diffRevisions(source, { from: "r1", to: "r2" });

        expect(result.readFailure).toBe("tree unavailable");
        expect(result.documents[0].diff.changes[0].label.key).toBe("documentDiff.opaque.unread");
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

/**
 * The invariant the whole content tier exists for.
 *
 * Asserted on the CALL COUNT and not on the change list, deliberately: reading a file and then
 * describing it by its size produces the same rows as never reading it, so the only way to see
 * the difference is to count.
 */
describe("what is never read", () => {
    /** Bigger than the header ceiling, so no provider is entitled to ask for its front either. */
    const video = (fill: number): Buffer => Buffer.alloc(CONTENT_HEAD_READ_CEILING + 1024, fill);

    it("reads not one byte of a large asset, and still says how it changed", async () => {
        const { source, readPaths } = sourceOf({
            r1: { "assets/content/intro.mp4": video(1) },
            r2: { "assets/content/intro.mp4": video(2) },
        });

        const result = await diffRevisions(source, { from: "r1", to: "r2" });

        expect(readPaths()).toEqual([]);
        expect(result.documents).toHaveLength(1);
        expect(result.documents[0].kind).toBe("changed");
        // It has something to say - the sizes are equal here, so it says the contents differ.
        expect(result.documents[0].diff.changes.length).toBeGreaterThan(0);
        expect(result.complete).toBe(true);
    });

    it("reads the documents beside an untouched asset", async () => {
        // Non-vacuous: the same comparison that reads nothing of the video reads the story.
        const { source, readPaths } = sourceOf({
            r1: { "assets/content/intro.mp4": video(1), "editor/story.json": bytes({ v: 1 }) },
            r2: { "assets/content/intro.mp4": video(2), "editor/story.json": bytes({ v: 2 }) },
        });

        await diffRevisions(source, { from: "r1", to: "r2" });

        expect(readPaths()).toEqual(["editor/story.json"]);
    });

    it("reads nothing for a document past the parse ceiling either", async () => {
        // The old flow pulled both sides and only then noticed the ceiling, so a huge JSON cost
        // its full size in memory to be reported by size.
        const huge = (fill: number): Buffer => Buffer.alloc(DIFF_PARSE_BYTE_CEILING + 1, fill);
        const { source, readPaths } = sourceOf({
            r1: { "editor/huge.json": huge(0x61) },
            r2: { "editor/huge.json": huge(0x62) },
        });

        await diffRevisions(source, { from: "r1", to: "r2" });

        expect(readPaths()).toEqual([]);
    });

    it("describes an asset stored under its id without reading anything extra for it", async () => {
        // `assets/content/<shard>/<shard>/<id>` is the shape a real project holds, and there is
        // no extension anywhere in it. This side has no ranged fetch, so it cannot probe a file's
        // front - what it does instead is classify from the bytes it was already going to pull,
        // which is why the read list below is the same one an unclassifiable file produces.
        const shard = "assets/content/99/55/3d15abb54213bad7203798a1adc4";
        const png = (width: number, height: number, size: number): Buffer => {
            const out = Buffer.alloc(size, 0x7f);
            Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(out, 0);
            out.writeUInt32BE(13, 8);
            out.write("IHDR", 12);
            out.writeUInt32BE(width, 16);
            out.writeUInt32BE(height, 20);
            return out;
        };
        const { source, readPaths } = sourceOf({
            r1: { [shard]: png(1088, 1984, 40_000) },
            r2: { [shard]: png(1024, 1024, 12_000) },
        });

        const result = await diffRevisions(source, { from: "r1", to: "r2" });

        expect(readPaths()).toEqual([shard]);
        expect(result.documents[0].diff.tier).toBe("content");
        expect(result.documents[0].diff.changes.map((change) => change.label.key)).toEqual([
            "documentDiff.content.dimensions",
            "documentDiff.content.size",
        ]);
    });

    it("reads a small image, because its header is worth the bytes", async () => {
        // The other side of the ceiling: a sprite is small enough that pulling it to read eight
        // bytes of IHDR is the right trade, and the backend has no ranged fetch to do better.
        const { source, readPaths } = sourceOf({
            r1: { "assets/content/face.png": Buffer.alloc(2048, 1) },
            r2: { "assets/content/face.png": Buffer.alloc(4096, 2) },
        });

        await diffRevisions(source, { from: "r1", to: "r2" });

        expect(readPaths()).toEqual(["assets/content/face.png"]);
    });
});

describe("renames", () => {
    it("pairs a deletion and an addition that hold the same bytes, and reads neither", async () => {
        const sprite = Buffer.alloc(4096, 7);
        const { source, readPaths } = sourceOf({
            r1: { "assets/content/old.png": sprite },
            r2: { "assets/content/new.png": sprite },
        });

        const result = await diffRevisions(source, { from: "r1", to: "r2" });

        expect(result.documents).toHaveLength(1);
        expect(result.documents[0].path).toBe("assets/content/new.png");
        expect(result.documents[0].kind).toBe("moved");
        expect(result.documents[0].diff.changes[0].label).toEqual({
            key: "documentDiff.content.moved",
            params: { from: "assets/content/old.png" },
        });
        // Proving a rename costs nothing: both content addresses came out of the tree walk.
        expect(readPaths()).toEqual([]);
    });

    it("does not pair two files that merely happen to be the same size", async () => {
        const { source } = sourceOf({
            r1: { "assets/content/old.png": Buffer.alloc(4096, 7) },
            r2: { "assets/content/new.png": Buffer.alloc(4096, 8) },
        });

        const result = await diffRevisions(source, { from: "r1", to: "r2" });

        expect(result.documents.map((entry) => entry.kind).sort()).toEqual(["added", "removed"]);
    });

    it("pairs several renames deterministically when the bytes are indistinguishable", async () => {
        // Two placeholders with identical contents really do have no fact saying which became
        // which. What must not happen is the answer changing between two reads of the same pair.
        const same = Buffer.alloc(64, 0);
        const revisions = {
            r1: { "a/one.bin": same, "a/two.bin": same },
            r2: { "b/one.bin": same, "b/two.bin": same },
        };
        const first = await diffRevisions(sourceOf(revisions).source, { from: "r1", to: "r2" });
        const again = await diffRevisions(sourceOf(revisions).source, { from: "r1", to: "r2" });

        expect(first.documents.map((entry) => entry.kind)).toEqual(["moved", "moved"]);
        expect(first).toEqual(again);
    });

    it("leaves a genuine deletion alone", async () => {
        const { source } = sourceOf({
            r1: { "assets/content/gone.png": Buffer.alloc(32, 1) },
            r2: {},
        });

        const result = await diffRevisions(source, { from: "r1", to: "r2" });

        expect(result.documents.map((entry) => entry.kind)).toEqual(["removed"]);
    });
});
