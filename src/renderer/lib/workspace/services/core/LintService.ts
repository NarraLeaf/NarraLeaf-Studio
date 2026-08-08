import { isLocalizationEnabled, type LocalizationDocument } from "@shared/types/localization";
import { isVoiceEnabled, type VoiceDocument } from "@shared/types/voice";
import { buildMergedVariableView } from "@shared/variables/mergedPersistentView";
import { runLintRules, type LintRunOptions } from "@/lib/lint/engine";
import type {
    LintAssetEntry,
    LintCharacterEntry,
    LintContext,
    LintImageProbe,
    LintIo,
    LintStoryEntry,
} from "@/lib/lint/context";
import type { LintReport, LintReportEntry } from "@/lib/lint/types";
import { AssetType } from "../assets/assetTypes";
import type { Asset } from "../assets/types";
import { savedVariableDefs, storyPersistentDefs } from "@shared/types/story/declarations";
import type { StoryLibraryIndex } from "@shared/types/story";
import { translate } from "@/lib/i18n";
import { normalizeBuildConfiguration } from "../../project/configuration";
import { ProjectNameConvention } from "../../project/nameConvention";
import { Service } from "../Service";
import { Services, type ILintService, type WorkspaceContext } from "../services";
import { EventEmitter } from "../ui/EventEmitter";
import { AssetsService } from "./AssetsService";
import { CharacterService } from "./CharacterService";
import { ConsoleService } from "./ConsoleService";
import { FileSystemService } from "./FileSystem";
import { ProjectService } from "./ProjectService";
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

type LintServiceEvents = {
    reportChanged: LintReport | null;
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
    private running = false;
    private disposeChannel: (() => void) | null = null;
    private readonly events = new EventEmitter<LintServiceEvents>();
    /**
     * Findings produced while *assembling* the context rather than by a rule - a story that will
     * not load. They belong in the report (an unreadable story is the most serious thing lint can
     * find), but no rule can report them: a rule only sees the stories that loaded.
     */
    private contextFindings: LintReportEntry[] = [];

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
        this.lastReport = null;
        this.contextFindings = [];
        this.running = false;
        this.events.clear();
    }

    public isRunning(): boolean {
        return this.running;
    }

    public getLastReport(): LintReport | null {
        return this.lastReport;
    }

    public onReportChanged(handler: (report: LintReport | null) => void): () => void {
        return this.events.on("reportChanged", handler);
    }

    /**
     * Assemble the snapshot the rules read. One pass over every project document; see `LintContext`
     * for what each field means and why localization/voice are nullable.
     */
    public async buildContext(): Promise<LintContext> {
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

        this.contextFindings = [];

        const stories = await this.loadStories(storyService);
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
        const voice = await this.buildVoiceContext(voiceService);

        return {
            config: projectService.getLintingConfiguration(),
            stories,
            blueprintDocument: safely(() => uiGraphService.getDocument().blueprintDocument, null),
            uiDocument: safely(() => uiDocumentService.getDocument(), null),
            assets,
            referencedAssetIds,
            assetReferences: referenceService.getReferencesForAll([...referencedAssetIds]),
            characters,
            variableRegistry,
            persistentNameCollisions,
            savedNameCollisions,
            localization,
            voice,
            buildPlatforms: normalizeBuildConfiguration(projectService.getProjectConfig().app?.build)?.platforms ?? [],
            io: this.createIo(assetsService),
        };
    }

    /**
     * Sweep the project. Progress goes to the `lint` console channel so a long run on a large
     * project is visible without a modal, and the report is kept so a tab opened afterwards has
     * something to show.
     */
    public async run(options: LintRunOptions = {}): Promise<LintReport> {
        const consoleService = this.getContext().services.get<ConsoleService>(Services.Console);
        this.running = true;
        consoleService.setProgress(LINT_CONSOLE_CHANNEL, { value: 0, indeterminate: true, error: false });
        consoleService.append(LINT_CONSOLE_CHANNEL, {
            level: "info",
            source: LINT_CONSOLE_SOURCE,
            message: translate("lint.console.started"),
        });

        try {
            const ctx = await this.buildContext();
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

            const merged = this.mergeContextFindings(report);
            this.lastReport = merged;
            this.events.emit("reportChanged", merged);
            consoleService.append(LINT_CONSOLE_CHANNEL, {
                level: merged.counts.error > 0 ? "error" : merged.counts.warning > 0 ? "warning" : "success",
                source: LINT_CONSOLE_SOURCE,
                message: translate("lint.console.finished", {
                    errors: merged.counts.error,
                    warnings: merged.counts.warning,
                    duration: `${((merged.finishedAt - merged.startedAt) / 1000).toFixed(1)}s`,
                }),
            });
            return merged;
        } finally {
            this.running = false;
            consoleService.setProgress(LINT_CONSOLE_CHANNEL, null);
        }
    }

    /**
     * Context findings ride at the front of the entry list rather than being re-sorted in: they are
     * always errors, and "this story would not open" is the first thing a reader needs.
     */
    private mergeContextFindings(report: LintReport): LintReport {
        if (this.contextFindings.length === 0) {
            return report;
        }
        const entries = [...this.contextFindings, ...report.entries];
        return {
            ...report,
            entries,
            counts: {
                error: report.counts.error + this.contextFindings.length,
                warning: report.counts.warning,
                info: report.counts.info,
            },
        };
    }

    /**
     * Every story in the library, loaded. A story that will not open becomes a context finding
     * rather than being dropped: silently linting the remaining eight of nine stories and reporting
     * "no problems" is the worst answer available.
     */
    private async loadStories(storyService: StoryService): Promise<LintStoryEntry[]> {
        const stories: LintStoryEntry[] = [];
        let index: StoryLibraryIndex;
        try {
            index = storyService.getLibraryIndex();
        } catch (error) {
            console.warn("[LintService] story library unavailable", error);
            return stories;
        }
        for (const entry of index.stories) {
            try {
                stories.push({ id: entry.id, name: entry.name, document: await storyService.loadStory(entry.id) });
            } catch (error) {
                console.warn(`[LintService] story ${entry.id} failed to load`, error);
                this.contextFindings.push({
                    ruleId: "story/invalid-command",
                    messageKey: "lint.message.storyLoadFailed",
                    messageParams: { story: entry.name },
                    location: { kind: "story", storyId: entry.id, storyName: entry.name },
                    severity: "error",
                });
            }
        }
        return stories;
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
        return { voicedLocales, documents };
    }

    /**
     * The rules' only door to the filesystem. `probeImage` reuses ImageService's decoder rather
     * than opening a second one - there is exactly one answer to "what are this image's
     * dimensions", and a rule that disagreed with the asset browser would be reporting a bug in
     * itself.
     */
    private createIo(assetsService: AssetsService): LintIo {
        const probeQueue = createConcurrencyLimiter(IMAGE_PROBE_CONCURRENCY);
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
        const exists = async (assetId: string): Promise<boolean> => {
            const fs = this.getContext().services.get<FileSystemService>(Services.FileSystem);
            return (await fs.stat(shardPath(assetId))).ok;
        };

        return {
            exists,
            readBytes,
            probeImage: (assetId: string) => probeQueue(async (): Promise<LintImageProbe> => {
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
            }),
        };
    }
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
