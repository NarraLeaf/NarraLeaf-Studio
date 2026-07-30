import fs from "fs";
import os from "os";
import path from "path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { isVcsPlatformSupported } from "@shared/types/vcs";
import {
    commit,
    createRepository,
    flushRepository,
    releaseRepository,
    stage,
    type LoreGlobals,
    type StoreHandle,
} from "./lore";
import {
    blobAt,
    blobsAt,
    changedPaths,
    closeStore,
    documentsAt,
    listFilesAt,
    openStore,
    readRepositoryIdentity,
    readRevisionGraph,
    threeWay,
} from "./revisionReader";

/**
 * The reader layer against a real repository.
 *
 * Complements `revisionReader.test.ts`, which covers merge-base resolution as pure
 * logic. What has to be real here is everything that crosses the FFI boundary:
 * blob reads must be byte-exact, and `threeWay` has to distinguish "absent from the
 * base revision" from "empty in the base revision" - a difference that only exists
 * once a real tree lookup fails.
 */

const supported = isVcsPlatformSupported() || Boolean(process.env.LORE_LIB_PATH);

const REL = "assets/sprite.bin";
const ONLY_IN_HEAD = "assets/added-later.bin";

const V1 = Buffer.from([...Array(256).keys()]);
const V2 = Buffer.concat([V1.subarray(0, 128), Buffer.from("NARRALEAF-V2"), V1.subarray(128)]);
const V3 = Buffer.concat([Buffer.from("HDR-V3"), V2]);

let root: string;
let globals: LoreGlobals;
let store: StoreHandle;
let repositoryId: string;
let rev1: string;
let rev2: string;
let rev3: string;

async function commitBytes(relative: string, bytes: Buffer, message: string): Promise<string> {
    const absolute = path.join(root, relative);
    fs.mkdirSync(path.dirname(absolute), { recursive: true });
    fs.writeFileSync(absolute, bytes);
    await stage(globals, [root]);
    const revision = await commit(globals, message);
    await flushRepository(globals);
    return revision.revision;
}

beforeAll(async () => {
    if (!supported) return;

    root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "nl-reader-")));
    globals = { repositoryPath: root, offline: true, identity: "test@narraleaf", cache: true };

    const created = await createRepository(globals, {
        repositoryUrl: "lore://127.0.0.1:41337/test",
        description: "reader test",
    });
    repositoryId = created.repository;

    rev1 = await commitBytes(REL, V1, "v1");
    rev2 = await commitBytes(REL, V2, "v2");
    rev3 = await commitBytes(REL, V3, "v3");

    store = await openStore(globals, root);
}, 180_000);

afterAll(async () => {
    if (store) await closeStore(globals, store).catch(() => undefined);
    // Closing the store is NOT enough to let go of the directory. Lore keeps the
    // repository itself open (storeKeepAlive holds it for seconds after the last
    // call), so on Windows the rmSync below fails with EPERM - and in production the
    // same handles keep the author's `lore` CLI blocking on the repository lock.
    // `repositoryRelease` is the only thing that actually lets go.
    if (root) await releaseRepository(globals).catch(() => undefined);
    if (root) fs.rmSync(root, { recursive: true, force: true });
});

describe.skipIf(!supported)("backend availability (happy path)", () => {
    it("loads and caches the backend on a supported host", async () => {
        expect(isVcsPlatformSupported() || Boolean(process.env.LORE_LIB_PATH)).toBe(true);

        const backend = await import("./backend");
        const first = await backend.loadVcsBackend();
        expect(first).not.toBeNull();
        expect(typeof first?.blobAt).toBe("function");
        expect(typeof first?.repositoryPath).toBe("function");

        // Cached: the same module object, not a second dlopen.
        expect(await backend.loadVcsBackend()).toBe(first);
        await expect(backend.getVcsAvailability()).resolves.toEqual({ available: true });
    }, 60_000);
});

