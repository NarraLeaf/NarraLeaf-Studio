import { isLocalizationEnabled, type LocalizationDocument } from "@shared/types/localization";
import type { NetworkPluginAllowlistEntry } from "@shared/types/networkAllowlist";
import { getInterface } from "@/lib/app/bridge";
import { isProjectTrusted } from "@/lib/workspace/projectTrust";
import { isVoiceEnabled, type VoiceDocument } from "@shared/types/voice";
import { buildMergedVariableView } from "@shared/variables/mergedPersistentView";
import { runLintRules, type LintRunOptions } from "@/lib/lint/engine";
import { LiveLintScheduler } from "@/lib/lint/liveScheduler";
import { subscribeActiveBrandPalette } from "@shared/brand/brandRegistry";
import { subscribeActiveProjectFonts } from "@shared/typography/projectFonts";
import { subscribeActiveSaveSchema } from "@shared/saves/saveSchemaRegistry";
import type {
    LintAlphaProbe,
    LintAssetEntry,
    LintCharacterEntry,
    LintContext,
    LintImageProbe,
    LintIo,
    LintStoryEntry,
} from "@/lib/lint/context";
import type { LintReport, LintReportEntry } from "@/lib/lint/types";
import type { FontCoverageResult } from "@shared/typography/fontCoverage";
import { isUnrenderableFontFormat } from "@shared/typography/fontFormats";
import { AssetType } from "../assets/assetTypes";
import type { Asset } from "../assets/types";
import { savedVariableDefs, storyPersistentDefs } from "@shared/types/story/declarations";
import { storyUnreadableFinding } from "@/lib/lint/storyLoadFailure";
import { formatLintFinishedLine } from "@/lib/lint/finishedLine";
import type { StoryLibraryIndex } from "@shared/types/story";
import { translate } from "@/lib/i18n";
import { normalizeBuildConfiguration } from "../../project/configuration";
import { ProjectNameConvention } from "../../project/nameConvention";
import { Service } from "../Service";
import { Services, type ILintService, type WorkspaceContext } from "../services";
import { EventEmitter } from "../ui/EventEmitter";
import { AppTagService } from "../appTag/AppTagService";
import { DlcService } from "../dlc/DlcService";
import { AssetSetService } from "../assets/AssetSetService";
import { AssetsService } from "./AssetsService";
import { CharacterService } from "./CharacterService";
import { ConsoleService } from "./ConsoleService";
import { FileSystemService } from "./FileSystem";
import { ProjectService } from "./ProjectService";
import type { ServiceAssetsService } from "./ServiceAssetsService";
import { LocalizationService } from "../localization/LocalizationService";
import { ReferenceService } from "../references/ReferenceService";
import { StoryService } from "../story/StoryService";
import { UIDocumentService } from "../ui-editor/UIDocumentService";
import { UIGraphService } from "../ui-editor/UIGraphService";
import { VariableRegistryService } from "../variables/VariableRegistryService";
import { VoiceService } from "../voice/VoiceService";

/** Console channel the lint sweep logs to; also where it drives the progress bar. */
export const LINT_CONSOLE_CHANNEL = "lint";

/** `source` stamped on every console line the lint sweep emits. */
export const LINT_CONSOLE_SOURCE = "Lint";

/**
 * How many image decodes may be in flight at once.
 *
 * `probeImage` is the only genuinely slow thing a rule can ask for, and it is asked per asset - a
 * 2000-asset project would otherwise open 2000 object URLs and 2000 `<img>` decodes in one tick,
 * which is how the renderer runs out of memory rather than how it goes fast.
 */
const IMAGE_PROBE_CONCURRENCY = 4;

/**
 * How many ffprobe spawns may be in flight at once.
 *
 * Lower than the image bound because each one is a process rather than a decode, and because the
 * rule that asks is asking about a handful of rows rather than about a whole library - see
 * `portability/vfx-alpha`, which probes only the clips whose row already looks wrong.
 */
const VIDEO_PROBE_CONCURRENCY = 2;

type LintServiceEvents = {
    reportChanged: LintReport | null;
    stateChanged: LintServiceState;
};

/** What the sweeps are doing, for the surfaces that say whether the findings on show are current. */
export type LintServiceState = {
    /** A sweep somebody asked for (the command, the build gate) is running. */
    requestedRunning: boolean;
    /** The findings follow edits by themselves (the workspace window holds `startLive`). */
    live: boolean;
    /** The findings on show may be behind the project: a change is waiting to be checked, or being checked. */
    pending: boolean;
};

/**
 * Project-wide lint (see `@/lib/lint`).
 *
 * The service owns everything impure: assembling the context out of the other services, the console
 * channel and its progress bar, and the last report. The rules themselves never see any of it - they
 * get a `LintContext` snapshot and return findings, which is what makes them testable without an
 * app (ruling R1).
 *
 * A sweep is read-only, so it is deliberately usable while the workspace is frozen (ruling R3):
 * nothing here writes a project file.
 */
