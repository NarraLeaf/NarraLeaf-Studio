import { RendererError, throwException } from "@shared/utils/error";
import { decodeProjectConfig, encodeProjectConfig, findProjectConfigFileName } from "@shared/utils/nlproj";
import { ProjectDependencyTable, normalizeProjectDependencyTable } from "@shared/types/pluginDependencies";
import { basename, extname, join } from "@shared/utils/path";
import { ProjectConfig, ProjectMetadata, Resolution } from "../../project/project";
import { normalizeProjectIconSet, type ProjectIconSet, type ProjectIconSource } from "@shared/types/projectIcons";
import {
    AutoSaveConfiguration,
    BuildConfiguration,
    CrashConfiguration,
    DialogueConfiguration,
    LanguageChangeConfig as LanguageChangeConfiguration,
    LintingConfiguration,
    LocalizationConfiguration,
    MobileConfiguration,
    NetworkConfiguration,
    PatchConfiguration,
    PlayerPreferences,
    ProjectAppConfiguration,
    VfxConfiguration,
    SaveCompatibilityConfiguration,
    SaveLocationConfiguration,
    SecurityConfiguration,
    SigningConfiguration,
    VoiceConfiguration,
    AssetCompressionConfiguration,
    PreloadConfiguration,
    normalizeAutoSaveConfiguration,
    normalizeBuildConfiguration,
    normalizeCrashConfiguration,
    normalizeDialogueConfiguration,
    normalizeLanguageChangeConfiguration,
    normalizeLintingConfiguration,
    normalizeLocalizationConfiguration,
    normalizeMobileConfiguration,
    normalizeNetworkConfiguration,
    normalizePatchConfiguration,
    normalizePlayerPreferences,
    normalizePreloadConfiguration,
    normalizeSaveCompatibilityConfiguration,
    normalizeSaveLocationConfiguration,
    normalizeSecurityConfiguration,
    normalizeSigningConfiguration,
    normalizeVfxConfiguration,
    normalizeVoiceConfiguration,
    normalizeWindowConfiguration,
    type WindowConfiguration,
    readAssetCompressionConfiguration,
    normalizeDistributionConfiguration,
    type DistributionConfiguration,
} from "../../project/configuration";
import { ProjectNameConvention } from "../../project/nameConvention";
import { Service } from "../Service";
import { IProjectService, Services, WorkspaceContext } from "../services";
import { EventEmitter } from "../ui/EventEmitter";
import { storeWrite, type SavedFileName } from "../autosave/writeReport";
import { FileSystemService } from "./FileSystem";
import { describeFileWriteFailure, describeWriteFailureReason } from "./writeFailureReason";
import { appPrivilegedFacade } from "@/lib/app/privilegedFacade";
import { getInterface } from "@/lib/app/bridge";
import { translate } from "@/lib/i18n";
import type { InterpolationParams, TranslationKey } from "@shared/i18n";
import { FsRejectErrorCode, type FsRejectError, type FsRequestResult } from "@shared/types/os";
import { withReadFailureReason } from "@/lib/workspace/assets/assetReadFailure";

/**
 * What the author may hand Studio as an icon. One list for every slot, not one
 * per platform: the bake re-renders whatever it is into each target's PNG, so
 * the old per-platform restrictions (Android and iOS took PNG only, because the
 * repack scaled the raw file straight into the shell) no longer buy anything.
 * Every entry is something the renderer can decode - .icns through the largest
 * PNG embedded in it, the rest natively.
 */
export const PROJECT_ICON_PICKER_EXTENSIONS = ["png", "svg", "webp", "jpg", "jpeg", "ico", "icns"];

const ICON_MEDIA_TYPES: Record<string, string> = {
    icns: "image/icns",
    ico: "image/x-icon",
    png: "image/png",
    jpg: "image/jpeg",
    jpeg: "image/jpeg",
    webp: "image/webp",
    svg: "image/svg+xml",
};

export class BaseProjectService {
    public static getInitialConfig(config: ProjectConfig): ProjectConfig {
        return config;
    }

    public static parseResolution(resolution: string): Resolution {
        const [width, height] = resolution.split("x").map(Number);
        return { width, height };
    }

    public static getInitialAssetsMetadata() {
        return {};
    }

    public static getInitialEditorConfig() {
        return {};
    }
}

/**
 * The project file could not be written.
 *
 * Its message is the sentence the author reads: every surface that changes a project setting shows a
 * failure as `error.message`, and before this it read `Failed to write file to app://fs/<grant>:
 * Internal Server Error` - a one-use grant URL and an HTTP status, where the author needed to hear
 * that the project file is read-only. The filesystem's own error is kept as `cause`, for the log.
 */
export class ProjectFileWriteError extends RendererError {
    public constructor(public readonly fsError: FsRejectError) {
        super(describeProjectFileWriteFailure(fsError, translate), { cause: fsError });
        this.name = "ProjectFileWriteError";
    }
}

/**
 * How a manifest write is reported when it fails: by whoever asked for the change, with a
 * {@link ProjectFileWriteError}, and never tried again - the cached manifest stays at what was last
 * written, and every surface showing a setting goes back to it. The save-status surface would say
 * the opposite of that, so it only logs it.
 */
const PROJECT_FILE_WRITE = storeWrite("workspace.shell.save.stores.project", "handledByWriter");

/** What the icon files are to the author, for the sentence a failed write of one throws. */
const PROJECT_ICON = { store: "workspace.shell.save.stores.projectIcon" } as const satisfies SavedFileName;

