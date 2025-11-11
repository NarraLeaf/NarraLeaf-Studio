import { RendererError } from "@shared/utils/error";
import { ProjectNameConvention } from "../../project/nameConvention";
import { AssetData, AssetExtensions, AssetType } from "../assets/assetTypes";
import { Asset, AssetsMap, AssetSource } from "../assets/types";
import { Service } from "../Service";
import { IAssetService, Services, WorkspaceContext } from "../services";
import { FileSystemService } from "./FileSystem";
import { ProjectService } from "./ProjectService";
import { ImageService } from "../assets/ImageService";
import { RequestStatus } from "@shared/types/ipcEvents";
import { getInterface } from "@/lib/app/bridge";
import { FsRejectErrorCode, FsRequestResult } from "@shared/types/os";
import { basename, dirname } from "@shared/utils/path";

export class AssetsService extends Service<AssetsService> implements IAssetService {
    private assetsMetadata: AssetsMap | null = null;
    private imageService: ImageService | null = null;

    protected async init(ctx: WorkspaceContext, depend: (services: Service[]) => Promise<void>): Promise<void> {
        const filesystemService = ctx.services.get<FileSystemService>(Services.FileSystem);
        const projectService = ctx.services.get<ProjectService>(Services.Project);
        await depend([filesystemService, projectService]);

        this.imageService = new ImageService(filesystemService);
        this.assetsMetadata = await this.fetchAssetsMetadata();
    }

    public getAssets(): AssetsMap {
        if (!this.assetsMetadata) {
            throw new RendererError("Assets metadata not initialized");
        }
        return this.assetsMetadata;
    }

    public getMetadata<T extends AssetType>(type: T, name: string): Asset<T> {
        if (!this.assetsMetadata) {
            throw new RendererError("Assets metadata not initialized");
        }
        return this.assetsMetadata[type][name];
    }

    public list<T extends AssetType>(type: T): string[] {
        if (!this.assetsMetadata) {
            throw new RendererError("Assets metadata not initialized");
        }
        return Object.keys(this.assetsMetadata[type]);
    }

    public exists<T extends AssetType>(asset: Asset<T>): boolean {
        if (!this.assetsMetadata) {
            throw new RendererError("Assets metadata not initialized");
        }
        return this.assetsMetadata[asset.type][asset.hash] !== undefined;
    }

    public async fetch<T extends AssetType>(asset: Asset<T>): Promise<RequestStatus<AssetData<T>>> {
        if (asset.source === AssetSource.Local) {
            const path = this.getLocalAssetPath(asset.hash);
            switch (asset.type) {
                case AssetType.Image:
                    if (!this.imageService) {
                        throw new RendererError("Image service not initialized");
                    }
                    return await this.imageService.readLocalImage(path) as RequestStatus<AssetData<T>>;
                default:
                    return {
                        success: false,
                        error: `Failed to fetch asset: ${asset.hash}. Type "${asset.type}" is not supported.`,
                    };
            }
        }

        return {
            success: false,
            error: `Failed to fetch asset: ${asset.hash}. Source "${asset.source}" is not supported.`,
        };
    }

    public async importLocalAssets<T extends AssetType>(type: T): Promise<RequestStatus<RequestStatus<Asset<T, AssetSource.Local>>[]>> {
        const assetExtensions = AssetExtensions[type];
        const files = await getInterface().fs.selectFile(assetExtensions, false);
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

        const writeResult = await this.writeAssetsMetadata(type);
        if (!writeResult.ok) {
            return {
                success: false,
                error: `Failed to write assets metadata: ${`[${writeResult.error.code}] ${writeResult.error.message}`}`,
            };
        }

        return {
            success: true,
            data: results,
        };
    }

    /**
     * Still in development.  
     * Check the integrity of the assets. This is a heavy operation. 
     */
    public async checkIntegrity(): Promise<FsRequestResult<void, false>[]> {
        const results: FsRequestResult<void, false>[] = [];

        for (const type of Object.values(AssetType)) {
            const assets = this.list(type);
            for (const asset of assets) {
                const dest = this.getLocalAssetPath(asset);
                const hashResult = await getInterface().fs.hash(dest);
                if (!hashResult.success) {
                    results.push({
                        ok: false,
                        error: {
                            code: FsRejectErrorCode.UNKNOWN,
                            message: `Failed to hash asset: ${dest}. ${hashResult.error}`,
                        },
                    });
                    continue;
                }
                if (!hashResult.data.ok) {
                    results.push(hashResult.data);
                }
                if ((hashResult.data as FsRequestResult<string, true>).data !== asset) {
                    results.push({
                        ok: false,
                        error: {
                            code: FsRejectErrorCode.HASH_MISMATCH,
                            message: `Hash mismatch for asset: ${dest}. Expected ${(hashResult.data as FsRequestResult<string, true>).data} got ${asset}`,
                        },
                    });
                }
            }
        }

        return results;
    }

