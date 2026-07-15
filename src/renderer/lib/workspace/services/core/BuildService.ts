import { Service } from "../Service";
import { Services, type WorkspaceContext } from "../services";
import { getInterface } from "@/lib/app/bridge";
import { MAIN_APP_SURFACE_ID } from "@shared/constants/ui-editor";
import type {
    BuildPreflightFinding,
    BuildPreflightSection,
    GameBuildRequest,
    GameBuildStateSnapshot,
    GameBuildStatus,
} from "@shared/types/gameBuild";
import { EventEmitter } from "../ui/EventEmitter";
import { ConsoleService } from "./ConsoleService";
import { CharacterService } from "./CharacterService";
import { StoryService } from "../story/StoryService";
import { UIDocumentService } from "../ui-editor/UIDocumentService";
import { UIGraphService } from "../ui-editor/UIGraphService";

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
const BUILD_CONSOLE_CHANNEL = "build";

/**
 * The pipeline reports only coarse phases (preparing → compiling → packaging), and the
 * longest phase — electron-builder packaging — is fully opaque: there is no real
 * fraction to show. Rather than fake a fill level that creeps upward (which is a lie
 * about how far along the build is), the bar runs as an indeterminate animation while a
 * build is active. It snaps to a solid 100% only on real completion.
 */
const BUILD_ACTIVE_STATUSES: readonly GameBuildStatus[] = ["preparing", "compiling", "packaging"];

/** How long the full bar lingers after a successful build before it clears. */
const BUILD_DONE_LINGER_MS = 1400;

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
     * Deliberately memory-only and never persisted — only starting a build
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
        try {
            await this.prepareProjectForBuild();
        } catch (error) {
            console.error("[Build] failed to flush editor state before build", error);
            this.updateState({ status: "error", error: "Failed to save the project before building" });
            return this.state;
        }
        // Committed: the selection is now persisted as BuildConfiguration, so
        // the draft has served its purpose and must not shadow it next time.
        this.clearDraft();
        this.updateState({ status: "preparing", startedAt: Date.now() });
        const result = await getInterface().gameBuild.start(this.projectPath(), {
            kind: "surface",
            surfaceId: MAIN_APP_SURFACE_ID,
        }, request);
        if (result.success) {
            this.updateState(result.data.state);
        } else {
            this.updateState({ status: "error", error: result.error });
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
            // Solid full-width warning bar — the colour signals failure (the console
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

/** Compare the snapshot fields the UI renders, ignoring per-poll object identity. */
function isSameSnapshot(a: GameBuildStateSnapshot, b: GameBuildStateSnapshot): boolean {
    return a.status === b.status
        && a.error === b.error
        && a.outputDir === b.outputDir
        && (a.artifacts?.length ?? 0) === (b.artifacts?.length ?? 0);
}
