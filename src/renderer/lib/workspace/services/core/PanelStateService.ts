import type { StudioStateStoreNamespace } from "@shared/vcs/serviceStores";
import { Service } from "../Service";
import { Services, WorkspaceContext } from "../services";
import { ServiceAssetsService } from "./ServiceAssetsService";
import { storeWrite } from "../autosave/writeReport";
import { UIService } from "./UIService";

type PanelStateStore = {
    version: 1;
    panels: Record<string, Record<string, any>>;
};

export class PanelStateService extends Service<PanelStateService> {
    // Typed against the classification table so a rename cannot quietly drop this store
    // back into the versioned tree; it lands in `.nlstudio/services/` instead.
    private static readonly Namespace: StudioStateStoreNamespace = "panel_state";
    private store: PanelStateStore = { version: 1, panels: {} };
    private dirty = false;
    private saveTimer: ReturnType<typeof setTimeout> | null = null;
    private writeQueue: Promise<void> = Promise.resolve();

    protected async init(ctx: WorkspaceContext, depend: (services: Service[]) => Promise<void>): Promise<void> {
        const serviceAssets = ctx.services.get<ServiceAssetsService>(Services.ServiceAssets);
        const uiService = ctx.services.get<UIService>(Services.UI);
        await depend([serviceAssets, uiService]);

        await this.loadStore();
    }

    public getPanelState<T extends Record<string, any>>(panelId: string): T | undefined {
        return this.store.panels[panelId] as T | undefined;
    }

    public setPanelState<T extends Record<string, any>>(panelId: string, partial: Partial<T>): void {
        const current = this.store.panels[panelId] ?? {};
        this.store.panels[panelId] = {
            ...current,
            ...partial,
        };
        this.markDirty();
    }

    public replacePanelState<T extends Record<string, any>>(panelId: string, next: T): void {
        this.store.panels[panelId] = { ...next };
        this.markDirty();
    }

    public override async dispose(_ctx: WorkspaceContext): Promise<void> {
        if (this.saveTimer) {
            clearTimeout(this.saveTimer);
            this.saveTimer = null;
        }
        try {
            await this.flush();
        } finally {
            this.store = { version: 1, panels: {} };
            this.dirty = false;
            this.writeQueue = Promise.resolve();
        }
    }

    private markDirty(): void {
        this.dirty = true;
        if (this.saveTimer) {
            return;
        }
        this.saveTimer = setTimeout(() => {
            this.saveTimer = null;
            void this.flush();
        }, 300);
    }

    private async loadStore(): Promise<void> {
        const store = await this.getServiceAssets().readStore<PanelStateStore>(PanelStateService.Namespace);
        if (!store.ok || !store.data) {
            return;
        }
        if (!store.data.version || store.data.version !== 1) {
            return;
        }
        this.store = {
            version: 1,
            panels: { ...store.data.panels },
        };
    }

    private flush(): Promise<void> {
        if (!this.dirty) return this.writeQueue;
        this.dirty = false;
        const serviceAssets = this.getServiceAssets();
        const data: PanelStateStore = { version: 1, panels: { ...this.store.panels } };
        // A failure is not retried - `dirty` is already clear - and is reported by the save-status
        // surface as the panel layout not being saved. Nothing here repeats it: the filesystem's
        // own message is English whatever the interface speaks, and names the store's file.
        const write = this.writeQueue.catch(() => undefined).then(async () => {
            await serviceAssets.writeStore(
                PanelStateService.Namespace,
                data,
                storeWrite("workspace.shell.save.stores.panelLayout", "notRetried"),
            );
        });
        this.writeQueue = write;
        return write;
    }

    private getServiceAssets(): ServiceAssetsService {
        return this.getContext().services.get<ServiceAssetsService>(Services.ServiceAssets);
    }
}
