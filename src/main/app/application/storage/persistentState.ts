import { IPersistentState, PersistentStateConfig } from "@shared/types/persistentState";
import Store from "electron-store";
import path from "path";

/**
 * Electron-Store based persistent key-value storage implementation
 */
export class PersistentState implements IPersistentState {
    private store: Store;
    private config: PersistentStateConfig;

    constructor(config: PersistentStateConfig) {
        this.config = config;

        const cwd = path.dirname(config.dbPath);
        const name = path.basename(config.dbPath, path.extname(config.dbPath)) || "config";

        this.store = new Store({
            cwd,
            name,
            defaults: config.defaults
        });
    }

    public getItem<T>(key: string): T;
    public getItem<T>(key: string, assert: boolean): T;
    public getItem<T>(key: string, assert: boolean = false): T {
        this.ensureValidKey(key);
        const value = this.store.get(key) as T;
        if (assert && value === undefined) {
            throw new Error(`Key ${key} not found in store`);
        }
        return value;
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

    public getConfig(): PersistentStateConfig {
        return { ...this.config };
    }

    private ensureValidKey(key: string): void {
        const keyPattern = /^[a-zA-Z0-9]+([._-][a-zA-Z0-9]+)*$/;
        if (!keyPattern.test(key) || key.length === 0) {
            throw new Error(`Invalid key: ${key}. Keys must contain only English letters, numbers, and dots.`);
        }
    }
}
