import { Service } from "../Service";
import { Services, type WorkspaceContext } from "../services";
import { getInterface } from "@/lib/app/bridge";
import { MAIN_APP_SURFACE_ID } from "@shared/constants/ui-editor";
import type {
    BuildPreflightFinding,
    BuildPreflightSection,
    GameBuildPlatform,
    GameBuildRequest,
    GameBuildStateSnapshot,
    GameBuildStatus,
} from "@shared/types/gameBuild";
import type { LintReport, LintReportEntry, LintSeverity } from "@/lib/lint/types";
// One spelling of "where is this finding", shared with the report tab - see locationText.ts.
import { describeLintLocation, nonRedundantLintLocation } from "@/lib/lint/locationText";
export { nonRedundantLintLocation };
import { EventEmitter } from "../ui/EventEmitter";
import { ConsoleService, type ConsoleLogLevel } from "./ConsoleService";
import { CharacterService } from "./CharacterService";
import { StoryService } from "../story/StoryService";
import { collectInvalidBlocks, type InvalidStoryBlockRef } from "../story/storyModel";
import { translate } from "@/lib/i18n";
import { UIDocumentService } from "../ui-editor/UIDocumentService";
import { UIGraphService } from "../ui-editor/UIGraphService";
import type { LintingConfiguration } from "../../project/configuration";
// Type-only on purpose: the gate needs `run()` and nothing else, and a value import would drag the
// whole rule registry (and every rule's dependencies) into the build path and its tests.
import type { LintService } from "./LintService";
import type { ProjectService } from "./ProjectService";

type BuildServiceEvents = {
    stateChanged: GameBuildStateSnapshot;
};

/**
 * A build dialog session the user has not committed yet. Lives on the service
 * (see getDraft) so closing the dialog mid-configuration does not discard it.
 */
export type BuildDialogDraft = {
    request: GameBuildRequest;
    /** Section the dialog was showing, so reopening lands where the user left. */
    section: BuildPreflightSection;
};

const IDLE_STATE: GameBuildStateSnapshot = { status: "idle" };

/** Console channel the production build logs to; also where it drives the progress bar. */
export const BUILD_CONSOLE_CHANNEL = "build";

/**
 * `source` stamped on every console line the build pipeline emits. The channel is shared with Dev
 * Mode and preview output, so this is what identifies a line as belonging to a build - which is how
 * the dashboard's build history knows which lines to archive. Mirrors GameBuildManager, which
 * stamps the same literal on the main-process side.
 */
export const BUILD_CONSOLE_SOURCE = "Build";

/**
 * The pipeline reports only coarse phases (preparing → compiling → packaging), and the
 * longest phase - electron-builder packaging - is fully opaque: there is no real
 * fraction to show. Rather than fake a fill level that creeps upward (which is a lie
 * about how far along the build is), the bar runs as an indeterminate animation while a
 * build is active. It snaps to a solid 100% only on real completion.
 */
const BUILD_ACTIVE_STATUSES: readonly GameBuildStatus[] = ["preparing", "compiling", "packaging"];

/** How long the full bar lingers after a successful build before it clears. */
const BUILD_DONE_LINGER_MS = 1400;

/**
 * How many lint findings the build console prints one by one.
 *
 * A sweep of a large project can return thousands of entries - `story/label-unused` alone is one
 * per label - and the dashboard archives this channel per run. Pasting all of them in would bury
 * the build's own output under a list that already exists, complete and navigable, in the lint
 * report tab. Only the per-finding lines are capped; the summary and the refusal count are not.
 */
const LINT_CONSOLE_FINDING_LIMIT = 200;

/** Finding severity -> the console level it is logged at. */
const LINT_CONSOLE_LEVELS: Record<LintSeverity, ConsoleLogLevel> = {
    error: "error",
    warning: "warning",
    info: "info",
};

/**
 * Renderer-side view of the production build. Mirrors PreviewService: it holds
 * the last snapshot, polls the main process while a build is active, and lets
 * the toolbar/dialog react to status changes. The heavy lifting (compile +
 * electron-builder) lives in the main-process GameBuildManager.
 */
export class BuildService extends Service<BuildService> {
    private state: GameBuildStateSnapshot = IDLE_STATE;
    private timer: ReturnType<typeof setInterval> | null = null;
    private clearProgressTimer: ReturnType<typeof setTimeout> | null = null;
    private refreshInFlight = false;
    private draft: BuildDialogDraft | null = null;
    private readonly events = new EventEmitter<BuildServiceEvents>();

    protected async init(_ctx: WorkspaceContext): Promise<void> {
        return;
    }

