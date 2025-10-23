import { PERSISTENT_STATE_DB_EXTENSION, PERSISTENT_STATE_DEFAULT_DB_NAME, UserDataNamespace } from "@shared/types/constants";
import {
    PersistentStateConfig,
    StorageNamespaceInfo
} from "@shared/types/persistentState";
import fs from "fs/promises";
import path from "path";
import { PersistentState } from "./storage/persistentState";
import { Manager } from "./manager";

export interface FileStorageInfo {
    path: string;
    raw: boolean;
    encoding?: BufferEncoding;
    status: "allocated" | "ready" | "error";
    error?: string;
}

export class StorageManager extends Manager {
    private storage = new Map<string, FileStorageInfo>();
    private nextId = 0;
    private namespaces = new Map<string, StorageNamespaceInfo>();

    public initialize(): Promise<void> {
        return Promise.resolve();
    }

    /**
     * Allocate a unique hash for file operations
     */
    public allocateHash(path: string, raw: boolean, encoding?: BufferEncoding): string {
        const hash = `${this.nextId++}${Date.now()}`;
        this.storage.set(hash, { path, raw, encoding, status: "allocated" });
        return hash;
    }

    /**
     * Get storage info by hash
     */
    public get(hash: string): FileStorageInfo | undefined {
        return this.storage.get(hash);
    }

    /**
     * Update storage info status
     */
    public updateStatus(hash: string, status: "allocated" | "ready" | "error", error?: string): void {
        const item = this.storage.get(hash);
        if (item) {
            item.status = status;
            if (error) {
                item.error = error;
            }
            this.storage.set(hash, item);
        }
    }

    /**
     * Check if hash is ready for operations
     */
    public isReady(hash: string): boolean {
        const item = this.storage.get(hash);
        return item?.status === "ready";
    }

    /**
     * Cleanup storage entry by hash
     */
    public cleanup(hash: string): void {
        this.storage.delete(hash);
    }

    /**
     * Get all active hashes
     */
    public getActiveHashes(): string[] {
        return Array.from(this.storage.keys());
    }

    /**
     * Get storage info for all active hashes
     */
    public getAllStorage(): Map<string, FileStorageInfo> {
        return new Map(this.storage);
    }

    /**
     * Get or create a namespace path for the given UserDataNamespace enum
     * This is idempotent - same enum always returns the same path
     * @param namespace The predefined namespace enum value
     * @returns Full path to the namespace directory
     */
    public getNamespacePath(namespace: UserDataNamespace): string {
        const namespaceId = `ns_${namespace}`;
        const namespacePath = path.join(this.app.getUserDataDir(), namespace);

        // Cache namespace info for cleanup purposes
        if (!this.namespaces.has(namespaceId)) {
            this.namespaces.set(namespaceId, {
                id: namespaceId,
                name: namespace,
                path: namespacePath
            });

            // Ensure directory exists
            fs.mkdir(namespacePath, { recursive: true }).catch(error => {
                this.app.logger.error(`Failed to create namespace directory ${namespacePath}:`, error);
            });
        }

        return namespacePath;
    }

    /**
     * List all active namespaces
     * @returns Array of namespace info
     */
    public getNamespaces(): StorageNamespaceInfo[] {
        return Array.from(this.namespaces.values());
    }

    /**
     * Remove a namespace and its directory
     * @param namespace The namespace enum value
     * @returns true if removed successfully, false otherwise
     */
    public async removeNamespace(namespace: UserDataNamespace): Promise<boolean> {
        const namespacePath = this.getNamespacePath(namespace);
        const namespaceId = `ns_${namespace}`;

        try {
            await fs.rm(namespacePath, { recursive: true, force: true });
            this.namespaces.delete(namespaceId);
            return true;
        } catch (error) {
            this.app.logger.error(`Failed to remove namespace ${namespace}:`, error);
            return false;
        }
    }

    /**
     * Create a new PersistentState instance for the given namespace
     * @param namespace The namespace enum value
     * @param name Database name (without extension)
     * @returns PersistentState instance
     */
    public createState<T extends Record<string, any>>(namespace: UserDataNamespace, name: string, defaults: T): PersistentState<T> {
        const dbPath = path.join(this.getNamespacePath(namespace), name);
        const config: PersistentStateConfig<T> = {
            dbPath,
            defaults
        };

        return new PersistentState(config);
    }

    /**
     * Cleanup all storage entries and namespaces
     */
    public cleanupAll(): void {
        this.storage.clear();
        this.namespaces.clear();
    }
}
