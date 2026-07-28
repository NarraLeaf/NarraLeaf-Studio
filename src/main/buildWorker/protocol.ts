import type {
    GameBuildArch,
    GameBuildCompression,
    GameBuildDesktopPlatform,
    GameBuildFormat,
} from "@shared/types/gameBuild";
import type { MobileShellManifest, MobileShellOrientation } from "./mobile/mobileShellManifest";
import type { SigningIdentity } from "./mobile/signingIdentity";

/**
 * Message protocol between GameBuildManager (main process) and the packaging
 * worker (utility process). The worker only ever sees plain JSON: every path
 * and option is resolved by the manager before the fork.
 */

/**
 * Signing material, already resolved.
 *
 * The vault (`managers/security/signingVault.ts`) is the only thing that can
 * unseal a password, and it runs in the main process; by the time anything here
 * exists, the manager has looked up the credential, unsealed its secrets and
 * turned every vault-relative name into an absolute path. The worker just uses
 * what it is handed - it never learns a credential id, never reads
 * credentials.json, and never decides whether to sign.
 *
 * These carry plain passwords, so nothing that receives one may log it. The
 * worker's log channel goes straight to the author's console.
 *
 * The blocks sit where their consumer reads them, which is four places:
 * `GameBuildWorkerTarget.signing` (Windows, inside electron-builder),
 * `GameBuildWorkerConfig.gpg` (detached signatures over every finished
 * artifact), and `mobile.android.signing` / `mobile.ios.signing` (inside the
 * repack, after the package is assembled).
 */

/** What both signtool-driven Windows paths share. */
type WindowsSigntoolCommon = {
    /**
     * RFC 3161 timestamp authority. A timestamp is what keeps a signature valid
     * after the certificate expires - and it is a network call, which preflight
     * warns about. Unset leaves electron-builder's own default.
     */
    rfc3161TimeStampServer?: string;
    /**
     * Absolute path of the signtool.exe to use, exported as SIGNTOOL_PATH.
     * Unset lets electron-builder download its own Windows Kits bundle, which
     * needs a network. Resolved by the manager (a host probe, not a decision
     * the worker can make); the discovery itself lands with the Windows batch.
     */
    signtoolPath?: string;
};

/**
 * Windows Authenticode. The three sources are mutually exclusive by
 * construction: electron-builder refuses to combine `win.signtoolOptions` with
 * `win.azureSignOptions` (it silently prefers Azure), so a union rather than one
 * flat record with optional halves.
 */
export type GameBuildWorkerWindowsSigning =
    | (WindowsSigntoolCommon & {
        /** A PFX file and its password -> `win.signtoolOptions.certificateFile`/`certificatePassword`. */
        source: "pfx";
        certificateFile: string;
        certificatePassword: string;
    })
    | (WindowsSigntoolCommon & {
        /**
         * A certificate already in the Windows certificate store, typically on a
         * hardware token or HSM -> `win.signtoolOptions.certificateSubjectName`
         * or `certificateSha1`. At least one of the two is set; signing this way
         * only works from Windows.
         */
        source: "certificate-store";
        certificateSubjectName?: string;
        certificateSha1?: string;
    })
    | {
        /**
         * Azure Trusted Signing -> `win.azureSignOptions`. The Entra credentials
         * are NOT here: the Azure tooling reads them from the host environment
         * itself, and Studio deliberately does not hold them.
         */
        source: "azure";
        endpoint: string;
        codeSigningAccountName: string;
        certificateProfileName: string;
        publisherName: string;
    };

/**
 * The GPG identity for detached signatures over the finished artifacts. Only a
 * key id: the private key stays in the host's gpg-agent and Studio never sees
 * it, which is why this block has no password.
 */
export type GameBuildWorkerGpgSigning = {
    /** `gpg --local-user <keyId>`. */
    keyId: string;
    /** Absolute gpg binary; unset means the one on PATH. */
    gpgPath?: string;
};

/**
 * An Android release keystore. Unlike the other platforms the container is
 * handed over unopened - reading PKCS#12/JKS lives in the worker beside the APK
 * signer that consumes the key - so both passwords travel with it.
 */
export type GameBuildWorkerAndroidSigning = {
    /** Absolute path of the vault's copy (.p12 / .jks / .keystore). */
    keystoreFile: string;
    /** Which entry in the keystore to sign with. */
    alias: string;
    storePassword: string;
    keyPassword: string;
};

