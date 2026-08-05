import fs from "fs/promises";
import os from "os";
import path from "path";
import zlib from "zlib";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { precompressWebSite } from "./precompressWebSite";

let workDir: string;
let sourceDir: string;
let targetDir: string;

/** Compressible text, comfortably over the minimum-size floor. */
function text(size = 20_000): Buffer {
    return Buffer.from("the quick brown fox jumps over the lazy dog ".repeat(Math.ceil(size / 43)).slice(0, size));
}

/** Incompressible bytes, so a variant would be larger than the source. */
function noise(size = 20_000): Buffer {
    const bytes = Buffer.alloc(size);
    let state = 0x2545f491;
    for (let i = 0; i < size; i += 1) {
        state ^= state << 13;
        state ^= state >>> 17;
        state ^= state << 5;
        bytes[i] = state & 0xff;
    }
    return bytes;
}

async function write(relativePath: string, bytes: Buffer): Promise<void> {
    const target = path.join(sourceDir, ...relativePath.split("/"));
    await fs.mkdir(path.dirname(target), { recursive: true });
    await fs.writeFile(target, bytes);
}

beforeEach(async () => {
    workDir = await fs.mkdtemp(path.join(os.tmpdir(), "nls-precompress-"));
    sourceDir = path.join(workDir, "site");
    targetDir = path.join(workDir, "variants");
    await fs.mkdir(sourceDir, { recursive: true });
});

afterEach(async () => {
    await fs.rm(workDir, { recursive: true, force: true });
});

describe("precompressWebSite", () => {
    it("writes a .br and a .gz beside each text file, mirroring the layout", async () => {
        await write("renderer.js", text());
        await write("assets/story.json", text());

        const result = await precompressWebSite(sourceDir, targetDir);

        expect(result.files).toBe(2);
        for (const relativePath of ["renderer.js", path.join("assets", "story.json")]) {
            for (const suffix of [".br", ".gz"]) {
                await expect(fs.stat(path.join(targetDir, `${relativePath}${suffix}`))).resolves.toBeTruthy();
            }
        }
    });

    it("writes variants that decompress back to the original bytes", async () => {
        const source = text();
        await write("pack.json", source);

        await precompressWebSite(sourceDir, targetDir);

        expect(zlib.brotliDecompressSync(await fs.readFile(path.join(targetDir, "pack.json.br"))))
            .toEqual(source);
        expect(zlib.gunzipSync(await fs.readFile(path.join(targetDir, "pack.json.gz")))).toEqual(source);
    });

    it("leaves the source directory untouched", async () => {
        await write("renderer.js", text());

        await precompressWebSite(sourceDir, targetDir);

        expect(await fs.readdir(sourceDir)).toEqual(["renderer.js"]);
    });

    it("skips media, which is already entropy coded", async () => {
        await write("assets/sprite.webp", text());
        await write("assets/theme.mp3", text());
        await write("fonts/body.woff2", text());

        const result = await precompressWebSite(sourceDir, targetDir);

        expect(result.files).toBe(0);
        await expect(fs.stat(targetDir)).rejects.toThrow();
    });

    it("still compresses fonts that are not already compressed", async () => {
        await write("fonts/body.ttf", text());

        expect((await precompressWebSite(sourceDir, targetDir)).files).toBe(1);
    });

    it("skips files too small for a second request to pay for itself", async () => {
        await write("tiny.json", Buffer.from("{}"));

        expect((await precompressWebSite(sourceDir, targetDir)).files).toBe(0);
    });

    it("skips a variant that would not actually be smaller", async () => {
        // A .json full of base64 image data is the real-world shape of this.
        await write("blob.json", noise());

        const result = await precompressWebSite(sourceDir, targetDir);

        expect(result.files).toBe(0);
        expect(result.variantBytes).toBe(0);
    });

    it("reports the sizes it moved", async () => {
        const source = text();
        await write("renderer.js", source);

        const result = await precompressWebSite(sourceDir, targetDir);

        expect(result.sourceBytes).toBe(source.length);
        expect(result.variantBytes).toBeGreaterThan(0);
        expect(result.variantBytes).toBeLessThan(source.length);
    });

    it("handles a site with nothing compressible in it", async () => {
        await write("assets/sprite.webp", noise());

        await expect(precompressWebSite(sourceDir, targetDir)).resolves.toMatchObject({ files: 0 });
    });
});
