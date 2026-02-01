import { Service } from "../Service";
import { IServiceAssetsService, Services, WorkspaceContext } from "../services";
import { ServiceAssetsService } from "./ServiceAssetsService";
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
    private static readonly Namespace = "panel_state";
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
        const result = await this.getServiceAssets().writeStore(PanelStateService.Namespace, this.store);
        if (!result.ok) {
            const uiService = this.getContext().services.get<UIService>(Services.UI);
            uiService.showError("Failed to persist panel state: " + result.error);
        }
    }

    private getServiceAssets(): ServiceAssetsService {
        return this.getContext().services.get<ServiceAssetsService>(Services.ServiceAssets);
    }
}