export class LintService extends Service<LintService> implements ILintService {
    private lastReport: LintReport | null = null;
    private disposeChannel: (() => void) | null = null;
    private readonly events = new EventEmitter<LintServiceEvents>();
    /**
     * Findings produced while *assembling* the context rather than by a rule - a story that will
     * not load. They belong in the report (an unreadable story is the most serious thing lint can
     * find), but no rule can report them: a rule only sees the stories that loaded.
     *
     * The last assembly's, kept for inspection; a sweep uses the ones its own assembly returned, so
     * a live sweep and a requested one never read each other's.
     */
    private contextFindings: LintReportEntry[] = [];
    /** The sweep somebody asked for, while it runs - a second request joins it. */
    private requested: Promise<LintReport> | null = null;
    /** The background sweep in progress, and what stops it when a requested one needs the floor. */
    private liveSweep: { abort: AbortController; done: Promise<void> } | null = null;
    private liveScheduler: LiveLintScheduler | null = null;
    private liveUsers = 0;
    private disposeLiveSources: (() => void) | null = null;
    /**
     * What the asset probes answered, by asset id and content hash.
     *
     * The background sweeps run after every pause in editing, and the probes are the only slow thing
     * a rule asks for: a stat per asset and a decode per image. Their answers only change when the
     * file does, and a changed file is a new hash, so a background sweep reuses them. A requested
     * sweep starts from an empty cache - it is the one that has to notice a file removed from disk
     * behind Studio's back.
     */
    private readonly probeCache: LintProbeCache = createLintProbeCache();

    protected async init(ctx: WorkspaceContext, depend: (services: Service[]) => Promise<void>): Promise<void> {
        const consoleService = ctx.services.get<ConsoleService>(Services.Console);
        await depend([consoleService]);

        this.disposeChannel?.();
        this.disposeChannel = consoleService.registerChannel({
            id: LINT_CONSOLE_CHANNEL,
            label: "Lint",
            description: "Project lint sweeps and their findings",
        });
    }

    public override dispose(_ctx: WorkspaceContext): void {
        this.disposeChannel?.();
        this.disposeChannel = null;
        this.stopLive();
        this.liveUsers = 0;
        this.liveSweep?.abort.abort();
        this.liveSweep = null;
        this.lastReport = null;
        this.contextFindings = [];
        this.requested = null;
        this.clearProbeCache();
        this.events.clear();
    }

    /** Whether a sweep somebody asked for is running. Background sweeps are {@link getState}'s. */
    public isRunning(): boolean {
        return this.requested !== null;
    }

    public getLastReport(): LintReport | null {
        return this.lastReport;
    }

    public onReportChanged(handler: (report: LintReport | null) => void): () => void {
        return this.events.on("reportChanged", handler);
    }

    public getState(): LintServiceState {
        return {
            requestedRunning: this.requested !== null,
            live: this.liveScheduler !== null,
            pending: this.requested !== null || (this.liveScheduler?.isPending() ?? false),
        };
    }

    public onStateChanged(handler: (state: LintServiceState) => void): () => void {
        return this.events.on("stateChanged", handler);
    }

    /**
     * Keep the findings current while the project is edited: sweep now, and again after every pause
     * in editing. Returns the release; the sweeps stop when the last holder releases.
     *
     * Held by the workspace window rather than started by the service itself, because the same
     * service also serves the command-line `--lint` and `--build`, which open a project to sweep it
     * once and must not leave a schedule running behind them.
     */
    public startLive(): () => void {
        this.liveUsers += 1;
        if (!this.liveScheduler) {
            this.liveScheduler = new LiveLintScheduler({
                sweep: () => this.sweepInBackground(),
                onPhaseChanged: () => this.emitState(),
            });
            this.disposeLiveSources = this.subscribeToProjectChanges(() => this.liveScheduler?.markChanged());
            this.liveScheduler.runSoon();
            this.emitState();
        }
        let released = false;
        return () => {
            if (released) {
                return;
            }
            released = true;
            this.liveUsers = Math.max(0, this.liveUsers - 1);
            if (this.liveUsers === 0) {
                this.stopLive();
                this.emitState();
            }
        };
    }

    private stopLive(): void {
        this.disposeLiveSources?.();
        this.disposeLiveSources = null;
        this.liveScheduler?.dispose();
        this.liveScheduler = null;
    }

    private emitState(): void {
        this.events.emit("stateChanged", this.getState());
    }

