import fs from "fs/promises";
import os from "os";
import path from "path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
    PREPARED_MARKER_NAME,
    PREPARE_PROGRESS_NAME,
    cleanUpAfterUpdate,
    installLayout,
    installerFileVersion,
    readPrepareProgress,
    readPreparedVersion,
    updaterCacheDir,
    type InstallLayout,
} from "./updateStaging";

describe("installerFileVersion", () => {
    it("reads the version out of the installer's name", () => {
        expect(installerFileVersion("NarraLeaf-Studio-Setup-1.4.0-x64.exe")).toBe("1.4.0");
        expect(installerFileVersion("NarraLeaf-Studio-Setup-1.5.0-beta.1-x64.exe")).toBe("1.5.0-beta.1");
        expect(installerFileVersion("NarraLeaf-Studio-Setup-2.0.0-arm64.exe")).toBe("2.0.0");
    });

    it("refuses a name of any other shape", () => {
        expect(installerFileVersion("installer.exe")).toBeNull();
        expect(installerFileVersion("NarraLeaf-Studio-1.4.0-x64.exe")).toBeNull();
        expect(installerFileVersion("NarraLeaf-Studio-Setup-1.4.0-x64.zip")).toBeNull();
    });
});

describe("the prepared copy", () => {
    let scratch: string;
    let layout: InstallLayout;

    beforeEach(async () => {
        scratch = await fs.mkdtemp(path.join(os.tmpdir(), "nls-update-staging-"));
        layout = installLayout(path.join(scratch, "NarraLeaf Studio", "NarraLeaf Studio.exe"));
        await fs.mkdir(layout.installDir, { recursive: true });
    });

    afterEach(async () => {
        await fs.rm(scratch, { recursive: true, force: true });
    });

    it("lives inside the installation, and its cache stash beside it", () => {
        expect(layout.stagedDir).toBe(path.join(scratch, "NarraLeaf Studio", ".nl-update"));
        expect(layout.replacedDir).toBe(path.join(scratch, "NarraLeaf Studio", ".nl-replaced"));
        expect(layout.cacheStash).toBe(path.join(scratch, "NarraLeaf Studio.nl-cache"));
    });

    it("counts as prepared only once the installer has written its version", async () => {
        expect(await readPreparedVersion(layout)).toBeNull();
        await fs.mkdir(layout.stagedDir);
        expect(await readPreparedVersion(layout)).toBeNull();
        // NSIS writes the marker without a newline; a BOM or a trailing newline would not change it.
        await fs.writeFile(path.join(layout.stagedDir, PREPARED_MARKER_NAME), "\uFEFF1.4.3\r\n");
        expect(await readPreparedVersion(layout)).toBe("1.4.3");
    });

    it("reads the unpacking progress as a fraction", async () => {
        expect(await readPrepareProgress(layout)).toBeNull();
        await fs.mkdir(layout.stagedDir);
        await fs.writeFile(path.join(layout.stagedDir, PREPARE_PROGRESS_NAME), "37");
        expect(await readPrepareProgress(layout)).toBeCloseTo(0.37);
        await fs.writeFile(path.join(layout.stagedDir, PREPARE_PROGRESS_NAME), "");
        expect(await readPrepareProgress(layout)).toBeNull();
    });
});

describe("updaterCacheDir", () => {
    let scratch: string;

    beforeEach(async () => {
        scratch = await fs.mkdtemp(path.join(os.tmpdir(), "nls-update-cache-"));
    });

    afterEach(async () => {
        await fs.rm(scratch, { recursive: true, force: true });
    });

    it("takes the name electron-builder wrote into app-update.yml", async () => {
        await fs.writeFile(
            path.join(scratch, "app-update.yml"),
            "owner: NarraLeaf\nrepo: NarraLeaf-Studio\nprovider: github\nupdaterCacheDirName: narraleaf-studio-updater\n",
        );
        expect(await updaterCacheDir(scratch, "C:\\Users\\a\\AppData\\Local"))
            .toBe(path.join("C:\\Users\\a\\AppData\\Local", "narraleaf-studio-updater"));
    });

    it("has nothing to say without the file or without LOCALAPPDATA", async () => {
        expect(await updaterCacheDir(scratch, "C:\\Local")).toBeNull();
        await fs.writeFile(path.join(scratch, "app-update.yml"), "updaterCacheDirName: x\n");
        expect(await updaterCacheDir(scratch, undefined)).toBeNull();
    });
});