    public override activate(_ctx: WorkspaceContext): void {
        void this.refreshState();
    }

    public override dispose(_ctx: WorkspaceContext): void {
        this.stopPolling();
        if (this.clearProgressTimer) {
            clearTimeout(this.clearProgressTimer);
            this.clearProgressTimer = null;
        }
        this.draft = null;
        this.events.clear();
    }

    /**
     * The build dialog's in-flight selection, parked here rather than in the
     * dialog component so it survives the dialog closing. That round trip is a
     * real flow: the icon rows close the dialog to open the project panel's
     * asset settings, and the user expects to come back to what they had.
     *
     * Deliberately memory-only and never persisted - only starting a build
     * writes BuildConfiguration to the project. A draft is a half-finished
     * thought, not a preference.
     */
    public getDraft(): BuildDialogDraft | null {
        return this.draft;
    }

    public setDraft(draft: BuildDialogDraft): void {
        this.draft = draft;
    }

    public clearDraft(): void {
        this.draft = null;
    }

    public getState(): GameBuildStateSnapshot {
        return this.state;
    }

    /**
     * Ask the main process what this selection would complain about. Advisory:
     * the pipeline re-runs every check, so a preflight that misses something
     * (or fails outright) can only cost a late error, never a bad build.
     */
    public async preflight(request: GameBuildRequest): Promise<BuildPreflightFinding[]> {
        const result = await getInterface().gameBuild.preflight(this.projectPath(), request);
        return result.success ? result.data.findings : [];
    }

    public getStatus(): GameBuildStatus {
        return this.state.status;
    }

    public isBuilding(): boolean {
        return isActiveStatus(this.state.status);
    }

    public onStateChanged(handler: (state: GameBuildStateSnapshot) => void): () => void {
        return this.events.on("stateChanged", handler);
    }

    public async refreshState(): Promise<GameBuildStateSnapshot> {
        if (this.refreshInFlight) {
            return this.state;
        }
        this.refreshInFlight = true;
        try {
            const result = await getInterface().gameBuild.getStatus(this.projectPath());
            if (result.success) {
                this.updateState(result.data.state);
            }
        } finally {
            this.refreshInFlight = false;
        }
        return this.state;
    }

    public async start(request: GameBuildRequest): Promise<GameBuildStateSnapshot> {
        // Stamped before the pre-build checks rather than alongside the "preparing" state below, so
        // a run rejected by one of them still reports when it began. The dashboard's build history
        // archives each run's console output from this instant, and those checks log to it.
        const startedAt = Date.now();
        // The checks below fail without ever reaching the main process, so nothing else will name
        // the platforms for them - and a build that died in preflight is exactly the one an author
        // comes back to in the dashboard's history wanting to know what it was building.
        const platforms = [...new Set(request.targets.map(target => target.platform))];
        try {
            await this.prepareProjectForBuild();
        } catch (error) {
            console.error("[Build] failed to flush editor state before build", error);
            this.updateState({
                status: "error",
                startedAt,
                finishedAt: Date.now(),
                platforms,
                error: "Failed to save the project before building",
            });
            return this.state;
        }
        // The story compiler runs inside the game at startup, not here, so it cannot be what stops an
        // unresolved command line from shipping - this is the only gate before the packer.
        const invalid = await this.collectInvalidStoryBlocks();
        if (invalid.length > 0) {
            const consoleService = this.tryGetConsole();
            for (const ref of invalid) {
                consoleService?.log(BUILD_CONSOLE_CHANNEL, "error", translate("build.invalidCommand", {
                    story: ref.storyName,
                    scene: ref.sceneName,
                    source: ref.source,
                }), { source: BUILD_CONSOLE_SOURCE });
            }
            this.updateState({
                status: "error",
                startedAt,
                finishedAt: Date.now(),
                platforms,
                error: translate("build.invalidCommandSummary", { count: invalid.length }),
            });
            return this.state;
        }
        // The project check (ruling R3), behind the gate above and never instead of it: that one is
        // unconditional (ruling R4), and a sweep an author can switch off in settings must not be
        // what decides whether a story the compiler refuses gets to ship.
        const lintRefusal = await this.runLintGate(startedAt, platforms);
        if (lintRefusal) {
            return lintRefusal;
        }
        // Committed: the selection is now persisted as BuildConfiguration, so
        // the draft has served its purpose and must not shadow it next time.
        this.clearDraft();
        this.updateState({ status: "preparing", startedAt, platforms });
        const result = await getInterface().gameBuild.start(this.projectPath(), {
            kind: "surface",
            surfaceId: MAIN_APP_SURFACE_ID,
        }, request);
        if (result.success) {
            this.updateState(result.data.state);
        } else {
            // `startedAt` matters as much as the message: the dashboard archives this as a finished
            // build, and without it the record's duration is measured from the epoch.
            this.updateState({ status: "error", startedAt, finishedAt: Date.now(), platforms, error: result.error });
        }
        return this.state;
    }

