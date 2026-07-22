import fs from "fs/promises";
import os from "os";
import path from "path";
import { afterEach, describe, expect, it } from "vitest";
import { BufferZipOutput, writeZip, type ZipWriteEntry, type ZipWriteOptions } from "../../../buildWorker/mobile/zipWriter";
import { extractPluginZip } from "./pluginRegistryClient";

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
