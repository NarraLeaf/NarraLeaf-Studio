import {
    PROJECT_STATS_SETTINGS_KEY_PREFIX,
    ProjectStatsV1,
    WORD_COUNT_BASIS,
    clipBuildLog,
    createEmptyActivityDay,
    createEmptyProjectStats,
    parseProjectStats,
    pruneProjectStats,
    toActivityDayKey,
} from "@shared/types/stats";
import type { GameBuildStateSnapshot, GameBuildStatus } from "@shared/types/gameBuild";
import { stableProjectKeyToken } from "@shared/utils/stableKeyHash";
import { getInterface } from "@/lib/app/bridge";
import { computeTotalWordCount } from "@/lib/workspace/stats/projectStatsSnapshot";
import { AssetsService } from "../core/AssetsService";
import { BUILD_CONSOLE_CHANNEL, BUILD_CONSOLE_SOURCE, BuildService } from "../core/BuildService";
import { CharacterService } from "../core/CharacterService";
import { ConsoleService, type ConsoleEntry } from "../core/ConsoleService";
import { ProjectService } from "../core/ProjectService";
import { LocalizationService } from "../localization/LocalizationService";
import { StoryService } from "../story/StoryService";
import { UIDocumentService } from "../ui-editor/UIDocumentService";
import { UIGraphService } from "../ui-editor/UIGraphService";
import { VariableRegistryService } from "../variables/VariableRegistryService";
import { GlobalSettingsService } from "../GlobalSettingsService";
import { Service } from "../Service";
import { Services, WorkspaceContext } from "../services";
import { EventEmitter } from "../ui/EventEmitter";

/** Collapse an editing burst into one recorded edit. */
const EDIT_DEBOUNCE_MS = 3_000;
/** Recounting words walks every story, so it trails the edit burst rather than riding it. */
const WORD_RECOUNT_DEBOUNCE_MS = 15_000;
const PERSIST_DEBOUNCE_MS = 2_000;
const ACTIVITY_TICK_MS = 30_000;
/** Counting words walks every story, so the opening snapshot yields to workspace startup first. */
const STARTUP_WORD_COUNT_DELAY_MS = 10_000;
/** No input for this long and the author has left the keyboard, whatever the OS focus says. */
const IDLE_TIMEOUT_MS = 120_000;

type ProjectStatsEvents = {
    changed: ProjectStatsV1;
};

/**
 * One authoring surface whose changes count as an edit.
 *
 * The table exists because "edits" used to mean "story edits": a day spent in the blueprint editor
 * or the localization panel reported zero, which reads as a day off rather than a day of work.
 *
 * Services are resolved lazily inside `attach` rather than up front, so a surface that failed to
 * start costs its own signal instead of the whole table.
 */
type EditSource = {
    /** Named in the warning when its service is unavailable, so a silent gap stays traceable. */
    label: string;
    /** Only story text feeds the writing curve; nothing else is worth a walk over every story. */
    recountsWords?: boolean;
    attach: (ctx: WorkspaceContext, onEdit: () => void) => () => void;
};

/**
 * Subscribe to a service that reports edits and loads through the same event, using its revision
 * counter to tell the two apart: a mutation bumps the revision, loading does not.
 *
 * That filter is what separates authoring from mere reading, and for the story it also breaks a
 * feedback loop - the word recount loads every story and would otherwise re-trigger itself forever.
 *
 * `>` rather than `!==` because a reload resets the counter to zero; going backwards is not an edit.
 */
function byRevision(
    service: { getRevision(): number },
    subscribe: (handler: () => void) => () => void,
    onEdit: () => void,
): () => void {
    let last = service.getRevision();
    return subscribe(() => {
        const revision = service.getRevision();
        const edited = revision > last;
        last = revision;
        if (edited) {
            onEdit();
        }
    });
}

