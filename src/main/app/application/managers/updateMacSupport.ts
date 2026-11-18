import { execFile } from "child_process";
import { promises as fs, constants as fsConstants } from "fs";
import path from "path";
import type { UpdateBlockedReason } from "@shared/constants/update";

/**
 * Whether a packaged macOS Studio can replace itself, and if not, why.
 *
 * Squirrel.Mac (which electron-updater's MacUpdater drives) swaps the whole `.app` once Studio has
 * quit, and refuses the new bundle unless it satisfies the running bundle's designated requirement.
 * Two things therefore have to hold before a download is worth starting:
 *
 * - **The running bundle is signed with a certificate**, not ad hoc. An ad-hoc signature's
 *   requirement is its own `cdhash`, which no other build can ever match, so the swap would fail
 *   after the whole download. Every Studio released before signing is in that state, and so is a
 *   local `pack-electron --mac` without a signing identity. The release build is signed with the
 *   project's own certificate (`release.yml`), whose requirement reads
 *   `identifier "com.narraleaf.studio" and certificate root = H"…"` - the same certificate has to
 *   sign every later version, which is why it is kept as a repository secret and never rotated.
 * - **The bundle can be written where it is.** An app opened straight from the disk image or from
 *   Downloads runs from a read-only App Translocation copy, and one in a folder the account cannot
 *   write (an `/Applications` set up by another administrator) cannot be replaced without a
 *   password prompt Squirrel does not show.
 *
 * Asked once per launch: neither answer changes while Studio runs, and `codesign` is a process.
 */

/** `/…/NarraLeaf Studio.app` from `/…/NarraLeaf Studio.app/Contents/MacOS/NarraLeaf Studio`. */
export function appBundlePath(execPath: string): string | null {
    const bundle = path.resolve(execPath, "..", "..", "..");
    return bundle.endsWith(".app") ? bundle : null;
}

/** Whether the bundle runs from a translocated, read-only copy Gatekeeper made for it. */
export function isTranslocated(bundlePath: string): boolean {
    return bundlePath.includes("/AppTranslocation/");
}

/**
 * Whether `codesign -d -r-` output names a certificate. Ad hoc reads `designated => cdhash H"…"`,
 * a certificate-signed bundle `designated => identifier "…" and certificate root = H"…"` (or an
 * `anchor apple generic` chain for an Apple-issued one).
 */
export function requirementNamesCertificate(output: string): boolean {
    const line = output.split("\n").find(entry => entry.includes("designated =>"));
    return line !== undefined && /\b(certificate|anchor)\b/.test(line);
}

function designatedRequirement(bundlePath: string): Promise<string> {
    return new Promise(resolve => {
        // codesign writes the requirement to stdout and its diagnostics to stderr; an unsigned
        // bundle is an error exit, which reads as "no certificate" below.
        execFile("/usr/bin/codesign", ["-d", "-r-", bundlePath], { timeout: 10_000 }, (error, stdout, stderr) => {
            resolve(error ? "" : `${stdout}\n${stderr}`);
        });
    });
}

async function writable(target: string): Promise<boolean> {
    try {
        await fs.access(target, fsConstants.W_OK);
        return true;
    } catch {
        return false;
    }
}

/** Null when this Studio can update itself, otherwise the reason it cannot. */
export async function macSelfUpdateBlocker(execPath: string): Promise<UpdateBlockedReason | null> {
    const bundle = appBundlePath(execPath);
    if (!bundle) {
        return "unsigned";
    }
    if (!requirementNamesCertificate(await designatedRequirement(bundle))) {
        return "unsigned";
    }
    if (isTranslocated(bundle) || !(await writable(bundle)) || !(await writable(path.dirname(bundle)))) {
        return "location";
    }
    return null;
}
