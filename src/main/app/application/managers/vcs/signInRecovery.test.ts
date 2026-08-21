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
        signIn: vi.fn(async () => ({ authUrl: "", remoteOrigin: "", account: {}, signedInAt: 0 })),
        backend: {
            releaseRepository: async () => undefined,
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
    } as unknown as BaseApp;
}

beforeEach(() => {
    lore.calls.length = 0;
    lore.missing.count = 0;
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
        expect(lore.calls).toEqual(["clone", "signIn", "clone"]);
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
        expect(lore.calls).toEqual(["clone", "signIn", "clone"]);
    });

    it("does not sign in for a server this installation has no session for", async () => {
        lore.missing.count = 1;

        await expect(new VcsManager(fakeApp([])).cloneRepository(REMOTE, DESTINATION))
            .rejects.toThrow(/No token stored/);
        expect(lore.calls).toEqual(["clone"]);
    });

    it("does not sign in where the token cannot be unsealed on this machine", async () => {
        lore.missing.count = 1;
        token.value = null;

        await expect(new VcsManager(fakeApp()).cloneRepository(REMOTE, DESTINATION))
            .rejects.toThrow(/No token stored/);
        expect(lore.calls).toEqual(["clone"]);
    });

    it("reports a sign-in that was itself refused as the failure the caller already had", async () => {
        lore.missing.count = 1;
        lore.signIn.mockRejectedValue(new Error("This token has expired"));

        await expect(new VcsManager(fakeApp()).cloneRepository(REMOTE, DESTINATION))
            // The clone's own sentence, not the sign-in's: what the author asked for was a
            // copy, and the recovery attempt is not a thing they know happened.
            .rejects.toThrow(/No token stored/);
        expect(lore.calls).toEqual(["clone", "signIn"]);
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
            expect(lore.calls).toEqual(["clone"]);
        } finally {
            backend.cloneInto = original;
        }
    });
});
