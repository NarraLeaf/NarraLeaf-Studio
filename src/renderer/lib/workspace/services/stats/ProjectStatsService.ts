import {
    PROJECT_STATS_SETTINGS_KEY_PREFIX,
    ProjectStatsV1,
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
import { BuildService } from "../core/BuildService";
import { ProjectService } from "../core/ProjectService";
import { StoryService } from "../story/StoryService";
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
 * Accumulates per-project authoring activity (writing curve, active time, build history) that the
 * dashboard cannot recompute after the fact.
 *
 * Stored per project in Electron's global config under `stats.project.<token>`, following the
 * editor-session precedent — this is personal data about how *you* worked, so it deliberately does
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

    private lastInteractionAt = Date.now();
    private lastBuildStatus: GameBuildStatus = "idle";
    private lastWrittenSerialized: string | null = null;
    private disposed = false;

    protected async init(ctx: WorkspaceContext, depend: (services: Service[]) => Promise<void>): Promise<void> {
        this.disposed = false;

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
     * Drop every accumulated statistic for this project. Static dashboard figures are unaffected —
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

        try {
            const storyService = ctx.services.get<StoryService>(Services.Story);
            this.subscriptions.push(
                storyService.onDocumentChanged(() => this.handleDocumentChanged(ctx)),
            );
        } catch (error) {
            console.warn("[ProjectStats] Story tracking unavailable", error);
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

    private handleDocumentChanged(ctx: WorkspaceContext): void {
        if (this.disposed) {
            return;
        }
        this.markInteraction();

        if (this.editTimer) {
            clearTimeout(this.editTimer);
        }
        this.editTimer = setTimeout(() => {
            this.editTimer = null;
            this.today().edits += 1;
            this.stats.lastActiveAt = Date.now();
            this.emitAndPersist();
        }, EDIT_DEBOUNCE_MS);

        this.scheduleWordRecount(ctx, WORD_RECOUNT_DEBOUNCE_MS);
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
                    this.today().words = words;
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
        this.stats.builds.push({
            startedAt,
            finishedAt,
            durationMs: Math.max(0, finishedAt - startedAt),
            ok: state.status === "done",
        });
        this.emitAndPersist();
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
            if (Date.now() - this.lastInteractionAt > IDLE_TIMEOUT_MS) {
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
