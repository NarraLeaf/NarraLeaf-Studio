import { execFile } from "child_process";
import { createHash } from "crypto";
import fs from "fs/promises";
import os from "os";
import path from "path";
import { promisify } from "util";
import { readBodyWithProgress } from "@shared/types/downloadProgress";
import { reportDownload } from "./downloadReporting";
import { sevenZipPath } from "./sevenZipBinary";

/**
 * Pre-provisions electron-builder's winCodeSign cache on Windows hosts that
 * cannot create symbolic links (no admin rights / Developer Mode).
 *
 * Packaging a Windows target always runs rcedit through app-builder.exe, which
 * downloads winCodeSign-2.6.0.7z and extracts it with 7za. That archive
 * contains two macOS dylib symlinks, so on such hosts the extraction exits
 * with code 2 and the whole build dies with ERR_ELECTRON_BUILDER_CANNOT_EXECUTE.
 * The JS-side `toolsets.winCodeSign` option does not help: on win32 rcedit is
 * invoked inside the Go binary, which only knows the legacy bundle.
 *
 * app-builder skips download + extraction entirely when the final cache
 * directory already exists, so we extract the bundle ourselves, excluding the
 * darwin tree (never used on a Windows host and the only place with symlinks).
 */

const WIN_CODE_SIGN_NAME = "winCodeSign-2.6.0";
// Same value app-builder.exe verifies downloads against (embedded in the binary).
const WIN_CODE_SIGN_SHA512 = "6LQI2d9BPC3Xs0ZoTQe1o3tPiA28c7+PY69Q9i/pD8lY45psMtHuLwv3vRckiVr3Zx1cbNyLlBR8STwCdcHwtA==";
const DEFAULT_BINARIES_MIRROR = "https://github.com/electron-userland/electron-builder-binaries/releases/download/";

const execFileAsync = promisify(execFile);

type Log = (level: "info" | "warning" | "error", message: string) => void;

/**
 * The same directory app-builder.exe will use, which is the whole point: this pre-provisions a
 * cache app-builder then finds already populated.
 *
 * The environment variable is not a fallback here - `GameBuildManager.runWorker` always sets it,
 * to Studio's own cache root (or to whatever the author exported, which wins). The platform
 * defaults below are what an author running this module outside that worker would get, and what
 * every Studio before the cache root existed got.
 */
function builderCacheRoot(): string | null {
    const override = process.env.ELECTRON_BUILDER_CACHE?.trim();
    if (override) {
        return override;
    }
    const localAppData = process.env.LOCALAPPDATA?.trim();
    if (!localAppData) {
        return null;
    }
    return path.join(localAppData, "electron-builder", "Cache");
}

/**
 * Where the bundle comes from.
 *
 * The Studio setting wins over the environment: it is the one a user can actually reach, and a
 * host with a stale `ELECTRON_BUILDER_BINARIES_MIRROR` exported years ago should not silently
 * override what the author just typed. The environment variables stay honored below it, because
 * CI images set them and were working before this setting existed.
 */
function binariesMirror(configured?: string): string {
    const mirror =
        configured?.trim() ||
        process.env.NPM_CONFIG_ELECTRON_BUILDER_BINARIES_MIRROR ||
        process.env.ELECTRON_BUILDER_BINARIES_MIRROR ||
        DEFAULT_BINARIES_MIRROR;
    return mirror.endsWith("/") ? mirror : `${mirror}/`;
}

async function canCreateSymlinks(): Promise<boolean> {
    const target = path.join(os.tmpdir(), `nls-symlink-probe-${process.pid}-${Date.now()}`);
    const link = `${target}.link`;
    try {
        await fs.writeFile(target, "");
        await fs.symlink(target, link, "file");
        return true;
    } catch {
        return false;
    } finally {
        await fs.rm(link, { force: true }).catch(() => undefined);
        await fs.rm(target, { force: true }).catch(() => undefined);
    }
}

/** Names this transfer for the readout; one per build, so a constant is enough. */
const WIN_CODE_SIGN_TRANSFER_ID = "winCodeSign";

async function downloadArchive(url: string): Promise<Buffer> {
    const response = await fetch(url);
    if (!response.ok) {
        throw new Error(`download failed with HTTP ${response.status}`);
    }
    // Read chunk by chunk rather than through `arrayBuffer()`, which produces the whole body at once
    // and so can report nothing between "started" and "finished". The bundle is a few tens of
    // megabytes over whatever connection the author has; that wait deserves a number.
    const buffer = await readBodyWithProgress(response, (done, total) => {
        reportDownload({ phase: "advance", id: WIN_CODE_SIGN_TRANSFER_ID, done, total });
    });
    const sha512 = createHash("sha512").update(buffer).digest("base64");
    if (sha512 !== WIN_CODE_SIGN_SHA512) {
        throw new Error(`checksum mismatch for ${url}`);
    }
    return buffer;
}

/**
 * Best-effort: on failure the build proceeds and electron-builder surfaces its
 * own error; the warning logged here tells the user how to fix it by hand.
 */
export async function ensureWinCodeSignCache(log: Log, binariesMirrorUrl?: string): Promise<void> {
    if (process.platform !== "win32") {
        return;
    }
    const cacheRoot = builderCacheRoot();
    if (cacheRoot === null) {
        return;
    }
    const finalDir = path.join(cacheRoot, "winCodeSign", WIN_CODE_SIGN_NAME);
    try {
        await fs.access(finalDir);
        return;
    } catch {
        // not cached yet
    }
    if (await canCreateSymlinks()) {
        // electron-builder can extract the bundle (symlinks included) itself.
        return;
    }

    const stagingDir = `${finalDir}.staging-${process.pid}`;
    const archivePath = `${stagingDir}.7z`;
    try {
        log("info", "preparing winCodeSign cache (host cannot create symlinks)");
        const url = `${binariesMirror(binariesMirrorUrl)}${WIN_CODE_SIGN_NAME}/${WIN_CODE_SIGN_NAME}.7z`;
        await fs.mkdir(path.dirname(finalDir), { recursive: true });
        reportDownload({ phase: "start", id: WIN_CODE_SIGN_TRANSFER_ID, kind: "toolchainDownload" });
        try {
            await fs.writeFile(archivePath, await downloadArchive(url));
        } finally {
            // Closed on the way out either way: a transfer that failed is still a transfer that is
            // no longer happening, and the reason goes to the log below where it can be read.
            reportDownload({ phase: "end", id: WIN_CODE_SIGN_TRANSFER_ID });
        }
        await execFileAsync(sevenZipPath(), ["x", "-bd", "-y", `-o${stagingDir}`, "-xr!darwin", archivePath]);
        // rcedit is what the packaging step actually needs from the bundle.
        await fs.access(path.join(stagingDir, "rcedit-x64.exe"));
        try {
            await fs.rename(stagingDir, finalDir);
        } catch (error) {
            // Lost a race against another provisioner; the cache is still valid.
            await fs.access(finalDir).catch(() => {
                throw error;
            });
        }
    } catch (error) {
        const detail = error instanceof Error ? error.message : String(error);
        log(
            "warning",
            `could not prepare the winCodeSign cache (${detail}); if packaging fails with ` +
                `"Cannot create symbolic link", enable Windows Developer Mode or run once as administrator`,
        );
    } finally {
        await fs.rm(archivePath, { force: true }).catch(() => undefined);
        await fs.rm(stagingDir, { recursive: true, force: true }).catch(() => undefined);
    }
}