/**
 * A failure on one of the project's own files - an icon picked in, an icon or avatar baked from it -
 * whose message is the sentence the author reads.
 *
 * Its own class so a surface that runs several steps (the icon section: pick, copy, bake, record) can
 * show these as they are and word anything else itself: the filesystem's message names the path, and
 * an error that is not one of these was never written for an author.
 */
export class ProjectFileAccessError extends RendererError {
    public constructor(message: string, options?: ErrorOptions) {
        super(message, options);
        this.name = "ProjectFileAccessError";
    }
}

/**
 * Throw a write failure as the sentence the surface that asked will show, naming the thing written
 * by what the author knows it as. The filesystem's own message names the path, and for a derived
 * file that is a directory the author never chose.
 */
function throwWriteFailure(name: SavedFileName, result: FsRequestResult<void>): void {
    if (!result.ok) {
        throw new ProjectFileAccessError(describeFileWriteFailure(name, result.error, translate), { cause: result.error });
    }
}

/** The sentence a {@link ProjectFileWriteError} carries, in the language `t` speaks. */
export function describeProjectFileWriteFailure(
    fsError: Pick<FsRejectError, "code">,
    t: (key: TranslationKey, params?: InterpolationParams) => string,
): string {
    const reason = describeWriteFailureReason(fsError, t);
    return reason ? t("project.writeFailed.withReason", { reason }) : t("project.writeFailed.plain");
}

type ProjectServiceEvents = {
    configChanged: ProjectConfig;
};

export class ProjectService extends Service<ProjectService> implements IProjectService {
    private projectConfig: ProjectConfig | null = null;
    private projectConfigPath: string | null = null;
    private projectConfigFormat: "nlproj" | "json" | null = null;
    private readonly events = new EventEmitter<ProjectServiceEvents>();
    /**
     * The manifest operation the next one waits for.
     *
     * Every setter here is a read-modify-write of the whole file, and the write is a grant and a `PUT`
     * that take a few milliseconds each. Two of them started together would both read the manifest
     * before either had written, so the one that landed second put back everything the first had
     * changed - and the two `PUT`s are not even ordered, so which one that was varied from run to run.
     * Two switches clicked back to back on the project panel lost one of them that way, and so did
     * any other pair of surfaces writing the manifest at once.
     *
     * So they run one at a time, each against the manifest the one before it left: that is what
     * makes every change land, and land in the order it was asked for, without a caller having to
     * refuse or grey out the second one while the first is on its way. A failed operation does not
     * stop the ones queued behind it; they build on the last manifest that was actually written.
     */
    private manifestQueue: Promise<unknown> = Promise.resolve();

    protected async init(ctx: WorkspaceContext, depend: (services: Service[]) => Promise<void>): Promise<void> {
        const filesystemService = ctx.services.get<FileSystemService>(Services.FileSystem);
        await depend([filesystemService]);

        const projectPath = this.getContext().project.getConfig().projectPath;
        const fileStats = throwException(await filesystemService.list(projectPath));
        const configFileName = findProjectConfigFileName(fileStats);

        if (!configFileName) {
            throw new RendererError("Project config not found: no .nlproj in project root");
        }

        const configPath = join(projectPath, configFileName);
        const isNlproj = configFileName.endsWith(".nlproj");

        this.projectConfigPath = configPath;
        this.projectConfigFormat = isNlproj ? "nlproj" : "json";
        this.projectConfig = await this.readProjectConfigFile();
    }

    public getProjectConfig(): ProjectConfig {
        if (!this.projectConfig) {
            throw new RendererError("Project config not initialized");
        }
        return this.projectConfig;
    }

    /**
     * Re-read the manifest from disk, replacing the cached copy.
     *
     * Every mutation here writes through immediately, so the cache normally
     * matches the file - but it only ever learns about writes *this* window
     * made. A second Studio instance on the same project, the packaging
     * pipeline, or a hand edit all move the file behind our back. A surface that
     * reports what the next build will do has to read what the build reads (see
     * the build dialog, which re-reads before describing the package).
     */
    public reloadProjectConfig(): Promise<ProjectConfig> {
        // Queued with the writes: a read that overtook one in flight would put back the manifest from
        // before it, and the next write would then build on that.
        return this.enqueueManifestOperation(async () => {
            const config = await this.readProjectConfigFile();
            this.projectConfig = config;
            // A re-read is a change as far as anything watching is concerned: the values it was
            // showing came from the copy this just replaced.
            this.events.emit("configChanged", config);
            return config;
        });
    }

    /**
     * Watch for a write to the manifest, whichever setting made it.
     *
     * The project panel already re-broadcasts its own writes to its sections, so this is not for
     * them: it is for the surfaces *outside* the panel that render a project setting and are on
     * screen at the same time as it. The story inspector's screen-effect preview is one, and the
     * weather pre-bake is another - both are showing or preparing something whose identity a
     * setting decides, so a change they do not hear about leaves them showing or making the
     * previous project's answer until something unrelated remounts them.
     *
     * The whole config rather than a per-section event, because a subscriber reads the slice it
     * cares about and a second event per setting would be a list nobody keeps in step.
     */
    public onConfigChanged(handler: (config: ProjectConfig) => void): () => void {
        return this.events.on("configChanged", handler);
    }

    /**
     * Change the manifest and write it.
     *
     * The updater runs when this change's turn comes rather than when it is asked for, so it sees
     * every change queued before it (see {@link manifestQueue}). It has to be synchronous and must not
     * call back into this method - a nested call would wait on the queue it is holding.
     */
    public updateProjectConfig(updater: (config: ProjectConfig) => ProjectConfig): Promise<ProjectConfig> {
        return this.enqueueManifestOperation(async () => {
            const current = this.cloneProjectConfig(this.getProjectConfig());
            const next = updater(current);
            this.assertValidProjectConfig(next);
            await this.writeProjectConfig(next);
            this.projectConfig = next;
            // After the write, so a subscriber that reads back through this service sees what is on
            // disk rather than a value a failed write would have rolled back.
            this.events.emit("configChanged", next);
            return next;
        });
    }

