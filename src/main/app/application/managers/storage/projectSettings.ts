import { PersistentStateConfig } from "@shared/types/persistentState";
import { PersistentState } from "../../../../../shared/utils/persistentState";
import path from "path";
import fs from "fs/promises";

/**
 * Project Settings Manager
 * Manages project-level settings stored in .nlstudio/settings.json
 */
export class ProjectSettings {
    private stores = new Map<string, PersistentState<Record<string, any>>>();

    /**
     * Get or create a settings store for a project
     * @param projectPath Project root directory path
     */
    private async getStore(projectPath: string): Promise<PersistentState<Record<string, any>>> {
        // Normalize path to use as key
        const normalizedPath = path.normalize(projectPath);
        
        // Return existing store if available
        if (this.stores.has(normalizedPath)) {
            return this.stores.get(normalizedPath)!;
        }

        // Create .nlstudio directory if it doesn't exist
        const nlstudioDir = path.join(projectPath, ".nlstudio");
        await fs.mkdir(nlstudioDir, { recursive: true });

        // Create settings store
        const dbPath = path.join(nlstudioDir, "editor");
        const config: PersistentStateConfig<Record<string, any>> = {
            dbPath,
            defaults: {}
        };

        const store = new PersistentState<Record<string, any>>(config);
        this.stores.set(normalizedPath, store);

        return store;
    }

    /**
     * Get a setting value
     * @param projectPath Project root directory path
     * @param key Setting key
     */
    async get<T = any>(projectPath: string, key: string): Promise<T | undefined> {
        const store = await this.getStore(projectPath);
        return store.getItem(key) as T | undefined;
    }

    /**
     * Set a setting value
     * @param projectPath Project root directory path
     * @param key Setting key
     * @param value Setting value
     */
    async set<T = any>(projectPath: string, key: string, value: T): Promise<void> {
        const store = await this.getStore(projectPath);
        store.setItem(key, value);
    }

    /**
     * Get all settings for a project
     * @param projectPath Project root directory path
     */
    async getAll(projectPath: string): Promise<Record<string, any>> {
        const store = await this.getStore(projectPath);
        return store.raw();
    }

    /**
     * Clear all settings for a project
     * @param projectPath Project root directory path
     */
    async clear(projectPath: string): Promise<void> {
        const store = await this.getStore(projectPath);
        store.clear();
    }

    /**
     * Remove a setting key
     * @param projectPath Project root directory path
     * @param key Setting key
     */
    async remove(projectPath: string, key: string): Promise<void> {
        const store = await this.getStore(projectPath);
        store.removeItem(key);
    }

    /**
     * Cleanup store for a project (remove from cache)
     * @param projectPath Project root directory path
     */
    cleanup(projectPath: string): void {
        const normalizedPath = path.normalize(projectPath);
        this.stores.delete(normalizedPath);
    }

    /**
     * Cleanup all stores
     */
    cleanupAll(): void {
        this.stores.clear();
    }
}

