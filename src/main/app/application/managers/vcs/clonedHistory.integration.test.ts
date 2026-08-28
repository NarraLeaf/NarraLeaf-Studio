import fs from "fs";
import os from "os";
import path from "path";
import { afterAll, describe, expect, it } from "vitest";
import { VCS_UNCONFIGURED_REMOTE_URL, isVcsPlatformSupported } from "@shared/types/vcs";
import {
    commit,
    createRepository,
    flushRepository,
    releaseRepository,
    stage,
    type LoreGlobals,
} from "./lore";
import { publishToRemote, pushToRemote, writeRemote } from "./remote";
import { LORE_TEST_SERVER, loreTestIdentity, loreTestSession, signInLoreTestAccount } from "./loreTestAccount";
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
const SERVER = LORE_TEST_SERVER;
const remoteEnabled = supported && SERVER !== "";

const DOCUMENT = "doc.json";
const REVISIONS = 4;

const roots: string[] = [];
/** The author, and the identity a run with no token goes online as. */
const AUTHOR = "spec@narraleaf";

function tmp(prefix: string): string {
    const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), prefix)));
    roots.push(root);
    return root;
}

/** Offline and unable to become anything else, which is what makes the assertion below mean something. */
function offline(root: string): LoreGlobals {
    return { repositoryPath: root, offline: true, identity: AUTHOR, cache: true };
}

function online(root: string): LoreGlobals {
    return { ...offline(root), offline: false, identity: loreTestIdentity(AUTHOR) };
}

/** A manager with the sign-in a real one would have; see `merge.integration.test.ts` on why. */
function fakeApp(): BaseApp {
    const noop = () => undefined;
    return {
        logger: { info: noop, warn: noop, error: noop, debug: noop },
        getGlobalState: () => ({
            get: (key: string) => {
                const session = loreTestSession();
                return key === "versionControl.serverSessions" && session ? [session] : undefined;
            },
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

        await signInLoreTestAccount(authorRoot);

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
