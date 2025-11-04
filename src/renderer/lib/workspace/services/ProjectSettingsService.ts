import { throwException } from "@shared/utils/error";
import { getInterface } from "@/lib/app/bridge";
import { WorkspaceContext } from "./services";
import { Service } from "./Service";

/**
 * Project Settings Service
 * Provides access to project-level settings stored in .nlstudio/settings.json
 */
export class ProjectSettingsService extends Service<ProjectSettingsService> {
    private projectPath: string = "";
    private cache: Record<string, any> = {};

    protected async init(ctx: WorkspaceContext): Promise<void> {
        this.projectPath = ctx.project.getConfig().projectPath;
        // Load all settings into cache
        const result = throwException(await getInterface().projectSettings.getAll(this.projectPath));
        this.cache = result.settings;
    }

    override dispose(_ctx: WorkspaceContext): void {
        this.cache = {};
    }

    /**
     * Get a setting value
     * @param key Setting key (supports dot notation like "ui.leftSidebar.width")
     * @param defaultValue Default value if key doesn't exist
     */
    async get<T = any>(key: string, defaultValue?: T): Promise<T | undefined> {
        // Try cache first
        if (key in this.cache) {
            return this.cache[key] as T;
        }

        // Fetch from main process
        const result = await getInterface().projectSettings.get<T>(this.projectPath, key);
        if (result.success && result.data.value !== undefined) {
            this.cache[key] = result.data.value;
            return result.data.value;
        }

        return defaultValue;
    }

    /**
     * Set a setting value
     * @param key Setting key (supports dot notation like "ui.leftSidebar.width")
     * @param value Setting value
     */
    async set<T = any>(key: string, value: T): Promise<void> {
        // Update cache
        this.cache[key] = value;

        // Save to main process
        throwException(await getInterface().projectSettings.set(this.projectPath, key, value));
    }

    /**
     * Set multiple setting values in batch
     * @param settings Record of setting keys and values
     */
    async setBatch(settings: Record<string, any>): Promise<void> {
        // Update cache
        Object.assign(this.cache, settings);

        // Save to main process in batch
        throwException(await getInterface().projectSettings.setBatch(this.projectPath, settings));
    }

    /**
     * Get all settings
     */
    getAll(): Record<string, any> {
        return { ...this.cache };
    }

    /**
     * Clear all settings
     */
    async clear(): Promise<void> {
        this.cache = {};
        throwException(await getInterface().projectSettings.clear(this.projectPath));
    }

    /**
     * Check if a key exists
     */
    has(key: string): boolean {
        return key in this.cache;
    }

    /**
     * Get a setting value synchronously from cache
     * Returns undefined if not in cache
     */
    getSync<T = any>(key: string, defaultValue?: T): T | undefined {
        if (key in this.cache) {
            return this.cache[key] as T;
        }
        return defaultValue;
    }
}