/**
 * An Apple signing identity. The .p12 must carry its issuing chain, not just
 * the leaf certificate: a signer given only the leaf cannot build the chain the
 * signature needs and fails outright.
 */
export type GameBuildWorkerIosSigning = {
    /** Absolute path of the vault's copy of the .p12. */
    p12File: string;
    p12Password: string;
    /** Absolute path of the vault's copy of the .mobileprovision to embed. */
    provisioningProfileFile: string;
    /**
     * Absolute path of the vendored signing tool, resolved by the manager like
     * every other path here.
     *
     * Worth stating why it is not worked out in the worker: the tool lives
     * beside the app under `resources/`, and where that is differs between a dev
     * checkout and a packaged install. A worker-side derivation would be a
     * second copy of knowledge the manager already has, and its packaged branch
     * is precisely the one that cannot be exercised outside a real installer -
     * so a change to the packaging layout would break signed iOS builds in a
     * release and nowhere before it.
     */
    toolPath: string;
};

export type GameBuildWorkerFuses = {
    runAsNode: boolean;
    enableCookieEncryption: boolean;
    enableNodeOptionsEnvironmentVariable: boolean;
    enableNodeCliInspectArguments: boolean;
    enableEmbeddedAsarIntegrityValidation: boolean;
    onlyLoadAppFromAsar: boolean;
    grantFileProtocolExtraPrivileges: boolean;
    resetAdHocDarwinSignature: boolean;
};

export type GameBuildWorkerTarget = {
    platform: GameBuildDesktopPlatform;
    formats: GameBuildFormat[];
    /** The single arch to package for; see GameBuildTarget.arch for why one. */
    arch: GameBuildArch;
    /** Electron fuse set for this platform's binaries. */
    fuses: GameBuildWorkerFuses;
    /**
     * Local Electron dist to package from. Only set when the target matches
     * the host platform; cross builds leave it unset so electron-builder
     * downloads (and caches) the right dist.
     */
    electronDist?: string;
    /**
     * Absolute path of the app icon for this platform. electron-builder
     * converts a large PNG to the native format (.icns/.ico) as needed; unset
     * falls back to the default Electron icon.
     */
    iconPath?: string;
    /**
     * Code signing for this target's binaries and installers, done inside
     * electron-builder. Present only on Windows targets: macOS signing needs
     * Apple tooling that runs on a Mac (a separate batch), and Linux packages
     * carry no OS-level signature - their integrity ships as the detached GPG
     * signatures in `GameBuildWorkerConfig.gpg`.
     */
    signing?: GameBuildWorkerWindowsSigning;
};

/**
 * Web export packaging job. The compiled static site is finished as-is -
 * no electron-builder involved: "dir" copies it into the output directory,
 * "zip" archives it (site files at the archive root, ready to upload).
 */
export type GameBuildWorkerWebJob = {
    /** Compiled static-site dir (output of the web artifact compile). */
    sourceDir: string;
    /** Subset of ["zip", "dir"]. */
    formats: GameBuildFormat[];
    /** Folder name (under outputDir) the "dir" format is copied to. */
    dirName: string;
    /** File name (under outputDir) the "zip" format is written to. */
    zipName: string;
};

/**
 * Mobile repack job. Both platforms share one job because they share the
 * compiled site and every piece of identity derived from it; each block is
 * present only when that platform was selected.
 *
 * Everything the repack cannot decide for itself is resolved by the manager
 * before the fork: the signing identity, the version code, the normalized
 * package name / bundle id, and the scaled icons (nativeImage is a main-process
 * API). The worker only reads files and moves bytes.
 */
