import type { TranslationKey } from "@shared/i18n";
import {
    describeRawError,
    getWorkspaceAnomalies,
    getWorkspaceAnomalyReportCount,
    type WorkspaceAnomalySource,
} from "@/lib/workspace/recovery/anomalyLog";
import { Service, type ServiceInitFailure } from "../Service";
import { Services, type IRecoveryService, type WorkspaceContext } from "../services";
import { EventEmitter } from "../ui/EventEmitter";
// Type-only, deliberately. This service reaches into the heavy document services to *try* to bring
// them up, and importing any of them as a value would put the whole document graph back into the
// import graph of the one service that exists to run without it.
import type { StoryService } from "../story/StoryService";

/**
 * What recovery mode knows about this project.
 *
 * Recovery mode boots in two stages, and this service is the boundary between them. Stage one is the
 * shell: a fixed, small set of services brought up tolerantly so that the window *always* opens,
 * whatever state the project is in. Stage two is everything else - the story library, the interface
 * documents, the cast, the asset index - and it does not happen on its own. The author runs each
 * one, one at a time, and reads what it said.
 *
 * That split is the point rather than an implementation detail. A workspace that loads everything at
 * once answers "is this project broken?" with a single yes or no and one error message, and the
 * author's actual question is *which part*. Running the subsystems separately turns one opaque
 * failure into a list where some rows are green, and the green rows are as informative as the red
 * one: they are the parts that are fine, and therefore the parts not worth restoring from history.
 *
 * Nothing here writes. Recovery mode holds a project-write freeze for its whole life, so a probe is
 * a read even when the service behind it would ordinarily create a missing file.
 */

export type RecoveryProbeId =
    | "project"
    | "assets"
    | "story"
    | "storyDocuments"
    | "interface"
    | "characters"
    | "localization"
    | "voice"
    | "variables"
    | "audioTracks";

export type RecoveryProbeStatus = "untried" | "running" | "ok" | "failed";

export interface RecoveryProbeState {
    id: RecoveryProbeId;
    labelKey: TranslationKey;
    status: RecoveryProbeStatus;
    /**
     * The error exactly as it arrived, when this probe failed. Never translated - see the note on
     * `WorkspaceAnomaly.raw`, which this is the sibling of.
     */
    raw: string | null;
    /**
     * One line of detail on a run that finished, translated at render time.
     *
     * Carries the count that distinguishes "all twelve stories read" from "nine of twelve read", a
     * difference a pass/fail row cannot express and the author very much wants.
     */
    detail: { key: TranslationKey; params?: Record<string, string | number> } | null;
}

interface RecoveryEvents {
    changed: void;
}

/**
 * A probe is "bring this subsystem up and tell me what happened".
 *
 * Ordered by what depends on what, so running them top to bottom reports a root cause before the
 * things it takes down with it. Running one out of order is fine - each brings up its own
 * dependencies - it just means a failure may be reported twice, once as itself and once as a
 * dependency.
 */
interface RecoveryProbe {
    id: RecoveryProbeId;
    labelKey: TranslationKey;
    /**
     * Which part of the anomaly log speaks for this probe.
     *
     * Load it and see whether the service threw is not enough on its own: the services that matter
     * most here are the ones that *do not* throw. A damaged asset index is reported, set aside, and
     * replaced with an empty map, and the service comes up perfectly - so a probe judging only its
     * own `init` would print a green tick immediately above this panel's own report that the file
     * cannot be read. Watching this source across the run is what closes that gap.
     */
    source: WorkspaceAnomalySource;
    /** Resolves with an optional detail line, or throws whatever went wrong. */
    run: (ctx: WorkspaceContext) => Promise<RecoveryProbeState["detail"]>;
}