    private enqueueManifestOperation<T>(operation: () => Promise<T>): Promise<T> {
        // Run whether the previous one resolved or threw: a refused write is the caller's to report,
        // and it must not strand every change queued behind it.
        const run = this.manifestQueue.then(operation, operation);
        this.manifestQueue = run.catch(() => undefined);
        return run;
    }

    public async updateProjectName(name: string): Promise<ProjectConfig> {
        const nextName = name.trim();
        if (!nextName) {
            throw new RendererError("Project name is required");
        }
        return this.updateProjectConfig(config => ({
            ...config,
            name: nextName,
        }));
    }

    /**
     * Merge a partial patch into the project metadata (description, version,
     * author, website, ...). Undefined values in the patch are ignored so
     * callers can update a single field without clobbering the rest.
     */
    public async updateProjectMetadata(patch: Partial<ProjectMetadata>): Promise<ProjectConfig> {
        return this.updateProjectConfig(config => {
            const metadata = { ...config.metadata };
            for (const [key, value] of Object.entries(patch)) {
                if (value !== undefined) {
                    (metadata as Record<string, unknown>)[key] = value;
                }
            }
            return {
                ...config,
                metadata,
            };
        });
    }

    /**
     * Read the effective network policy, falling back to the secure defaults
     * for projects that predate the `app.network` config.
     */
    public getNetworkConfiguration(): NetworkConfiguration {
        return normalizeNetworkConfiguration(this.getProjectConfig().app?.network);
    }

    /**
     * Merge a partial patch into the project network policy. Used by the
     * project settings UI (e.g. the "Allow HTTP" toggle) and consumed by the
     * packaging pipeline when producing a distributable build.
     */
    public async updateNetworkConfiguration(patch: Partial<NetworkConfiguration>): Promise<ProjectConfig> {
        return this.updateProjectConfig(config => {
            // Normalized *after* the merge, not only before it. The patch is caller-supplied, so
            // normalizing the stored value and then spreading raw fields over it would write
            // whatever was typed - which for an allowlist entry means the stored string and the
            // string the matcher compares stop being the same document.
            const network: NetworkConfiguration = normalizeNetworkConfiguration({
                ...normalizeNetworkConfiguration(config.app?.network),
                ...patch,
            });
            const app: ProjectAppConfiguration = {
                ...config.app,
                network,
            };
            return {
                ...config,
                app,
            };
        });
    }

    /**
     * Read the effective asset-protection policy, falling back to the secure
     * default (off) for projects that predate the `app.security` config.
     */
    public getCrashConfiguration(): CrashConfiguration {
        return normalizeCrashConfiguration(this.getProjectConfig().app?.crash);
    }

    /**
     * Merge a partial patch into what the shipped game does when it stops working. Written by the
     * project settings UI and read by the packaging pipeline, which puts it on the pack.
     */
    public async updateCrashConfiguration(patch: Partial<CrashConfiguration>): Promise<ProjectConfig> {
        return this.updateProjectConfig(config => {
            const crash: CrashConfiguration = {
                ...normalizeCrashConfiguration(config.app?.crash),
                ...patch,
            };
            const app: ProjectAppConfiguration = {
                ...config.app,
                network: normalizeNetworkConfiguration(config.app?.network),
                crash,
            };
            return {
                ...config,
                app,
            };
        });
    }

    public getSecurityConfiguration(): SecurityConfiguration {
        return normalizeSecurityConfiguration(this.getProjectConfig().app?.security);
    }

    /**
     * Merge a partial patch into the project asset-protection policy. Used by the
     * project settings UI ("encrypt assets" toggle) and consumed by the packaging
     * pipeline to decide whether to encrypt the pack.
     */
    public async updateSecurityConfiguration(patch: Partial<SecurityConfiguration>): Promise<ProjectConfig> {
        return this.updateProjectConfig(config => {
            const security: SecurityConfiguration = {
                ...normalizeSecurityConfiguration(config.app?.security),
                ...patch,
            };
            const app: ProjectAppConfiguration = {
                ...config.app,
                network: normalizeNetworkConfiguration(config.app?.network),
                security,
            };
            return {
                ...config,
                app,
            };
        });
    }

    /**
     * Read the effective asset compression policy, falling back to the default
     * (every track off) for projects that predate `app.assetCompression`.
     */
    public getAssetCompressionConfiguration(): AssetCompressionConfiguration {
        return readAssetCompressionConfiguration(this.getProjectConfig().app);
    }

    /**
     * Merge a partial patch into the asset compression policy. Written by the
     * project settings UI and read by the build, which applies it to every
     * package it produces.
     *
     * Writing lands on `app.assetCompression`, and the keys this used to live
     * under are left where they are rather than deleted: a project opened by an
     * older Studio then still finds the setting it knows about, and the read
     * above prefers the current key whenever more than one is present.
     */
    public async updateAssetCompressionConfiguration(
        patch: Partial<AssetCompressionConfiguration>,
    ): Promise<ProjectConfig> {
        return this.updateProjectConfig(config => {
            const assetCompression: AssetCompressionConfiguration = {
                ...readAssetCompressionConfiguration(config.app),
                ...patch,
            };
            const app: ProjectAppConfiguration = {
                ...config.app,
                network: normalizeNetworkConfiguration(config.app?.network),
                assetCompression,
            };
            return {
                ...config,
                app,
            };
        });
    }

