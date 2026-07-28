import { execFile } from "child_process";
import crypto from "crypto";
import fs from "fs/promises";
import os from "os";
import path from "path";
import { KeystoreError, readKeystore } from "./keystoreReader";
import { writePasswordlessPkcs12 } from "./pkcs12Writer";
import { parseProvisioningProfile, profileCoversBundleId, profileHasExpired } from "./provisioningProfile";
import type { ZsignTool } from "./zsignTool";
import type { GameBuildWorkerIosSigning } from "../protocol";

/**
 * Signing a finished `.ipa` with the vendored zsign.
 *
 * The interesting parts are not the invocation but the two things done around
 * it. First, the password: zsign only accepts one as `-p <password>` on the
 * command line, where any other process on the machine can read it - so the
 * author's `.p12` is opened here and re-packed into a password-less, 0600,
 * short-lived copy (pkcs12Writer.ts) that is passed instead, and zsign runs
 * with no `-p` at all. Second, the chain: zsign fails with an opaque
 * "Unknown issuer hash" when the `.p12` holds only the leaf certificate, which
 * is exactly what an author gets by exporting carelessly from Keychain Access -
 * so that case is caught first and named.
 *
 * Nothing here logs a password, a key, or the contents of either container; the
 * worker's log channel goes straight to the author's console.
 */

/** Where a failure came from, so a caller can map it to preflight copy. */
export type IpaSigningErrorCode =
    /** The vendored zsign is missing or does not run on this host. */
    | "tool-unavailable"
    /** The .p12 could not be opened - wrong password, or not a keystore. */
    | "identity-unreadable"
    /** The .p12 has the signing certificate but not the CA that issued it. */
    | "identity-chain-incomplete"
    /** The .mobileprovision could not be parsed. */
    | "profile-unreadable"
    /** The profile does not cover this build's bundle id. */
    | "profile-mismatch"
    /** The profile's expiry has passed. */
    | "profile-expired"
    /** zsign ran and refused. */
    | "signing-failed";

export class IpaSigningError extends Error {
    readonly code: IpaSigningErrorCode;

    constructor(code: IpaSigningErrorCode, message: string) {
        super(message);
        this.name = "IpaSigningError";
        this.code = code;
    }
}

export type ZsignRun = { exitCode: number; output: string };

/** Runs zsign. A seam so tests can drive the whole path without the binary. */
export type ZsignRunner = (executable: string, args: string[]) => Promise<ZsignRun>;

export const runZsign: ZsignRunner = (executable, args) => new Promise<ZsignRun>(resolve => {
    // maxBuffer: zsign prints a line per signed file; a large app is chatty.
    execFile(executable, args, { maxBuffer: 16 * 1024 * 1024 }, (error, stdout, stderr) => {
        const output = `${stdout}${stderr}`;
        if (!error) {
            resolve({ exitCode: 0, output });
            return;
        }
        // A failed run exits non-zero (255, which surfaces here as 4294967295 on
        // Windows); a spawn failure has no code at all.
        const code = (error as NodeJS.ErrnoException & { code?: number | string }).code;
        resolve({ exitCode: typeof code === "number" ? code : 1, output: output || error.message });
    });
});

export type SignIpaOptions = {
    /** The resolved vendored tool. An unavailable one is a build failure, not a skip. */
    tool: ZsignTool;
    /** The unsigned package. Left alone; zsign writes a separate file. */
    unsignedIpaPath: string;
    /** Where the signed package is written. Must differ from `unsignedIpaPath`. */
    signedIpaPath: string;
    /** The bundle id the repack already wrote into Info.plist. */
    bundleId: string;
    /** Home-screen name; becomes CFBundleName as well. */
    displayName: string;
    signing: GameBuildWorkerIosSigning;
    /** Directory the ephemeral container is created under; defaults to the OS temp dir. */
    tempDirRoot?: string;
    /** Injected by tests. */
    run?: ZsignRunner;
    /** Injected by tests; the profile's expiry is judged against this. */
    now?: Date;
};

export type SignIpaResult = {
    /** The signing certificate's subject, for the build log. */
    signerSubject: string;
    /** The profile's name and the app it covers, for the build log. */
    profileName: string;
    applicationIdentifier: string;
    /** Devices the profile is limited to; empty means a distribution profile. */
    provisionedDeviceCount: number;
    expiresAt: Date;
};

/** Every message zsign prints starts with ">>> "; keep the tail for a log line. */
function lastLines(output: string, count: number): string {
    return output
        .split(/\r?\n/)
        .map(line => line.trim())
        .filter(line => line.length > 0)
        .slice(-count)
        .join(" / ");
}

/**
 * Sign `unsignedIpaPath` into `signedIpaPath`.
 *
 * Throws `IpaSigningError` for everything an author can act on, and leaves no
 * ephemeral key material behind on any path out.
 */
