import { PersistentState } from "./persistentState";
import { PersistentStateConfig } from "@shared/types/persistentState";
import { UserDataNamespace } from "@shared/types/constants";
import path from "path";
import {
    GLOBAL_STATE_DEFAULTS,
    GlobalStateKeys,
    GlobalStateValue
} from "@shared/types/state/globalState";

/**
 * Type-safe global state manager
 */
export class GlobalStateManager {
    private state: PersistentState;

    constructor(userDataDir: string) {
        const dbPath = path.join(userDataDir, UserDataNamespace.State, "global.db");
        const config: PersistentStateConfig = {
            dbPath,
            tableName: 'key_value_store'
        };

        this.state = new PersistentState(config);
    }

    /**
     * Wait for initialization to complete
     */
    public async ready(): Promise<void> {
        await this.state.ready();
    }

    /**
     * Get a value from global state.
     *
     * Automatically falls back to {@link GLOBAL_STATE_DEFAULTS} when the key is undefined.
     */
    public async get<K extends GlobalStateKeys>(key: K): Promise<GlobalStateValue<K> | undefined> {
        // Prefer stored value
        const stored = await this.state.getItem<GlobalStateValue<K>>(key);

        if (stored !== undefined) {
            return stored;
        }

        // Fallback to compile-time defaults (if any)
        return (GLOBAL_STATE_DEFAULTS as Partial<Record<K, GlobalStateValue<K>>>)[key];
    }

    /**
     * Set a value in global state
     */
    public async set<K extends GlobalStateKeys>(key: K, value: GlobalStateValue<K>): Promise<void> {
        return this.state.setItem(key, value);
    }

    /**
     * Get all keys
     */
    public async getAllKeys(): Promise<GlobalStateKeys[]> {
        return this.state.keys() as Promise<GlobalStateKeys[]>;
    }

    /**
     * Clear all global state
     */
    public async clear(): Promise<void> {
        return this.state.clear();
    }

    /**
     * Check if database is ready
     */
    public isReady(): boolean {
        return this.state.isReady();
    }

    /**
     * Close the global state
     */
    public close(): void {
        this.state.close();
    }
}

/**
 * Create a global state manager instance
 */
export function createGlobalStateManager(userDataDir: string): GlobalStateManager {
    return new GlobalStateManager(userDataDir);
}