    public async cancel(): Promise<GameBuildStateSnapshot> {
        const result = await getInterface().gameBuild.cancel(this.projectPath());
        if (result.success) {
            this.updateState(result.data.state);
        }
        return this.state;
    }

    /**
     * Every unresolved command line in the project, across every story - not just the loaded ones.
     * An unfinished line in a story the author never opened this session still must not ship.
     */
    private async collectInvalidStoryBlocks(): Promise<InvalidStoryBlockRef[]> {
        const story = this.getContext().services.get<StoryService>(Services.Story);
        const found: InvalidStoryBlockRef[] = [];
        for (const entry of story.getLibraryIndex().stories) {
            try {
                found.push(...collectInvalidBlocks(await story.loadStory(entry.id)));
            } catch (error) {
                // A story that will not load is the packer's problem to report, not ours to mask.
                console.error(`[Build] could not scan story ${entry.id} for invalid commands`, error);
            }
        }
        return found;
    }

    /**
     * The lint gate. Returns the refusal snapshot when the build must stop, `null` when it may go
     * on - so the caller reads as one more link in the same chain of pre-build checks.
     *
     * Findings are logged whether or not they block: the author is already looking at this console,
     * and a check that ran, found things, and said nothing about the ones below the threshold would
     * be worth less than not running at all.
     */
    private async runLintGate(
        startedAt: number,
        platforms: GameBuildPlatform[],
    ): Promise<GameBuildStateSnapshot | null> {
        const consoleService = this.tryGetConsole();
        const services = this.getContext().services;
        const config = services.get<ProjectService>(Services.Project).getLintingConfiguration();
        if (!config.runOnBuild) {
            // `verbose` so the answer to "why was nothing checked?" is in the log for anyone who
            // goes looking, without putting a line in every build of every project that opted out.
            consoleService?.log(BUILD_CONSOLE_CHANNEL, "verbose", translate("lint.build.skipped"), {
                source: BUILD_CONSOLE_SOURCE,
            });
            return null;
        }

        let report: LintReport;
        try {
            report = await services.get<LintService>(Services.Lint).run();
        } catch (error) {
            // Fail the build rather than log and continue. The gate answers one question - "is
            // anything wrong with this project" - and a sweep that crashed did not answer it;
            // treating an unknown as a clean bill is precisely the outcome the gate exists to
            // prevent, and it would happen silently, on the run nobody is watching. This is not
            // the "a rule is buggy" case either: the engine already absorbs a throwing rule into
            // an error finding, so reaching here means the sweep itself never happened. An author
            // who wants the build anyway turns off `runOnBuild`, a toggle they already own.
            //
            // Untranslated for the same reason as the flush failure above: this reports Studio
            // malfunctioning, not something the project did.
            console.error("[Build] the project check failed to run", error);
            const message = "The project check failed to run";
            consoleService?.log(BUILD_CONSOLE_CHANNEL, "error", message, { source: BUILD_CONSOLE_SOURCE });
            this.logLintGateHint(consoleService);
            this.updateState({ status: "error", startedAt, finishedAt: Date.now(), platforms, error: message });
            return this.state;
        }

        this.logLintReport(consoleService, report);

        const blocking = countBlockingLintFindings(report, config.failBuildOn);
        if (blocking === 0) {
            return null;
        }
        // The refusal goes on the console as well as into the state. The state's copy reaches the
        // author as a toast, which is gone in seconds and never archived; the console is the record
        // the dashboard keeps per run, and without this line that record ends at "12 warnings in
        // 1.2s" and never says the build stopped at all - let alone which of those findings stopped
        // it, which is what the count is for.
        const refusal = translate("lint.build.blocked", { count: blocking });
        consoleService?.log(BUILD_CONSOLE_CHANNEL, "error", refusal, { source: BUILD_CONSOLE_SOURCE });
        this.logLintGateHint(consoleService);
        // `startedAt` and `platforms` carried through for the same reason the gate above carries
        // them: the dashboard archives a refused run as a finished build, and without them its
        // duration is measured from the epoch and it cannot say what it was building.
        this.updateState({
            status: "error",
            startedAt,
            finishedAt: Date.now(),
            platforms,
            error: refusal,
        });
        return this.state;
    }

