import fs from "fs";
import os from "os";
import path from "path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { isVcsPlatformSupported } from "@shared/types/vcs";
import {
    LorePathIgnoredError,
    LoreEventTag,
    invoke,
    repoPath,
    sdk,
    __hashCodecForTests,
    __resetHashCodecForTests,
    type LoreGlobals,
    type StoreHandle,
} from "./loreClient";
import {
    blobAt,
    blobsAt,
    changedPaths,
    closeStore,
    mergeBase,
    openStore,
    readRepositoryIdentity,
    readRevisionGraph,
    threeWay,
} from "./revisionReader";

/**
 * Integration test against the real Lore native library.
 *
 * Deliberately not mocked: every bug this layer exists to absorb lives in the
 * FFI boundary (identifier encoding, callback replacement semantics, borrowed
 * event memory, silently ignored paths). A mock would assert our idea of the
 * SDK rather than the SDK, which is precisely the failure mode that produced
 * the wrong encoding rule in the first place.
 *
 * Consequences: it loads a ~29MB shared library, writes a real repository to a
 * temp dir, and only runs on a platform Epic ships a build for (no Intel Mac,
 * no Windows ARM64 — see docs/version-control.md §7).
 */

const REL = "assets/sprite.bin";

// Distinct, non-text payloads: the whole point is binary assets.
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

async function commit(bytes: Buffer, message: string): Promise<string> {
    fs.writeFileSync(path.join(root, REL), bytes);
    await invoke((g, a) => sdk.fileStage(g, a), "fileStage", globals, {
        paths: [repoPath(root, REL)],
        scan: true,
    });
    const events = await invoke<{ revision: string; repository: string }>(
        (g, a) => sdk.revisionCommit(g, a),
        "revisionCommit",
        globals,
        { message },
        { capture: [LoreEventTag.REVISION_COMMIT_REVISION] },
    );
    repositoryId = events[0].data.repository;
    return events[0].data.revision;
}

beforeAll(async () => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), "nl-vcs-"));
    fs.mkdirSync(path.join(root, "assets"), { recursive: true });

    globals = { repositoryPath: root, offline: true, identity: "test@narraleaf", cache: true };

    // A repository URL is mandatory even for a fully offline create; nothing dials it.
    await invoke((g, a) => sdk.repositoryCreate(g, a), "repositoryCreate", globals, {
        id: "",
        description: "vcs test",
        repositoryUrl: "lore://127.0.0.1:41337/test",
    });

    rev1 = await commit(V1, "v1");
    rev2 = await commit(V2, "v2");
    rev3 = await commit(V3, "v3");

    __resetHashCodecForTests();
    store = await openStore(globals, root);
}, 120_000);

afterAll(async () => {
    if (store) await closeStore(globals, store).catch(() => undefined);
    if (root) fs.rmSync(root, { recursive: true, force: true });
});

describe("backend availability (happy path)", () => {
    // Lives here rather than in backend.test.ts because a failed SDK load is
    // permanent for the process — see the note at the end of that file.
    it("loads and caches the backend on a supported host", async () => {
        expect(isVcsPlatformSupported()).toBe(true);

        const backendModule = await import("./backend");
        const first = await backendModule.loadVcsBackend();
        expect(first).not.toBeNull();
        expect(typeof first?.blobAt).toBe("function");
        expect(typeof first?.client.repoPath).toBe("function");

        // Cached: the same object, not a second dlopen.
        expect(await backendModule.loadVcsBackend()).toBe(first);
        await expect(backendModule.getVcsAvailability()).resolves.toEqual({ available: true });
    }, 60_000);
});

describe("revisionReader", () => {
    it("reads historical blobs byte-exactly with no working tree and no server", async () => {
        await expect(blobAt(globals, store, repositoryId, rev1, REL)).resolves.toEqual(V1);
        await expect(blobAt(globals, store, repositoryId, rev2, REL)).resolves.toEqual(V2);
        await expect(blobAt(globals, store, repositoryId, rev3, REL)).resolves.toEqual(V3);
    }, 60_000);

    it("reuses one tree handle across paths in a revision", async () => {
        const blobs = await blobsAt(globals, store, repositoryId, rev2, [REL]);
        expect(blobs.get(REL)).toEqual(V2);
    }, 60_000);

    it("exposes the revision DAG with parents", async () => {
        const graph = await readRevisionGraph(globals);
        expect(graph.size).toBe(3);
        expect(graph.get(rev3)?.parents).toEqual([rev2]);
        expect(graph.get(rev2)?.parents).toEqual([rev1]);
        // A root revision reports no parents; the all-zero hash is filtered out.
        expect(graph.get(rev1)?.parents).toEqual([]);
    }, 60_000);

    it("computes a merge base, which Lore itself does not expose", async () => {
        const graph = await readRevisionGraph(globals);
        expect(mergeBase(graph, rev3, rev2)).toBe(rev2);
        expect(mergeBase(graph, rev3, rev1)).toBe(rev1);
        // Order must not matter.
        expect(mergeBase(graph, rev1, rev3)).toBe(rev1);
    }, 60_000);

    it("returns base/mine/theirs for a three-way merge", async () => {
        const result = await threeWay(globals, store, repositoryId, rev3, rev2, REL);
        expect(result.baseRevision).toBe(rev2);
        expect(result.base).toEqual(V2);
        expect(result.mine).toEqual(V3);
        expect(result.theirs).toEqual(V2);
    }, 60_000);

    it("reports which paths changed between revisions", async () => {
        const changed = await changedPaths(globals, rev1, rev2);
        expect(changed.some((p) => p.replace(/\\/g, "/").includes("sprite.bin"))).toBe(true);
    }, 60_000);

    it("reads the repository identity without touching the network", async () => {
        const identity = await readRepositoryIdentity(globals);
        expect(identity?.repository).toBe(repositoryId);
    }, 60_000);
});

describe("loreClient", () => {
    it("raises instead of silently skipping an unusable path", async () => {
        // Lore answers a path outside the repository with PATH_IGNORE and rc=0;
        // untranslated, a user's asset would just never get committed.
        const outside = path.join(os.tmpdir(), "nl-vcs-not-in-repo.bin");
        await expect(
            invoke((g, a) => sdk.fileStage(g, a), "fileStage", globals, { paths: [outside], scan: true }),
        ).rejects.toBeInstanceOf(LorePathIgnoredError);
    }, 60_000);

    it("rejects paths that escape the repository root", () => {
        expect(() => repoPath(root, "../../etc/passwd")).toThrow();
        expect(path.isAbsolute(repoPath(root, REL))).toBe(true);
    });

    /**
     * UPGRADE TRIPWIRE.
     *
     * The SDK's generator declares `loreHash` args but ships no converter for
     * them, so a hex hash is rejected and this layer falls back to the binary
     * form. When upstream implements the handler, hex will start working and
     * this assertion will flip to "hex" — that is a signal, not a regression.
     * Change it to "hex" and re-check that nothing depends on the old path.
     */
    it("latches the hash codec by observation, not by hardcoding", async () => {
        __resetHashCodecForTests();
        expect(__hashCodecForTests()).toBe("hex");

        await blobAt(globals, store, repositoryId, rev1, REL);

        expect(__hashCodecForTests()).toBe("binary");
    }, 60_000);
});
