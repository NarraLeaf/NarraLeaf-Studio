import { getInterface } from "@/lib/app/bridge";
import { appPrivilegedFacade } from "@/lib/app/privilegedFacade";
import { RequestStatus } from "@shared/types/ipcEvents";
import { AssetsService } from "../../core/AssetsService";
import { Services, WorkspaceContext } from "../../services";
import { AssetData, AssetExtensions, AssetType } from "../assetTypes";
import { Asset, AssetSource } from "../types";
import { ProjectNameConvention, isValidAssetStorageId } from "@/lib/workspace/project/nameConvention";
import { FsRequestResult } from "@shared/types/os";
import { FileSystemService } from "../../core/FileSystem";
import { UuidService } from "../../core/UuidService";
import { RendererError } from "@shared/utils/error";
import { basename, dirname, extname } from "@shared/utils/path";
import { expandImportPaths, type ExpandImportPathsResult } from "../importPathExpansion";

/**
 * What the bytes on disk now are, after {@link LocalAssetsManager.writeAssetContentFromPath}.
 *
 * `hash` is empty when the digest could not be computed — the same fallback import uses. It is still
 * different from the hash it replaces, which is what matters: several readers (`useAssetBlobUrl` and
 * friends) use the hash as the cache key that decides whether to re-read the file, so a hash that
 * did not move means every one of them keeps serving the old picture.
 */
export interface AssetContentDigest {
    hash: string;
    /** Extension of the new source file, lowercased, without the dot. */
    ext?: string;
}

/** Where a multi-file import has got to. Reported once per file, plus once when the run ends. */
export interface ImportProgress {
    /** Files finished so far, successful or not. */
    completed: number;
    total: number;
    /** The file being read right now; absent on the final report. */
    current?: string;
}

export interface ImportFromPathsOptions {
    /**
     * Called before each file and once at the end. Imports are sequential and a large drop can take
     * a while; without this the only reading available is a boolean spinner, which cannot say
     * whether anything is still happening.
     */
    onProgress?: (progress: ImportProgress) => void;
}

export class LocalAssetsManager {
    constructor(private assetsService: AssetsService, private context: WorkspaceContext) {
    }

    async init(): Promise<this> {
        return this;
    }

    public async importLocalAssets<T extends AssetType>(type: T): Promise<RequestStatus<RequestStatus<Asset<T, AssetSource.Local>>[]>> {
        const assetExtensions = AssetExtensions[type];
        const files = await getInterface().fs.selectFile(assetExtensions, true);
        if (!files.success || !files.data.ok) {
            return {
                success: false,
                error: `Failed to select files: ${files.error || (`[${(files.data as FsRequestResult<string[], false>)?.error.code}] ${(files.data as FsRequestResult<string[], false>)?.error.message}`)}`,
            };
        }

        const results: RequestStatus<Asset<T, AssetSource.Local>>[] = [];
        for (const file of files.data.data) {
            results.push(await this.importLocalAsset(type, file));
        }

        this.assetsService.markDirty(type);

        return {
            success: true,
            data: results,
        };
    }

    public async fetch<T extends AssetType>(asset: Asset<T, AssetSource.Local>): Promise<RequestStatus<AssetData<T>>> {
        if (!isValidAssetStorageId(asset.id)) {
            return { success: false, error: `Invalid asset id: ${asset.id}` };
        }

        const path = this.getLocalAssetPath(asset.id);
        switch (asset.type) {
            case AssetType.Image:
                if (!this.assetsService.imageService) {
                    throw new RendererError("Image service not initialized");
                }
                return await this.assetsService.imageService.readLocalImage(asset as Asset<AssetType.Image>) as RequestStatus<AssetData<T>>;
            case AssetType.Audio:
                if (!this.assetsService.audioService) {
                    throw new RendererError("Audio service not initialized");
                }
                return await this.assetsService.audioService.readLocalAudio(asset as Asset<AssetType.Audio>) as RequestStatus<AssetData<T>>;
            case AssetType.Video:
                if (!this.assetsService.videoService) {
                    throw new RendererError("Video service not initialized");
                }
                return await this.assetsService.videoService.readLocalVideo(asset as Asset<AssetType.Video>) as RequestStatus<AssetData<T>>;
            case AssetType.JSON:
                if (!this.assetsService.jsonService) {
                    throw new RendererError("JSON service not initialized");
                }
                return await this.assetsService.jsonService.readLocalJSON(path) as RequestStatus<AssetData<T>>;
            case AssetType.Blueprint:
                if (!this.assetsService.blueprintService) {
                    throw new RendererError("Blueprint service not initialized");
                }
                return await this.assetsService.blueprintService.readLocalBlueprint(path) as RequestStatus<AssetData<T>>;
            case AssetType.Font:
                if (!this.assetsService.fontService) {
                    throw new RendererError("Font service not initialized");
                }
                return await this.assetsService.fontService.readLocalFont(asset as Asset<AssetType.Font>) as RequestStatus<AssetData<T>>;
            case AssetType.Other:
                if (!this.assetsService.otherService) {
                    throw new RendererError("Other service not initialized");
                }
                return await this.assetsService.otherService.readLocalOther(asset as Asset<AssetType.Other>) as RequestStatus<AssetData<T>>;
            default:
                return {
                    success: false,
                    error: `Failed to fetch asset: ${asset.id}. Type "${asset.type}" is not supported.`,
                };
        }
    }