    /**
     * Every source of a change a rule could see. Anything a rule reads and nothing here announces
     * would leave the panel showing findings about a project that is no longer there.
     *
     * Each subscription is attempted on its own: a service missing from a harness, or one that
     * throws while the project is still opening, costs that one source rather than all of them.
     */
    private subscribeToProjectChanges(changed: () => void): () => void {
        const services = this.getContext().services;
        const disposers: (() => void)[] = [];
        const listen = (subscribe: () => (() => void) | void) => {
            try {
                const dispose = subscribe();
                if (typeof dispose === "function") {
                    disposers.push(dispose);
                }
            } catch (error) {
                console.warn("[LintService] a change source could not be watched", error);
            }
        };

        listen(() => services.get<StoryService>(Services.Story).onDocumentChanged(changed));
        listen(() => services.get<StoryService>(Services.Story).onLibraryChanged(changed));
        listen(() => services.get<StoryService>(Services.Story).onAnimationsChanged(changed));
        listen(() => services.get<UIDocumentService>(Services.UIDocument).onDocumentChanged(changed));
        listen(() => services.get<UIGraphService>(Services.UIGraph).onGraphsChanged(changed));
        listen(() => {
            const events = services.get<AssetsService>(Services.Assets).getEvents();
            const offUpdated = events.on("updated", changed);
            const offDeleted = events.on("deleted", changed);
            return () => {
                offUpdated();
                offDeleted();
            };
        });
        listen(() => services.get<AssetSetService>(Services.AssetSets).onSetsChanged(changed));
        listen(() => services.get<CharacterService>(Services.Character).subscribe(changed));
        listen(() => services.get<LocalizationService>(Services.Localization).onConfigChanged(changed));
        listen(() => services.get<LocalizationService>(Services.Localization).onDocumentChanged(changed));
        listen(() => services.get<LocalizationService>(Services.Localization).onKeysChanged(changed));
        listen(() => services.get<VoiceService>(Services.Voice).onConfigChanged(changed));
        listen(() => services.get<VoiceService>(Services.Voice).onDocumentChanged(changed));
        listen(() => services.get<VariableRegistryService>(Services.VariableRegistry).onRegistryChanged(changed));
        listen(() => services.get<AppTagService>(Services.AppTags).onTagsChanged(changed));
        listen(() => services.get<DlcService>(Services.Dlc).onDlcChanged(changed));
        // The project file carries the check settings themselves: a rule turned off or retuned
        // should change the panel without anybody re-running anything.
        listen(() => services.get<ProjectService>(Services.Project).onConfigChanged(changed));
        // Rebuilt a moment after the documents it indexes change; `assets/missing` and
        // `assets/unused` read it, so a sweep that ran before it caught up has to run again.
        listen(() => services.get<ReferenceService>(Services.Reference).onIndexChanged(changed));
        // Read by rules from the module that holds them rather than from a service.
        listen(() => subscribeActiveBrandPalette(changed));
        listen(() => subscribeActiveProjectFonts(changed));
        listen(() => subscribeActiveSaveSchema(changed));

        return () => {
            for (const dispose of disposers.splice(0)) {
                try {
                    dispose();
                } catch {
                    // Already gone with its service.
                }
            }
        };
    }

    /**
     * One background sweep: silent (no console lines, no progress bar - it runs after every pause in
     * editing), and abandoned without a word when a requested sweep needs the floor.
     */
    private async sweepInBackground(): Promise<void> {
        if (this.requested) {
            return;
        }
        const abort = new AbortController();
        let finish!: () => void;
        const done = new Promise<void>(resolve => {
            finish = resolve;
        });
        this.liveSweep = { abort, done };
        try {
            const { ctx, contextFindings } = await this.assembleContext();
            if (abort.signal.aborted) {
                return;
            }
            const report = await runLintRules(ctx, { signal: abort.signal });
            if (abort.signal.aborted) {
                return;
            }
            this.publish(mergeContextFindings(report, contextFindings));
        } catch (error) {
            console.warn("[LintService] background sweep failed", error);
        } finally {
            if (this.liveSweep?.abort === abort) {
                this.liveSweep = null;
            }
            finish();
        }
    }

    private publish(report: LintReport): void {
        this.lastReport = report;
        this.events.emit("reportChanged", report);
    }

    /** Forget every probe answer; the next sweep reads the disk again. */
    private clearProbeCache(): void {
        this.probeCache.exists.clear();
        this.probeCache.image.clear();
        this.probeCache.videoAlpha.clear();
    }

    /**
     * Assemble the snapshot the rules read. One pass over every project document; see `LintContext`
     * for what each field means and why localization/voice are nullable.
     */
    public async buildContext(): Promise<LintContext> {
        return (await this.assembleContext()).ctx;
    }

