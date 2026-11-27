import { beforeEach, describe, expect, it, vi } from "vitest";
import type { BaseApp } from "../../baseApp";
import type { VcsServerSession } from "@shared/types/vcs";
import { VcsManager } from "./VcsManager";

/**
 * Renewing a browser sign-in, and who is told when it worked.
 *
 * Measured on a real machine before these: a sign-in made in the browser lapsed a day later with
 * nothing in the log, because the renewal was never started - and a renewal that did work would
 * not have reached the Team session, which went on presenting the token the server had refused.
 * What these pin is the part a person never sees: that a failed renewal says so, and that a
 * replaced token is handed on.
 */

const oauth = vi.hoisted(() => ({
    answer: { value: { ok: true, token: "the-new-token", refreshToken: "the-next-refresh" } as Record<string, unknown> },
    asked: [] as unknown[],
}));

vi.mock("./serverOAuth", async importOriginal => ({
    ...(await importOriginal<Record<string, unknown>>()),
    refreshWithServer: async (input: unknown) => {
        oauth.asked.push(input);
        return oauth.answer.value;
    },
}));

const tokens = vi.hoisted(() => ({
    stored: new Map<string, string>(),
    refresh: new Map<string, string>(),
}));

// Sealed by the OS keyring, which a test does not have.
vi.mock("./serverTokens", async importOriginal => ({
    ...(await importOriginal<Record<string, unknown>>()),
    recallServerToken: (_state: unknown, origin: string) => tokens.stored.get(origin) ?? null,
    rememberServerToken: (_state: unknown, origin: string, token: string) => {
        tokens.stored.set(origin, token);
        return true;
    },
    recallServerRefreshToken: (_state: unknown, origin: string) => tokens.refresh.get(origin) ?? null,
    rememberServerRefreshToken: (_state: unknown, origin: string, token: string) => {
        tokens.refresh.set(origin, token);
        return true;
    },
    forgetServerRefreshToken: (_state: unknown, origin: string) => {
        tokens.refresh.delete(origin);
    },
}));

vi.mock("./backend", () => ({
    requireVcsBackend: async () => ({ signInToServer: async () => undefined }),
    getVcsAvailability: async () => ({ available: true }),
}));

const ORIGIN = "lore://team.example.lan:41337";

const ADA: VcsServerSession = {
    authUrl: "https://team.example.lan:54080",
    remoteOrigin: ORIGIN,
    account: {
        userId: "u-ada",
        displayName: "Ada",
        username: "ada",
        email: "",
        identity: "Ada",
        expiresAt: 0,
    },
    signedInAt: 0,
};

let warnings: string[];
let told: string[];
let manager: VcsManager;

beforeEach(() => {
    warnings = [];
    told = [];
    oauth.asked.length = 0;
    oauth.answer.value = { ok: true, token: "the-new-token", refreshToken: "the-next-refresh" };
    tokens.stored = new Map([[ORIGIN, "the-old-token"]]);
    tokens.refresh = new Map([[ORIGIN, "a-refresh-token"]]);
    const state = new Map<string, unknown>([["versionControl.serverSessions", [ADA]]]);
    const app = {
        logger: {
            info: () => undefined,
            debug: () => undefined,
            error: () => undefined,
            warn: (...parts: unknown[]) => warnings.push(parts.join(" ")),
        },
        getGlobalState: () => ({
            get: (key: string) => state.get(key),
            set: (key: string, value: unknown) => {
                state.set(key, value);
            },
        }),
        getUserDataDir: () => "/tmp/userdata",
    } as unknown as BaseApp;
    manager = new VcsManager(app, undefined, undefined, undefined, (origin) => told.push(origin));
});

describe("renewing a browser sign-in", () => {
    it("keeps the new pair and tells whoever holds a session with that server", async () => {
        await manager.renewServerTokens();

        expect(oauth.asked).toHaveLength(1);
        expect(tokens.stored.get(ORIGIN)).toBe("the-new-token");
        expect(tokens.refresh.get(ORIGIN)).toBe("the-next-refresh");
        expect(told).toEqual([ORIGIN]);
    });

    it("says so when the server could not be reached, and keeps the refresh token for next time", async () => {
        oauth.answer.value = { ok: false, reason: "unreachable" };
        await manager.renewServerTokens();

        expect(warnings.some((line) => line.includes("Could not renew") && line.includes("unreachable"))).toBe(true);
        expect(tokens.refresh.get(ORIGIN)).toBe("a-refresh-token");
        expect(told).toEqual([]);
    });

    it("drops the refresh token the server refused, and says that instead", async () => {
        oauth.answer.value = { ok: false, reason: "refused" };
        await manager.renewServerTokens();

        expect(warnings.some((line) => line.includes("was ended by the server"))).toBe(true);
        expect(tokens.refresh.has(ORIGIN)).toBe(false);
        expect(told).toEqual([]);
    });
});