export async function signIpa(options: SignIpaOptions): Promise<SignIpaResult> {
    const { tool, signing } = options;
    if (!tool.available) {
        throw new IpaSigningError(
            "tool-unavailable",
            `This build asks for a signed iOS package, but ${tool.detail}.`,
        );
    }
    if (path.resolve(options.unsignedIpaPath) === path.resolve(options.signedIpaPath)) {
        throw new Error("signIpa needs distinct input and output paths");
    }

    const profile = await readProfile(signing.provisioningProfileFile);
    if (profileHasExpired(profile, options.now)) {
        throw new IpaSigningError(
            "profile-expired",
            `The provisioning profile "${profile.name}" expired on ${profile.expiresAt.toISOString().slice(0, 10)}. `
            + "Renew it in the Apple Developer portal and import the new one.",
        );
    }
    const coverage = profileCoversBundleId(profile, options.bundleId);
    if (!coverage.matches) {
        throw new IpaSigningError("profile-mismatch", coverage.message);
    }

    const identity = await readIdentity(signing);
    if (identity.certificateChainDerBase64.length < 2) {
        throw new IpaSigningError(
            "identity-chain-incomplete",
            "This signing identity contains only its own certificate, not the intermediate certificate "
            + "that issued it, and iOS signing needs both. Export it again from Keychain Access with the "
            + "\"Apple Worldwide Developer Relations\" certificate selected alongside the private key.",
        );
    }

    const workDir = await fs.mkdtemp(path.join(options.tempDirRoot ?? os.tmpdir(), "nls-ipa-sign-"));
    try {
        const ephemeralP12 = path.join(workDir, "identity.p12");
        await fs.writeFile(
            ephemeralP12,
            writePasswordlessPkcs12({
                privateKeyDer: crypto.createPrivateKey(identity.privateKeyPem)
                    .export({ type: "pkcs8", format: "der" }),
                certificateChainDer: identity.certificateChainDerBase64
                    .map(der => Buffer.from(der, "base64")),
                friendlyName: identity.alias,
            }),
            // Owner-only. A no-op on Windows, where the temp directory's own ACL
            // is what keeps other users out.
            { mode: 0o600 },
        );

        // No -p: the container above has no password, which is the whole point.
        const args = [
            "-k", ephemeralP12,
            "-m", signing.provisioningProfileFile,
            "-b", options.bundleId,
            "-n", options.displayName,
            "-o", options.signedIpaPath,
            options.unsignedIpaPath,
        ];
        const { exitCode, output } = await (options.run ?? runZsign)(tool.path, args);
        // zsign reports failure both ways; a run that exits 0 having printed
        // "Signed Failed!" would otherwise leave a half-written package behind.
        if (exitCode !== 0 || /Signed Failed!/.test(output)) {
            await fs.rm(options.signedIpaPath, { force: true });
            throw new IpaSigningError(
                "signing-failed",
                `The iOS signing tool refused this package: ${lastLines(output, 3) || `it exited with ${exitCode}`}`,
            );
        }
        if (!await fileExists(options.signedIpaPath)) {
            throw new IpaSigningError(
                "signing-failed",
                "The iOS signing tool reported success but wrote no package.",
            );
        }

        const signerSubject = new crypto.X509Certificate(
            Buffer.from(identity.certificateChainDerBase64[0], "base64"),
        ).subject.split("\n").join(", ");
        return {
            signerSubject,
            profileName: profile.name,
            applicationIdentifier: profile.applicationIdentifier,
            provisionedDeviceCount: profile.provisionedDevices.length,
            expiresAt: profile.expiresAt,
        };
    } finally {
        // The ephemeral container is a private key in the clear; it goes away
        // whether the run succeeded, failed, or threw on the way in.
        await fs.rm(workDir, { recursive: true, force: true });
    }
}

async function readProfile(file: string) {
    let bytes: Buffer;
    try {
        bytes = await fs.readFile(file);
    } catch {
        throw new IpaSigningError(
            "profile-unreadable",
            `The provisioning profile could not be read from ${file}.`,
        );
    }
    try {
        return parseProvisioningProfile(bytes);
    } catch (error) {
        throw new IpaSigningError(
            "profile-unreadable",
            error instanceof Error ? error.message : String(error),
        );
    }
}

async function readIdentity(signing: GameBuildWorkerIosSigning) {
    let bytes: Buffer;
    try {
        bytes = await fs.readFile(signing.p12File);
    } catch {
        throw new IpaSigningError(
            "identity-unreadable",
            `The signing identity could not be read from ${signing.p12File}.`,
        );
    }
    try {
        return readKeystore(bytes, { storePassword: signing.p12Password });
    } catch (error) {
        // KeystoreError messages are already written for the person who picked
        // the file; anything else is unexpected and kept verbatim.
        throw new IpaSigningError(
            "identity-unreadable",
            error instanceof KeystoreError || error instanceof Error ? error.message : String(error),
        );
    }
}

async function fileExists(candidate: string): Promise<boolean> {
    try {
        return (await fs.stat(candidate)).isFile();
    } catch {
        return false;
    }
}
