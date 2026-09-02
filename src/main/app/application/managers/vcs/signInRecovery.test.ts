import { beforeEach, describe, expect, it, vi } from "vitest";
import type { BaseApp } from "../../baseApp";
import { VcsManager } from "./VcsManager";

/**
 * Presenting the stored token again when the backend turns out not to have one.
 *
 * **Two stores hold this, and only one of them is Studio's.** The session that says an
 * author signed in is in this profile; the token the backend presents is in a store
 * belonging to the machine, outside every profile and every repository. Anything that
 * empties the second while the first is intact - a reinstall, settings carried across, any
 * other tool clearing it - leaves Studio listing a server it can read over its own API and
 * refusing every clone, push and sync against it with `No token stored`, which reads as a
 * token nobody ever presented.
 *
 * Studio kept the token, sealed, so that state is one it can leave without asking anybody
 * anything. What these assert is that it happens once, that it happens only for that
 * failure, and that a refusal from the server itself is still a refusal.
 */

const lore = vi.hoisted(() => {
    const calls: string[] = [];
    return {
        calls,
        /** How many more times `cloneInto` reports that the backend holds no session. */
        missing: { count: 0 },
        /** What `writeRemote` was handed, and whether it is allowed to succeed. */
        wrote: [] as Array<{ root: string; url: string | null }>,
        writeFails: { value: false },
        signIn: vi.fn(async () => ({ authUrl: "", remoteOrigin: "", account: {}, signedInAt: 0 })),
        backend: {
            releaseRepository: async () => {
                calls.push("release");
                return undefined;
            },
            writeRemote: async (root: string, url: string | null) => {
                calls.push("writeRemote");
                if (lore.writeFails.value) {
                    throw new Error("EACCES: config.toml is read-only");
                }
                lore.wrote.push({ root, url });
                return undefined;
            },
            readRevisionGraph: async () => {
                calls.push("history");
                return new Map();
            },
            cloneInto: async () => {
                calls.push("clone");
                if (lore.missing.count > 0) {
                    lore.missing.count -= 1;
                    throw new Error("repositoryClone: Failed to resolve repository: No token stored");
                }
                return { branch: "main", fileCount: 12 };
            },
            signInToServer: (...args: unknown[]) => {
                calls.push("signIn");
                return lore.signIn(...(args as [])) as unknown;
            },
        },
    };
});

vi.mock("./backend", () => ({
    requireVcsBackend: async () => lore.backend,
    getVcsAvailability: async () => ({ available: true }),
}));

// Sealed by the OS keyring, which a test does not have one of.
const token = vi.hoisted(() => ({ value: "a-token" as string | null }));
vi.mock("./serverTokens", async importOriginal => ({
    ...(await importOriginal<Record<string, unknown>>()),
    recallServerToken: () => token.value,
}));

const ORIGIN = "lore://team.example.lan:41337";
const REMOTE = `${ORIGIN}/driftwood`;
const DESTINATION = process.platform === "win32" ? "D:\\games\\driftwood" : "/games/driftwood";

const SESSION = {
    authUrl: "https://team.example.lan:41402",
    remoteOrigin: ORIGIN,
    account: { userId: "u1", displayName: "Ada", username: "ada", email: "", identity: "ada" },
    signedInAt: 0,
};

/**
 * The trust ledger as a clone leaves it, so an arrival can be asserted rather than stubbed. A row
 * goes in before the copy and comes out again only when the copy failed without writing anything.
 */
const recordedImports: { path: string; origin: string }[] = [];

function fakeApp(sessions: unknown[] = [SESSION]): BaseApp {
    const noop = () => undefined;
    const state = new Map<string, unknown>([["versionControl.serverSessions", sessions]]);
    return {
        logger: { info: noop, warn: noop, error: noop, debug: noop },
        getGlobalState: () => ({
            get: (key: string) => state.get(key),
            set: (key: string, value: unknown) => { state.set(key, value); },
        }),
        getUserDataDir: () => "D:/userData",
        projectTrustManager: {
            recordArrival: (path: string, origin: string) => { recordedImports.push({ path, origin }); },
            forgetArrival: (path: string) => {
                const index = recordedImports.findIndex((row) => row.path === path);
                if (index >= 0) recordedImports.splice(index, 1);
            },
        },
    } as unknown as BaseApp;
}

beforeEach(() => {
    lore.calls.length = 0;
    lore.missing.count = 0;
    lore.wrote.length = 0;
    lore.writeFails.value = false;
    recordedImports.length = 0;
    lore.signIn.mockReset().mockResolvedValue({
        authUrl: "", remoteOrigin: "", account: {}, signedInAt: 0,
    });
    token.value = "a-token";
});

