import { createHash } from "crypto";
import fs from "fs/promises";
import os from "os";
import path from "path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { PluginBuildDependencyTargetContribution } from "@shared/types/plugins";
import { BufferZipOutput, writeZip, type ZipWriteEntry } from "./mobile/zipWriter";
import {
    buildDependencyCacheDir,
    buildDependencyCacheRoot,
    buildDependencySourcePath,
    ensurePluginBuildDependency,
    probePluginBuildDependency,
    resolveBuildDependencyFile,
} from "./pluginBuildDependencies";

const URL_UNDER_TEST = "https://example.invalid/sdk.zip";

let userDataDir: string;
let fetchMock: ReturnType<typeof vi.fn>;

async function zipOf(files: Record<string, string>): Promise<Buffer> {
    const entries: ZipWriteEntry[] = Object.entries(files).map(([name, content]) => ({
        name,
        source: { kind: "buffer", data: Buffer.from(content, "utf-8") },
    }));
    const output = new BufferZipOutput();
    await writeZip(output, entries, { mtime: new Date(Date.UTC(2020, 0, 1)), allowZip64: false });
    return output.toBuffer();
}

function sha256Of(buffer: Buffer): string {
    return createHash("sha256").update(buffer).digest("hex");
}

/** A fetch that serves `body` once per call, like the real one would. */
function servingFetch(body: Buffer): ReturnType<typeof vi.fn> {
    return vi.fn(async () => ({
        ok: true,
        status: 200,
        arrayBuffer: async () => body.buffer.slice(body.byteOffset, body.byteOffset + body.byteLength),
    }));
}

function zipTarget(sha256: string, files: Record<string, string>): PluginBuildDependencyTargetContribution {
    return { url: URL_UNDER_TEST, sha256, archive: "zip", files };
}

async function ensure(target: PluginBuildDependencyTargetContribution): Promise<string> {
    return ensurePluginBuildDependency({
        userDataDir,
        dependencyId: "acme.sdk.binaries",
        platformKey: "windows-x64",
        target,
    });
}

beforeEach(async () => {
    userDataDir = await fs.mkdtemp(path.join(os.tmpdir(), "nls-build-deps-"));
    fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
});

afterEach(async () => {
    vi.unstubAllGlobals();
    await fs.rm(userDataDir, { recursive: true, force: true });
});

