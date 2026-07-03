import { PERSISTENT_STATE_DB_EXTENSION, PERSISTENT_STATE_DEFAULT_DB_NAME, UserDataNamespace } from "@shared/types/constants";
import {
    PersistentStateConfig,
    StorageNamespaceInfo
} from "@shared/types/persistentState";
import crypto from "crypto";
import { app as electronApp } from "electron";
import fs from "fs/promises";
import path from "path";
import { PersistentState } from "../../../../shared/utils/persistentState";
import { Manager } from "./manager";
import { BaseApp } from "../baseApp";
import type { AppWindow } from "./window/appWindow";
import { FileSystemAccessMode, FileSystemGrant, FileSystemGrantMode, getDeclaredFileSystemGrants } from "./window/permissions";

export interface FileStorageInfo {
    path: string;
    raw: boolean;
    operation: FileSystemAccessMode;
    encoding?: BufferEncoding;
    status: "allocated" | "ready" | "error";
    error?: string;
}

type SecurityScopedResourceLifetime = "window" | "session";
type SecurityScopedBookmarkGrant = {
    path: string;
    recursive: boolean;
    bookmark: string;
};

export class StorageManager extends Manager {
    private storage = new Map<string, FileStorageInfo>();
    private runtimeFileSystemGrants = new Map<number, FileSystemGrant[]>();
    private runtimeSecurityScopedResourceStops = new Map<number, Array<() => void>>();
    private sessionSecurityScopedResourceStops: Array<() => void> = [];
    private securityScopedBookmarkGrants: SecurityScopedBookmarkGrant[] = [];
    private namespaces = new Map<string, StorageNamespaceInfo>();
    
    constructor(app: BaseApp) {
        super(app);
    }

    public initialize(): Promise<void> {
        return Promise.resolve();
    }

    /**
     * Allocate a unique hash for file operations
     */
    public allocateHash(path: string, raw: boolean, operation: FileSystemAccessMode, encoding?: BufferEncoding): string {
        const hash = crypto.randomBytes(32).toString("base64url");
        this.storage.set(hash, { path, raw, operation, encoding, status: "allocated" });
        return hash;
    }

    public grantFileSystemAccess(
        window: AppWindow,
        fsPath: string,
        mode: FileSystemGrantMode = "readwrite",
        recursive: boolean = true,
        securityScopedBookmark?: string,
        securityScopedResourceLifetime: SecurityScopedResourceLifetime = "window",
    ): void {
        const grants = this.runtimeFileSystemGrants.get(this.getWindowStorageKey(window)) ?? [];
        this.startSecurityScopedResource(window, fsPath, securityScopedBookmark, securityScopedResourceLifetime);
        this.rememberSecurityScopedBookmark(fsPath, recursive, securityScopedBookmark);
        const modes: FileSystemAccessMode[] = mode === "readwrite" ? ["read", "write"] : [mode];
        for (const grantMode of modes) {
            grants.push({ path: path.resolve(fsPath), recursive, mode: grantMode });
        }
        this.runtimeFileSystemGrants.set(this.getWindowStorageKey(window), grants);
    }

    public async isPathAllowed(window: AppWindow, fsPath: string, mode: FileSystemAccessMode): Promise<boolean> {
        const target = await this.resolvePathForAuthorization(fsPath);
        if (await this.isProtectedStoragePath(target)) {
            return false;
        }

        for (const grant of this.getFileSystemGrants(window, mode)) {
            const root = await this.resolvePathForAuthorization(grant.path);
            if (grant.recursive ? this.isSameOrChild(target, root) : target === root) {
                return true;
            }
        }
        return false;
    }

    public async isPathProtected(fsPath: string): Promise<boolean> {
        return this.isProtectedStoragePath(await this.resolvePathForAuthorization(fsPath));
    }

    public getSecurityScopedBookmarkForPath(fsPath: string): string | undefined {
        const target = path.resolve(fsPath);
        return this.securityScopedBookmarkGrants
            .filter(grant => grant.recursive ? this.isSameOrChild(target, grant.path) : target === grant.path)
            .sort((a, b) => b.path.length - a.path.length)
            .at(0)?.bookmark;
    }

