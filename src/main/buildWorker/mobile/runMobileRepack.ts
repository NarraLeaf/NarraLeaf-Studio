import { constants as bufferConstants } from "buffer";
import fs from "fs/promises";
import { createReadStream } from "fs";
import path from "path";
import { encryptBuffer } from "@narraleaf/encryption";
import { readKeystore } from "./keystoreReader";
import { buildAab } from "./buildAab";
import { signJar } from "./jarSigning";
import { repackApk } from "./repackApk";
import { repackIpa } from "./repackIpa";
import { signIpa } from "./signIpa";
import {
    describeSigningCertificate,
    toApkSigningIdentity,
    type ApkSigningIdentity,
} from "./signingIdentity";
import type { ZipEntrySource } from "./zipWriter";
import type { GameBuildWorkerAndroidSigning, GameBuildWorkerMobileJob } from "../protocol";

/**
 * The fs layer of the mobile repack: everything the pure repack modules
 * deliberately do not do. It reads the templates and the compiled site off
 * disk, streams the site's files into the repack, and writes the finished
 * install packages out.
 *
 * The split matters for testing - repackApk/repackIpa are Buffer-in/Buffer-out
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

/**
 * Turn the collected site files into repack entries. With a `contentKey`, every
 * payload file is protected as it is read (all-or-nothing: the shell assumes the
 * whole payload under wwwRoot is protected, so the index override below is
 * protected too). Without one, files stream through untouched. `shell-config.json`
 * is written outside wwwRoot by the repackers and stays plain either way — the
 * shell needs it to bootstrap.
 */
