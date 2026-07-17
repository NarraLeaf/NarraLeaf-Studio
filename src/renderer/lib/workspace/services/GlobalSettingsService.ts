import { throwException } from "@shared/utils/error";
import { getInterface } from "@/lib/app/bridge";
import type { AppEventToken } from "@shared/types/app";
import { WorkspaceContext } from "./services";
import { Service } from "./Service";

/**
 * Studio-wide settings backed by Electron userData/state/global.json.
 */
export class GlobalSettingsService extends Service<GlobalSettingsService> {
    private cache: Record<string, any> = {};
    private changeToken: AppEventToken | null = null;

    protected async init(_ctx: WorkspaceContext): Promise<void> {
        const result = throwException(await getInterface().app.state.getAllGlobalState());
        this.cache = result.settings;

        // The cache is seeded once, but the Settings window is a separate window writing to the
        // same store — without this, a preference changed there stays stale here for the lifetime
        // of the workspace, and `get` would keep serving the value from before the change.
        this.changeToken = getInterface().app.state.onGlobalStateChanged?.(change => {
            this.cache[change.key] = change.value;
        }) ?? null;
    }

    override dispose(_ctx: WorkspaceContext): void {
        this.changeToken?.cancel();
        this.changeToken = null;
        this.cache = {};
    }

    async get<T = any>(key: string, defaultValue?: T): Promise<T | undefined> {
        if (key in this.cache) {
            return this.cache[key] as T;
        }

        const result = await getInterface().app.state.getGlobalState(key);
        if (result.success && result.data.value !== undefined) {
            this.cache[key] = result.data.value;
            return result.data.value as T;
        }

        return defaultValue;
    }

    async set<T = any>(key: string, value: T): Promise<void> {
        this.cache[key] = value;
        throwException(await getInterface().app.state.setGlobalState(key, value));
    }

    async setBatch(settings: Record<string, any>): Promise<void> {
        Object.assign(this.cache, settings);
        await Promise.all(
            Object.entries(settings).map(async ([key, value]) => {
                throwException(await getInterface().app.state.setGlobalState(key, value));
            }),
        );
    }

    getAll(): Record<string, any> {
        return { ...this.cache };
    }

    has(key: string): boolean {
        return key in this.cache;
    }

    getSync<T = any>(key: string, defaultValue?: T): T | undefined {
        if (key in this.cache) {
            return this.cache[key] as T;
        }
        return defaultValue;
    }
}
