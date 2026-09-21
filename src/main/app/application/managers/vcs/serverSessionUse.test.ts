import { beforeEach, describe, expect, it, vi } from "vitest";
import type { BaseApp } from "../../baseApp";
import type { VcsServerSession, VcsSessionUse } from "@shared/types/vcs";
import { VcsManager } from "./VcsManager";

/**
 * A server sign-in, scoped to the (server, project) pair.
 *
 * The sign-in belongs to the machine: the backend keeps it in a per-user store and will present it
 * for any call that carries the account's id. So a project acts as that account exactly when Studio
 * puts the account id on its calls - and what these pin is when that happens: only after the author
 * has said this project uses it, asked once, in a window the manager is handed rather than one a
 * caller can answer.
 *
 * A fake backend, because the question is which identity each call goes out under and whether the
 * stored token is presented for it. What a real server does with them is the acceptance run's.
 */

const lore = vi.hoisted(() => {
    /** Every call that reached the network, with the identity it carried. */
    const online: Array<{ verb: string; identity: string }> = [];
    return {
        online,
        signIns: [] as unknown[],
        signOuts: [] as unknown[],
        /** How many more online calls answer that the backend holds no session. */
        missing: { count: 0 },
        remote: { value: "lore://team.example.lan:41337/harbour" as string | null },
        backend: {
            openStore: async () => ({ handleId: 1 }),
            closeStore: async () => undefined,
            flushRepository: async () => undefined,
            releaseRepository: async () => undefined,
            readRepositoryIdentity: async () => ({ repository: "019fda5ba4fe799096aaab7585aa4722", branch: "main" }),
            readRemote: async () => lore.remote.value,
            getStatus: async () => ({ clean: true }),
            readServerSessions: async () => [
                { authUrl: "https://team.example.lan:41402", resource: "", userId: "u-ada", expiresAt: 0 },
            ],
            pushToRemote: async (globals: { identity: string }) => {
                lore.online.push({ verb: "push", identity: globals.identity });
                if (lore.missing.count > 0) {
                    lore.missing.count -= 1;
                    throw new Error("branchPush: Failed to resolve repository: No token stored");
                }
                return { branch: "main", alreadyPushed: false };
            },
            syncFromRemote: async (globals: { identity: string }) => {
                lore.online.push({ verb: "sync", identity: globals.identity });
                return { filesChanged: 0, revisionsReceived: 0, conflicts: [] };
            },
            readSyncState: async (globals: { identity: string }) => {
                lore.online.push({ verb: "state", identity: globals.identity });
                return { remoteAvailable: true, remoteAuthorized: true };
            },
            signInToServer: async (...args: unknown[]) => {
                lore.signIns.push(args);
                // What adding a server gets back: the session the token names.
                return { ...ADA, signedInAt: 1 };
            },
            signOutOfServer: async (...args: unknown[]) => {
                lore.signOuts.push(args);
            },
            readSignInToken: () => ({
                account: ADA.account,
                authUrl: ADA.authUrl,
                authUrls: [ADA.authUrl],
                remotes: [ORIGIN],
                authorityFingerprint: "",
            }),
        },
    };
});

vi.mock("./backend", () => ({
    requireVcsBackend: async () => lore.backend,
    getVcsAvailability: async () => ({ available: true }),
}));

// Sealed by the OS keyring, which a test does not have.
vi.mock("./serverTokens", async importOriginal => ({
    ...(await importOriginal<Record<string, unknown>>()),
    recallServerToken: () => "a-token",
    rememberServerToken: () => true,
    forgetServerToken: () => undefined,
}));

const ORIGIN = "lore://team.example.lan:41337";
const WIN = process.platform === "win32";
const PROJECT_A = WIN ? "D:\\games\\harbour" : "/games/harbour";
const PROJECT_B = WIN ? "D:\\games\\lantern" : "/games/lantern";
const PROJECT_C = WIN ? "D:\\games\\tidewater" : "/games/tidewater";

const ADA: VcsServerSession = {
    authUrl: "https://team.example.lan:41402",
    remoteOrigin: ORIGIN,
    account: {
        userId: "u-ada",
        displayName: "Ada",
        username: "ada",
        email: "",
        identity: "Ada <ada@example.com>",
        expiresAt: 0,
    },
    signedInAt: 0,
};

/** The author's own name, which a project that uses no sign-in records and goes online as. */
const AUTHOR = "Author From Settings";

let state: Map<string, unknown>;
let trusted: boolean;

/**
 * A profile that signed in before answers were kept: the sign-in is there, and no project has
 * said anything about it. This is every existing installation on the day the scoping ships.
 */
