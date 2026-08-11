import fs from "fs";
import os from "os";
import path from "path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { isVcsPlatformSupported } from "@shared/types/vcs";
import {
    commit,
    createBranch,
    createRepository,
    flushRepository,
    releaseRepository,
    stage,
    switchBranch,
    type LoreGlobals,
    type StoreHandle,
} from "./lore";
import {
    blobAt,
    blobsAt,
    changedPaths,
    closeStore,
    documentsAt,
    graphCoversAncestry,
    listFilesAt,
    mergeBase,
    openStore,
    readMergeGraph,
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

    it("reports a base status of found for a base that is really there", async () => {
        const result = await threeWay(globals, store, repositoryId, rev3, rev2, REL);
        expect(result.baseStatus).toBe("found");
    }, 120_000);

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
        // And when it IS absent it says which kind of absent: the ancestor exists, the file
        // is not in it. An "indeterminate" here would mean the graph read fell short.
        if (older) expect(older.baseStatus).toBe("absent-in-base");
    }, 120_000);
});

/**
 * What a content address actually means, measured rather than assumed.
 *
 * The rename pairing in `diff/contentDiff.ts` claims that two files hold the same bytes when
 * their `size` and `hash` agree, and it claims it **without reading either of them** - which is
 * the only reason tidying an assets folder does not cost a few hundred megabytes of reads. An
 * address also carries a `context`, and nothing in the SDK's types or the library's headers says
 * what its scope is.
 *
 * **The two halves of an address are not the same kind of thing, and this is where that was
 * found out.** Measured here on a real repository:
 *
 *  - `hash` is of the CONTENT. Two files with identical bytes at unrelated paths report the
 *    same one, and two files with different bytes - including two of exactly equal length -
 *    do not. That is what makes the pairing possible at all.
 *  - `context` is NOT. The same two identical files came back with different contexts, sharing
 *    only a leading prefix (`019ff260ab5f7682bf3f06…2fe7c8f4c0` against
 *    `…12503f5908`), which is the shape of a per-entry generated id rather than of a digest.
 *
 * So `context` must be carried along to `readAddress` and must never be part of deciding that
 * two files are the same: comparing it would make the pairing fire exactly never, silently, and
 * an author reorganising their assets would keep getting the wall of delete-plus-add rows the
 * whole feature exists to remove. It is not compared in `probesMatch`, and this is why.
 *
 * Each experiment builds its **own repository**, and that is not tidiness: Lore's repository lock
 * is exclusive and blocking within a single process (docs/version-control.md §4.28), so calling
 * `openStore` on a repository this process already holds does not fail - it waits forever.
 */
