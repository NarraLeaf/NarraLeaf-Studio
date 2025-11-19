import { IPersistentState, PersistentStateConfig } from "@shared/types/persistentState";
import { StringKeyOf } from "@shared/utils/types";
import Store from "electron-store";
import path from "path";

/**
 * Electron-Store based persistent key-value storage implementation
 */
export class PersistentState<T extends Record<string, any>> implements IPersistentState {
    private store: Store<T>;
    private config: PersistentStateConfig<T>;

    constructor(config: PersistentStateConfig<T>) {
        this.config = config;

        const cwd = path.dirname(config.dbPath);
        const name = path.basename(config.dbPath, path.extname(config.dbPath)) || "config";

        this.store = new Store<T>({
            cwd,
            name,
            defaults: config.defaults,
            accessPropertiesByDotNotation: false,
        });
    }

    public getItem<K extends StringKeyOf<T>>(key: K): T[K];
    public getItem<K extends StringKeyOf<T>>(key: K, assert: boolean): T[K];
    public getItem<K extends StringKeyOf<T>>(key: K, assert: boolean = false): T[K] {
        this.ensureValidKey(key);
        const value = this.store.get(key);
        if (assert && value === undefined) {
            throw new Error(`Key "${key}" not found in store`);
        }
        return value as T[K];
    }

    public setItem(key: string, data: any): void {
        this.ensureValidKey(key);
        this.store.set(key, data);
    }

    public removeItem(key: string): void {
        this.ensureValidKey(key);
        this.store.delete(key);
    }

    public keys(): string[] {
        return Object.keys(this.store.store);
    }

    public clear(): void {
        this.store.clear();
    }

    public getConfig(): PersistentStateConfig<T> {
        return { ...this.config };
    }

    public raw(): T {
        return this.store.store;
    }

    private ensureValidKey(key: string): void {
        const keyPattern = /^[a-zA-Z0-9]+([._-][a-zA-Z0-9]+)*$/;
        if (!keyPattern.test(key) || key.length === 0) {
            throw new Error(`Invalid key: "${key}". Keys must contain only English letters, numbers, and dots.`);
        }
    }
}