const EDIT_SOURCES: EditSource[] = [
    {
        label: "Story",
        recountsWords: true,
        attach: (ctx, onEdit) => {
            const service = ctx.services.get<StoryService>(Services.Story);
            return byRevision(service, handler => service.onDocumentChanged(handler), onEdit);
        },
    },
    {
        // Blueprint mutations run through the graph document (`applyBlueprintMutation` delegates to
        // `applyGraphMutation`), so this one subscription covers both blueprint and UI graph work.
        //
        // Its revision counter alone is NOT a load-vs-edit filter: opening a project normalizes and
        // seeds the graph document through that same entry, ~230 bumps before the author touches
        // anything. `authorIsPresent` is what separates those; do not drop it in favour of the
        // revision guard here.
        label: "Graphs",
        attach: (ctx, onEdit) => {
            const service = ctx.services.get<UIGraphService>(Services.UIGraph);
            return byRevision(service, handler => service.onGraphsChanged(handler), onEdit);
        },
    },
    {
        label: "UI",
        attach: (ctx, onEdit) => {
            const service = ctx.services.get<UIDocumentService>(Services.UIDocument);
            return byRevision(service, handler => service.onDocumentChanged(handler), onEdit);
        },
    },
    {
        label: "Variables",
        attach: (ctx, onEdit) => {
            const service = ctx.services.get<VariableRegistryService>(Services.VariableRegistry);
            return byRevision(service, handler => service.onRegistryChanged(handler), onEdit);
        },
    },
    {
        // No revision counter and none needed: the first load registers characters without
        // emitting, so every emission already means a mutation.
        label: "Characters",
        attach: (ctx, onEdit) => ctx.services.get<CharacterService>(Services.Character).subscribe(onEdit),
    },
    {
        // Load-safe for the same reason plus one that matters here: `loadDocument` is silent, so
        // the dashboard's own snapshot pass - which loads every locale to compute progress - cannot
        // feed itself an edit.
        label: "Localization",
        attach: (ctx, onEdit) => {
            const service = ctx.services.get<LocalizationService>(Services.Localization);
            const unsubscribes = [
                service.onDocumentChanged(() => onEdit()),
                service.onKeysChanged(() => onEdit()),
                service.onConfigChanged(() => onEdit()),
            ];
            return () => unsubscribes.forEach(unsubscribe => unsubscribe());
        },
    },
    {
        /**
         * Replacing an asset's content is the only asset change the service announces. Import,
         * delete and rename go through the managers without an event, so they stay uncounted: a
         * known gap is better than wiring the bulk `groupsUpdated` signal, which also fires once
         * per asset type on a working-tree reload and would bill a version restore as authoring.
         */
        label: "Assets",
        attach: (ctx, onEdit) =>
            ctx.services
                .get<AssetsService>(Services.Assets)
                .getEvents()
                .on("updated", () => onEdit()),
    },
];

/**
 * Accumulates per-project authoring activity (writing curve, active time, build history) that the
 * dashboard cannot recompute after the fact.
 *
 * Stored per project in Electron's global config under `stats.project.<token>`, following the
 * editor-session precedent - this is personal data about how *you* worked, so it deliberately does
 * not live in the version-controlled `.nlproj`.
 *
 * Collection is best-effort by design. Every failure path here degrades to "no stats" rather than
 * surfacing an error: nobody should lose work, or even see a dialog, because a counter failed.
 */
export class ProjectStatsService extends Service<ProjectStatsService> {
    private stats: ProjectStatsV1 = createEmptyProjectStats();
    private settingsKey: string | null = null;
    /**
     * Held directly rather than resolved through the context on each write: the final flush runs
     * from `dispose`, by which point the context is being torn down.
     */
    private settingsService: GlobalSettingsService | null = null;
    private events = new EventEmitter<ProjectStatsEvents>();

    private subscriptions: (() => void)[] = [];
    private editTimer: ReturnType<typeof setTimeout> | null = null;
    private wordTimer: ReturnType<typeof setTimeout> | null = null;
    private persistTimer: ReturnType<typeof setTimeout> | null = null;
    private activityTicker: ReturnType<typeof setInterval> | null = null;

    /** Null until the author's first input of the session. See {@link startActivityTracking}. */
    private lastInteractionAt: number | null = null;
    /** Set when stored word totals were counted under a superseded rule. See {@link load}. */
    private rebaseWordCount = false;
    private lastBuildStatus: GameBuildStatus = "idle";
    private lastWrittenSerialized: string | null = null;
    private disposed = false;

