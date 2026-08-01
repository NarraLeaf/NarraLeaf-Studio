import fs from "fs";
import os from "os";
import path from "path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
    VCS_UNCONFIGURED_REMOTE,
    VCS_UNCONFIGURED_REMOTE_URL,
    isVcsPlatformSupported,
    isVcsRemoteConfigured,
} from "@shared/types/vcs";
import type { LoreGlobals } from "./lore";
import {
    commit,
    createRepository,
    flushRepository,
    releaseRepository,
    stage,
} from "./lore";
import {
    cloneInto,
    parseRemoteUrl,
    publishToRemote,
    pushToRemote,
    readRemote,
    readSyncState,
    syncFromRemote,
    writeRemote,
} from "./remote";

/**
 * The remote seam against a REAL loreserver.
 *
 * Skipped unless `LORE_TEST_REMOTE` names a running server, because there is no way to
 * fake this honestly: every behaviour worth asserting here is a property of the server
 * protocol, and a mock would assert Studio's idea of it. That is the same argument
 * `lore.integration.test.ts` makes about the native library, and it has the same history
 * behind it - the previous binding's encoding rule was wrong in a way unit tests could
 * not see.
 *
 * ```bash
 * # loreserver 0.8.5 - the version Studio pins. A newer server may not speak this protocol.
 * loreserver.exe
 * LORE_TEST_REMOTE="lore://127.0.0.1:41337" yarn vitest run src/main/app/application/managers/vcs/
 * ```
 *
 * Every expectation below was measured before it was written; the record is
 * docs/plans/2026-07-31-003-plan-vcs-remote-server.md §1.
 */

const SERVER = (process.env.LORE_TEST_REMOTE ?? "").trim();
const enabled = SERVER !== "" && (isVcsPlatformSupported() || Boolean(process.env.LORE_LIB_PATH));

/** A host nothing listens on, for the unreachable-server expectations. */
const DEAD_SERVER = "lore://127.0.0.1:41999";

/**
 * How long an online call may take against a server that does not answer.
 *
 * Measured at 2.03 s for both status and push. The ceiling is generous because the point
 * of the assertion is that it RETURNS rather than hanging - if this ever fails, the panel
 * that calls it has a spinner that never stops.
 */
const UNREACHABLE_CEILING_MS = 15_000;

const roots: string[] = [];

function tmp(prefix: string): string {
    const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), prefix)));
    roots.push(root);
    return root;
}

function offline(root: string): LoreGlobals {
    return { repositoryPath: root, offline: true, identity: "test@narraleaf", cache: true };
}

function online(root: string): LoreGlobals {
    return { ...offline(root), offline: false };
}

async function commitAll(globals: LoreGlobals, root: string, message: string): Promise<void> {
    await stage(globals, [root]);
    await commit(globals, message);
    await flushRepository(globals);
}

/** A project as Studio makes one: created OFFLINE, against the unconfigured placeholder. */
async function studioProject(
    prefix: string,
    file: string,
    contents: string,
): Promise<{ root: string; repositoryId: string }> {
    const root = tmp(prefix);
    const globals = offline(root);
    const created = await createRepository(globals, {
        repositoryUrl: VCS_UNCONFIGURED_REMOTE_URL,
        description: "test",
    });
    fs.writeFileSync(path.join(root, file), contents);
    await commitAll(globals, root, "first");
    await releaseRepository(globals);
    return { root, repositoryId: created.repository };
}

/**
 * Connect a project to a server, exactly as `VcsManager.setRemote` does it.
 *
 * Both halves, because only doing the first is the defect this whole helper exists to keep
 * out of the other tests: the address alone leaves a project that pushes and cannot be cloned.
 */
async function connect(root: string, url: string, repositoryId: string): Promise<void> {
    await writeRemote(root, url);
    await publishToRemote(online(root), { url, repositoryId });
}

/** Unique per run: the server keeps repositories by name, so a fixed one collides on re-run. */
function serverUrl(name: string): string {
    return `${SERVER}/${name}-${Date.now().toString(36)}`;
}

afterAll(async () => {
    for (const root of roots) {
        await Promise.resolve();
        try {
            fs.rmSync(root, { recursive: true, force: true });
        } catch {
            // The repository may still be held; a leftover temp directory is not a test failure.
        }
    }
});

