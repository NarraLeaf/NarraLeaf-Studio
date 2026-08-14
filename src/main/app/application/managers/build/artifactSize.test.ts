import fs from "fs/promises";
import os from "os";
import path from "path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createTranslator } from "@shared/i18n";
import { Fs } from "@shared/utils/fs";
import { formatArtifactSizeReport, measureBuildArtifacts } from "./artifactSize";

let root: string;

beforeEach(async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), "nls-artifact-size-"));
});

afterEach(async () => {
    vi.restoreAllMocks();
    await fs.rm(root, { recursive: true, force: true });
});

/** Write `bytes` bytes at `relativePath`, creating the folders above it. */
async function writeFile(relativePath: string, bytes: number): Promise<string> {
    const target = path.join(root, relativePath);
    await fs.mkdir(path.dirname(target), { recursive: true });
    await fs.writeFile(target, Buffer.alloc(bytes, 0x61));
    return target;
}

describe("measureBuildArtifacts", () => {
    it("measures a file artifact", async () => {
        const installer = await writeFile("game-setup.exe", 4096);

        expect(await measureBuildArtifacts([installer])).toEqual([{ path: installer, bytes: 4096 }]);
    });

    it("sums a directory artifact over its whole tree", async () => {
        // The failure this pins: `stat` on a directory reports the directory entry, so a web
        // export or a macOS `.app` - both folders - would be reported as a few hundred bytes or
        // zero, and a 900 MB upload would look empty in the console.
        await writeFile("web-export/index.html", 1000);
        await writeFile("web-export/assets/scene.png", 2000);
        await writeFile("web-export/assets/nested/voice.ogg", 3000);
        const exportDir = path.join(root, "web-export");

        const [measured] = await measureBuildArtifacts([exportDir]);

        expect(measured.bytes).toBe(6000);
        expect(measured.bytes).toBeGreaterThan(0);
    });

    it("keeps directory and file artifacts apart in one build", async () => {
        await writeFile("mac/Game.app/Contents/MacOS/Game", 5000);
        const appDir = path.join(root, "mac", "Game.app");
        const dmg = await writeFile("Game.dmg", 7000);

        expect(await measureBuildArtifacts([appDir, dmg])).toEqual([
            { path: appDir, bytes: 5000 },
            { path: dmg, bytes: 7000 },
        ]);
    });

    it("reports an artifact it cannot read without a size instead of throwing", async () => {
        // A build that packaged successfully must not be turned into a failure by the code that
        // only describes it, so an unreadable path yields no size rather than an exception.
        const missing = path.join(root, "never-written.zip");
        const present = await writeFile("present.zip", 512);

        const measured = await measureBuildArtifacts([missing, present]);

        // Listed, so the console still names everything the build produced - and with no `bytes`
        // key at all, which is what distinguishes "not measured" from a genuinely empty artifact.
        expect(measured).toEqual([{ path: missing }, { path: present, bytes: 512 }]);
        expect(measured[0].bytes).toBeUndefined();
    });

    it("survives a directory walk that throws", async () => {
        await writeFile("web-export/index.html", 1000);
        const exportDir = path.join(root, "web-export");
        vi.spyOn(Fs, "directorySize").mockRejectedValue(new Error("EPERM"));

        await expect(measureBuildArtifacts([exportDir])).resolves.toEqual([{ path: exportDir }]);
    });
});

describe("formatArtifactSizeReport", () => {
    const t = createTranslator("en");
    // Paths only; this half never touches the disk.
    const projectPath = path.join(os.tmpdir(), "nls-project");

    it("puts a size beside every artifact and totals them once", () => {
        const report = formatArtifactSizeReport([
            { path: path.join(projectPath, "dist", "Game-win-x64.exe"), bytes: 2 * 1024 * 1024 },
            { path: path.join(projectPath, "dist", "web-export"), bytes: 6 * 1024 * 1024 },
        ], projectPath, t);

        expect(report.split("\n")).toEqual([
            `${path.join("dist", "Game-win-x64.exe")} (2.0 MB)`,
            `${path.join("dist", "web-export")} (6.0 MB)`,
            "Total size: 8.0 MB in 2 artifacts.",
        ]);
    });

    it("names an unmeasured artifact and leaves it out of the total", () => {
        const report = formatArtifactSizeReport([
            { path: path.join(projectPath, "dist", "Game.dmg") },
            { path: path.join(projectPath, "dist", "Game.zip"), bytes: 1024 },
        ], projectPath, t);

        expect(report.split("\n")).toEqual([
            `${path.join("dist", "Game.dmg")} (size unknown)`,
            `${path.join("dist", "Game.zip")} (1.0 KB)`,
            // Singular, and counting one artifact rather than two: the total is true about what it
            // managed to add up, not about the build.
            "Total size: 1.0 KB in 1 artifact.",
        ]);
        expect(report).not.toContain("0 B");
    });

    it("omits the total when nothing could be measured", () => {
        const report = formatArtifactSizeReport(
            [{ path: path.join(projectPath, "dist", "Game.dmg") }],
            projectPath,
            t,
        );

        expect(report).toBe(`${path.join("dist", "Game.dmg")} (size unknown)`);
        expect(report).not.toContain("Total size");
    });

    it("translates the words around the numbers", () => {
        const report = formatArtifactSizeReport([
            { path: path.join(projectPath, "dist", "Game.dmg") },
            { path: path.join(projectPath, "dist", "Game.zip"), bytes: 1024 },
        ], projectPath, createTranslator("zh"));

        // The unit stays "KB" in every locale (shared byte formatting); only the words move.
        expect(report).toContain("体积未知");
        expect(report).toContain("1.0 KB");
        expect(report).toContain("总体积：1.0 KB，共 1 个产物");
    });
});
