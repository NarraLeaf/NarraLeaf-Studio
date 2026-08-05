import { execFile } from "child_process";
import fs from "fs/promises";
import os from "os";
import path from "path";
import { promisify } from "util";
import { path7za } from "7zip-bin";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { packageWebSite } from "./packageWebSite";

const noopLog = vi.fn();

let workDir: string;
let sourceDir: string;
let outputDir: string;

beforeEach(async () => {
    workDir = await fs.mkdtemp(path.join(os.tmpdir(), "nls-web-pack-"));
    sourceDir = path.join(workDir, "site");
    outputDir = path.join(workDir, "out");
    await fs.mkdir(path.join(sourceDir, "assets"), { recursive: true });
    await fs.writeFile(path.join(sourceDir, "index.html"), "<!doctype html>", "utf-8");
    await fs.writeFile(path.join(sourceDir, "pack.json"), "{}", "utf-8");
    await fs.writeFile(path.join(sourceDir, "assets", "a.png"), Buffer.from([1, 2, 3]));
});

afterEach(async () => {
    await fs.rm(workDir, { recursive: true, force: true });
});

describe("packageWebSite", () => {
    it("copies the site for the dir format", async () => {
        const artifacts = await packageWebSite(
            { sourceDir, precompress: false, formats: ["dir"], dirName: "Game-1.0.0-web", zipName: "Game-1.0.0-web.zip" },
            outputDir,
            noopLog,
        );
        expect(artifacts).toEqual([path.join(outputDir, "Game-1.0.0-web")]);
        await expect(fs.readFile(path.join(outputDir, "Game-1.0.0-web", "index.html"), "utf-8"))
            .resolves.toBe("<!doctype html>");
        await expect(fs.stat(path.join(outputDir, "Game-1.0.0-web", "assets", "a.png"))).resolves.toBeTruthy();
    });

    it("zips the site with files at the archive root", async () => {
        const artifacts = await packageWebSite(
            { sourceDir, precompress: false, formats: ["zip"], dirName: "Game-1.0.0-web", zipName: "Game-1.0.0-web.zip" },
            outputDir,
            noopLog,
        );
        const zipPath = path.join(outputDir, "Game-1.0.0-web.zip");
        expect(artifacts).toEqual([zipPath]);
        const { stdout } = await promisify(execFile)(path7za, ["l", "-slt", zipPath]);
        // Entries must be root-relative (extract-and-upload), not nested under
        // the staging dir name or "./".
        expect(stdout).toContain("Path = index.html");
        expect(stdout).toContain(`Path = ${path.join("assets", "a.png")}`);
    });

    it("produces both formats in one run", async () => {
        const artifacts = await packageWebSite(
            { sourceDir, precompress: false, formats: ["zip", "dir"], dirName: "G-web", zipName: "G-web.zip" },
            outputDir,
            noopLog,
        );
        expect(artifacts).toHaveLength(2);
        for (const artifact of artifacts) {
            await expect(fs.stat(artifact)).resolves.toBeTruthy();
        }
    });

    describe("precompression", () => {
        beforeEach(async () => {
            const compressible = "the quick brown fox jumps over the lazy dog ".repeat(500);
            await fs.writeFile(path.join(sourceDir, "renderer.js"), compressible, "utf-8");
        });

        it("puts variants beside the site files in the copied directory", async () => {
            await packageWebSite(
                { sourceDir, precompress: true, formats: ["dir"], dirName: "G-web", zipName: "G-web.zip" },
                outputDir,
                noopLog,
            );
            const dir = path.join(outputDir, "G-web");
            await expect(fs.stat(path.join(dir, "renderer.js"))).resolves.toBeTruthy();
            await expect(fs.stat(path.join(dir, "renderer.js.br"))).resolves.toBeTruthy();
            await expect(fs.stat(path.join(dir, "renderer.js.gz"))).resolves.toBeTruthy();
        });

        it("merges variants into the zip rather than replacing its contents", async () => {
            const artifacts = await packageWebSite(
                { sourceDir, precompress: true, formats: ["zip"], dirName: "G-web", zipName: "G-web.zip" },
                outputDir,
                noopLog,
            );
            const { stdout } = await promisify(execFile)(path7za, ["l", "-slt", artifacts[0]]);
            // The uncompressed original must still be there; anchored so
            // "renderer.js.br" cannot satisfy the assertion for "renderer.js".
            expect(stdout).toMatch(/Path = renderer\.js\r?\n/);
            expect(stdout).toContain("Path = renderer.js.br");
            expect(stdout).toContain("Path = index.html");
        });

        it("never writes into the compiled site, which the mobile packages share", async () => {
            await packageWebSite(
                { sourceDir, precompress: true, formats: ["dir"], dirName: "G-web", zipName: "G-web.zip" },
                outputDir,
                noopLog,
            );
            expect((await fs.readdir(sourceDir)).sort())
                .toEqual(["assets", "index.html", "pack.json", "renderer.js"]);
        });

        it("writes nothing extra when the setting is off", async () => {
            await packageWebSite(
                { sourceDir, precompress: false, formats: ["dir"], dirName: "G-web", zipName: "G-web.zip" },
                outputDir,
                noopLog,
            );
            await expect(fs.stat(path.join(outputDir, "G-web", "renderer.js.br"))).rejects.toThrow();
        });
    });
});
