import fs from "fs/promises";
import os from "os";
import path from "path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PluginIconCache } from "./pluginIconCache";

/** A PNG header of the given dimensions - the icon checks are header-only. */
function png(width: number, height = width): Buffer {
    const be32 = (value: number) => [(value >>> 24) & 0xff, (value >>> 16) & 0xff, (value >>> 8) & 0xff, value & 0xff];
    return Buffer.from([
        0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
        0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52,
        ...be32(width), ...be32(height),
        8, 6, 0, 0, 0, 0, 0, 0, 0,
    ]);
}

const ICON_URL = "https://cdn.example.com/icon.png";

// `null` for no icon, not `undefined` - a default parameter would swallow that.
function indexJson(version: string, icon: string | null = ICON_URL) {
    return JSON.stringify({
        formatVersion: 1,
        repository: "https://example.com",
        plugins: [{
            id: "acme.demo",
            name: "Demo",
            version,
            ...(icon ? { icon } : {}),
            release: { tag: `acme.demo@${version}`, page: "https://example.com", download: "https://example.com/a.zip" },
        }],
    });
}

describe("PluginIconCache", () => {
    let userDataDir: string;
    let registryUrl: string;
    let fetchMock: ReturnType<typeof vi.fn>;
    let indexBody: string;
    let iconBytes: Buffer;

    beforeEach(async () => {
        userDataDir = await fs.mkdtemp(path.join(os.tmpdir(), "nls-icon-cache-"));
        // A URL per test: fetchRegistryIndex memoizes per URL for a minute, and a
        // shared address would let one test answer another's index request.
        registryUrl = `https://registry.example.com/${Math.random().toString(36).slice(2)}/index.json`;
        indexBody = indexJson("1.0.0");
        iconBytes = png(512);
        fetchMock = vi.fn(async (url: string) => (
            url === ICON_URL
                ? new Response(iconBytes, { status: 200 })
                : new Response(indexBody, { status: 200 })
        ));
        vi.stubGlobal("fetch", fetchMock);
    });

    afterEach(async () => {
        vi.unstubAllGlobals();
        await fs.rm(userDataDir, { recursive: true, force: true });
    });

    function cacheDirEntries(): Promise<string[]> {
        return fs.readdir(path.join(userDataDir, "plugin-icons")).catch(() => []);
    }

    it("fetches an icon once and serves every later call from disk", async () => {
        const cache = new PluginIconCache(userDataDir);

        const first = await cache.resolve(registryUrl, "acme.demo");
        expect(first).toMatch(/^data:image\/png;base64,/);
        expect(first).toContain(iconBytes.toString("base64"));

        const iconFetches = () => fetchMock.mock.calls.filter(call => call[0] === ICON_URL).length;
        expect(iconFetches()).toBe(1);

        // A second reader, so nothing in memory can be what answers.
        expect(await new PluginIconCache(userDataDir).resolve(registryUrl, "acme.demo")).toBe(first);
        expect(iconFetches()).toBe(1);
    });

    it("makes concurrent rows share one request", async () => {
        const cache = new PluginIconCache(userDataDir);

        const results = await Promise.all([
            cache.resolve(registryUrl, "acme.demo"),
            cache.resolve(registryUrl, "acme.demo"),
            cache.resolve(registryUrl, "acme.demo"),
        ]);

        expect(new Set(results).size).toBe(1);
        expect(fetchMock.mock.calls.filter(call => call[0] === ICON_URL).length).toBe(1);
    });

    it("re-fetches after an update and sweeps the old version", async () => {
        const cache = new PluginIconCache(userDataDir);
        await cache.resolve(registryUrl, "acme.demo");
        expect(await cacheDirEntries()).toEqual(["acme.demo%401.0.0.png"]);

        await cache.invalidate("acme.demo");
        expect(await cacheDirEntries()).toEqual([]);

        indexBody = indexJson("2.0.0");
        iconBytes = png(256);
        // The memo would otherwise still be serving 1.0.0 for the next minute.
        const fresh = new PluginIconCache(userDataDir);
        const updated = await fresh.resolve(`${registryUrl}?v=2`, "acme.demo");

        expect(updated).toContain(iconBytes.toString("base64"));
        expect(await cacheDirEntries()).toEqual(["acme.demo%402.0.0.png"]);
    });

    it("degrades to no icon when the registry's image breaks the rules", async () => {
        iconBytes = png(512, 256);
        const cache = new PluginIconCache(userDataDir);

        expect(await cache.resolve(registryUrl, "acme.demo")).toBeNull();
        expect(await cacheDirEntries()).toEqual([]);
        // Remembered, so a screen full of rows does not re-download it each time.
        expect(await cache.resolve(registryUrl, "acme.demo")).toBeNull();
        expect(fetchMock.mock.calls.filter(call => call[0] === ICON_URL).length).toBe(1);

        cache.clearFailures();
        expect(await cache.resolve(registryUrl, "acme.demo")).toBeNull();
        expect(fetchMock.mock.calls.filter(call => call[0] === ICON_URL).length).toBe(2);
    });

    it("asks for nothing when the entry has no icon, or is not listed", async () => {
        indexBody = indexJson("1.0.0", null);
        const cache = new PluginIconCache(userDataDir);

        expect(await cache.resolve(registryUrl, "acme.demo")).toBeNull();
        expect(await cache.resolve(registryUrl, "acme.missing")).toBeNull();
        expect(fetchMock.mock.calls.filter(call => call[0] === ICON_URL).length).toBe(0);
    });

    it("survives an unreachable icon without failing the row", async () => {
        fetchMock.mockImplementation(async (url: string) => (
            url === ICON_URL ? new Response("nope", { status: 502 }) : new Response(indexBody, { status: 200 })
        ));
        const cache = new PluginIconCache(userDataDir);

        expect(await cache.resolve(registryUrl, "acme.demo")).toBeNull();
        expect(await cacheDirEntries()).toEqual([]);
    });
});