    protected async init(ctx: WorkspaceContext, depend: (services: Service[]) => Promise<void>): Promise<void> {
        this.disposed = false;
        // The service is a singleton, so a project opened after another one in the same window
        // would otherwise inherit the previous project's idle clock.
        this.lastInteractionAt = null;

        const projectService = ctx.services.get<ProjectService>(Services.Project);
        this.settingsService = ctx.services.get<GlobalSettingsService>(Services.GlobalSettings);
        const storyService = ctx.services.get<StoryService>(Services.Story);
        // Service init runs in reverse registry order, so this service starts before the ones it
        // reads from; without this the project config is still uninitialized here.
        await depend([projectService, this.settingsService, storyService]);

        this.settingsKey = `${PROJECT_STATS_SETTINGS_KEY_PREFIX}.${stableProjectKeyToken({
            projectPath: ctx.project.getConfig().projectPath,
            projectIdentifier: projectService.getProjectConfig().identifier,
        })}`;

        await this.load(ctx);
        this.subscribe(ctx);
        this.startActivityTracking();

        // Seed today's word count so a project opened but not edited still plots a point, and so
        // the first edit of the day has a baseline to produce a delta against.
        this.scheduleWordRecount(ctx, STARTUP_WORD_COUNT_DELAY_MS);
    }

    override dispose(_ctx: WorkspaceContext): void {
        this.disposed = true;
        this.subscriptions.forEach(unsubscribe => unsubscribe());
        this.subscriptions = [];
        this.stopActivityTracking();

        for (const timer of [this.editTimer, this.wordTimer, this.persistTimer]) {
            if (timer) {
                clearTimeout(timer);
            }
        }
        this.editTimer = null;
        this.wordTimer = null;
        this.persistTimer = null;

        // A workspace close is the most likely moment for the session's last minutes to be lost, so
        // flush now instead of leaving them sitting in the debounce window.
        void this.flush();
    }

    public getStats(): ProjectStatsV1 {
        return this.stats;
    }

    public onChanged(handler: (stats: ProjectStatsV1) => void): () => void {
        return this.events.on("changed", handler);
    }

    /**
     * Drop every accumulated statistic for this project. Static dashboard figures are unaffected -
     * they are recomputed from the project itself and were never stored.
     */
    public async clear(): Promise<void> {
        // An in-flight recount or edit burst would land on the fresh record and resurrect a data
        // point the author just asked to be rid of.
        for (const timer of [this.editTimer, this.wordTimer, this.persistTimer]) {
            if (timer) {
                clearTimeout(timer);
            }
        }
        this.editTimer = null;
        this.wordTimer = null;
        this.persistTimer = null;

        this.stats = createEmptyProjectStats();
        this.stats.firstSeenAt = Date.now();
        // A fresh record holds no totals from the old rule, so there is nothing left to rebase.
        this.rebaseWordCount = false;
        this.events.emit("changed", this.stats);
        await this.flush();
    }

    private async load(_ctx: WorkspaceContext): Promise<void> {
        if (!this.settingsKey || !this.settingsService) {
            return;
        }
        try {
            const raw = await this.settingsService.get(this.settingsKey);
            this.stats = parseProjectStats(raw) ?? createEmptyProjectStats();
        } catch (error) {
            console.warn("[ProjectStats] Failed to load, starting fresh", error);
            this.stats = createEmptyProjectStats();
        }

        const now = Date.now();
        if (this.stats.firstSeenAt === null) {
            this.stats.firstSeenAt = now;
        }
        this.stats.lastActiveAt = now;
        // Totals counted under a superseded rule cannot be diffed against totals counted under the
        // current one, so the next recount opens a new baseline instead of reporting the difference
        // between the two rules as a day's writing.
        this.rebaseWordCount = (this.stats.wordBasis ?? 1) !== WORD_COUNT_BASIS;
        this.schedulePersist();
    }

