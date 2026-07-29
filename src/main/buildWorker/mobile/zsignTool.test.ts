import fs from "fs/promises";
import os from "os";
import path from "path";
import { afterEach, describe, expect, it } from "vitest";
import {
    ZSIGN_PATH_ENV,
    resolveZsignTool,
    zsignHostTarget,
    zsignSearchPaths,
    type ZsignResolverApp,
} from "./zsignTool";

const tempDirs: string[] = [];

afterEach(async () => {
    while (tempDirs.length > 0) {
        await fs.rm(tempDirs.pop()!, { recursive: true, force: true });
    }
});

/**
 * A repo-shaped or install-shaped root. resolveResource points at <root>/resources
 * either way, which is exactly the contract BaseApp offers.
 */
async function makeApp(isPackaged: boolean): Promise<{ app: ZsignResolverApp; root: string }> {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "nls-zsign-"));
    tempDirs.push(root);
    return {
        root,
        app: {
            isPackaged: () => isPackaged,
            resolveResource: (p: string) => path.resolve(root, "resources", p),
        },
    };
}

async function writeFileAt(file: string): Promise<string> {
    await fs.mkdir(path.dirname(file), { recursive: true });
    await fs.writeFile(file, "not really a binary");
    return file;
}

describe("zsignHostTarget", () => {
    it("covers the three hosts upstream publishes a binary for", () => {
        expect(zsignHostTarget("win32", "x64")).toEqual({ platformKey: "win32", binaryName: "zsign.exe" });
        expect(zsignHostTarget("linux", "x64")).toEqual({ platformKey: "linux", binaryName: "zsign" });
        expect(zsignHostTarget("darwin", "arm64")).toEqual({ platformKey: "darwin", binaryName: "zsign" });
    });

    it("has no answer for hosts with no upstream asset", () => {
        // The one that will actually be hit: upstream ships no macOS x64 build.
        expect(zsignHostTarget("darwin", "x64")).toBeNull();
        expect(zsignHostTarget("win32", "arm64")).toBeNull();
        expect(zsignHostTarget("linux", "arm64")).toBeNull();
        expect(zsignHostTarget("freebsd", "x64")).toBeNull();
    });
});

describe("zsignSearchPaths", () => {
    it("gives a packaged Studio exactly one candidate, under its resources dir", async () => {
        const { app, root } = await makeApp(true);
        expect(zsignSearchPaths(app, { platformKey: "win32", binaryName: "zsign.exe" })).toEqual([
            path.join(root, "resources", "codesign", "win32", "zsign.exe"),
        ]);
    });

    it("adds the .dev cache fallback in development", async () => {
        const { app, root } = await makeApp(false);
        expect(zsignSearchPaths(app, { platformKey: "linux", binaryName: "zsign" })).toEqual([
            path.join(root, "resources", "codesign", "linux", "zsign"),
            path.join(root, ".dev", "cache", "codesign", "linux", "zsign"),
        ]);
    });
});

describe("resolveZsignTool", () => {
    it("finds the staged binary in a packaged Studio", async () => {
        const { app, root } = await makeApp(true);
        const staged = await writeFileAt(path.join(root, "resources", "codesign", "win32", "zsign.exe"));
        await expect(resolveZsignTool(app, { platform: "win32", arch: "x64", env: {} })).resolves.toEqual({
            available: true,
            path: staged,
        });
    });

    it("falls back to the dev cache when the tree was never staged", async () => {
        const { app, root } = await makeApp(false);
        const cached = await writeFileAt(path.join(root, ".dev", "cache", "codesign", "darwin", "zsign"));
        await expect(resolveZsignTool(app, { platform: "darwin", arch: "arm64", env: {} })).resolves.toEqual({
            available: true,
            path: cached,
        });
    });

    it("prefers the staged tree over the dev cache", async () => {
        const { app, root } = await makeApp(false);
        const staged = await writeFileAt(path.join(root, "resources", "codesign", "linux", "zsign"));
        await writeFileAt(path.join(root, ".dev", "cache", "codesign", "linux", "zsign"));
        await expect(resolveZsignTool(app, { platform: "linux", arch: "x64", env: {} })).resolves.toEqual({
            available: true,
            path: staged,
        });
    });

    it("reports a supported host with nothing staged, without throwing", async () => {
        const { app } = await makeApp(true);
        const result = await resolveZsignTool(app, { platform: "win32", arch: "x64", env: {} });
        expect(result.available).toBe(false);
        if (result.available) {
            throw new Error("unreachable");
        }
        expect(result.reason).toBe("not-staged");
        expect(result.searched).toHaveLength(1);
        expect(result.detail).toContain("prepare-codesign-tools.js");
    });

    it("reports macOS x64 as an unsupported host rather than a missing file", async () => {
        const { app, root } = await makeApp(true);
        // Even with a darwin tree present, an x64 mac has no binary it can run.
        await writeFileAt(path.join(root, "resources", "codesign", "darwin", "zsign"));
        const result = await resolveZsignTool(app, { platform: "darwin", arch: "x64", env: {} });
        expect(result.available).toBe(false);
        if (result.available) {
            throw new Error("unreachable");
        }
        expect(result.reason).toBe("host-unsupported");
        expect(result.searched).toEqual([]);
        expect(result.detail).toContain(ZSIGN_PATH_ENV);
    });

    it("lets the env override win, even on an unsupported host", async () => {
        const { app, root } = await makeApp(true);
        const custom = await writeFileAt(path.join(root, "self-built", "zsign"));
        await expect(
            resolveZsignTool(app, { platform: "darwin", arch: "x64", env: { [ZSIGN_PATH_ENV]: custom } }),
        ).resolves.toEqual({ available: true, path: custom });
    });

    it("does not silently fall back when the env override points nowhere", async () => {
        const { app, root } = await makeApp(true);
        await writeFileAt(path.join(root, "resources", "codesign", "win32", "zsign.exe"));
        const result = await resolveZsignTool(app, {
            platform: "win32",
            arch: "x64",
            env: { [ZSIGN_PATH_ENV]: path.join(root, "nope", "zsign.exe") },
        });
        expect(result.available).toBe(false);
        if (result.available) {
            throw new Error("unreachable");
        }
        expect(result.detail).toContain("is not a file");
    });

    it("ignores a directory that happens to sit where the binary should be", async () => {
        const { app, root } = await makeApp(true);
        await fs.mkdir(path.join(root, "resources", "codesign", "win32", "zsign.exe"), { recursive: true });
        const result = await resolveZsignTool(app, { platform: "win32", arch: "x64", env: {} });
        expect(result.available).toBe(false);
    });
});