describe.skipIf(!enabled)("remote", () => {
    /**
     * The headline claim of the whole card: a project created offline, with no server, can
     * be connected to one later without being re-created or re-cloned.
     *
     * If this breaks, connecting a server has to become a clone-and-replace flow, and the
     * sidebar's one-field setup is no longer honest.
     */
    it("connects an existing offline project to a server, and pushes it", async () => {
        const { root, repositoryId } = await studioProject("nl-remote-connect-", "hello.txt", "one");
        const url = serverUrl("connect");

        expect(await readRemote(offline(root))).toBeNull();

        await connect(root, url, repositoryId);
        expect(await readRemote(offline(root))).toContain("127.0.0.1");

        const pushed = await pushToRemote(online(root));
        expect(pushed.alreadyPushed).toBe(false);

        // Pressing push again is an ordinary thing to do, and it must read as success.
        const again = await pushToRemote(online(root));
        expect(again.alreadyPushed).toBe(true);

        await releaseRepository(online(root));
    }, 120_000);

    /**
     * The five sync fields are only meaningful online.
     *
     * Offline they are all false, which is indistinguishable from "no server" - which is
     * exactly why `VcsManager.getSyncState` is the one read that opens a socket.
     */
    it("reports sync state only when online", async () => {
        const { root, repositoryId } = await studioProject("nl-remote-state-", "hello.txt", "one");
        await connect(root, serverUrl("state"), repositoryId);
        await pushToRemote(online(root));

        const live = await readSyncState(online(root));
        expect(live.remoteAvailable).toBe(true);
        expect(live.remoteBranchExists).toBe(true);
        expect(live.localAhead).toBe(false);

        const blind = await readSyncState(offline(root));
        expect(blind.remoteAvailable).toBe(false);
        expect(blind.remoteBranchExists).toBe(false);

        await releaseRepository(online(root));
    }, 120_000);

    /**
     * Clone, then the round trip: the clone commits, pushes, and the original syncs it down.
     *
     * This is the whole collaboration loop in one test, because the halves are not
     * independently meaningful - a push nobody can receive proves nothing.
     */
    it("clones a project and carries changes back and forth", async () => {
        const { root: authorRoot, repositoryId } = await studioProject("nl-remote-author-", "hello.txt", "one");
        const url = serverUrl("roundtrip");
        await connect(authorRoot, url, repositoryId);
        await pushToRemote(online(authorRoot));
        await releaseRepository(online(authorRoot));

        const cloneRoot = path.join(tmp("nl-remote-clonebase-"), "project");
        const cloned = await cloneInto(online(cloneRoot), { repositoryUrl: url });
        expect(cloned.branch).toBe("main");
        expect(fs.readFileSync(path.join(cloneRoot, "hello.txt"), "utf-8")).toBe("one");

        fs.writeFileSync(path.join(cloneRoot, "from-clone.txt"), "two");
        await commitAll(online(cloneRoot), cloneRoot, "from the clone");
        await pushToRemote(online(cloneRoot));
        await releaseRepository(online(cloneRoot));

        const behind = await readSyncState(online(authorRoot));
        expect(behind.remoteAhead).toBe(true);

        const synced = await syncFromRemote(online(authorRoot));
        expect(synced.conflicts).toEqual([]);
        expect(synced.alreadyCurrent).toBe(false);
        expect(fs.readFileSync(path.join(authorRoot, "from-clone.txt"), "utf-8")).toBe("two");

        await releaseRepository(online(authorRoot));
    }, 180_000);

    /**
     * A clone must never be pointed at a folder that already holds work.
     *
     * The backend does not check: it writes `.lore/` and the working tree into whatever it
     * is given. This guard is the only thing between a mistyped path and an overwritten
     * project.
     */
    it("refuses to clone into a folder that is not empty", async () => {
        const occupied = tmp("nl-remote-occupied-");
        fs.writeFileSync(path.join(occupied, "mine.txt"), "do not overwrite me");

        await expect(cloneInto(online(occupied), { repositoryUrl: serverUrl("nope") }))
            .rejects.toThrow(/not empty/i);
        expect(fs.readFileSync(path.join(occupied, "mine.txt"), "utf-8")).toBe("do not overwrite me");
    }, 60_000);

    /**
     * Divergence: the backend refuses the push itself, and its wording names the remedy.
     *
     * Studio passes that sentence through rather than replacing it, so this pins the shape
     * of what an author reads. Syncing then MERGES rather than failing, which is why
     * divergence is a loop the author can get out of instead of a dead end.
     */
    it("refuses a diverged push, and syncing merges instead", async () => {
        const { root: aRoot, repositoryId } = await studioProject("nl-remote-diva-", "base.txt", "base");
        const url = serverUrl("diverge");
        await connect(aRoot, url, repositoryId);
        await pushToRemote(online(aRoot));
        await releaseRepository(online(aRoot));

        const bRoot = path.join(tmp("nl-remote-divbase-"), "project");
        await cloneInto(online(bRoot), { repositoryUrl: url });
        fs.writeFileSync(path.join(bRoot, "from-b.txt"), "b");
        await commitAll(online(bRoot), bRoot, "from b");
        await pushToRemote(online(bRoot));
        await releaseRepository(online(bRoot));

        // A commits WITHOUT syncing: now both sides have moved.
        fs.writeFileSync(path.join(aRoot, "from-a.txt"), "a");
        await commitAll(online(aRoot), aRoot, "from a");

        const diverged = await readSyncState(online(aRoot));
        expect(diverged.localAhead).toBe(true);
        expect(diverged.remoteAhead).toBe(true);

        await expect(pushToRemote(online(aRoot))).rejects.toThrow(/diverged/i);

        const merged = await syncFromRemote(online(aRoot));
        expect(merged.conflicts).toEqual([]);
        // Both sides' files survive the merge - the whole point of it.
        expect(fs.existsSync(path.join(aRoot, "from-a.txt"))).toBe(true);
        expect(fs.existsSync(path.join(aRoot, "from-b.txt"))).toBe(true);

        await releaseRepository(online(aRoot));
    }, 240_000);

    /**
     * An unreachable server RETURNS rather than hanging, and says so in the answer.
     *
     * Measured at 2.03 s. The assertion is deliberately about the ceiling and not the
     * exact number: what a spinner needs is a guarantee that the call comes back.
     */
    it("reports an unreachable server instead of hanging", async () => {
        const { root } = await studioProject("nl-remote-dead-", "x.txt", "x");
        // Only the address, deliberately: registering would need the server this test is
        // about not having. Push and status are what is under test here, and both work off
        // the address alone.
        await writeRemote(root, `${DEAD_SERVER}/nobody`);

        const started = Date.now();
        const state = await readSyncState(online(root));
        const elapsed = Date.now() - started;

        expect(state.remoteAvailable).toBe(false);
        expect(elapsed).toBeLessThan(UNREACHABLE_CEILING_MS);

        await expect(pushToRemote(online(root))).rejects.toThrow();
        await releaseRepository(online(root));
    }, 120_000);

    /**
     * Disconnecting restores the unconfigured placeholder, and only that line changes.
     *
     * The config file is the BACKEND's, not Studio's - it also holds the store budget and
     * the file-io flags - so a disconnect that regenerated it would silently revert
     * settings the author or their `lore` CLI had set.
     */
    it("disconnects without disturbing the rest of the backend's config", async () => {
        const { root, repositoryId } = await studioProject("nl-remote-disconnect-", "x.txt", "x");
        const configPath = path.join(root, ".lore", "config.toml");

        await connect(root, serverUrl("disconnect"), repositoryId);
        const connected = fs.readFileSync(configPath, "utf-8");
        expect(connected).toMatch(/max_capacity/);

        await writeRemote(root, null);
        const disconnected = fs.readFileSync(configPath, "utf-8");

        expect(await readRemote(offline(root))).toBeNull();
        expect(isVcsRemoteConfigured(VCS_UNCONFIGURED_REMOTE)).toBe(false);
        // Everything that is not the remote line is byte-identical.
        expect(disconnected.replace(/^.*remote_url.*$/m, ""))
            .toBe(connected.replace(/^.*remote_url.*$/m, ""));

        await releaseRepository(offline(root));
    }, 120_000);
});
