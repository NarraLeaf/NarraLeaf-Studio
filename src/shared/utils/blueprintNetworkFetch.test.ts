import { afterEach, describe, expect, it, vi } from "vitest";
import {
    BLUEPRINT_NETWORK_MAX_RESPONSE_BYTES,
    isBlueprintNetworkUrlAllowed,
    normalizeBlueprintNetworkHeaders,
    normalizeBlueprintNetworkTimeout,
    BLUEPRINT_NETWORK_DEFAULT_TIMEOUT_MS,
    BLUEPRINT_NETWORK_MAX_TIMEOUT_MS,
    type BlueprintNetworkFetchRequest,
} from "@shared/types/blueprint/network";
import { executeBlueprintNetworkFetch } from "./blueprintNetworkFetch";

/**
 * The Fetch node's request, at the layer where the refusals live.
 *
 * Two of these tests are the security-bearing ones and the rest is bookkeeping: a project with
 * Allow HTTP off must get nothing, and a scheme other than http(s) must get nothing. Both are
 * enforced here rather than by the renderer's CSP, because this code runs in a main process that
 * sits outside it.
 */

function request(overrides: Partial<BlueprintNetworkFetchRequest> = {}): BlueprintNetworkFetchRequest {
    return {
        url: "https://example.com/notice.json",
        method: "GET",
        headers: null,
        body: null,
        timeoutMs: 0,
        ...overrides,
    };
}

/** A `fetch` that must never be called. */
function forbiddenFetch() {
    return vi.fn(() => {
        throw new Error("fetch must not be reached");
    });
}

/** Params are declared so `mock.calls[0][1]` is typed as the init object the assertions read. */
function respondWith(body: string, init: { status?: number; headers?: Record<string, string> } = {}) {
    return vi.fn(async (_url: string, _init?: RequestInit) => new Response(body, {
        status: init.status ?? 200,
        headers: { "content-type": "application/json", ...init.headers },
    }));
}

afterEach(() => {
    vi.unstubAllGlobals();
});

describe("executeBlueprintNetworkFetch", () => {
    it("refuses every request when the project does not allow HTTP, without touching the network", async () => {
        const fetchSpy = forbiddenFetch();
        vi.stubGlobal("fetch", fetchSpy);

        const result = await executeBlueprintNetworkFetch(request(), { allowHttp: false });

        expect(result.outcome).toBe("networkError");
        expect(result.body).toBeNull();
        expect(fetchSpy).not.toHaveBeenCalled();
    });

    it.each([
        "file:///C:/Windows/win.ini",
        "nlgame://asset/secret",
        "app://fs/token",
        "data:text/plain,hi",
        "not a url at all",
    ])("refuses %s without touching the network", async url => {
        const fetchSpy = forbiddenFetch();
        vi.stubGlobal("fetch", fetchSpy);

        const result = await executeBlueprintNetworkFetch(request({ url }), { allowHttp: true });

        expect(result.outcome).toBe("networkError");
        expect(fetchSpy).not.toHaveBeenCalled();
    });

    it("returns the body and a success outcome on 2xx", async () => {
        vi.stubGlobal("fetch", respondWith('{"ok":true}'));

        const result = await executeBlueprintNetworkFetch(request(), { allowHttp: true });

        expect(result).toMatchObject({ outcome: "success", status: 200, body: '{"ok":true}', error: null });
    });

    it("keeps the body on a non-2xx response and reports httpError", async () => {
        // A REST API's 404 usually carries the JSON that says what was not found, and an author who
        // branches to httpError needs to be able to read it.
        vi.stubGlobal("fetch", respondWith('{"error":"no such id"}', { status: 404 }));

        const result = await executeBlueprintNetworkFetch(request(), { allowHttp: true });

        expect(result.outcome).toBe("httpError");
        expect(result.status).toBe(404);
        expect(result.body).toBe('{"error":"no such id"}');
    });

    it("refuses a response whose declared length is over the cap", async () => {
        vi.stubGlobal("fetch", respondWith("{}", {
            headers: { "content-length": String(BLUEPRINT_NETWORK_MAX_RESPONSE_BYTES + 1) },
        }));

        const result = await executeBlueprintNetworkFetch(request(), { allowHttp: true });

        expect(result.outcome).toBe("networkError");
        expect(result.body).toBeNull();
        expect(result.error).toContain("larger than");
    });

    it("sends no request body on a method that carries none", async () => {
        const fetchSpy = respondWith("{}");
        vi.stubGlobal("fetch", fetchSpy);

        await executeBlueprintNetworkFetch(
            request({ method: "GET", body: "ignored" }),
            { allowHttp: true },
        );

        expect(fetchSpy.mock.calls[0]?.[1]).toMatchObject({ body: undefined });
    });

    it("sends the request body on a method that carries one", async () => {
        const fetchSpy = respondWith("{}");
        vi.stubGlobal("fetch", fetchSpy);

        await executeBlueprintNetworkFetch(
            request({ method: "POST", body: '{"a":1}' }),
            { allowHttp: true },
        );

        expect(fetchSpy.mock.calls[0]?.[1]).toMatchObject({ body: '{"a":1}', credentials: "omit" });
    });

    it("reports a thrown request as a networkError rather than throwing", async () => {
        // The node's four execution pins are the author's only way to react, so nothing here may
        // escape as an exception.
        vi.stubGlobal("fetch", vi.fn(async () => {
            throw new Error("getaddrinfo ENOTFOUND example.com");
        }));

        const result = await executeBlueprintNetworkFetch(request(), { allowHttp: true });

        expect(result.outcome).toBe("networkError");
        expect(result.error).toContain("ENOTFOUND");
    });
});

