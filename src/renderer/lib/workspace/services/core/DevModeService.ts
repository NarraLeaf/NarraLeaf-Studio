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
        if (this.refreshInFlight) {
            return this.status;
        }
        this.refreshInFlight = true;
        try {
            const result = await getInterface().devMode.getStatus();
            if (result.success) {
                this.updateStatus(result.data.status);
            }
        } finally {
            this.refreshInFlight = false;
        }
        return this.status;
    }

    public async launch(entry: DevModeEntry, projectPath?: string): Promise<DevModeStatus> {
        try {
            await this.prepareProjectForPreview();
        } catch (error) {
            console.error("[DevMode] failed to prepare project before launch", error);
            this.updateStatus("error");
            return this.status;
        }
        const path = projectPath ?? this.getContext().project.getConfig().projectPath;
        const result = await getInterface().devMode.launch(path, entry);
        if (result.success) {
            this.updateStatus(result.data.status);
        } else {
            this.updateStatus("error");
        }
        return this.status;
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

    public async stop(): Promise<DevModeStatus> {
        const result = await getInterface().devMode.stop();
        if (result.success) {
            this.updateStatus(result.data.status);
        }
        return this.status;
    }

    public async reload(): Promise<DevModeStatus> {
        const result = await getInterface().devMode.reload();
        if (result.success) {
            this.updateStatus(result.data.status);
        } else {
            this.updateStatus("error");
        }
        return this.status;
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
