import crypto from "crypto";
import fs from "fs/promises";
import path from "path";
import { safeStorage, shell, utilityProcess, type UtilityProcess } from "electron";
import { RUNTIME_BUNDLE_FILENAME, RUNTIME_SUPPORT_FILENAME } from "@narraleaf/encryption";
import { App } from "@/app/app";
import { UserDataNamespace } from "@shared/types/constants";
import type { DevModeConsoleLogPayload } from "@shared/types/devMode";
import type { GameRuntimeLaunchEntry } from "@shared/types/gameRuntime";
import {
    currentGameBuildPlatform,
    deriveAndroidVersionCode,
    deriveGameAppId,
    deriveIosBundleVersion,
    GAME_BUILD_FORMATS_BY_PLATFORM,
    hostCanBuildTarget,
    isDesktopBuildPlatform,
    isMobileBuildPlatform,
    mobileExportFileName,
    normalizeAndroidPackageName,
    normalizeGameBuildArch,
    normalizeIosBundleId,
    webExportDirName,
    webExportZipName,
    type BuildPreflightFinding,
    type GameBuildDesktopPlatform,
    type GameBuildMobilePlatform,
    type GameBuildRequest,
    type GameBuildStateSnapshot,
    type GameBuildTarget,
} from "@shared/types/gameBuild";
import {
    SIGNING_CREDENTIAL_MATERIAL_FIELDS,
    SIGNING_CREDENTIAL_PLATFORM,
    SIGNING_CREDENTIAL_SECRET_FIELDS,
    signingNotarizes,
    type ResolvedAppleNotarization,
    type ResolvedSigningMaterial,
    type SigningCredential,
    type SigningPlatform,
} from "@shared/types/signing";
import { resolveGameRuntimeInitialBackgroundColor } from "@shared/utils/gameRuntimeEntrySurface";
import { Fs } from "@shared/utils/fs";
import type { ProjectConfigData } from "@shared/utils/nlproj";
import { sanitizeProjectFileName } from "@shared/utils/nlproj";
import {
    buildDependencyPlatformKey,
    checkBuildDependencies,
    checkIcon,
    checkOutputDir,
    collectBuildDependencyRequirements,
    collectSidecarRequirements,
    daysUntil,
    findGpgBinary,
    isValidProjectVersion,
    MIN_ICON_SIZE,
    readMobileOrientation,
    readProjectIdentifier,
    readProjectSigningIds,
    readProjectVersion,
    sidecarLosesExecBit,
    sidecarTargetPlatform,
    signingCredentialSupportedOnHost,
    signingExpiryCode,
    signingPlatformForTarget,
    signingReachesNetwork,
} from "./preflight";
import { findMacSigningIdentities, macIdentityPresent } from "./macSigningIdentity";
import { findSigntool } from "./signtoolDiscovery";
import { readIconSlotSizes, writeScaledIcons } from "./mobileIcons";
import { loadMobileShellTemplateForApp } from "./mobileShellTemplate";
import { resolveMobileSigningIdentity } from "./mobileSigningIdentity";
import { payloadExceedsLimit } from "../../../../buildWorker/mobile/runMobileRepack";
import { resolveZsignTool, type ZsignTool } from "../../../../buildWorker/mobile/zsignTool";
import {
    parseProvisioningProfile,
    profileCoversBundleId,
    type ProvisioningProfile,
} from "../../../../buildWorker/mobile/provisioningProfile";
import type { MobileShellConfigV1 } from "@/buildWorker/mobile/mobileShellManifest";
import { readProjectConfigFromDir } from "../../utils/projectConfigFile";
import { emitWorkspaceConsoleLog } from "../../utils/workspaceConsole";
import { getWorkspaceFreeze, workspaceFrozenMessage } from "../../utils/workspaceFreeze";
import { certificateContainer, certificateExpiry, inspectCertificateFile } from "../security/certificateInspect";
import { resolvePackEncryptionKey } from "../security/packKeyService";
import { SigningVault, type SecretSealer } from "../security/signingVault";
import { type GameRuntimeArtifactCompileResult } from "../preview/compiler/gameRuntimeArtifactCompiler";
import { compileGameRuntimeArtifactInWorker } from "../preview/compiler/compileGameRuntimeArtifactInWorker";
import { buildWebIndexHtml, WEB_APPLE_TOUCH_FILENAME, WEB_FAVICON_FILENAME } from "../preview/compiler/webShell";
import { formatPreviewProcessOutput } from "../preview/PreviewManager";
import { selectRuntimePluginsForPack, type RuntimePluginPackSelection } from "../preview/selectRuntimePlugins";
import type {
    GameBuildWorkerAndroidSigning,
    GameBuildWorkerConfig,
    GameBuildWorkerFuses,
    GameBuildWorkerGpgSigning,
    GameBuildWorkerIosSigning,
    GameBuildWorkerMacSigning,
    GameBuildWorkerMobileJob,
    GameBuildWorkerOutboundMessage,
    GameBuildWorkerWindowsSigning,
} from "@/buildWorker/protocol";

type BuildSession = {
    id: string;
    projectPath: string;
    snapshot: GameBuildStateSnapshot;
    worker: UtilityProcess | null;
    cancelled: boolean;
};

const DEFAULT_OUTPUT_DIR_NAME = "dist";
/** Reverse-domain identifiers usable as a bundle/app id verbatim. */
const APP_ID_PATTERN = /^[A-Za-z0-9]([A-Za-z0-9-]*[A-Za-z0-9])?(\.[A-Za-z0-9]([A-Za-z0-9-]*[A-Za-z0-9])?)+$/;

type ElectronDistResolverApp = Pick<App, "isPackaged" | "resolveResource">;

/**
 * Locate the local Electron dist matching the host platform. Development runs
 * from node_modules/electron/dist (the running binary lives inside it);
 * packaged Studio ships the same dist as the embedded preview runner.
 */
export function resolveElectronDistDirForApp(
    app: ElectronDistResolverApp,
    currentExecutable = process.execPath,
): string {
    if (app.isPackaged()) {
        return app.resolveResource(path.join("preview-runner", "dist"));
    }
    if (process.platform === "darwin") {
        // <dist>/Electron.app/Contents/MacOS/Electron
        return path.resolve(currentExecutable, "..", "..", "..", "..");
    }
    // <dist>/electron[.exe]
    return path.dirname(currentExecutable);
}

// Moved to @shared/types/gameBuild so the build dialog derives the displayed
// app id with the same function that packages it. Re-exported here for callers
// that already knew this address.
export { deriveGameAppId };

/**
 * Fixed hardening fuse set for shipped games; not user-configurable.
 *
 * `hasSigningIdentity` gates asar integrity validation. That fuse hard-quits
 * the app on any post-package mutation of app.asar - real tamper-evidence when
 * a trusted signature seals the embedded hash, but on an ad-hoc/unsigned build
 * it is downside-only: an attacker just recomputes the hash and re-signs
 * ad-hoc, while ordinary players get a silent hard-crash if antivirus, disk
 * corruption or an updater ever touches the archive. It also does not cover
 * the asset payload, which ships outside the asar with its own protection. So
 * it stays off until real code signing is configured, at which point it earns
 * its keep. (Linux has no asar-integrity support regardless.)
 */
export function gameFusesForPlatform(platform: GameBuildDesktopPlatform, hasSigningIdentity: boolean): GameBuildWorkerFuses {
    return {
        runAsNode: false,
        // Left off deliberately: a game stores no Chromium cookies (saves and
        // persistence are its own JSON stores), and enabling OS cookie
        // encryption makes the first launch prompt for keychain/secret-store
        // access - a bad first impression for zero security gain here.
        enableCookieEncryption: false,
        enableNodeOptionsEnvironmentVariable: false,
        enableNodeCliInspectArguments: false,
        enableEmbeddedAsarIntegrityValidation: hasSigningIdentity && platform !== "linux",
        onlyLoadAppFromAsar: true,
        grantFileProtocolExtraPrivileges: false,
        resetAdHocDarwinSignature: platform === "macos",
    };
}

/** The signing material a build resolved, by the slot the project selected it under. */
export type ResolvedBuildSigning = Partial<Record<SigningPlatform, ResolvedSigningMaterial>>;

/**
 * Whether a desktop target ships with a real code signature, which is what
 * `gameFusesForPlatform` turns asar integrity validation on for.
 *
 * Windows and macOS can both answer yes; Linux never can. Its "signing" is
 * detached GPG signatures over the artifacts - distribution integrity, not an
 * OS-enforced signature over the binary - and Electron has no asar-integrity
 * support there regardless.
 */
export function hasSigningIdentityForPlatform(
    platform: GameBuildDesktopPlatform,
    signing: ResolvedBuildSigning,
): boolean {
    switch (platform) {
        case "windows":
            return Boolean(signing.windows);
        case "macos":
            return Boolean(signing.macos);
        case "linux":
            return false;
    }
}

/**
 * Whether every password this material needs actually came back unsealed. A
 * `null` means the keyring refused (it is unavailable, or the credential was
 * imported under a different OS account) - never that the password is empty.
 *
 * Exhaustive rather than defaulting to true: a new credential kind with a secret
 * must state its answer here, or a build would carry a null password into the
 * worker and fail somewhere far less legible.
 */
