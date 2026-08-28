import fs from "fs/promises";
import os from "os";
import path from "path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { CACHE_ROOT_DIR_NAME, CacheNamespace, UserDataNamespace } from "@shared/types/constants";
import {
    appDirectoryCacheCandidate,
    legacyCacheRoot,
    migrateLegacyCacheRoot,
    probeWritable,
    resolveCacheRoot,
} from "./cacheRoot";

/**
 * Chromium's own cache directories under userData, copied from `cacheInventory` rather than
 * imported: that module reaches for `electron`, which a unit test has no business starting. The
 * duplication is the point of the first test below - if the two lists drift, the guard weakens
 * quietly, so keeping them apart and comparing is what makes drift visible.
 */
const BROWSER_CACHE_DIRS = [
    "Cache",
    "Code Cache",
    "GPUCache",
    "DawnGraphiteCache",
    "DawnWebGPUCache",
    "blob_storage",
];

describe("the cache root's name", () => {
    /**
     * The regression this whole module exists for.
     *
     * `<userData>/cache` and `<userData>/Cache` are one directory on Windows and on a default
     * macOS filesystem, so a cache root spelled `cache` lands inside Chromium's HTTP cache. On
     * this maintainer's machine that meant a 294 MB Zig toolchain sitting beside `Cache_Data`,
     * counted twice by the inventory and deleted by "clear the interface cache".
     */
    it("cannot collide with a Chromium cache directory, whatever the filesystem's case rules", () => {
        const lowered = BROWSER_CACHE_DIRS.map(name => name.toLowerCase());
        expect(lowered).not.toContain(CACHE_ROOT_DIR_NAME.toLowerCase());
    });

    /**
     * The buckets are one level down, so they only collide if the root above them does - but the
     * root is not the only thing that ever sits in userData, and a bucket promoted to a top-level
     * namespace later would inherit the same trap.
     */
    it("keeps every namespace clear of one too", () => {
        const lowered = new Set(BROWSER_CACHE_DIRS.map(name => name.toLowerCase()));
        for (const namespace of [...Object.values(CacheNamespace), ...Object.values(UserDataNamespace)]) {
            expect(lowered.has(namespace.toLowerCase())).toBe(false);
        }
    });
});

describe("where the cache root goes", () => {
    const userDataDir = path.join("C:", "users", "someone", "AppData", "Roaming", "NarraLeaf Studio");
    const fallback = path.join(userDataDir, CACHE_ROOT_DIR_NAME);

    it("sits beside the executable on a writable Windows install", () => {
        expect(resolveCacheRoot({
            packaged: true,
            userDataDir,
            platform: "win32",
            execPath: path.join("D:", "Program", "NarraLeaf Studio", "NarraLeaf Studio.exe"),
            isWritable: () => true,
        })).toEqual({
            root: path.join("D:", "Program", "NarraLeaf Studio", CACHE_ROOT_DIR_NAME),
            reason: "app-directory",
        });
    });

    it("falls back when the install directory refuses a write", () => {
        expect(resolveCacheRoot({
            packaged: true,
            userDataDir,
            platform: "win32",
            execPath: path.join("C:", "Program Files", "NarraLeaf Studio", "NarraLeaf Studio.exe"),
            isWritable: () => false,
        })).toEqual({ root: fallback, reason: "app-directory-read-only" });
    });

    /**
     * Not a probe: writing into the bundle is permitted by the filesystem and breaks the ad-hoc
     * signature, so a machine that answered "writable" would be one launch away from a Studio
     * macOS refuses to start.
     */
    it("never writes inside a macOS bundle, however writable it looks", () => {
        expect(appDirectoryCacheCandidate({
            packaged: true,
            userDataDir,
            platform: "darwin",
            execPath: "/Applications/NarraLeaf Studio.app/Contents/MacOS/NarraLeaf Studio",
        })).toBeNull();
        expect(resolveCacheRoot({
            packaged: true,
            userDataDir,
            platform: "darwin",
            execPath: "/Applications/NarraLeaf Studio.app/Contents/MacOS/NarraLeaf Studio",
            isWritable: () => true,
        })).toEqual({ root: fallback, reason: "app-directory-unsupported" });
    });

    /** The mount is read-only and its path is a fresh `/tmp/.mount_*` every launch. */
    it("never uses an AppImage's mount point", () => {
        expect(appDirectoryCacheCandidate({
            packaged: true,
            userDataDir,
            platform: "linux",
            execPath: "/tmp/.mount_NarraAbc123/usr/bin/narraleaf-studio",
            appImage: "/home/someone/Downloads/NarraLeaf-Studio.AppImage",
        })).toBeNull();
    });

    it("uses an unpacked Linux install", () => {
        expect(appDirectoryCacheCandidate({
            packaged: true,
            userDataDir,
            platform: "linux",
            execPath: "/opt/narraleaf-studio/narraleaf-studio",
            appImage: undefined,
        })).toBe(path.join("/opt/narraleaf-studio", CACHE_ROOT_DIR_NAME));
    });

    /** The application directory is the checkout; a Zig toolchain does not belong in a working tree. */
    it("stays under user data in development", () => {
        expect(resolveCacheRoot({
            packaged: false,
            userDataDir,
            platform: "win32",
            execPath: path.join("D:", "repo", "node_modules", "electron", "dist", "electron.exe"),
            isWritable: () => true,
        })).toEqual({ root: fallback, reason: "development" });
    });
});

