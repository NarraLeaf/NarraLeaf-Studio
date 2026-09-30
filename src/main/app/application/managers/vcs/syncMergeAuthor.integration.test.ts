import fs from "fs";
import os from "os";
import path from "path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { VCS_UNCONFIGURED_REMOTE_URL, isVcsPlatformSupported, type VcsServerSession } from "@shared/types/vcs";
import {
    commit,
    createRepository,
    flushRepository,
    history,
    releaseRepository,
    stage,
    type LoreGlobals,
} from "./lore";
import {
    LORE_TEST_SERVER,
    loreTestIdentity,
    loreTestSession,
    loreTestSessionUse,
    signInLoreTestAccount,
} from "./loreTestAccount";
import { cloneInto, parseRemoteUrl, publishToRemote, pushToRemote, writeRemote } from "./remote";
import { readRevisionDetails } from "./repository";
import type { BaseApp } from "../../baseApp";
import { VcsManager } from "./VcsManager";

/**
 * Who a merge that a sync made on its own is recorded as.
 *
 * **The defect this pins is a random identifier on the version surfaces.** A sync that meets
 * diverged history and merges it cleanly commits that merge itself, inside the one backend call
 * that also fetched - and that call has to carry the ACCOUNT ID, because the id is what the
 * backend looks a signed-in session up by (`onlineIdentity`). The backend records the same
 * global as the revision's author, so the merge came out authored by `3f2a9c1e-…`: the top of
 * the version rail read `合并 / {time} · 3f2a9c1e-…`, and so did the history below it and the
 * Team page every collaborator's launcher draws from the server's copy.
 *
 * The standard is the author a normal commit records for the same project under the same
 * sign-in - the person's name - and the specs compare against exactly that rather than
 * against a spelling of it, so they hold whatever `resolveIdentity` decides a name is.
 *
 * Needs a server; skipped without one:
 *
 * ```bash
 * LORE_TEST_REMOTE="lore://127.0.0.1:41337" npx vitest run \
 *   src/main/app/application/managers/vcs/syncMergeAuthor.integration.test.ts
 * ```
 *
 * **Against a server that verifies nobody, the sign-in is a stand-in** with an account id shaped
 * like the ones a Team server issues. Such a server never looks the id up, so the sync carries it
 * verbatim and records it exactly as a verifying server's account id would be recorded - which is
 * the whole of what is under test. With `LORE_TEST_TOKEN` set the real test account is used
 * instead (see `loreTestAccount.ts`).
 */

const supported = isVcsPlatformSupported() || Boolean(process.env.LORE_LIB_PATH);
const SERVER = LORE_TEST_SERVER;
const enabled = supported && SERVER !== "";

/** What the author commits offline as before any sign-in is involved. */
const AUTHOR = "spec@narraleaf";

/** The shape an account id takes on a Team server, and the shape that must never reach a surface. */
const ACCOUNT_ID_SHAPE = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;

const roots: string[] = [];

function tmp(prefix: string): string {
    const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), prefix)));
    roots.push(root);
    return root;
}

function offline(root: string): LoreGlobals {
    return { repositoryPath: root, offline: true, identity: AUTHOR, cache: true };
}

function online(root: string): LoreGlobals {
    return { ...offline(root), offline: false, identity: loreTestIdentity(AUTHOR) };
}

async function commitAll(globals: LoreGlobals, root: string, message: string): Promise<void> {
    await stage(globals, [root]);
    await commit(globals, message);
    await flushRepository(globals);
}

/** Unique per run: the server keeps repositories by name, so a fixed one collides on re-run. */
function serverUrl(name: string): string {
    return `${SERVER}/${name}-${Date.now().toString(36)}`;
}

/**
 * The sign-in the project uses: the real test account when the run has a token, otherwise a
 * stand-in for the server under test.
 */
function signInFor(url: string): VcsServerSession {
    const real = loreTestSession();
    if (real !== null) return real;
    return {
        // Never contacted: it is only reached when the backend reports a missing session, and a
        // server that verifies nobody never does.
        authUrl: "https://127.0.0.1:9",
        remoteOrigin: parseRemoteUrl(url).origin,
        account: {
            userId: "3f2a9c1e-5b7d-4e8f-9a0b-1c2d3e4f5a6b",
            displayName: "Ada Blackwood",
            username: "ada",
            email: "ada@example.com",
            identity: "Ada Blackwood <ada@example.com>",
            expiresAt: 0,
        },
        signedInAt: Date.now(),
    };
}

/**
 * Enough of a `BaseApp` for a manager whose one project uses one sign-in.
 *
 * The sign-in question is answered by {@link loreTestSessionUse} and recorded here, which is what
 * makes the project's calls carry the account id - the precondition of the defect.
 */
function fakeApp(session: VcsServerSession): BaseApp {
    const noop = () => undefined;
    const written = new Map<string, unknown>();
    return {
        logger: { info: noop, warn: noop, error: noop, debug: noop },
        projectTrustManager: { isTrusted: () => true, recordArrival: noop, forgetArrival: noop },
        getUserDataDir: () => os.tmpdir(),
        getGlobalState: () => ({
            get: (key: string) => {
                if (written.has(key)) return written.get(key);
                return key === "versionControl.serverSessions" ? [session] : undefined;
            },
            set: (key: string, value: unknown) => { written.set(key, value); },
        }),
    } as unknown as BaseApp;
}

