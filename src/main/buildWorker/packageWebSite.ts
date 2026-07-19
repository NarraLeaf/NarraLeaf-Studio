import { execFile } from "child_process";
import fs from "fs/promises";
import path from "path";
import { promisify } from "util";
import { path7za } from "7zip-bin";
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
    const artifacts: string[] = [];
    for (const format of web.formats) {
        if (format === "dir") {
            const targetDir = path.resolve(outputDir, web.dirName);
            await fs.rm(targetDir, { recursive: true, force: true });
            await fs.cp(web.sourceDir, targetDir, { recursive: true });
            artifacts.push(targetDir);
        } else if (format === "zip") {
            const zipPath = path.resolve(outputDir, web.zipName);
            await fs.rm(zipPath, { force: true });
            await ensure7zaExecutable();
            await promisify(execFile)(
                path7za,
                ["a", "-tzip", "-y", zipPath, "."],
                { cwd: web.sourceDir, maxBuffer: 64 * 1024 * 1024 },
            );
            artifacts.push(zipPath);
        } else {
            log("warning", `unsupported web format "${format}" skipped`);
        }
    }
    return artifacts;
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