export function signingSecretsResolved(material: ResolvedSigningMaterial): boolean {
    switch (material.kind) {
        case "windows-pfx":
            return material.password !== null;
        case "android-keystore":
            return material.storePassword !== null && material.keyPassword !== null;
        case "ios-apple":
        case "macos-apple":
            return material.p12Password !== null;
        case "windows-store":
        case "windows-azure":
        case "macos-keychain":
        case "linux-gpg":
            return true;
    }
}

/**
 * Map an unsealed credential onto what electron-builder needs for Authenticode.
 * Returns null when the credential is not a Windows one, or when its password
 * never came back - callers check `signingSecretsResolved` first so they can say
 * which of the two happened.
 */
export function toWorkerWindowsSigning(
    material: ResolvedSigningMaterial,
    options: { signtoolPath?: string } = {},
): GameBuildWorkerWindowsSigning | null {
    // The timestamp server is left unset throughout: electron-builder's own
    // default (DigiCert) is the same one we would name, and no credential kind
    // carries an override to honour yet.
    const common = options.signtoolPath ? { signtoolPath: options.signtoolPath } : {};
    switch (material.kind) {
        case "windows-pfx":
            return material.password === null
                ? null
                : { source: "pfx", certificateFile: material.file, certificatePassword: material.password, ...common };
        case "windows-store":
            return {
                source: "certificate-store",
                ...(material.subjectName ? { certificateSubjectName: material.subjectName } : {}),
                ...(material.sha1 ? { certificateSha1: material.sha1 } : {}),
                ...common,
            };
        case "windows-azure":
            return {
                source: "azure",
                endpoint: material.endpoint,
                codeSigningAccountName: material.codeSigningAccountName,
                certificateProfileName: material.certificateProfileName,
                publisherName: material.publisherName,
            };
        default:
            return null;
    }
}

/**
 * Map an unsealed credential onto what electron-builder needs to sign a macOS
 * build, and to notarize it when the credential carries the key for that.
 *
 * Returns null for a credential that is not a macOS one, or whose .p12 password
 * never came back - callers check `signingSecretsResolved` first so they can say
 * which of the two happened.
 */
export function toWorkerMacSigning(material: ResolvedSigningMaterial): GameBuildWorkerMacSigning | null {
    // The vault refuses a partial set at import, so all three fields are here or
    // none are; this re-reads them rather than trusting that, because the index
    // is a file on the author's disk.
    const notarization = signingNotarizes(material as Partial<ResolvedAppleNotarization>)
        ? {
            notarization: {
                keyFile: (material as ResolvedAppleNotarization).notaryKeyFile as string,
                keyId: (material as ResolvedAppleNotarization).notaryKeyId as string,
                issuerId: (material as ResolvedAppleNotarization).notaryIssuerId as string,
            },
        }
        : {};
    switch (material.kind) {
        case "macos-keychain":
            return { source: "keychain", identity: material.identity, ...notarization };
        case "macos-apple":
            return material.p12Password === null
                ? null
                : {
                    source: "p12",
                    certificateFile: material.p12File,
                    certificatePassword: material.p12Password,
                    ...notarization,
                };
        default:
            return null;
    }
}

/** Map an unsealed credential onto the GPG identity the artifact signatures use. */
export function toWorkerGpgSigning(material: ResolvedSigningMaterial): GameBuildWorkerGpgSigning | null {
    if (material.kind !== "linux-gpg") {
        return null;
    }
    return { keyId: material.keyId, ...(material.gpgPath ? { gpgPath: material.gpgPath } : {}) };
}

/** Map an unsealed credential onto the Android release keystore the repack signs with. */
export function toWorkerAndroidSigning(material: ResolvedSigningMaterial): GameBuildWorkerAndroidSigning | null {
    if (material.kind !== "android-keystore"
        || material.storePassword === null
        || material.keyPassword === null) {
        return null;
    }
    return {
        keystoreFile: material.file,
        alias: material.alias,
        storePassword: material.storePassword,
        keyPassword: material.keyPassword,
    };
}

/**
 * The path of the resolved iOS signing tool, or a build failure.
 *
 * Throws rather than returning null: by the time this is asked, the author has
 * chosen an Apple credential, and quietly emitting an unsigned .ipa - a package
 * iOS refuses to install - is the one outcome worse than stopping. Preflight
 * asks the same question while the dialog is open, so this is the backstop
 * rather than the usual path.
 */
export function iosSigningToolPathFrom(tool: ZsignTool): string {
    if (!tool.available) {
        throw new Error(`This build asks for a signed iOS package, but ${tool.detail}.`);
    }
    return tool.path;
}

/**
 * Map an unsealed credential onto the Apple identity the .ipa is signed with.
 *
 * `toolPath` comes in rather than being looked up here so this stays a pure
 * mapping, but it is not optional: a job that asks for a signed .ipa without a
 * tool to sign it with should never reach the worker.
 */
export function toWorkerIosSigning(
    material: ResolvedSigningMaterial,
    toolPath: string,
): GameBuildWorkerIosSigning | null {
    if (material.kind !== "ios-apple" || material.p12Password === null) {
        return null;
    }
    return {
        p12File: material.p12File,
        p12Password: material.p12Password,
        provisioningProfileFile: material.provisioningProfileFile,
        toolPath,
    };
}

/**
 * Electron's keyring. Wrapped in functions rather than passed as methods so the
 * vault's own guards catch a host where `safeStorage` is unavailable, instead of
 * this module throwing at import time.
 */
const electronSealer: SecretSealer = {
    isEncryptionAvailable: () => safeStorage.isEncryptionAvailable(),
    encryptString: (plainText: string) => safeStorage.encryptString(plainText),
    decryptString: (encrypted: Buffer) => safeStorage.decryptString(encrypted),
};

export class GameBuildManager {
    private readonly sessions = new Map<string, BuildSession>();
    /** Lazily built: the vault needs a user-data dir, which a test double has no reason to provide. */
    private signingVaultCache: SigningVault | null = null;

    constructor(private readonly app: App) {}

    public getStatus(projectPath: string): GameBuildStateSnapshot {
        return this.sessions.get(this.projectKey(projectPath))?.snapshot ?? { status: "idle" };
    }

