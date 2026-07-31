import fs from "fs/promises";
import os from "os";
import path from "path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { BufferZipOutput, writeZip, type ZipWriteEntry, type ZipWriteOptions } from "../../../buildWorker/mobile/zipWriter";
import { extractPluginZip, fetchRegistryIndex } from "./pluginRegistryClient";

const OPTIONS: ZipWriteOptions = { mtime: new Date(Date.UTC(2020, 0, 1, 12, 0, 0)), allowZip64: false };

async function zipOf(entries: ZipWriteEntry[]): Promise<Buffer> {
    const output = new BufferZipOutput();
    await writeZip(output, entries, OPTIONS);
    return output.toBuffer();
}

function fileEntry(name: string, content: string): ZipWriteEntry {
    return { name, source: { kind: "buffer", data: Buffer.from(content) }, method: "deflate" };
}

const tempDirs: string[] = [];
async function freshTempDir(): Promise<string> {
    const dir = path.join(os.tmpdir(), `nls-registry-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    tempDirs.push(dir);
    return dir;
}

afterEach(async () => {
    while (tempDirs.length) {
        await fs.rm(tempDirs.pop()!, { recursive: true, force: true });
    }
});

describe("extractPluginZip", () => {
    it("unpacks a nested plugin package and returns the manifest directory", async () => {
        const buffer = await zipOf([
            fileEntry("acme.demo/manifest.json", "{\"id\":\"acme.demo\"}"),
            fileEntry("acme.demo/main.js", "export default {}"),
        ]);
        const dest = await freshTempDir();

        const manifestDir = await extractPluginZip(buffer, dest);

        expect(path.basename(manifestDir)).toBe("acme.demo");
        expect(await fs.readFile(path.join(manifestDir, "manifest.json"), "utf-8")).toBe("{\"id\":\"acme.demo\"}");
        expect(await fs.readFile(path.join(manifestDir, "main.js"), "utf-8")).toBe("export default {}");
    });

    it("rejects an entry that escapes the extract directory (zip-slip)", async () => {
        // The safe writer refuses traversal names, so build with a same-length
        // placeholder ("PH/") and patch the bytes to "../". Equal length keeps the
        // local + central header offsets valid; the entry name is not part of any CRC.
        const built = await zipOf([
            fileEntry("acme.demo/manifest.json", "{}"),
            fileEntry("PH/escape.txt", "pwned"),
        ]);
        const buffer = Buffer.from(built.toString("latin1").replaceAll("PH/escape.txt", "../escape.txt"), "latin1");
        const dest = await freshTempDir();

        await expect(extractPluginZip(buffer, dest)).rejects.toThrow(/escapes the extract directory/);
    });

    it("throws when the package has no manifest.json", async () => {
        const buffer = await zipOf([fileEntry("acme.demo/readme.md", "hi")]);
        const dest = await freshTempDir();

        await expect(extractPluginZip(buffer, dest)).rejects.toThrow(/manifest\.json/);
    });
});

describe("fetchRegistryIndex icons", () => {
    /** One index entry with the fields normalization refuses to work without. */
    function entry(overrides: Record<string, unknown>) {
        return {
            id: "acme.demo",
            name: "Demo",
            version: "1.0.0",
            release: { tag: "acme.demo@1.0.0", page: "https://example.com", download: "https://example.com/a.zip" },
            ...overrides,
        };
    }

    async function indexWith(entries: unknown[]) {
        const body = JSON.stringify({ formatVersion: 1, repository: "https://example.com", plugins: entries });
        const fetchMock = vi.fn(async () => new Response(body, { status: 200 }));
        vi.stubGlobal("fetch", fetchMock);
        try {
            return await fetchRegistryIndex("https://example.com/index.json");
        } finally {
            vi.unstubAllGlobals();
        }
    }

    it("keeps an https icon", async () => {
        const index = await indexWith([entry({ icon: "https://cdn.example.com/icon.png" })]);
        expect(index.plugins[0].icon).toBe("https://cdn.example.com/icon.png");
    });

    it("drops an icon the renderer must never be handed", async () => {
        // The store puts this straight into an <img src>, so anything that is not
        // https - a local file, an inline payload, a script URL - is dropped here
        // rather than trusted to fail politely in the renderer.
        for (const icon of [
            "file:///C:/Windows/System32/drivers/etc/hosts",
            "data:image/svg+xml;base64,PHN2Zy8+",
            "javascript:alert(1)",
            "http://cdn.example.com/icon.png",
            "not a url",
            42,
        ]) {
            const index = await indexWith([entry({ icon })]);
            expect(index.plugins[0].icon, String(icon)).toBeUndefined();
        }
    });

    it("leaves icon absent when the entry declares none", async () => {
        const index = await indexWith([entry({})]);
        expect(index.plugins[0].icon).toBeUndefined();
    });
});
