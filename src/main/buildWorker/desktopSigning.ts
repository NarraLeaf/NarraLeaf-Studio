import type { Configuration } from "electron-builder";
import type {
    GameBuildWorkerMacSigning,
    GameBuildWorkerNotarization,
    GameBuildWorkerTarget,
    GameBuildWorkerWindowsSigning,
} from "./protocol";

/**
 * Desktop code signing, mapped onto electron-builder's options.
 *
 * The manager has already decided everything: which credential, whether the
 * host can use it, and where the tools live. All that is left here is the shape
 * electron-builder wants - which is the one place this can go wrong, because
 * `win.signtoolOptions` and `win.azureSignOptions` cannot both be present:
 * app-builder-lib silently prefers Azure and the author would ship a build
 * signed by something other than what they chose. The protocol's unions make
 * that unrepresentable, and this file keeps it that way by returning exactly one
 * arm per platform.
 */

type WindowsConfiguration = NonNullable<Configuration["win"]>;
type MacConfiguration = NonNullable<Configuration["mac"]>;

/**
 * Which platform a signing block is for. The two unions share no `source` value,
 * so one field tells them apart - and the callers below still check the target's
 * platform first, because a block on the wrong target is a manager bug that
 * should fail loudly rather than produce a config section nobody meant.
 */
export function isMacSigning(
    signing: GameBuildWorkerWindowsSigning | GameBuildWorkerMacSigning,
): signing is GameBuildWorkerMacSigning {
    return signing.source === "keychain" || signing.source === "p12";
}

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
 * The `mac` block for a macOS target, signed or not.
 *
 * Both halves of the unsigned case are deliberate, and neither is a default:
 *
 * `identity: null` means "do not sign". Left unset, electron-builder searches
 * the login keychain and signs with whatever Developer ID it finds - so a
 * machine that happens to have a certificate would produce a signed build that
 * preflight had just called unsigned, using an identity the author never chose
 * for this project.
 *
 * `notarize: false` is needed even then, because notarization is configured
 * entirely through environment variables (see `withNotarizationEnv`). An author
 * with `APPLE_ID` exported for their own tooling would otherwise have every
 * build reach Apple's service uninvited.
 */
export function macSigningConfiguration(signing: GameBuildWorkerMacSigning | null): { mac: MacConfiguration } {
    if (signing === null) {
        return { mac: { identity: null, notarize: false } };
    }
    const notarize = { notarize: Boolean(signing.notarization) };
    if (signing.source === "keychain") {
        return { mac: { identity: signing.identity, ...notarize } };
    }
    // cscLink takes the path directly; electron-builder imports it into a
    // throwaway keychain for the build and removes it afterwards. `identity` is
    // left unset on purpose - the imported certificate is the only one in that
    // keychain, so naming it again could only disagree with it.
    return {
        mac: {
            cscLink: signing.certificateFile,
            cscKeyPassword: signing.certificatePassword,
            ...notarize,
        },
    };
}

/** What to say about a macOS target's signature in the build log. Never the password. */
export function describeMacSigning(signing: GameBuildWorkerMacSigning): string {
    const how = signing.source === "keychain"
        ? `signing with the keychain identity ${signing.identity}`
        : "signing with a certificate file";
    return signing.notarization
        ? `${how}, then notarizing with Apple (this reaches the network and can take several minutes)`
        : `${how}; not notarizing, so macOS Gatekeeper will still warn on first launch`;
}

/**
 * The notarization credentials for this build, if any target carries them.
 *
 * One set for the whole run, like `signtoolPathForTargets`: the environment is
 * process-wide, so per-target values could not be honoured even if they differed.
 * Only one macOS target can exist in a build anyway - `hostCanBuildTarget` keeps
 * macOS to macOS hosts and each platform appears once.
 */
export function notarizationForTargets(targets: GameBuildWorkerTarget[]): GameBuildWorkerNotarization | null {
    for (const target of targets) {
        const signing = target.signing;
        if (target.platform === "macos" && signing && isMacSigning(signing) && signing.notarization) {
            return signing.notarization;
        }
    }
    return null;
}

/**
 * Run `body` with the App Store Connect variables @electron/notarize reads.
 *
 * Environment variables are not a shortcut here, they are the whole interface:
 * `MacTargetHelper.getNotarizeOptions` builds its options from `process.env` and
 * reads nothing from the configuration object, so there is no other way to pass
 * these. The previous values are restored afterwards, and the *other* two
 * credential routes Apple supports are cleared for the duration - an author with
 * `APPLE_ID` exported would otherwise win the precedence check inside
 * getNotarizeOptions and notarize under an identity Studio was not given.
 *
 * A null credential set leaves the environment untouched; `mac.notarize: false`
 * is what keeps that case from notarizing at all.
 */
export async function withNotarizationEnv<T>(
    notarization: GameBuildWorkerNotarization | null,
    body: () => Promise<T>,
): Promise<T> {
    if (!notarization) {
        return body();
    }
    const managed = {
        APPLE_API_KEY: notarization.keyFile,
        APPLE_API_KEY_ID: notarization.keyId,
        APPLE_API_ISSUER: notarization.issuerId,
        APPLE_ID: undefined,
        APPLE_APP_SPECIFIC_PASSWORD: undefined,
        APPLE_TEAM_ID: undefined,
        APPLE_KEYCHAIN: undefined,
        APPLE_KEYCHAIN_PROFILE: undefined,
    } satisfies Record<string, string | undefined>;

    const previous = new Map<string, string | undefined>();
    for (const [name, value] of Object.entries(managed)) {
        previous.set(name, process.env[name]);
        if (value === undefined) {
            delete process.env[name];
        } else {
            process.env[name] = value;
        }
    }
    try {
        return await body();
    } finally {
        for (const [name, value] of previous) {
            if (value === undefined) {
                delete process.env[name];
            } else {
                process.env[name] = value;
            }
        }
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
        if (!signing || isMacSigning(signing) || signing.source === "azure") {
            continue;
        }
        if (signing.signtoolPath) {
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