    /**
     * Run the build's own checks without building, so the dialog can show what
     * would go wrong before the user commits. Advisory only: `run` re-checks
     * everything and stays the authority (see preflight.ts).
     *
     * Deliberately NOT refused while the workspace is frozen. It starts no work
     * and writes nothing - every check here reads (`checkOutputDir` probes with
     * `access`, the vault answers `secretsAvailable` without unsealing) - so
     * there is nothing for a freeze to be inconsistent with, and refusing would
     * replace the dialog's findings with an error about a build nobody asked
     * for yet. {@link start} is where the refusal belongs.
     */
    public async preflight(projectPath: string, request: GameBuildRequest): Promise<BuildPreflightFinding[]> {
        const normalizedProjectPath = path.resolve(projectPath);
        const projectConfig = await readProjectConfigFromDir(normalizedProjectPath).catch(() => null);
        const hostPlatform = currentGameBuildPlatform();
        const targets = normalizeTargets(request.targets);
        const findings: BuildPreflightFinding[] = [];

        if (targets.length === 0) {
            findings.push({ code: "no-targets", severity: "error", section: "targets" });
        }
        const desktopTargets = targets.filter(isDesktopTarget);
        for (const target of desktopTargets) {
            if (!hostCanBuildTarget(hostPlatform, target.platform)) {
                findings.push({
                    code: "unbuildable-platform",
                    severity: "error",
                    section: "targets",
                    detail: { platform: target.platform },
                });
            }
        }
        const crossTargets = desktopTargets.filter(
            target => target.platform !== hostPlatform && hostCanBuildTarget(hostPlatform, target.platform),
        );
        if (crossTargets.length > 0) {
            findings.push({
                code: "cross-build-download",
                severity: "warning",
                section: "targets",
                detail: { platforms: crossTargets.map(target => target.platform).join(", ") },
            });
        }

        const mobileTargets = targets.filter(isMobileTarget);
        const version = readProjectVersion(projectConfig);
        if (!version) {
            findings.push({ code: "version-missing", severity: "warning", section: "identity" });
        } else if (!isValidProjectVersion(version)) {
            findings.push({
                code: "version-invalid",
                severity: "error",
                section: "identity",
                detail: { version },
            });
        } else if (mobileTargets.some(target => target.platform === "android")
            && deriveAndroidVersionCode(version) === null) {
            // A version semver accepts but Android cannot encode blocks only
            // the Android target - the same project still builds elsewhere.
            findings.push({
                code: "version-uncodable",
                severity: "error",
                section: "identity",
                detail: { version },
            });
        }
        if (!readProjectIdentifier(projectConfig)) {
            findings.push({
                code: "identifier-missing",
                severity: "warning",
                section: "identity",
                detail: {
                    appId: deriveGameAppId(undefined, projectConfig?.name?.trim() || path.basename(normalizedProjectPath)),
                },
            });
        }
        const appId = deriveGameAppId(
            readProjectIdentifier(projectConfig),
            projectConfig?.name?.trim() || path.basename(normalizedProjectPath),
        );
        // Both mobile platforms normalize the app id, by opposite rules - the
        // shipped id can differ from the one shown everywhere else, so say so
        // rather than let them find out from the installed app's details.
        if (mobileTargets.some(target => target.platform === "android")) {
            const applicationId = normalizeAndroidPackageName(appId);
            if (applicationId !== appId) {
                findings.push({
                    code: "appid-android-adjusted",
                    severity: "warning",
                    section: "identity",
                    detail: { appId, applicationId },
                });
            }
        }
        if (mobileTargets.some(target => target.platform === "ios")) {
            const bundleId = normalizeIosBundleId(appId);
            if (bundleId !== appId) {
                findings.push({
                    code: "bundleid-ios-adjusted",
                    severity: "warning",
                    section: "identity",
                    detail: { appId, bundleId },
                });
            }
        }
        // Only icons for platforms actually being built are worth reporting.
        // "Missing" is reported once rather than per platform: with one master
        // behind every target, five copies of the same sentence said nothing
        // five times.
        const iconChecks = await Promise.all(
            [...desktopTargets, ...mobileTargets].map(async target => ({
                platform: target.platform,
                check: await checkIcon(normalizedProjectPath, projectConfig, target.platform),
            })),
        );
        if (iconChecks.length > 0 && iconChecks.every(({ check }) => check.status === "missing")) {
            findings.push({ code: "icon-missing", severity: "warning", section: "identity" });
        }
        for (const { platform, check } of iconChecks) {
            if (check.status === "unusable") {
                findings.push({
                    code: "icon-unusable",
                    severity: "warning",
                    section: "identity",
                    detail: { platform },
                });
                continue;
            }
            if (check.status !== "ok") {
                continue;
            }
            if (check.lowResolution) {
                findings.push({
                    code: "icon-low-resolution",
                    severity: "warning",
                    section: "identity",
                    detail: { platform, minimum: String(MIN_ICON_SIZE) },
                });
            }
            // An un-baked icon still ships, but it skipped the per-platform
            // recipe - no inset, and on iOS no flattening - so what lands on
            // the device is not what the panel drew.
            if (!check.baked) {
                findings.push({
                    code: "icon-stale",
                    severity: "warning",
                    section: "identity",
                    detail: { platform },
                });
            }
        }

        const pluginSelection = await this.selectRuntimePlugins(normalizedProjectPath, projectConfig);
        if (pluginSelection.errors.length > 0) {
            findings.push({
                code: "plugins-invalid",
                severity: "error",
                section: "content",
                detail: { errors: pluginSelection.errors.join("\n") },
            });
        }
        // Only desktop targets carry a plugin's native binaries, so only they
        // can need a build dependency fetched.
        const binaryPlatformKeys = [...new Set(desktopTargets.map(target => buildDependencyPlatformKey(
            target.platform,
            normalizeGameBuildArch(target.platform, target.arch),
        )))];
        const dependencyGaps = await checkBuildDependencies(
            this.app.getUserDataDir(),
            collectBuildDependencyRequirements(
                pluginSelection.selected.map(source => source.manifest),
                binaryPlatformKeys,
            ),
        );
        for (const gap of dependencyGaps) {
            findings.push({
                code: "build-dependency-unavailable",
                severity: "error",
                section: "content",
                detail: {
                    plugin: gap.pluginId,
                    dependency: gap.dependencyId,
                    platform: gap.platformKey,
                    url: gap.target.url,
                    reason: gap.reason,
                    path: gap.cachePath,
                },
            });
        }
        // Sidecars are the other half of the same story: what a plugin ships as
        // a native program, per platform. A platform it declares nothing for is
        // a supported shape (the runtime degrades), but the author has to hear
        // about it before the build, not from a player.
        for (const requirement of collectSidecarRequirements(
            pluginSelection.selected.map(source => source.manifest),
            binaryPlatformKeys,
        )) {
            if (!requirement.target) {
                findings.push({
                    code: "sidecar-target-missing",
                    severity: "warning",
                    section: "content",
                    detail: {
                        plugin: requirement.pluginId,
                        sidecar: requirement.sidecarId,
                        platform: requirement.platformKey,
                    },
                });
                continue;
            }
            if (sidecarLosesExecBit(requirement, hostPlatform)) {
                findings.push({
                    code: "sidecar-crossbuild-exec-bit",
                    severity: "error",
                    section: "targets",
                    detail: {
                        plugin: requirement.pluginId,
                        sidecar: requirement.sidecarId,
                        platform: requirement.platformKey,
                        targetPlatform: sidecarTargetPlatform(requirement.platformKey),
                    },
                });
            }
        }
        if (desktopTargets.length > 0 && this.encryptAssetsEnabled(projectConfig)) {
            const key = await this.resolveEncryptionKey(normalizedProjectPath, projectConfig).catch(() => undefined);
            if (!key) {
                findings.push({ code: "encryption-key-unavailable", severity: "error", section: "content" });
            }
        }
        if (targets.some(target => target.platform === "web") && this.encryptAssetsEnabled(projectConfig)) {
            findings.push({ code: "web-unprotected", severity: "warning", section: "content" });
        }
        if (mobileTargets.length > 0) {
            findings.push(...await this.mobilePreflight(normalizedProjectPath));
        }
        findings.push(...await this.signingPreflight(
            projectConfig,
            targets,
            hostPlatform,
            normalizeIosBundleId(appId),
        ));

        const outputDir = request.outputDir?.trim()
            ? path.resolve(request.outputDir.trim())
            : path.join(normalizedProjectPath, DEFAULT_OUTPUT_DIR_NAME);
        const outputCheck = await checkOutputDir(outputDir);
        if (outputCheck === "not-writable") {
            findings.push({
                code: "output-not-writable",
                severity: "error",
                section: "output",
                detail: { outputDir },
            });
        } else if (outputCheck === "not-empty") {
            findings.push({ code: "output-not-empty", severity: "warning", section: "output" });
        }
        return findings;
    }

    /**
     * Kick off a build and return immediately; progress streams to the
     * workspace console and the renderer polls getStatus. One build per
     * project at a time.
     *
     * Refuses while the workspace is frozen. The Build control is already
     * disabled there, but a build is IPC straight into this method - a
     * keybinding, a plugin, a stale renderer or a second window can still ask,
     * and this is the only place that can say no (plan 2026-07-28-002 §4.3).
     */
    public start(projectPath: string, entry: GameRuntimeLaunchEntry, request: GameBuildRequest): GameBuildStateSnapshot {
        const normalizedProjectPath = path.resolve(projectPath);
        const key = this.projectKey(normalizedProjectPath);
        const existing = this.sessions.get(key);
        if (existing && isActiveStatus(existing.snapshot.status)) {
            return existing.snapshot;
        }
        const session: BuildSession = {
            id: crypto.randomUUID(),
            projectPath: normalizedProjectPath,
            snapshot: {
                status: "preparing",
                startedAt: Date.now(),
                // Deduplicated: one platform can appear as several targets (a zip and an installer
                // are two entries), and the snapshot names what is being built, not how many ways.
                platforms: [...new Set(request.targets.map(target => target.platform))],
            },
            worker: null,
            cancelled: false,
        };
        this.sessions.set(key, session);
        const frozen = getWorkspaceFreeze(normalizedProjectPath);
        if (frozen) {
            const message = workspaceFrozenMessage(frozen, "production build");
            // Refused before anything happens - before the checkpoint, before the
            // compile. Recorded on the session so the build dialog shows the
            // reason, and emitted verbatim rather than through failSession, whose
            // "build failed:" prefix would send the author looking for a broken
            // toolchain instead of at the revision they are reading.
            session.snapshot = {
                status: "error",
                startedAt: session.snapshot.startedAt,
                finishedAt: Date.now(),
                platforms: session.snapshot.platforms,
                error: message,
            };
            this.emit(session, { level: "error", source: "Build", message });
            return session.snapshot;
        }
        void this.run(session, entry, request).catch(error => {
            this.failSession(session, error instanceof Error ? error.message : String(error));
        });
        return session.snapshot;
    }

    public cancel(projectPath: string): GameBuildStateSnapshot {
        const session = this.sessions.get(this.projectKey(projectPath));
        if (!session || !isActiveStatus(session.snapshot.status)) {
            return session?.snapshot ?? { status: "idle" };
        }
        session.cancelled = true;
        if (session.worker) {
            session.worker.kill();
            session.worker = null;
        }
        this.failSession(session, "Build cancelled");
        this.emit(session, { level: "warning", source: "Build", message: "build cancelled" });
        return session.snapshot;
    }

    /**
     * Record a checkpoint before the build touches anything.
     *
     * One of the three unconditional checkpoints: a build is the moment an author most
     * wants a mark in the history, because it is what they will come back to when the
     * shipped thing is wrong. It writes into the output directory, which the author is
     * free to point inside the project.
     *
     * Best effort, and silent when there is nothing to do: a project with no repository,
     * a host with no backend, and an unchanged tree all answer "no revision" rather than
     * failing. A version control problem must never be the reason a build does not run.
     */
    private async checkpointBeforeBuild(session: BuildSession): Promise<void> {
        try {
            const result = await this.app.getVcsManager().checkpoint(session.projectPath, "build");
            if (result) {
                this.emit(session, {
                    level: "info",
                    source: "Build",
                    message: `version control checkpoint ${result.revision.slice(0, 12)}`,
                });
            }
        } catch (error) {
            this.emit(session, {
                level: "warning",
                source: "Build",
                message: `could not record a version control checkpoint: ${error instanceof Error ? error.message : String(error)}`,
            });
        }
    }