    public async deleteAsset<T extends AssetType>(
        asset: Asset<T, AssetSource.Local>
    ): Promise<RequestStatus<void>> {
        const metadata = this.assetsService.getAssetsMetadataManager().getAssets();

        if (!isValidAssetStorageId(asset.id)) {
            return { success: false, error: `Invalid asset id: ${asset.id}` };
        }

        if (!metadata[asset.type][asset.id]) {
            return {
                success: false,
                error: `Asset not found: ${asset.id}`,
            };
        }

        // Delete asset file
        const assetPath = this.getLocalAssetPath(asset.id);
        const deleteResult = await appPrivilegedFacade.fs.deleteFile(assetPath);
        
        if (!deleteResult.success || !deleteResult.data.ok) {
            // Continue even if file deletion fails (file might not exist)
            console.warn(`Failed to delete asset file: ${assetPath}`);
        }

        // Remove from metadata
        delete metadata[asset.type][asset.id];
        this.assetsService.markDirty(asset.type);

        // Emit deletion event so UI can react
        this.assetsService.getEvents().emit("deleted", asset);

        return {
            success: true,
            data: void 0,
        };
    }

    /**
     * Overwrite an existing local asset's bytes with the file at `sourcePath`, keeping its id — so
     * every reference (which stores the id, never a path) keeps pointing at the same record and
     * simply renders the new file.
     *
     * Bytes and digest only. Metadata, the thumbnail cache and the `updated` broadcast are handled by
     * {@link AssetsService.replaceAssetContent}, which has to run them in a fixed order; doing any of
     * them here would let a caller land halfway through it.
     */
    public async writeAssetContentFromPath<T extends AssetType>(
        asset: Asset<T, AssetSource.Local>,
        sourcePath: string,
    ): Promise<RequestStatus<AssetContentDigest>> {
        if (!isValidAssetStorageId(asset.id)) {
            return { success: false, error: `Invalid asset id: ${asset.id}` };
        }

        const metadata = this.assetsService.getAssetsMetadataManager().getAssets();
        if (!metadata[asset.type][asset.id]) {
            return { success: false, error: `Asset not found: ${asset.id}` };
        }

        // Same gate imports pass: a file whose magic bytes say "not an image" must not become the
        // contents of an image asset, where every consumer would then fail to decode it.
        const formatValidation = await this.validateFileFormat(asset.type, sourcePath);
        if (!formatValidation.success) {
            return { success: false, error: formatValidation.error || "File format validation failed" };
        }

        const destPath = this.getLocalAssetPath(asset.id);
        const fsService = this.getContext().services.get<FileSystemService>(Services.FileSystem);
        const destDir = dirname(destPath);
        const dirExistCheck = await fsService.isDirExists(destDir);
        if (!dirExistCheck.ok) {
            return { success: false, error: `Failed to check destination directory: ${dirExistCheck.error?.message}` };
        }
        if (!dirExistCheck.data) {
            const mkdirResult = await fsService.createDir(destDir);
            if (!mkdirResult.ok) {
                return { success: false, error: `Failed to create destination directory: ${destDir}. ${mkdirResult.error?.message}` };
            }
        }

        const copyResult = await appPrivilegedFacade.fs.copyFile(sourcePath, destPath);
        if (!copyResult.success || !copyResult.data.ok) {
            const message = copyResult.error
                || (`[${(copyResult.data as FsRequestResult<void, false>)?.error.code}] ${(copyResult.data as FsRequestResult<void, false>)?.error.message}`);
            return { success: false, error: `Failed to replace asset contents: ${sourcePath} to ${destPath}. ${message}` };
        }

        // Recomputed from the destination, not the source: this is the digest of what is actually
        // stored now, and it is the value every cache key downstream compares against.
        const hashResult = await appPrivilegedFacade.fs.hash(destPath);
        const fileHash = hashResult.success && hashResult.data.ok ? hashResult.data.data : "";

        return {
            success: true,
            data: {
                hash: fileHash,
                ext: extname(basename(sourcePath)).slice(1).toLowerCase() || undefined,
            },
        };
    }

