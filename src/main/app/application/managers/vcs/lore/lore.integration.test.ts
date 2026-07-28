import fs from "fs";
import os from "os";
import path from "path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { isVcsPlatformSupported } from "@shared/types/vcs";
import { LorePathIgnoredError, invoke, type LoreGlobals } from "./call";
import { LoreTag } from "./events";
import { loadLoreLibrary, resolveLoreLibraryPath, unpackAsarPath } from "./library";
import { LoreValueError, repositoryPath, revisionBytes } from "./values";
import {
    closeStore,
    closeTree,
    commit,
    createBranch,
    createRepository,
    changedPaths,
    flushRepository,
    history,
    listBranches,
    loadTree,
    openStore,
    readAddress,
    releaseRepository,
    repositoryStatus,
    stage,
    treeNode,
    type StoreHandle,
} from "./verbs";

/**
 * Studio's Lore binding against the real native library.
 *
 * Deliberately not mocked. Every defect this layer exists to prevent lives at the
 * FFI boundary - identifier encoding, borrowed event memory, silently ignored
 * paths, lazily flushed commits - and a mock asserts our idea of the library rather
 * than the library. That exact substitution is how the previous wrapper ended up
 * with an encoding rule that was wrong in a way unit tests could never see.
 *
 * Consequences: it loads a ~29MB shared library, writes a real repository to a temp
 * directory, and only runs where Epic ships a build (no Intel Mac, no Windows ARM64
 * - see docs/version-control.md §7).
 *
 * What it cannot cover, and where that is covered instead:
 *   - the lazy-flush data loss: needs a SECOND PROCESS to observe. See §4.11.
 *   - the exclusive repository lock: same, needs a second process.
 */

const supported = isVcsPlatformSupported() || Boolean(process.env.LORE_LIB_PATH);

const TEXT = "editor/story/index.json";
const BINARY = "assets/sprite.bin";

// Non-text payloads on purpose: the whole reason for choosing Lore is binary assets.
const V1 = Buffer.from([...Array(256).keys()]);
const V2 = Buffer.concat([V1.subarray(0, 128), Buffer.from("NARRALEAF-V2"), V1.subarray(128)]);
/** Larger than one fragment, so the read path has to reassemble chunks in order. */
const LARGE = (() => {
    const bytes = Buffer.alloc(3 * 1024 * 1024);
    // A repeating-but-not-constant pattern: constant bytes would deduplicate down to
    // a single fragment and the reassembly this exists to test would never happen.
    for (let index = 0; index < bytes.length; index++) bytes[index] = (index * 31) % 251;
    return bytes;
})();

let root: string;
let globals: LoreGlobals;
let store: StoreHandle;
let repositoryId: string;
let rev1: string;
let rev2: string;

async function write(relative: string, bytes: Buffer | string): Promise<string> {
    const absolute = path.join(root, relative);
    fs.mkdirSync(path.dirname(absolute), { recursive: true });
    fs.writeFileSync(absolute, bytes);
    return absolute;
}

async function commitAll(message: string): Promise<string> {
    await stage(globals, [root]);
    const revision = await commit(globals, message);
    // Not optional: without it a later process can find this commit missing.
    await flushRepository(globals);
    return revision.revision;
}

beforeAll(async () => {
    if (!supported) return;

    root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "nl-lore-")));
    globals = { repositoryPath: root, offline: true, identity: "test@narraleaf", cache: true };

    const created = await createRepository(globals, {
        // Mandatory even offline; nothing ever dials it.
        repositoryUrl: "lore://127.0.0.1:41337/test",
        description: "binding test",
    });
    repositoryId = created.repository;

    await write(TEXT, JSON.stringify({ stories: [] }));
    await write(BINARY, V1);
    rev1 = await commitAll("v1");

    await write(BINARY, V2);
    await write("assets/large.bin", LARGE);
    rev2 = await commitAll("v2");

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

