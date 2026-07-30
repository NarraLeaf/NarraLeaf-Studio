import fs from "fs";
import fsPromises from "fs/promises";
import os from "os";
import path from "path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { isVersioned } from "@shared/vcs/workingSet";
import {
    blueprintAssetContentPaths,
    materializeRevisionSnapshot,
    partitionSnapshotEntries,
    removeRevisionSnapshots,
    revisionSnapshotDirectory,
    type RevisionSnapshotSource,
} from "./revisionSnapshot";
import type { RevisionFileEntry } from "./revisionReader";

/**
 * The snapshot's policy and its writer, without a repository.
 *
 * `revisionSnapshot.integration.test.ts` is the one that proves the bytes come out of a real
 * revision; what belongs here is everything that decides WHERE they land and WHICH of them travel,
 * because those are the two ways a snapshot goes wrong silently: inside the working set it looks like
 * an edit the author never made, and missing a file the compile path reads produces a bundle that is
 * quietly incomplete.
 */

const REVISION = "d59feba37af3fbb9c0ffee0123456789abcdef0123456789abcdef0123456789";
const BLUEPRINT_ID = "2d44332f-18b9-4892-b269-c6f02ad31d95";
/** `assets/content/<2>/<2>/<rest>` for the id above, as `splitAssetStorageId` fans it out. */
const BLUEPRINT_CONTENT = "assets/content/2d/44/332f18b94892b269c6f02ad31d95";

let project: string;

function entry(relative: string, size = 8): RevisionFileEntry {
    return { path: relative, size, hash: "a".repeat(64), context: "b".repeat(64) };
}

function sourceOf(files: Map<string, Buffer>): RevisionSnapshotSource {
    return {
        list: async () => [...files].map(([relative, bytes]) => entry(relative, bytes.length)),
        read: async (e) => files.get(e.path) ?? Buffer.alloc(0),
    };
}

beforeEach(() => {
    project = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "nl-snap-")));
});

afterEach(() => {
    fs.rmSync(project, { recursive: true, force: true });
});

describe("where a snapshot lives", () => {
    it("is outside the working set, so running an old version cannot look like an edit", () => {
        const directory = revisionSnapshotDirectory(project, REVISION);
        const relative = path.relative(project, directory);

        // The predicate the repository itself is generated from. If this ever answers true, every
        // launch of a past revision adds a few hundred files to the author's change list.
        expect(isVersioned(relative)).toBe(false);
        expect(relative.split(path.sep)[0]).toBe(".nlstudio");
    });

    it("names the revision, so a stray directory says which one it is", () => {
        const directory = revisionSnapshotDirectory(project, REVISION);
        expect(path.basename(directory)).toBe(REVISION.slice(0, 16));
        // Shorter than the full id on purpose: the project's own deepest paths are appended to this
        // one, and Windows still enforces MAX_PATH in plenty of places.
        expect(path.basename(directory).length).toBeLessThan(REVISION.length);
    });
});

describe("what travels", () => {
    it("drops anything the working set excludes, because a tree is untrusted input", () => {
        const { documents, media } = partitionSnapshotEntries([
            entry("editor/story/index.json"),
            entry(".nlstudio/services/panel_state.json"),
            entry("editor/cache/thumbnail/aa/bb/x.png"),
            entry("../escape.json"),
            entry("assets/content/aa/bb/cc"),
        ]);

        expect(documents.map((e) => e.path)).toEqual(["editor/story/index.json"]);
        expect(media.map((e) => e.path)).toEqual(["assets/content/aa/bb/cc"]);
    });

    it("resolves blueprint content the same way the compile path does", () => {
        const paths = blueprintAssetContentPaths(Buffer.from(JSON.stringify({
            [BLUEPRINT_ID]: { id: BLUEPRINT_ID, name: "shared" },
            "not-a-storage-id": {},
        })));
        expect([...paths]).toEqual([BLUEPRINT_CONTENT]);
    });

    it("treats a broken shard as no shared blueprints, which is what the bundle would hold", () => {
        expect(blueprintAssetContentPaths(Buffer.from("{ truncated"))).toEqual(new Set());
        expect(blueprintAssetContentPaths(undefined)).toEqual(new Set());
    });
});

