import { Service } from "../Service";
import { Services, WorkspaceContext } from "../services";
import { ServiceAssetsService } from "./ServiceAssetsService";
import { UIService } from "./UIService";

const MAX_RECENT_COLORS = 16;

type RecentColorsStore = {
    version: 1;
    colors: string[];
};

/** Trim, drop blanks, de-duplicate case-insensitively (most-recent first), and cap the list. */
function normalize(colors: readonly string[]): string[] {
    const seen = new Set<string>();
    const out: string[] = [];
    for (const raw of colors) {
        const value = typeof raw === "string" ? raw.trim() : "";
        if (!value) {
            continue;
        }
        const key = value.toLowerCase();
        if (seen.has(key)) {
            continue;
        }
        seen.add(key);
        out.push(value);
        if (out.length >= MAX_RECENT_COLORS) {
            break;
        }
    }
    return out;
}

function sameOrder(a: readonly string[], b: readonly string[]): boolean {
    return a.length === b.length && a.every((value, index) => value === b[index]);
}

/**
 * Per-project list of recently used colors (most-recent first, de-duplicated, capped), persisted to
 * `editor/services/recent_colors.json` so the palette history travels with the project and resets
 * when switching projects. Backs the {@link useRecentColors} / {@link addRecentColor} module in the
 * properties framework (which proxies to this singleton).
 */
export class RecentColorsService extends Service<RecentColorsService> {
    private static readonly Namespace = "recent_colors";
    private colors: string[] = [];
    private readonly listeners = new Set<() => void>();
    private ready = false;
    private dirty = false;
    private saveTimer: ReturnType<typeof setTimeout> | null = null;

    protected async init(ctx: WorkspaceContext, depend: (services: Service[]) => Promise<void>): Promise<void> {
        const serviceAssets = ctx.services.get<ServiceAssetsService>(Services.ServiceAssets);
        const uiService = ctx.services.get<UIService>(Services.UI);
        await depend([serviceAssets, uiService]);

        await this.loadStore();
        this.ready = true;
        this.dirty = false;
    }

    /** Stable snapshot for {@link useSyncExternalStore}; reference only changes when the list does. */
    public getColors(): string[] {
        return this.colors;
    }

    public addColor(color: string): void {
        const value = color.trim();
        if (!value) {
            return;
        }
        const next = normalize([value, ...this.colors]);
        if (sameOrder(next, this.colors)) {
            return;
        }
        this.colors = next;
        this.markDirty();
        this.emitChange();
    }

    public subscribe(listener: () => void): () => void {
        this.listeners.add(listener);
        return () => {
            this.listeners.delete(listener);
        };
    }

    public override dispose(_ctx: WorkspaceContext): void {
        if (this.saveTimer) {
            clearTimeout(this.saveTimer);
            this.saveTimer = null;
        }
        // flush() captures the current colors synchronously before the reset below.
        void this.flush();
        this.ready = false;
        this.colors = [];
        this.emitChange();
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

    private emitChange(): void {
        for (const listener of this.listeners) {
            listener();
        }
    }

    private async loadStore(): Promise<void> {
        const store = await this.getServiceAssets().readStore<RecentColorsStore>(RecentColorsService.Namespace);
        if (!store.ok || !store.data) {
            return;
        }
        if (store.data.version !== 1 || !Array.isArray(store.data.colors)) {
            return;
        }
        this.colors = normalize(store.data.colors);
        this.emitChange();
    }

    private async flush(): Promise<void> {
        if (!this.dirty || !this.ready) {
            return;
        }
        this.dirty = false;
        const serviceAssets = this.getServiceAssets();
        const uiService = this.getContext().services.get<UIService>(Services.UI);
        const data: RecentColorsStore = { version: 1, colors: this.colors };
        const result = await serviceAssets.writeStore(RecentColorsService.Namespace, data);
        if (!result.ok) {
            uiService.showError(`Failed to persist recent colors: ${result.error.message}`);
        }
    }

    private getServiceAssets(): ServiceAssetsService {
        return this.getContext().services.get<ServiceAssetsService>(Services.ServiceAssets);
    }
}