    private async run(session: BuildSession, entry: GameRuntimeLaunchEntry, request: GameBuildRequest): Promise<void> {
        const projectPath = session.projectPath;
        this.emit(session, { level: "info", source: "Build", message: "production build started" });

        await this.checkpointBeforeBuild(session);

        const projectConfig = await readProjectConfigFromDir(projectPath).catch(() => null);
        const hostPlatform = currentGameBuildPlatform();
        const targets = normalizeTargets(request.targets);
        if (targets.length === 0) {
            throw new Error("No build targets selected");
        }
        const desktopTargets = targets.filter(isDesktopTarget);
        const mobileTargets = targets.filter(isMobileTarget);
        // A platform outside the union (malformed non-UI payload) must also
        // fail loudly: with the explicit partitions above it would otherwise
        // fall into none of them and the build would "succeed" with zero
        // artifacts - worse than the TypeError the old desktop fall-through
        // produced.
        const unknownTargets = targets.filter(target =>
            !isDesktopBuildPlatform(target.platform)
            && !isMobileBuildPlatform(target.platform)
            && target.platform !== "web");
        if (unknownTargets.length > 0) {
            throw new Error(`Unknown build platform(s): ${unknownTargets.map(t => String(t.platform)).join(", ")}`);
        }
        const webTarget = targets.find(target => target.platform === "web");
        const webFormats = webTarget
            ? webTarget.formats.filter(format => GAME_BUILD_FORMATS_BY_PLATFORM.web.includes(format))
            : [];
        if (webTarget && webFormats.length === 0) {
            throw new Error("The web target has no usable format (expected zip or dir)");
        }
        // Defense in depth: the dialog already hides unbuildable platforms, but a
        // stored selection carried across hosts (or any non-UI caller) could still
        // ask for one. Fail early and clearly rather than deep inside electron-builder.
        // (The web target builds everywhere and needs no check.)
        const unbuildable = desktopTargets.filter(target => !hostCanBuildTarget(hostPlatform, target.platform));
        if (unbuildable.length > 0) {
            throw new Error(
                `Cannot build for ${unbuildable.map(t => t.platform).join(", ")} on this machine. ` +
                `macOS builds require a Mac; Linux builds require a Unix host.`,
            );
        }
        const identity = this.resolveIdentity(session, projectConfig, projectPath);
        // Everything the credentials this build needs unseals to. Resolved here,
        // before the compile: a credential this machine cannot use fails the
        // build either way, and finding out after several minutes of packing
        // assets is a worse way to learn it. See resolveSigningForBuild for why
        // a problem with a configured credential throws rather than degrades.
        const signing = await this.resolveSigningForBuild(session, projectConfig, targets);
        // Build-level rather than per-target: the detached signatures cover
        // every artifact this build writes, whatever platform produced it.
        const gpgSigning = signing.linux ? toWorkerGpgSigning(signing.linux) : null;

        const pluginSelection = await this.selectRuntimePlugins(projectPath, projectConfig);
        if (pluginSelection.errors.length > 0) {
            throw new Error(`Plugin validation failed:\n${pluginSelection.errors.join("\n")}`);
        }
        // Desktop and mobile both protect their assets on the same key; the web
        // export never does (its files are served over HTTP by nature). Resolving
        // once here keeps the desktop and mobile paths on one key.
        const encryptionKey = (desktopTargets.length > 0 || mobileTargets.length > 0)
            ? await this.resolveEncryptionKey(projectPath, projectConfig)
            : undefined;
        if (encryptionKey && desktopTargets.length > 0) {
            this.emit(session, { level: "info", source: "Build", message: "asset protection enabled; sealing pack" });
        }
        if (encryptionKey && mobileTargets.length > 0) {
            this.emit(session, { level: "info", source: "Build", message: "asset protection enabled; protecting the mobile payload" });
        }
        if (webTarget && this.encryptAssetsEnabled(projectConfig)) {
            this.emit(session, {
                level: "info",
                source: "Build",
                message: "asset protection does not apply to the web export; its files ship unprotected",
            });
        }
        this.ensureNotCancelled(session);

        session.snapshot = { ...session.snapshot, status: "compiling" };
        const runtimeDistDir = path.join(this.app.getDistDir(), "runtime");
        const runtimeVersion = this.readRuntimeVersion();
        let desktopArtifact: GameRuntimeArtifactCompileResult | null = null;
        // Plugin sidecars are per <platform>-<arch>, but one compiled app dir
        // serves every desktop target in the request (the packaging worker takes
        // a single appDir). So they can only ship when the request resolves to
        // one key: with several, one platform's package would carry the other's
        // binaries, and the game would try to spawn an executable its OS cannot
        // run. Ship none and say why, rather than ship the wrong one.
        const sidecarPlatformKeys = [...new Set(desktopTargets.map(target => buildDependencyPlatformKey(
            target.platform,
            normalizeGameBuildArch(target.platform, target.arch),
        )))];
        const sidecarPlatformKey = sidecarPlatformKeys.length === 1 ? sidecarPlatformKeys[0] : undefined;
        if (!sidecarPlatformKey
            && pluginSelection.selected.some(source => source.manifest.contributes.sidecars.length > 0)) {
            this.emit(session, {
                level: "warning",
                source: "Build",
                message: `plugin sidecars ship for one platform per build, but this build targets `
                    + `${sidecarPlatformKeys.join(", ")}; no sidecar is packaged. `
                    + "Build one desktop target at a time to include them.",
            });
        }
        if (desktopTargets.length > 0) {
            // Off the main thread: sealing a protected pack is many seconds of
            // synchronous native-codec CPU. session.worker tracks the compile so
            // cancel() kills it, same as the packaging worker below.
            desktopArtifact = await compileGameRuntimeArtifactInWorker(this.app, {
                projectPath,
                entry,
                runtimeDistDir,
                runtimeVersion,
                outputRoot: path.join(projectPath, ".nlstudio", "build", "staging"),
                runtimePlugins: pluginSelection.selected,
                mode: "production",
                encryptionKey,
                ...(sidecarPlatformKey ? { sidecarPlatformKey } : {}),
                // The compile runs in a utility process, so the build dependency
                // cache root travels with the input rather than being read from
                // Electron on the far side.
                hostUserDataDir: this.app.getUserDataDir(),
            }, {
                onStart: worker => { session.worker = worker; },
                cancelled: () => session.cancelled,
            });
            session.worker = null;
            this.emit(session, {
                level: "info",
                source: "Build",
                message: `game compiled (${desktopArtifact.copiedAssetCount} asset(s))`,
            });
            this.ensureNotCancelled(session);
        }
        // The mobile shells serve the very same static site the web target
        // exports, so both read one compile. Selecting web and Android together
        // must not compile the game twice.
        let webArtifact: GameRuntimeArtifactCompileResult | null = null;
        if (webTarget || mobileTargets.length > 0) {
            webArtifact = await compileGameRuntimeArtifactInWorker(this.app, {
                projectPath,
                entry,
                runtimeDistDir,
                runtimeVersion,
                outputRoot: path.join(projectPath, ".nlstudio", "build", "staging-web"),
                runtimePlugins: pluginSelection.selected,
                mode: "production",
                shell: "web",
            }, {
                onStart: worker => { session.worker = worker; },
                cancelled: () => session.cancelled,
            });
            session.worker = null;
            this.emit(session, {
                level: "info",
                source: "Build",
                message: `${webTarget ? "web export" : "game site"} compiled (${webArtifact.copiedAssetCount} asset(s))`,
            });
            this.ensureNotCancelled(session);
        }
        this.emit(session, { level: "info", source: "Build", message: "packaging..." });

        // The output dir is an absolute path chosen through the native folder
        // picker (or the "<project>/dist" default), so it is used as-is.
        const outputDir = request.outputDir?.trim()
            ? path.resolve(request.outputDir.trim())
            : path.join(projectPath, DEFAULT_OUTPUT_DIR_NAME);
        const electronMirror = this.readElectronMirror();
        const crossTargets = desktopTargets.filter(target => target.platform !== hostPlatform);
        if (electronMirror && crossTargets.length > 0) {
            this.emit(session, {
                level: "info",
                source: "Build",
                message: `cross-building for ${crossTargets.map(t => t.platform).join(", ")}; using Electron mirror ${electronMirror}`,
            });
        } else if (crossTargets.length > 0) {
            this.emit(session, {
                level: "info",
                source: "Build",
                message: `cross-building for ${crossTargets.map(t => t.platform).join(", ")}; downloading Electron on first use (cached afterwards)`,
            });
        }
        const workerConfig: GameBuildWorkerConfig = {
            ...(desktopArtifact ? { appDir: desktopArtifact.appDir } : {}),
            outputDir,
            appId: identity.appId,
            productName: identity.productName,
            artifactBaseName: identity.artifactBaseName,
            electronVersion: process.versions.electron,
            ...(identity.copyright ? { copyright: identity.copyright } : {}),
            ...(request.compression ? { compression: request.compression } : {}),
            ...(electronMirror ? { electronMirror } : {}),
            asarUnpack: buildAsarUnpackPatterns(Boolean(encryptionKey)),
            ...(gpgSigning ? { gpg: gpgSigning } : {}),
            targets: await Promise.all(desktopTargets.map(async target => ({
                platform: target.platform,
                formats: target.formats,
                arch: normalizeGameBuildArch(target.platform, target.arch),
                fuses: gameFusesForPlatform(target.platform, hasSigningIdentityForPlatform(target.platform, signing)),
                ...(target.platform === hostPlatform
                    ? { electronDist: resolveElectronDistDirForApp(this.app) }
                    : {}),
                ...await this.resolveTargetIcon(session, projectPath, projectConfig, target.platform),
                ...await this.resolveDesktopTargetSigning(session, target.platform, signing),
            }))),
            ...(webTarget && webArtifact ? {
                web: {
                    sourceDir: webArtifact.appDir,
                    formats: webFormats,
                    dirName: webExportDirName(identity.artifactBaseName, identity.version),
                    zipName: webExportZipName(identity.artifactBaseName, identity.version),
                },
            } : {}),
            ...(mobileTargets.length > 0 && webArtifact ? {
                mobile: await this.buildMobileJob(session, {
                    projectPath,
                    projectConfig,
                    identity,
                    platforms: mobileTargets.map(target => target.platform),
                    site: webArtifact,
                    // When set, the repack protects every payload file with this
                    // key and writes it into shell-config for the shell's decoder.
                    contentKey: encryptionKey,
                    signing,
                }),
            } : {}),
        };

        // Cancel may have landed during the async icon resolution above, while
        // no worker existed to kill; don't fork one in that case.
        this.ensureNotCancelled(session);
        session.snapshot = { ...session.snapshot, status: "packaging" };
        const artifacts = await this.runWorker(session, workerConfig);
        // A cancel that raced the worker's completion must win over "done".
        this.ensureNotCancelled(session);
        session.snapshot = {
            status: "done",
            startedAt: session.snapshot.startedAt,
            finishedAt: Date.now(),
            platforms: session.snapshot.platforms,
            artifacts,
            outputDir,
        };
        this.emit(session, {
            level: "success",
            source: "Build",
            message: artifacts.length > 0
                ? `build finished:\n${artifacts.map(a => path.relative(session.projectPath, a)).join("\n")}`
                : `build finished: ${path.relative(session.projectPath, outputDir)}`,
        });
        // Absent (older stored selections, non-UI callers) keeps the pre-setting
        // behaviour of always revealing.
        if (request.openWhenDone !== false) {
            this.revealOutput(outputDir);
        }
    }