function upgradedApp(): BaseApp {
    const noop = () => undefined;
    state = new Map<string, unknown>([
        ["versionControl.serverSessions", [ADA]],
        ["versionControl.authorName", AUTHOR],
        ["app.recentProjects", [{ name: "Harbour Lights", path: PROJECT_A, openedAt: 0 }]],
    ]);
    return {
        logger: { info: noop, warn: noop, error: noop, debug: noop },
        getGlobalState: () => ({
            get: (key: string) => state.get(key),
            set: (key: string, value: unknown) => { state.set(key, value); },
        }),
        getUserDataDir: () => "D:/userData",
        projectTrustManager: { isTrusted: () => trusted },
    } as unknown as BaseApp;
}

const asker = vi.fn(async (_request: { projectPath: string; session: VcsServerSession }): Promise<boolean | null> => true);

let manager: VcsManager;

function uses(): VcsSessionUse[] {
    return (state.get("versionControl.serverSessionProjects") as VcsSessionUse[] | undefined) ?? [];
}

beforeEach(() => {
    lore.online.length = 0;
    lore.signIns.length = 0;
    lore.signOuts.length = 0;
    lore.missing.count = 0;
    lore.remote.value = `${ORIGIN}/harbour`;
    trusted = true;
    asker.mockReset().mockResolvedValue(true);
    manager = new VcsManager(upgradedApp(), undefined, undefined, asker);
});

describe("an existing sign-in, after the upgrade", () => {
    it("is still there, and the first request from each project asks about it once", async () => {
        await manager.push(PROJECT_A);
        await manager.push(PROJECT_A);
        await manager.getSyncState(PROJECT_A);

        expect(asker).toHaveBeenCalledTimes(1);
        expect(asker.mock.calls[0]![0].session.account.userId).toBe("u-ada");
        // The sign-in was neither dropped nor rewritten by being asked about.
        expect(state.get("versionControl.serverSessions")).toEqual([ADA]);
        expect(manager.listServers()).toHaveLength(1);
    });

    it("goes out as the account for the project that said yes", async () => {
        await manager.push(PROJECT_A);
        expect(lore.online).toEqual([{ verb: "push", identity: "u-ada" }]);
        expect(uses()).toEqual([expect.objectContaining({ remoteOrigin: ORIGIN, userId: "u-ada" })]);
    });

    it("is asked about separately by a second project on the same server", async () => {
        await manager.push(PROJECT_A);
        await manager.push(PROJECT_B);
        expect(asker).toHaveBeenCalledTimes(2);
        expect(asker.mock.calls.map(call => call[0].projectPath)).toEqual([
            expect.stringMatching(/harbour$/),
            expect.stringMatching(/lantern$/),
        ]);
    });
});

describe("a project the author said does not use it", () => {
    beforeEach(async () => {
        asker.mockResolvedValueOnce(false);
        await manager.push(PROJECT_B).catch(() => undefined);
        lore.online.length = 0;
    });

    it("goes out as the author, never as the account", async () => {
        await manager.push(PROJECT_B);
        await manager.sync(PROJECT_B);
        await manager.getSyncState(PROJECT_B);
        expect(lore.online.map(call => call.identity)).toEqual([AUTHOR, AUTHOR, AUTHOR]);
    });

    it("is not asked again by a daily request", async () => {
        await manager.push(PROJECT_B);
        expect(asker).toHaveBeenCalledTimes(1);
    });

    it("does not get the stored token presented on its behalf", async () => {
        lore.missing.count = 1;
        await expect(manager.push(PROJECT_B)).rejects.toThrow(/No token stored/);
        expect(lore.signIns).toEqual([]);
    });

    it("is refused as not using the sign-in, rather than as a token nobody presented", async () => {
        lore.missing.count = 1;
        // The backend's sentence stays the message; the code is what the rail reads.
        await expect(manager.push(PROJECT_B)).rejects.toMatchObject({ code: "vcs/sign-in-unused" });
    });

    it("reads as not using the sign-in, with the sign-in on offer", async () => {
        await expect(manager.getServerSession(PROJECT_B)).resolves.toEqual({
            session: null,
            available: ADA,
            declined: true,
        });
    });

    it("leaves the other projects' answers alone", async () => {
        await manager.push(PROJECT_C);
        expect(lore.online).toEqual([{ verb: "push", identity: "u-ada" }]);
    });

    it("is asked again when the author asks from the project", async () => {
        const after = await manager.useServerSession(PROJECT_B);
        expect(asker).toHaveBeenCalledTimes(2);
        expect(after).toEqual({ session: ADA, available: null, declined: false });
        await manager.push(PROJECT_B);
        expect(lore.online.at(-1)).toEqual({ verb: "push", identity: "u-ada" });
    });
});