    private subscribe(ctx: WorkspaceContext): void {
        try {
            const buildService = ctx.services.get<BuildService>(Services.Build);
            this.lastBuildStatus = buildService.getStatus();
            this.subscriptions.push(
                buildService.onStateChanged(state => this.handleBuildState(state)),
            );
        } catch (error) {
            console.warn("[ProjectStats] Build tracking unavailable", error);
        }

        for (const source of EDIT_SOURCES) {
            try {
                this.subscriptions.push(
                    source.attach(ctx, () => this.handleEdit(ctx, source.recountsWords === true)),
                );
            } catch (error) {
                console.warn(`[ProjectStats] ${source.label} tracking unavailable`, error);
            }
        }

        // "Clear all statistics" runs in the Settings window, which writes straight to global state.
        // Without this, our in-memory counters would survive the clear and the next flush would
        // write them right back.
        const token = getInterface().app.state.onGlobalStateChanged?.(change => {
            if (change.key !== this.settingsKey) {
                return;
            }
            // The broadcast echoes our own writes back to us. Adopting one would roll this window
            // back to the flushed snapshot and drop anything counted since, so skip the echo and
            // only adopt a write that genuinely came from elsewhere.
            const serialized = JSON.stringify(change.value);
            if (serialized === this.lastWrittenSerialized) {
                return;
            }
            const incoming = parseProjectStats(change.value);
            if (!incoming) {
                return;
            }
            this.stats = incoming;
            this.events.emit("changed", this.stats);
        });
        if (token) {
            this.subscriptions.push(() => token.cancel());
        }
    }

    /**
     * One edit, from whichever surface reported it. The debounce is shared across all of them: an
     * author moving between a scene and the blueprint it calls is working once, not twice.
     */
    private handleEdit(ctx: WorkspaceContext, recountsWords: boolean): void {
        // Deliberately does NOT mark an interaction of its own. A document change is evidence that
        // the author acted only once something else has established that they are here; letting it
        // vouch for itself is what let a load-time mutation start the active-time clock.
        if (this.disposed || !this.authorIsPresent()) {
            return;
        }

        if (this.editTimer) {
            clearTimeout(this.editTimer);
        }
        this.editTimer = setTimeout(() => {
            this.editTimer = null;
            this.today().edits += 1;
            this.stats.lastActiveAt = Date.now();
            this.emitAndPersist();
        }, EDIT_DEBOUNCE_MS);

        if (recountsWords) {
            this.scheduleWordRecount(ctx, WORD_RECOUNT_DEBOUNCE_MS);
        }
    }

    private scheduleWordRecount(ctx: WorkspaceContext, delayMs: number): void {
        if (this.wordTimer) {
            clearTimeout(this.wordTimer);
        }
        this.wordTimer = setTimeout(() => {
            this.wordTimer = null;
            void (async () => {
                try {
                    const words = await computeTotalWordCount(ctx);
                    if (this.disposed) {
                        return;
                    }
                    const day = this.today();
                    day.words = words;
                    if (this.rebaseWordCount) {
                        this.rebaseWordCount = false;
                        this.stats.wordBasis = WORD_COUNT_BASIS;
                        day.rebased = true;
                    }
                    this.emitAndPersist();
                } catch (error) {
                    console.warn("[ProjectStats] Word recount failed", error);
                }
            })();
        }, delayMs);
    }

    private handleBuildState(state: GameBuildStateSnapshot): void {
        const previous = this.lastBuildStatus;
        this.lastBuildStatus = state.status;

        const finished = state.status === "done" || state.status === "error";
        if (!finished || previous === state.status) {
            return;
        }
        // The build service polls, so the same terminal snapshot can arrive twice; the
        // previous-status guard above is what keeps one build from being recorded repeatedly.
        const startedAt = state.startedAt ?? state.finishedAt ?? Date.now();
        const finishedAt = state.finishedAt ?? Date.now();
        const { log, omitted } = clipBuildLog(this.collectBuildLog(startedAt));
        this.stats.builds.push({
            startedAt,
            finishedAt,
            durationMs: Math.max(0, finishedAt - startedAt),
            ok: state.status === "done",
            ...(state.platforms?.length ? { platforms: [...state.platforms] } : {}),
            ...(log.length > 0 ? { log } : {}),
            ...(omitted > 0 ? { logOmittedLines: omitted } : {}),
        });
        this.emitAndPersist();
    }

    /**
     * This build's console output, read from the live console buffer at the moment the build ends.
     *
     * Two filters make that buffer specific to one build: the `Build` source separates the
     * pipeline's lines from the Dev Mode and preview output that shares the channel, and the
     * timestamp floor drops earlier builds. The console keeps a bounded buffer, so a very long
     * build can lose its own opening lines here - the same lines the console panel has already
     * dropped, so the record matches what the author could still have read.
     */
    private collectBuildLog(startedAt: number): string[] {
        try {
            return this.getContext()
                .services.get<ConsoleService>(Services.Console)
                .getEntries(BUILD_CONSOLE_CHANNEL)
                .filter(entry => entry.source === BUILD_CONSOLE_SOURCE && entry.timestamp >= startedAt)
                .map(formatBuildLogLine);
        } catch (error) {
            console.warn("[ProjectStats] Build log capture unavailable", error);
            return [];
        }
    }

