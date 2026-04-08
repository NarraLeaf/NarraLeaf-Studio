import { Service } from "../Service";
import type { WorkspaceContext } from "../services";
import { getInterface } from "@/lib/app/bridge";
import type { DevModeEntry, DevModeStatus } from "@shared/types/devMode";
import { EventEmitter } from "../ui/EventEmitter";

type DevModeServiceEvents = {
    statusChanged: DevModeStatus;
};

export class DevModeService extends Service<DevModeService> {
    private status: DevModeStatus = "idle";
    private timer: ReturnType<typeof setInterval> | null = null;
    private readonly events = new EventEmitter<DevModeServiceEvents>();

    protected async init(_ctx: WorkspaceContext): Promise<void> {
        return;
    }

    public override activate(_ctx: WorkspaceContext): void {
        this.startPolling();
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
        const result = await getInterface().devMode.getStatus();
        if (result.success) {
            this.updateStatus(result.data.status);
        }
        return this.status;
    }

    public async launch(entry: DevModeEntry, projectPath?: string): Promise<DevModeStatus> {
        const path = projectPath ?? this.getContext().project.getConfig().projectPath;
        const result = await getInterface().devMode.launch(path, entry);
        if (result.success) {
            this.updateStatus(result.data.status);
        } else {
            this.updateStatus("error");
        }
        return this.status;
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
        if (this.status === nextStatus) {
            return;
        }
        this.status = nextStatus;
        this.events.emit("statusChanged", nextStatus);
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