    public async duplicateAsset<T extends AssetType>(asset: Asset<T>): Promise<RequestStatus<Asset<T, AssetSource.Local>>> {
        const metadata = this.assetsService.getAssetsMetadataManager().getAssets();

        // Ensure asset exists
        const existing = metadata[asset.type][asset.id];
        if (!existing) {
            return { success: false, error: `Asset not found: ${asset.id}` };
        }

        if (!isValidAssetStorageId(asset.id)) {
            return { success: false, error: `Invalid asset id: ${asset.id}` };
        }

        // Generate new uuid and resolve unique name
        const newId = this.getUuidService().generate();
        const uniqueName = this.resolveUniqueAssetName(asset.type, asset.name);

        // Source/dest paths
        const srcPath = this.getLocalAssetPath(asset.id);
        const destPath = this.getLocalAssetPath(newId);

        const filesystemService = this.getContext().services.get<FileSystemService>(Services.FileSystem);
        // Ensure destination directory exists
        const destDir = dirname(destPath);
        const dirEnsure = await filesystemService.createDir(destDir);
        if (!dirEnsure.ok) {
            return { success: false, error: `Failed to create destination directory: ${dirEnsure.error?.message}` };
        }

        // Check if source file exists
        const srcExists = await filesystemService.isFileExists(srcPath);
        if (!srcExists.ok || !srcExists.data) {
            return { success: false, error: `Source asset file not found: ${srcPath}` };
        }

        // Copy file
        const copyResult = await appPrivilegedFacade.fs.copyFile(srcPath, destPath);
        if (!copyResult.success || !copyResult.data.ok) {
            const msg = copyResult.error || (copyResult.data as FsRequestResult<void, false>)?.error.message;
            return { success: false, error: `Failed to copy asset file: ${msg}` };
        }

        // Compute hash for the duplicated file
        const hashResult = await appPrivilegedFacade.fs.hash(destPath);
        const fileHash = hashResult.success && hashResult.data.ok ? hashResult.data.data : asset.hash;

        // Create metadata
        const newAsset: Asset<T, AssetSource.Local> = {
            ...asset,
            id: newId,
            hash: fileHash,
            name: uniqueName,
            ext: asset.ext,
            source: AssetSource.Local,
        };

        // Save metadata
        (metadata[asset.type] as Record<string, Asset<T>>)[newId] = newAsset as Asset<T>;
        this.assetsService.markDirty(asset.type);

        this.assetsService.getEvents().emit("updated", newAsset as Asset<T, AssetSource>);

        return { success: true, data: newAsset };
    }

    public async importFromPaths<T extends AssetType>(
        type: T,
        paths: string[],
        options?: ImportFromPathsOptions,
    ): Promise<RequestStatus<RequestStatus<Asset<T, AssetSource.Local>>[]>> {
        const results: RequestStatus<Asset<T, AssetSource.Local>>[] = [];

        for (const path of paths) {
            options?.onProgress?.({ completed: results.length, total: paths.length, current: path });
            results.push(await this.importLocalAsset(type, path));
        }
        options?.onProgress?.({ completed: results.length, total: paths.length });

        this.assetsService.markDirty(type);

        return {
            success: true,
            data: results,
        };
    }

    /**
     * Resolve a set of dropped paths into the concrete files to import: directories are walked
     * recursively and filtered to the target asset type's extensions, while plain file paths pass
     * through unchanged. Callers hand the resulting {@link ExpandImportPathsResult.files} to
     * {@link importFromPaths}; the 1:1 path→result contract of that method is deliberately left
     * intact for callers (e.g. voice import) that match results back by index.
     */
    public async expandImportPaths<T extends AssetType>(
        type: T,
        paths: string[]
    ): Promise<ExpandImportPathsResult> {
        const fsService = this.getContext().services.get<FileSystemService>(Services.FileSystem);
        return expandImportPaths(type, paths, {
            isDir: async (path) => {
                const result = await fsService.isDir(path);
                return result.ok && result.data;
            },
            list: async (path) => {
                const result = await fsService.list(path);
                return result.ok ? result.data : null;
            },
        });
    }

