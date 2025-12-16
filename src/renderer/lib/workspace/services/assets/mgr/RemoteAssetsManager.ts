import { RequestStatus } from "@shared/types/ipcEvents";
import { RendererError } from "@shared/utils/error";
import { basename, extname } from "@shared/utils/path";
import { AssetsService } from "../../core/AssetsService";
import { Services, WorkspaceContext } from "../../services";
import { AssetData, AssetType } from "../assetTypes";
import { Asset, AssetResolveMeta, AssetSource } from "../types";
import { EditorRemoteCacheManager } from "./EditorRemoteCacheManager";
import { UuidService } from "../../core/UuidService";

const DEFAULT_RUNTIME_LIFETIME_MS = 0;

export class RemoteAssetsManager {
    constructor(
        private readonly assetsService: AssetsService,
        private readonly context: WorkspaceContext,
        private readonly cache: EditorRemoteCacheManager,
    ) {}

    async init(): Promise<this> {
        return this;
    }

    public async importRemoteAsset<T extends AssetType>(type: T, remoteUrl: string): Promise<RequestStatus<Asset<T, AssetSource.Remote>>> {
        let parsed: URL;
        try {
            parsed = new URL(remoteUrl);
        } catch {
            return { success: false, error: "Invalid remote URL" };
        }

        const id = this.getUuidService().generate();
        const name = this.resolveUniqueName(type, parsed);
        const asset: Asset<T, AssetSource.Remote> = {
            id,
            type,
            name,
            ext: this.extractExtension(name),
            hash: "",
            source: AssetSource.Remote,
            meta: this.buildRemoteMeta(parsed),
            tags: [],
            description: "",
        };

        const metadata = this.assetsService.getAssetsMetadataManager().getAssets();
        (metadata[type] as Record<string, Asset<T, AssetSource>>)[id] = asset;
        this.assetsService.markDirty(type);
        this.assetsService.getEvents().emit("updated", asset);

        return { success: true, data: asset };
    }

    public async fetch<T extends AssetType>(asset: Asset<T, AssetSource.Remote>): Promise<RequestStatus<AssetData<T>>> {
        const bufferResult = await this.cache.fetch(asset.id, asset.meta.url);
        if (!bufferResult.success || !bufferResult.data) {
            return { success: false, error: bufferResult.error || "Failed to fetch remote asset" };
        }

        const buffer = bufferResult.data;
        switch (asset.type) {
            case AssetType.Image:
                this.assertService(this.assetsService.imageService, "Image");
                return this.assetsService.imageService.readImageFromBuffer(asset as Asset<AssetType.Image>, buffer) as Promise<RequestStatus<AssetData<T>>>;
            case AssetType.Audio:
                this.assertService(this.assetsService.audioService, "Audio");
                return this.assetsService.audioService.readAudioFromBuffer(asset as Asset<AssetType.Audio>, buffer) as Promise<RequestStatus<AssetData<T>>>;
            case AssetType.Video:
                this.assertService(this.assetsService.videoService, "Video");
                return this.assetsService.videoService.readVideoFromBuffer(asset as Asset<AssetType.Video>, buffer) as Promise<RequestStatus<AssetData<T>>>;
            case AssetType.JSON:
                this.assertService(this.assetsService.jsonService, "JSON");
                return this.assetsService.jsonService.readJSONFromBuffer(buffer) as Promise<RequestStatus<AssetData<T>>>;
            case AssetType.Font:
                this.assertService(this.assetsService.fontService, "Font");
                return this.assetsService.fontService.readFontFromBuffer(asset as Asset<AssetType.Font>, buffer) as Promise<RequestStatus<AssetData<T>>>;
            case AssetType.Other:
                this.assertService(this.assetsService.otherService, "Other");
                return this.assetsService.otherService.readOtherFromBuffer(asset as Asset<AssetType.Other>, buffer) as Promise<RequestStatus<AssetData<T>>>;
            default:
                return { success: false, error: `Unsupported asset type: ${asset.type}` };
        }
    }

    public async deleteAsset<T extends AssetType>(asset: Asset<T, AssetSource.Remote>): Promise<RequestStatus<void>> {
        const metadata = this.assetsService.getAssetsMetadataManager().getAssets();
        if (!metadata[asset.type][asset.id]) {
            return { success: false, error: `Asset not found: ${asset.id}` };
        }

        delete metadata[asset.type][asset.id];
        this.assetsService.markDirty(asset.type);
        await this.cache.evict(asset.id);
        this.assetsService.getEvents().emit("deleted", asset);

        return { success: true, data: void 0 };
    }

    private resolveUniqueName<T extends AssetType>(type: T, url: URL): string {
        const candidate = basename(url.pathname) || url.hostname || "remote-asset";
        const metadata = this.assetsService.getAssetsMetadataManager().getAssets();
        const record = metadata[type];
        const existing = new Set(Object.values(record).map(a => a.name));

        if (!existing.has(candidate)) {
            return candidate;
        }

        const dotIndex = candidate.lastIndexOf(".");
        const base = dotIndex >= 0 ? candidate.slice(0, dotIndex) : candidate;
        const ext = dotIndex >= 0 ? candidate.slice(dotIndex) : "";
        let counter = 1;
        let name = `${base}-${counter}${ext}`;
        while (existing.has(name)) {
            counter += 1;
            name = `${base}-${counter}${ext}`;
        }
        return name;
    }

    private extractExtension(name: string): string | undefined {
        const extension = extname(name).replace(".", "").toLowerCase();
        return extension || undefined;
    }

    private buildRemoteMeta(url: URL): AssetResolveMeta<AssetSource.Remote> {
        return {
            url: url.toString(),
            lifetime: DEFAULT_RUNTIME_LIFETIME_MS,
            protocol: url.protocol.replace(":", ""),
            hostname: url.hostname,
            path: url.pathname,
            query: url.searchParams.toString(),
            hash: url.hash,
            search: url.search,
            searchParams: Object.fromEntries(url.searchParams.entries()),
        };
    }

    private assertService<T>(svc: T | null | undefined, name: string): asserts svc is T {
        if (!svc) {
            throw new RendererError(`${name} service not initialized`);
        }
    }

    private getUuidService(): UuidService {
        return this.context.services.get<UuidService>(Services.Uuid);
    }
}

