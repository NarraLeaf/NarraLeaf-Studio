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
     * Cleanup all storage entries
     */
    public cleanupAll(): void {
        this.storage.clear();
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
}