    /**
     * Read the effective project lint policy, falling back to the defaults (lint
     * on, errors block the build) for projects that predate `app.linting`.
     */
    public getLintingConfiguration(): LintingConfiguration {
        return normalizeLintingConfiguration(this.getProjectConfig().app?.linting);
    }

    /**
     * Merge a partial patch into the project lint policy. Used by Project ->
     * Linting and read by the build gate before it starts a production build.
     */
    public async updateLintingConfiguration(patch: Partial<LintingConfiguration>): Promise<ProjectConfig> {
        return this.updateProjectConfig(config => {
            const linting: LintingConfiguration = {
                ...normalizeLintingConfiguration(config.app?.linting),
                ...patch,
            };
            const app: ProjectAppConfiguration = {
                ...config.app,
                network: normalizeNetworkConfiguration(config.app?.network),
                linting,
            };
            return {
                ...config,
                app,
            };
        });
    }

    /**
     * Read which signing credential each platform uses, normalized for projects
     * that predate (or never configured) `app.signing`. Ids only - resolving one
     * into key material happens in the main process, at build time.
     */
    public getSigningConfiguration(): SigningConfiguration {
        return normalizeSigningConfiguration(this.getProjectConfig().app?.signing);
    }

    /**
     * Merge a patch into the signing selection. Passing `undefined` for a
     * platform clears it (the normalizer drops it), which is how the build
     * dialog says "build this one unsigned" - so the stored config never carries
     * an id the author has deselected.
     */
    public async updateSigningConfiguration(patch: Partial<SigningConfiguration>): Promise<ProjectConfig> {
        return this.updateProjectConfig(config => {
            const signing = normalizeSigningConfiguration({
                ...normalizeSigningConfiguration(config.app?.signing),
                ...patch,
            });
            const app: ProjectAppConfiguration = {
                ...config.app,
                network: normalizeNetworkConfiguration(config.app?.network),
                signing,
            };
            return {
                ...config,
                app,
            };
        });
    }

    /**
     * Mint a distribution key for this project, replacing any it already has.
     *
     * The value is produced by the host process and written here verbatim; this
     * method is the only path by which it enters the manifest, and nothing ever
     * reads it back out for display. `rotatedAt` is stamped alongside because a
     * date is the only part of the answer an author can act on - it tells them
     * which of their shipped builds still match.
     *
     * Replacing is destructive in a way that is invisible at the moment it
     * happens: builds shipped under the previous key will not accept an add-on
     * produced after this call. The confirmation for that lives with the button,
     * where the author is, rather than here.
     */
    public async rotateDistributionKey(): Promise<ProjectConfig> {
        const result = await getInterface().distribution.createKey();
        if (!result.success) {
            throw new RendererError(result.error ?? "Could not create a distribution key");
        }
        const distribution: DistributionConfiguration = {
            key: result.data.key,
            rotatedAt: new Date().toISOString(),
        };
        return this.updateProjectConfig(config => {
            const app: ProjectAppConfiguration = {
                ...config.app,
                network: normalizeNetworkConfiguration(config.app?.network),
                distribution,
            };
            return { ...config, app };
        });
    }

    /** The project's distribution key, or null when it has never been minted. */
    public getDistributionConfiguration(): DistributionConfiguration | null {
        return normalizeDistributionConfiguration(this.getProjectConfig().app?.distribution);
    }

    /**
     * Update the mobile shell settings. Read by the mobile repack, which writes
     * them into the shell config the packaged game reads at startup.
     */
    public async updateMobileConfiguration(patch: Partial<MobileConfiguration>): Promise<ProjectConfig> {
        return this.updateProjectConfig(config => {
            const mobile: MobileConfiguration = {
                ...normalizeMobileConfiguration(config.app?.mobile),
                ...patch,
            };
            const app: ProjectAppConfiguration = {
                ...config.app,
                network: normalizeNetworkConfiguration(config.app?.network),
                mobile,
            };
            return {
                ...config,
                app,
            };
        });
    }

    /**
     * Read the effective automatic-saving policy, falling back to the defaults
     * (on, every 5s, 3 slots) for projects that predate the `app.autoSave`
     * config.
     */
    public getAutoSaveConfiguration(): AutoSaveConfiguration {
        return normalizeAutoSaveConfiguration(this.getProjectConfig().app?.autoSave);
    }

    /**
     * Merge a partial patch into the automatic-saving policy. Written by the
     * project Game settings page and baked into the bundle the game app runs
     * its autosave scheduler off.
     */
    public async updateAutoSaveConfiguration(patch: Partial<AutoSaveConfiguration>): Promise<ProjectConfig> {
        return this.updateProjectConfig(config => {
            const autoSave = normalizeAutoSaveConfiguration({
                ...normalizeAutoSaveConfiguration(config.app?.autoSave),
                ...patch,
            });
            const app: ProjectAppConfiguration = {
                ...config.app,
                network: normalizeNetworkConfiguration(config.app?.network),
                autoSave,
            };
            return {
                ...config,
                app,
            };
        });
    }

    /**
     * Read the effective save-compatibility policy, falling back to the defaults for projects that
     * predate `app.saveCompatibility`. Saves those projects have already written carry no stamp and
     * are unaffected either way; the defaults decide what happens to the ones written from here on.
     */
    public getSaveCompatibilityConfiguration(): SaveCompatibilityConfiguration {
        return normalizeSaveCompatibilityConfiguration(this.getProjectConfig().app?.saveCompatibility);
    }

