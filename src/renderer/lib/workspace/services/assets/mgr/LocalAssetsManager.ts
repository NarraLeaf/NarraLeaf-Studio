import { getInterface } from "@/lib/app/bridge";
import { RequestStatus } from "@shared/types/ipcEvents";
import { AssetsService } from "../../core/AssetsService";
import { Services, WorkspaceContext } from "../../services";
import { AssetData, AssetExtensions, AssetType } from "../assetTypes";
import { Asset, AssetSource } from "../types";
import { ProjectNameConvention } from "@/lib/workspace/project/nameConvention";
import { FsRequestResult } from "@shared/types/os";
import { FileSystemService } from "../../core/FileSystem";
import { RendererError } from "@shared/utils/error";
import { basename, dirname } from "@shared/utils/path";

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

    public async fetch<T extends AssetType>(asset: Asset<T>): Promise<RequestStatus<AssetData<T>>> {
        if (asset.source === AssetSource.Local) {
            const path = this.getLocalAssetPath(asset.id);
            switch (asset.type) {
                case AssetType.Image:
                    if (!this.assetsService.imageService) {
                        throw new RendererError("Image service not initialized");
                    }
                    return await this.assetsService.imageService.readLocalImage(path) as RequestStatus<AssetData<T>>;
                case AssetType.Audio:
                    if (!this.assetsService.audioService) {
                        throw new RendererError("Audio service not initialized");
                    }
                    return await this.assetsService.audioService.readLocalAudio(path) as RequestStatus<AssetData<T>>;
                case AssetType.Video:
                    if (!this.assetsService.videoService) {
                        throw new RendererError("Video service not initialized");
                    }
                    return await this.assetsService.videoService.readLocalVideo(path) as RequestStatus<AssetData<T>>;
                case AssetType.JSON:
                    if (!this.assetsService.jsonService) {
                        throw new RendererError("JSON service not initialized");
                    }
                    return await this.assetsService.jsonService.readLocalJSON(path) as RequestStatus<AssetData<T>>;
                case AssetType.Font:
                    if (!this.assetsService.fontService) {
                        throw new RendererError("Font service not initialized");
                    }
                    return await this.assetsService.fontService.readLocalFont(path) as RequestStatus<AssetData<T>>;
                case AssetType.Other:
                    if (!this.assetsService.otherService) {
                        throw new RendererError("Other service not initialized");
                    }
                    return await this.assetsService.otherService.readLocalOther(path) as RequestStatus<AssetData<T>>;
                default:
                    return {
                        success: false,
                        error: `Failed to fetch asset: ${asset.id}. Type "${asset.type}" is not supported.`,
                    };
            }
        }

        return {
            success: false,
            error: `Failed to fetch asset: ${asset.id}. Source "${asset.source}" is not supported.`,
        };
    }

    public async deleteAsset<T extends AssetType>(
        asset: Asset<T>
    ): Promise<RequestStatus<void>> {
        const metadata = this.assetsService.getAssetsMetadataManager().getAssets();

        if (!metadata[asset.type][asset.id]) {
            return {
                success: false,
                error: `Asset not found: ${asset.id}`,
            };
        }

        // Delete asset file
        const assetPath = this.getLocalAssetPath(asset.id);
        const deleteResult = await getInterface().fs.deleteFile(assetPath);
        
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

    public async duplicateAsset<T extends AssetType>(asset: Asset<T>): Promise<RequestStatus<Asset<T, AssetSource.Local>>> {
        const metadata = this.assetsService.getAssetsMetadataManager().getAssets();

        // Ensure asset exists
        const existing = metadata[asset.type][asset.id];
        if (!existing) {
            return { success: false, error: `Asset not found: ${asset.id}` };
        }

        // Generate new uuid and resolve unique name
        const newId = crypto.randomUUID();
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
        const copyResult = await getInterface().fs.copyFile(srcPath, destPath);
        if (!copyResult.success || !copyResult.data.ok) {
            const msg = copyResult.error || (copyResult.data as FsRequestResult<void, false>)?.error.message;
            return { success: false, error: `Failed to copy asset file: ${msg}` };
        }

        // Compute hash for the duplicated file
        const hashResult = await getInterface().fs.hash(destPath);
        const fileHash = hashResult.success && hashResult.data.ok ? hashResult.data.data : asset.hash;

        // Create metadata
        const newAsset: Asset<T, AssetSource.Local> = {
            ...asset,
            id: newId,
            hash: fileHash,
            name: uniqueName,
            source: AssetSource.Local,
        };

        // Save metadata
        (metadata[asset.type] as Record<string, Asset<T>>)[newId] = newAsset as Asset<T>;
        this.assetsService.markDirty(asset.type);

        return { success: true, data: newAsset };
    }

    public async importFromPaths<T extends AssetType>(
        type: T,
        paths: string[]
    ): Promise<RequestStatus<RequestStatus<Asset<T, AssetSource.Local>>[]>> {
        const results: RequestStatus<Asset<T, AssetSource.Local>>[] = [];
        
        for (const path of paths) {
            results.push(await this.importLocalAsset(type, path));
        }

        this.assetsService.markDirty(type);

        return {
            success: true,
            data: results,
        };
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
        const hashResult = await getInterface().fs.hash(path);
        const fileHash = hashResult.success && hashResult.data.ok ? hashResult.data.data : "";

        // generate unique id for storage / indexing
        const id = crypto.randomUUID();

        // resolve unique display name (e.g. "image.png", "image-1.png")
        const originalName = basename(path);
        const uniqueName = this.resolveUniqueAssetName(type, originalName);

        // construct asset metadata
        const asset: Asset<T, AssetSource.Local> = {
            id,
            type,
            name: uniqueName,
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
        const record: Record<string, Asset<T, AssetSource.Local>> = metadata[type];
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

            const copyResult = await getInterface().fs.copyFile(path, destPath);
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
}
