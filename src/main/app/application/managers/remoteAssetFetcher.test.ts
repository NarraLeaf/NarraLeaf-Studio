import { afterEach, describe, expect, it, vi } from "vitest";
import { REMOTE_ASSET_MAX_BYTES } from "@shared/constants/remoteAsset";
import { fetchRemoteAsset, parseRemoteAssetUrl } from "./remoteAssetFetcher";

/**
 * The fetcher is a boundary, so these are boundary tests: what it refuses, what it asks for, and
 * what it hands back. It exists in main precisely so a renderer cannot make this request itself.
 */

const originalFetch = globalThis.fetch;

afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
});

function respondWith(body: Uint8Array | null, init: { status?: number; headers?: Record<string, string> } = {}) {
    const fetchMock = vi.fn(async (_url: string, _init: { headers: Record<string, string> }) =>
        new Response(body as BodyInit | null, {
            status: init.status ?? 200,
            headers: init.headers,
        }));
    globalThis.fetch = fetchMock as unknown as typeof globalThis.fetch;
    return fetchMock;
}

describe("parseRemoteAssetUrl", () => {
    it("accepts http and https", () => {
        expect(parseRemoteAssetUrl("https://example.test/a.png").protocol).toBe("https:");
        expect(parseRemoteAssetUrl("http://example.test/a.png").protocol).toBe("http:");
    });

    it.each([
        "file:///C:/secrets/passwords.txt",
        "data:image/png;base64,AAAA",
        "javascript:alert(1)",
        "not a url at all",
    ])("refuses %s", (url) => {
        expect(() => parseRemoteAssetUrl(url)).toThrow();
    });
});

describe("fetchRemoteAsset", () => {
    it("refuses a disallowed scheme before making any request", async () => {
        const fetchMock = respondWith(new Uint8Array([1, 2, 3]));

        await expect(fetchRemoteAsset("file:///C:/secrets/passwords.txt")).rejects.toThrow();
        expect(fetchMock).not.toHaveBeenCalled();
    });

    it("returns the bytes and the server's validators", async () => {
        respondWith(new Uint8Array([0x89, 0x50, 0x4e, 0x47]), {
            headers: {
                etag: '"v1"',
                "last-modified": "Wed, 05 Aug 2026 00:00:00 GMT",
                "content-type": "image/png",
            },
        });

        const result = await fetchRemoteAsset("https://example.test/a.png");

        expect(result.kind).toBe("ok");
        if (result.kind !== "ok") return;
        expect(Array.from(result.bytes)).toEqual([0x89, 0x50, 0x4e, 0x47]);
        expect(result.etag).toBe('"v1"');
        expect(result.lastModified).toBe("Wed, 05 Aug 2026 00:00:00 GMT");
        expect(result.contentType).toBe("image/png");
    });

    it("sends the caller's validators as a conditional request", async () => {
        const fetchMock = respondWith(null, { status: 304 });

        const result = await fetchRemoteAsset("https://example.test/a.png", {
            etag: '"v1"',
            lastModified: "Wed, 05 Aug 2026 00:00:00 GMT",
        });

        expect(result).toEqual({ kind: "not-modified" });
        const headers = fetchMock.mock.calls[0][1].headers;
        expect(headers["if-none-match"]).toBe('"v1"');
        expect(headers["if-modified-since"]).toBe("Wed, 05 Aug 2026 00:00:00 GMT");
    });

    it("sends no conditional headers when the caller has no validators", async () => {
        const fetchMock = respondWith(new Uint8Array([1]));

        await fetchRemoteAsset("https://example.test/a.png");

        expect(fetchMock.mock.calls[0][1].headers).toEqual({});
    });

    it("refuses a body the server declares as over the ceiling, without reading it", async () => {
        // The declared length is what lets an oversized download be refused before it is in memory.
        respondWith(new Uint8Array([1]), {
            headers: { "content-length": String(REMOTE_ASSET_MAX_BYTES + 1) },
        });

        await expect(fetchRemoteAsset("https://example.test/huge.bin")).rejects.toThrow(/limit/);
    });

    it("reports a failing status rather than treating the error page as content", async () => {
        respondWith(new Uint8Array([1]), { status: 404 });

        await expect(fetchRemoteAsset("https://example.test/gone.png")).rejects.toThrow(/404/);
    });
});
