import { path7za } from "7zip-bin";
import { execFile } from "child_process";
import { createHash } from "crypto";
import fs from "fs/promises";
import os from "os";
import path from "path";
import { promisify } from "util";

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

function binariesMirror(): string {
    const mirror =
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

async function downloadArchive(url: string): Promise<Buffer> {
    const response = await fetch(url);
    if (!response.ok) {
        throw new Error(`download failed with HTTP ${response.status}`);
    }
    const buffer = Buffer.from(await response.arrayBuffer());
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
export async function ensureWinCodeSignCache(log: Log): Promise<void> {
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
        const url = `${binariesMirror()}${WIN_CODE_SIGN_NAME}/${WIN_CODE_SIGN_NAME}.7z`;
        await fs.mkdir(path.dirname(finalDir), { recursive: true });
        await fs.writeFile(archivePath, await downloadArchive(url));
        await execFileAsync(path7za, ["x", "-bd", "-y", `-o${stagingDir}`, "-xr!darwin", archivePath]);
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
