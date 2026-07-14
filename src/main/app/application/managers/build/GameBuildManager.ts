import fs from "fs/promises";
import crypto from "crypto";
import path from "path";
import { shell, utilityProcess, type UtilityProcess } from "electron";
import { RUNTIME_BUNDLE_FILENAME, RUNTIME_SUPPORT_FILENAME } from "@narraleaf/encryption";
import { App } from "@/app/app";
import type { DevModeConsoleLogPayload } from "@shared/types/devMode";
import type { GameRuntimeLaunchEntry } from "@shared/types/gameRuntime";
import {
    currentGameBuildPlatform,
    hostCanBuildTarget,
    type GameBuildPlatform,
    type GameBuildRequest,
    type GameBuildStateSnapshot,
    type GameBuildTarget,
} from "@shared/types/gameBuild";
import type { ProjectConfigData } from "@shared/utils/nlproj";
import { sanitizeProjectFileName } from "@shared/utils/nlproj";
import { readProjectConfigFromDir } from "../../utils/projectConfigFile";
import { emitWorkspaceConsoleLog } from "../../utils/workspaceConsole";
import { resolvePackEncryptionKey } from "../security/packKeyService";
import { compileGameRuntimeArtifact } from "../preview/compiler/gameRuntimeArtifactCompiler";
import { formatPreviewProcessOutput } from "../preview/PreviewManager";
import { selectRuntimePluginsForPack, type RuntimePluginPackSelection } from "../preview/selectRuntimePlugins";
import type {
    GameBuildWorkerConfig,
    GameBuildWorkerFuses,
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
const SEMVER_PATTERN =
    /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/;
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

/** Derive the packager app id from the project identifier. */
export function deriveGameAppId(identifier: string | undefined, projectName: string): string {
    const trimmed = identifier?.trim();
    if (trimmed && APP_ID_PATTERN.test(trimmed)) {
        return trimmed;
    }
    const sanitized = sanitizeProjectFileName(trimmed || projectName)
        .toLowerCase()
        .replace(/[^a-z0-9-]+/g, "-")
        .replace(/^-+|-+$/g, "") || "game";
    return `com.narraleaf.games.${sanitized}`;
}

/**
 * Fixed hardening fuse set for shipped games; not user-configurable.
 *
 * `hasSigningIdentity` gates asar integrity validation. That fuse hard-quits
 * the app on any post-package mutation of app.asar — real tamper-evidence when
 * a trusted signature seals the embedded hash, but on an ad-hoc/unsigned build
 * it is downside-only: an attacker just recomputes the hash and re-signs
 * ad-hoc, while ordinary players get a silent hard-crash if antivirus, disk
 * corruption or an updater ever touches the archive. It also does not cover
 * the asset payload, which ships outside the asar with its own protection. So
 * it stays off until real code signing is configured, at which point it earns
 * its keep. (Linux has no asar-integrity support regardless.)
 */
export function gameFusesForPlatform(platform: GameBuildPlatform, hasSigningIdentity: boolean): GameBuildWorkerFuses {
    return {
        runAsNode: false,
        // Left off deliberately: a game stores no Chromium cookies (saves and
        // persistence are its own JSON stores), and enabling OS cookie
        // encryption makes the first launch prompt for keychain/secret-store
        // access — a bad first impression for zero security gain here.
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
        // Defense in depth: the dialog already hides unbuildable platforms, but a
        // stored selection carried across hosts (or any non-UI caller) could still
        // ask for one. Fail early and clearly rather than deep inside electron-builder.
        const unbuildable = targets.filter(target => !hostCanBuildTarget(hostPlatform, target.platform));
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
        const encryptionKey = await this.resolveEncryptionKey(projectPath, projectConfig);
        if (encryptionKey) {
            this.emit(session, { level: "info", source: "Build", message: "asset protection enabled; sealing pack" });
        }
        this.ensureNotCancelled(session);

        session.snapshot = { ...session.snapshot, status: "compiling" };
        const stagingRoot = path.join(projectPath, ".nlstudio", "build", "staging");
        const artifact = await compileGameRuntimeArtifact({
            projectPath,
            entry,
            runtimeDistDir: path.join(this.app.getDistDir(), "runtime"),
            runtimeVersion: this.readRuntimeVersion(),
            outputRoot: stagingRoot,
            runtimePlugins: pluginSelection.selected,
            mode: "production",
            encryptionKey,
        });
        this.emit(session, {
            level: "info",
            source: "Build",
            message: `game compiled (${artifact.copiedAssetCount} asset(s)); packaging...`,
        });
        this.ensureNotCancelled(session);

        // The output dir is an absolute path chosen through the native folder
        // picker (or the "<project>/dist" default), so it is used as-is.
        const outputDir = request.outputDir?.trim()
            ? path.resolve(request.outputDir.trim())
            : path.join(projectPath, DEFAULT_OUTPUT_DIR_NAME);
        // v1 ships unsigned/ad-hoc, so asar integrity stays off (see
        // gameFusesForPlatform). A future code-signing batch flips this true.
        const hasSigningIdentity = false;
        const electronMirror = this.readElectronMirror();
        const crossTargets = targets.filter(target => target.platform !== hostPlatform);
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
            appDir: artifact.appDir,
            outputDir,
            appId: identity.appId,
            productName: identity.productName,
            artifactBaseName: identity.artifactBaseName,
            electronVersion: process.versions.electron,
            ...(electronMirror ? { electronMirror } : {}),
            asarUnpack: buildAsarUnpackPatterns(Boolean(encryptionKey)),
            targets: await Promise.all(targets.map(async target => ({
                platform: target.platform,
                formats: target.formats,
                fuses: gameFusesForPlatform(target.platform, hasSigningIdentity),
                ...(target.platform === hostPlatform
                    ? { electronDist: resolveElectronDistDirForApp(this.app) }
                    : {}),
                ...await this.resolveTargetIcon(session, projectPath, projectConfig, target.platform),
            }))),
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
        this.revealOutput(outputDir);
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
        platform: GameBuildPlatform,
    ): Promise<{ iconPath?: string }> {
        const configuredPath = readIconPath(projectConfig, platform);
        if (!configuredPath) {
            this.emit(session, {
                level: "warning",
                source: "Build",
                message: `no ${platform} app icon configured; using the default Electron icon`,
            });
            return {};
        }
        let iconPath: string;
        try {
            iconPath = resolveInsideProject(projectPath, configuredPath);
            await fs.access(iconPath);
        } catch {
            this.emit(session, {
                level: "warning",
                source: "Build",
                message: `configured ${platform} icon is missing (${configuredPath}); using the default Electron icon`,
            });
            return {};
        }
        if (await pngIconIsUnusable(iconPath)) {
            this.emit(session, {
                level: "warning",
                source: "Build",
                message: `${platform} icon ${configuredPath} is invalid or smaller than 512×512; using the default Electron icon`,
            });
            return {};
        }
        return { iconPath };
    }

    private runWorker(session: BuildSession, config: GameBuildWorkerConfig): Promise<string[]> {
        const workerPath = path.join(this.app.getDistDir(), "main", "buildWorker.js");
        // The build.electronMirror setting drives only the large Electron dist
        // download (via electronDownload.mirror in the config). The separate
        // NSIS/AppImage/7za toolchain download reads ELECTRON_BUILDER_BINARIES_MIRROR,
        // whose URL layout differs — so it is NOT synthesized from the same
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
    ): { appId: string; productName: string; artifactBaseName: string } {
        const productName = projectConfig?.name?.trim() || path.basename(projectPath) || "NarraLeaf Game";
        const rawVersion = projectConfig?.metadata?.version;
        const version = typeof rawVersion === "string" && rawVersion.trim() ? rawVersion.trim() : undefined;
        if (version && !SEMVER_PATTERN.test(version)) {
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
        const identifier = projectConfig?.identifier?.trim() || undefined;
        const appId = deriveGameAppId(identifier, productName);
        if (!identifier) {
            this.emit(session, {
                level: "warning",
                source: "Build",
                message: `project has no identifier; using app id ${appId}`,
            });
        }
        return {
            appId,
            productName,
            artifactBaseName: sanitizeProjectFileName(productName),
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

    /** Same key resolution Preview uses: production ships the identical protection path. */
    private async resolveEncryptionKey(
        projectPath: string,
        projectConfig: ProjectConfigData | null,
    ): Promise<string | undefined> {
        const enabled =
            (projectConfig?.app as { security?: { encryptAssets?: unknown } } | undefined)?.security?.encryptAssets === true;
        if (!enabled) {
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

function isActiveStatus(status: GameBuildStateSnapshot["status"]): boolean {
    return status === "preparing" || status === "compiling" || status === "packaging";
}

/** Read the configured icon path for a platform from project metadata. */
function readIconPath(projectConfig: ProjectConfigData | null, platform: GameBuildPlatform): string | undefined {
    const icons = (projectConfig?.metadata as { icons?: Record<string, { path?: unknown }> } | undefined)?.icons;
    const raw = icons?.[platform]?.path;
    return typeof raw === "string" && raw.trim() ? raw.trim() : undefined;
}

/** Resolve a project-relative path, refusing to escape the project root. */
function resolveInsideProject(projectPath: string, relativePath: string): string {
    const root = path.resolve(projectPath);
    const resolved = path.resolve(root, relativePath.replace(/^[/\\]+/, ""));
    if (resolved !== root && !resolved.startsWith(root + path.sep)) {
        throw new Error(`Path escapes project root: ${relativePath}`);
    }
    return resolved;
}

/**
 * Whether a PNG icon is unusable for electron-builder's conversion — either
 * smaller than its 512×512 minimum, or corrupt/truncated so its dimensions
 * cannot be read. Both cases warn + fall back rather than hand a bad file to
 * electron-builder (which would hard-fail the whole build). Non-PNG files
 * (.ico/.icns are native, multi-resolution) are assumed fine.
 */
async function pngIconIsUnusable(iconPath: string): Promise<boolean> {
    if (path.extname(iconPath).toLowerCase() !== ".png") {
        return false;
    }
    let handle: Awaited<ReturnType<typeof fs.open>> | undefined;
    try {
        handle = await fs.open(iconPath, "r");
        const header = Buffer.alloc(24);
        const { bytesRead } = await handle.read(header, 0, 24, 0);
        // PNG signature (8) + IHDR length/type (8) + width (4) + height (4).
        if (bytesRead < 24 || header.toString("ascii", 12, 16) !== "IHDR") {
            return true;
        }
        const width = header.readUInt32BE(16);
        const height = header.readUInt32BE(20);
        return width < 512 || height < 512;
    } catch {
        return true;
    } finally {
        await handle?.close();
    }
}

function normalizeTargets(targets: GameBuildTarget[] | undefined): GameBuildTarget[] {
    if (!Array.isArray(targets)) {
        return [];
    }
    return targets
        .map(target => ({
            platform: target.platform,
            formats: [...new Set(target.formats)],
        }))
        .filter(target => target.formats.length > 0);
}

/**
 * Everything the running game must read as a real file stays outside the
 * asar; the runtime's own code lives inside it (and is what the integrity
 * fuse protects).
 */
function buildAsarUnpackPatterns(sealed: boolean): string[] {
    const patterns = ["native.js", "icons/**"];
    if (sealed) {
        patterns.push(RUNTIME_BUNDLE_FILENAME, RUNTIME_SUPPORT_FILENAME);
    } else {
        patterns.push("assets/**");
    }
    return patterns;
}