const PROBES: readonly RecoveryProbe[] = [
    {
        id: "project",
        source: "project",
        labelKey: "workspace.recovery.probes.project",
        run: ctx => bringUp(ctx, Services.Project),
    },
    {
        id: "assets",
        source: "assets",
        labelKey: "workspace.recovery.probes.assets",
        run: ctx => bringUp(ctx, Services.Assets),
    },
    {
        id: "story",
        source: "story",
        labelKey: "workspace.recovery.probes.story",
        run: ctx => bringUp(ctx, Services.Story),
    },
    {
        id: "storyDocuments",
        source: "story",
        labelKey: "workspace.recovery.probes.storyDocuments",
        // Separate from the library on purpose: the index and the scripts fail independently, and
        // conflating them is how "my stories are gone" and "one chapter will not open" end up
        // looking like the same problem. Reads every one rather than stopping at the first - the
        // author needs to know whether this is one bad file or all of them.
        run: async ctx => {
            await bringUp(ctx, Services.Story);
            const story = ctx.services.get<StoryService>(Services.Story);
            const entries = story.listStories();
            if (entries.length === 0) {
                return { key: "workspace.recovery.details.noStories" };
            }
            let unreadable = 0;
            for (const entry of entries) {
                try {
                    await story.loadStory(entry.id);
                } catch {
                    // Already recorded, with the path, by StoryService itself.
                    unreadable += 1;
                }
            }
            if (unreadable > 0) {
                throw new Error(
                    `${unreadable} of ${entries.length} story document(s) could not be read. `
                    + "See the anomalies above for each one's error.",
                );
            }
            return { key: "workspace.recovery.details.storiesRead", params: { count: entries.length } };
        },
    },
    {
        id: "interface",
        source: "interface",
        labelKey: "workspace.recovery.probes.interface",
        run: ctx => bringUp(ctx, Services.UIDocument),
    },
    {
        id: "characters",
        source: "characters",
        labelKey: "workspace.recovery.probes.characters",
        run: ctx => bringUp(ctx, Services.Character),
    },
    {
        id: "localization",
        source: "localization",
        labelKey: "workspace.recovery.probes.localization",
        run: ctx => bringUp(ctx, Services.Localization),
    },
    {
        id: "voice",
        source: "voice",
        labelKey: "workspace.recovery.probes.voice",
        run: ctx => bringUp(ctx, Services.Voice),
    },
    {
        id: "variables",
        source: "variables",
        labelKey: "workspace.recovery.probes.variables",
        run: ctx => bringUp(ctx, Services.VariableRegistry),
    },
    {
        id: "audioTracks",
        source: "audio",
        labelKey: "workspace.recovery.probes.audioTracks",
        run: ctx => bringUp(ctx, Services.AudioTracks),
    },
];

/**
 * Initialize one service, tolerantly, and answer with the first thing that went wrong.
 *
 * "First" means the deepest: dependencies initialize before their dependents, so failures arrive
 * root cause first, and a dependent's own follow-on error is the less useful of the two. Reporting
 * a dependency's failure as this probe's failure is correct rather than a shortcut - a service
 * standing on one that never came up has not come up either, whatever its own `init` returned.
 */
async function bringUp(ctx: WorkspaceContext, service: Services): Promise<RecoveryProbeState["detail"]> {
    const failures = await Service.initializeTolerant(ctx, [ctx.services.get(service)]);
    if (failures.length > 0) {
        throw failures[0].error;
    }
    return null;
}

export class RecoveryService extends Service<RecoveryService> implements IRecoveryService {
    private readonly events = new EventEmitter<RecoveryEvents>();
    private probes: RecoveryProbeState[] = PROBES.map(probe => ({
        id: probe.id,
        labelKey: probe.labelKey,
        status: "untried",
        raw: null,
        detail: null,
    }));
    private running = false;

    protected async init(_ctx: WorkspaceContext): Promise<void> {
        // Nothing. This service holds session state about a boot that has already happened, and it
        // is in the registry in every mode so that `Services.Recovery` resolves the same way
        // everywhere - it simply has nothing to say outside a recovery shell.
        this.reset();
    }

    public override dispose(_ctx: WorkspaceContext): void {
        this.events.clear();
        this.reset();
    }

    public getProbes(): readonly RecoveryProbeState[] {
        return this.probes;
    }

    /** True while any probe is running; the panel disables Run All rather than queueing clicks. */
    public isRunning(): boolean {
        return this.running;
    }

    public onChanged(listener: () => void): () => void {
        return this.events.on("changed", listener);
    }