    private async assembleContext(): Promise<{ ctx: LintContext; contextFindings: LintReportEntry[] }> {
        const services = this.getContext().services;
        const projectService = services.get<ProjectService>(Services.Project);
        const storyService = services.get<StoryService>(Services.Story);
        const assetsService = services.get<AssetsService>(Services.Assets);
        const referenceService = services.get<ReferenceService>(Services.Reference);
        const characterService = services.get<CharacterService>(Services.Character);
        const registryService = services.get<VariableRegistryService>(Services.VariableRegistry);
        const localizationService = services.get<LocalizationService>(Services.Localization);
        const voiceService = services.get<VoiceService>(Services.Voice);
        const uiDocumentService = services.get<UIDocumentService>(Services.UIDocument);
        const uiGraphService = services.get<UIGraphService>(Services.UIGraph);

        const contextFindings: LintReportEntry[] = [];

        const { stories, complete: storiesComplete } = await this.loadStories(storyService, contextFindings);
        const assets = this.collectAssets(assetsService);

        await referenceService.ensureReady().catch(error => {
            console.warn("[LintService] reference index failed to build", error);
        });

        /**
         * **Keyed by the ids that are REFERENCED, never by the ids the library has.**
         *
         * `getReferencesForAll` only ever answers keys it was asked for, so asking it for
         * `assets.map(a => a.id)` produces a map whose key set is a subset of the *existing* assets by
         * construction - and `assets/missing`, whose entire job is to find references to ids the
         * library no longer has, would then be looking through a window that cannot contain one. It
         * would have reported nothing on any project, forever, while passing every test written
         * against a hand-built context.
         *
         * `getReferencedAssetIds()` is the index's key set - every id something points at, whether or
         * not a library row answers to it - which is exactly the set the rule needs to see.
         */
        const referencedAssetIds = referenceService.getReferencedAssetIds();

        const characters = this.collectCharacters(characterService);
        const variableRegistry = registryService.listEntries();
        // Per scope, never over the whole registry. Both project scopes live in one file now, so a
        // single merge would union `saved` entries with `/persis` rows and report "Gold" as
        // ambiguous because a saved Gold and a persistent Gold exist - two variables that are not in
        // the same namespace and cannot shadow each other. The rules read the same `scope` field to
        // decide which identities a reference may resolve against.
        const persistentNameCollisions = buildMergedVariableView(
            registryService.listEntriesInScope("persistent"),
            stories.flatMap(story => Object.values(storyPersistentDefs(story.document))),
        ).nameCollisions;
        const savedNameCollisions = buildMergedVariableView(
            registryService.listEntriesInScope("saved"),
            stories.flatMap(story => Object.values(savedVariableDefs(story.document))),
        ).nameCollisions;

        const localization = await this.buildLocalizationContext(localizationService);
        const localizationKeys = await this.readLocalizationKeys(localizationService);
        const voice = await this.buildVoiceContext(voiceService);

        const ctx: LintContext = {
            config: projectService.getLintingConfiguration(),
            network: projectService.getNetworkConfiguration(),
            pluginNetworkDeclarations: await this.readPluginNetworkDeclarations(),
            stories,
            storiesComplete,
            blueprintDocument: safely(() => uiGraphService.getDocument().blueprintDocument, null),
            uiDocument: safely(() => uiDocumentService.getDocument(), null),
            pluginStores: await this.readPluginStores(),
            assets,
            // Read off the service rather than derived from the library: a set is a declaration
            // about the library, and deriving one from the other is what the rule is checking.
            assetSets: safely(() => services.get<AssetSetService>(Services.AssetSets).listSets(), []),
            referencedAssetIds,
            assetReferences: referenceService.getReferencesForAll([...referencedAssetIds]),
            // Read here rather than inside the rule: the two sets above and this answer have to
            // describe the same pass, and `ensureReady` above swallows its own failure - which is
            // exactly the case this reports.
            assetIndex: referenceService.getIndexResult(),
            characters,
            // `listTags()`, which synthesizes the release variant, so the list is never empty and
            // `AppTag == "main"` resolves in a project that has authored no variants at all.
            appTags: services.get<AppTagService>(Services.AppTags).listTags(),
            dlcs: services.get<DlcService>(Services.Dlc).list(),
            // The union across the project and its variants: which of them opens which address is
            // decided when a build is compiled, and a graph belongs to all of them.
            variableRegistry,
            persistentNameCollisions,
            savedNameCollisions,
            localization,
            localizationKeys,
            voice,
            buildPlatforms: normalizeBuildConfiguration(projectService.getProjectConfig().app?.build)?.platforms ?? [],
            io: this.createIo(assetsService, await this.mayProbeMedia(), assets),
        };
        this.contextFindings = contextFindings;
        return { ctx, contextFindings };
    }

    /** The plugins' stores, or null - "not read" rather than "none" - when they cannot be had. */
    private async readPluginStores(): Promise<LintContext["pluginStores"]> {
        try {
            return await this.getContext().services.get<ServiceAssetsService>(Services.ServiceAssets).readPluginStores();
        } catch (error) {
            console.warn("[LintService] plugin stores could not be read", error);
            return null;
        }
    }

