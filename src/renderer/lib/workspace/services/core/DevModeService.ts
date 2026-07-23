import { Service } from "../Service";
import { Services, type WorkspaceContext } from "../services";
import { getInterface } from "@/lib/app/bridge";
import type { DevModeEntry, DevModeStatus } from "@shared/types/devMode";
import { EventEmitter } from "../ui/EventEmitter";
import { CharacterService } from "./CharacterService";
import { StoryService } from "../story/StoryService";
import { UIDocumentService } from "../ui-editor/UIDocumentService";
import { UIGraphService } from "../ui-editor/UIGraphService";

type DevModeServiceEvents = {
    statusChanged: DevModeStatus;
};

export class DevModeService extends Service<DevModeService> {
    private status: DevModeStatus = "idle";
    private timer: ReturnType<typeof setInterval> | null = null;
    private refreshInFlight = false;
    // True from the click until the launch IPC resolves. While set, the status poll is suppressed so
    // it cannot momentarily revert the optimistic "starting" back to "idle" before the main process
    // has registered the launch.
    private launchInFlight = false;
    private readonly events = new EventEmitter<DevModeServiceEvents>();

    protected async init(_ctx: WorkspaceContext): Promise<void> {
        return;
    }

    public override activate(_ctx: WorkspaceContext): void {
        void this.refreshStatus();
    }

    public override dispose(_ctx: WorkspaceContext): void {
        this.stopPolling();
        this.events.clear();
    }

    public getStatus(): DevModeStatus {
        return this.status;
    }

    public onStatusChanged(handler: (status: DevModeStatus) => void): () => void {
        return this.events.on("statusChanged", handler);
    }

    public async refreshStatus(): Promise<DevModeStatus> {
        if (this.refreshInFlight || this.launchInFlight) {
            return this.status;
        }
        this.refreshInFlight = true;
        try {
            const result = await getInterface().devMode.getStatus(this.projectPath());
            if (result.success) {
                this.updateStatus(result.data.status);
            }
        } finally {
            this.refreshInFlight = false;
        }
        return this.status;
    }

    public async launch(entry: DevModeEntry, projectPath?: string): Promise<DevModeStatus> {
        this.launchInFlight = true;
        // Flip to a running state up front so the toolbar Run button and the status bar react the
        // instant the user clicks — not after the flush and compile the launch entails.
        this.updateStatus("starting");
        try {
            try {
                await this.prepareProjectForPreview();
            } catch (error) {
                console.error("[DevMode] failed to prepare project before launch", error);
                this.updateStatus("error");
                return this.status;
            }
            const path = projectPath ?? this.projectPath();
            const result = await getInterface().devMode.launch(path, entry);
            if (result.success) {
                this.updateStatus(result.data.status);
            } else {
                this.updateStatus("error");
            }
            return this.status;
        } finally {
            this.launchInFlight = false;
        }
    }

    private async prepareProjectForPreview(): Promise<void> {
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
        await story.flushPendingChanges();
        await character.flushPendingChanges();
    }

    public async stop(projectPath?: string): Promise<DevModeStatus> {
        const result = await getInterface().devMode.stop(projectPath ?? this.projectPath());
        if (result.success) {
            this.updateStatus(result.data.status);
        }
        return this.status;
    }

    public async reload(projectPath?: string): Promise<DevModeStatus> {
        const result = await getInterface().devMode.reload(projectPath ?? this.projectPath());
        if (result.success) {
            this.updateStatus(result.data.status);
        } else {
            this.updateStatus("error");
        }
        return this.status;
    }

    /** This window's project - every Dev Mode call is scoped to it, never to "whatever is running". */
    private projectPath(): string {
        return this.getContext().project.getConfig().projectPath;
    }

    private updateStatus(nextStatus: DevModeStatus): void {
        this.syncPolling(nextStatus);
        if (this.status === nextStatus) {
            return;
        }
        this.status = nextStatus;
        this.events.emit("statusChanged", nextStatus);
    }

    private syncPolling(status: DevModeStatus): void {
        if (this.shouldPoll(status)) {
            this.startPolling();
        } else {
            this.stopPolling();
        }
    }

    private shouldPoll(status: DevModeStatus): boolean {
        return status !== "idle" && status !== "error";
    }

    private startPolling(): void {
        if (this.timer) {
            return;
        }
        this.timer = setInterval(() => {
            void this.refreshStatus();
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
