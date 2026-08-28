import fs from "fs";
import os from "os";
import path from "path";
import { afterAll, describe, expect, it } from "vitest";
import { VCS_UNCONFIGURED_REMOTE_URL, isVcsPlatformSupported, type VcsServerSession } from "@shared/types/vcs";
import {
    commit,
    createRepository,
    flushRepository,
    releaseRepository,
    stage,
    type LoreGlobals,
} from "./lore";
import { publishToRemote, pushToRemote, writeRemote } from "./remote";
import { signInToServer } from "./serverSession";
import { VcsManager } from "./VcsManager";
import type { BaseApp } from "../../baseApp";

/**
 * What a cloned project can say about its own past.
 *
 * **A clone brings the working tree and not the history behind it**, which nothing in Studio saw
 * because every history read is offline and a failed one draws the same "no versions yet" as a
 * project that genuinely has none. Measured: a copy of a four-revision project answers
 * `revisionHistory: Not found` to every local read, permanently - so whoever joined a project got
 * a version rail that said the work had no history, a comparison with nothing to compare, and a
 * merge base that could not be computed.
 *
 * One read with a socket open fetches what is missing and it stays fetched, so the clone does that
 * read before it hands the project over. This holds that: the assertion is made on globals that
 * CANNOT go online, because an online read would pass either way and prove nothing.
 *
 * Needs a server, and one with a history on it - a project with a single revision has nothing
 * behind its tip to be missing, which is why the fixture pushes four.
 */

const supported = isVcsPlatformSupported() || Boolean(process.env.LORE_LIB_PATH);
const SERVER = (process.env.LORE_TEST_REMOTE ?? "").trim();
const TOKEN = (process.env.LORE_TEST_TOKEN ?? "").trim();
const AUTH = (process.env.LORE_TEST_AUTH ?? "").trim();
const remoteEnabled = supported && SERVER !== "";

const DOCUMENT = "doc.json";
const REVISIONS = 4;

const roots: string[] = [];
let signedIn: VcsServerSession | null = null;

function tmp(prefix: string): string {
    const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), prefix)));
    roots.push(root);
    return root;
}

/** Offline and unable to become anything else, which is what makes the assertion below mean something. */
function offline(root: string): LoreGlobals {
    return { repositoryPath: root, offline: true, identity: "spec@narraleaf", cache: true };
}

function online(root: string): LoreGlobals {
    return { ...offline(root), offline: false, identity: signedIn?.account.userId ?? "spec@narraleaf" };
}

/** A manager with the sign-in a real one would have; see `merge.integration.test.ts` on why. */
function fakeApp(): BaseApp {
    const noop = () => undefined;
    return {
        logger: { info: noop, warn: noop, error: noop, debug: noop },
        getGlobalState: () => ({
            get: (key: string) =>
                (key === "versionControl.serverSessions" && signedIn ? [signedIn] : undefined),
        }),
    } as unknown as BaseApp;
}

afterAll(() => {
    for (const root of roots) {
        fs.rmSync(root, { recursive: true, force: true });
    }
});

describe.skipIf(!remoteEnabled)("a cloned project", () => {
    it("can read the history it was cloned with, without going back to the server", async () => {
        const url = `${SERVER}/clonedhistory-${Date.now().toString(36)}`;
        const authorRoot = tmp("nl-clonehist-author-");

        if (TOKEN !== "") {
            signedIn = await signInToServer(
                { repositoryPath: authorRoot, offline: false, cache: true },
                { remoteUrl: SERVER, authUrl: AUTH, token: TOKEN, userDataDir: os.tmpdir() },
            );
        }

        const created = await createRepository(offline(authorRoot), {
            repositoryUrl: VCS_UNCONFIGURED_REMOTE_URL,
            description: "cloned history",
        });
        for (let nth = 1; nth <= REVISIONS; nth += 1) {
            fs.writeFileSync(
                path.join(authorRoot, DOCUMENT),
                `${JSON.stringify({ id: "scene", title: `r${nth}` }, null, 2)}\n`,
                "utf-8",
            );
            await stage(offline(authorRoot), [authorRoot]);
            await commit(offline(authorRoot), `r${nth}`);
            await flushRepository(offline(authorRoot));
        }
        await writeRemote(authorRoot, url);
        await publishToRemote(online(authorRoot), { url, repositoryId: created.repository });
        await pushToRemote(online(authorRoot));
        await releaseRepository(online(authorRoot));

        const destination = path.join(tmp("nl-clonehist-clone-"), "project");
        const manager = new VcsManager(fakeApp());
        try {
            await manager.cloneRepository(url, destination);
        } finally {
            await manager.closeProject(destination);
        }

        // The whole point: offline, the way every read in Studio is. Before the clone fetched the
        // history this threw `revisionHistory: Not found` and the rail said the project had none.
        const reader = new VcsManager(fakeApp());
        try {
            const entries = await reader.getHistory(destination);
            expect(entries).toHaveLength(REVISIONS);
            expect(entries[0].number).toBe(REVISIONS);
        } finally {
            await reader.closeProject(destination);
        }
    }, 600_000);
});