    /**
     * Sweep the project because somebody asked - the command, the build gate, the command line.
     * Progress goes to the `lint` console channel so a long run on a large project is visible
     * without a modal, and the report replaces whatever the panel showed.
     *
     * It reads the disk afresh rather than trusting what the background sweeps learned about each
     * file: this is the sweep a build stands on. A background sweep in progress is abandoned (its
     * result would be older than this one's), and the background schedule waits until this is done.
     * A second request while one runs joins it - the sweep reads the project as it is now, so two
     * overlapping ones would produce the same report twice.
     */
    public run(options: LintRunOptions = {}): Promise<LintReport> {
        if (this.requested) {
            return this.requested;
        }
        const started = this.runRequested(options).finally(() => {
            this.requested = null;
            this.liveScheduler?.resume();
            this.emitState();
        });
        this.requested = started;
        this.liveScheduler?.suspend();
        this.emitState();
        return started;
    }

    private async runRequested(options: LintRunOptions): Promise<LintReport> {
        const consoleService = this.getContext().services.get<ConsoleService>(Services.Console);
        consoleService.setProgress(LINT_CONSOLE_CHANNEL, { value: 0, indeterminate: true, error: false });
        consoleService.append(LINT_CONSOLE_CHANNEL, {
            level: "info",
            source: LINT_CONSOLE_SOURCE,
            message: translate("lint.console.started"),
        });

        try {
            const live = this.liveSweep;
            if (live) {
                live.abort.abort();
                await live.done;
            }
            // Edits made before this point are what this sweep is about to read.
            this.liveScheduler?.clearPending();
            this.clearProbeCache();

            const { ctx, contextFindings } = await this.assembleContext();
            const report = await runLintRules(ctx, {
                ...options,
                onProgress: progress => {
                    consoleService.setProgress(LINT_CONSOLE_CHANNEL, {
                        value: progress.total === 0 ? 1 : progress.done / progress.total,
                        indeterminate: false,
                        error: false,
                        label: progress.ruleId,
                    });
                    options.onProgress?.(progress);
                },
            });

            const merged = mergeContextFindings(report, contextFindings);
            this.publish(merged);
            consoleService.append(LINT_CONSOLE_CHANNEL, {
                level: merged.counts.error > 0 ? "error" : merged.counts.warning > 0 ? "warning" : "success",
                source: LINT_CONSOLE_SOURCE,
                message: formatLintFinishedLine(merged),
            });
            return merged;
        } finally {
            consoleService.setProgress(LINT_CONSOLE_CHANNEL, null);
        }
    }

    /**
     * Every story in the library, loaded, and whether that is all of them. A story that will not
     * open becomes a context finding rather than being dropped: silently linting the remaining
     * eight of nine stories and reporting "no problems" is the worst answer available.
     *
     * The flag is not cosmetic either: a rule that resolves an id against this list reads a story
     * missing from it as a story that was deleted, so one unreadable document would produce a
     * finding per reference into it, on top of the finding the failure already reports. See
     * `LintContext.storiesComplete`.
     */
    private async loadStories(
        storyService: StoryService,
        contextFindings: LintReportEntry[],
    ): Promise<{ stories: LintStoryEntry[]; complete: boolean }> {
        const stories: LintStoryEntry[] = [];
        let index: StoryLibraryIndex;
        try {
            index = storyService.getLibraryIndex();
        } catch (error) {
            console.warn("[LintService] story library unavailable", error);
            return { stories, complete: false };
        }
        let complete = true;
        for (const entry of index.stories) {
            try {
                stories.push({
                    id: entry.id,
                    name: entry.name,
                    document: await storyService.loadStory(entry.id),
                    ...(entry.dlcId ? { dlcId: entry.dlcId } : {}),
                });
            } catch (error) {
                complete = false;
                console.warn(`[LintService] story ${entry.id} failed to load`, error);
                contextFindings.push(storyUnreadableFinding(entry, error));
            }
        }
        return { stories, complete };
    }

    private collectAssets(assetsService: AssetsService): LintAssetEntry[] {
        const entries: LintAssetEntry[] = [];
        const map = assetsService.getAssets();
        for (const type of Object.values(AssetType)) {
            for (const asset of Object.values(map[type] ?? {})) {
                entries.push({
                    id: asset.id,
                    type: asset.type,
                    name: asset.name,
                    ext: asset.ext,
                    hash: asset.hash,
                    meta: asset.meta,
                    tags: asset.tags,
                });
            }
        }
        return entries;
    }

    /**
     * Characters flattened to "which assets does this character name". The appearance kinds address
     * their images differently (a preset by pose, a layered one by layer and tag) and no lint rule
     * cares which - the same flattening the reference index does, for the same reason.
     */
    private collectCharacters(characterService: CharacterService): LintCharacterEntry[] {
        try {
            return characterService.listCharacter().map(character => {
                const appearance = character.profile.appearance;
                const ids = new Set<string>();
                const add = (value: string | null | undefined) => {
                    if (typeof value === "string" && value.trim()) {
                        ids.add(value.trim());
                    }
                };
                add(character.profile.getThumbnail());
                if (appearance.getKind() === "preset") {
                    for (const pose of appearance.getPoses()) {
                        add(pose.assetId);
                    }
                } else {
                    for (const layer of appearance.getLayers()) {
                        add(layer.assetId);
                        for (const assetId of Object.values(layer.options ?? {})) {
                            add(assetId);
                        }
                    }
                }
                return {
                    id: character.profile.getId(),
                    name: character.profile.getName(),
                    assetIds: [...ids],
                };
            });
        } catch (error) {
            console.warn("[LintService] failed to read characters", error);
            return [];
        }
    }