    private async importLocalAsset<T extends AssetType>(type: T, path: string): Promise<RequestStatus<Asset<T, AssetSource.Local>>> {
        // Validate file format before importing
        const formatValidation = await this.validateFileFormat(type, path);
        if (!formatValidation.success) {
            return {
                success: false,
                error: formatValidation.error || "File format validation failed",
            };
        }

        // compute file hash for info only
        const hashResult = await appPrivilegedFacade.fs.hash(path);
        const fileHash = hashResult.success && hashResult.data.ok ? hashResult.data.data : "";

        // generate unique id for storage / indexing
        const id = this.getUuidService().generate();

        // resolve unique display name (e.g. "image.png", "image-1.png")
        const originalName = basename(path);
        const uniqueName = this.resolveUniqueAssetName(type, originalName);

        // construct asset metadata
        const asset: Asset<T, AssetSource.Local> = {
            id,
            type,
            name: uniqueName,
            ext: extname(originalName).slice(1).toLowerCase(), // persist real extension
            hash: fileHash,
            source: AssetSource.Local,
            meta: {},
            tags: [],
            description: "",
        };

        // copy asset to local directory using id as filename
        const destPath = this.getLocalAssetPath(id);

        const fsService = this.getContext().services.get<FileSystemService>(Services.FileSystem);
        const existCheck = await fsService.isFileExists(destPath);
        if (!existCheck.ok) {
            return {
                success: false,
                error: `Failed to check existing asset file: ${existCheck.error?.message}`,
            } as RequestStatus<Asset<T, AssetSource.Local>>;
        }

        const metadata = this.assetsService.getAssetsMetadataManager().getAssets();
        const record: Record<string, Asset<T>> = metadata[type];
        if (record[id]) {
            return {
                success: true,
                data: record[id] as Asset<T, AssetSource.Local>,
            };
        }

        if (!existCheck.data) {
            // Ensure destination directory exists
            const destDir = dirname(destPath);
            const dirExistCheck = await fsService.isDirExists(destDir);
            if (!dirExistCheck.ok) {
                return {
                    success: false,
                    error: `Failed to check destination directory: ${dirExistCheck.error?.message}`,
                } as RequestStatus<Asset<T, AssetSource.Local>>;
            }

            if (!dirExistCheck.data) {
                const mkdirResult = await fsService.createDir(destDir);
                if (!mkdirResult.ok) {
                    return {
                        success: false,
                        error: `Failed to create destination directory: ${destDir}. ${mkdirResult.error?.message}`,
                    };
                }
            }

            const copyResult = await appPrivilegedFacade.fs.copyFile(path, destPath);
            if (!copyResult.success || !copyResult.data.ok) {
                const message = copyResult.error
                    || (`[${(copyResult.data as FsRequestResult<void, false>)?.error.code}] ${(copyResult.data as FsRequestResult<void, false>)?.error.message}`);
                return {
                    success: false,
                    error: `Failed to copy asset: ${path} to ${destPath}. ${message}`,
                };
            }
        }

        // update assets metadata
        record[id] = asset;

        // Notify subscribers (e.g. AssetSelector, asset tree) so lists refresh without closing panels
        this.assetsService.getEvents().emit("updated", asset);

        return {
            success: true,
            data: asset,
        };
    }

    private async validateFileFormat<T extends AssetType>(type: T, path: string): Promise<RequestStatus<void>> {
        const fsService = this.getContext().services.get<FileSystemService>(Services.FileSystem);

        // Read first 12 bytes to detect format
        const fileResult = await fsService.readRaw(path);
        if (!fileResult.ok) {
            return {
                success: false,
                error: `Failed to read file: ${fileResult.error?.message || 'Unknown error'}`,
            };
        }

        const buffer = fileResult.data;
        if (buffer.length === 0) {
            return {
                success: false,
                error: 'File is empty',
            };
        }

        return await this.assetsService.getFileFormatValidator().validateFileFormat(type, path, buffer);
    }

    /**
     * Ensure asset display name is unique within given type. Append "-n" if duplicate.
     */
    private resolveUniqueAssetName<T extends AssetType>(type: T, originalName: string): string {
        const metadata = this.assetsService.getAssetsMetadataManager().getAssets();
        const record = metadata[type];
        const existingNames = new Set(Object.values(record).map(a => a.name));

        if (!existingNames.has(originalName)) {
            return originalName;
        }

        const extIndex = originalName.lastIndexOf('.');
        const base = extIndex !== -1 ? originalName.slice(0, extIndex) : originalName;
        const ext = extIndex !== -1 ? originalName.slice(extIndex) : '';

        let counter = 1;
        let candidate = `${base}-${counter}${ext}`;
        while (existingNames.has(candidate)) {
            counter += 1;
            candidate = `${base}-${counter}${ext}`;
        }
        return candidate;
    }

    private getLocalAssetPath(name: string): string {
        return this.getContext().project.resolve(ProjectNameConvention.AssetsDataShard(name));
    }

    private getContext(): WorkspaceContext {
        return this.assetsService.getContext();
    }

    private getUuidService(): UuidService {
        return this.getContext().services.get<UuidService>(Services.Uuid);
    }
}