    /**
     * Where the author changes their mind about this gate, printed after every refusal the gate
     * makes - the blocking findings above, and the sweep that never ran below.
     *
     * A build that stops for a reason the author did not ask for is only fair if the setting that
     * asked for it is findable, and `runOnBuild` defaults to on: for most projects nobody ever chose
     * this, so nobody knows where to unchoose it. `info` rather than `error` because it is not a
     * second problem - it is the way out of the first one, and the console hides `verbose` by
     * default, which would put this line exactly where it does no good.
     */
    private logLintGateHint(consoleService: ConsoleService | null): void {
        consoleService?.log(BUILD_CONSOLE_CHANNEL, "info", translate("lint.build.blockedHint"), {
            source: BUILD_CONSOLE_SOURCE,
        });
    }

    /** Every finding on the build channel at the level its severity maps to, then one summary. */
    private logLintReport(consoleService: ConsoleService | null, report: LintReport): void {
        if (!consoleService) {
            return;
        }
        for (const entry of report.entries.slice(0, LINT_CONSOLE_FINDING_LIMIT)) {
            consoleService.log(
                BUILD_CONSOLE_CHANNEL,
                LINT_CONSOLE_LEVELS[entry.severity],
                formatLintFinding(entry),
                { source: BUILD_CONSOLE_SOURCE },
            );
        }
        const suppressed = report.entries.length - LINT_CONSOLE_FINDING_LIMIT;
        if (suppressed > 0) {
            // Deliberately a count and not a sentence: the rest of the list is one click away in
            // the report tab, and this line only has to say that the console stopped short.
            consoleService.log(BUILD_CONSOLE_CHANNEL, "info", `+${suppressed} more`, {
                source: BUILD_CONSOLE_SOURCE,
            });
        }
        consoleService.log(
            BUILD_CONSOLE_CHANNEL,
            report.counts.error > 0 ? "error" : report.counts.warning > 0 ? "warning" : "success",
            translate("lint.console.finished", {
                errors: report.counts.error,
                warnings: report.counts.warning,
                duration: `${((report.finishedAt - report.startedAt) / 1000).toFixed(1)}s`,
            }),
            { source: BUILD_CONSOLE_SOURCE },
        );
    }

    /** Flush dirty editor state so the build sees what the user last authored. */
    private async prepareProjectForBuild(): Promise<void> {
        const services = this.getContext().services;
        const uid = services.get<UIDocumentService>(Services.UIDocument);
        const graph = services.get<UIGraphService>(Services.UIGraph);
        const story = services.get<StoryService>(Services.Story);
        const character = services.get<CharacterService>(Services.Character);

        if (uid.isDirty()) {
            await uid.save(uid.getDocument());
        }
        if (graph.isDirty()) {
            await graph.save(graph.getDocument());
        }
        if (story.isDirty()) {
            await story.flushPendingChanges();
        }
        if (character.isDirty()) {
            await character.flushPendingChanges();
        }
    }

    private projectPath(): string {
        return this.getContext().project.getConfig().projectPath;
    }

    private updateState(next: GameBuildStateSnapshot): void {
        this.syncPolling(next.status);
        const previous = this.state;
        this.state = next;
        // Phase transitions (not every poll tick) drive the console progress bar.
        if (previous.status !== next.status) {
            this.syncConsoleProgress(next.status);
        }
        // Polling returns a fresh snapshot object every second; only notify
        // subscribers when something they render actually changed, so a
        // minutes-long packaging phase does not re-render the toolbar each tick.
        if (isSameSnapshot(previous, next)) {
            return;
        }
        this.events.emit("stateChanged", next);
    }

