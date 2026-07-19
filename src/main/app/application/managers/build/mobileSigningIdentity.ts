import fs from "fs/promises";
import path from "path";
// Relative on purpose: "@/" means src/main here but src/renderer under vitest.
import {
    generateSigningIdentity,
    type SigningIdentity,
} from "../../../../buildWorker/mobile/signingIdentity";

/**
 * The machine's Android debug signing identity, persisted in the user-data dir.
 *
 * Android refuses to install an unsigned APK, so every repack must be signed
 * with something; v1 uses a debug-level self-signed identity (see
 * signingIdentity.ts - this is not a release identity and never will be).
 *
 * It is created once and reused for every project on the machine, which is the
 * load-bearing property: Android identifies an app by package name *and*
 * signature, so a per-build identity would make each build refuse to install
 * over the last ("App not installed"). Reuse keeps overwrite installs working
 * across rebuilds - the normal sideload development loop.
 */

const IDENTITY_RELATIVE = path.join("mobile-signing", "debug-identity.json");

function isEnoent(error: unknown): boolean {
    return (error as NodeJS.ErrnoException)?.code === "ENOENT";
}

function isUsableIdentity(value: unknown): value is SigningIdentity {
    const identity = value as Partial<SigningIdentity> | null;
    return Boolean(
        identity
        && typeof identity.privateKeyPem === "string"
        && identity.privateKeyPem.includes("PRIVATE KEY")
        && typeof identity.certificateDerBase64 === "string"
        && identity.certificateDerBase64.length > 0,
    );
}

/**
 * Read (or create on first use) this machine's debug signing identity.
 *
 * A corrupt file is regenerated rather than trusted: a half-written identity
 * would fail deep inside signing with an opaque error. That does cost overwrite
 * installs of previously built APKs - unavoidable, since the old identity is
 * gone either way, and rare enough not to warrant preserving a broken file.
 */
export async function resolveMobileSigningIdentity(userDataDir: string): Promise<SigningIdentity> {
    const identityPath = path.join(userDataDir, IDENTITY_RELATIVE);
    try {
        const parsed: unknown = JSON.parse(await fs.readFile(identityPath, "utf8"));
        if (isUsableIdentity(parsed)) {
            return parsed;
        }
    } catch (error) {
        if (!isEnoent(error) && !(error instanceof SyntaxError)) {
            throw error;
        }
    }
    const identity = generateSigningIdentity();
    await fs.mkdir(path.dirname(identityPath), { recursive: true });
    // The private key is only worth a debug signature, but it is still a private
    // key: keep it owner-readable, as the pack secrets are.
    await fs.writeFile(identityPath, JSON.stringify(identity), { mode: 0o600 });
    return identity;
}