export type GameBuildWorkerMobileJob = {
    /** Compiled static-site dir - the same web compile the web target uses. */
    sourceDir: string;
    /**
     * When set, every payload file is protected with this key at repack time,
     * and the same key is written into shell-config.json for the shell's
     * decoder. Absent for a plain build. It is all-or-nothing: the shell assumes
     * every file under wwwRoot is protected, so a partial layout is not allowed.
     * The compiled site on disk (`sourceDir`, shared with the web target) is
     * never touched — the protection happens as bytes are read into the package.
     */
    contentKey?: string;
    /** The shell template contract, already validated by the manager. */
    templateManifest: MobileShellManifest;
    /** Home-screen name (Android label / CFBundleDisplayName) and .app dir name. */
    productName: string;
    /** Sanitized, path-safe base for the `Payload/<name>.app` directory. */
    appDirBaseName: string;
    orientation: MobileShellOrientation;
    /**
     * The mobile variant of index.html, injected over the compiled site's copy.
     * Passed rather than re-compiled so the shared staging-web dir stays exactly
     * what the web target ships.
     */
    indexHtmlOverride: string;
    /** shell-config.json payload, written verbatim into the template. */
    shellConfigJson: string;
    android?: {
        /** Template APK for the variant the manager picked (release/debug). */
        templateApkPath: string;
        /** File name written under outputDir. */
        outputName: string;
        /** Already through normalizeAndroidPackageName. */
        applicationId: string;
        /** android:versionName - the project's raw semver. */
        versionName: string;
        /** android:versionCode - monotonic integer from deriveAndroidVersionCode. */
        versionCode: number;
        /** Icon slot (zip entry path) → absolute path of the scaled PNG. */
        iconPngBySlot?: Record<string, string>;
        /**
         * The sideload-only debug identity, always present. Used when `signing`
         * is absent, and only then.
         */
        signingIdentity: SigningIdentity;
        /**
         * The author's own release keystore, when the project points at one. It
         * replaces `signingIdentity` rather than adding to it: an APK carries
         * one signer, and installing over a build signed by the other identity
         * fails on the device until the old one is uninstalled.
         */
        signing?: GameBuildWorkerAndroidSigning;
    };
    ios?: {
        templateAppZipPath: string;
        outputName: string;
        /** Already through normalizeIosBundleId. */
        bundleId: string;
        /** Numeric three-part version; shared with bundleVersion. */
        shortVersionString: string;
        bundleVersion: string;
        /** Icon slot (path relative to the .app) → absolute path of the scaled PNG. */
        iconPngBySlot?: Record<string, string>;
        /**
         * The Apple identity to sign the .ipa with. Absent leaves the package
         * unsigned - which iOS will not install, but which is still the useful
         * artifact for someone who signs it themselves afterwards.
         */
        signing?: GameBuildWorkerIosSigning;
    };
};

export type GameBuildWorkerConfig = {
    /**
     * Compiled staging app dir (contains package.json + runtime + payload).
     * Required whenever `targets` is non-empty; a web-only build has none.
     */
    appDir?: string;
    /** Absolute directory artifacts are written into. */
    outputDir: string;
    appId: string;
    productName: string;
    /** Sanitized, path-safe artifact base name. */
    artifactBaseName: string;
    electronVersion: string;
    /** Copyright line embedded in the binaries; unset leaves it to electron-builder. */
    copyright?: string;
    /** Payload compression; unset uses electron-builder's default ("maximum"). */
    compression?: GameBuildCompression;
    /** Download mirror for Electron dists (cross builds); empty = official. */
    electronMirror?: string;
    /** Glob patterns kept outside the asar as real files. */
    asarUnpack: string[];
    /** Desktop packaging jobs, one per platform (electron-builder). */
    targets: GameBuildWorkerTarget[];
    /**
     * GPG identity for the detached signatures over the finished artifacts.
     * Build-level rather than per-target because the signatures cover every
     * artifact the build produced, not only the Linux ones - even though the
     * project selects this credential under its "linux" slot, which is where
     * the format's own conventions (SHA256SUMS + .asc) come from.
     */
    gpg?: GameBuildWorkerGpgSigning;
    /** Optional web export job, packaged without electron-builder. */
    web?: GameBuildWorkerWebJob;
    /** Optional mobile repack job, packaged without electron-builder. */
    mobile?: GameBuildWorkerMobileJob;
};

export type GameBuildWorkerStartMessage = {
    type: "start";
    config: GameBuildWorkerConfig;
};

export type GameBuildWorkerLogMessage = {
    type: "log";
    level: "info" | "warning" | "error";
    message: string;
};

export type GameBuildWorkerDoneMessage = {
    type: "done";
    /** Absolute paths of the artifacts electron-builder reported. */
    artifacts: string[];
};

export type GameBuildWorkerErrorMessage = {
    type: "error";
    message: string;
};

export type GameBuildWorkerInboundMessage = GameBuildWorkerStartMessage;

export type GameBuildWorkerOutboundMessage =
    | GameBuildWorkerLogMessage
    | GameBuildWorkerDoneMessage
    | GameBuildWorkerErrorMessage;
