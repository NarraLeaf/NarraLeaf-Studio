import { Service } from "../Service";
import { Services, type WorkspaceContext } from "../services";
import { getInterface } from "@/lib/app/bridge";
import { MAIN_APP_SURFACE_ID } from "@shared/constants/ui-editor";
import type { GameBuildRequest, GameBuildStateSnapshot, GameBuildStatus } from "@shared/types/gameBuild";
import { EventEmitter } from "../ui/EventEmitter";
import { CharacterService } from "./CharacterService";
import { StoryService } from "../story/StoryService";
import { UIDocumentService } from "../ui-editor/UIDocumentService";
import { UIGraphService } from "../ui-editor/UIGraphService";

type BuildServiceEvents = {
    stateChanged: GameBuildStateSnapshot;
};

const IDLE_STATE: GameBuildStateSnapshot = { status: "idle" };

/**
 * Renderer-side view of the production build. Mirrors PreviewService: it holds
 * the last snapshot, polls the main process while a build is active, and lets
 * the toolbar/dialog react to status changes. The heavy lifting (compile +
 * electron-builder) lives in the main-process GameBuildManager.
 */
export class BuildService extends Service<BuildService> {
    private state: GameBuildStateSnapshot = IDLE_STATE;
    private timer: ReturnType<typeof setInterval> | null = null;
    private refreshInFlight = false;
    private readonly events = new EventEmitter<BuildServiceEvents>();

    protected async init(_ctx: WorkspaceContext): Promise<void> {
        return;
    }

    public override activate(_ctx: WorkspaceContext): void {
        void this.refreshState();
    }

    public override dispose(_ctx: WorkspaceContext): void {
        this.stopPolling();
        this.events.clear();
    }

    public getState(): GameBuildStateSnapshot {
        return this.state;
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
        // Polling returns a fresh snapshot object every second; only notify
        // subscribers when something they render actually changed, so a
        // minutes-long packaging phase does not re-render the toolbar each tick.
        if (isSameSnapshot(previous, next)) {
            return;
        }
        this.events.emit("stateChanged", next);
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