    /**
     * Merge a partial patch into the save-compatibility policy. Written by the project Game
     * settings page and baked into the bundle, where both halves read it: the listing a save
     * screen shows and the load a player asks for.
     */
    public async updateSaveCompatibilityConfiguration(
        patch: Partial<SaveCompatibilityConfiguration>,
    ): Promise<ProjectConfig> {
        return this.updateProjectConfig(config => {
            const saveCompatibility = normalizeSaveCompatibilityConfiguration({
                ...normalizeSaveCompatibilityConfiguration(config.app?.saveCompatibility),
                ...patch,
            });
            const app: ProjectAppConfiguration = {
                ...config.app,
                network: normalizeNetworkConfiguration(config.app?.network),
                saveCompatibility,
            };
            return {
                ...config,
                app,
            };
        });
    }

    /** Where a shipped desktop game writes the player's files; the default for projects without one. */
    public getSaveLocationConfiguration(): SaveLocationConfiguration {
        return normalizeSaveLocationConfiguration(this.getProjectConfig().app?.saveLocation);
    }

    /**
     * Merge a partial patch into the save-location setting. Written by the project App page and
     * baked into the app manifest, which is where the runtime reads it: the answer is needed before
     * Chromium starts, long before anything can open the pack.
     */
    public async updateSaveLocationConfiguration(
        patch: Partial<SaveLocationConfiguration>,
    ): Promise<ProjectConfig> {
        return this.updateProjectConfig(config => {
            const saveLocation = normalizeSaveLocationConfiguration({
                ...normalizeSaveLocationConfiguration(config.app?.saveLocation),
                ...patch,
            });
            const app: ProjectAppConfiguration = {
                ...config.app,
                network: normalizeNetworkConfiguration(config.app?.network),
                saveLocation,
            };
            return {
                ...config,
                app,
            };
        });
    }

    /** What a language change does to a running playthrough; the default for projects without one. */
    public getLanguageChangeConfiguration(): LanguageChangeConfiguration {
        return normalizeLanguageChangeConfiguration(this.getProjectConfig().app?.languageChange);
    }

    /**
     * Merge a partial patch into the language-change policy. Written by the project Game settings
     * page and baked into the bundle, where the game app reads it at the moment a `Set Language`
     * node runs with a playthrough in progress.
     */
    public async updateLanguageChangeConfiguration(
        patch: Partial<LanguageChangeConfiguration>,
    ): Promise<ProjectConfig> {
        return this.updateProjectConfig(config => {
            const languageChange = normalizeLanguageChangeConfiguration({
                ...normalizeLanguageChangeConfiguration(config.app?.languageChange),
                ...patch,
            });
            const app: ProjectAppConfiguration = {
                ...config.app,
                network: normalizeNetworkConfiguration(config.app?.network),
                languageChange,
            };
            return {
                ...config,
                app,
            };
        });
    }

    /**
     * Read the player-preference defaults, falling back to the engine's own for
     * projects that predate `app.preferences`.
     */
    public getPlayerPreferences(): PlayerPreferences {
        return normalizePlayerPreferences(this.getProjectConfig().app?.preferences);
    }

    /**
     * Merge a partial patch into the player-preference defaults. Written by the
     * project Preferences page and baked into the bundle the game app seeds
     * `game.preference` from at boot.
     */
    public async updatePlayerPreferences(patch: Partial<PlayerPreferences>): Promise<ProjectConfig> {
        return this.updateProjectConfig(config => {
            const preferences = normalizePlayerPreferences({
                ...normalizePlayerPreferences(config.app?.preferences),
                ...patch,
            });
            const app: ProjectAppConfiguration = {
                ...config.app,
                network: normalizeNetworkConfiguration(config.app?.network),
                preferences,
            };
            return {
                ...config,
                app,
            };
        });
    }

    /**
     * Read the author's dialogue settings, falling back to the engine's own for projects that
     * predate `app.dialogue`.
     */
    public getDialogueConfiguration(): DialogueConfiguration {
        return normalizeDialogueConfiguration(this.getProjectConfig().app?.dialogue);
    }

    /**
     * Merge a partial patch into the author's dialogue settings. Written by the project Game page
     * and baked into the bundle the game app configures the engine from at boot.
     */
    public async updateDialogueConfiguration(patch: Partial<DialogueConfiguration>): Promise<ProjectConfig> {
        return this.updateProjectConfig(config => {
            const dialogue = normalizeDialogueConfiguration({
                ...normalizeDialogueConfiguration(config.app?.dialogue),
                ...patch,
            });
            const app: ProjectAppConfiguration = {
                ...config.app,
                network: normalizeNetworkConfiguration(config.app?.network),
                dialogue,
            };
            return {
                ...config,
                app,
            };
        });
    }

    /**
     * Merge a partial patch into the preload behavior. Written by the project Settings page and
     * baked into the bundle the game app configures the engine from at boot.
     */
    public async updatePreloadConfiguration(patch: Partial<PreloadConfiguration>): Promise<ProjectConfig> {
        return this.updateProjectConfig(config => {
            const preload = normalizePreloadConfiguration({
                ...normalizePreloadConfiguration(config.app?.preload),
                ...patch,
            });
            const app: ProjectAppConfiguration = {
                ...config.app,
                network: normalizeNetworkConfiguration(config.app?.network),
                preload,
            };
            return {
                ...config,
                app,
            };
        });
    }

    /**
     * Read what the shipped game's window may do, falling back to the defaults for projects that
     * predate `app.window` - which is a resizable window that remembers where it was.
     */
    public getWindowConfiguration(): WindowConfiguration {
        return normalizeWindowConfiguration(this.getProjectConfig().app?.window);
    }

