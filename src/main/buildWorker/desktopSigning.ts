import type { Configuration } from "electron-builder";
import type { GameBuildWorkerTarget, GameBuildWorkerWindowsSigning } from "./protocol";

/**
 * Windows Authenticode, mapped onto electron-builder's options.
 *
 * The manager has already decided everything: which credential, whether the
 * host can use it, and where signtool lives. All that is left here is the shape
 * electron-builder wants - which is the one place this can go wrong, because
 * `win.signtoolOptions` and `win.azureSignOptions` cannot both be present:
 * app-builder-lib silently prefers Azure and the author would ship a build
 * signed by something other than what they chose. The protocol's three-armed
 * union makes that unrepresentable, and this file keeps it that way by
 * returning exactly one of the two.
 */

type WindowsConfiguration = NonNullable<Configuration["win"]>;

/**
 * The `win` block for a signed Windows target. Never merges the two option
 * groups; `source` selects one.
 */
export function windowsSigningConfiguration(signing: GameBuildWorkerWindowsSigning): { win: WindowsConfiguration } {
    if (signing.source === "azure") {
        return {
            win: {
                azureSignOptions: {
                    endpoint: signing.endpoint,
                    codeSigningAccountName: signing.codeSigningAccountName,
                    certificateProfileName: signing.certificateProfileName,
                    publisherName: signing.publisherName,
                },
            },
        };
    }
    const common = {
        // electron-builder defaults to dual sha1+sha256 signing. SHA-1
        // Authenticode has not been trusted by Windows for years, and the
        // legacy pass costs a second (non-RFC3161) timestamp round trip that
        // can fail on its own; sha256 alone is what a modern signature is.
        signingHashAlgorithms: ["sha256"] as Array<"sha1" | "sha256">,
        ...(signing.rfc3161TimeStampServer
            ? { rfc3161TimeStampServer: signing.rfc3161TimeStampServer }
            : {}),
    };
    if (signing.source === "pfx") {
        return {
            win: {
                signtoolOptions: {
                    certificateFile: signing.certificateFile,
                    certificatePassword: signing.certificatePassword,
                    ...common,
                },
            },
        };
    }
    return {
        win: {
            signtoolOptions: {
                ...(signing.certificateSubjectName ? { certificateSubjectName: signing.certificateSubjectName } : {}),
                ...(signing.certificateSha1 ? { certificateSha1: signing.certificateSha1 } : {}),
                ...common,
            },
        },
    };
}

/**
 * What to say about a target's signature in the build log. Deliberately never
 * the credential's secrets: this channel goes straight to the author's console
 * and into saved logs.
 */
export function describeWindowsSigning(signing: GameBuildWorkerWindowsSigning): string {
    switch (signing.source) {
        case "pfx":
            return "signing with a certificate file";
        case "certificate-store":
            return `signing with a certificate from the Windows store (${
                signing.certificateSubjectName ?? signing.certificateSha1 ?? "unspecified"})`;
        case "azure":
            return `signing with Azure Trusted Signing (${signing.certificateProfileName})`;
    }
}

/**
 * The signtool the manager found on this host, if any target needs one.
 *
 * Exported as `SIGNTOOL_PATH` around the packaging step because that is the
 * only way in: `getSignToolPath` reads the environment variable and otherwise
 * downloads its own Windows Kits bundle. Azure signing does not use signtool,
 * so its arm carries no path.
 */
export function signtoolPathForTargets(targets: GameBuildWorkerTarget[]): string | null {
    for (const target of targets) {
        const signing = target.signing;
        if (signing && signing.source !== "azure" && signing.signtoolPath) {
            return signing.signtoolPath;
        }
    }
    return null;
}

/**
 * Run `body` with `SIGNTOOL_PATH` pointing at `signtoolPath`, restoring the
 * environment afterwards. A null path leaves the environment untouched -
 * including an author's own `SIGNTOOL_PATH`, which the discovery already
 * honoured and which must not be erased by a build that found nothing.
 */
export async function withSigntoolPath<T>(signtoolPath: string | null, body: () => Promise<T>): Promise<T> {
    if (!signtoolPath) {
        return body();
    }
    const previous = process.env.SIGNTOOL_PATH;
    process.env.SIGNTOOL_PATH = signtoolPath;
    try {
        return await body();
    } finally {
        if (previous === undefined) {
            delete process.env.SIGNTOOL_PATH;
        } else {
            process.env.SIGNTOOL_PATH = previous;
        }
    }
}
