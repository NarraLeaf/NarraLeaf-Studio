import crypto from "crypto";
import type { Dirent } from "fs";
import fs from "fs/promises";
import path from "path";
import { shell, utilityProcess, type UtilityProcess } from "electron";
import { RUNTIME_BUNDLE_FILENAME, RUNTIME_SUPPORT_FILENAME } from "@narraleaf/encryption";
import { App } from "@/app/app";
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
import { resolveGameRuntimeInitialBackgroundColor } from "@shared/utils/gameRuntimeEntrySurface";
import type { ProjectConfigData } from "@shared/utils/nlproj";
import { sanitizeProjectFileName } from "@shared/utils/nlproj";
import {
    checkIcon,
    checkOutputDir,
    isValidProjectVersion,
    MIN_ICON_SIZE,
    readMobileOrientation,
    readProjectIdentifier,
    readProjectVersion,
} from "./preflight";
import { readIconSlotSizes, writeScaledIcons } from "./mobileIcons";
import { loadMobileShellTemplateForApp } from "./mobileShellTemplate";
import { resolveMobileSigningIdentity } from "./mobileSigningIdentity";
import { payloadExceedsLimit } from "../../../../buildWorker/mobile/runMobileRepack";
import type { MobileShellConfigV1 } from "@/buildWorker/mobile/mobileShellManifest";
import { readProjectConfigFromDir } from "../../utils/projectConfigFile";
import { emitWorkspaceConsoleLog } from "../../utils/workspaceConsole";
import { resolvePackEncryptionKey } from "../security/packKeyService";
import { type GameRuntimeArtifactCompileResult } from "../preview/compiler/gameRuntimeArtifactCompiler";
import { compileGameRuntimeArtifactInWorker } from "../preview/compiler/compileGameRuntimeArtifactInWorker";
import { buildWebIndexHtml, WEB_FAVICON_FILENAME } from "../preview/compiler/webShell";
import { formatPreviewProcessOutput } from "../preview/PreviewManager";
import { selectRuntimePluginsForPack, type RuntimePluginPackSelection } from "../preview/selectRuntimePlugins";
import type {
    GameBuildWorkerConfig,
    GameBuildWorkerFuses,
    GameBuildWorkerMobileJob,
    GameBuildWorkerOutboundMessage,
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

export class GameBuildManager {
    private readonly sessions = new Map<string, BuildSession>();

    constructor(private readonly app: App) {}

    public getStatus(projectPath: string): GameBuildStateSnapshot {
        return this.sessions.get(this.projectKey(projectPath))?.snapshot ?? { status: "idle" };
    }

    /**
     * Run the build's own checks without building, so the dialog can show what
     * would go wrong before the user commits. Advisory only: `run` re-checks
     * everything and stays the authority (see preflight.ts).
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
        for (const target of [...desktopTargets, ...mobileTargets]) {
            const icon = await checkIcon(normalizedProjectPath, projectConfig, target.platform);
            if (icon.status === "ok") {
                continue;
            }
            findings.push({
                code: icon.status === "missing" ? "icon-missing" : "icon-unusable",
                severity: "warning",
                section: "identity",
                detail: { platform: target.platform },
            });
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
            if (this.encryptAssetsEnabled(projectConfig)) {
                findings.push({ code: "mobile-unprotected", severity: "warning", section: "content" });
            }
            findings.push(...await this.mobilePreflight(normalizedProjectPath, mobileTargets));
        }
        if (desktopTargets.length > 0) {
            findings.push({ code: "unsigned", severity: "warning", section: "content" });
        }

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
            snapshot: { status: "preparing", startedAt: Date.now() },
            worker: null,
            cancelled: false,
        };
        this.sessions.set(key, session);
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

    private async run(session: BuildSession, entry: GameRuntimeLaunchEntry, request: GameBuildRequest): Promise<void> {
        const projectPath = session.projectPath;
        this.emit(session, { level: "info", source: "Build", message: "production build started" });

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

        const pluginSelection = await this.selectRuntimePlugins(projectPath, projectConfig);
        if (pluginSelection.errors.length > 0) {
            throw new Error(`Plugin validation failed:\n${pluginSelection.errors.join("\n")}`);
        }
        const encryptionKey = desktopTargets.length > 0
            ? await this.resolveEncryptionKey(projectPath, projectConfig)
            : undefined;
        if (encryptionKey) {
            this.emit(session, { level: "info", source: "Build", message: "asset protection enabled; sealing pack" });
        }
        if (webTarget && this.encryptAssetsEnabled(projectConfig)) {
            this.emit(session, {
                level: "info",
                source: "Build",
                message: "asset protection does not apply to the web export; its files ship unprotected",
            });
        }
        if (mobileTargets.length > 0 && this.encryptAssetsEnabled(projectConfig)) {
            // "does not yet": unlike the web export, mobile protection is a
            // planned milestone - the shells carry the interception point
            // already. This branch becomes the protected path then.
            this.emit(session, {
                level: "info",
                source: "Build",
                message: "asset protection does not yet apply to mobile exports; their files ship unprotected",
            });
        }
        this.ensureNotCancelled(session);

        session.snapshot = { ...session.snapshot, status: "compiling" };
        const runtimeDistDir = path.join(this.app.getDistDir(), "runtime");
        const runtimeVersion = this.readRuntimeVersion();
        let desktopArtifact: GameRuntimeArtifactCompileResult | null = null;
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
        // v1 ships unsigned/ad-hoc, so asar integrity stays off (see
        // gameFusesForPlatform). A future code-signing batch flips this true.
        const hasSigningIdentity = false;
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
            targets: await Promise.all(desktopTargets.map(async target => ({
                platform: target.platform,
                formats: target.formats,
                arch: normalizeGameBuildArch(target.platform, target.arch),
                fuses: gameFusesForPlatform(target.platform, hasSigningIdentity),
                ...(target.platform === hostPlatform
                    ? { electronDist: resolveElectronDistDirForApp(this.app) }
                    : {}),
                ...await this.resolveTargetIcon(session, projectPath, projectConfig, target.platform),
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
     * `iconPath`. Missing or too-small icons are a console warning, not a
     * failure: electron-builder then ships the default Electron icon.
     */
    private async resolveTargetIcon(
        session: BuildSession,
        projectPath: string,
        projectConfig: ProjectConfigData | null,
        platform: GameBuildDesktopPlatform,
    ): Promise<{ iconPath?: string }> {
        const icon = await checkIcon(projectPath, projectConfig, platform);
        if (icon.status === "ok") {
            return { iconPath: icon.iconPath };
        }
        this.emit(session, {
            level: "warning",
            source: "Build",
            message: icon.status === "missing"
                ? `no usable ${platform} app icon configured; using the default Electron icon`
                : `the ${platform} icon is invalid or smaller than ${MIN_ICON_SIZE}×${MIN_ICON_SIZE}; using the default Electron icon`,
        });
        return {};
    }

    /**
     * The mobile-only preflight checks: that the templates this Studio ships
     * are actually there, that the payload can fit, and the standing caveats
     * of a debug-signed sideload.
     */
    private async mobilePreflight(
        projectPath: string,
        mobileTargets: { platform: GameBuildMobilePlatform }[],
    ): Promise<BuildPreflightFinding[]> {
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
        const assetBytes = await directorySize(path.join(projectPath, "assets"));
        if (payloadExceedsLimit(assetBytes)) {
            findings.push({
                code: "mobile-payload-too-large",
                severity: "error",
                section: "content",
                detail: { size: `${(assetBytes / 1024 ** 3).toFixed(2)} GiB` },
            });
        }
        if (mobileTargets.some(target => target.platform === "android")) {
            findings.push({ code: "unsigned-android", severity: "warning", section: "content" });
        }
        if (mobileTargets.some(target => target.platform === "ios")) {
            // Not the same caveat as Android's: an .ipa without a signature
            // cannot be installed at all, so this is a prerequisite the author
            // must act on, not a limitation they can ignore.
            findings.push({ code: "unsigned-ios", severity: "warning", section: "content" });
        }
        return findings;
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
        };
        const hasFavicon = await fileExists(path.join(site.appDir, WEB_FAVICON_FILENAME));

        const job: GameBuildWorkerMobileJob = {
            sourceDir: site.appDir,
            templateManifest: template.manifest,
            productName: identity.productName,
            appDirBaseName: identity.artifactBaseName,
            orientation,
            indexHtmlOverride: buildWebIndexHtml(site.pack, { hasFavicon, variant: "mobile" }),
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
            job.android = {
                templateApkPath: template.androidTemplatePath,
                outputName: mobileExportFileName("android", identity.artifactBaseName, identity.version),
                applicationId,
                versionName: identity.version,
                versionCode,
                signingIdentity: await resolveMobileSigningIdentity(this.app.getUserDataDir()),
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
            job.ios = {
                templateAppZipPath: template.iosTemplatePath,
                outputName: mobileExportFileName("ios", identity.artifactBaseName, identity.version),
                bundleId,
                shortVersionString: bundleVersion,
                bundleVersion,
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
     * or unusable icon is a warning, not a failure: the repack then leaves the
     * shell's placeholder icons in place, mirroring how a desktop build falls
     * back to the default Electron icon.
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
        const icon = await checkIcon(input.projectPath, input.projectConfig, input.platform);
        if (icon.status !== "ok") {
            this.emit(session, {
                level: "warning",
                source: "Build",
                message: icon.status === "missing"
                    ? `no usable ${input.platform} app icon configured; using the shell's placeholder icon`
                    : `the ${input.platform} icon is invalid or smaller than ${MIN_ICON_SIZE}×${MIN_ICON_SIZE}; `
                        + "using the shell's placeholder icon",
            });
            return {};
        }
        const slots = readIconSlotSizes(await fs.readFile(input.templatePath), input.slots, input.entryPrefix);
        const iconPngBySlot = await writeScaledIcons(
            icon.iconPath,
            slots,
            path.join(input.projectPath, ".nlstudio", "build", "mobile-icons", input.platform),
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

/** Total bytes of a directory tree; a missing directory is simply empty. */
async function directorySize(dir: string): Promise<number> {
    let total = 0;
    let entries: Dirent[];
    try {
        entries = await fs.readdir(dir, { withFileTypes: true });
    } catch {
        return 0;
    }
    for (const entry of entries) {
        const entryPath = path.join(dir, entry.name);
        if (entry.isDirectory()) {
            total += await directorySize(entryPath);
        } else if (entry.isFile()) {
            total += await fs.stat(entryPath).then(stat => stat.size).catch(() => 0);
        }
    }
    return total;
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
 */
function buildAsarUnpackPatterns(sealed: boolean): string[] {
    const patterns = ["native.js", "icons/**"];
    if (sealed) {
        patterns.push(RUNTIME_BUNDLE_FILENAME, RUNTIME_SUPPORT_FILENAME);
    }
    return patterns;
}