    private async importLocalAsset<T extends AssetType>(type: T, path: string): Promise<RequestStatus<Asset<T, AssetSource.Local>>> {
        // prepare hash
        const hashResult = await getInterface().fs.hash(path);
        if (!hashResult.success || !hashResult.data.ok) {
            const message = hashResult.error
                || (`[${(hashResult.data as FsRequestResult<string, false>)?.error.code}] ${(hashResult.data as FsRequestResult<string, false>)?.error.message}`);
            return {
                success: false,
                error: `Failed to hash asset: ${path}. ${message}`,
            };
        }
        const hash = hashResult.data.data;

        // construct asset
        const asset: Asset<T, AssetSource.Local> = {
            type,
            name: basename(path),
            hash,
            source: AssetSource.Local,
            meta: {},
        };

        // copy asset to local
        const destPath = this.getLocalAssetPath(hash);

        const fsService = this.getContext().services.get<FileSystemService>(Services.FileSystem);
        const existCheck = await fsService.isFileExists(destPath);
        if (!existCheck.ok) {
            return {
                success: false,
                error: `Failed to check existing asset file: ${existCheck.error?.message}`,
            } as RequestStatus<Asset<T, AssetSource.Local>>;
        }

        this.assertMetadata();
        const record: Record<string, Asset<T, AssetSource.Local>> = this.assetsMetadata![type];
        if (record[hash]) {
            return {
                success: true,
                data: record[hash] as Asset<T, AssetSource.Local>,
            };
        }

        if (!existCheck.data) {
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
        record[hash] = asset;

        return {
            success: true,
            data: asset,
        };
    }

    private getLocalAssetPath(name: string): string {
        return this.getContext().project.resolve(ProjectNameConvention.AssetsDataShard(name));
    }

    private async fetchAssetsMetadata(): Promise<AssetsMap> {
        // Initialize assets metadata
        await this.initAssetsMetadata();

        const filesystemService = this.getContext().services.get<FileSystemService>(Services.FileSystem);
        const data: AssetsMap = {
            [AssetType.Image]: {},
            [AssetType.Audio]: {},
            [AssetType.Video]: {},
            [AssetType.JSON]: {},
            [AssetType.Font]: {},
            [AssetType.Other]: {},
        };

        for (const type of Object.values(AssetType)) {
            const shardPath = this.getContext().project.resolve(ProjectNameConvention.AssetsMetadataShard(type));
            const shardResult = await filesystemService.readJSON<Record<string, Asset>>(shardPath);
            if (shardResult.ok) {
                Object.assign(data[type], shardResult.data);
            } else {
                throw new RendererError(`Failed to read assets metadata shard: ${shardPath}`);
            }
        }

        return data;
    }

    private async writeAssetsMetadata(type: AssetType): Promise<FsRequestResult<void>> {
        this.assertMetadata();

        const filesystemService = this.getContext().services.get<FileSystemService>(Services.FileSystem);
        const data = JSON.stringify(this.assetsMetadata![type]);

        return await filesystemService.write(this.getContext().project.resolve(ProjectNameConvention.AssetsMetadataShard(type)), data, "utf-8");
    }

    private async initAssetsMetadata(): Promise<void> {
        const filesystemService = this.getContext().services.get<FileSystemService>(Services.FileSystem);
        const files = [
            AssetType.Image, AssetType.Audio, AssetType.Video, AssetType.JSON, AssetType.Font, AssetType.Other,
        ].map(type => this.getContext().project.resolve(ProjectNameConvention.AssetsMetadataShard(type)));

        const tasks = files.map(async file => {
            const existsResult = await filesystemService.isFileExists(file);
            if (!existsResult.ok || !existsResult.data) {
                return filesystemService.write(file, JSON.stringify({}), "utf-8");
            }
            return { ok: true, data: void 0 } satisfies FsRequestResult<void, true>;
        });
        const results = await Promise.all(tasks);
        if (results.some(result => !result.ok)) {
            throw new RendererError(`Failed to read assets metadata shards`);
        }
    }

    private assertMetadata() {
        if (!this.assetsMetadata) {
            throw new RendererError("Assets metadata not initialized");
        }
    }
}
