import { UserDataNamespace } from "@shared/types/constants";
import { PersistentStateConfig } from "@shared/types/persistentState";
import {
    GLOBAL_STATE_DEFAULTS,
    GlobalStateKeys,
    GlobalStateType,
    GlobalStateValue
} from "@shared/types/state/globalState";
import path from "path";
import { PersistentState } from "./persistentState";
import { RecentlyOpened } from "./recentlyOpened";

export class GlobalStateManager {
    private state: PersistentState<GlobalStateType>;

    public recentlyOpened: RecentlyOpened;

    constructor(userDataDir: string) {
        const dbPath = path.join(userDataDir, UserDataNamespace.State, "global.config");
        const config: PersistentStateConfig<GlobalStateType> = {
            dbPath,
            defaults: GLOBAL_STATE_DEFAULTS as GlobalStateType
        };

        this.state = new PersistentState<GlobalStateType>(config);
        this.recentlyOpened = new RecentlyOpened(this.state);
    }

    /**
     * Get a value from global state.
     *
     * Throws an error if the key is not found and `assert` is true
     */
    public get<K extends GlobalStateKeys>(key: K, assert: boolean = false): GlobalStateValue<K> {
        return this.state.getItem<K>(key, assert);
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

    /**
     * Get all data
     */
    public raw(): GlobalStateType {
        return this.state.raw();
    }
}