    /**
     * What every installed plugin declares in `contributes.network`, attributed.
     *
     * Every installed plugin rather than only the enabled ones: a disabled plugin is one click from
     * being enabled again, and a finding that appeared and vanished with a toggle in another panel
     * would read as a bug in the sweep. A build resolves the ones it actually ships.
     *
     * An unreadable list is an empty one. Every rule that reads this treats an absent declaration as
     * "this plugin declares nothing", so the worst a failed read produces is a finding the author can
     * act on, never a request quietly waved through.
     */
    private async readPluginNetworkDeclarations(): Promise<NetworkPluginAllowlistEntry[]> {
        let result: Awaited<ReturnType<ReturnType<typeof getInterface>["plugins"]["list"]>>;
        try {
            result = await getInterface().plugins.list();
        } catch {
            // No bridge at all, which is a harness rather than a project. Reading it as "no
            // plugin declares anything" is the same answer a failed list gives.
            return [];
        }
        if (!result.success) {
            return [];
        }
        return result.data.plugins
            .filter(plugin => (plugin.manifest.contributes?.network ?? []).length > 0)
            .map(plugin => ({
                pluginId: plugin.manifest.id,
                patterns: [...(plugin.manifest.contributes?.network ?? [])],
            }));
    }

    private async buildLocalizationContext(service: LocalizationService): Promise<LintContext["localization"]> {
        const config = service.getConfiguration();
        if (!isLocalizationEnabled(config)) {
            return null;
        }
        const targetLocales = config.locales
            .map(locale => locale.code)
            .filter(code => code !== config.sourceLocale);
        const documents = new Map<string, LocalizationDocument>();
        for (const locale of targetLocales) {
            try {
                documents.set(locale, await service.loadDocument(locale));
            } catch (error) {
                console.warn(`[LintService] localization document ${locale} failed to load`, error);
            }
        }
        return { sourceLocale: config.sourceLocale, targetLocales, documents };
    }

    /**
     * The named keys, waited for rather than read if already loaded.
     *
     * The service loads them in the background from its own init, so a sweep started seconds after
     * a project opens - the command-line `--lint` is exactly that - would otherwise find them absent
     * and every rule that reads a key's words would check nothing while reporting a pass. `null`
     * still means the document could not be read, which a rule must not take for "no keys".
     */
    private async readLocalizationKeys(service: LocalizationService): Promise<LintContext["localizationKeys"]> {
        try {
            const { keys } = await service.loadKeys();
            return new Map(Object.entries(keys).map(([name, entry]) => [name, entry.sourceText]));
        } catch (error) {
            console.warn("[LintService] localization keys failed to load", error);
            return null;
        }
    }

    private async buildVoiceContext(service: VoiceService): Promise<LintContext["voice"]> {
        const config = service.getConfiguration();
        if (!isVoiceEnabled(config)) {
            return null;
        }
        const voicedLocales = config.voicedLocales.map(locale => locale.code);
        const documents = new Map<string, VoiceDocument>();
        for (const locale of voicedLocales) {
            try {
                documents.set(locale, await service.loadDocument(locale));
            } catch (error) {
                console.warn(`[LintService] voice document ${locale} failed to load`, error);
            }
        }
        return { voicedLocales, documents, voiceChoices: config.voiceChoices };
    }

    /**
     * Whether an ffprobe spawn sent from a rule would be attempted at all.
     *
     * Trust, asked once, before the sweep - and the only thing about the probe worth asking in
     * advance. A host that has no ffprobe declines cheaply and quietly, so learning that from the
     * first request costs nothing. A distrusted project is not like that: main refuses every spawn
     * *and writes an error line to the workspace console* for each one, deliberately, so that a
     * refusal nobody asked for is still visible. `portability/vfx-alpha` asks about every distinct
     * clip a `/vfx create` row uses, so one sweep of a project that arrived from elsewhere would
     * fill the console with refusals the author did not ask for and cannot act on from there.
     *
     * What the sweep reports is unchanged. An unanswered probe is never spent as a verdict (see
     * `LintAlphaProbe`), so the rule falls silent here in exactly the way it already does on a host
     * without ffprobe, and no finding can be invented or lost by this.
     *
     * Asked here rather than borrowed from `MediaSupportService`, which asks the same question for
     * its own scan: the two probe paths are separate on purpose (the reasoning is on
     * `probeVideoAlpha` below), and `isProjectTrusted` memoizes per path, so both of them asking
     * costs one IPC call in total.
     */
    private mayProbeMedia(): Promise<boolean> {
        return isProjectTrusted(this.getContext().project.resolve());
    }

