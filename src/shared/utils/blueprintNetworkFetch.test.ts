import { afterEach, describe, expect, it, vi } from "vitest";
import {
  BLUEPRINT_NETWORK_MAX_RESPONSE_BYTES,
  isBlueprintNetworkUrlAllowed,
  normalizeBlueprintNetworkHeaders,
  normalizeBlueprintNetworkTimeout,
  BLUEPRINT_NETWORK_DEFAULT_TIMEOUT_MS,
  BLUEPRINT_NETWORK_MAX_TIMEOUT_MS,
  type BlueprintNetworkFetchRequest
} from "@shared/types/blueprint/network";
import type { NetworkAllowlist } from "@shared/types/networkAllowlist";
import { executeBlueprintNetworkFetch } from "./blueprintNetworkFetch";

/**
 * The Fetch node's request, at the layer where the refusals live.
 *
 * Two of these tests are the security-bearing ones and the rest is bookkeeping: a project with
 * Allow HTTP off must get nothing, and a scheme other than http(s) must get nothing. Both are
 * enforced here rather than by the renderer's CSP, because this code runs in a main process that
 * sits outside it.
 */

function request(
  overrides: Partial<BlueprintNetworkFetchRequest> = {}
): BlueprintNetworkFetchRequest {
  return {
    url: "https://example.com/notice.json",
    method: "GET",
    headers: null,
    body: null,
    timeoutMs: 0,
    ...overrides
  };
}

/** A `fetch` that must never be called. */
function forbiddenFetch() {
  return vi.fn(() => {
    throw new Error("fetch must not be reached");
  });
}