    /**
     * Merge a partial patch into the window settings.
     *
     * Written by the project App page and baked into the bundle, where the shell reads it to open
     * its window and the game's own configuration screen reads it to know what sizes to offer.
     */
    public async updateWindowConfiguration(patch: Partial<WindowConfiguration>): Promise<ProjectConfig> {
        return this.updateProjectConfig(config => {
            const window = normalizeWindowConfiguration({
                ...normalizeWindowConfiguration(config.app?.window),
                ...patch,
            });
            const app: ProjectAppConfiguration = {
                ...config.app,
                network: normalizeNetworkConfiguration(config.app?.network),
                window,
            };
            return {
                ...config,
                app,
            };
        });
    }

    /**
     * Read the frame rate this project's screen effects are baked at, falling back to 30 for
     * projects that predate `app.vfx` - which is the rate their clips are already on disk at.
     */
    public getVfxConfiguration(): VfxConfiguration {
        return normalizeVfxConfiguration(this.getProjectConfig().app?.vfx);
    }

    /**
     * Merge a partial patch into the screen-effect settings.
     *
     * Written by the project App page, baked into the bundle, and read by the baker - all three from
     * this one field, because the rate is part of the identity of the clip a story row addresses.
     */
    public async updateVfxConfiguration(patch: Partial<VfxConfiguration>): Promise<ProjectConfig> {
        return this.updateProjectConfig(config => {
            const vfx = normalizeVfxConfiguration({
                ...normalizeVfxConfiguration(config.app?.vfx),
                ...patch,
            });
            const app: ProjectAppConfiguration = {
                ...config.app,
                network: normalizeNetworkConfiguration(config.app?.network),
                vfx,
            };
            return {
                ...config,
                app,
            };
        });
    }

    /**
     * Read the remembered production-build selection, or null when the project
     * has never been built (the build dialog then uses a host-appropriate
     * default).
     */
    public getBuildConfiguration(): BuildConfiguration | null {
        return normalizeBuildConfiguration(this.getProjectConfig().app?.build);
    }

    /**
     * Persist the production-build dialog selection so the next build reopens
     * with the same platforms/formats/output dir.
     */
    public async updateBuildConfiguration(build: BuildConfiguration): Promise<ProjectConfig> {
        return this.updateProjectConfig(config => {
            const app: ProjectAppConfiguration = {
                ...config.app,
                network: normalizeNetworkConfiguration(config.app?.network),
                build,
            };
            return {
                ...config,
                app,
            };
        });
    }

    /**
     * Read the remembered patch-export selection, or null when the project has
     * never had a patch exported from it.
     */
    public getPatchConfiguration(): PatchConfiguration | null {
        return normalizePatchConfiguration(this.getProjectConfig().app?.patch);
    }

    /**
     * Persist the patch dialog's selection so the next export reopens with the
     * same editions, build folder and file.
     */
    public async updatePatchConfiguration(patch: PatchConfiguration): Promise<ProjectConfig> {
        return this.updateProjectConfig(config => {
            const app: ProjectAppConfiguration = {
                ...config.app,
                network: normalizeNetworkConfiguration(config.app?.network),
                patch,
            };
            return {
                ...config,
                app,
            };
        });
    }

    /**
     * Read the effective game localization setup, normalized with safe defaults
     * for projects that predate (or never configured) `app.localization`.
     */
    public getLocalizationConfiguration(): LocalizationConfiguration {
        return normalizeLocalizationConfiguration(this.getProjectConfig().app?.localization);
    }

    /**
     * Replace the game localization setup via an updater over the current
     * normalized value. Used by the Localization panel (language management)
     * and consumed by the Dev Mode / packaging bundle assembler.
     */
    public async updateLocalizationConfiguration(
        updater: (current: LocalizationConfiguration) => LocalizationConfiguration,
    ): Promise<LocalizationConfiguration> {
        let applied: LocalizationConfiguration = normalizeLocalizationConfiguration(undefined);
        await this.updateProjectConfig(config => {
            const next = normalizeLocalizationConfiguration(
                updater(normalizeLocalizationConfiguration(config.app?.localization)),
            );
            applied = next;
            const app: ProjectAppConfiguration = {
                ...config.app,
                network: normalizeNetworkConfiguration(config.app?.network),
                localization: next,
            };
            return {
                ...config,
                app,
            };
        });
        return applied;
    }

    /**
     * Read the effective game voice-over setup, normalized with safe defaults
     * for projects that predate (or never configured) `app.voice`.
     */
    public getVoiceConfiguration(): VoiceConfiguration {
        return normalizeVoiceConfiguration(this.getProjectConfig().app?.voice);
    }

    /**
     * Replace the game voice-over setup via an updater over the current
     * normalized value. Used by the Voice panel (voice-language management) and
     * consumed by the Dev Mode / packaging bundle assembler.
     */
    public async updateVoiceConfiguration(
        updater: (current: VoiceConfiguration) => VoiceConfiguration,
    ): Promise<VoiceConfiguration> {
        let applied: VoiceConfiguration = normalizeVoiceConfiguration(undefined);
        await this.updateProjectConfig(config => {
            const next = normalizeVoiceConfiguration(
                updater(normalizeVoiceConfiguration(config.app?.voice)),
            );
            applied = next;
            const app: ProjectAppConfiguration = {
                ...config.app,
                network: normalizeNetworkConfiguration(config.app?.network),
                voice: next,
            };
            return {
                ...config,
                app,
            };
        });
        return applied;
    }

