import fs from "fs";
import os from "os";
import path from "path";
import { describe, expect, it } from "vitest";
import { VCS_UNCONFIGURED_REMOTE_URL, isVcsPlatformSupported } from "@shared/types/vcs";
import {
    closeStore,
    commit,
    createRepository,
    flushRepository,
    openStore,
    releaseRepository,
    stage,
    type LoreGlobals,
} from "./lore";
import { blobAt } from "./revisionReader";

/**
 * The minimum experiment that decides §4.29's attribution.
 *
 * §4.29 was first written as "a sync blinds the syncing process". A later probe claimed
 * the culprit is narrower: content committed through `offline: false` globals cannot be
 * read back by the process that wrote it, and sync only looked guilty because every
 * failing read in the earlier probes happened to be of an online-committed revision.
 *
 * The two stories predict different things here, so this settles it with no server, no
 * clone and no sync anywhere in the picture - if a plain local repository reproduces the
 * failure, sync was never involved.
 *
 * Three commits in one process, read back in the same process:
 *
 *  1. offline  - the control for "reads work at all"
 *  2. online   - the suspect
 *  3. offline  - the control that matters, because it comes AFTER the online one: if
 *                this one reads, the flag is the cause rather than ordering or some
 *                cumulative damage the online commit did to the repository.
 */

const supported = isVcsPlatformSupported() || Boolean(process.env.LORE_LIB_PATH);

describe.skipIf(!supported)("does an online commit hide its own content", () => {
    it("commits offline, online, then offline again, and reads all three back", async () => {
        const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "nl-online-commit-")));
        const offline: LoreGlobals = { repositoryPath: root, offline: true, identity: "check@narraleaf", cache: true };
        const online: LoreGlobals = { ...offline, offline: false };

        const write = (name: string, text: string) => fs.writeFileSync(path.join(root, name), text, "utf-8");
        const commitWith = async (globals: LoreGlobals, name: string): Promise<string> => {
            await stage(globals, [root]);
            const revision = await commit(globals, `commit ${name}`);
            await flushRepository(globals);
            return revision.revision;
        };

        const created = await createRepository(offline, {
            repositoryUrl: VCS_UNCONFIGURED_REMOTE_URL,
            description: "online commit check",
        });

        write("a.txt", "first\n");
        const first = await commitWith(offline, "offline-1");
        write("b.txt", "second\n");
        const second = await commitWith(online, "online");
        write("c.txt", "third\n");
        const third = await commitWith(offline, "offline-2");

        const store = await openStore(offline, root);
        const read = async (revision: string, file: string) => {
            try {
                return { bytes: (await blobAt(offline, store, created.repository, revision, file)).byteLength };
            } catch (error) {
                return { error: error instanceof Error ? error.message : String(error) };
            }
        };

        const observations = {
            committedOffline1: await read(first, "a.txt"),
            committedOnline: await read(second, "b.txt"),
            committedOffline2: await read(third, "c.txt"),
            // The first file re-read at the LAST revision: if the online commit damaged the
            // repository rather than just its own content, this goes dark too.
            firstFileAtLastRevision: await read(third, "a.txt"),
        };
        console.log(`\n### ONLINE COMMIT CHECK\n${JSON.stringify(observations, null, 2)}`);

        await flushRepository(offline).catch(() => undefined);
        await closeStore(offline, store).catch(() => undefined);
        await releaseRepository(offline).catch(() => undefined);
        try {
            fs.rmSync(root, { recursive: true, force: true });
        } catch {
            // A leftover temp directory is not a result.
        }

        expect(Object.keys(observations).length).toBe(4);
    }, 180_000);

    /**
     * The arm the no-remote case is missing.
     *
     * With no remote configured, an online commit reads back perfectly - so `offline:
     * false` alone is not the trigger. The remaining difference in every failing
     * observation so far is that the repository had a REGISTERED remote, which is when
     * `offline: false` actually reaches a server. Two commits, same repository, same
     * process, differing only in the flag.
     */
    it.skipIf(!process.env.LORE_TEST_REMOTE)("repeats it on a repository that is registered with a server", async () => {
        const server = (process.env.LORE_TEST_REMOTE ?? "").trim();
        const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "nl-online-commit-remote-")));
        const offline: LoreGlobals = { repositoryPath: root, offline: true, identity: "check@narraleaf", cache: true };
        const online: LoreGlobals = { ...offline, offline: false };
        const url = `${server}/online-commit-${Date.now().toString(36)}`;

        const write = (name: string, text: string) => fs.writeFileSync(path.join(root, name), text, "utf-8");
        const commitWith = async (globals: LoreGlobals, name: string): Promise<string> => {
            await stage(globals, [root]);
            const revision = await commit(globals, `commit ${name}`);
            await flushRepository(globals);
            return revision.revision;
        };

        const created = await createRepository(offline, {
            repositoryUrl: VCS_UNCONFIGURED_REMOTE_URL,
            description: "online commit check (registered)",
        });
        write("a.txt", "first\n");
        await commitWith(offline, "offline-1");

        // Both halves of connecting, because only registering makes `offline:false` mean
        // anything (docs §5.3.1) - the address alone leaves the server unaware of us.
        const { publishToRemote, writeRemote } = await import("./remote");
        await writeRemote(root, url);
        await publishToRemote(online, { url, repositoryId: created.repository });
        await releaseRepository(online);

        write("b.txt", "offline after registering\n");
        const offlineAfter = await commitWith(offline, "offline-2");
        write("c.txt", "online after registering\n");
        const onlineAfter = await commitWith(online, "online");

        const store = await openStore(offline, root);
        const read = async (revision: string, file: string) => {
            try {
                return { bytes: (await blobAt(offline, store, created.repository, revision, file)).byteLength };
            } catch (error) {
                return { error: error instanceof Error ? error.message : String(error) };
            }
        };
        const observations = {
            committedOfflineWhileRegistered: await read(offlineAfter, "b.txt"),
            committedOnlineWhileRegistered: await read(onlineAfter, "c.txt"),
            earlierFileAtTheOnlineRevision: await read(onlineAfter, "a.txt"),
        };
        console.log(`\n### ONLINE COMMIT CHECK (REGISTERED)\n${JSON.stringify(observations, null, 2)}`);

        await flushRepository(offline).catch(() => undefined);
        await closeStore(offline, store).catch(() => undefined);
        await releaseRepository(offline).catch(() => undefined);
        try {
            fs.rmSync(root, { recursive: true, force: true });
        } catch {
            // A leftover temp directory is not a result.
        }

        expect(Object.keys(observations).length).toBe(3);
    }, 180_000);
});