    /**
     * Record what stage one already discovered.
     *
     * The shell brings up a handful of services before any author is looking, and some of those are
     * probes in their own right (the project manifest, the asset index). Their verdict is known, so
     * showing them as `untried` would ask the author to re-run work that has already been done - and
     * would hide the failure they came here about behind a button.
     */
    public seedFromBoot(failures: readonly ServiceInitFailure[], ctx: WorkspaceContext): void {
        for (const probe of PROBES) {
            const target = probeService(probe.id);
            if (!target) {
                continue;
            }
            let instance: Service;
            try {
                instance = ctx.services.get(target);
            } catch {
                continue;
            }
            const failure = failures.find(entry => entry.service === instance);
            if (failure) {
                this.setProbe(probe.id, { status: "failed", raw: describeRawError(failure.error), detail: null });
            } else if (instance.isInitialized(ctx)) {
                this.setProbe(probe.id, { status: "ok", raw: null, detail: null });
            }
        }
        this.emit();
    }

    /** Run one probe. Never throws: the failure is the result. */
    public async runProbe(id: RecoveryProbeId): Promise<void> {
        const probe = PROBES.find(entry => entry.id === id);
        if (!probe) {
            return;
        }
        this.running = true;
        this.setProbe(id, { status: "running", raw: null, detail: null });
        this.emit();
        const reportsBefore = getWorkspaceAnomalyReportCount(probe.source);
        try {
            const detail = await probe.run(this.getContext());
            // Resolving is not the same as succeeding. A service that swallowed an unreadable file
            // and carried on with nothing loaded gets here exactly like one that read everything,
            // and calling both of them green is the failure mode this whole panel exists to end.
            const reported = getWorkspaceAnomalyReportCount(probe.source) > reportsBefore;
            this.setProbe(id, reported
                ? { status: "failed", raw: this.latestRawFor(probe.source), detail: null }
                : { status: "ok", raw: null, detail });
        } catch (error) {
            this.setProbe(id, { status: "failed", raw: describeRawError(error), detail: null });
        } finally {
            this.running = false;
            this.emit();
        }
    }

    /**
     * Run every probe, in table order, and keep going past the failures.
     *
     * Sequential rather than concurrent because they share dependencies: run in parallel, two probes
     * would race to initialize the same service and the second would report the first one's
     * half-finished state as its own failure.
     */
    public async runAllProbes(): Promise<void> {
        for (const probe of PROBES) {
            await this.runProbe(probe.id);
        }
    }

    private reset(): void {
        this.probes = PROBES.map(probe => ({
            id: probe.id,
            labelKey: probe.labelKey,
            status: "untried",
            raw: null,
            detail: null,
        }));
        this.running = false;
    }

    /**
     * The newest raw error this source reported, for a probe that "succeeded" while its subsystem
     * was quietly failing. Newest because the log is newest-first and the run that just happened is
     * the one being described.
     */
    private latestRawFor(source: WorkspaceAnomalySource): string | null {
        return getWorkspaceAnomalies().find(anomaly => anomaly.source === source)?.raw ?? null;
    }

    private setProbe(id: RecoveryProbeId, patch: Partial<RecoveryProbeState>): void {
        this.probes = this.probes.map(probe => (probe.id === id ? { ...probe, ...patch } : probe));
    }

    private emit(): void {
        this.events.emit("changed", undefined);
    }
}

/**
 * The registry entry a probe is really about, or null when it is not one service.
 *
 * `storyDocuments` is the null case and has to be: it reads every story document through a service
 * that is already up, so "did `Services.Story` initialize" is not its answer.
 */
function probeService(id: RecoveryProbeId): Services | null {
    switch (id) {
        case "project": return Services.Project;
        case "assets": return Services.Assets;
        case "story": return Services.Story;
        case "interface": return Services.UIDocument;
        case "characters": return Services.Character;
        case "localization": return Services.Localization;
        case "voice": return Services.Voice;
        case "variables": return Services.VariableRegistry;
        case "audioTracks": return Services.AudioTracks;
        case "storyDocuments": return null;
    }
}