describe("ensurePluginBuildDependency", () => {
    it("downloads a zip once and lays it out per the files mapping", async () => {
        const archive = await zipOf({ "redistributable_bin/win64/steam_api64.dll": "BINARY" });
        fetchMock = servingFetch(archive);
        vi.stubGlobal("fetch", fetchMock);

        const target = zipTarget(sha256Of(archive), {
            "redistributable_bin/win64/steam_api64.dll": "steam_api64.dll",
        });
        const dependencyDir = await ensure(target);

        expect(path.isAbsolute(dependencyDir)).toBe(true);
        await expect(fs.readFile(path.join(dependencyDir, "steam_api64.dll"), "utf-8")).resolves.toBe("BINARY");
        expect(fetchMock).toHaveBeenCalledTimes(1);

        // The cache key is the digest, so the same bytes reached through a
        // different URL must not download again either.
        const secondDir = await ensure({ ...target, url: "https://elsewhere.invalid/sdk.zip" });
        expect(secondDir).toBe(dependencyDir);
        expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    it("re-extracts rather than reuse a directory laid out from a different mapping", async () => {
        const archive = await zipOf({ "bin/a.dll": "A", "bin/b.dll": "B" });
        fetchMock = servingFetch(archive);
        vi.stubGlobal("fetch", fetchMock);
        const sha256 = sha256Of(archive);

        const first = await ensure(zipTarget(sha256, { "bin/a.dll": "a.dll" }));
        // An author adding a second file to `files` must not get the stale
        // directory that silently lacks it.
        const second = await ensure(zipTarget(sha256, { "bin/a.dll": "a.dll", "bin/b.dll": "nested/b.dll" }));

        expect(second).not.toBe(first);
        await expect(fs.readFile(path.join(second, "nested", "b.dll"), "utf-8")).resolves.toBe("B");
        // Only one download: the verified bytes are cached beside both layouts.
        expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    it("writes an unarchived download under its declared file name", async () => {
        const payload = Buffer.from("a loose dll", "utf-8");
        fetchMock = servingFetch(payload);
        vi.stubGlobal("fetch", fetchMock);

        const dependencyDir = await ensure({
            url: URL_UNDER_TEST,
            sha256: sha256Of(payload),
            archive: "none",
            fileName: "lib/steam_api64.dll",
        });
        await expect(fs.readFile(path.join(dependencyDir, "lib", "steam_api64.dll"), "utf-8"))
            .resolves.toBe("a loose dll");
    });

    it("rejects a download whose digest does not match and caches nothing", async () => {
        const archive = await zipOf({ "bin/a.dll": "A" });
        fetchMock = servingFetch(archive);
        vi.stubGlobal("fetch", fetchMock);
        const declared = sha256Of(Buffer.from("something else", "utf-8"));

        await expect(ensure(zipTarget(declared, { "bin/a.dll": "a.dll" })))
            .rejects.toThrow(/sha256/);

        // Nothing half-written may survive: the next build would trust it.
        await expect(fs.stat(buildDependencyCacheDir(userDataDir, declared))).rejects.toThrow();
        const root = await fs.readdir(buildDependencyCacheRoot(userDataDir)).catch(() => []);
        expect(root).toEqual([]);
    });

    it("names the archive's top-level entries when a mapped path is missing", async () => {
        const archive = await zipOf({ "sdk/public/steam_api.h": "h", "readme.txt": "hi" });
        fetchMock = servingFetch(archive);
        vi.stubGlobal("fetch", fetchMock);

        await expect(ensure(zipTarget(sha256Of(archive), { "redistributable_bin/x.dll": "x.dll" })))
            .rejects.toThrow(/no entry "redistributable_bin\/x\.dll".*readme\.txt, sdk\//s);
    });

    it("says so when a mapped path names a directory", async () => {
        const archive = await zipOf({ "sdk/a.dll": "A" });
        fetchMock = servingFetch(archive);
        vi.stubGlobal("fetch", fetchMock);

        await expect(ensure(zipTarget(sha256Of(archive), { sdk: "sdk" })))
            .rejects.toThrow(/is a directory in the archive/);
    });

    it("uses a hand-placed source file without touching the network", async () => {
        const archive = await zipOf({ "bin/a.dll": "A" });
        const sha256 = sha256Of(archive);
        const sourcePath = buildDependencySourcePath(userDataDir, sha256);
        await fs.mkdir(path.dirname(sourcePath), { recursive: true });
        await fs.writeFile(sourcePath, archive);

        const dependencyDir = await ensure(zipTarget(sha256, { "bin/a.dll": "a.dll" }));

        await expect(fs.readFile(path.join(dependencyDir, "a.dll"), "utf-8")).resolves.toBe("A");
        expect(fetchMock).not.toHaveBeenCalled();
    });

    it("refuses a hand-placed source file that is not what the manifest declared", async () => {
        const archive = await zipOf({ "bin/a.dll": "A" });
        const declared = sha256Of(await zipOf({ "bin/b.dll": "B" }));
        const sourcePath = buildDependencySourcePath(userDataDir, declared);
        await fs.mkdir(path.dirname(sourcePath), { recursive: true });
        await fs.writeFile(sourcePath, archive);

        await expect(ensure(zipTarget(declared, { "bin/a.dll": "a.dll" })))
            .rejects.toThrow(/cached file/);
        expect(fetchMock).not.toHaveBeenCalled();
    });

    it("reports an unusable HTTP response instead of caching it", async () => {
        fetchMock.mockResolvedValue({ ok: false, status: 403, arrayBuffer: async () => new ArrayBuffer(0) });
        await expect(ensure(zipTarget("0".repeat(64), { "bin/a.dll": "a.dll" })))
            .rejects.toThrow(/HTTP 403/);
    });
});

describe("probePluginBuildDependency", () => {
    it("answers from the cache without reaching the network", async () => {
        const archive = await zipOf({ "bin/a.dll": "A" });
        const sha256 = sha256Of(archive);
        const sourcePath = buildDependencySourcePath(userDataDir, sha256);
        await fs.mkdir(path.dirname(sourcePath), { recursive: true });
        await fs.writeFile(sourcePath, archive);

        await expect(probePluginBuildDependency({
            userDataDir,
            target: zipTarget(sha256, { "bin/a.dll": "a.dll" }),
        })).resolves.toEqual({ status: "cached" });
        expect(fetchMock).not.toHaveBeenCalled();
    });

    it("reports an offline host as unavailable", async () => {
        fetchMock.mockRejectedValue(new Error("getaddrinfo ENOTFOUND example.invalid"));
        await expect(probePluginBuildDependency({
            userDataDir,
            target: zipTarget("a".repeat(64), { "bin/a.dll": "a.dll" }),
        })).resolves.toEqual({ status: "unavailable", reason: "getaddrinfo ENOTFOUND example.invalid" });
    });

    it("does not cry wolf when the host merely refuses HEAD", async () => {
        // A CDN answering 405 proves the host is there; the build's GET may
        // still succeed, so blocking on it would be a false alarm.
        fetchMock.mockResolvedValue({ ok: false, status: 405 });
        await expect(probePluginBuildDependency({
            userDataDir,
            target: zipTarget("b".repeat(64), { "bin/a.dll": "a.dll" }),
        })).resolves.toEqual({ status: "reachable" });
    });

    it("treats a missing URL as unavailable", async () => {
        fetchMock.mockResolvedValue({ ok: false, status: 404 });
        await expect(probePluginBuildDependency({
            userDataDir,
            target: zipTarget("c".repeat(64), { "bin/a.dll": "a.dll" }),
        })).resolves.toEqual({ status: "unavailable", reason: "HTTP 404" });
    });
});

describe("resolveBuildDependencyFile", () => {
    it("resolves a forward-slash path against the dependency directory", () => {
        const root = path.join(userDataDir, "dep");
        expect(resolveBuildDependencyFile(root, "lib/steam_api64.dll"))
            .toBe(path.join(root, "lib", "steam_api64.dll"));
    });

    it("refuses to escape the dependency directory", () => {
        const root = path.join(userDataDir, "dep");
        expect(() => resolveBuildDependencyFile(root, "../outside.dll")).toThrow(/escapes/);
        expect(() => resolveBuildDependencyFile(root, "lib/../../outside.dll")).toThrow(/escapes/);
        expect(() => resolveBuildDependencyFile(root, "")).toThrow(/escapes/);
    });
});