    private revealOutput(outputDir: string): void {
        // Best-effort: surfacing the output folder must never fail a build.
        void shell.openPath(outputDir).catch(() => undefined);
    }

    /**
     * Resolve the configured app icon for a target platform into a worker
     * `iconPath`. An absent or corrupt icon falls back to NarraLeaf's mark - an
     * icon that is merely smaller than the packager's floor still ships,
     * upscaled, because a blurry version of the author's icon beats a packaged
     * game wearing somebody else's logo.
     */
    private async resolveTargetIcon(
        session: BuildSession,
        projectPath: string,
        projectConfig: ProjectConfigData | null,
        platform: GameBuildDesktopPlatform,
    ): Promise<{ iconPath?: string }> {
        const icon = await checkIcon(projectPath, projectConfig, platform);
        if (icon.status === "ok") {
            if (icon.lowResolution) {
                this.emit(session, {
                    level: "warning",
                    source: "Build",
                    message: `the ${platform} icon is smaller than ${MIN_ICON_SIZE}×${MIN_ICON_SIZE}; `
                        + "it ships upscaled",
                });
            }
            return { iconPath: icon.iconPath };
        }
        const fallback = this.app.getDefaultGameIconPath();
        this.emit(session, {
            level: "warning",
            source: "Build",
            message: (icon.status === "missing"
                ? `no ${platform} app icon configured; `
                : `the ${platform} icon could not be read; `)
                + (fallback ? "using the NarraLeaf icon" : "using the default Electron icon"),
        });
        return fallback ? { iconPath: fallback } : {};
    }

    /**
     * The signing block a desktop target carries into electron-builder. Windows
     * and macOS; Linux has no OS-level signature to carry, as
     * `hasSigningIdentityForPlatform` sets out.
     *
     * Throws rather than dropping the block if the material will not map - by
     * this point resolveSigningForBuild has already matched the credential to
     * the platform, so a null here means the two disagree about what a
     * credential for it is, and silently shipping unsigned is the one outcome an
     * author who configured signing must never get.
     */
    private async resolveDesktopTargetSigning(
        session: BuildSession,
        platform: GameBuildDesktopPlatform,
        signing: ResolvedBuildSigning,
    ): Promise<{ signing?: GameBuildWorkerWindowsSigning | GameBuildWorkerMacSigning }> {
        if (platform === "windows" && signing.windows) {
            // The host probe belongs here rather than in the worker: which
            // signtool exists is a fact about this machine, and the worker is
            // handed answers.
            const signtoolPath = await findSigntool();
            const material = toWorkerWindowsSigning(signing.windows, { ...(signtoolPath ? { signtoolPath } : {}) });
            if (!material) {
                throw new Error("The Windows signing credential could not be prepared for this build.");
            }
            this.emit(session, {
                level: "info",
                source: "Build",
                message: "the Windows build is code signed, so asar integrity validation is enabled; "
                    + "signing contacts a timestamp server",
            });
            return { signing: material };
        }
        if (platform === "macos" && signing.macos) {
            const material = toWorkerMacSigning(signing.macos);
            if (!material) {
                throw new Error("The macOS signing credential could not be prepared for this build.");
            }
            this.emit(session, {
                level: "info",
                source: "Build",
                message: "the macOS build is code signed, so asar integrity validation is enabled"
                    + (material.notarization
                        // Said before the build rather than after: notarization
                        // is a round trip to Apple that routinely takes minutes,
                        // and a packaging step that appears to have hung is the
                        // thing an author reaches for the cancel button over.
                        ? "; it will also be notarized, which uploads the app to Apple and can take several minutes"
                        : "; it will not be notarized, so Gatekeeper still warns on first launch"),
            });
            return { signing: material };
        }
        return {};
    }

    /**
     * The mobile-only preflight checks: that the templates this Studio ships are
     * actually there, and that the payload can fit. What identity the package is
     * signed with belongs to signingPreflight, which answers it for every
     * platform in one place.
     */
    private async mobilePreflight(projectPath: string): Promise<BuildPreflightFinding[]> {
        const findings: BuildPreflightFinding[] = [];
        try {
            await loadMobileShellTemplateForApp(this.app);
        } catch (error) {
            // A broken install or a Studio/template mismatch: nothing else about
            // a mobile build matters until it is fixed, so report the reason
            // verbatim rather than a generic "cannot build".
            findings.push({
                code: "mobile-template-missing",
                severity: "error",
                section: "content",
                detail: { reason: error instanceof Error ? error.message : String(error) },
            });
        }
        // The compiled site always contains at least the project's assets, so
        // assets alone exceeding the ceiling means the package certainly will.
        // Inferring the other way is not sound (compression, protection and the
        // runtime all move the number), so a payload under the bar says nothing
        // and reports nothing - the worker still enforces the real limit on the
        // real bytes.
        const assetBytes = (await Fs.directorySize(path.join(projectPath, "assets"))).totalBytes;
        if (payloadExceedsLimit(assetBytes)) {
            findings.push({
                code: "mobile-payload-too-large",
                severity: "error",
                section: "content",
                detail: { size: `${(assetBytes / 1024 ** 3).toFixed(2)} GiB` },
            });
        }
        return findings;
    }

