import { ProjectNameConvention } from "@/lib/workspace/project/nameConvention";
import { RequestStatus } from "@shared/types/ipcEvents";
import { FsRequestResult } from "@shared/types/os";
import { dirname } from "@shared/utils/path";
import { FileSystemService } from "../../core/FileSystem";
import { Services, WorkspaceContext } from "../../services";

/**
 * Editor-only cache for remote assets.
 * Lifetime on assets is reserved for runtime; editor cache will persist until manually cleared.
 */
export class EditorRemoteCacheManager {
    private readonly memoryCache = new Map<string, Uint8Array>();

    constructor(private readonly context: WorkspaceContext) {}

    async init(): Promise<this> {
        await this.ensureCacheRoot();
        return this;
    }

    /**
     * Fetch remote data and persist to cache when needed.
     * Lifetime is intentionally ignored to keep editor UX fast and offline-friendly.
     */
    public async fetch(assetId: string, url: string): Promise<RequestStatus<Uint8Array>> {
        const cached = await this.getFromCache(assetId);
        if (cached.success) {
            return cached;
        }

        const downloaded = await this.download(url);
        if (!downloaded.success || !downloaded.data) {
            return downloaded;
        }

        const storeResult = await this.store(assetId, downloaded.data);
        if (!storeResult.ok) {
            return { success: false, error: `Cache write failed: ${storeResult.error?.message || "Unknown error"}` };
        }

        return { success: true, data: downloaded.data };
    }

    public async evict(assetId?: string): Promise<void> {
        if (!assetId) {
            this.memoryCache.clear();
            return;
        }

        this.memoryCache.delete(assetId);
        const cachePath = this.getCachePath(assetId);
        const fs = this.getFileSystem();
        const exists = await fs.isFileExists(cachePath);
        if (exists.ok && exists.data) {
            await fs.deleteFile(cachePath);
        }
    }

    private async getFromCache(assetId: string): Promise<RequestStatus<Uint8Array>> {
        const inMemory = this.memoryCache.get(assetId);
        if (inMemory) {
            return { success: true, data: inMemory };
        }

        const cachePath = this.getCachePath(assetId);
        const fs = this.getFileSystem();
        const exists = await fs.isFileExists(cachePath);
        if (!exists.ok) {
            return { success: false, error: exists.error?.message };
        }

        if (!exists.data) {
            return { success: false, error: "Cache miss" };
        }

        const bufferResult = await fs.readRaw(cachePath);
        if (!bufferResult.ok) {
            return { success: false, error: bufferResult.error?.message };
        }

        this.memoryCache.set(assetId, bufferResult.data);
        return { success: true, data: bufferResult.data };
    }

    private async store(assetId: string, buffer: Uint8Array): Promise<FsRequestResult<void>> {
        const cachePath = this.getCachePath(assetId);
        const dir = dirname(cachePath);
        const fs = this.getFileSystem();

        const dirExists = await fs.isDirExists(dir);
        if (!dirExists.ok) {
            return dirExists as FsRequestResult<void, false>;
        }

        if (!dirExists.data) {
            const created = await fs.createDir(dir);
            if (!created.ok) {
                return created as FsRequestResult<void, false>;
            }
        }

        const writeResult = await fs.writeRaw(cachePath, buffer);
        if (writeResult.ok) {
            this.memoryCache.set(assetId, buffer);
        }
        return writeResult;
    }

    private async download(url: string): Promise<RequestStatus<Uint8Array>> {
        try {
            const response = await fetch(url, { cache: "no-store" });
            if (!response.ok) {
                return { success: false, error: `HTTP ${response.status} ${response.statusText}` };
            }

            const buffer = new Uint8Array(await response.arrayBuffer());
            return { success: true, data: buffer };
        } catch (error) {
            return {
                success: false,
                error: error instanceof Error ? error.message : "Unknown network error",
            };
        }
    }

    private async ensureCacheRoot(): Promise<void> {
        const root = this.context.project.resolve(ProjectNameConvention.EditorRemoteAssetsCache);
        const fs = this.getFileSystem();
        const exists = await fs.isDirExists(root);
        if (!exists.ok) {
            throw new Error(exists.error?.message || "Failed to access cache root");
        }
        if (!exists.data) {
            const created = await fs.createDir(root);
            if (!created.ok) {
                throw new Error(created.error?.message || "Failed to create cache root");
            }
        }
    }

    private getCachePath(assetId: string): string {
        return this.context.project.resolve(ProjectNameConvention.EditorRemoteAssetShard(assetId));
    }

    private getFileSystem(): FileSystemService {
        return this.context.services.get<FileSystemService>(Services.FileSystem);
    }
}