describe.skipIf(!supported)("revisionReader", () => {
    it("reads historical blobs byte-exactly with no working tree and no server", async () => {
        await expect(blobAt(globals, store, repositoryId, rev1, REL)).resolves.toEqual(V1);
        await expect(blobAt(globals, store, repositoryId, rev2, REL)).resolves.toEqual(V2);
        await expect(blobAt(globals, store, repositoryId, rev3, REL)).resolves.toEqual(V3);
    }, 120_000);

    it("reuses one tree handle across paths in a revision", async () => {
        const blobs = await blobsAt(globals, store, repositoryId, rev2, [REL]);
        expect(blobs.get(REL)).toEqual(V2);
    }, 60_000);

    it("reports the repository identity without dialling the remote", async () => {
        // Read off the history header rather than `repositoryInfo`, which contacts
        // the remote even under offline:true and blocks until the socket times out.
        const identity = await readRepositoryIdentity(globals);
        expect(identity?.repository).toBe(repositoryId);
        expect(identity?.branch).toMatch(/^[0-9a-f]{32}$/);
    }, 60_000);

    it("exposes the revision DAG with parents", async () => {
        const graph = await readRevisionGraph(globals);
        expect(graph.size).toBe(3);
        expect(graph.get(rev3)?.parents).toEqual([rev2]);
        expect(graph.get(rev2)?.parents).toEqual([rev1]);
        // A root revision reports no parents; Lore's all-zero placeholder is filtered.
        expect(graph.get(rev1)?.parents).toEqual([]);
    }, 60_000);

    it("lists changed paths between two revisions", async () => {
        const paths = await changedPaths(globals, rev1, rev3);
        expect(paths.some((candidate) => candidate.replace(/\\/g, "/").endsWith("sprite.bin"))).toBe(true);
    }, 60_000);

    it("returns base/mine/theirs for a three-way merge", async () => {
        const result = await threeWay(globals, store, repositoryId, rev3, rev2, REL);
        expect(result.baseRevision).toBe(rev2);
        expect(result.mine).toEqual(V3);
        expect(result.theirs).toEqual(V2);
        expect(result.base).toEqual(V2);
    }, 120_000);

    /**
     * The capability the whole "show a past revision in the real editors" milestone rests on.
     *
     * `lore_revision_tree_list_children` is not one of the three verbs the SDK declares and the library
     * does not export - it IS in the DLL's export table - but a symbol being present is not the same as
     * the walk working, so this asserts the walk against a real tree. Without it the alternative was
     * guessing a revision's paths from the document registry, which only knows the four kinds migrated
     * to specs.
     */
    it("enumerates every file at a revision by walking its tree", async () => {
        const atFirst = await listFilesAt(globals, store, repositoryId, rev1);
        const atHead = await listFilesAt(globals, store, repositoryId, rev3);

        // Nested, so the walk has to have descended rather than just listed the root.
        expect(atFirst.map(entry => entry.path)).toContain(REL);
        const sprite = atFirst.find(entry => entry.path === REL);
        expect(sprite?.size).toBe(V1.length);
        // Enumeration is per revision, not per repository: the size changed between them.
        expect(atHead.find(entry => entry.path === REL)?.size).toBe(V3.length);
        // Directories are descended into, never reported as files of their own.
        expect(atFirst.map(entry => entry.path)).not.toContain("assets");
    }, 120_000);

    /**
     * The acceptance oracle's core, at this layer: the working tree has moved on, and the revision
     * still reads back byte-for-byte what was committed.
     */
    it("reads a revision byte-exactly after the working tree has moved on", async () => {
        const absolute = path.join(root, REL);
        fs.writeFileSync(absolute, Buffer.from("WORKING TREE, UNCOMMITTED"));

        const read = await documentsAt(globals, store, repositoryId, rev1, { paths: [REL] });

        expect(read.get(REL)).toEqual(V1);
        // And the working tree was not touched to answer it.
        expect(fs.readFileSync(absolute)).toEqual(Buffer.from("WORKING TREE, UNCOMMITTED"));

        // Put it back, so the tests after this one see the tree they were set up with.
        fs.writeFileSync(absolute, V3);
    }, 120_000);

    /**
     * A document added after the revision is `null`, not a throw. The editor has to land in its
     * "missing, use defaults" state - the same one as at project open - and the per-path reader cannot
     * give that: `revisionTreeResolvePath` reports a missing path by failing the call, which is
     * indistinguishable from a backend fault.
     */
    it("answers null for a path the revision does not contain, while the per-path read throws", async () => {
        const later = await commitBytes("assets/added-in-a-later-revision.bin", Buffer.from("later"), "add");

        const early = await documentsAt(globals, store, repositoryId, rev1, {
            paths: [REL, "assets/added-in-a-later-revision.bin"],
        });
        expect(early.get(REL)).toEqual(V1);
        expect(early.get("assets/added-in-a-later-revision.bin")).toBeNull();

        // Present once the revision that added it is the one being read.
        const atHead = await documentsAt(globals, store, repositoryId, later, {
            paths: ["assets/added-in-a-later-revision.bin"],
        });
        expect(atHead.get("assets/added-in-a-later-revision.bin")).toEqual(Buffer.from("later"));

        // The distinction this exists for: the same missing path through the per-path reader fails.
        await expect(blobAt(globals, store, repositoryId, rev1, "assets/added-in-a-later-revision.bin"))
            .rejects.toThrow();
    }, 180_000);

    it("selects by size and name when the caller has no path list of its own", async () => {
        const big = await commitBytes("assets/too-big.bin", Buffer.alloc(4096, 7), "big");

        const read = await documentsAt(globals, store, repositoryId, big, {
            accept: entry => entry.size < 1024 && entry.path.endsWith(".bin"),
        });

        expect([...read.keys()]).not.toContain("assets/too-big.bin");
        expect(read.get("assets/added-in-a-later-revision.bin")).toEqual(Buffer.from("later"));
    }, 180_000);

    it("reports an absent base rather than an empty one for a file added on one side", async () => {
        // add/add: the file does not exist in the common ancestor. Treating the
        // missing base as an empty file silently accepts one side of the merge, so
        // the distinction has to survive all the way out of this layer.
        const head = await commitBytes(ONLY_IN_HEAD, Buffer.from("new on head"), "add");
        const result = await threeWay(globals, store, repositoryId, head, head, ONLY_IN_HEAD);
        expect(result.mine).toEqual(Buffer.from("new on head"));

        const older = await threeWay(globals, store, repositoryId, head, rev1, ONLY_IN_HEAD)
            .catch(() => null);
        // Either the read of the older side fails outright or the base is absent -
        // what must never happen is a zero-length Buffer standing in for "absent".
        expect(older?.base).toBeUndefined();
    }, 120_000);
});
