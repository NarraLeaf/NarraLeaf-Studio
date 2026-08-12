import { describe, expect, it, vi } from "vitest";
import type { VcsChangeKind, VcsFileChange, VcsStatus } from "@shared/types/vcs";
import {
    CONTENT_HEAD_READ_CEILING,
    DIFF_MOVE_CONFIRM_BYTE_CEILING,
    DIFF_PARSE_BYTE_CEILING,
    DIFF_PATH_LIMIT,
} from "./documentDiff";
import { diffWorkingTree, type WorkingTreeDiffSource } from "./workingTreeDiff";

/**
 * The comparison between the last version and the files on disk.
 *
 * The asymmetry with a revision comparison is the whole subject: one side is immutable and
 * the other is being edited while this runs, which is why nothing may cache the result and
 * why a file that vanishes between the scan and the read is an ordinary outcome rather
 * than a failure.
 *
 * The fake records every call in one ordered list, so the tests can assert on **what was not
 * read** as well as on what came out. That is the only way to see the difference between a
 * comparison that opens a 200 MB video and one that does not: both produce the same row.
 */

const bytes = (value: unknown): Buffer => Buffer.from(JSON.stringify(value), "utf-8");

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

/** `head: null` is a repository with no revisions - passing `undefined` would take the default. */
function statusOf(files: VcsFileChange[], head: string | null = "r1"): VcsStatus {
    return {
        branch: "main",
        ...(head ? { head } : {}),
        revisionNumber: head ? 1 : 0,
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

function sourceOf(
    status: VcsStatus,
    recorded: Record<string, Buffer>,
    working: Record<string, Buffer>,
    overrides: Partial<WorkingTreeDiffSource> = {},
) {
    const reads: string[] = [];
    const source: WorkingTreeDiffSource = {
        status: async () => status,
        entriesAt: async (revision) => {
            reads.push(`entriesAt:${revision}`);
            return new Map(Object.entries(recorded).map(([path, buffer]) => [
                path,
                { size: buffer.length, hash: buffer.toString("base64") },
            ]));
        },
        readAt: async (revision, paths) => {
            reads.push(`readAt:${revision}`);
            return new Map(paths.map((path) => [path, recorded[path] ?? null]));
        },
        statWorking: async (path) => (working[path] ? { size: working[path].length } : null),
        // Recorded under its own prefix, and that is the point of the port being its own port:
        // a fixed-length probe of a file's front and a whole-file read cost different things,
        // and the assertions below are about telling them apart.
        readWorkingHead: async (path, length) => {
            reads.push(`head:${path}`);
            return working[path]?.subarray(0, length) ?? null;
        },
        readWorking: async (path) => {
            reads.push(`working:${path}`);
            return working[path] ?? null;
        },
        ...overrides,
    };
    return { source, reads };
}

describe("diffing the working tree against the last version", () => {
    it("maps the backend's change kinds onto the document model's", async () => {
        const { source } = sourceOf(
            statusOf([
                fileChange("editor/a.json", "modified"),
                fileChange("editor/b.json", "added"),
                fileChange("editor/c.json", "deleted"),
                fileChange("editor/d.json", "copied"),
            ]),
            { "editor/a.json": bytes({ a: 1 }), "editor/c.json": bytes({ c: 1 }) },
            { "editor/a.json": bytes({ a: 2 }), "editor/b.json": bytes({ b: 1 }), "editor/d.json": bytes({ d: 1 }) },
        );

        const result = await diffWorkingTree(source);

        expect(result.documents.map((entry) => `${entry.path}:${entry.kind}`)).toEqual([
            "editor/a.json:changed",
            "editor/b.json:added",
            "editor/c.json:removed",
            "editor/d.json:added",
        ]);
        expect(result.head).toBe("r1");
        expect(result.complete).toBe(true);
    });

    it("drops directories, which the backend counts as changes of their own", async () => {
        const { source } = sourceOf(
            statusOf([fileChange("editor/new", "added", { directory: true }), fileChange("editor/new/a.json", "added")]),
            {},
            { "editor/new/a.json": bytes({ a: 1 }) },
        );

        const result = await diffWorkingTree(source);

        expect(result.documents.map((entry) => entry.path)).toEqual(["editor/new/a.json"]);
    });

    it("walks and reads the recorded side once each, before touching the working tree", async () => {
        const { source, reads } = sourceOf(
            statusOf([fileChange("editor/a.json", "modified"), fileChange("editor/b.json", "modified")]),
            { "editor/a.json": bytes({ a: 1 }), "editor/b.json": bytes({ b: 1 }) },
            { "editor/a.json": bytes({ a: 2 }), "editor/b.json": bytes({ b: 2 }) },
        );

        await diffWorkingTree(source);

        expect(reads).toEqual([
            "entriesAt:r1",
            "readAt:r1",
            "working:editor/a.json",
            "working:editor/b.json",
        ]);
    });

    it("looks for a moved file's recorded bytes under the name it was committed with", async () => {
        const { source } = sourceOf(
            statusOf([fileChange("editor/new.json", "moved", { fromPath: "editor/old.json" })]),
            { "editor/old.json": bytes({ title: "Prologue" }) },
            { "editor/new.json": bytes({ title: "Prologue" }) },
        );

        const result = await diffWorkingTree(source);

        expect(result.documents[0].kind).toBe("moved");
        // Same bytes under a new name: the move is the change, and there is nothing inside it.
        expect(result.documents[0].diff.changes).toEqual([]);
    });

    it("reads nothing out of history in a repository with no versions yet", async () => {
        const { source, reads } = sourceOf(
            statusOf([fileChange("editor/a.json", "added")], null),
            {},
            { "editor/a.json": bytes({ a: 1 }) },
        );

        const result = await diffWorkingTree(source);

        expect(result.head).toBeUndefined();
        expect(reads).toEqual(["working:editor/a.json"]);
        expect(result.documents[0].kind).toBe("added");
    });

    it("treats a file deleted between the scan and the read as gone, not as a failure", async () => {
        // The scan and the read are separated by however long the author took, and Studio's own
        // auto-save is writing in that window too.
        const { source } = sourceOf(statusOf([fileChange("editor/a.json", "added")]), {}, {});

        const result = await diffWorkingTree(source);

        expect(result.documents).toEqual([]);
        expect(result.readFailure).toBeNull();
    });

    it("reports a failed read of the recorded side rather than calling everything an addition", async () => {
        // With the recorded side unreadable, every change would look like an addition - a worse
        // lie than saying the version could not be read. Reachable per §4.29.
        const { source } = sourceOf(
            statusOf([fileChange("editor/a.json", "modified")]),
            { "editor/a.json": bytes({ a: 1 }) },
            { "editor/a.json": bytes({ a: 2 }) },
            {
                readAt: async () => {
                    throw new Error("1/1 get items failed");
                },
            },
        );

        const result = await diffWorkingTree(source);

        expect(result.readFailure).toBe("1/1 get items failed");
        expect(result.documents[0].kind).toBe("changed");
        expect(result.documents[0].diff.changes[0].label.key).toBe("documentDiff.opaque.unread");
        expect(result.complete).toBe(false);
    });

    it("reports a failed walk of the recorded side the same way", async () => {
        const { source } = sourceOf(
            statusOf([fileChange("editor/a.json", "modified")]),
            {},
            { "editor/a.json": bytes({ a: 2 }) },
            {
                entriesAt: async () => {
                    throw new Error("tree unavailable");
                },
            },
        );

        const result = await diffWorkingTree(source);

        expect(result.readFailure).toBe("tree unavailable");
        expect(result.documents[0].diff.changes[0].label.key).toBe("documentDiff.opaque.unread");
    });

    it("lists without reading past the path limit", async () => {
        const files = Array.from({ length: DIFF_PATH_LIMIT + 3 }, (_, index) => fileChange(`editor/f${index}.json`, "modified"));
        const { source, reads } = sourceOf(statusOf(files), {}, {});
        const onDegrade = vi.fn();

        const result = await diffWorkingTree(source, { onDegrade });

        expect(reads).toEqual([]);
        expect(result.documents).toHaveLength(DIFF_PATH_LIMIT);
        expect(result.pathCount).toBe(files.length);
        expect(result.complete).toBe(false);
        expect(onDegrade).toHaveBeenCalledWith(expect.stringContaining("path limit"));
    });
});

/**
 * A rename reaches the working tree as one deletion and one addition (§4.18), and the paths
 * below are `.moc3` on purpose: a model binary is the one class whose provider reads nothing at
 * all, so every read in these lists was spent deciding whether the two are the same file and
 * nothing else. Renaming a character's model folder is also where an author meets this first.
 */
describe("pairing a deletion with the addition holding the same bytes", () => {
    const model = (size: number, fill: number): Buffer => Buffer.alloc(size, fill);

    function renameOf(recorded: Buffer, working: Buffer | null) {
        return sourceOf(
            statusOf([
                fileChange("assets/content/new.moc3", "added"),
                fileChange("assets/content/old.moc3", "deleted"),
            ]),
            { "assets/content/old.moc3": recorded },
            working ? { "assets/content/new.moc3": working } : {},
        );
    }

    it("does not open either file when the two sizes differ", async () => {
        // The sizes are already in hand on both sides and two lengths that differ cannot be the
        // same bytes, so this must be settled without a read. Asserted on the call list rather
        // than the rows, because a comparison that reads both files answers identically.
        const { source, reads } = renameOf(model(64, 1), model(96, 1));

        const result = await diffWorkingTree(source);

        expect(reads).toEqual(["entriesAt:r1"]);
        expect(result.documents.map((entry) => `${entry.path}:${entry.kind}`)).toEqual([
            "assets/content/new.moc3:added",
            "assets/content/old.moc3:removed",
        ]);
    });

    it("does not call it a move when the sizes agree and the bytes do not", async () => {
        // The case a "same size, same first kilobyte" test would get wrong. Telling an author
        // their file only moved, while its contents were in fact replaced, is worse than the two
        // rows they would otherwise have read past.
        const { source, reads } = renameOf(model(64, 1), model(64, 2));

        const result = await diffWorkingTree(source);

        // Non-vacuous: both sides WERE read, and the answer is still two rows.
        expect(reads).toEqual(["entriesAt:r1", "readAt:r1", "working:assets/content/new.moc3"]);
        expect(result.documents.map((entry) => `${entry.path}:${entry.kind}`)).toEqual([
            "assets/content/new.moc3:added",
            "assets/content/old.moc3:removed",
        ]);
    });

    it("calls it a move when the bytes match, and says so once", async () => {
        const { source } = renameOf(model(64, 1), model(64, 1));

        const result = await diffWorkingTree(source);

        // One row, on the path it moved to. Neither path may still appear as an add or a remove:
        // that is the noise the pairing exists to remove.
        expect(result.documents).toHaveLength(1);
        expect(result.documents[0].path).toBe("assets/content/new.moc3");
        expect(result.documents[0].kind).toBe("moved");
        expect(result.documents[0].diff.changes).toEqual([{
            path: [],
            kind: "moved",
            label: { key: "documentDiff.content.moved", params: { from: "assets/content/old.moc3" } },
        }]);
    });

    it("leaves a candidate over the confirmation ceiling as it arrived, unopened", async () => {
        // Identical bytes, so the only thing keeping these two rows apart is the ceiling - which
        // is what makes this a test of the ceiling rather than of the comparison.
        const huge = DIFF_MOVE_CONFIRM_BYTE_CEILING + 1;
        const { source, reads } = renameOf(model(huge, 1), model(huge, 1));

        const result = await diffWorkingTree(source);

        expect(reads).toEqual(["entriesAt:r1"]);
        expect(result.documents.map((entry) => entry.kind)).toEqual(["added", "removed"]);
    });

    it("pairs by content rather than by the order the paths sort in", async () => {
        const { source } = sourceOf(
            statusOf([
                fileChange("assets/content/a2.moc3", "added"),
                fileChange("assets/content/b2.moc3", "added"),
                fileChange("assets/content/a1.moc3", "deleted"),
                fileChange("assets/content/b1.moc3", "deleted"),
            ]),
            { "assets/content/a1.moc3": model(64, 1), "assets/content/b1.moc3": model(64, 2) },
            { "assets/content/a2.moc3": model(64, 2), "assets/content/b2.moc3": model(64, 1) },
        );

        const result = await diffWorkingTree(source);

        expect(result.documents.map((entry) => [entry.path, entry.diff.changes[0]?.label.params?.from])).toEqual([
            ["assets/content/a2.moc3", "assets/content/b1.moc3"],
            ["assets/content/b2.moc3", "assets/content/a1.moc3"],
        ]);
    });

    it("never turns the backend's own copy into a move", async () => {
        // A copy's source is still on disk, so there is no removal it belongs to. Pairing it with
        // an unrelated deletion of the same bytes would say the original is gone.
        const { source } = sourceOf(
            statusOf([
                fileChange("assets/content/copy.moc3", "copied"),
                fileChange("assets/content/old.moc3", "deleted"),
            ]),
            { "assets/content/old.moc3": model(64, 1) },
            { "assets/content/copy.moc3": model(64, 1) },
        );

        const result = await diffWorkingTree(source);

        expect(result.documents.map((entry) => entry.kind)).toEqual(["added", "removed"]);
    });
});

describe("what is never read", () => {
    const video = (fill: number): Buffer => Buffer.alloc(CONTENT_HEAD_READ_CEILING + 1024, fill);

    it("never opens a re-exported video, on either side", async () => {
        const { source, reads } = sourceOf(
            statusOf([fileChange("assets/content/intro.mp4", "modified")]),
            { "assets/content/intro.mp4": video(1) },
            { "assets/content/intro.mp4": video(2) },
        );

        const result = await diffWorkingTree(source);

        // The walk is the only backend call: no `readAt`, no `readWorking`.
        expect(reads).toEqual(["entriesAt:r1"]);
        expect(result.documents).toHaveLength(1);
        expect(result.documents[0].diff.changes.length).toBeGreaterThan(0);
    });

    it("still opens the documents beside it", async () => {
        // Non-vacuous: the same run that skips the video reads the story.
        const { source, reads } = sourceOf(
            statusOf([
                fileChange("assets/content/intro.mp4", "modified"),
                fileChange("editor/story.json", "modified"),
            ]),
            { "assets/content/intro.mp4": video(1), "editor/story.json": bytes({ v: 1 }) },
            { "assets/content/intro.mp4": video(2), "editor/story.json": bytes({ v: 2 }) },
        );

        await diffWorkingTree(source);

        expect(reads).toEqual(["entriesAt:r1", "readAt:r1", "working:editor/story.json"]);
    });
});

/**
 * The comparison as a real project presents it: an asset with no extension anywhere in its path.
 *
 * `assets/content/<shard>/<shard>/<id>` is where Studio keeps an asset's contents, so a name
 * carries no class and every one of these files used to be read in full on both sides to be
 * described by its size. What is pinned here is both halves of the fix at once - the row the
 * author gets, and the reads it cost - because either alone passes on the broken version: the
 * whole-file read produced the same size row, and refusing to read produced the same silence.
 */
describe("an asset stored under its id", () => {
    const SHARD = "assets/content/99/55/3d15abb54213bad7203798a1adc4";

    function png(width: number, height: number, size: number): Buffer {
        const out = Buffer.alloc(Math.max(size, 33), 0x7f);
        Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(out, 0);
        out.writeUInt32BE(13, 8);
        out.write("IHDR", 12);
        out.writeUInt32BE(width, 16);
        out.writeUInt32BE(height, 20);
        return out;
    }

    it("names the resolution that changed, from a path that names nothing", async () => {
        const { source, reads } = sourceOf(
            statusOf([fileChange(SHARD, "modified")]),
            { [SHARD]: png(1088, 1984, 40_000) },
            { [SHARD]: png(1024, 1024, 12_000) },
        );

        const result = await diffWorkingTree(source);

        expect(result.documents[0].diff.tier).toBe("content");
        expect(result.documents[0].diff.changes.map((change) => change.label.key)).toEqual([
            "documentDiff.content.dimensions",
            "documentDiff.content.size",
        ]);
        // The probe happens once, before anything is planned, and is the only extra call: both
        // copies are still pulled because they are small enough for the header to be worth it.
        expect(reads).toEqual(["entriesAt:r1", `head:${SHARD}`, "readAt:r1", `working:${SHARD}`]);
    });

    it("stops opening a large one the moment its front says what it is", async () => {
        // The read the probe pays for itself with. Over the header ceiling a named `.png` was
        // already left alone; an id was not, because `unknown` reads as "might be JSON" and buys
        // the whole file twice. Now the front of it settles the question for a few dozen bytes.
        const large = (fill: number): Buffer => {
            const out = png(4096, 4096, CONTENT_HEAD_READ_CEILING + 1024);
            out.fill(fill, 33);
            return out;
        };
        const { source, reads } = sourceOf(
            statusOf([fileChange(SHARD, "modified")]),
            { [SHARD]: large(1) },
            { [SHARD]: large(2) },
        );

        const result = await diffWorkingTree(source);

        expect(reads).toEqual(["entriesAt:r1", `head:${SHARD}`]);
        // Still described, and described as a bitmap: the size row plus the rung that says the
        // format was placed and its contents were not read.
        expect(result.documents[0].diff.tier).toBe("content");
        expect(result.documents[0].diff.changes.map((change) => change.label.key))
            .toEqual(["documentDiff.content.notInspected"]);
        // What the probe learned is carried out to whoever draws this, and it is the only place
        // that answer exists: nothing in the path says `bitmap` and the renderer never sees a
        // byte of the file until it asks for one.
        expect(result.documents[0].contentClass).toBe("bitmap");
    });

    it("places an asset that was deleted, out of the bytes it had already pulled", async () => {
        // The defect this pins was only visible on a DELETION, and only on the surface furthest
        // from here: with nothing on disk to probe, a deleted sprite reached the comparison as
        // `unknown`, so the pane that draws pictures declined it and the author was told
        // "removed, 900 B" about a file whose whole point is what it looked like.
        const { source, reads } = sourceOf(
            statusOf([fileChange(SHARD, "deleted")]),
            { [SHARD]: png(1024, 1024, 900) },
            {},
        );

        const result = await diffWorkingTree(source);

        expect(result.documents[0].kind).toBe("removed");
        expect(result.documents[0].contentClass).toBe("bitmap");
        // Non-vacuous in the direction that matters: no `head:` probe was added to buy this. The
        // recorded read is the one the plan was always going to make, and the working tree is
        // never touched for a file that is not there.
        expect(reads).toEqual(["entriesAt:r1", "readAt:r1"]);
    });

    it("leaves a deletion nobody opened unplaced rather than reading it to find out", async () => {
        // The ceiling, from the side that has no way around it: `storageGet` answers with a whole
        // blob or nothing, so placing this one would mean pulling every byte of it for a few dozen
        // at the front. `unknown` is the honest answer for a file nobody opened.
        const { source, reads } = sourceOf(
            statusOf([fileChange(SHARD, "deleted")]),
            { [SHARD]: png(4096, 4096, DIFF_PARSE_BYTE_CEILING + 1024) },
            {},
        );

        const result = await diffWorkingTree(source);

        expect(reads).toEqual(["entriesAt:r1"]);
        expect(result.documents[0].kind).toBe("removed");
        expect(result.documents[0].contentClass).toBe("unknown");
    });

    it("probes nothing whose name already answers, and nothing that is gone", async () => {
        // The probe is bounded to the paths it can help: a named document, a named asset and a
        // deletion are all settled without it. A deletion could not use one anyway - there is no
        // file on disk to read, and the recorded side has no ranged fetch.
        const { source, reads } = sourceOf(
            statusOf([
                fileChange("editor/story.json", "modified"),
                fileChange("assets/content/intro.mp4", "modified"),
                fileChange(SHARD, "deleted"),
            ]),
            {
                "editor/story.json": bytes({ v: 1 }),
                "assets/content/intro.mp4": Buffer.alloc(CONTENT_HEAD_READ_CEILING + 1024, 1),
                [SHARD]: png(64, 64, 900),
            },
            { "editor/story.json": bytes({ v: 2 }) },
        );

        await diffWorkingTree(source);

        expect(reads.filter((entry) => entry.startsWith("head:"))).toEqual([]);
    });
});