    private startActivityTracking(): void {
        if (typeof document === "undefined") {
            return;
        }

        const onInteraction = () => this.markInteraction();
        const eventNames = ["keydown", "pointerdown", "wheel"] as const;
        for (const name of eventNames) {
            document.addEventListener(name, onInteraction, { passive: true, capture: true });
        }
        this.subscriptions.push(() => {
            for (const name of eventNames) {
                document.removeEventListener(name, onInteraction, { capture: true });
            }
        });

        this.activityTicker = setInterval(() => {
            if (!document.hasFocus()) {
                return;
            }
            if (!this.authorIsPresent()) {
                return;
            }
            this.today().activeSeconds += ACTIVITY_TICK_MS / 1000;
            this.stats.lastActiveAt = Date.now();
            this.schedulePersist();
        }, ACTIVITY_TICK_MS);
    }

    private stopActivityTracking(): void {
        if (this.activityTicker) {
            clearInterval(this.activityTicker);
            this.activityTicker = null;
        }
    }

    private markInteraction(): void {
        this.lastInteractionAt = Date.now();
    }

    /**
     * Whether the author is at the keyboard right now, which is the precondition for counting
     * anything at all - both active time and edits.
     *
     * Document mutations alone cannot answer this. Opening a project runs hundreds of them:
     * `UIGraphService` normalizes and seeds the graph document through the same `applyGraphMutation`
     * an author's edit goes through, so its revision counter (and every other load-vs-edit filter
     * built on one) reports a startup as ~230 edits. Measured, not assumed - that is precisely what
     * a from-scratch project open recorded before this gate existed.
     *
     * Real authoring never fails this test: the input listeners are registered in the capture phase,
     * so the click or keystroke that causes a mutation is always seen before the mutation lands, and
     * the idle window is two minutes wide. What it excludes is work nobody was present for -
     * migrations, normalization, autosave, a version restore, a script driving the app.
     */
    private authorIsPresent(): boolean {
        return this.lastInteractionAt !== null && Date.now() - this.lastInteractionAt <= IDLE_TIMEOUT_MS;
    }

    /**
     * Today's bucket, created on demand. A new day inherits the previous day's word total as its
     * starting point, so the first edit after midnight yields a real delta instead of counting the
     * entire project as written today.
     */
    private today(): ProjectStatsV1["days"][string] {
        const key = toActivityDayKey(Date.now());
        let day = this.stats.days[key];
        if (!day) {
            day = createEmptyActivityDay();
            const previousKeys = Object.keys(this.stats.days).sort();
            const previous = previousKeys.length ? this.stats.days[previousKeys[previousKeys.length - 1]] : null;
            day.words = previous ? previous.words : 0;
            this.stats.days[key] = day;
        }
        return day;
    }

    private emitAndPersist(): void {
        this.events.emit("changed", this.stats);
        this.schedulePersist();
    }

    private schedulePersist(): void {
        if (this.disposed) {
            return;
        }
        if (this.persistTimer) {
            clearTimeout(this.persistTimer);
        }
        this.persistTimer = setTimeout(() => {
            this.persistTimer = null;
            void this.flush();
        }, PERSIST_DEBOUNCE_MS);
    }

    private async flush(): Promise<void> {
        if (!this.settingsKey || !this.settingsService) {
            return;
        }
        try {
            const payload = pruneProjectStats(this.stats);
            this.lastWrittenSerialized = JSON.stringify(payload);
            await this.settingsService.set(this.settingsKey, payload);
        } catch (error) {
            console.warn("[ProjectStats] Failed to persist", error);
        }
    }
}

/**
 * One archived log line: `[HH:MM:SS] LEVEL   message`. The console panel's own export uses the same
 * shape, minus the `[Build]` source prefix - every line in a build record has that source already.
 */
function formatBuildLogLine(entry: ConsoleEntry): string {
    const time = new Date(entry.timestamp).toLocaleTimeString([], {
        hour12: false,
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
    });
    const text = entry.segments.map(segment => segment.text).join("");
    return `[${time}] ${entry.level.toUpperCase().padEnd(7)} ${text}`;
}
