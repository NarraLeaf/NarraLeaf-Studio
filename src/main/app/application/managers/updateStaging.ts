import { unpatchedFsPromises as fsp } from "../../../utils/unpatchedFs";
import path from "path";
import { compareVersions } from "./updateVersions";

/**
 * The folders an update leaves in the installation while it is applied in two halves.
 *
 * The installer does the work (project/installer/installer.nsh, "the prepared update"); this file is
 * Studio's half of the contract: the names both sides use, reading how far the installer has got,
 * and tidying up after it. Every name here is spelled the same way in the installer script, and a
 * change to one has to be made in both.
 *
 *   <install>\.nl-update\              the new version, unpacked while the old one runs
 *   <install>\.nl-update\.nl-prepared  written last; holds the version, so a half-unpacked folder
 *                                      or one left by an older update is never swapped in
 *   <install>\.nl-update\.nl-progress  percent unpacked, rewritten as the unpacking advances
 *   <install>\.nl-replaced\            the old version, moved aside by the swap and deleted after it
 *   <install>.nl-cache                 the cache root, moved beside the installation while a full
 *                                      install replaces it, and moved back afterwards
 *
 * Inside the installation rather than beside it because the installation is the one folder already
 * known to be writable - Studio keeps its cache root there - and because the swap is then a rename of
 * a handful of top-level entries within one directory, which is instant on any disk.
 */
export const STAGED_DIR_NAME = ".nl-update";
export const REPLACED_DIR_NAME = ".nl-replaced";
export const PREPARED_MARKER_NAME = ".nl-prepared";
export const PREPARE_PROGRESS_NAME = ".nl-progress";
export const CACHE_STASH_SUFFIX = ".nl-cache";

/**
 * The installer copies itself into the updater's cache as the base the next differential download
 * is computed against. While an update is only prepared the old installer is still the right base,
 * so the new one waits under this suffix and the swap renames it into place.
 */
export const NEXT_INSTALLER_SUFFIX = ".nl-next";

/**
 * Passed to the installer through the environment: the process it has to wait for before it moves
 * any file. The updater starts the installer with arguments of its own choosing, so the environment
 * the installer inherits is the one channel Studio has.
 */
export const UPDATE_WAIT_PID_ENV = "NARRALEAF_STUDIO_UPDATE_PID";

export interface InstallLayout {
    installDir: string;
    stagedDir: string;
    replacedDir: string;
    cacheStash: string;
}

export function installLayout(execPath: string): InstallLayout {
    const installDir = path.dirname(execPath);
    return {
        installDir,
        stagedDir: path.join(installDir, STAGED_DIR_NAME),
        replacedDir: path.join(installDir, REPLACED_DIR_NAME),
        cacheStash: `${installDir}${CACHE_STASH_SUFFIX}`,
    };
}

/** The version the prepared folder holds, or null when there is no complete one. */
export async function readPreparedVersion(layout: InstallLayout): Promise<string | null> {
    try {
        const text = await fsp.readFile(path.join(layout.stagedDir, PREPARED_MARKER_NAME), "utf8");
        const version = text.replace(/^﻿/, "").trim();
        return version.length > 0 ? version : null;
    } catch {
        return null;
    }
}

/** How far the installer has got unpacking, 0 to 1, or null before it has said. */
export async function readPrepareProgress(layout: InstallLayout): Promise<number | null> {
    try {
        const text = await fsp.readFile(path.join(layout.stagedDir, PREPARE_PROGRESS_NAME), "utf8");
        const percent = Number.parseInt(text.trim(), 10);
        if (!Number.isFinite(percent)) {
            return null;
        }
        return Math.min(1, Math.max(0, percent / 100));
    } catch {
        return null;
    }
}

/** Delete the prepared folder, whatever state it is in. Best-effort: a leftover is tidied on launch. */
export async function removeStagedCopy(layout: InstallLayout): Promise<void> {
    await fsp.rm(layout.stagedDir, { recursive: true, force: true, maxRetries: 3, retryDelay: 200 }).catch(() => undefined);
}