describe("probeWritable", () => {
    let scratch: string;

    beforeEach(async () => {
        scratch = await fs.mkdtemp(path.join(os.tmpdir(), "nls-cache-root-"));
    });

    afterEach(async () => {
        await fs.rm(scratch, { recursive: true, force: true });
    });

    it("creates the directory it is asked about and leaves no probe file behind", async () => {
        const target = path.join(scratch, "nested", CACHE_ROOT_DIR_NAME);
        expect(probeWritable(target)).toBe(true);
        expect(await fs.readdir(target)).toEqual([]);
    });

    it("refuses a path that cannot be a directory", async () => {
        const file = path.join(scratch, "a-file");
        await fs.writeFile(file, "");
        expect(probeWritable(path.join(file, "under-a-file"))).toBe(false);
    });
});

describe("migrating out of the old cache root", () => {
    let scratch: string;
    let userDataDir: string;
    let cacheRoot: string;

    beforeEach(async () => {
        scratch = await fs.mkdtemp(path.join(os.tmpdir(), "nls-cache-migrate-"));
        userDataDir = path.join(scratch, "userData");
        cacheRoot = path.join(scratch, "app", CACHE_ROOT_DIR_NAME);
        await fs.mkdir(userDataDir, { recursive: true });
    });

    afterEach(async () => {
        await fs.rm(scratch, { recursive: true, force: true });
    });

    async function seedLegacy(relative: string, contents = "x"): Promise<string> {
        const target = path.join(legacyCacheRoot(userDataDir), relative);
        await fs.mkdir(path.dirname(target), { recursive: true });
        await fs.writeFile(target, contents);
        return target;
    }

    it("moves a bucket it recognises", async () => {
        await seedLegacy(path.join(CacheNamespace.Toolchains, "zig-0.16.0", "zig.exe"), "binary");
        expect(await migrateLegacyCacheRoot(userDataDir, cacheRoot)).toBe(1);
        expect(
            await fs.readFile(path.join(cacheRoot, CacheNamespace.Toolchains, "zig-0.16.0", "zig.exe"), "utf-8"),
        ).toBe("binary");
    });

    /**
     * The whole reason the migration names its buckets instead of moving the directory: on
     * Windows the directory it is reading is Chromium's, and Chromium is using it right now.
     */
    it("leaves everything it does not recognise exactly where it is", async () => {
        await seedLegacy(path.join("Cache_Data", "index"), "chromium");
        await seedLegacy(path.join("No_Vary_Search", "data"), "chromium");
        await seedLegacy(path.join(CacheNamespace.OptimizedImages, "ab", "cd.webp"));
        expect(await migrateLegacyCacheRoot(userDataDir, cacheRoot)).toBe(1);
        expect(await fs.readFile(path.join(legacyCacheRoot(userDataDir), "Cache_Data", "index"), "utf-8"))
            .toBe("chromium");
        expect(await fs.readFile(path.join(legacyCacheRoot(userDataDir), "No_Vary_Search", "data"), "utf-8"))
            .toBe("chromium");
    });

    /**
     * A rename across volumes fails, and copying hundreds of megabytes at startup to save one
     * download is the wrong trade. The old copy still has to go, or it occupies disk that nothing
     * will read again.
     */
    it("discards rather than merges when the destination already holds the bucket", async () => {
        await seedLegacy(path.join(CacheNamespace.Toolchains, "zig-0.16.0", "zig.exe"), "old");
        const kept = path.join(cacheRoot, CacheNamespace.Toolchains, "zig-0.16.0");
        await fs.mkdir(kept, { recursive: true });
        await fs.writeFile(path.join(kept, "zig.exe"), "new");

        expect(await migrateLegacyCacheRoot(userDataDir, cacheRoot)).toBe(1);
        expect(await fs.readFile(path.join(kept, "zig.exe"), "utf-8")).toBe("new");
        await expect(fs.stat(path.join(legacyCacheRoot(userDataDir), CacheNamespace.Toolchains)))
            .rejects.toThrow();
    });

    it("does nothing when there is nothing there", async () => {
        expect(await migrateLegacyCacheRoot(userDataDir, cacheRoot)).toBe(0);
    });

    /** A development root already *is* the legacy path's neighbour; moving it onto itself would empty it. */
    it("refuses to migrate a root onto itself", async () => {
        await seedLegacy(path.join(CacheNamespace.Toolchains, "zig-0.16.0", "zig.exe"), "binary");
        expect(await migrateLegacyCacheRoot(userDataDir, legacyCacheRoot(userDataDir))).toBe(0);
        expect(
            await fs.readFile(
                path.join(legacyCacheRoot(userDataDir), CacheNamespace.Toolchains, "zig-0.16.0", "zig.exe"),
                "utf-8",
            ),
        ).toBe("binary");
    });
});
