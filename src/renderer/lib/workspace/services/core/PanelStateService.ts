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

const DEFAULT_STORE: PanelStateStore = {
    version: 1,
    panels: {},
};

export class PanelStateService extends Service<PanelStateService> {
    // Typed against the classification table so a rename cannot quietly drop this store
    // back into the versioned tree; it lands in `.nlstudio/services/` instead.
    private static readonly Namespace: StudioStateStoreNamespace = "panel_state";
    private store: PanelStateStore = { ...DEFAULT_STORE };
    private dirty = false;
    private saveTimer: ReturnType<typeof setTimeout> | null = null;

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

    public override dispose(_ctx: WorkspaceContext): void {
        if (this.saveTimer) {
            clearTimeout(this.saveTimer);
            this.saveTimer = null;
        }
        void this.flush();
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

    private async flush(): Promise<void> {
        if (!this.dirty) return;
        this.dirty = false;
        // A failure is not retried - `dirty` is already clear - and is reported by the save-status
        // surface as the panel layout not being saved. Nothing here repeats it: the filesystem's
        // own message is English whatever the interface speaks, and names the store's file.
        await this.getServiceAssets().writeStore(
            PanelStateService.Namespace,
            this.store,
            storeWrite("workspace.shell.save.stores.panelLayout", "notRetried"),
        );
    }

    private getServiceAssets(): ServiceAssetsService {
        return this.getContext().services.get<ServiceAssetsService>(Services.ServiceAssets);
    }
}