    /** The project's icon set, migrated from the legacy five-slot shape if needed. */
    public getProjectIconSet(): ProjectIconSet {
        return normalizeProjectIconSet(this.getProjectConfig().metadata?.icons);
    }

    /** Persist a change to the icon set. The updater receives a normalized set. */
    public async updateProjectIconSet(updater: (set: ProjectIconSet) => ProjectIconSet): Promise<ProjectIconSet> {
        let applied: ProjectIconSet = this.getProjectIconSet();
        await this.updateProjectConfig(config => {
            applied = updater(normalizeProjectIconSet(config.metadata?.icons));
            return {
                ...config,
                metadata: { ...config.metadata, icons: applied },
            };
        });
        return applied;
    }

    /**
     * Ask for an image and copy it into `resources/icons/source/`. `slot` is
     * "master" or a target that wants its own artwork; the stored file is named
     * after the slot, so re-importing replaces rather than accumulates. Returns
     * null when the picker was dismissed.
     */
    public async importProjectIconSource(slot: string): Promise<{ source: ProjectIconSource; bytes: Uint8Array } | null> {
        // Every failure below is thrown as the sentence the icon section shows: the file by the name
        // it has on the author's disk, never the path, and the filesystem's reason only where the
        // author can act on it.
        const selection = await appPrivilegedFacade.fs.selectFile(PROJECT_ICON_PICKER_EXTENSIONS, false);
        if (!selection.success || !selection.data.ok) {
            throw new ProjectFileAccessError(translate("project.assets.pickFailed"), {
                cause: selection.success ? selection.data : selection.error,
            });
        }
        const sourcePath = selection.data.data[0];
        if (!sourcePath) {
            return null;
        }
        const sourceName = basename(sourcePath);

        const extension = normalizeIconExtension(sourcePath);
        if (!PROJECT_ICON_PICKER_EXTENSIONS.includes(extension)) {
            throw new ProjectFileAccessError(translate("project.assets.unsupported", { name: sourceName }));
        }

        const filesystemService = this.getContext().services.get<FileSystemService>(Services.FileSystem);
        const read = await filesystemService.readRaw(sourcePath);
        if (!read.ok) {
            // "Missing from the project folder" is not offered: the file was picked from anywhere.
            throw new ProjectFileAccessError(withReadFailureReason(
                translate("project.assets.readFailed", { name: sourceName }),
                read.error.code === FsRejectErrorCode.PERMISSION_DENIED ? read.error.code : undefined,
                translate,
            ), { cause: read.error });
        }
        const bytes = read.data;
        const sourcesDir = await filesystemService.createDir(
            this.getContext().project.resolve(ProjectNameConvention.ProjectIconSources),
        );
        if (!sourcesDir.ok) {
            throwWriteFailure(PROJECT_ICON, sourcesDir);
        }

        // A slot holds one file. Importing a .svg over a .png would otherwise
        // leave the old one behind, tracked and dead.
        await this.removeIconSourceSiblings(slot, extension);

        const relativeSegments = ProjectNameConvention.ProjectIconSource(slot, extension);
        throwWriteFailure(PROJECT_ICON, await filesystemService.writeRaw(
            this.getContext().project.resolve(relativeSegments),
            bytes,
            storeWrite(PROJECT_ICON.store, "handledByWriter"),
        ));

        return {
            bytes,
            source: {
                path: relativeSegments.join("/"),
                sourceName,
                mediaType: ICON_MEDIA_TYPES[extension] ?? "application/octet-stream",
                updatedAt: new Date().toISOString(),
            },
        };
    }

    /** Read a source or baked icon's bytes, or null when it is not on disk. */
    public async readProjectIconFile(relativePath: string): Promise<Uint8Array | null> {
        if (!relativePath.trim()) {
            return null;
        }
        const filesystemService = this.getContext().services.get<FileSystemService>(Services.FileSystem);
        const read = await filesystemService.readRaw(this.getContext().project.resolve(relativePath));
        return read.ok ? read.data : null;
    }

    /**
     * Write a baked icon, but only when its bytes actually differ from what is
     * already there. The baked files are version-controlled project content, so
     * an unconditional write would stamp a fresh mtime - and, on a checkout
     * whose encoder differs by a byte, a diff - every time the panel opened.
     * Returns whether anything was written.
     */
    public async writeProjectIconBake(relativePath: string, bytes: Uint8Array): Promise<boolean> {
        return this.writeProjectDerivedFile(relativePath, bytes, PROJECT_ICON);
    }

    /**
     * Write a derived project file, but only when its bytes actually differ from what is already
     * there. Derived files are version-controlled project content (baked icons, baked character
     * avatars), so an unconditional write would stamp a fresh mtime - and, on a checkout whose
     * encoder differs by a byte, a diff - every time the panel that reconciles them opened.
     *
     * The parent directory is created from the path itself rather than from a fixed constant, so
     * one derived tree does not have to know about another's layout. Returns whether anything was
     * written.
     */
    public async writeProjectDerivedFile(
        relativePath: string,
        bytes: Uint8Array,
        name: SavedFileName & { store: TranslationKey },
    ): Promise<boolean> {
        const filesystemService = this.getContext().services.get<FileSystemService>(Services.FileSystem);
        const absolutePath = this.getContext().project.resolve(relativePath);
        const existing = await filesystemService.readRaw(absolutePath);
        if (existing.ok && sameBytes(existing.data, bytes)) {
            return false;
        }
        const parent = relativePath.replace(/\\/g, "/").split("/").slice(0, -1).join("/");
        if (parent) {
            const created = await filesystemService.createDir(this.getContext().project.resolve(parent));
            if (!created.ok) {
                throwWriteFailure(name, created);
            }
        }
        // Derived, so baked again the next time it is asked for: the caller that asked is the one to
        // say it did not happen, and the error it throws already says it in the author's words.
        throwWriteFailure(name, await filesystemService.writeRaw(absolutePath, bytes, storeWrite(name.store, "handledByWriter")));
        return true;
    }