/**
 * Where electron-updater keeps what it downloads: `%LOCALAPPDATA%\<updaterCacheDirName>`.
 *
 * The name is the one electron-builder wrote into `resources/app-update.yml`, read the same way the
 * updater reads it. Null when the file is missing, which is a build that cannot update itself.
 */
export async function updaterCacheDir(resourcesPath: string, localAppData: string | undefined): Promise<string | null> {
    if (!localAppData) {
        return null;
    }
    try {
        const config = await fsp.readFile(path.join(resourcesPath, "app-update.yml"), "utf8");
        const match = /^updaterCacheDirName:\s*['"]?([^'"\r\n]+?)['"]?\s*$/m.exec(config);
        return match ? path.join(localAppData, match[1]) : null;
    } catch {
        return null;
    }
}

/**
 * The version an installer's file name carries, or null for a name of another shape.
 *
 * `update-info.json` records the file name and its hash but not the version, so the name is what
 * there is to go on. Its shape is `nsis.artifactName` in electron-builder.yml:
 * `NarraLeaf-Studio-Setup-<version>-<arch>.exe`. A name that does not match is left alone.
 */
export function installerFileVersion(fileName: string): string | null {
    const match = /-Setup-(\d+\.\d+\.\d+(?:-[0-9A-Za-z.]+)?)-[A-Za-z0-9_]+\.exe$/i.exec(fileName);
    return match ? match[1] : null;
}

export interface CleanUpResult {
    removed: string[];
}

/**
 * What a finished update leaves behind, removed once the new version is running.
 *
 * - the old version the swap moved aside, which the installer starts deleting itself but may not
 *   finish - a file the shell or a scanner still held, or a machine turned off halfway;
 * - a prepared folder that is not ahead of the running version: one left by a swap that fell back to
 *   the full install, or by a prepare that was interrupted;
 * - the cache root's stash, when the cache root is back in place and this copy is the stale one;
 * - the installer electron-updater downloaded, which it never deletes after the install and which is
 *   as large as the application itself. Only once the running version is at least the one it holds.
 *
 * Every step is independent and best-effort: whatever cannot be removed today is tried again on the
 * next launch, and nothing here is anybody's work.
 */
export async function cleanUpAfterUpdate(options: {
    layout: InstallLayout;
    currentVersion: string;
    updaterCache: string | null;
    log: (message: string) => void;
}): Promise<CleanUpResult> {
    const { layout, currentVersion, updaterCache, log } = options;
    const removed: string[] = [];

    const remove = async (target: string) => {
        try {
            await fsp.access(target);
        } catch {
            return;
        }
        try {
            await fsp.rm(target, { recursive: true, force: true, maxRetries: 2 });
            removed.push(target);
        } catch (error) {
            log(`Could not remove ${target}: ${String(error)}`);
        }
    };

    await remove(layout.replacedDir);

    const prepared = await readPreparedVersion(layout);
    if (prepared === null || compareVersions(prepared, currentVersion) <= 0) {
        await remove(layout.stagedDir);
    }

    try {
        await fsp.access(path.join(layout.installDir, "nl-cache"));
        await remove(layout.cacheStash);
    } catch {
        // No cache root yet; `adoptCacheStash` puts the stash back the next time one is resolved.
    }

    if (updaterCache) {
        const pending = path.join(updaterCache, "pending");
        try {
            const info = JSON.parse(await fsp.readFile(path.join(pending, "update-info.json"), "utf8")) as {
                fileName?: unknown;
            };
            const fileName = typeof info.fileName === "string" ? path.basename(info.fileName) : null;
            const pendingVersion = fileName === null ? null : installerFileVersion(fileName);
            if (fileName !== null && pendingVersion !== null && compareVersions(pendingVersion, currentVersion) <= 0) {
                await remove(path.join(pending, fileName));
                await remove(path.join(pending, "update-info.json"));
            }
        } catch {
            // Nothing pending, or a file that is not ours to interpret.
        }
        if (prepared === null || compareVersions(prepared, currentVersion) <= 0) {
            await remove(path.join(updaterCache, `installer.exe${NEXT_INSTALLER_SUFFIX}`));
        }
    }

    return { removed };
}
