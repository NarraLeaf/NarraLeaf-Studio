import { describe, expect, it, vi } from "vitest";
import type { VcsChangeKind, VcsFileChange, VcsStatus } from "@shared/types/vcs";
import { CONTENT_HEAD_READ_CEILING, DIFF_PATH_LIMIT } from "./documentDiff";
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