    /**
     * Everything preflight can say about signing, in one place: what the project
     * asked for, whether this machine can deliver it, and - when it asked for
     * nothing - the standing caveats of shipping unsigned.
     *
     * Reads the vault but never unseals anything: `secretsAvailable` answers the
     * only question preflight has about a password, without producing one. A
     * dialog that is merely open must not be holding the author's private keys.
     */
    private async signingPreflight(
        projectConfig: ProjectConfigData | null,
        targets: GameBuildTarget[],
        hostPlatform: GameBuildDesktopPlatform,
        iosBundleId: string,
    ): Promise<BuildPreflightFinding[]> {
        const findings: BuildPreflightFinding[] = [];
        const ids = readProjectSigningIds(projectConfig);
        const vault = this.signingVault();

        // The unsigned caveats are now conditional: they describe a platform
        // nobody pointed at a credential. Once one is configured, whatever is
        // wrong with it is reported instead, and repeating "this is unsigned"
        // would be plainly false.
        const unsignedDesktop = targets.filter(isDesktopTarget).some(target => {
            const slot = signingPlatformForTarget(target.platform);
            return slot === null || !ids[slot];
        });
        if (unsignedDesktop) {
            findings.push({ code: "unsigned", severity: "warning", section: "signing" });
        }
        if (targets.some(target => target.platform === "android") && !ids.android) {
            findings.push({ code: "unsigned-android", severity: "warning", section: "signing" });
        }
        if (targets.some(target => target.platform === "ios") && !ids.ios) {
            // Not the same caveat as Android's: an .ipa without a signature
            // cannot be installed at all, so this is a prerequisite the author
            // must act on, not a limitation they can ignore.
            findings.push({ code: "unsigned-ios", severity: "warning", section: "signing" });
        }

        const slots = new Set(
            targets.map(target => signingPlatformForTarget(target.platform))
                .filter((slot): slot is SigningPlatform => slot !== null),
        );
        // Checked whenever one is configured, not only alongside a Linux target:
        // the GPG signatures cover every artifact, and resolveSigningForBuild
        // will go looking for this credential on the same terms.
        if (ids.linux) {
            slots.add("linux");
        }
        for (const platform of slots) {
            const id = ids[platform];
            if (!id) {
                continue;
            }
            // The id is deliberately absent from every finding below: it is an
            // opaque internal handle, and the author knows their credentials by
            // the label they gave them.
            const credential = vault ? await vault.get(id).catch(() => null) : null;
            // A credential of the wrong kind counts as "not here" rather than
            // earning its own code: the dialog only ever offers the kinds a
            // platform can use, so this is a hand-edited or stale config, and
            // what the author has to do about it is the same either way.
            if (!vault || !credential || SIGNING_CREDENTIAL_PLATFORM[credential.kind] !== platform) {
                findings.push({
                    code: "signing-credential-missing",
                    severity: "error",
                    section: "signing",
                    detail: { platform },
                });
                continue;
            }
            if (!signingCredentialSupportedOnHost(credential.kind, hostPlatform)) {
                findings.push({
                    code: "signing-host-unsupported",
                    severity: "error",
                    section: "signing",
                    detail: { platform, host: hostPlatform },
                });
            }
            if (SIGNING_CREDENTIAL_SECRET_FIELDS[credential.kind].length > 0
                && !await vault.secretsAvailable(id).catch(() => false)) {
                findings.push({
                    code: "signing-secret-unavailable",
                    severity: "error",
                    section: "signing",
                    detail: { platform },
                });
            }
            if (signingReachesNetwork(credential)) {
                findings.push({
                    code: "signing-needs-network",
                    severity: "warning",
                    section: "signing",
                    detail: { platform },
                });
            }
            if (credential.kind === "linux-gpg"
                && !await findGpgBinary({ ...(credential.gpgPath ? { configuredPath: credential.gpgPath } : {}) })) {
                findings.push({
                    code: "signing-tool-missing",
                    severity: "error",
                    section: "signing",
                    detail: { platform, tool: "gpg" },
                });
            }
            if (credential.kind === "macos-keychain" && hostPlatform === "macos") {
                findings.push(...await this.macIdentityPreflight(credential.identity));
            }
            findings.push(...await this.signingExpiryPreflight(vault, credential, platform));
            if (platform === "android") {
                // Signed, and still not publishable on Play - which is exactly
                // the assumption a release keystore invites.
                findings.push({ code: "signing-android-not-play", severity: "warning", section: "signing" });
            }
            if (platform === "ios" && targets.some(target => target.platform === "ios")) {
                findings.push(...await this.iosProfilePreflight(vault, credential, iosBundleId));
            }
        }
        return findings;
    }

    /**
     * Whether the Apple credential's provisioning profile actually covers the
     * app this build produces.
     *
     * Worth checking here rather than only at signing time: the signing step is
     * the last thing a mobile build does, so a profile issued for a different
     * app id costs the author the entire build before saying so. The signer
     * still refuses on its own - this is the early warning, not the guard.
     *
     * A profile that cannot be read at all is left to the signer to report: it
     * has the file open anyway and its error names the actual parse failure,
     * which is more use than "something is wrong with your profile".
     */
    private async iosProfilePreflight(
        vault: SigningVault,
        credential: SigningCredential,
        bundleId: string,
    ): Promise<BuildPreflightFinding[]> {
        const profilePath = vault.materialPath(credential, "provisioningProfileFile");
        if (!profilePath) {
            return [];
        }
        let profile: ProvisioningProfile;
        try {
            profile = parseProvisioningProfile(await fs.readFile(profilePath));
        } catch {
            return [];
        }
        const coverage = profileCoversBundleId(profile, bundleId);
        if (coverage.matches) {
            return [];
        }
        return [{
            code: "signing-ios-profile-mismatch",
            severity: "error",
            section: "signing",
            detail: { bundleId, profileAppId: profile.applicationIdentifier },
        }];
    }

    /**
     * Whether the keychain identity a macOS credential names is on this machine,
     * and whether it is the kind that produces a distributable app.
     *
     * Only reachable on a macOS host - `security` exists nowhere else, and the
     * host check upstream has already reported that as its own finding, so this
     * would otherwise report "your certificate is missing" on a machine that
     * simply cannot look.
     */
    private async macIdentityPreflight(identity: string): Promise<BuildPreflightFinding[]> {
        const identities = await findMacSigningIdentities();
        if (!macIdentityPresent(identities, identity)) {
            // Ask the wider question before blaming the author for a missing
            // file: `-v` also hides a certificate that *is* installed but has
            // expired or whose chain is broken, and sending someone to look for
            // something they already have is the worse of the two wrong answers.
            const all = await findMacSigningIdentities({ validOnly: false });
            return [{
                code: macIdentityPresent(all, identity)
                    ? "signing-macos-identity-unusable"
                    : "signing-macos-identity-missing",
                severity: "error",
                section: "signing",
                detail: { identity },
            }];
        }
        // A warning rather than an error: the build genuinely succeeds and the
        // .app genuinely runs on the machine that made it. What it will not do is
        // pass Gatekeeper anywhere else, and an author testing locally may know
        // that and mean it.
        const matched = identities.filter(candidate => candidate.name === identity
            || candidate.sha1 === identity.trim().toUpperCase()
            || candidate.name.includes(identity.trim()));
        if (matched.length > 0 && !matched.some(candidate => candidate.developerId)) {
            return [{
                code: "signing-macos-not-developer-id",
                severity: "warning",
                section: "signing",
                detail: { identity: matched[0].name },
            }];
        }
        return [];
    }

    /** Where the vendored iOS signing tool lives on this machine. */
    private async resolveIosSigningToolPath(): Promise<string> {
        return iosSigningToolPathFrom(await resolveZsignTool(this.app));
    }

    /**
     * The expiry findings for one credential's certificate.
     *
     * Every certificate worth checking here lives inside a PKCS#12 or a JKS,
     * whose certificate bags are encrypted under the store password - so this
     * unseals the credential to read them. The passwords are dropped when the
     * call returns; what comes back is `SigningInspectResult`, which by its type
     * carries only certificate facts.
     *
     * A credential whose certificate this process cannot reach at all - one in
     * the Windows certificate store, or in Azure - has no container and is
     * skipped. Its expiry is the signing tool's business, not ours.
     */
    private async signingExpiryPreflight(
        vault: SigningVault,
        credential: SigningCredential,
        platform: SigningPlatform,
    ): Promise<BuildPreflightFinding[]> {
        const material = await vault.resolveMaterial(credential.id);
        const container = material ? certificateContainer(material) : null;
        if (!container) {
            return [];
        }
        const inspected = await inspectCertificateFile(container.file, container.secrets).catch(() => null);
        if (!inspected?.available) {
            return [];
        }
        const { certificate } = inspected;
        const code = signingExpiryCode(certificateExpiry(certificate));
        if (!code) {
            return [];
        }
        return [{
            code,
            severity: code === "signing-credential-expiring" ? "warning" : "error",
            section: "signing",
            detail: {
                platform,
                notBefore: isoDate(certificate.notBefore),
                notAfter: isoDate(certificate.notAfter),
                days: String(daysUntil(certificate.notAfter)),
            },
        }];
    }

    /**
     * The machine's credential vault, or null when this manager has no storage
     * to read it from (a test double). Machine-level, so one instance serves
     * every project this manager builds.
     */
    private signingVault(): SigningVault | null {
        if (this.signingVaultCache) {
            return this.signingVaultCache;
        }
        try {
            const root = this.app.storageManager.getNamespacePath(UserDataNamespace.Signing);
            this.signingVaultCache = new SigningVault({ root, sealer: electronSealer });
        } catch {
            return null;
        }
        return this.signingVaultCache;
    }

