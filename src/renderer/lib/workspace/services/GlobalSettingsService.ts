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
    private readonly keyListeners = new Map<string, Set<(value: unknown) => void>>();

    protected async init(_ctx: WorkspaceContext): Promise<void> {
        const result = throwException(await getInterface().app.state.getAllGlobalState());
        this.cache = result.settings;

        // The cache is seeded once, but the Settings window is a separate window writing to the
        // same store - without this, a preference changed there stays stale here for the lifetime
        // of the workspace, and `get` would keep serving the value from before the change.
        this.changeToken = getInterface().app.state.onGlobalStateChanged?.(change => {
            this.cache[change.key] = change.value;
            // Iterated over a copy: a listener may unsubscribe from inside its own callback.
            for (const listener of [...(this.keyListeners.get(change.key) ?? [])]) {
                listener(change.value);
            }
        }) ?? null;
    }

    override dispose(_ctx: WorkspaceContext): void {
        this.changeToken?.cancel();
        this.changeToken = null;
        this.cache = {};
        this.keyListeners.clear();
    }

    /**
     * Follow one key as it changes in any window - this one, another workspace, or Settings - as the
     * main process broadcasts it. A reset arrives as `undefined`, so the listener resolves the
     * default itself, the same as every other reader of an unset key.
     */
    onChange(key: string, listener: (value: unknown) => void): () => void {
        let listeners = this.keyListeners.get(key);
        if (!listeners) {
            listeners = new Set();
            this.keyListeners.set(key, listeners);
        }
        listeners.add(listener);
        return () => {
            this.keyListeners.get(key)?.delete(listener);
        };
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