async function siteEntries(
    files: SiteFile[],
    indexHtmlOverride: string,
    contentKey: string | undefined,
): Promise<SiteEntry[]> {
    const entries: SiteEntry[] = [];
    for (const file of files) {
        if (contentKey) {
            // Read and protect one file at a time. The package is assembled in
            // memory anyway (see MAX_PAYLOAD_BYTES), so this holds one plaintext
            // file beyond that, not the whole payload at once.
            const data = encryptBuffer(await fs.readFile(file.absolutePath), contentKey);
            entries.push({ relativePath: file.relativePath, source: { kind: "buffer", data } });
        } else {
            entries.push({
                relativePath: file.relativePath,
                source: { kind: "stream", size: file.size, open: () => createReadStream(file.absolutePath) },
            });
        }
    }
    // The mobile entry document replaces the web one in the payload only; the
    // shared staging-web dir on disk stays exactly what the web target ships.
    const overrideBytes = Buffer.from(indexHtmlOverride, "utf8");
    const overrideEntry: SiteEntry = {
        relativePath: "index.html",
        source: { kind: "buffer", data: contentKey ? encryptBuffer(overrideBytes, contentKey) : overrideBytes },
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
 * Pick the identity the Android packages are signed with, and say so.
 *
 * This is not a quiet detail. Android identifies an installed app by package
 * name *and* signing certificate: the first build signed with a different
 * identity cannot be installed over the previous one, and the device reports
 * only "App not installed", which is unguessable if nobody said the identity
 * changed. So both branches log which certificate signed, and switching to a
 * release key is a warning rather than a note.
 *
 * One identity covers both packages. The APK carries it as an APK Signature
 * Scheme v2 block and the AAB as a JAR signature - different encodings of the
 * same key, which is why an author configures one keystore rather than two.
 */
async function resolveAndroidIdentity(
    signing: GameBuildWorkerAndroidSigning | undefined,
    debugIdentity: ApkSigningIdentity,
    log: MobileRepackLogger,
): Promise<ApkSigningIdentity> {
    if (!signing) {
        const { subject } = describeSigningCertificate(
            Buffer.from(debugIdentity.certificateChainDerBase64[0], "base64"),
        );
        log("info", `signing the Android build with this machine's sideload identity (${subject})`);
        return debugIdentity;
    }

    const identity = readKeystore(await fs.readFile(signing.keystoreFile), {
        storePassword: signing.storePassword,
        keyPassword: signing.keyPassword,
        alias: signing.alias,
    });
    const { subject, sha256Fingerprint, notAfter } = describeSigningCertificate(
        Buffer.from(identity.certificateDerBase64, "base64"),
    );
    log("warning",
        `signing the Android build with the release key "${identity.alias}" (${subject}) instead of this machine's `
        + "sideload identity. Android identifies an app by package name and signature together, so a device "
        + "that already has a build signed with the other identity must uninstall it before this one will "
        + "install - it fails with \"App not installed\" otherwise.");
    log("info",
        `release certificate SHA-256 ${sha256Fingerprint}, valid until ${notAfter.toISOString().slice(0, 10)}`);
    return identity;
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
    // Built once and shared by both platforms: with a key, protecting the
    // payload twice would be wasted work, and the bytes are identical anyway.
    const www = await siteEntries(files, job.indexHtmlOverride, job.contentKey);

    if (job.android) {
        const { android } = job;
        assertPayloadFits(files, "Android");
        log("info", `repacking the Android shell (${describeSiteFiles(files.length)})...`);
        const signingIdentity = await resolveAndroidIdentity(
            android.signing,
            toApkSigningIdentity(android.signingIdentity),
            log,
        );
        // Both packages are built from one description: same template, same
        // payload, same identity. Only the container and the signature scheme
        // differ, which is the whole reason the AAB is a format of the Android
        // target rather than a target of its own.
        const shell = {
            templateApk: await fs.readFile(android.templateApkPath),
            android: job.templateManifest.android,
            applicationId: android.applicationId,
            label: job.productName,
            versionName: android.versionName,
            versionCode: android.versionCode,
            www,
            shellConfigJson: job.shellConfigJson,
            iconPngBySlot: await readIconSlots(android.iconPngBySlot),
            mtime,
        };

        // One at a time, written out before the next begins: each package is
        // assembled whole in memory (see MAX_PAYLOAD_BYTES), so holding both
        // would double the peak for no gain.
        if (android.outputs.apk) {
            const apk = await repackApk({ ...shell, signingIdentity });
            const outputPath = path.join(outputDir, android.outputs.apk);
            await fs.writeFile(outputPath, apk);
            log("info", `signed ${android.outputs.apk} (${formatSize(apk.length)})`);
            artifacts.push(outputPath);
        }

        if (android.outputs.aab) {
            // The bundle is JAR-signed rather than v2-signed: that is the
            // signature Google Play reads to identify the upload key, and it
            // lives in entries rather than in a block, so it is applied to the
            // finished zip instead of during assembly.
            const aab = signJar(await buildAab(shell), signingIdentity);
            const outputPath = path.join(outputDir, android.outputs.aab);
            await fs.writeFile(outputPath, aab);
            log("info", `signed ${android.outputs.aab} (${formatSize(aab.length)})`);
            artifacts.push(outputPath);
        }
    }

    if (job.ios) {
        const { ios } = job;
        assertPayloadFits(files, "iOS");
        log("info", `repacking the iOS shell (${describeSiteFiles(files.length)})...`);
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
            www,
            shellConfigJson: job.shellConfigJson,
            iconPngBySlot: await readIconSlots(ios.iconPngBySlot),
            mtime,
        });
        const outputPath = path.join(outputDir, ios.outputName);
        if (!ios.signing) {
            await fs.writeFile(outputPath, ipa);
            log("info", `wrote ${ios.outputName} (${formatSize(ipa.length)}); the package is unsigned`);
            artifacts.push(outputPath);
        } else {
            // zsign reads one file and writes another, so the repack's output is
            // staged beside the final artifact - same directory, hence the same
            // volume, and a game's payload is far too large to route through the
            // temp dir. It is removed whichever way the signing goes.
            const unsignedPath = `${outputPath}.unsigned`;
            await fs.writeFile(unsignedPath, ipa);
            log("info", `signing ${ios.outputName} (${formatSize(ipa.length)})...`);
            try {
                const result = await signIpa({
                    tool: { available: true, path: ios.signing.toolPath },
                    unsignedIpaPath: unsignedPath,
                    signedIpaPath: outputPath,
                    bundleId: ios.bundleId,
                    displayName: job.productName,
                    signing: ios.signing,
                });
                log("info",
                    `signed ${ios.outputName} as ${result.applicationIdentifier} with ${result.signerSubject}, `
                    + `profile "${result.profileName}" (expires ${result.expiresAt.toISOString().slice(0, 10)})`);
                if (result.provisionedDeviceCount > 0) {
                    log("warning",
                        `this profile only installs on the ${result.provisionedDeviceCount} device(s) `
                        + "registered to it; any other device will refuse the package");
                }
            } finally {
                await fs.rm(unsignedPath, { force: true });
            }
            artifacts.push(outputPath);
        }
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

/** Spelled out rather than "file(s)": the console is prose an author reads. */
function describeSiteFiles(count: number): string {
    return count === 1 ? "1 site file" : `${count} site files`;
}