    /**
     * Reflect the build phase onto the console's bottom progress bar (the "build"
     * channel). Because the pipeline exposes no real fraction, an active build shows an
     * indeterminate animation (honest "working", never a faked fill level). Completion
     * snaps to a solid 100% and lingers briefly; a failure turns the bar warning.
     */
    private syncConsoleProgress(status: GameBuildStatus): void {
        const consoleService = this.tryGetConsole();
        if (!consoleService) {
            return;
        }
        if (this.clearProgressTimer) {
            clearTimeout(this.clearProgressTimer);
            this.clearProgressTimer = null;
        }

        if (status === "error") {
            // Solid full-width warning bar - the colour signals failure (the console
            // logs carry the detail); it does not claim a completion fraction.
            consoleService.setProgress(BUILD_CONSOLE_CHANNEL, { value: 1, indeterminate: false, error: true });
            return;
        }
        if (status === "done") {
            consoleService.setProgress(BUILD_CONSOLE_CHANNEL, { value: 1, indeterminate: false, error: false });
            this.clearProgressTimer = setTimeout(() => {
                this.clearProgressTimer = null;
                this.tryGetConsole()?.setProgress(BUILD_CONSOLE_CHANNEL, null);
            }, BUILD_DONE_LINGER_MS);
            return;
        }
        if (!BUILD_ACTIVE_STATUSES.includes(status)) {
            // idle (or anything else): no build running, so no bar.
            consoleService.setProgress(BUILD_CONSOLE_CHANNEL, null);
            return;
        }

        // Active build. "preparing" opens a fresh run: drop any stale (done/error) bar
        // and start a clean indeterminate animation with the error colour reset. Later
        // phases just ensure the animation exists without disturbing an error flip that
        // an error-level log may have already applied.
        if (status === "preparing") {
            consoleService.setProgress(BUILD_CONSOLE_CHANNEL, null);
            consoleService.setProgress(BUILD_CONSOLE_CHANNEL, { indeterminate: true, error: false });
        } else if (!consoleService.getProgress(BUILD_CONSOLE_CHANNEL)) {
            consoleService.setProgress(BUILD_CONSOLE_CHANNEL, { indeterminate: true });
        }
    }

    private tryGetConsole(): ConsoleService | null {
        try {
            return this.getContext().services.get<ConsoleService>(Services.Console);
        } catch {
            return null;
        }
    }

    private syncPolling(status: GameBuildStatus): void {
        if (isActiveStatus(status)) {
            this.startPolling();
        } else {
            this.stopPolling();
        }
    }

    private startPolling(): void {
        if (this.timer) {
            return;
        }
        this.timer = setInterval(() => {
            void this.refreshState();
        }, 1000);
    }

    private stopPolling(): void {
        if (!this.timer) {
            return;
        }
        clearInterval(this.timer);
        this.timer = null;
    }
}

function isActiveStatus(status: GameBuildStatus): boolean {
    return status === "preparing" || status === "compiling" || status === "packaging";
}

/**
 * How many findings refuse the build: errors always, warnings too when `failBuildOn` is "warning".
 * `info` never blocks under either setting - there is no configuration in which it does.
 *
 * Counted off `entries` rather than `report.counts` so the number in the refusal can never disagree
 * with the lines just printed on the console: both are that one list.
 */
export function countBlockingLintFindings(
    report: LintReport,
    failBuildOn: LintingConfiguration["failBuildOn"],
): number {
    return report.entries.filter(entry => isBlockingLintSeverity(entry.severity, failBuildOn)).length;
}

/** The gate's decision, on its own: does this report stop this project's build? */
export function shouldBlockBuild(report: LintReport, config: LintingConfiguration): boolean {
    return config.runOnBuild && countBlockingLintFindings(report, config.failBuildOn) > 0;
}

function isBlockingLintSeverity(
    severity: LintSeverity,
    failBuildOn: LintingConfiguration["failBuildOn"],
): boolean {
    return severity === "error" || (failBuildOn === "warning" && severity === "warning");
}

/**
 * One console line for a finding. `lint.console.finding` is `{location} {message} ({rule})`.
 *
 * `rule` is the rule *id*, not its localized title: the title would only restate the `message` slot
 * beside it, whereas the id is the one thing the sentence cannot carry - which row in Project ->
 * Linting turns this finding off. It also keeps the rule registry out of the build path.
 *
 * Severity is not in the line at all: every console row already prints its level in a column of its
 * own, so the word was there twice.
 *
 * The location gets the redundancy treatment instead, and it has to be earned at runtime rather
 * than decided here: a few rules do name their own subject ("dialog.png is not used anywhere"), and
 * printing the site beside one of those stutters - "dialog.png dialog.png is not used anywhere". See
 * {@link nonRedundantLintLocation}.
 */
export function formatLintFinding(entry: LintReportEntry): string {
    const message = translate(entry.messageKey, entry.messageParams);
    return translate("lint.console.finding", {
        rule: entry.ruleId,
        location: nonRedundantLintLocation(describeLintLocation(entry.location), message),
        message,
    })
        // A project-wide finding has no location and would otherwise leave a gap mid-line - and so
        // does one whose location the message already carried.
        .replace(/\s{2,}/g, " ")
        .trim();
}

/** Compare the snapshot fields the UI renders, ignoring per-poll object identity. */
function isSameSnapshot(a: GameBuildStateSnapshot, b: GameBuildStateSnapshot): boolean {
    return a.status === b.status
        && a.error === b.error
        && a.outputDir === b.outputDir
        && (a.artifacts?.length ?? 0) === (b.artifacts?.length ?? 0);
}