describe("cloning against a backend that has lost its session", () => {
    it("presents the stored token and runs the clone again", async () => {
        lore.missing.count = 1;

        const cloned = await new VcsManager(fakeApp()).cloneRepository(REMOTE, DESTINATION);

        expect(cloned.fileCount).toBe(12);
        // `history` is the prefetch that makes the copy's own past readable offline; it runs last,
        // after the address is written, and opens a store of its own to do it - which is the second
        // `release`. See `VcsManager.fetchRevisionHistory`. Every case below that has no `history`
        // is one where the clone itself threw, so there is no copy to prefetch anything into.
        expect(lore.calls)
            .toEqual(["clone", "signIn", "clone", "release", "writeRemote", "history", "release"]);
        // The token goes to the server the copy is coming from, on the address the session
        // recorded - not to a repository, which is a store this does not touch.
        expect(lore.signIn).toHaveBeenCalledWith(
            expect.objectContaining({ repositoryPath: "", offline: false }),
            expect.objectContaining({ remoteUrl: ORIGIN, authUrl: SESSION.authUrl, token: "a-token" }),
        );
    });

    it("gives up rather than looping when the second attempt says the same thing", async () => {
        lore.missing.count = 5;

        await expect(new VcsManager(fakeApp()).cloneRepository(REMOTE, DESTINATION))
            .rejects.toThrow(/No token stored/);
        expect(lore.calls).toEqual(["clone", "signIn", "clone", "release"]);
    });

    it("does not sign in for a server this installation has no session for", async () => {
        lore.missing.count = 1;

        await expect(new VcsManager(fakeApp([])).cloneRepository(REMOTE, DESTINATION))
            .rejects.toThrow(/No token stored/);
        expect(lore.calls).toEqual(["clone", "release"]);
    });

    it("does not sign in where the token cannot be unsealed on this machine", async () => {
        lore.missing.count = 1;
        token.value = null;

        await expect(new VcsManager(fakeApp()).cloneRepository(REMOTE, DESTINATION))
            .rejects.toThrow(/No token stored/);
        expect(lore.calls).toEqual(["clone", "release"]);
    });

    it("reports a sign-in that was itself refused as the failure the caller already had", async () => {
        lore.missing.count = 1;
        lore.signIn.mockRejectedValue(new Error("This token has expired"));

        await expect(new VcsManager(fakeApp()).cloneRepository(REMOTE, DESTINATION))
            // The clone's own sentence, not the sign-in's: what the author asked for was a
            // copy, and the recovery attempt is not a thing they know happened.
            .rejects.toThrow(/No token stored/);
        expect(lore.calls).toEqual(["clone", "signIn", "release"]);
    });

    /**
     * Every other failure passes straight through.
     *
     * A server that refused the account, a repository that is not there, a machine that is
     * off - none of them is helped by signing in, and running the call a second time would
     * cost a second round trip to be told the same thing.
     */
    it("leaves a refusal that is not about a session alone", async () => {
        const backend = lore.backend as unknown as { cloneInto: () => Promise<unknown> };
        const original = backend.cloneInto;
        backend.cloneInto = async () => {
            lore.calls.push("clone");
            throw new Error("repositoryClone: Not authorized to access repository");
        };

        try {
            await expect(new VcsManager(fakeApp()).cloneRepository(REMOTE, DESTINATION))
                .rejects.toThrow(/Not authorized/);
            expect(lore.calls).toEqual(["clone", "release"]);
        } finally {
            backend.cloneInto = original;
        }
    });
});

/**
 * What a copy remembers about where it came from.
 *
 * Lore writes a `remote_url` of its own during a clone and it is the origin with the repository
 * name stripped off, which Studio's own reader does not accept - so a clone that left it alone
 * produced a project belonging to no server, and the first Send after it failed with the sentence
 * this whole file is about, blaming the credentials for an address nobody had written down.
 */
describe("the address a clone came from", () => {
    it("is written into the copy, whole, once nothing is holding the repository", async () => {
        const cloned = await new VcsManager(fakeApp()).cloneRepository(REMOTE, DESTINATION);

        expect(cloned.fileCount).toBe(12);
        expect(lore.wrote).toHaveLength(1);
        // The whole address, not the origin Lore keeps: the name is the half that says which
        // repository on that server this copy is.
        expect(lore.wrote[0]!.url).toBe(REMOTE);
        expect(lore.wrote[0]!.root.replace(/\\/g, "/")).toContain("driftwood");
        // After the release, for the reason `setRemote` closes the session first: the backend
        // reads this file when it opens a store.
        expect(lore.calls.indexOf("writeRemote")).toBeGreaterThan(lore.calls.indexOf("release"));
        // A clone is somebody else's working tree, so it arrives distrusted like any other import.
        // Recorded once, ahead of the copy, and marked as having come from a server rather than
        // a file.
        expect(recordedImports).toHaveLength(1);
        expect(recordedImports[0]!.origin).toBe("remote");
        expect(recordedImports[0]!.path.replace(/\\/g, "/")).toContain("driftwood");
    });

    it("is taken back for a clone that failed before writing anything", async () => {
        lore.missing.count = 5;

        await expect(new VcsManager(fakeApp()).cloneRepository(REMOTE, DESTINATION))
            .rejects.toThrow(/No token stored/);
        expect(lore.wrote).toHaveLength(0);
        // Recorded ahead of the copy and forgotten again: there is no copy on disk to distrust,
        // and a row for a folder that does not exist would sit in the settings list waiting for
        // a decision nothing needs.
        expect(recordedImports).toHaveLength(0);
    });

    it("does not turn a clone that worked into one that failed", async () => {
        lore.writeFails.value = true;

        // The files are on disk. Reporting a failure would leave the author with a destination
        // that is no longer empty and a wizard that will not clone into it again; the project
        // opens, and the server can still be set from the version rail.
        const cloned = await new VcsManager(fakeApp()).cloneRepository(REMOTE, DESTINATION);

        expect(cloned.fileCount).toBe(12);
        expect(lore.wrote).toHaveLength(0);
    });
});
