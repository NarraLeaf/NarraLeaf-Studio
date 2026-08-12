import { Service } from "../Service";
import { Services, type WorkspaceContext } from "../services";
import { getInterface } from "@/lib/app/bridge";
import { MAIN_APP_SURFACE_ID } from "@shared/constants/ui-editor";
import type {
    BuildPreflightFinding,
    GameBuildPlatform,
    GameBuildRequest,
    GameBuildStateSnapshot,
    GameBuildStatus,
} from "@shared/types/gameBuild";
// Type-only: the draft records which page the dialog was on, and the page list is the dialog's.
import type { BuildDialogPage } from "@/apps/workspace/modules/actions/buildDialogState";
import type { LintReport, LintReportEntry, LintSeverity } from "@/lib/lint/types";
import type { Blueprint, BlueprintDocument } from "@shared/types/blueprint/document";
import { collectBlueprintNetworkNodes } from "@/lib/lint/rules";
// One spelling of "where is this finding", shared with the report tab - see locationText.ts.
import { describeLintLocation, nonRedundantLintLocation } from "@/lib/lint/locationText";
export { nonRedundantLintLocation };
import { EventEmitter } from "../ui/EventEmitter";
import { ConsoleService, type ConsoleLogLevel } from "./ConsoleService";
import { CharacterService } from "./CharacterService";
import { StoryService } from "../story/StoryService";
import { collectInvalidBlocks, type InvalidStoryBlockRef } from "../story/storyModel";
import {
    collectNestedCutPoints,
    collectUnfoldableAppTagUses,
    type NestedCutPoint,
    type UnfoldableAppTagUse,
} from "@shared/story/appTagFold";
import {
    solveReleaseContent,
    type ReleaseContentAnswer,
    type ReleaseContentBlockerReason,
    type ReleaseContentPlugin,
    type ReleaseContentStory,
} from "@/lib/build/releaseContent";
import {
    collectUnfoldableAppTagGraphs,
    type AppTagGraphRefusalReason,
} from "@shared/blueprint/appTagGraphFold";
import { AppTagService } from "../appTag/AppTagService";
import type { ReferenceIndexGap } from "../references/referenceModel";
// Type-only, like `LintService` above: the gate needs `getIndexResult()` and nothing else, and a
// value import would drag every extractor into the build path and its tests.
import type { ReferenceService } from "../references/ReferenceService";
import { translate, translateN } from "@/lib/i18n";
import { UIDocumentService } from "../ui-editor/UIDocumentService";
import { UIGraphService } from "../ui-editor/UIGraphService";
import type { LintingConfiguration } from "../../project/configuration";
// Type-only on purpose: the gate needs `run()` and nothing else, and a value import would drag the
// whole rule registry (and every rule's dependencies) into the build path and its tests.
import type { LintService } from "./LintService";
import type { ProjectService } from "./ProjectService";
// Type-only for the same reason as LintService above: the gate needs `scan()` and `listUnplayable()`,
// and a value import would drag the probe bridge into the build path and its tests.
import type { MediaSupportService } from "../media/MediaSupportService";

type BuildServiceEvents = {
    stateChanged: GameBuildStateSnapshot;
};

/**
 * A build dialog session the user has not committed yet. Lives on the service
 * (see getDraft) so closing the dialog mid-configuration does not discard it.
 */