    /**
     * Unseal the credentials this build needs, one per platform the request
     * covers. **The only place a build holds a password**, and the reason every
     * failure below throws rather than degrades: an author who configured signing
     * and got an unsigned artifact anyway would not find out until their players
     * did.
     *
     * Nothing here reaches `emit` with a value read out of the vault. The console
     * gets the credential's label, which is the author's own words for it.
     */
    private async resolveSigningForBuild(
        session: BuildSession,
        projectConfig: ProjectConfigData | null,
        targets: GameBuildTarget[],
    ): Promise<ResolvedBuildSigning> {
        const ids = readProjectSigningIds(projectConfig);
        const needed = new Set(
            targets.map(target => signingPlatformForTarget(target.platform))
                .filter((slot): slot is SigningPlatform => slot !== null),
        );
        // The GPG slot is not tied to the target that shares its name: its
        // detached signatures go beside every artifact this build writes. So it
        // is resolved whenever the author configured one, whether or not a Linux
        // target is in the request - which is the only way it is reachable at
        // all from a Windows host, where a Linux target cannot be built.
        if (ids.linux) {
            needed.add("linux");
        }
        const slots = [...needed].filter(slot => ids[slot]);
        if (slots.length === 0) {
            return {};
        }
        const vault = this.signingVault();
        if (!vault) {
            throw new Error("This project is configured to sign its builds, but the credential vault is unavailable.");
        }
        const signing: ResolvedBuildSigning = {};
        for (const platform of slots) {
            const id = ids[platform]!;
            const credential = await vault.get(id);
            if (!credential) {
                throw new Error(
                    `No signing credential for ${platform} on this machine. Import it in the build dialog's `
                    + "Signing section, or clear the selection to build unsigned.",
                );
            }
            if (SIGNING_CREDENTIAL_PLATFORM[credential.kind] !== platform) {
                throw new Error(
                    `The credential "${credential.label}" cannot sign a ${platform} build. Pick one for ${platform}.`,
                );
            }
            const material = await vault.resolveMaterial(id);
            if (!material || !signingSecretsResolved(material)) {
                throw new Error(
                    `The password for "${credential.label}" could not be read on this machine. It is sealed with the `
                    + "system keyring, so importing it again under this user account restores access.",
                );
            }
            signing[platform] = material;
            this.emit(session, {
                level: "info",
                source: "Build",
                message: `signing the ${platform} build with "${credential.label}"`,
            });
        }
        return signing;
    }

    /**
     * Assemble the mobile repack job: everything the worker cannot decide for
     * itself. The identity normalizations, the version code, the signing
     * identity and the scaled icons are all resolved here, so the worker only
     * moves bytes (and so a normalization that changes the author's app id can
     * be reported on the console, where they will see it).
     */
    private async buildMobileJob(
        session: BuildSession,
        input: {
            projectPath: string;
            projectConfig: ProjectConfigData | null;
            identity: { appId: string; productName: string; artifactBaseName: string; version: string };
            platforms: GameBuildMobilePlatform[];
            site: GameRuntimeArtifactCompileResult;
            /** Opaque protection key, or undefined for a plain (unprotected) build. */
            contentKey?: string;
            /** Credentials this build already unsealed; the mobile slots may be empty. */
            signing: ResolvedBuildSigning;
        },
    ): Promise<GameBuildWorkerMobileJob> {
        const template = await loadMobileShellTemplateForApp(this.app);
        this.emit(session, {
            level: "info",
            source: "Build",
            message: `using the ${template.variant} shell template`,
        });
        const { identity, site } = input;
        const orientation = readMobileOrientation(input.projectConfig);
        const shellConfig: MobileShellConfigV1 = {
            schemaVersion: template.manifest.shellConfigSchemaVersion,
            orientation,
            // Same pre-boot background the entry document paints, so the native
            // window and the document agree on the first frame.
            backgroundColor: resolveGameRuntimeInitialBackgroundColor(site.pack),
            // Present only when the payload is protected; the shell reads it to
            // decode, and it stays plain in shell-config (the bootstrap file).
            ...(input.contentKey ? { contentKey: input.contentKey } : {}),
        };
        // The mobile shells serve the compiled web site, so its icon files are
        // already staged; the entry document just has to reference the ones
        // that exist.
        const hasFavicon = await fileExists(path.join(site.appDir, WEB_FAVICON_FILENAME));
        const hasAppleTouchIcon = await fileExists(path.join(site.appDir, WEB_APPLE_TOUCH_FILENAME));

        const job: GameBuildWorkerMobileJob = {
            sourceDir: site.appDir,
            ...(input.contentKey ? { contentKey: input.contentKey } : {}),
            templateManifest: template.manifest,
            productName: identity.productName,
            appDirBaseName: identity.artifactBaseName,
            orientation,
            indexHtmlOverride: buildWebIndexHtml(site.pack, { hasFavicon, hasAppleTouchIcon, variant: "mobile" }),
            shellConfigJson: JSON.stringify(shellConfig),
        };

        if (input.platforms.includes("android")) {
            const applicationId = normalizeAndroidPackageName(identity.appId);
            if (applicationId !== identity.appId) {
                this.emit(session, {
                    level: "warning",
                    source: "Build",
                    message: `the app id ${identity.appId} is not a valid Android package name; `
                        + `packaging as ${applicationId}`,
                });
            }
            const versionCode = deriveAndroidVersionCode(identity.version);
            if (versionCode === null) {
                throw new Error(
                    `Version "${identity.version}" cannot be encoded as an Android version code. `
                    + "Each of major, minor and patch must fit its budget (major ≤ 2099, minor and patch ≤ 999).",
                );
            }
            const releaseKeystore = input.signing.android ? toWorkerAndroidSigning(input.signing.android) : null;
            if (releaseKeystore) {
                // The one thing an author must know before they hand this build
                // to a player who already has the previous one: Android refuses
                // an update whose signer changed, with a message ("app not
                // installed") that says nothing about why.
                this.emit(session, {
                    level: "warning",
                    source: "Build",
                    message: "the Android build is signed with your release keystore instead of the local debug "
                        + "identity; a device that has a debug-signed build of this game must uninstall it first. "
                        + "A signed APK is for sideloading and stores that take APKs; Google Play accepts only AABs, "
                        + "which this pipeline does not produce.",
                });
            }
            job.android = {
                templateApkPath: template.androidTemplatePath,
                outputName: mobileExportFileName("android", identity.artifactBaseName, identity.version),
                applicationId,
                versionName: identity.version,
                versionCode,
                signingIdentity: await resolveMobileSigningIdentity(this.app.getUserDataDir()),
                ...(releaseKeystore ? { signing: releaseKeystore } : {}),
                ...await this.resolveMobileIcons(session, {
                    projectPath: input.projectPath,
                    projectConfig: input.projectConfig,
                    platform: "android",
                    templatePath: template.androidTemplatePath,
                    slots: template.manifest.android.iconSlots,
                }),
            };
        }

        if (input.platforms.includes("ios")) {
            const bundleId = normalizeIosBundleId(identity.appId);
            if (bundleId !== identity.appId) {
                this.emit(session, {
                    level: "warning",
                    source: "Build",
                    message: `the app id ${identity.appId} is not a valid iOS bundle identifier; `
                        + `packaging as ${bundleId}`,
                });
            }
            const bundleVersion = deriveIosBundleVersion(identity.version);
            const appleIdentity = input.signing.ios
                ? toWorkerIosSigning(input.signing.ios, await this.resolveIosSigningToolPath())
                : null;
            job.ios = {
                templateAppZipPath: template.iosTemplatePath,
                outputName: mobileExportFileName("ios", identity.artifactBaseName, identity.version),
                bundleId,
                shortVersionString: bundleVersion,
                bundleVersion,
                ...(appleIdentity ? { signing: appleIdentity } : {}),
                ...await this.resolveMobileIcons(session, {
                    projectPath: input.projectPath,
                    projectConfig: input.projectConfig,
                    platform: "ios",
                    templatePath: template.iosTemplatePath,
                    // The .app.zip prefixes every entry with the .app dir, while
                    // the manifest's slots are relative to it.
                    entryPrefix: `${template.manifest.ios.appDirName}/`,
                    slots: template.manifest.ios.iconSlots,
                }),
            };
        }
        return job;
    }

    /**
     * Scale the configured app icon into this template's icon slots. A missing
     * or corrupt icon is a warning, not a failure: the repack then leaves the
     * shell's placeholder icons in place, mirroring how a desktop build falls
     * back to the default Electron icon. A merely small one still ships, for
     * the reason given on resolveTargetIcon.
     */
    private async resolveMobileIcons(
        session: BuildSession,
        input: {
            projectPath: string;
            projectConfig: ProjectConfigData | null;
            platform: GameBuildMobilePlatform;
            templatePath: string;
            slots: string[];
            entryPrefix?: string;
        },
    ): Promise<{ iconPngBySlot?: Record<string, string> }> {
        // iOS must ship an icon with no alpha channel at all, so its fallback is
        // the pre-flattened NarraLeaf mark and its scaled slots get the channel
        // stripped after nativeImage re-adds it.
        const opaque = input.platform === "ios";
        const icon = await checkIcon(input.projectPath, input.projectConfig, input.platform);
        let sourceIconPath = icon.status === "ok" ? icon.iconPath : null;
        if (!sourceIconPath) {
            sourceIconPath = this.app.getDefaultGameIconPath(opaque);
            this.emit(session, {
                level: "warning",
                source: "Build",
                message: (icon.status === "missing"
                    ? `no ${input.platform} app icon configured; `
                    : `the ${input.platform} icon could not be read; `)
                    + (sourceIconPath ? "using the NarraLeaf icon" : "using the shell's placeholder icon"),
            });
            if (!sourceIconPath) {
                return {};
            }
        }
        const slots = readIconSlotSizes(await fs.readFile(input.templatePath), input.slots, input.entryPrefix);
        const iconPngBySlot = await writeScaledIcons(
            sourceIconPath,
            slots,
            path.join(input.projectPath, ".nlstudio", "build", "mobile-icons", input.platform),
            { opaque },
        );
        return { iconPngBySlot };
    }

