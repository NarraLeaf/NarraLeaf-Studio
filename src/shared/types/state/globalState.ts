/**
 * Global state type definitions
 * Defines the structure and types for all global state keys
 */

import { ObjectPaths } from "../persistentState";

/**
 * Global state structure definition
 * This defines the complete structure of the global state
 */
export interface GlobalStateStructure {
    app: {
        showHint: boolean;
    };
}

/**
 * All possible global state keys derived from the structure
 */
export type GlobalStateKeys = ObjectPaths<GlobalStateStructure>;

/**
 * Global state type mapping
 * Maps each key path to its corresponding value type
 */
export type GlobalStateType = {
    [K in GlobalStateKeys]: K extends ObjectPaths<GlobalStateStructure>
        ? import("../persistentState").ObjectPathValue<GlobalStateStructure, K>
        : never;
};

/**
 * Helper type to get the type of a specific global state key
 */
export type GlobalStateValue<K extends GlobalStateKeys> = GlobalStateType[K];

/**
 * Default values for global state
 */
export const GLOBAL_STATE_DEFAULTS: Partial<GlobalStateType> = {
    "app.showHint": true,
};