describe("the question itself", () => {
    it("records nothing for a window closed without an answer, and asks again next time", async () => {
        asker.mockResolvedValueOnce(null);
        await manager.push(PROJECT_A);
        expect(lore.online).toEqual([{ verb: "push", identity: AUTHOR }]);
        expect(uses()).toEqual([]);

        await manager.push(PROJECT_A);
        expect(asker).toHaveBeenCalledTimes(2);
    });

    it("is put once for requests that arrive while it is on screen", async () => {
        let answer!: (value: boolean) => void;
        asker.mockImplementationOnce(() => new Promise<boolean>(resolve => { answer = resolve; }));

        const first = manager.push(PROJECT_A);
        const second = manager.getSyncState(PROJECT_A);
        await vi.waitFor(() => expect(asker).toHaveBeenCalledTimes(1));
        answer(true);
        await Promise.all([first, second]);

        expect(asker).toHaveBeenCalledTimes(1);
        expect(lore.online.every(call => call.identity === "u-ada")).toBe(true);
    });

    it("is never put by a read", async () => {
        await expect(manager.getServerSession(PROJECT_A)).resolves.toEqual({
            session: null,
            available: ADA,
            declined: false,
        });
        expect(asker).not.toHaveBeenCalled();
    });

    it("is not put at all where nobody is there to answer it", async () => {
        const unattended = new VcsManager(upgradedApp());
        await unattended.push(PROJECT_A);
        expect(lore.online).toEqual([{ verb: "push", identity: AUTHOR }]);
        expect(uses()).toEqual([]);
    });

    it("is asked again when the sign-in at that server has become another account", async () => {
        await manager.push(PROJECT_A);
        const ben = { ...ADA, account: { ...ADA.account, userId: "u-ben", displayName: "Ben" } };
        state.set("versionControl.serverSessions", [ben]);

        await manager.push(PROJECT_A);
        expect(asker).toHaveBeenCalledTimes(2);
        expect(asker.mock.calls[1]![0].session.account.userId).toBe("u-ben");
    });

    it("is not put for an untrusted project, which is refused before anything is asked or sent", async () => {
        trusted = false;
        await expect(manager.push(PROJECT_A)).rejects.toMatchObject({ code: "vcs/project-distrusted" });
        await expect(manager.sync(PROJECT_A)).rejects.toMatchObject({ code: "vcs/project-distrusted" });
        await expect(manager.getSyncState(PROJECT_A)).rejects.toMatchObject({ code: "vcs/project-distrusted" });
        await expect(manager.useServerSession(PROJECT_A)).rejects.toMatchObject({ code: "vcs/project-distrusted" });
        expect(asker).not.toHaveBeenCalled();
        expect(lore.online).toEqual([]);
    });
});

describe("the name a version records", () => {
    it("is the account's only for a project that uses the sign-in", async () => {
        await manager.push(PROJECT_A);
        await expect(manager.getServerSession(PROJECT_A)).resolves.toMatchObject({ session: ADA });
        await expect(manager.getServerSession(PROJECT_B)).resolves.toMatchObject({ session: null });
    });
});

describe("signing out", () => {
    it("from a project stops that project using the sign-in, and nothing else", async () => {
        await manager.push(PROJECT_A);
        await manager.push(PROJECT_C);

        await manager.signOut(PROJECT_A);

        expect(lore.signOuts).toEqual([]);
        expect(state.get("versionControl.serverSessions")).toEqual([ADA]);
        await expect(manager.getServerSession(PROJECT_A)).resolves.toMatchObject({ session: null, declined: true });
        await expect(manager.getServerSession(PROJECT_C)).resolves.toMatchObject({ session: ADA });
    });

    it("from Settings takes the sign-in off the machine and every project's answer with it", async () => {
        await manager.push(PROJECT_A);
        await manager.push(PROJECT_C);

        await manager.forgetServer(ORIGIN);

        expect(lore.signOuts).toHaveLength(1);
        expect(uses()).toEqual([]);
        expect(manager.listServers()).toEqual([]);
    });
});

describe("listing sign-ins", () => {
    it("names the projects each one serves, the way the launcher names them", async () => {
        await manager.push(PROJECT_A);
        asker.mockResolvedValueOnce(false);
        await manager.push(PROJECT_B);

        const [listed] = manager.listServers();
        expect(listed!.usedBy).toEqual([expect.objectContaining({ name: "Harbour Lights" })]);
    });
});

describe("signing in from inside a project", () => {
    it("is that project's answer, so it uses the new sign-in without being asked", async () => {
        await manager.addServer({ authUrl: "", remoteUrl: "", token: "t", forProject: PROJECT_B });
        await manager.push(PROJECT_B);

        expect(asker).not.toHaveBeenCalled();
        expect(lore.online).toEqual([{ verb: "push", identity: "u-ada" }]);
    });

    it("from Settings or the launcher answers for no project", async () => {
        await manager.addServer({ authUrl: "", remoteUrl: "", token: "t" });
        expect(uses()).toEqual([]);
    });
});