    public revokeWindowFileSystemAccess(window: AppWindow): void {
        this.runtimeFileSystemGrants.delete(this.getWindowStorageKey(window));
        const key = this.getWindowStorageKey(window);
        this.stopSecurityScopedResources(this.runtimeSecurityScopedResourceStops.get(key) ?? []);
        this.runtimeSecurityScopedResourceStops.delete(key);
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
        this.runtimeFileSystemGrants.clear();
        for (const stopAccessingList of this.runtimeSecurityScopedResourceStops.values()) {
            this.stopSecurityScopedResources(stopAccessingList);
        }
        this.runtimeSecurityScopedResourceStops.clear();
        this.stopSecurityScopedResources(this.sessionSecurityScopedResourceStops);
        this.sessionSecurityScopedResourceStops = [];
        this.securityScopedBookmarkGrants = [];
        this.namespaces.clear();
    }

    private rememberSecurityScopedBookmark(fsPath: string, recursive: boolean, securityScopedBookmark?: string): void {
        if (!securityScopedBookmark) {
            return;
        }

        const bookmarkGrant: SecurityScopedBookmarkGrant = {
            path: path.resolve(fsPath),
            recursive,
            bookmark: securityScopedBookmark,
        };
        this.securityScopedBookmarkGrants = [
            bookmarkGrant,
            ...this.securityScopedBookmarkGrants.filter(grant => grant.path !== bookmarkGrant.path || grant.bookmark !== bookmarkGrant.bookmark),
        ];
    }

    private startSecurityScopedResource(
        window: AppWindow,
        fsPath: string,
        securityScopedBookmark: string | undefined,
        lifetime: SecurityScopedResourceLifetime,
    ): void {
        if (!securityScopedBookmark) {
            return;
        }

        try {
            const stopAccessing = electronApp.startAccessingSecurityScopedResource(securityScopedBookmark);
            if (lifetime === "session") {
                this.sessionSecurityScopedResourceStops.push(() => stopAccessing());
            } else {
                const key = this.getWindowStorageKey(window);
                const stops = this.runtimeSecurityScopedResourceStops.get(key) ?? [];
                stops.push(() => stopAccessing());
                this.runtimeSecurityScopedResourceStops.set(key, stops);
            }
        } catch (error) {
            this.app.logger.warn(`Failed to start accessing security scoped resource for ${fsPath}:`, error);
        }
    }

    private stopSecurityScopedResources(stopAccessingList: Array<() => void>): void {
        for (const stopAccessing of stopAccessingList) {
            try {
                stopAccessing();
            } catch (error) {
                this.app.logger.warn("Failed to stop accessing security scoped resource:", error);
            }
        }
    }

    private getFileSystemGrants(window: AppWindow, mode: FileSystemAccessMode): FileSystemGrant[] {
        return [
            ...getDeclaredFileSystemGrants(window, mode),
            ...(this.runtimeFileSystemGrants.get(this.getWindowStorageKey(window)) ?? []).filter(grant => grant.mode === mode),
        ];
    }

    private getWindowStorageKey(window: AppWindow): number {
        return window.getWebContents().id;
    }

    private async resolvePathForAuthorization(fsPath: string): Promise<string> {
        const resolvedPath = path.resolve(fsPath);
        const pendingSegments: string[] = [];
        let current = resolvedPath;

        while (true) {
            try {
                const realCurrent = await fs.realpath(current);
                return pendingSegments.length > 0
                    ? path.join(realCurrent, ...pendingSegments)
                    : realCurrent;
            } catch {
                const parent = path.dirname(current);
                if (parent === current) {
                    return resolvedPath;
                }
                pendingSegments.unshift(path.basename(current));
                current = parent;
            }
        }
    }

    private async isProtectedStoragePath(target: string): Promise<boolean> {
        for (const root of this.getProtectedStorageRoots()) {
            const resolvedRoot = await this.resolvePathForAuthorization(root);
            if (this.isSameOrChild(target, resolvedRoot)) {
                return true;
            }
        }
        return false;
    }

    private getProtectedStorageRoots(): string[] {
        return [
            path.join(this.app.getUserDataDir(), UserDataNamespace.Authorization),
            path.join(this.app.getUserDataDir(), UserDataNamespace.Plugins),
            this.app.getBuiltInPluginsDir(),
        ];
    }

    private isSameOrChild(target: string, root: string): boolean {
        const relativePath = path.relative(root, target);
        return relativePath === "" || (!relativePath.startsWith("..") && !path.isAbsolute(relativePath));
    }
}