describe.skipIf(!supported)("what a content address means", () => {
    /** One throwaway repository, one commit, one tree walk, released before returning. */
    async function walkFreshRepository(
        label: string,
        files: Record<string, Buffer>,
    ): Promise<Map<string, { size: number; hash: string; context: string }>> {
        const here = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), `nl-address-${label}-`)));
        const localGlobals: LoreGlobals = {
            repositoryPath: here,
            offline: true,
            identity: "test@narraleaf",
            cache: true,
        };
        const created = await createRepository(localGlobals, {
            repositoryUrl: "lore://127.0.0.1:41337/test",
            description: `address test ${label}`,
        });

        for (const [relative, bytes] of Object.entries(files)) {
            const absolute = path.join(here, relative);
            fs.mkdirSync(path.dirname(absolute), { recursive: true });
            fs.writeFileSync(absolute, bytes);
        }
        await stage(localGlobals, [here]);
        const revision = await commit(localGlobals, label);
        await flushRepository(localGlobals);

        const localStore = await openStore(localGlobals, here);
        try {
            const entries = await listFilesAt(localGlobals, localStore, created.repository, revision.revision);
            return new Map(entries.map(entry => [entry.path, {
                size: entry.size,
                hash: entry.hash,
                context: entry.context,
            }]));
        } finally {
            // flush -> closeStore -> release, in that order (§4.19). Anything less leaves the
            // directory locked and the next experiment in this file waiting on it.
            await flushRepository(localGlobals).catch(() => undefined);
            await closeStore(localGlobals, localStore).catch(() => undefined);
            await releaseRepository(localGlobals).catch(() => undefined);
            fs.rmSync(here, { recursive: true, force: true });
        }
    }

    const SAME = Buffer.from("the very same bytes, under two names\n");

    it("gives two files with identical contents the same address under different names", async () => {
        const walked = await walkFreshRepository("same", {
            "assets/one.bin": SAME,
            "elsewhere/deeper/two.bin": SAME,
        });

        const one = walked.get("assets/one.bin");
        const two = walked.get("elsewhere/deeper/two.bin");
        expect(one, "the walk did not find the first file").toBeDefined();
        expect(two, "the walk did not find the second file").toBeDefined();

        expect(one!.size).toBe(SAME.length);
        expect(two!.size).toBe(SAME.length);
        // The finding the pairing rests on: `hash` is of the CONTENT, not of the path.
        expect(two!.hash).toBe(one!.hash);
        // And the finding that keeps `context` out of the predicate. Asserted rather than left
        // unmentioned, so that a future library version making contexts converge shows up here
        // as a failing test to think about rather than as silently dead code somewhere else.
        expect(two!.context).not.toBe(one!.context);
    }, 180_000);

    it("gives two files with different contents different addresses", async () => {
        // The other half, and the one that would make the pairing dangerous rather than useless
        // if it failed: a hash that collided across contents would report a rename that never
        // happened, and the file the author actually deleted would vanish from the change list.
        const walked = await walkFreshRepository("differ", {
            "assets/one.bin": Buffer.from("first\n"),
            "assets/two.bin": Buffer.from("second, and a different length\n"),
        });

        const one = walked.get("assets/one.bin");
        const two = walked.get("assets/two.bin");
        expect(one).toBeDefined();
        expect(two).toBeDefined();
        expect(two!.hash).not.toBe(one!.hash);
    }, 180_000);

    it("gives two same-sized files with different contents different addresses", async () => {
        // Size alone is not evidence, which is why `probesMatch` requires both fields. These two
        // are byte-for-byte the same length and hold different things.
        const walked = await walkFreshRepository("samesize", {
            "assets/one.bin": Buffer.from("AAAAAAAAAAAAAAAA"),
            "assets/two.bin": Buffer.from("BBBBBBBBBBBBBBBB"),
        });

        const one = walked.get("assets/one.bin");
        const two = walked.get("assets/two.bin");
        expect(one!.size).toBe(two!.size);
        expect(two!.hash).not.toBe(one!.hash);
    }, 180_000);
});

/**
 * The §4.30 regression, on a real two-branch repository.
 *
 * Measured during the spikes and recorded in docs/version-control.md §4.30: `readRevisionGraph` reads
 * `history` with no branch, so it only ever held the CURRENT branch. On a main/feature merge the
 * incoming tip was therefore not in the graph at all, `mergeBase` answered nothing, and `threeWay`
 * reported `base: undefined` - which its own contract defines as add/add. Every ordinary
 * cross-branch conflict would have been classified add/add, and tier-two resolution would have
 * refused or mis-merged all of them.
 *
 * A separate repository from the suite above because it needs a branch topology, and Lore's
 * repository lock is exclusive within one process (§4.28) - so this one is opened, read and
 * released inside each test rather than held across the file.
 */