describe("cleanUpAfterUpdate", () => {
    let scratch: string;
    let layout: InstallLayout;
    let cache: string;

    beforeEach(async () => {
        scratch = await fs.mkdtemp(path.join(os.tmpdir(), "nls-update-cleanup-"));
        layout = installLayout(path.join(scratch, "NarraLeaf Studio", "NarraLeaf Studio.exe"));
        cache = path.join(scratch, "narraleaf-studio-updater");
        await fs.mkdir(layout.installDir, { recursive: true });
        await fs.mkdir(path.join(cache, "pending"), { recursive: true });
    });

    afterEach(async () => {
        await fs.rm(scratch, { recursive: true, force: true });
    });

    const exists = (target: string) => fs.access(target).then(() => true, () => false);
    const run = (currentVersion: string) => cleanUpAfterUpdate({ layout, currentVersion, updaterCache: cache, log: () => undefined });

    async function prepared(version: string | null) {
        await fs.mkdir(path.join(layout.stagedDir, "resources"), { recursive: true });
        if (version !== null) {
            await fs.writeFile(path.join(layout.stagedDir, PREPARED_MARKER_NAME), version);
        }
    }

    async function pending(fileName: string) {
        await fs.writeFile(path.join(cache, "pending", fileName), "installer");
        await fs.writeFile(path.join(cache, "pending", "update-info.json"), JSON.stringify({ fileName, sha512: "x" }));
    }

    it("removes the old version the swap moved aside", async () => {
        await fs.mkdir(path.join(layout.replacedDir, "resources"), { recursive: true });
        await run("1.4.3");
        expect(await exists(layout.replacedDir)).toBe(false);
    });

    it("removes a prepared copy that is not ahead of the running version, or never finished", async () => {
        await prepared("1.4.3");
        await run("1.4.3");
        expect(await exists(layout.stagedDir)).toBe(false);

        await prepared(null);
        await run("1.4.3");
        expect(await exists(layout.stagedDir)).toBe(false);
    });

    it("keeps a prepared copy of a newer version, and the installer waiting for its swap", async () => {
        await prepared("1.4.4");
        await fs.writeFile(path.join(cache, "installer.exe.nl-next"), "next");
        await pending("NarraLeaf-Studio-Setup-1.4.4-x64.exe");
        await run("1.4.3");
        expect(await readPreparedVersion(layout)).toBe("1.4.4");
        expect(await exists(path.join(cache, "installer.exe.nl-next"))).toBe(true);
        expect(await exists(path.join(cache, "pending", "NarraLeaf-Studio-Setup-1.4.4-x64.exe"))).toBe(true);
    });

    it("removes the downloaded installer once it is installed, and nothing it does not recognise", async () => {
        await pending("NarraLeaf-Studio-Setup-1.4.3-x64.exe");
        await fs.writeFile(path.join(cache, "installer.exe"), "base");
        await fs.writeFile(path.join(cache, "installer.exe.nl-next"), "stale");
        await run("1.4.3");
        expect(await exists(path.join(cache, "pending", "NarraLeaf-Studio-Setup-1.4.3-x64.exe"))).toBe(false);
        expect(await exists(path.join(cache, "pending", "update-info.json"))).toBe(false);
        expect(await exists(path.join(cache, "installer.exe.nl-next"))).toBe(false);
        // The differential base for the next update is not ours to touch.
        expect(await exists(path.join(cache, "installer.exe"))).toBe(true);
    });

    it("leaves a stash alone until a cache root exists to make it stale", async () => {
        await fs.mkdir(layout.cacheStash, { recursive: true });
        await run("1.4.3");
        expect(await exists(layout.cacheStash)).toBe(true);

        await fs.mkdir(path.join(layout.installDir, "nl-cache"));
        await run("1.4.3");
        expect(await exists(layout.cacheStash)).toBe(false);
    });
});