    /**
     * The rules' only door to the filesystem. `probeImage` reuses ImageService's decoder rather
     * than opening a second one - there is exactly one answer to "what are this image's
     * dimensions", and a rule that disagreed with the asset browser would be reporting a bug in
     * itself.
     *
     * `mayProbeMedia` is the answer to "would main run ffprobe for this project at all", settled
     * once before the sweep instead of being learned from a refusal per clip - see
     * {@link mayProbeMedia}.
     */
    private createIo(assetsService: AssetsService, mayProbeMedia: boolean, assets: readonly LintAssetEntry[]): LintIo {
        const probeQueue = createConcurrencyLimiter(IMAGE_PROBE_CONCURRENCY);
        const cache = this.probeCache;
        // The content hash names the bytes, so an answer filed under it stays true until the file is
        // replaced - which gives the asset a new hash and the probe a new key.
        const hashById = new Map(assets.map(asset => [asset.id, asset.hash ?? ""]));
        const remember = <T>(store: Map<string, Promise<T>>, assetId: string, probe: () => Promise<T>): Promise<T> => {
            const key = `${assetId}@${hashById.get(assetId) ?? ""}`;
            const known = store.get(key);
            if (known) {
                return known;
            }
            const pending = probe();
            store.set(key, pending);
            // A probe that threw has no answer worth keeping.
            pending.catch(() => store.delete(key));
            return pending;
        };
        const shardPath = (assetId: string): string =>
            this.getContext().project.resolve(ProjectNameConvention.AssetsDataShard(assetId));
        const readBytes = async (assetId: string): Promise<Uint8Array | null> => {
            const fs = this.getContext().services.get<FileSystemService>(Services.FileSystem);
            const result = await fs.readRaw(shardPath(assetId));
            return result.ok ? result.data : null;
        };

        /**
         * `stat`, deliberately, and not `isFileExists`.
         *
         * Both answer the question and neither reads the file, but `FileSystemService.isFileExists`
         * is routed through the document source (see `documentSource.ts`), so while the workspace is
         * showing a past revision it would answer out of that revision - asking a repository to
         * produce an *image* as text - while `readBytes` beside it goes on reading the working tree,
         * because `readRaw` is deliberately never redirected. One rule reading two versions of the
         * project is not a trade-off worth a saved round trip. `stat` takes the same path `readRaw`
         * does: the disk.
         *
         * A stat that fails is treated as absent, which folds a permission error in with a missing
         * file - the same conflation `readBytes` already made by answering `null` for both, and the
         * finding ("cannot be read from disk") is true either way.
         */
        const exists = (assetId: string): Promise<boolean> => remember(cache.exists, assetId, async () => {
            const fs = this.getContext().services.get<FileSystemService>(Services.FileSystem);
            return (await fs.stat(shardPath(assetId))).ok;
        });

        const videoProbeQueue = createConcurrencyLimiter(VIDEO_PROBE_CONCURRENCY);

        return {
            exists,
            readBytes,
            /**
             * The content shard, handed to the main process's ffprobe.
             *
             * The shard rather than the author's file name: the bytes are what carry an alpha
             * channel, the library keeps no copy of the original path, and ffprobe reads the
             * container out of the bytes without ever consulting the name - which the shard does
             * not have, since content shards are written without an extension.
             *
             * **Deliberately not routed through `MediaSupportService`**, which probes the same
             * binary over the same shards and caches by content hash. Reusing it looks like the
             * obvious saving and is the opposite: its answers exist only after a scan of the *whole*
             * library, so a lint sweep run from the command palette would either read `null` for
             * every asset and go silent, or trigger a scan and pay one spawn per sound and video
             * file in the project. The rule that calls this asks about the handful of clips whose
             * row already looks wrong, so asking directly is both cheaper and always answerable.
             * There is no risk of the two disagreeing: it is one binary reading one file.
             *
             * Every way the probe can decline is `ok: false` with the reason carried through. None
             * of them may be spent as a verdict - no ffprobe on this host is the common one, and it
             * says nothing whatever about the file.
             *
             * Being separate is also why the trust question has to be asked here: the service's own
             * pre-check does not cover this path, and without one this would send a spawn per clip
             * to a main process that refuses each one on the console. See {@link mayProbeMedia}.
             */
            probeVideoAlpha: (assetId: string) => remember(cache.videoAlpha, assetId, () => videoProbeQueue(async (): Promise<LintAlphaProbe> => {
                if (!mayProbeMedia) {
                    // Not a verdict, and read as one nowhere: the rule treats every `ok: false`
                    // the same way it treats a host with no ffprobe, which is to conclude nothing
                    // about the clip.
                    return { ok: false, reason: "probing is not permitted for this project" };
                }
                const asset = assetsService.getAssets()[AssetType.Video]?.[assetId];
                if (!asset) {
                    return { ok: false, reason: "not a video asset" };
                }
                try {
                    const probed = await getInterface().probeMedia(shardPath(assetId));
                    if (!probed.success) {
                        return { ok: false, reason: "probe failed" };
                    }
                    const outcome = probed.data.outcome;
                    if (outcome.status === "probed") {
                        return { ok: true, carriesAlpha: outcome.carriesAlpha };
                    }
                    return {
                        ok: false,
                        reason: outcome.status === "unavailable" ? "no probe on this host" : outcome.reason,
                    };
                } catch (error) {
                    // The sweep runs every rule and reports at the end; one asset whose IPC threw
                    // must not take the other forty-two rules' findings down with it.
                    return { ok: false, reason: error instanceof Error ? error.message : "probe threw" };
                }
            })),
            probeFontCoverage: (assetId: string) => probeQueue(async (): Promise<FontCoverageResult> => {
                const asset = assetsService.getAssets()[AssetType.Font]?.[assetId] as
                    | Asset<AssetType.Font>
                    | undefined;
                if (!asset) {
                    // A built-in system stack (`builtin:font:*`) lands here, and so does a rung whose
                    // asset was deleted. Neither has bytes to read, and neither is this probe's
                    // finding to make - `assets/missing` reports the second one, with the row that
                    // named it attached.
                    return { ok: false, reason: "not-a-font" };
                }
                if (isUnrenderableFontFormat(asset.ext)) {
                    // Decided from the extension, without reading a byte: an SVG font and an EOT are
                    // perfectly parseable files that no engine will draw with, and the coverage
                    // parser would answer `not-a-font` for them - which is the arm this rule reads
                    // as "a built-in stack" and passes over in silence. See
                    // `@shared/typography/fontFormats`.
                    return { ok: false, reason: "unrenderable" };
                }
                // Through `FontService` rather than straight to the bridge, for the memo: the rule
                // asks once per language of the project, and re-reading a CJK face for each is a
                // cost nothing about the answer requires.
                const fontService = assetsService.fontService;
                return fontService
                    ? fontService.readCoverage(asset)
                    : { ok: false as const, reason: "malformed" as const };
            }),
            probeImage: (assetId: string) => remember(cache.image, assetId, () => probeQueue(async (): Promise<LintImageProbe> => {
                const asset = assetsService.getAssets()[AssetType.Image]?.[assetId] as
                    | Asset<AssetType.Image>
                    | undefined;
                if (!asset) {
                    return { ok: false, reason: "not an image asset" };
                }
                const bytes = await readBytes(assetId);
                if (!bytes) {
                    return { ok: false, reason: "unreadable" };
                }
                const imageService = assetsService.imageService;
                if (!imageService) {
                    return { ok: false, reason: "image service unavailable" };
                }
                const result = await imageService.readImageFromBuffer(asset, bytes);
                if (!result.success) {
                    return { ok: false, reason: result.error ?? "decode failed" };
                }
                return {
                    ok: true,
                    width: result.data.metadata.width,
                    height: result.data.metadata.height,
                };
            })),
        };
    }
}