describe("materialising", () => {
    it("writes the documents and leaves the media in the repository", async () => {
        const files = new Map<string, Buffer>([
            ["editor/story/index.json", Buffer.from("{\"stories\":[]}")],
            ["assets/assets.metadata.blueprint.json", Buffer.from(JSON.stringify({ [BLUEPRINT_ID]: {} }))],
            [BLUEPRINT_CONTENT, Buffer.from("{\"blueprint\":true}")],
            ["assets/content/ff/ee/dddddddddddddddddddddddddddd", Buffer.alloc(4096, 7)],
        ]);

        const result = await materializeRevisionSnapshot({ projectPath: project, revision: REVISION, source: sourceOf(files) });

        expect(fs.readFileSync(path.join(result.directory, "editor", "story", "index.json"), "utf-8"))
            .toBe("{\"stories\":[]}");
        // The one exception to skipping `assets/content/`: `loadSharedBlueprints` reads these, and a
        // snapshot without them assembles a bundle whose shared blueprints are silently empty.
        expect(fs.existsSync(path.join(result.directory, ...BLUEPRINT_CONTENT.split("/")))).toBe(true);
        expect(fs.existsSync(path.join(result.directory, "assets", "content", "ff", "ee", "dddddddddddddddddddddddddddd")))
            .toBe(false);
        expect(result.files).toBe(3);
        expect(result.skippedFiles).toBe(1);
        expect(result.skippedBytes).toBe(4096);
    });

    it("replaces the previous snapshot rather than accumulating one per revision", async () => {
        const first = await materializeRevisionSnapshot({
            projectPath: project,
            revision: REVISION,
            source: sourceOf(new Map([["editor/a.json", Buffer.from("1")]])),
        });
        const other = `f${REVISION.slice(1)}`;
        const second = await materializeRevisionSnapshot({
            projectPath: project,
            revision: other,
            source: sourceOf(new Map([["editor/a.json", Buffer.from("2")]])),
        });

        expect(fs.existsSync(first.directory)).toBe(false);
        expect(fs.readFileSync(path.join(second.directory, "editor", "a.json"), "utf-8")).toBe("2");
        expect(fs.readdirSync(path.dirname(second.directory))).toEqual([path.basename(second.directory)]);
    });

    it("cannot be made to write outside the snapshot by a crafted tree", async () => {
        // A revision is untrusted input: the repository is a directory the author's other tools can
        // write, so an entry name is not a Studio-controlled string. `..` is the escape that matters and
        // `isVersioned` rejects it, which is why the traversal attempt below is simply absent from the
        // snapshot rather than an error - and the `outside` file is never created.
        const outside = path.join(path.dirname(project), "nl-snap-escape.json");
        fs.rmSync(outside, { force: true });
        const result = await materializeRevisionSnapshot({
            projectPath: project,
            revision: REVISION,
            source: sourceOf(new Map([
                ["editor/a.json", Buffer.from("kept")],
                ["../../../nl-snap-escape.json", Buffer.from("escaped")],
            ])),
        });

        expect(result.files).toBe(1);
        expect(fs.existsSync(outside)).toBe(false);

        // An absolute name is contained by `path.join` rather than rejected by the predicate, so the
        // guard inside the writer is what stops it - and a failure here refuses the launch, which is the
        // right direction: nothing runs rather than something wrong running.
        const absolute: RevisionSnapshotSource = {
            list: async () => [{ ...entry("editor/ok.json"), path: `${path.parse(project).root.replace(/\\/g, "/")}absolute.json` }],
            read: async () => Buffer.from("x"),
        };
        await expect(materializeRevisionSnapshot({ projectPath: project, revision: REVISION, source: absolute }))
            .rejects.toThrow();
    });

    it("reports what it cost, because the launch has to say so", async () => {
        const messages: string[] = [];
        const result = await materializeRevisionSnapshot({
            projectPath: project,
            revision: REVISION,
            source: sourceOf(new Map([["editor/a.json", Buffer.from("hello")]])),
            onProgress: (message) => messages.push(message),
        });

        expect(result.bytes).toBe(5);
        expect(result.durationMs).toBeGreaterThanOrEqual(0);
        expect(messages.some((m) => m.includes("materialising revision d59feba37af3"))).toBe(true);
        expect(messages.some((m) => /materialised revision d59feba37af3 in \d+ ms/.test(m))).toBe(true);
    });

    it("reports that a snapshot is gone, and says so again when there was none", async () => {
        // The boolean is the point. An earlier version returned void and swallowed the error, so a
        // removal that did nothing was indistinguishable from one that worked - and what is left behind
        // is a full copy of a revision's documents in the author's project.
        const result = await materializeRevisionSnapshot({
            projectPath: project,
            revision: REVISION,
            source: sourceOf(new Map([["editor/a.json", Buffer.from("1")]])),
        });
        await expect(removeRevisionSnapshots(project)).resolves.toBe(true);
        expect(fs.existsSync(result.directory)).toBe(false);
        await expect(removeRevisionSnapshots(project)).resolves.toBe(true);
    });

    it("refuses to materialise on top of a snapshot it could not clear", async () => {
        // Materialising into a directory that still holds another run's files would produce a MIXED tree
        // - some documents from the revision, some from before - which is the "wrong build that looks
        // right" the whole module exists to avoid. So this fails the launch instead.
        const source = sourceOf(new Map([["editor/a.json", Buffer.from("1")]]));
        await materializeRevisionSnapshot({ projectPath: project, revision: REVISION, source });

        const root = path.dirname(revisionSnapshotDirectory(project, REVISION));
        const rm = vi.spyOn(fsPromises, "rm").mockRejectedValue(new Error("EPERM"));
        try {
            await expect(materializeRevisionSnapshot({ projectPath: project, revision: REVISION, source }))
                .rejects.toThrow(/could not clear the previous dev mode snapshot/i);
        } finally {
            rm.mockRestore();
        }
        expect(fs.existsSync(root)).toBe(true);
    });
});
