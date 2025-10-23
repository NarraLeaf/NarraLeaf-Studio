import { PersistentState } from "@/app/application/managers/storage/persistentState";
import { ObjectPaths } from "../persistentState";
import { RecentlyOpenedProject } from "./appStateTypes";

export interface GlobalStateStructure {
    app: {
        showHint: boolean;
        recentProjects: RecentlyOpenedProject[];
    };
}

export type GlobalStateKeys = ObjectPaths<GlobalStateStructure>;
export type GlobalStateType = {
    [K in GlobalStateKeys]: K extends ObjectPaths<GlobalStateStructure>
        ? import("../persistentState").ObjectPathValue<GlobalStateStructure, K>
        : never;
};
export type GlobalStateValue<K extends GlobalStateKeys> = GlobalStateType[K];
export type GlobalState = PersistentState<GlobalStateType>;

/**
 * Default values for global state
 */
export const GLOBAL_STATE_DEFAULTS: Partial<GlobalStateType> = {
    "app.showHint": true,
    "app.recentProjects": [],
};