/** The probe answers kept between background sweeps; see `LintService.probeCache`. */
type LintProbeCache = {
    exists: Map<string, Promise<boolean>>;
    image: Map<string, Promise<LintImageProbe>>;
    videoAlpha: Map<string, Promise<LintAlphaProbe>>;
};

function createLintProbeCache(): LintProbeCache {
    return { exists: new Map(), image: new Map(), videoAlpha: new Map() };
}

/**
 * Context findings ride at the front of the entry list rather than being re-sorted in: they are
 * always errors, and "this story would not open" is the first thing a reader needs.
 */
function mergeContextFindings(report: LintReport, contextFindings: readonly LintReportEntry[]): LintReport {
    if (contextFindings.length === 0) {
        return report;
    }
    return {
        ...report,
        entries: [...contextFindings, ...report.entries],
        counts: {
            error: report.counts.error + contextFindings.length,
            warning: report.counts.warning,
            info: report.counts.info,
        },
    };
}

/** Run at most `limit` tasks at once; queued callers await their turn. */
function createConcurrencyLimiter(limit: number): <T>(task: () => Promise<T>) => Promise<T> {
    let active = 0;
    const queue: (() => void)[] = [];

    const release = () => {
        active -= 1;
        queue.shift()?.();
    };

    return async <T>(task: () => Promise<T>): Promise<T> => {
        if (active >= limit) {
            await new Promise<void>(resolve => queue.push(resolve));
        }
        active += 1;
        try {
            return await task();
        } finally {
            release();
        }
    };
}

/**
 * A service read that must not take the sweep down. Every one of these is "the project has not got
 * that far yet" (no UI document, no graph), which is a legitimate state for lint to run in - not an
 * error worth a finding.
 */
function safely<T>(read: () => T, fallback: T): T {
    try {
        return read();
    } catch {
        return fallback;
    }
}