describe.skipIf(!supported)("threeWay across branches", () => {
    const BRANCHED = "doc.json";
    const BASE_BYTES = Buffer.from("base\n");
    const MINE_BYTES = Buffer.from("mine\n");
    const THEIRS_BYTES = Buffer.from("theirs\n");
    const ADDED_BY_MINE = Buffer.from("added on main\n");
    const ADDED_BY_THEIRS = Buffer.from("added on feature\n");
    const ONLY_ON_BOTH = "added-on-both.txt";

    let branchRoot: string;
    let branchGlobals: LoreGlobals;
    let branchRepository: string;
    let baseRevision: string;
    let mineRevision: string;
    let theirsRevision: string;

    beforeAll(async () => {
        if (!supported) return;

        branchRoot = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "nl-reader-branch-")));
        branchGlobals = { repositoryPath: branchRoot, offline: true, identity: "test@narraleaf", cache: true };
        const created = await createRepository(branchGlobals, {
            repositoryUrl: "lore://127.0.0.1:41337/test",
            description: "reader branch test",
        });
        branchRepository = created.repository;

        const commitHere = async (files: Record<string, Buffer>, message: string): Promise<string> => {
            for (const [relative, bytes] of Object.entries(files)) {
                const absolute = path.join(branchRoot, relative);
                fs.mkdirSync(path.dirname(absolute), { recursive: true });
                fs.writeFileSync(absolute, bytes);
            }
            await stage(branchGlobals, [branchRoot]);
            const revision = await commit(branchGlobals, message);
            await flushRepository(branchGlobals);
            return revision.revision;
        };

        baseRevision = await commitHere({ [BRANCHED]: BASE_BYTES }, "base");

        await createBranch(branchGlobals, "feature");
        await switchBranch(branchGlobals, { branch: "feature" });
        theirsRevision = await commitHere(
            { [BRANCHED]: THEIRS_BYTES, [ONLY_ON_BOTH]: ADDED_BY_THEIRS },
            "theirs",
        );

        await switchBranch(branchGlobals, { branch: "main" });
        mineRevision = await commitHere(
            { [BRANCHED]: MINE_BYTES, [ONLY_ON_BOTH]: ADDED_BY_MINE },
            "mine",
        );
    }, 300_000);

    afterAll(async () => {
        if (!branchRoot) return;
        await releaseRepository(branchGlobals).catch(() => undefined);
        fs.rmSync(branchRoot, { recursive: true, force: true });
    });

    it("reads a graph covering both sides, where the current branch's does not", async () => {
        // The measurement, reproduced: the current branch's graph does not contain the other
        // side's tip, so nothing computed from it can find their common ancestor.
        const currentBranchOnly = await readRevisionGraph(branchGlobals);
        expect(currentBranchOnly.has(theirsRevision)).toBe(false);
        expect(graphCoversAncestry(currentBranchOnly, theirsRevision)).toBe(false);
        expect(mergeBase(currentBranchOnly, mineRevision, theirsRevision)).toBeUndefined();

        const merged = await readMergeGraph(branchGlobals, [mineRevision, theirsRevision]);
        expect(graphCoversAncestry(merged, mineRevision)).toBe(true);
        expect(graphCoversAncestry(merged, theirsRevision)).toBe(true);
        expect(mergeBase(merged, mineRevision, theirsRevision)).toBe(baseRevision);
    }, 300_000);

    it("finds the base of a cross-branch merge", async () => {
        // FAILS BEFORE THE FIX: `baseRevision` came back undefined and `base` with it, so the
        // commonest merge in the system was reported as an add/add.
        const store = await openStore(branchGlobals, branchRoot);
        try {
            const sides = await threeWay(
                branchGlobals, store, branchRepository, mineRevision, theirsRevision, BRANCHED,
            );
            expect(sides.baseRevision).toBe(baseRevision);
            expect(sides.baseStatus).toBe("found");
            expect(sides.base).toEqual(BASE_BYTES);
            expect(sides.mine).toEqual(MINE_BYTES);
            expect(sides.theirs).toEqual(THEIRS_BYTES);
        } finally {
            await flushRepository(branchGlobals).catch(() => undefined);
            await closeStore(branchGlobals, store).catch(() => undefined);
            await releaseRepository(branchGlobals).catch(() => undefined);
        }
    }, 300_000);

    it("still answers an absent base for a file both branches added independently", async () => {
        // The other half of the fix, and the one a wider graph could have destroyed: a genuine
        // add/add has to keep answering `undefined`. The two sides share an ancestor - so the
        // graph is complete and `baseRevision` is set - and the file simply is not in it.
        const store = await openStore(branchGlobals, branchRoot);
        try {
            const sides = await threeWay(
                branchGlobals, store, branchRepository, mineRevision, theirsRevision, ONLY_ON_BOTH,
            );
            expect(sides.baseRevision).toBe(baseRevision);
            expect(sides.base).toBeUndefined();
            expect(sides.baseStatus).toBe("absent-in-base");
            expect(sides.mine).toEqual(ADDED_BY_MINE);
            expect(sides.theirs).toEqual(ADDED_BY_THEIRS);
        } finally {
            await flushRepository(branchGlobals).catch(() => undefined);
            await closeStore(branchGlobals, store).catch(() => undefined);
            await releaseRepository(branchGlobals).catch(() => undefined);
        }
    }, 300_000);
});
