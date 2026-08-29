/**
 * The account the remote halves of the vcs integration specs make their online calls as.
 *
 * Six files here have a block that needs a running loreserver, and every one of them was
 * written against a server that verifies nobody: their online globals name an author
 * (`spike@narraleaf`) where a server that checks tokens wants the id of the account whose
 * token was presented. This module is the one place that knows the difference, because the
 * rule behind it is not guessable from a call site - see {@link loreTestIdentity}.
 *
 * ```bash
 * # A server that verifies nobody needs only the address.
 * LORE_TEST_REMOTE="lore://127.0.0.1:41337" npx vitest run \
 *   src/main/app/application/managers/vcs/merge.integration.test.ts
 *
 * # A NarraLeaf Team server needs a token as well, minted by its sign-in endpoint.
 * LORE_TEST_TOKEN=$(curl -sk -X POST "https://127.0.0.1:41402/api/studio/v1/sign-in" \
 *   -H "Content-Type: application/json" -d '{"username":"alice","password":"..."}' \
 *   | node -pe "JSON.parse(require('fs').readFileSync(0,'utf8')).token")
 * LORE_TEST_AUTH="https://127.0.0.1:41402" LORE_TEST_REMOTE="lore://127.0.0.1:41337" \
 *   npx vitest run src/main/app/application/managers/vcs/
 * ```
 *
 * ❗ **Every remote spec leaves a project registration behind on the server**, one per
 * repository it publishes, and they do not expire: taking a project off the list is a Team
 * call and a test process has no Team session. Sweeping them is a `DELETE FROM projects`
 * against the server's `team.db` while nothing holds it - what `projects.forget` does - and
 * the names all carry the spec's own prefix so they can be told from a real project.
 */
import fs from "fs";
import os from "os";
import path from "path";

import type { VcsServerSession } from "@shared/types/vcs";

import { signInToServer } from "./serverSession";

/** The server the remote blocks run against, or "" when this run has none. */
export const LORE_TEST_SERVER = (process.env.LORE_TEST_REMOTE ?? "").trim();
/** A token for a server that verifies identities. Empty for one that does not. */
const LORE_TEST_TOKEN = (process.env.LORE_TEST_TOKEN ?? "").trim();
/** Where to present the token. Empty when the token itself names its endpoint. */
const LORE_TEST_AUTH = (process.env.LORE_TEST_AUTH ?? "").trim();

/**
 * The signed-in session, resolved once for the whole process.
 *
 * Signing in is a machine-level act - the store is Lore's own and outlives the process - so a
 * second login would be the same write again, and the specs in one run all act as one account.
 */
let signedIn: Promise<VcsServerSession | null> | null = null;
let resolved: VcsServerSession | null = null;
let accountId = "";

/**
 * Sign in, once, so that later online calls can name the account the token belongs to.
 *
 * Call it from a `beforeAll` in the remote block, before the first call that leaves the
 * machine. Without `LORE_TEST_TOKEN` it answers null and changes nothing, which is what a run
 * against a server that verifies nobody wants.
 *
 * `repositoryPath` is only the working directory the call is made from - it needs no repository
 * in it - so a file with no root to hand at that point can leave it out.
 */
export async function signInLoreTestAccount(repositoryPath?: string): Promise<VcsServerSession | null> {
    if (LORE_TEST_TOKEN === "") {
        return null;
    }
    if (signedIn === null) {
        const cwd = repositoryPath ?? fs.mkdtempSync(path.join(os.tmpdir(), "nl-lore-signin-"));
        signedIn = signInToServer(
            { repositoryPath: cwd, offline: false, cache: true },
            {
                remoteUrl: LORE_TEST_SERVER,
                authUrl: LORE_TEST_AUTH,
                token: LORE_TEST_TOKEN,
                userDataDir: os.tmpdir(),
            },
        );
    }
    resolved = await signedIn;
    accountId = resolved?.account.userId ?? "";
    return resolved;
}

/**
 * What `identity` on online globals has to be: the signed-in account, or `fallback`.
 *
 * ⚠ **`identity` on online globals is the ACCOUNT ID, not a name.** It is the key Lore's
 * per-user session store is looked up by, so a name in its place fails every later call with
 * `No token stored` - which reads as a token that was never presented rather than one filed
 * under a different key. `serverSession.ts` says so where the sign-in is written.
 *
 * The fallback is the author name a file uses offline, and it is the right answer twice: for a
 * run with no token, and for globals that carry `offline: false` without a server to reach -
 * `onlineCommitCheck.integration.test.ts` is built on exactly that pair.
 */
export function loreTestIdentity(fallback: string): string {
    return accountId || fallback;
}

/** The stored sign-in, for a `VcsManager` that has to read one out of its settings. */
export function loreTestSession(): VcsServerSession | null {
    return resolved;
}
