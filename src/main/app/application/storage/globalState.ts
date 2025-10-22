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
        const dbPath = path.join(userDataDir, UserDataNamespace.State, "global.config");
        const config: PersistentStateConfig = {
            dbPath,
            defaults: GLOBAL_STATE_DEFAULTS
        };

        this.state = new PersistentState(config);
    }

    /**
     * Get a value from global state.
     *
     * Throws an error if the key is not found and `assert` is true
     */
    public get<K extends GlobalStateKeys>(key: K, assert: boolean = false): GlobalStateValue<K> {
        return this.state.getItem<GlobalStateValue<K>>(key, assert);
    }

    /**
     * Set a value in global state
     */
    public set<K extends GlobalStateKeys>(key: K, value: GlobalStateValue<K>): void {
        return this.state.setItem(key, value);
    }

    /**
     * Get all keys
     */
    public getAllKeys(): string[] {
        return this.state.keys();
    }
}
