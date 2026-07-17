import { constants as bufferConstants } from "buffer";
import fs from "fs/promises";
import { createReadStream } from "fs";
import path from "path";
import { repackApk } from "./repackApk";
import { repackIpa } from "./repackIpa";
import type { ZipEntrySource } from "./zipWriter";
import type { GameBuildWorkerMobileJob } from "../protocol";

/**
 * The fs layer of the mobile repack: everything the pure repack modules
 * deliberately do not do. It reads the templates and the compiled site off
 * disk, streams the site's files into the repack, and writes the finished
 * install packages out.
 *
 * The split matters for testing — repackApk/repackIpa are Buffer-in/Buffer-out
 * and fully unit-testable against synthetic fixtures, while this module holds
 * the unavoidable I/O.
 */

export type MobileRepackLogger = (level: "info" | "warning" | "error", message: string) => void;

/** Site files, streamed rather than buffered: a game's payload dwarfs the shell. */
type SiteFile = { relativePath: string; absolutePath: string; size: number };

/** Structurally what both repack orchestrators accept as a payload file. */
type SiteEntry = { relativePath: string; source: ZipEntrySource };

/**
 * The finished archive is assembled in memory (both repack orchestrators are
 * Buffer-out, and v2 signing must digest the whole file anyway), so the payload
 * is bounded by what a Buffer can hold. Checking up front turns a vague
 * allocation failure deep in the writer into a clear, actionable error. The
 * dialog's preflight mirrors this so authors learn before the build, not after.
 */
export const MAX_PAYLOAD_BYTES = Math.floor(bufferConstants.MAX_LENGTH * 0.8);

/** Whether a payload of this size can be packaged; see MAX_PAYLOAD_BYTES. */
export function payloadExceedsLimit(totalBytes: number): boolean {
    return totalBytes > MAX_PAYLOAD_BYTES;
}

async function collectSiteFiles(sourceDir: string): Promise<SiteFile[]> {
    const files: SiteFile[] = [];
    const walk = async (dir: string, prefix: string): Promise<void> => {
        const entries = await fs.readdir(dir, { withFileTypes: true });
        // Deterministic order: the repack's output is byte-reproducible only if
        // its entry order is, which the golden tests depend on.
        entries.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
        for (const entry of entries) {
            const absolutePath = path.join(dir, entry.name);
            const relativePath = prefix ? `${prefix}/${entry.name}` : entry.name;
            if (entry.isDirectory()) {
                await walk(absolutePath, relativePath);
                continue;
            }
            if (entry.isSymbolicLink()) {
                // The compiled site is written by Studio's own compiler and has
                // no symlinks; one here means something unexpected produced it.
                throw new Error(`The compiled site contains a symlink ("${relativePath}"), which cannot be packaged`);
            }
            if (!entry.isFile()) {
                continue;
            }
            const { size } = await fs.stat(absolutePath);
            files.push({ relativePath, absolutePath, size });
        }
    };
    await walk(sourceDir, "");
    return files;
}

function siteEntries(files: SiteFile[], indexHtmlOverride: string): SiteEntry[] {
    const entries: SiteEntry[] = files.map(file => ({
        relativePath: file.relativePath,
        source: {
            kind: "stream",
            size: file.size,
            open: () => createReadStream(file.absolutePath),
        },
    }));
    // The mobile entry document replaces the web one in the payload only; the
    // shared staging-web dir on disk stays exactly what the web target ships.
    const overrideEntry: SiteEntry = {
        relativePath: "index.html",
        source: { kind: "buffer", data: Buffer.from(indexHtmlOverride, "utf8") },
    };
    const index = entries.findIndex(entry => entry.relativePath === "index.html");
    if (index >= 0) {
        entries[index] = overrideEntry;
    } else {
        entries.push(overrideEntry);
    }
    return entries;
}

function assertPayloadFits(files: SiteFile[], platform: string): void {
    const total = files.reduce((sum, file) => sum + file.size, 0);
    if (payloadExceedsLimit(total)) {
        const gib = (total / 1024 ** 3).toFixed(2);
        throw new Error(
            `The compiled game is too large to package for ${platform} (${gib} GiB). `
            + "Mobile packages are assembled in memory; reduce the payload size.",
        );
    }
}

/**
 * Run the selected mobile repacks and return the absolute paths of what was
 * written. Reproducible: `mtime` is fixed per build rather than taken from the
 * clock, so the same inputs produce byte-identical packages.
 */
export async function runMobileRepack(
    job: GameBuildWorkerMobileJob,
    outputDir: string,
    log: MobileRepackLogger,
    mtime = new Date(Date.UTC(2020, 0, 1)),
): Promise<string[]> {
    const artifacts: string[] = [];
    const files = await collectSiteFiles(job.sourceDir);
    await fs.mkdir(outputDir, { recursive: true });

    if (job.android) {
        const { android } = job;
        assertPayloadFits(files, "Android");
        log("info", `repacking the Android shell (${files.length} site file(s))...`);
        const apk = await repackApk({
            templateApk: await fs.readFile(android.templateApkPath),
            android: job.templateManifest.android,
            applicationId: android.applicationId,
            label: job.productName,
            versionName: android.versionName,
            versionCode: android.versionCode,
            www: siteEntries(files, job.indexHtmlOverride),
            shellConfigJson: job.shellConfigJson,
            iconPngBySlot: await readIconSlots(android.iconPngBySlot),
            signingIdentity: android.signingIdentity,
            mtime,
        });
        const outputPath = path.join(outputDir, android.outputName);
        await fs.writeFile(outputPath, apk);
        log("info", `signed ${android.outputName} (${formatSize(apk.length)})`);
        artifacts.push(outputPath);
    }

    if (job.ios) {
        const { ios } = job;
        assertPayloadFits(files, "iOS");
        log("info", `repacking the iOS shell (${files.length} site file(s))...`);
        const ipa = await repackIpa({
            templateAppZip: await fs.readFile(ios.templateAppZipPath),
            ios: job.templateManifest.ios,
            appName: job.appDirBaseName,
            identity: {
                bundleId: ios.bundleId,
                displayName: job.productName,
                shortVersionString: ios.shortVersionString,
                bundleVersion: ios.bundleVersion,
            },
            orientation: job.orientation,
            www: siteEntries(files, job.indexHtmlOverride),
            shellConfigJson: job.shellConfigJson,
            iconPngBySlot: await readIconSlots(ios.iconPngBySlot),
            mtime,
        });
        const outputPath = path.join(outputDir, ios.outputName);
        await fs.writeFile(outputPath, ipa);
        log("info", `wrote ${ios.outputName} (${formatSize(ipa.length)}); the package is unsigned`);
        artifacts.push(outputPath);
    }

    return artifacts;
}

async function readIconSlots(slots: Record<string, string> | undefined): Promise<Record<string, Buffer> | undefined> {
    if (!slots) {
        return undefined;
    }
    const loaded: Record<string, Buffer> = {};
    for (const [slot, iconPath] of Object.entries(slots)) {
        loaded[slot] = await fs.readFile(iconPath);
    }
    return loaded;
}

function formatSize(bytes: number): string {
    return `${(bytes / 1024 ** 2).toFixed(1)} MB`;
}
