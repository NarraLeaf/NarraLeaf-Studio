import http from "http";

import { describe, expect, it } from "vitest";

import { signInWithBrowser, tokenExpiry } from "./serverOAuth";

/**
 * The loopback half of the browser sign-in: what Studio opens, and what it accepts back.
 * The browser is played by `openExternal`, which follows the redirect the way a real
 * approval page would.
 */
function follow(build: (authorize: URL) => string): (url: string) => Promise<void> {
    return async (url: string) => {
        const authorize = new URL(url);
        const target = build(authorize);
        await new Promise<void>((resolve) => {
            http.get(target, (response) => {
                response.resume();
                response.on("end", () => resolve());
            });
        });
    };
}

/** An address nothing listens on, so the redeem step reports `unreachable` rather than hanging. */
const NOWHERE = "https://127.0.0.1:9";

describe("the browser sign-in", () => {
    it("asks for a code with PKCE, a loopback redirect by IP, and this device's name", async () => {
        let opened: URL | undefined;
        const result = await signInWithBrowser({
            authUrl: NOWHERE,
            deviceName: "the studio iMac",
            userDataDir: "/tmp",
            openExternal: follow((authorize) => {
                opened = authorize;
                const back = new URL(authorize.searchParams.get("redirect_uri")!);
                back.searchParams.set("code", "a-code");
                back.searchParams.set("state", authorize.searchParams.get("state")!);
                return back.toString();
            }),
        });

        expect(opened?.pathname).toBe("/oauth/authorize");
        expect(opened?.searchParams.get("client_id")).toBe("narraleaf-studio");
        expect(opened?.searchParams.get("code_challenge_method")).toBe("S256");
        expect(opened?.searchParams.get("redirect_uri")).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/callback$/);
        expect(opened?.searchParams.get("device_name")).toBe("the studio iMac");
        // The code arrived; redeeming it is what failed, against an address that is not there.
        expect(result).toEqual({ ok: false, reason: "unreachable" });
    });

    it("reports a denial on the approval page as one", async () => {
        const result = await signInWithBrowser({
            authUrl: NOWHERE,
            deviceName: "x",
            userDataDir: "/tmp",
            openExternal: follow((authorize) => {
                const back = new URL(authorize.searchParams.get("redirect_uri")!);
                back.searchParams.set("error", "access_denied");
                back.searchParams.set("state", authorize.searchParams.get("state")!);
                return back.toString();
            }),
        });
        expect(result).toEqual({ ok: false, reason: "denied" });
    });

    it("ignores a redirect that does not carry this sign-in's state, and gives up when cancelled", async () => {
        const controller = new AbortController();
        const result = await signInWithBrowser({
            authUrl: NOWHERE,
            deviceName: "x",
            userDataDir: "/tmp",
            signal: controller.signal,
            openExternal: follow((authorize) => {
                const back = new URL(authorize.searchParams.get("redirect_uri")!);
                back.searchParams.set("code", "stolen");
                back.searchParams.set("state", "not-the-state");
                setTimeout(() => controller.abort(), 50);
                return back.toString();
            }),
        });
        expect(result).toEqual({ ok: false, reason: "timeout" });
    });
});

describe("a token's expiry", () => {
    it("is read from its exp, without verifying it", () => {
        const payload = Buffer.from(JSON.stringify({ exp: 1_800_000_000 })).toString("base64url");
        expect(tokenExpiry(`h.${payload}.s`)).toBe(1_800_000_000_000);
        expect(tokenExpiry("not a token")).toBeNull();
    });
});
