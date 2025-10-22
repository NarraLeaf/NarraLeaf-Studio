/**
 * Typed data structure for persistent storage
 */
export interface StoredValue {
    type: 'string' | 'number' | 'boolean' | 'object' | 'null';
    data: any;
}

/**
 * Persistent state storage interface
 * Uses SQLite for key-value data storage with type safety
 */
export interface IPersistentState {
    /**
     * Get item from storage with type safety
     */
    getItem<T>(key: string): T;

    /**
     * Get item from storage with default value
     */
    getItem<T>(key: string, assert: boolean): T;

    /**
     * Remove item from storage
     */
    removeItem(key: string): void;

    /**
     * Get all keys in storage
     */
    keys(): string[];

    /**
     * Clear all data in storage
     */
    clear(): void;
}

/**
 * Configuration for PersistentState
 */
export interface PersistentStateConfig {
    /**
     * Database file path
     */
    dbPath: string;

    /**
     * Default values
     */
    defaults: Record<string, any>;
}

/**
 * Storage namespace information
 */
export interface StorageNamespaceInfo {
    /**
     * Unique namespace identifier
     */
    id: string;

    /**
     * Human-readable namespace name
     */
    name: string;

    /**
     * Full path to the namespace directory
     */
    path: string;
}

/**
 * Get all possible key paths from a nested object type
 * @example
 * type Paths = ObjectPaths<{a: {b: {c: string}}}>;
 * // Results in: "a" | "a.b" | "a.b.c"
 */
export type ObjectPaths<T, D extends number = 5> = [D] extends [never]
    ? never
    : T extends object
    ? {
          [K in keyof T]-?: K extends string | number
              ? `${K}` | Join<K, ObjectPaths<T[K], Prev[D]>>
              : never;
      }[keyof T]
    : "";

type Join<K, P> = K extends string | number
    ? P extends string | number
    ? `${K}${P extends "" ? "" : "."}${P}`
    : never
    : never;

type Prev = [never, 0, 1, 2, 3, 4, 5, ...0[]];

/**
 * Get the type of a nested object property by its path
 * @example
 * type Value = ObjectPathValue<{a: {b: {c: string}}}, "a.b.c">;
 * // Results in: string
 */
export type ObjectPathValue<
    T,
    P extends ObjectPaths<T>
> = P extends `${infer K}.${infer Rest}`
    ? K extends keyof T
    ? Rest extends ObjectPaths<T[K]>
    ? ObjectPathValue<T[K], Rest>
    : never
    : never
    : P extends keyof T
    ? T[P]
    : never;

/**
 * Helper type to get all possible paths as a union
 */
export type AllPaths<T> = ObjectPaths<T>;

/**
 * Helper type to get the value type for a specific path
 */
export type PathValue<T, P extends string> = P extends ObjectPaths<T>
    ? ObjectPathValue<T, P>
    : never;

/**
 * Type-safe PersistentState wrapper
 * Provides type-safe methods based on a structure definition
 */
export interface ITypedPersistentState<T> {
    /**
     * Get item with type safety
     */
    get<K extends ObjectPaths<T>>(key: K): Promise<ObjectPathValue<T, K> | undefined>;

    /**
     * Get item with default value and type safety
     */
    get<K extends ObjectPaths<T>>(key: K, defaultValue: ObjectPathValue<T, K>): Promise<ObjectPathValue<T, K>>;

    /**
     * Set item with type safety
     */
    set<K extends ObjectPaths<T>>(key: K, value: ObjectPathValue<T, K>): Promise<void>;

    /**
     * Remove item
     */
    remove(key: ObjectPaths<T>): Promise<void>;

    /**
     * Get all keys
     */
    keys(): Promise<ObjectPaths<T>[]>;

    /**
     * Clear all data
     */
    clear(): Promise<void>;

    /**
     * Close the database connection
     */
    close(): void;
}

/**
 * Create a typed persistent state instance
 */
export function createTypedState<T>(structure: T): ITypedPersistentState<T> {
    // This would be implemented to return a wrapper around IPersistentState
    // that provides type safety based on the structure
    throw new Error("Not implemented - this is a type definition only");
}