    private runWorker(session: BuildSession, config: GameBuildWorkerConfig): Promise<string[]> {
        const workerPath = path.join(this.app.getDistDir(), "main", "buildWorker.js");
        // The build.electronMirror setting drives only the large Electron dist
        // download (via electronDownload.mirror in the config). The separate
        // NSIS/AppImage/7za toolchain download reads ELECTRON_BUILDER_BINARIES_MIRROR,
        // whose URL layout differs - so it is NOT synthesized from the same
        // string; it is inherited from the environment if the user set it.
        return new Promise<string[]>((resolve, reject) => {
            if (session.cancelled) {
                reject(new Error("Build cancelled"));
                return;
            }
            const worker = utilityProcess.fork(workerPath, [], {
                serviceName: "narraleaf-game-build",
                stdio: "pipe",
                env: process.env,
            });
            session.worker = worker;
            let settled = false;
            const settle = (fn: () => void) => {
                if (settled) {
                    return;
                }
                settled = true;
                session.worker = null;
                fn();
            };
            worker.stdout?.on("data", chunk => this.emitProcessOutput(session, "info", chunk));
            worker.stderr?.on("data", chunk => this.emitProcessOutput(session, "warning", chunk));
            worker.on("message", (message: GameBuildWorkerOutboundMessage) => {
                if (message.type === "log") {
                    this.emit(session, { level: message.level, source: "Build", message: message.message });
                    return;
                }
                if (message.type === "done") {
                    worker.kill();
                    settle(() => resolve(message.artifacts));
                    return;
                }
                worker.kill();
                settle(() => reject(new Error(message.message)));
            });
            worker.on("exit", code => {
                settle(() => reject(new Error(
                    session.cancelled ? "Build cancelled" : `Packaging worker exited unexpectedly (code ${code})`,
                )));
            });
            worker.once("spawn", () => {
                worker.postMessage({ type: "start", config });
            });
        });
    }

    private resolveIdentity(
        session: BuildSession,
        projectConfig: ProjectConfigData | null,
        projectPath: string,
    ): { appId: string; productName: string; artifactBaseName: string; version: string; copyright?: string } {
        const productName = projectConfig?.name?.trim() || path.basename(projectPath) || "NarraLeaf Game";
        const version = readProjectVersion(projectConfig);
        if (version && !isValidProjectVersion(version)) {
            throw new Error(
                `Project version "${version}" is not a valid semantic version. Fix it in the project settings.`,
            );
        }
        if (!version) {
            this.emit(session, {
                level: "warning",
                source: "Build",
                message: "project has no version; building as 0.0.0",
            });
        }
        const identifier = readProjectIdentifier(projectConfig);
        const appId = deriveGameAppId(identifier, productName);
        if (!identifier) {
            this.emit(session, {
                level: "warning",
                source: "Build",
                message: `project has no identifier; using app id ${appId}`,
            });
        }
        const rawCopyright = projectConfig?.metadata?.copyright;
        const copyright = typeof rawCopyright === "string" && rawCopyright.trim()
            ? rawCopyright.trim()
            : undefined;
        return {
            appId,
            productName,
            artifactBaseName: sanitizeProjectFileName(productName),
            // Same fallback electron-builder applies via the app manifest, so
            // web artifact names line up with the desktop ones.
            version: version ?? "0.0.0",
            ...(copyright ? { copyright } : {}),
        };
    }

    private async selectRuntimePlugins(
        projectPath: string,
        projectConfig: ProjectConfigData | null,
    ): Promise<RuntimePluginPackSelection> {
        const installed = (await this.app.pluginManager.listPlugins()).map(plugin => ({
            id: plugin.pluginId,
            version: plugin.manifest.version,
            enabled: plugin.enabled,
        }));
        return selectRuntimePluginsForPack({
            dependencies: projectConfig?.dependencies,
            available: await this.app.pluginManager.listRuntimePluginPackSources(),
            installed,
        });
    }

    private encryptAssetsEnabled(projectConfig: ProjectConfigData | null): boolean {
        return (projectConfig?.app as { security?: { encryptAssets?: unknown } } | undefined)?.security?.encryptAssets === true;
    }

    /** Same key resolution Preview uses: production ships the identical protection path. */
    private async resolveEncryptionKey(
        projectPath: string,
        projectConfig: ProjectConfigData | null,
    ): Promise<string | undefined> {
        if (!this.encryptAssetsEnabled(projectConfig)) {
            return undefined;
        }
        return resolvePackEncryptionKey(this.app.getUserDataDir(), projectPath);
    }

    private ensureNotCancelled(session: BuildSession): void {
        if (session.cancelled) {
            throw new Error("Build cancelled");
        }
    }

    private failSession(session: BuildSession, message: string): void {
        if (session.snapshot.status === "done") {
            return;
        }
        session.snapshot = {
            status: "error",
            startedAt: session.snapshot.startedAt,
            finishedAt: Date.now(),
            platforms: session.snapshot.platforms,
            error: message,
        };
        if (!session.cancelled) {
            this.app.logger.error("[Build] failed", message);
            this.emit(session, { level: "error", source: "Build", message: `build failed: ${message}` });
        }
    }

    private emitProcessOutput(session: BuildSession, level: DevModeConsoleLogPayload["level"], chunk: Buffer): void {
        const message = formatPreviewProcessOutput(chunk);
        if (!message) {
            return;
        }
        this.emit(session, { level, source: "Build", message });
    }

    private emit(session: BuildSession, payload: DevModeConsoleLogPayload): void {
        emitWorkspaceConsoleLog(this.app, session.projectPath, payload);
    }

    private readRuntimeVersion(): string {
        try {
            return this.app.getAppInfo().version;
        } catch {
            return "0.0.0";
        }
    }

    /** Optional Electron download mirror for cross builds; "" / unset = official source. */
    private readElectronMirror(): string | undefined {
        try {
            const value = this.app.getGlobalState().get("build.electronMirror");
            return typeof value === "string" && value.trim() ? value.trim() : undefined;
        } catch {
            return undefined;
        }
    }

    private projectKey(projectPath: string): string {
        return path.resolve(projectPath);
    }
}

/**
 * The date half of an ISO timestamp, for a message about a certificate's
 * validity window. The time of day is noise there, and a raw ISO string with a
 * `T` and a `Z` in it reads like a machine talking.
 */
function isoDate(timestamp: string): string {
    return timestamp.slice(0, 10);
}

async function fileExists(filePath: string): Promise<boolean> {
    try {
        await fs.access(filePath);
        return true;
    } catch {
        return false;
    }
}

function isActiveStatus(status: GameBuildStateSnapshot["status"]): boolean {
    return status === "preparing" || status === "compiling" || status === "packaging";
}

type GameBuildDesktopTarget = GameBuildTarget & { platform: GameBuildDesktopPlatform };

export function isDesktopTarget(target: GameBuildTarget): target is GameBuildDesktopTarget {
    // Must be the shared exhaustive test, not `platform !== "web"`: this is a
    // type predicate, whose body TypeScript never checks - the old form
    // silently routed mobile targets into the electron-builder path when the
    // platform union grew.
    return isDesktopBuildPlatform(target.platform);
}

type GameBuildMobileTarget = GameBuildTarget & { platform: GameBuildMobilePlatform };

export function isMobileTarget(target: GameBuildTarget): target is GameBuildMobileTarget {
    return isMobileBuildPlatform(target.platform);
}

function normalizeTargets(targets: GameBuildTarget[] | undefined): GameBuildTarget[] {
    if (!Array.isArray(targets)) {
        return [];
    }
    return targets
        .map(target => ({
            platform: target.platform,
            formats: [...new Set(target.formats)],
            ...(target.arch ? { arch: target.arch } : {}),
        }))
        .filter(target => target.formats.length > 0);
}

/**
 * Only payload that must exist as a real file on disk leaves the asar. The
 * sealed pair does: the codec addon is dlopen'ed by the OS loader, and it then
 * reads the bundle through its own native file I/O - neither goes through
 * Electron's asar-aware fs. native.js (the addon's loader sidecar) and icons
 * (consumed by native image/shell APIs) stay loose for the same reason.
 * Unencrypted assets have no such constraint: the runtime reads them with
 * readFile/stat/ranged createReadStream, which Electron serves from inside
 * app.asar transparently - so they ship in the archive instead of as a loose
 * per-file tree on disk.
 *
 * Plugin sidecars are unconditional: an executable image and the shared
 * libraries beside it are opened by the OS loader, which knows nothing of asar,
 * so a sidecar packed into the archive could never be spawned. The pattern is
 * listed even for projects with no sidecar - electron-builder ignores a glob
 * that matches nothing, and a conditional here would be one more thing to keep
 * in step with the compiler.
 */
function buildAsarUnpackPatterns(sealed: boolean): string[] {
    const patterns = ["native.js", "icons/**", "sidecars/**"];
    if (sealed) {
        patterns.push(RUNTIME_BUNDLE_FILENAME, RUNTIME_SUPPORT_FILENAME);
    }
    return patterns;
}