describe.skipIf(!supported)("lore binding: library", () => {
    it("resolves and loads the native library without any module-scope side effect", () => {
        const libraryPath = resolveLoreLibraryPath();
        expect(fs.existsSync(libraryPath)).toBe(true);

        const library = loadLoreLibrary();
        // Cached: a second call must not dlopen again.
        expect(loadLoreLibrary()).toBe(library);
        expect(library.has("revisionCommit")).toBe(true);
    });

    it("redirects an asar path to the unpacked copy", () => {
        // A native library cannot be dlopen'd from inside the archive; electron-builder
        // unpacks it and require.resolve still reports the archive path.
        expect(unpackAsarPath("/app/Resources/app.asar/node_modules/@lore-vcs/x/lib.dylib"))
            .toBe("/app/Resources/app.asar.unpacked/node_modules/@lore-vcs/x/lib.dylib");
        expect(unpackAsarPath("/plain/node_modules/@lore-vcs/x/lib.dylib"))
            .toBe("/plain/node_modules/@lore-vcs/x/lib.dylib");
    });
});

describe.skipIf(!supported)("lore binding: write path", () => {
    it("creates a repository, stages, commits and flushes offline", () => {
        expect(repositoryId).toMatch(/^[0-9a-f]{32}$/);
        expect(rev1).toMatch(/^[0-9a-f]{64}$/);
        expect(rev2).toMatch(/^[0-9a-f]{64}$/);
        expect(rev1).not.toBe(rev2);
        expect(fs.existsSync(path.join(root, ".lore"))).toBe(true);
    });

    it("reports a clean working tree after a commit", async () => {
        const status = await repositoryStatus(globals, { scan: true });
        expect(status.revision?.branchName).toBe("main");
        expect(status.revision?.revision).toBe(rev2);
        expect(status.revision?.revisionNumber).toBe(2);
        // Zero-filled "absent" fields must not be reported as revisions.
        expect(status.revision?.revisionStaged).toBeUndefined();
        expect(status.revision?.remoteAvailable).toBe(false);
        expect(status.files.filter((file) => file.dirty)).toHaveLength(0);
    }, 60_000);

    it("sees an edit as a pending change before it is staged", async () => {
        await write(TEXT, JSON.stringify({ stories: ["draft"] }));
        const status = await repositoryStatus(globals, { scan: true });

        // Lore's path directions are ASYMMETRIC, and nothing in its types says so:
        // `fileStage` requires ABSOLUTE paths (a relative one resolves against the
        // process CWD and is then silently ignored for being outside the repository),
        // but `repositoryStatus` REPORTS repository-relative paths. Anything that
        // feeds status output back into a stage call has to convert.
        expect(status.files.map((file) => file.path.replace(/\\/g, "/"))).toContain(TEXT);

        // Put it back so later assertions see the committed state.
        await write(TEXT, JSON.stringify({ stories: [] }));
    }, 60_000);

    it("raises on a path outside the repository instead of silently skipping it", async () => {
        const outside = path.join(os.tmpdir(), "nl-lore-outside.txt");
        fs.writeFileSync(outside, "not in the repository");
        try {
            // Lore answers this with rc=0, a PATH_IGNORE event, and nothing staged.
            // Left alone it surfaces much later as "Nothing staged for commit", by
            // which point the author believes the file is versioned.
            await expect(stage(globals, [outside])).rejects.toBeInstanceOf(LorePathIgnoredError);
        } finally {
            fs.rmSync(outside, { force: true });
        }
    }, 60_000);

    it("creates and lists branches", async () => {
        await createBranch(globals, "experiment");
        const branches = await listBranches(globals);
        const names = branches.map((branch) => branch.name);
        expect(names).toContain("main");
        expect(names).toContain("experiment");
        expect(branches.find((branch) => branch.name === "main")?.latest).toBe(rev2);
    }, 60_000);
});