describe("isBlueprintNetworkUrlAllowed", () => {
    it("allows http and https only", () => {
        expect(isBlueprintNetworkUrlAllowed("http://example.com")).toBe(true);
        expect(isBlueprintNetworkUrlAllowed("https://example.com")).toBe(true);
        expect(isBlueprintNetworkUrlAllowed("ftp://example.com")).toBe(false);
        expect(isBlueprintNetworkUrlAllowed("file:///etc/passwd")).toBe(false);
        expect(isBlueprintNetworkUrlAllowed("")).toBe(false);
    });
});

describe("normalizeBlueprintNetworkTimeout", () => {
    it("defaults when unset or nonsensical", () => {
        for (const value of [0, -1, Number.NaN, null, undefined]) {
            expect(normalizeBlueprintNetworkTimeout(value)).toBe(BLUEPRINT_NETWORK_DEFAULT_TIMEOUT_MS);
        }
    });

    it("caps a request that would leave the game waiting", () => {
        expect(normalizeBlueprintNetworkTimeout(BLUEPRINT_NETWORK_MAX_TIMEOUT_MS * 10))
            .toBe(BLUEPRINT_NETWORK_MAX_TIMEOUT_MS);
    });

    it("keeps a sensible value", () => {
        expect(normalizeBlueprintNetworkTimeout(2_500)).toBe(2_500);
    });
});

describe("normalizeBlueprintNetworkHeaders", () => {
    it("stringifies the scalars Make JSON Object can produce", () => {
        expect(normalizeBlueprintNetworkHeaders({ "X-Count": 3, "X-On": true, "X-Name": "a" }))
            .toEqual({ "X-Count": "3", "X-On": "true", "X-Name": "a" });
    });

    it("drops values no header could correctly become", () => {
        expect(normalizeBlueprintNetworkHeaders({ nested: { a: 1 }, list: [1], ok: "yes" }))
            .toEqual({ ok: "yes" });
    });

    it("reads nothing usable as no headers at all", () => {
        expect(normalizeBlueprintNetworkHeaders({})).toBeNull();
        expect(normalizeBlueprintNetworkHeaders(null)).toBeNull();
        expect(normalizeBlueprintNetworkHeaders([1, 2])).toBeNull();
        expect(normalizeBlueprintNetworkHeaders("Authorization: x")).toBeNull();
    });
});