export type BuildDialogDraft = {
    request: GameBuildRequest;
    /**
     * Page the dialog was showing, so reopening lands where the user left. A page rather than a
     * finding's section: the dialog has one page no finding can name, and a page that is not shown
     * for this project is clamped to the first one that is.
     */
    page: BuildDialogPage;
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

/**
 * Blocker reason -> the line the console prints, remedy included.
 *
 * A table rather than a switch so the three cannot drift: each one names what to go and look at and
 * what to state instead, and an author who has three of them gets three usable instructions.
 */
const BLOCKER_MESSAGE_KEYS: Record<ReleaseContentBlockerReason, "build.contentBlockedStartStory" | "build.contentBlockedScript" | "build.contentBlockedPlugin"> = {
    unreadableStartStoryTarget: "build.contentBlockedStartStory",
    scriptBlueprint: "build.contentBlockedScript",
    storyStartingPlugin: "build.contentBlockedPlugin",
};

/**
 * Why one graph was refused -> the console line that says so.
 *
 * Three reasons rather than one message with a hedge in it: each names a different thing to change,
 * and the console is what an author comes back to.
 */
const APP_TAG_GRAPH_MESSAGE_KEYS: Record<AppTagGraphRefusalReason, "build.appTagGraphUnresolved" | "build.appTagGraphUnknownNode" | "build.appTagGraphFnHead"> = {
    unresolved: "build.appTagGraphUnresolved",
    unknownNode: "build.appTagGraphUnknownNode",
    fnHeadRemoved: "build.appTagGraphFnHead",
};

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
                error: translateN("build.invalidCommandSummary", invalid.length, { count: invalid.length }),
            });
            return this.state;
        }
        // Beside the invalid-command gate, and in the same class as it.
        //
        // ## Why this is a gate and not a preflight finding
        //
        // The line between the two is: a condition whose report needs per-row story detail is a
        // gate, and a condition that is a property of the project's configuration is a preflight
        // finding. This one is the first kind twice over. It quotes the author's own expression -
        // `use.source` is the text they typed, and without it "an AppTag comparison is undecidable"
        // names nothing they can find - and it reads every story document the editor is holding,
        // unsaved edits included, which the main process has no copy of. The same is true of the
        // undecidable-entry refusal further down (see `runReleaseContentGate`), which names the
        // blueprint and the node.
        //
        // The three variant conditions that DID become preflight findings are in
        // `variantContentPreflight.ts`, and its header states the same criterion from that side.
        //
        // The test that comment states for the unconditional class is "decided by measurement, not
        // an opinion an author may reasonably overrule", and this meets it exactly: `AppTag` has no
        // play-time value at all, so a comparison the fold cannot decide is not a style a project
        // might tolerate - it is an expression that cannot be compiled under any setting. It is also
        // free, reading documents the story service already holds, so it sits with the other free
        // gate rather than behind the media probe.
        //
        // Every build refuses it, the release variant included. This is not a leak-only concern: the
        // release build has no more of a value for `AppTag` than a demo does.
        const unfoldable = await this.collectUnfoldableAppTagUses(request.appTagId);
        if (unfoldable.length > 0) {
            const consoleService = this.tryGetConsole();
            for (const use of unfoldable) {
                consoleService?.log(BUILD_CONSOLE_CHANNEL, "error", translate("build.appTagUnresolved", {
                    story: use.storyName,
                    scene: use.sceneName,
                    source: use.source,
                }), { source: BUILD_CONSOLE_SOURCE });
            }
            this.updateState({
                status: "error",
                startedAt,
                finishedAt: Date.now(),
                platforms,
                error: translateN("build.appTagUnresolvedSummary", unfoldable.length, { count: unfoldable.length }),
            });
            return this.state;
        }
        // The other half of the same gate, over the same documents the sweep above just read.
        //
        // A cut point inside a condition or a group cannot be honoured: whether the story ends there
        // depends on a test only the running game performs, and there is no "end the story" action to
        // emit instead - so the package's content boundary would have to be guessed. That is the
        // unconditional class exactly, and refusing is the alternative to shipping a boundary nobody
        // chose. Release refuses it too: the row is equally unanalysable there, and an author who
        // only ever builds release should learn about it at their first build, not their first demo.
        const nestedCuts = await this.collectNestedCutPoints();
        if (nestedCuts.length > 0) {
            const consoleService = this.tryGetConsole();
            const appTags = this.getContext().services.get<AppTagService>(Services.AppTags);
            for (const cut of nestedCuts) {
                consoleService?.log(BUILD_CONSOLE_CHANNEL, "error", translate("build.cutPointNested", {
                    story: cut.storyName,
                    scene: cut.sceneName,
                    // `getTag`, not `resolveTag`: an id no variant answers to must not print as
                    // "main", which is the one variant a cut point can never mean.
                    variant: appTags.getTag(cut.appTagId)?.name ?? cut.appTagId,
                }), { source: BUILD_CONSOLE_SOURCE });
            }
            this.updateState({
                status: "error",
                startedAt,
                finishedAt: Date.now(),
                platforms,
                error: translateN("build.cutPointNestedSummary", nestedCuts.length, { count: nestedCuts.length }),
            });
            return this.state;
        }
        // What this variant's package comes to, and whether anything about it cannot be decided.
        //
        // Beside the two sweeps above rather than in the main-process preflight, because it has
        // per-row story detail: it names the scene a jump leads to and the blueprint a node sits in,
        // and the preflight has neither document. It reads the story documents those two sweeps have
        // just put in the service's cache, so it is free in the same sense they are.
        const contentRefusal = await this.runReleaseContentGate(startedAt, platforms, request.appTagId);
        if (contentRefusal) {
            return contentRefusal;
        }
        // The blueprint half of the `AppTag` gate above, and unconditional for the same reason: a
        // graph that names the variant without deciding a branch with it cannot be compiled under any
        // variant, release included. Free like the two before it - it walks the blueprint document
        // already in memory.
        const appTagGraphRefusal = this.runAppTagGraphGate(startedAt, platforms, request.appTagId);
        if (appTagGraphRefusal) {
            return appTagGraphRefusal;
        }
        // Third of the unconditional correctness gates, and placed here for the same reason the
        // invalid-command gate is first: it is free. It walks the blueprint document already in
        // memory, so a build that will be refused anyway does not first pay for a media probe.
        const networkRefusal = this.runNetworkGate(startedAt, platforms);
        if (networkRefusal) {
            return networkRefusal;
        }
        // Second of the two unconditional correctness gates, and placed *between* them on purpose.
        //
        // Behind the invalid-command gate because that one is free - it reads documents already in
        // memory - while this one may spawn a probe per media file whose bytes it has not seen
        // before; a build that was going to be refused anyway should not pay for that first.
        //
        // Ahead of the lint gate because it belongs to the other class of check entirely. Lint is a
        // sweep of opinions: its severities are configurable, `runOnBuild` can switch it off, and
        // its findings are warnings by default. A video the shipped engine cannot decode is not an
        // opinion - it is a black rectangle in the packaged game, decided by measurement, and no
        // setting an author has may turn that into a pass. Putting it behind `runOnBuild` would
        // mean a project that switched lint off ships broken media silently, which is exactly the
        // reasoning ruling R4 already applied to unresolved command lines.
        const mediaRefusal = await this.runMediaGate(startedAt, platforms);
        if (mediaRefusal) {
            return mediaRefusal;
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
     * Every `AppTag` comparison the build cannot decide, across every story - not just the loaded
     * ones, for the same reason the invalid-command sweep reads them all: a story the author never
     * opened this session ships exactly like one they did.
     *
     * The variant's name is passed for completeness only. Whether a mention reduces to a literal is
     * a property of the expression, not of which variant is being built: `AppTag == someVariable`
     * is undecidable under every one of them, which is why one refusal covers them all.
     */
    private async collectUnfoldableAppTagUses(appTagId: string | undefined): Promise<UnfoldableAppTagUse[]> {
        const services = this.getContext().services;
        const story = services.get<StoryService>(Services.Story);
        const tagName = services.get<AppTagService>(Services.AppTags).resolveTag(appTagId).name;
        const found: UnfoldableAppTagUse[] = [];
        for (const entry of story.getLibraryIndex().stories) {
            try {
                found.push(...collectUnfoldableAppTagUses(await story.loadStory(entry.id), { tagName }));
            } catch (error) {
                // A story that will not load is the packer's problem to report, not ours to mask.
                console.error(`[Build] could not scan story ${entry.id} for AppTag comparisons`, error);
            }
        }
        return found;
    }

    /**
     * Every cut point that is not at the top level of its scene, across every story - the same reach
     * as the two sweeps above, and free for the same reason: by now each document is in the story
     * service's cache, so this reads memory rather than disk.
     *
     * Takes no variant. A cut point inside a condition is unanalysable under every one of them,
     * release included, so one refusal covers them all.
     */
    private async collectNestedCutPoints(): Promise<NestedCutPoint[]> {
        const story = this.getContext().services.get<StoryService>(Services.Story);
        const found: NestedCutPoint[] = [];
        for (const entry of story.getLibraryIndex().stories) {
            try {
                found.push(...collectNestedCutPoints(await story.loadStory(entry.id)));
            } catch (error) {
                // A story that will not load is the packer's problem to report, not ours to mask.
                console.error(`[Build] could not scan story ${entry.id} for cut points`, error);
            }
        }
        return found;
    }

    /**
     * The release content gate: no variant build starts while something in the project can name a
     * scene the build cannot read.
     *
     * ## Why this refuses where it used to shrug
     *
     * The packer's answer to an unreadable mechanism is to ship every story whole. That is safe -
     * nothing is missing from the package - but it is silently the opposite of what the author asked
     * for: a demo that carries the whole script, with the cut point they wrote doing nothing. The
     * only way to learn it was to unpack the build. So the three mechanisms become a refusal with the
     * remedy attached, and the remedy is one an author can actually use: state which scenes the thing
     * starts, per variant, which is exactly the shape a chapter select has.
     *
     * ## And why it stays quiet almost always
     *
     * Only when the variant removes something. A build that keeps every scene cannot be made wrong by
     * a mechanism nobody can read, so a release build - which cuts nothing by construction - never
     * reaches the refusal, and neither does a variant whose cut points are all in stories it does not
     * touch. That condition lives in the solver ({@link ReleaseContentAnswer.blockers}) rather than
     * here, so the panel that offers the remedy and the gate that demands it agree about when it
     * matters.
     *
     * ## What it prints when it passes
     *
     * The kept and dropped counts, and every dropped scene by name. A variant build changes which
     * bytes ship, and the console is where an author finds out that it did.
     */
    private async runReleaseContentGate(
        startedAt: number,
        platforms: GameBuildPlatform[],
        appTagId: string | undefined,
    ): Promise<GameBuildStateSnapshot | null> {
        const consoleService = this.tryGetConsole();
        const services = this.getContext().services;
        const appTags = services.get<AppTagService>(Services.AppTags);
        const appTag = appTags.resolveTag(appTagId);

        let answer: ReleaseContentAnswer;
        try {
            answer = solveReleaseContent({
                appTag,
                projectDeclaredScenes: appTags.getDocument().reachableScenes ?? {},
                stories: await this.loadAllStories(),
                blueprints: this.listProjectBlueprints(),
                plugins: await this.listShippingPlugins(),
                // The four sets this gate cannot be stopped by. Nothing about a surface, an asset, a
                // localization key or a plugin's presence blocks a build, and assembling them means
                // an asset reference index rebuild - which the gates around this one deliberately do
                // not pay for. The panel that reports what a variant contains passes them all.
                surfaces: [],
                assets: [],
                assetReferences: new Map(),
                localizationKeys: [],
            });
        } catch (error) {
            // Untranslated, like the media gate's own failure: this reports Studio malfunctioning
            // rather than something the project did, and a gate that fails closed on its own defect
            // can leave a project unbuildable with nothing the author can do about it.
            console.error("[Build] the release content check failed to run", error);
            consoleService?.log(BUILD_CONSOLE_CHANNEL, "warning", "The build content check failed to run", {
                source: BUILD_CONSOLE_SOURCE,
            });
            return null;
        }

        for (const stale of answer.staleDeclarations) {
            consoleService?.log(BUILD_CONSOLE_CHANNEL, "warning", translate("build.contentStaleDeclaration", {
                location: stale.location,
                variant: answer.appTagName,
            }), { source: BUILD_CONSOLE_SOURCE });
        }

        if (answer.blockers.length > 0) {
            for (const blocker of answer.blockers) {
                consoleService?.log(BUILD_CONSOLE_CHANNEL, "error", translate(BLOCKER_MESSAGE_KEYS[blocker.reason], {
                    location: blocker.location,
                    variant: answer.appTagName,
                }), { source: BUILD_CONSOLE_SOURCE });
            }
            const refusal = translateN("build.contentBlockedSummary", answer.blockers.length, {
                count: answer.blockers.length,
                variant: answer.appTagName,
            });
            consoleService?.log(BUILD_CONSOLE_CHANNEL, "error", refusal, { source: BUILD_CONSOLE_SOURCE });
            // `startedAt` and `platforms` carried through for the reason the gates either side carry
            // them: the dashboard archives a refused run as a finished build.
            this.updateState({ status: "error", startedAt, finishedAt: Date.now(), platforms, error: refusal });
            return this.state;
        }

        if (answer.removedScenes.length > 0) {
            const coverageRefusal = this.refuseOnTrimCoverageGaps(startedAt, platforms, answer.appTagName);
            if (coverageRefusal) {
                return coverageRefusal;
            }
            const kept = answer.members.filter(member => member.kind === "scene").length;
            consoleService?.log(BUILD_CONSOLE_CHANNEL, "info", translateN("build.contentKept", kept, {
                count: kept,
                variant: answer.appTagName,
            }), { source: BUILD_CONSOLE_SOURCE });
            for (const removed of answer.removedScenes) {
                consoleService?.log(BUILD_CONSOLE_CHANNEL, "info", translate("build.contentDropped", {
                    scene: removed.sceneName,
                    story: removed.storyName,
                }), { source: BUILD_CONSOLE_SOURCE });
            }
        }
        return null;
    }

    /**
     * The reference index gate: a build that removes scenes does not start while a story document is
     * missing from the index that says what those scenes hold.
     *
     * ## The question, which is not "is the index complete"
     *
     * The established ruling for a trimming pass is that it asks **"is there a gap in a document that
     * could touch what I am removing"**, never the project-wide question. Asking the broad one hands
     * the feature a permanent off switch: one `app://fs` URL pasted into a widget prop leaves a
     * `hashUrlUnresolved` gap that can never be resolved - those tokens are per-process and a token
     * another session minted resolves to nothing here, forever - and every variant build in that
     * project would refuse from then on, over a widget that has nothing to do with any scene.
     *
     * So the gaps this reads are the ones in a **story** document, plus the ones that describe no
     * document at all (an index that never built, a slice that threw before it could say where). A
     * gap in a widget, a blueprint, a voice table or a character says nothing about which scenes a
     * story can reach, and this build removes nothing else.
     *
     * ## Why it is a gate and not a preflight finding
     *
     * The criterion is stated at the `AppTag` gate above, and this one fails it for a reason of its
     * own: the index lives in the renderer and reflects the documents the editor is holding, unsaved
     * edits included. The main-process preflight computes from disk and has no route to it - it
     * could only rebuild a second index that would answer a different question about a different
     * copy of the project.
     */
    private refuseOnTrimCoverageGaps(
        startedAt: number,
        platforms: GameBuildPlatform[],
        variant: string,
    ): GameBuildStateSnapshot | null {
        let gaps: readonly ReferenceIndexGap[];
        try {
            gaps = this.getContext().services.get<ReferenceService>(Services.Reference).getIndexResult().gaps;
        } catch (error) {
            // A service this build cannot reach is Studio malfunctioning rather than the project
            // being wrong, and the same bargain the media gate makes applies: a gate with no way
            // past it that fails closed on its own defect leaves a project unbuildable.
            console.error("[Build] the reference index could not be consulted for the content check", error);
            return null;
        }
        const touching = gaps.filter(gap => !gap.slice || gap.slice === "story" || gap.slice === "storyAnimation");
        if (touching.length === 0) {
            return null;
        }

        const consoleService = this.tryGetConsole();
        for (const gap of touching) {
            consoleService?.log(BUILD_CONSOLE_CHANNEL, "error", translate("build.contentCoverageGap", {
                // A gap with no site is the index itself; it has no location to name, and the
                // sentence has to read as one either way.
                location: gap.location ?? translate("build.contentCoverageWholeProject"),
                variant,
            }), { source: BUILD_CONSOLE_SOURCE });
        }
        const refusal = translateN("build.contentCoverageSummary", touching.length, {
            count: touching.length,
            variant,
        });
        consoleService?.log(BUILD_CONSOLE_CHANNEL, "error", refusal, { source: BUILD_CONSOLE_SOURCE });
        this.updateState({ status: "error", startedAt, finishedAt: Date.now(), platforms, error: refusal });
        return this.state;
    }

    /** Every story in the project, in library order. The three sweeps before this one cached them. */
    private async loadAllStories(): Promise<ReleaseContentStory[]> {
        const story = this.getContext().services.get<StoryService>(Services.Story);
        const loaded: ReleaseContentStory[] = [];
        for (const entry of story.getLibraryIndex().stories) {
            try {
                loaded.push({ id: entry.id, name: entry.name, document: await story.loadStory(entry.id) });
            } catch (error) {
                // A story that will not load is the packer's problem to report, not ours to mask -
                // the same reading the three sweeps above take of the same failure.
                console.error(`[Build] could not read story ${entry.id} for the content check`, error);
            }
        }
        return loaded;
    }

    /**
     * The blueprints this gate can read.
     *
     * The project's own document only. A blueprint kept as a shared asset is not here, which is the
     * same reach every blueprint lint rule has - they all read `ctx.blueprintDocument` - and the
     * packer still refuses one it cannot read, so a script blueprint hiding in an asset costs a whole
     * story rather than a wrong package.
     */
    private listProjectBlueprints(): Blueprint[] {
        const services = this.getContext().services;
        try {
            const document = services.get<UIGraphService>(Services.UIGraph).getDocument().blueprintDocument;
            return Object.values(document?.blueprints ?? {});
        } catch (error) {
            console.error("[Build] could not read the blueprint document for the content check", error);
            return [];
        }
    }

    /** The enabled plugins with a runtime entry - the ones whose code ships inside the game. */
    private async listShippingPlugins(): Promise<ReleaseContentPlugin[]> {
        const result = await getInterface().plugins.list();
        if (!result.success) {
            return [];
        }
        return result.data.plugins
            .filter(plugin => plugin.enabled && plugin.manifest.entries?.runtime)
            .map(plugin => ({
                id: plugin.manifest.id,
                name: plugin.manifest.name ?? plugin.manifest.id,
                runtimeCapabilities: plugin.manifest.contributes.runtimeCapabilities ?? [],
            }));
    }

    /**
     * The blueprint variant gate: no build ships a graph that still asks which edition it is.
     *
     * `Get App Tag` has no play-time value. The bundler substitutes the variant's name, folds the
     * comparison it feeds, and deletes the arm this edition does not take - so a graph the fold cannot
     * reduce to a decided branch is not a leak an author might tolerate, it is a graph nothing can
     * compile. Refused in every build including release, the same standing the story-side `AppTag`
     * gate above has and for the same reason.
     *
     * Reads the same module the bundler removes with (`@shared/blueprint/appTagGraphFold`), never a
     * second implementation: a refusal and a removal that judged different graphs would be exactly the
     * failure both exist to prevent.
     *
     * ## Why this covers less than the removal does, on purpose
     *
     * The blueprint document only. **Shared blueprint assets are not judged here and that is not an
     * oversight** - they are asset files, and nothing in the renderer enumerates and parses them
     * (`BlueprintService.readLocalBlueprint` takes one path at a time and there is no "list them all"
     * helper). The bundle assembler already has them parsed, so it folds them and throws on a refusal;
     * see `foldSharedBlueprints`. Removal is therefore a superset of refusal, which is the safe
     * direction: nothing ships unfolded, and the only cost is that a shared-asset problem is reported
     * when the pack is assembled rather than before the build starts. Do not "fix" the asymmetry by
     * narrowing the removal - that would ship a live variant read, which the runtime answers with the
     * release name in every edition.
     *
     * Synchronous, like the network gate below: the blueprint document is already in memory.
     */
    private runAppTagGraphGate(
        startedAt: number,
        platforms: GameBuildPlatform[],
        appTagId: string | undefined,
    ): GameBuildStateSnapshot | null {
        const services = this.getContext().services;
        let document: BlueprintDocument | null;
        try {
            document = services.get<UIGraphService>(Services.UIGraph).getDocument().blueprintDocument;
        } catch (error) {
            // A document that will not load is the packer's problem to report, not this gate's to
            // guess at - the same bargain the network gate makes.
            console.error("[Build] could not read the blueprint document for the variant check", error);
            return null;
        }
        // The name is passed for completeness only. Whether a graph reduces is a property of the
        // graph, so a chain that stops at a text field stops under every variant.
        const tagName = services.get<AppTagService>(Services.AppTags).resolveTag(appTagId).name;
        const refused = collectUnfoldableAppTagGraphs(document, { tagName });
        if (refused.length === 0) {
            return null;
        }

        const consoleService = this.tryGetConsole();
        for (const graph of refused) {
            consoleService?.log(
                BUILD_CONSOLE_CHANNEL,
                "error",
                translate(APP_TAG_GRAPH_MESSAGE_KEYS[graph.reason], {
                    blueprint: graph.blueprintName,
                    graph: graph.graphName,
                }),
                { source: BUILD_CONSOLE_SOURCE },
            );
        }
        const refusal = translateN("build.appTagGraphSummary", refused.length, { count: refused.length });
        consoleService?.log(BUILD_CONSOLE_CHANNEL, "error", refusal, { source: BUILD_CONSOLE_SOURCE });
        // `startedAt` and `platforms` carried through for the reason every gate around it carries
        // them: the dashboard archives a refused run as a finished build.
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
     * The network gate: no build ships a blueprint that asks for a network the project forbids.
     *
     * ## Why this is not left to the lint rule
     *
     * `network/fetch-disallowed` reports the same thing and defaults to `error`, which already
     * refuses the build - through the lint gate below. But that gate is switchable in two ways an
     * author can reach without knowing what they are giving up: `runOnBuild` turns the whole sweep
     * off, and the rule's severity can be set to `warning` or `off` in project settings. Either one
     * would let a build ship graphs that provably cannot run.
     *
     * "Provably" is what puts this in the unconditional class rather than the opinion class. With
     * Allow HTTP off, the shipped game confines the renderer to its own protocol and cancels every
     * HTTP request, and the host refuses the request before it is issued. This is not a judgement
     * about code style that an author may reasonably overrule - it is the same kind of fact as a
     * video the engine cannot decode, and the reasoning in the comment above applies unchanged.
     *
     * ## Every target, including the web export
     *
     * The setting is not enforceable on the web (no CSP, no `webRequest`, and the pack carries no
     * network block at all), so a web build could technically run these nodes. It is still refused:
     * a project that says it does not allow HTTP means that about the game, and letting it through
     * on the one target where the mechanism happens to be missing would ship the opposite of what
     * the setting says. The settings panel states the web caveat so the asymmetry is not a surprise.
     *
     * Synchronous, unlike the two gates around it: the blueprint document is already in memory.
     */
    private runNetworkGate(
        startedAt: number,
        platforms: GameBuildPlatform[],
    ): GameBuildStateSnapshot | null {
        const services = this.getContext().services;
        const projectService = services.get<ProjectService>(Services.Project);
        if (projectService.getNetworkConfiguration().allowHttp) {
            return null;
        }
        let document: BlueprintDocument | null;
        try {
            document = services.get<UIGraphService>(Services.UIGraph).getDocument().blueprintDocument;
        } catch (error) {
            // A document that will not load is the packer's problem to report, not this gate's to
            // guess at. Letting the build go on matches how the invalid-command scan treats a story
            // it cannot read.
            console.error("[Build] could not read the blueprint document for the network check", error);
            return null;
        }
        // The same sweep the lint rule runs, imported rather than reimplemented: two answers to
        // "does this project use the network" would be two chances to disagree, and this is the one
        // that decides whether a build ships.
        const sites = collectBlueprintNetworkNodes(document);
        if (sites.length === 0) {
            return null;
        }

        const consoleService = this.tryGetConsole();
        for (const site of sites) {
            consoleService?.log(
                BUILD_CONSOLE_CHANNEL,
                "error",
                translate("build.networkNodeDisallowed", { blueprint: site.blueprintName }),
                { source: BUILD_CONSOLE_SOURCE },
            );
        }
        const refusal = translateN("build.networkSummary", sites.length, { count: sites.length });
        consoleService?.log(BUILD_CONSOLE_CHANNEL, "error", refusal, { source: BUILD_CONSOLE_SOURCE });
        // `startedAt` and `platforms` carried through for the reason the gates either side carry
        // them: the dashboard archives a refused run as a finished build.
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
     * The media gate: no build ships an asset the engine cannot decode.
     *
     * Returns the refusal snapshot when the build must stop and `null` when it may go on, the same
     * shape as the lint gate below.
     *
     * ## What it refuses
     *
     * Any media asset whose verdict is not `accept`, judged on `(container, codec of every stream)`
     * by `@shared/utils/mediaSupport` - never on the extension, because the same `.mp4` plays when
     * it holds H.264 and is a black rectangle with sound when it holds HEVC. Both the fixable case
     * (there is a conversion) and the hopeless one (nothing playable inside) stop the build: the
     * author is shipping a game with a dead asset in it either way, and the two differ only in what
     * the console tells them to do next.
     *
     * ## What it must never refuse
     *
     * Anything it could not check. ffprobe is absent on some hosts, a probe can time out, and the
     * service reports both by leaving the asset without a record rather than by inventing one. A
     * host with no probe therefore builds exactly as it did before this gate existed, with one line
     * on the console saying the files went unchecked. Refusing on the strength of a question that
     * was never answered would make a machine without the tool unable to build a project it builds
     * fine today - and would do it about files that are very probably correct.
     *
     * The same reasoning covers a scan that throws, which is why this one failure is let through
     * where the lint gate fails closed on its own crash. The difference is the escape hatch: an
     * author whose lint sweep crashes can switch `runOnBuild` off and build anyway, and there is no
     * equivalent switch here by design. A gate with no way past it that fails closed on its own
     * defects can leave a project unbuildable with nothing the author can do, which is a worse
     * outcome than the one the gate exists to prevent.
     */
    private async runMediaGate(
        startedAt: number,
        platforms: GameBuildPlatform[],
    ): Promise<GameBuildStateSnapshot | null> {
        const consoleService = this.tryGetConsole();
        let unplayable: ReturnType<MediaSupportService["listUnplayable"]>;
        let uncheckedCount: number;
        try {
            const media = this.getContext().services.get<MediaSupportService>(Services.MediaSupport);
            const scan = await media.scan();
            unplayable = media.listUnplayable();
            uncheckedCount = scan.unanswered.length;
        } catch (error) {
            // Untranslated, like the flush failure above: this reports Studio malfunctioning, not
            // something the project did.
            console.error("[Build] the media check failed to run", error);
            consoleService?.log(BUILD_CONSOLE_CHANNEL, "warning", "The media check failed to run", {
                source: BUILD_CONSOLE_SOURCE,
            });
            return null;
        }

        if (uncheckedCount > 0) {
            // Said at `info` rather than `verbose` because the console hides verbose by default, and
            // an author on a host with no converter is entitled to know the check did not happen -
            // otherwise a silent pass reads as a clean bill of health.
            consoleService?.log(
                BUILD_CONSOLE_CHANNEL,
                "info",
                translateN("build.mediaUnchecked", uncheckedCount, { count: uncheckedCount }),
                { source: BUILD_CONSOLE_SOURCE },
            );
        }

        if (unplayable.length === 0) {
            return null;
        }

        for (const { asset, record } of unplayable) {
            consoleService?.log(
                BUILD_CONSOLE_CHANNEL,
                "error",
                translate(
                    record.state === "convertible" ? "build.mediaNeedsConverting" : "build.mediaNotPlayable",
                    { asset: asset.name },
                ),
                { source: BUILD_CONSOLE_SOURCE },
            );
        }

        const refusal = translateN("build.mediaSummary", unplayable.length, { count: unplayable.length });
        consoleService?.log(BUILD_CONSOLE_CHANNEL, "error", refusal, { source: BUILD_CONSOLE_SOURCE });
        // `startedAt` and `platforms` carried through for the reason the gates either side carry
        // them: the dashboard archives a refused run as a finished build.
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