    /** Whether a source or baked icon is on disk. */
    public async projectIconFileExists(relativePath: string): Promise<boolean> {
        if (!relativePath.trim()) {
            return false;
        }
        const filesystemService = this.getContext().services.get<FileSystemService>(Services.FileSystem);
        const exists = await filesystemService.isFileExists(this.getContext().project.resolve(relativePath));
        return exists.ok && exists.data;
    }

    /** Delete a file under the project's icon directory, ignoring a missing one. */
    public async deleteProjectIconFile(relativePath: string): Promise<void> {
        const filesystemService = this.getContext().services.get<FileSystemService>(Services.FileSystem);
        const absolutePath = this.getContext().project.resolve(relativePath);
        const exists = await filesystemService.isFileExists(absolutePath);
        if (exists.ok && exists.data) {
            await filesystemService.deleteFile(absolutePath);
        }
    }

    private async removeIconSourceSiblings(slot: string, keepExtension: string): Promise<void> {
        for (const extension of PROJECT_ICON_PICKER_EXTENSIONS) {
            if (extension === keepExtension) {
                continue;
            }
            await this.deleteProjectIconFile(ProjectNameConvention.ProjectIconSource(slot, extension).join("/"));
        }
    }

    /** The project's recorded plugin dependency table, or undefined when unused. */
    public getDependencyTable(): ProjectDependencyTable | undefined {
        return this.getProjectConfig().dependencies;
    }

    /**
     * Persist a freshly scanned dependency table into the manifest. Passing
     * undefined (or an empty table) removes the field so plugin-free projects
     * keep a clean manifest.
     */
    public async setDependencyTable(table: ProjectDependencyTable | undefined): Promise<ProjectConfig> {
        return this.updateProjectConfig(config => {
            const next = { ...config };
            if (table && table.plugins.length > 0) {
                next.dependencies = table;
            } else {
                delete next.dependencies;
            }
            return next;
        });
    }

    /**
     * Load the manifest from the path resolved at init, in whichever format that
     * file uses. The format is never re-sniffed: a session that opened a .nlproj
     * keeps reading a .nlproj.
     */
    private async readProjectConfigFile(): Promise<ProjectConfig> {
        if (!this.projectConfigPath || !this.projectConfigFormat) {
            throw new RendererError("Project config path not initialized");
        }

        const filesystemService = this.getContext().services.get<FileSystemService>(Services.FileSystem);
        let projectConfig: ProjectConfig;
        if (this.projectConfigFormat === "nlproj") {
            const rawData = throwException(await filesystemService.readRaw(this.projectConfigPath));
            projectConfig = decodeProjectConfig(rawData) as ProjectConfig;
        } else {
            projectConfig = throwException(await filesystemService.readJSON<ProjectConfig>(this.projectConfigPath));
        }

        // Normalize (or drop) a possibly-malformed dependency table up front so a
        // corrupt table can never propagate - a broken table must not block load.
        const normalizedDependencies = normalizeProjectDependencyTable(projectConfig.dependencies);
        if (normalizedDependencies) {
            projectConfig.dependencies = normalizedDependencies;
        } else {
            delete projectConfig.dependencies;
        }

        return projectConfig;
    }

    private async writeProjectConfig(config: ProjectConfig): Promise<void> {
        if (!this.projectConfigPath || !this.projectConfigFormat) {
            throw new RendererError("Project config path not initialized");
        }

        const filesystemService = this.getContext().services.get<FileSystemService>(Services.FileSystem);
        const result = this.projectConfigFormat === "nlproj"
            ? await filesystemService.writeRaw(this.projectConfigPath, encodeProjectConfig(config as any), PROJECT_FILE_WRITE)
            : await filesystemService.write(this.projectConfigPath, JSON.stringify(config, null, 2), "utf-8", PROJECT_FILE_WRITE);
        if (!result.ok) {
            throw new ProjectFileWriteError(result.error);
        }
    }

    private cloneProjectConfig(config: ProjectConfig): ProjectConfig {
        return JSON.parse(JSON.stringify(config)) as ProjectConfig;
    }

    private assertValidProjectConfig(config: ProjectConfig): void {
        if (!config || typeof config !== "object") {
            throw new RendererError("Invalid project config");
        }
        if (typeof config.name !== "string" || !config.name.trim()) {
            throw new RendererError("Project name is required");
        }
        if (typeof config.identifier !== "string") {
            throw new RendererError("Project identifier is required");
        }
        if (!config.metadata || typeof config.metadata !== "object") {
            config.metadata = {};
        }
        // Tolerate the machine-managed dependency table: normalize it if present,
        // drop it if malformed. Never throw - dependencies must not gate a save.
        const normalizedDependencies = normalizeProjectDependencyTable(config.dependencies);
        if (normalizedDependencies && normalizedDependencies.plugins.length > 0) {
            config.dependencies = normalizedDependencies;
        } else {
            delete config.dependencies;
        }
    }
}

function normalizeIconExtension(sourcePath: string): string {
    return extname(sourcePath).replace(/^\./, "").toLowerCase();
}

function sameBytes(a: Uint8Array, b: Uint8Array): boolean {
    if (a.byteLength !== b.byteLength) {
        return false;
    }
    for (let i = 0; i < a.byteLength; i++) {
        if (a[i] !== b[i]) {
            return false;
        }
    }
    return true;
}