describe.skipIf(!supported)("lore binding: read path", () => {
    it("reads historical blobs byte-exactly, with no working tree and no server", async () => {
        const tree1 = await loadTree(globals, store, repositoryId, rev1);
        try {
            const node = await treeNode(globals, tree1, BINARY);
            expect(node.size).toBe(V1.length);
            const bytes = await readAddress(globals, store, repositoryId, node);
            expect(bytes).toEqual(V1);
        } finally {
            await closeTree(globals, tree1);
        }

        const tree2 = await loadTree(globals, store, repositoryId, rev2);
        try {
            const node = await treeNode(globals, tree2, BINARY);
            const bytes = await readAddress(globals, store, repositoryId, node);
            expect(bytes).toEqual(V2);
        } finally {
            await closeTree(globals, tree2);
        }
    }, 120_000);

    it("reassembles a multi-fragment blob in offset order", async () => {
        const tree = await loadTree(globals, store, repositoryId, rev2);
        try {
            const node = await treeNode(globals, tree, "assets/large.bin");
            const bytes = await readAddress(globals, store, repositoryId, node);
            expect(bytes.length).toBe(LARGE.length);
            expect(bytes.equals(LARGE)).toBe(true);
        } finally {
            await closeTree(globals, tree);
        }
    }, 120_000);

    it("exposes the revision DAG with parents, and no zero-hash parent", async () => {
        const { header, nodes } = await history(globals);
        expect(header?.repository).toBe(repositoryId);
        expect(nodes.size).toBe(2);
        expect(nodes.get(rev2)?.parents).toEqual([rev1]);
        // A root revision has no parent; Lore stores that as an all-zero hash.
        expect(nodes.get(rev1)?.parents).toEqual([]);
        expect(nodes.get(rev2)?.number).toBe(2);
    }, 60_000);

    it("lists changed paths between two revisions", async () => {
        const changes = await changedPaths(globals, rev1, rev2);
        const paths = changes.map((change) => change.path.replace(/\\/g, "/"));
        expect(paths.some((candidate) => candidate.endsWith("sprite.bin"))).toBe(true);
        expect(paths.some((candidate) => candidate.endsWith("large.bin"))).toBe(true);
        expect(paths.some((candidate) => candidate.endsWith("index.json"))).toBe(false);
    }, 60_000);
});

describe.skipIf(!supported)("lore binding: identifier encoding", () => {
    /**
     * The defect this binding was written to eliminate.
     *
     * The generated SDK converts identifiers through a lookup table with a missing
     * handler; a hex string landing in a `LoreHash` field yields a ZERO-LENGTH byte
     * array, koffi pads the fixed-size field with zeroes, and the call SUCCEEDS
     * against an all-zero repository id. Here the field's declared type is the rule
     * and a malformed value is rejected before it reaches native code.
     */
    it("rejects a malformed identifier instead of zero-filling the field", () => {
        expect(() => revisionBytes("abcd")).toThrow(LoreValueError);
        expect(() => revisionBytes("z".repeat(64))).toThrow(LoreValueError);
        expect(() => revisionBytes("")).toThrow(LoreValueError);
        expect(revisionBytes("0".repeat(64)).data).toHaveLength(32);
    });

    it("refuses a revision hash of the wrong width at the call boundary", async () => {
        await expect(loadTree(globals, store, repositoryId, "deadbeef")).rejects.toBeInstanceOf(LoreValueError);
        await expect(loadTree(globals, store, "deadbeef", rev1)).rejects.toBeInstanceOf(LoreValueError);
    });

    it("refuses a path that escapes the repository", () => {
        expect(() => repositoryPath(root, "../outside.txt")).toThrow(/escapes the repository/);
        expect(() => repositoryPath(root, "editor/../../outside.txt")).toThrow(/escapes the repository/);
        expect(repositoryPath(root, "editor/story/index.json")).toBe(path.join(root, TEXT));
    });
});

describe.skipIf(!supported)("lore binding: call semantics", () => {
    it("delivers every event of a call to a single handler", async () => {
        // The SDK's `.callback()` REPLACES rather than appends, so a wrapper and a
        // call site attaching one each meant the first silently received nothing.
        const seen: number[] = [];
        await invoke("repositoryStatus", globals, {
            staged: 0, scan: 1, checkDirty: 0, reset: 0, syncPoint: 0, revisionOnly: 1, count: 0,
            paths: { ptr: [], count: 0 },
        }, { onEvent: (event) => seen.push(event.tag) });

        expect(seen).toContain(LoreTag.REPOSITORY_STATUS_REVISION);
        expect(seen).toContain(LoreTag.COMPLETE);
        expect(seen).toContain(LoreTag.END);
    }, 60_000);

    it("survives many calls without exhausting koffi's registered callbacks", async () => {
        // Each call registers a native callback; leaking one per call exhausts the
        // pool after a few thousand operations and fails nowhere near the cause.
        for (let index = 0; index < 250; index++) {
            await repositoryStatus(globals, { scan: false, revisionOnly: true });
        }
        const status = await repositoryStatus(globals, { scan: false, revisionOnly: true });
        expect(status.revision?.revision).toBe(rev2);
    }, 180_000);

    it("reports a failure with Lore's own message and trace locations", async () => {
        // A revision that is well-formed but does not exist.
        const missing = "1".repeat(64);
        await expect(loadTree(globals, store, repositoryId, missing)).rejects.toMatchObject({
            name: "LoreCallError",
        });
    }, 60_000);
});
