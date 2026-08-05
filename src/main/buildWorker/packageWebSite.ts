import { execFile } from "child_process";
import fs from "fs/promises";
import os from "os";
import path from "path";
import { promisify } from "util";
import { path7za } from "7zip-bin";
import { precompressWebSite } from "./precompressWebSite";
import type { GameBuildWorkerWebJob } from "./protocol";

/**
 * Package the compiled web site: plain copying and zipping, no
 * electron-builder. The zip stores site files at the archive root
 * (extract-and-upload); 7za is used because it already ships with the
 * packaging toolchain on every host.
 */
export async function packageWebSite(
    web: GameBuildWorkerWebJob,
    outputDir: string,
    log: (level: "info" | "warning" | "error", message: string) => void,
): Promise<string[]> {
    log("info", `packaging web (${web.formats.join(", ")})`);
    await fs.mkdir(outputDir, { recursive: true });
    // Built once and merged into every requested format. It lives outside the
    // compiled site because that directory is also the payload of the Android
    // and iOS packages, which serve their files straight out of the package and
    // have nothing to negotiate content encoding with.
    const precompressedDir = web.precompress ? await buildPrecompressed(web.sourceDir, log) : null;
    try {
        const artifacts: string[] = [];
        for (const format of web.formats) {
            if (format === "dir") {
                const targetDir = path.resolve(outputDir, web.dirName);
                await fs.rm(targetDir, { recursive: true, force: true });
                await fs.cp(web.sourceDir, targetDir, { recursive: true });
                if (precompressedDir) {
                    await fs.cp(precompressedDir, targetDir, { recursive: true });
                }
                artifacts.push(targetDir);
            } else if (format === "zip") {
                const zipPath = path.resolve(outputDir, web.zipName);
                await fs.rm(zipPath, { force: true });
                await ensure7zaExecutable();
                await addToZip(zipPath, web.sourceDir);
                if (precompressedDir) {
                    // A second `a` against the same archive merges rather than
                    // replaces, which is what puts the variants beside the files
                    // they belong to.
                    await addToZip(zipPath, precompressedDir);
                }
                artifacts.push(zipPath);
            } else {
                log("warning", `unsupported web format "${format}" skipped`);
            }
        }
        return artifacts;
    } finally {
        if (precompressedDir) {
            await fs.rm(precompressedDir, { recursive: true, force: true }).catch(() => undefined);
        }
    }
}

async function addToZip(zipPath: string, cwd: string): Promise<void> {
    await promisify(execFile)(
        path7za,
        ["a", "-tzip", "-y", zipPath, "."],
        { cwd, maxBuffer: 64 * 1024 * 1024 },
    );
}

/**
 * Compress the site's text into a scratch directory, or return null if that
 * fails.
 *
 * Best effort by design: precompressed variants are an optimization a host may
 * not even read, so a full disk or a permission problem in the temp directory
 * has to cost the author a slightly larger export, never their build.
 */
async function buildPrecompressed(
    sourceDir: string,
    log: (level: "info" | "warning" | "error", message: string) => void,
): Promise<string | null> {
    let scratchDir: string | null = null;
    try {
        scratchDir = await fs.mkdtemp(path.join(os.tmpdir(), "nls-web-precompress-"));
        const result = await precompressWebSite(sourceDir, scratchDir);
        if (result.files === 0) {
            await fs.rm(scratchDir, { recursive: true, force: true }).catch(() => undefined);
            return null;
        }
        log(
            "info",
            `precompressed ${result.files} file(s) for content negotiation `
            + `(${formatBytes(result.sourceBytes)} of text, smallest variant ships)`,
        );
        return scratchDir;
    } catch (error) {
        if (scratchDir) {
            await fs.rm(scratchDir, { recursive: true, force: true }).catch(() => undefined);
        }
        log("warning", `could not precompress the site: ${error instanceof Error ? error.message : String(error)}`);
        return null;
    }
}

function formatBytes(bytes: number): string {
    if (bytes >= 1024 * 1024) {
        return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
    }
    return `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

/**
 * npm installs sometimes strip the execute bit from 7zip-bin's binaries
 * (electron-builder chmods before every use for the same reason). Best-effort:
 * a real problem still surfaces from the spawn itself.
 */
async function ensure7zaExecutable(): Promise<void> {
    if (process.platform === "win32") {
        return;
    }
    await fs.chmod(path7za, 0o755).catch(() => undefined);
}