afterAll(async () => {
    for (const root of roots) {
        try {
            fs.rmSync(root, { recursive: true, force: true });
        } catch {
            // A held repository can outlive the test; a leftover temp directory is not a failure.
        }
    }
}, 120_000);

describe.skipIf(!enabled)("a merge a sync made on its own", () => {
    beforeAll(async () => {
        await signInLoreTestAccount(tmp("nl-mergeauthor-signin-"));
    }, 60_000);

    /**
     * Two machines that each added a different file, so the sync merges without asking anyone.
     *
     * The author's push is already refused when this returns: both sides have moved, and the next
     * sync is the one that makes the merge.
     */
    async function divergedCleanly(name: string): Promise<{ root: string; url: string }> {
        const root = tmp(`nl-mergeauthor-${name}-a-`);
        const created = await createRepository(offline(root), {
            repositoryUrl: VCS_UNCONFIGURED_REMOTE_URL,
            description: "merge author spec",
        });
        fs.writeFileSync(path.join(root, "base.txt"), "base");
        await commitAll(offline(root), root, "base");

        const url = serverUrl(name);
        await writeRemote(root, url);
        await publishToRemote(online(root), { url, repositoryId: created.repository });
        await pushToRemote(online(root));
        await releaseRepository(online(root));

        const other = path.join(tmp(`nl-mergeauthor-${name}-b-`), "project");
        await cloneInto(online(other), { repositoryUrl: url });
        fs.writeFileSync(path.join(other, "from-b.txt"), "b");
        await commitAll(offline(other), other, "from b");
        await pushToRemote(online(other));
        await releaseRepository(online(other));

        fs.writeFileSync(path.join(root, "from-a.txt"), "a");
        await commitAll(offline(root), root, "from a");
        await expect(pushToRemote(online(root))).rejects.toThrow(/diverged/i);
        await releaseRepository(online(root));
        return { root, url };
    }

    it("records the merge as the person a normal commit records, not as their account id", async () => {
        const { root, url } = await divergedCleanly("author");
        const session = signInFor(url);
        const manager = new VcsManager(fakeApp(session), undefined, undefined, loreTestSessionUse);
        try {
            const synced = await manager.sync(root);
            expect(synced.conflicts).toEqual([]);
            expect(synced.alreadyCurrent).toBe(false);

            const [merge] = await manager.getHistory(root, 0, { includeDetails: true });
            // The sync did merge: two parents, both lines kept.
            expect(merge.parents).toHaveLength(2);
            expect(fs.existsSync(path.join(root, "from-b.txt"))).toBe(true);

            // The author an ordinary commit on this project records under this sign-in.
            fs.writeFileSync(path.join(root, "after.txt"), "after the merge");
            await manager.commit(root, { message: "after the merge" });
            const [ordinary, underneath] = await manager.getHistory(root, 0, { includeDetails: true });
            expect(underneath.revision).toBe(merge.revision);
            expect(ordinary.author).toBeTruthy();

            expect(merge.author).toBe(ordinary.author);
            expect(merge.author).not.toBe(session.account.userId);
            expect(merge.author ?? "").not.toMatch(ACCOUNT_ID_SHAPE);
        } finally {
            await manager.closeProject(root);
        }
    }, 300_000);

    /**
     * What the server holds is what every other surface draws: a Team server reports a project's
     * versions with the same key the rail reads, from its own copy. So the name has to be on the
     * revision that is SENT, and that revision has to still be the join of the two lines - a merge
     * the server refuses, or one that no longer joins them, would trade the identifier for a
     * diverged branch.
     */
    it("sends the renamed merge, still joining both lines, and the server's copy carries the name", async () => {
        const { root, url } = await divergedCleanly("sent");
        const session = signInFor(url);
        const manager = new VcsManager(fakeApp(session), undefined, undefined, loreTestSessionUse);
        let mergeRevision = "";
        let expected = "";
        try {
            await manager.sync(root);
            const [merge] = await manager.getHistory(root, 0, { includeDetails: true });
            expect(merge.parents).toHaveLength(2);
            mergeRevision = merge.revision;
            expected = merge.author ?? "";

            // Accepted first time: no second sync, no "diverged".
            await expect(manager.push(root)).resolves.toBeTruthy();
        } finally {
            await manager.closeProject(root);
        }
        expect(expected).toBe(session.account.identity);

        // A machine that never saw the merge being made reads it off the server.
        const reader = path.join(tmp("nl-mergeauthor-reader-"), "project");
        await cloneInto(online(reader), { repositoryUrl: url });
        const graph = await history(online(reader), {});
        const received = graph.nodes.get(mergeRevision);
        expect(received?.parents).toHaveLength(2);
        const details = await readRevisionDetails(online(reader), mergeRevision);
        await releaseRepository(online(reader));
        expect(details.author).toBe(expected);
    }, 300_000);
});