/** Params are declared so `mock.calls[0][1]` is typed as the init object the assertions read. */
function respondWith(
  body: string,
  init: { status?: number; headers?: Record<string, string> } = {}
) {
  return vi.fn(
    async (_url: string, _init?: RequestInit) =>
      new Response(body, {
        status: init.status ?? 200,
        headers: { "content-type": "application/json", ...init.headers }
      })
  );
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("executeBlueprintNetworkFetch", () => {
  it("refuses every request when the project does not allow HTTP, without touching the network", async () => {
    const fetchSpy = forbiddenFetch();
    vi.stubGlobal("fetch", fetchSpy);

    const result = await executeBlueprintNetworkFetch(request(), {
      allowHttp: false,
      redirects: "check"
    });

    expect(result.outcome).toBe("networkError");
    expect(result.body).toBeNull();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it.each([
    "file:///C:/Windows/win.ini",
    "nlgame://asset/secret",
    "app://fs/token",
    "data:text/plain,hi",
    "not a url at all"
  ])("refuses %s without touching the network", async (url) => {
    const fetchSpy = forbiddenFetch();
    vi.stubGlobal("fetch", fetchSpy);

    const result = await executeBlueprintNetworkFetch(request({ url }), {
      allowHttp: true,
      redirects: "check"
    });

    expect(result.outcome).toBe("networkError");
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("returns the body and a success outcome on 2xx", async () => {
    vi.stubGlobal("fetch", respondWith('{"ok":true}'));

    const result = await executeBlueprintNetworkFetch(request(), {
      allowHttp: true,
      redirects: "check"
    });

    expect(result).toMatchObject({
      outcome: "success",
      status: 200,
      body: '{"ok":true}',
      error: null
    });
  });

  it("keeps the body on a non-2xx response and reports httpError", async () => {
    // A REST API's 404 usually carries the JSON that says what was not found, and an author who
    // branches to httpError needs to be able to read it.
    vi.stubGlobal("fetch", respondWith('{"error":"no such id"}', { status: 404 }));

    const result = await executeBlueprintNetworkFetch(request(), {
      allowHttp: true,
      redirects: "check"
    });

    expect(result.outcome).toBe("httpError");
    expect(result.status).toBe(404);
    expect(result.body).toBe('{"error":"no such id"}');
  });

  it("refuses a response whose declared length is over the cap", async () => {
    vi.stubGlobal(
      "fetch",
      respondWith("{}", {
        headers: { "content-length": String(BLUEPRINT_NETWORK_MAX_RESPONSE_BYTES + 1) }
      })
    );

    const result = await executeBlueprintNetworkFetch(request(), {
      allowHttp: true,
      redirects: "check"
    });

    expect(result.outcome).toBe("networkError");
    expect(result.body).toBeNull();
    expect(result.error).toContain("larger than");
  });

  it("sends no request body on a method that carries none", async () => {
    const fetchSpy = respondWith("{}");
    vi.stubGlobal("fetch", fetchSpy);

    await executeBlueprintNetworkFetch(request({ method: "GET", body: "ignored" }), {
      allowHttp: true,
      redirects: "check"
    });

    expect(fetchSpy.mock.calls[0]?.[1]).toMatchObject({ body: undefined });
  });

  it("sends the request body on a method that carries one", async () => {
    const fetchSpy = respondWith("{}");
    vi.stubGlobal("fetch", fetchSpy);

    await executeBlueprintNetworkFetch(request({ method: "POST", body: '{"a":1}' }), {
      allowHttp: true,
      redirects: "check"
    });

    expect(fetchSpy.mock.calls[0]?.[1]).toMatchObject({ body: '{"a":1}', credentials: "omit" });
  });

  it("reports a thrown request as a networkError rather than throwing", async () => {
    // The node's four execution pins are the author's only way to react, so nothing here may
    // escape as an exception.
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error("getaddrinfo ENOTFOUND example.com");
      })
    );

    const result = await executeBlueprintNetworkFetch(request(), {
      allowHttp: true,
      redirects: "check"
    });

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
    expect(normalizeBlueprintNetworkTimeout(BLUEPRINT_NETWORK_MAX_TIMEOUT_MS * 10)).toBe(
      BLUEPRINT_NETWORK_MAX_TIMEOUT_MS
    );
  });

  it("keeps a sensible value", () => {
    expect(normalizeBlueprintNetworkTimeout(2_500)).toBe(2_500);
  });
});

describe("normalizeBlueprintNetworkHeaders", () => {
  it("stringifies the scalars Make JSON Object can produce", () => {
    expect(normalizeBlueprintNetworkHeaders({ "X-Count": 3, "X-On": true, "X-Name": "a" })).toEqual(
      { "X-Count": "3", "X-On": "true", "X-Name": "a" }
    );
  });

  it("drops values no header could correctly become", () => {
    expect(normalizeBlueprintNetworkHeaders({ nested: { a: 1 }, list: [1], ok: "yes" })).toEqual({
      ok: "yes"
    });
  });

  it("reads nothing usable as no headers at all", () => {
    expect(normalizeBlueprintNetworkHeaders({})).toBeNull();
    expect(normalizeBlueprintNetworkHeaders(null)).toBeNull();
    expect(normalizeBlueprintNetworkHeaders([1, 2])).toBeNull();
    expect(normalizeBlueprintNetworkHeaders("Authorization: x")).toBeNull();
  });
});

/**
 * The allowlist, and the redirect.
 *
 * These belong together because they are one defect apart: a list checked once, before the request,
 * governs the address the author wrote and nothing else - and `302` is how an endpoint says "the
 * bytes are somewhere else". A check that stops at hop zero is a check on a string, not on where
 * the game connected.
 */

const LISTED: NetworkAllowlist = {
  policy: "allowlist",
  entries: ["https://api.example.com/*"]
};

const REDIRECT_STATUSES = [301, 302, 303, 307, 308];

/** Answers each URL from a table, so a redirect chain can be written out literally. */
function respondByUrl(
  table: Record<string, { status?: number; location?: string; body?: string }>
) {
  return vi.fn(async (url: string, _init?: RequestInit) => {
    const entry = table[url];
    if (!entry) {
      throw new Error(`unexpected request to ${url}`);
    }
    const redirecting = entry.status !== undefined && REDIRECT_STATUSES.includes(entry.status);
    return new Response(redirecting ? null : (entry.body ?? "{}"), {
      status: entry.status ?? 200,
      headers: {
        "content-type": "application/json",
        ...(entry.location ? { location: entry.location } : {})
      }
    });
  });
}

describe("the network allowlist", () => {
  it("refuses an unlisted address without touching the network", async () => {
    const fetchSpy = forbiddenFetch();
    vi.stubGlobal("fetch", fetchSpy);

    const result = await executeBlueprintNetworkFetch(
      request({ url: "https://elsewhere.test/x" }),
      { allowHttp: true, allowlist: LISTED, redirects: "check" }
    );

    expect(result.outcome).toBe("networkError");
    expect(result.error).toContain("allowlist");
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("lets a listed address through", async () => {
    const fetchSpy = respondWith('{"ok":true}');
    vi.stubGlobal("fetch", fetchSpy);

    const result = await executeBlueprintNetworkFetch(
      request({ url: "https://api.example.com/v1/notice" }),
      { allowHttp: true, allowlist: LISTED, redirects: "check" }
    );

    expect(result.outcome).toBe("success");
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it("checks the address a redirect points at, not only the one that was written", async () => {
    const fetchSpy = respondByUrl({
      "https://api.example.com/v1/notice": { status: 302, location: "https://elsewhere.test/x" }
    });
    vi.stubGlobal("fetch", fetchSpy);

    const result = await executeBlueprintNetworkFetch(
      request({ url: "https://api.example.com/v1/notice" }),
      { allowHttp: true, allowlist: LISTED, redirects: "check" }
    );

    expect(result.outcome).toBe("networkError");
    expect(result.error).toContain("https://elsewhere.test/x");
    // The second hop was decided before it was issued, so it never left.
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it("follows a redirect that stays on the list", async () => {
    const fetchSpy = respondByUrl({
      "https://api.example.com/v1/notice": { status: 302, location: "/v2/notice" },
      "https://api.example.com/v2/notice": { body: '{"ok":true}' }
    });
    vi.stubGlobal("fetch", fetchSpy);

    const result = await executeBlueprintNetworkFetch(
      request({ url: "https://api.example.com/v1/notice" }),
      { allowHttp: true, allowlist: LISTED, redirects: "check" }
    );

    expect(result.outcome).toBe("success");
    expect(result.body).toBe('{"ok":true}');
    expect(fetchSpy).toHaveBeenCalledTimes(2);
  });

  it("refuses a redirect into a scheme that cannot be fetched", async () => {
    const fetchSpy = respondByUrl({
      "https://api.example.com/v1/notice": { status: 302, location: "file:///C:/secrets.txt" }
    });
    vi.stubGlobal("fetch", fetchSpy);

    const result = await executeBlueprintNetworkFetch(
      request({ url: "https://api.example.com/v1/notice" }),
      { allowHttp: true, allowlist: LISTED, redirects: "check" }
    );

    expect(result.outcome).toBe("networkError");
    expect(result.error).toContain("scheme");
  });

  it("gives up on a chain that never lands", async () => {
    const fetchSpy = vi.fn(
      async (url: string, _init?: RequestInit) =>
        new Response(null, {
          status: 302,
          headers: { location: `${url}/again` }
        })
    );
    vi.stubGlobal("fetch", fetchSpy);

    const result = await executeBlueprintNetworkFetch(
      request({ url: "https://api.example.com/loop" }),
      { allowHttp: true, allowlist: LISTED, redirects: "check" }
    );

    expect(result.outcome).toBe("networkError");
    expect(result.error).toContain("Too many redirects");
  });

  it("turns a redirected POST into a GET without a body, the way a browser does", async () => {
    const fetchSpy = respondByUrl({
      "https://api.example.com/submit": { status: 302, location: "https://api.example.com/done" },
      "https://api.example.com/done": { body: "{}" }
    });
    vi.stubGlobal("fetch", fetchSpy);

    await executeBlueprintNetworkFetch(
      request({ url: "https://api.example.com/submit", method: "POST", body: "payload" }),
      { allowHttp: true, allowlist: LISTED, redirects: "check" }
    );

    expect(fetchSpy.mock.calls[0][1]?.method).toBe("POST");
    expect(fetchSpy.mock.calls[0][1]?.body).toBe("payload");
    expect(fetchSpy.mock.calls[1][1]?.method).toBe("GET");
    expect(fetchSpy.mock.calls[1][1]?.body).toBeUndefined();
  });

  it("keeps the method and the body across a 307", async () => {
    const fetchSpy = respondByUrl({
      "https://api.example.com/submit": { status: 307, location: "https://api.example.com/done" },
      "https://api.example.com/done": { body: "{}" }
    });
    vi.stubGlobal("fetch", fetchSpy);

    await executeBlueprintNetworkFetch(
      request({ url: "https://api.example.com/submit", method: "POST", body: "payload" }),
      { allowHttp: true, allowlist: LISTED, redirects: "check" }
    );

    expect(fetchSpy.mock.calls[1][1]?.method).toBe("POST");
    expect(fetchSpy.mock.calls[1][1]?.body).toBe("payload");
  });

  it("hands redirects to the platform when the shell cannot police them itself", async () => {
    const fetchSpy = respondWith('{"ok":true}');
    vi.stubGlobal("fetch", fetchSpy);

    const result = await executeBlueprintNetworkFetch(
      request({ url: "https://api.example.com/v1/notice" }),
      { allowHttp: true, allowlist: LISTED, redirects: "delegate" }
    );

    expect(result.outcome).toBe("success");
    expect(fetchSpy.mock.calls[0][1]?.redirect).toBe("follow");
  });

  it("still decides the first address in the delegating shell", async () => {
    const fetchSpy = forbiddenFetch();
    vi.stubGlobal("fetch", fetchSpy);

    const result = await executeBlueprintNetworkFetch(
      request({ url: "https://elsewhere.test/x" }),
      { allowHttp: true, allowlist: LISTED, redirects: "delegate" }
    );

    expect(result.outcome).toBe("networkError");
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
