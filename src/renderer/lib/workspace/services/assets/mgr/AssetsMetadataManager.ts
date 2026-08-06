import { ProjectNameConvention, isValidAssetStorageId } from "@/lib/workspace/project/nameConvention";
import { RendererError } from "@shared/utils/error";
import { FileSystemService } from "../../core/FileSystem";
import { Services, WorkspaceContext } from "../../services";
import { AssetType, categoryOfAssetType, isBundleAssetType } from "../assetTypes";
import { Asset, AssetExtras, AssetResolveMeta, AssetSource, AssetsMap } from "../types";
import { RequestStatus } from "@shared/types/ipcEvents";
import { AssetsService } from "../../core/AssetsService";
import { reconcileAssetOrder } from "../assetOrder";
import { reportWorkspaceAnomaly } from "@/lib/workspace/recovery/anomalyLog";

/**
 * Set an asset's extension, removing the key when there is none.
 *
 * `ext = undefined` and "no `ext`" read the same in TypeScript but are not the same value.
 * `JSON.stringify` drops an `undefined` property silently, while a canonical encoder rejects it by
 * name — so an extensionless asset written the assigning way is a document that saves fine today
 * and refuses to save the moment this shard is serialized canonically.
 */
function setAssetExtension(asset: Asset<AssetType, AssetSource>, ext: string | undefined): void {
    if (ext === undefined) {
        delete asset.ext;
        return;
    }
    asset.ext = ext;
}

export class AssetsMetadataManager {
    public assetsMetadata: AssetsMap | null = null;

    constructor(private assetsService: AssetsService, private context: WorkspaceContext) {
    }

    public getAssets(): AssetsMap {
        if (!this.assetsMetadata) {
            throw new RendererError("Assets metadata not initialized");
        }
        return this.assetsMetadata;
    }

    public list<T extends AssetType>(type: T): string[] {
        return Object.keys(this.getAssets()[type]);
    }

    /**
     * Asset ids of `type` in the order the browser draws them, which shift-range selection reads as
     * the range to cover.
     *
     * Reconciled on every call rather than cached: the stored order is a hint that is always one
     * write behind the record, and an asset the hint has not heard of has to appear regardless.
     *
     * The order file is per *category*, so its `assetIds` may name assets of a sibling type (audio
     * and video share one). Reconciliation drops ids the record does not hold, so asking it for one
     * type's slice of a shared list is exactly what it already does.
     */
    public listOrdered<T extends AssetType>(type: T): string[] {
        return reconcileAssetOrder(
            this.assetsService.getAssetOrderManager().getAssetIds(categoryOfAssetType(type)),
            this.getAssets()[type],
        );
    }

    public getOrderedAssets<T extends AssetType>(type: T): Asset<T, AssetSource>[] {
        const record = this.getAssets()[type];
        return this.listOrdered(type).map(id => record[id]);
    }

    public exists<T extends AssetType>(asset: Asset<T, AssetSource>): boolean {
        return this.getAssets()[asset.type][asset.id] !== undefined;
    }

    async init(): Promise<this> {
        this.assetsMetadata = await this.fetchAssetsMetadata();
        return this;
    }

    public async updateAssetTags<T extends AssetType>(
        asset: Asset<T, AssetSource>,
        tags: string[]
    ): Promise<RequestStatus<void>> {
        const metadata = this.getAssets();
        const existingAsset = metadata[asset.type][asset.id];
        if (!existingAsset) {
            return {
                success: false,
                error: `Asset not found: ${asset.id}`,
            };
        }

        existingAsset.tags = tags;
        this.assetsService.markDirty(asset.type);

        // Emit update event so UI can react
        this.assetsService.getEvents().emit("updated", existingAsset);

        return {
            success: true,
            data: void 0,
        };
    }

    /**
     * Merge editor-authored extras into the asset record (see {@link AssetExtras}).
     * A key set to `undefined` is removed. Persisted with the asset and broadcast as `updated`.
     */
    public async patchAssetExtras<T extends AssetType>(
        asset: Asset<T, AssetSource>,
        patch: Partial<AssetExtras>,
    ): Promise<RequestStatus<void>> {
        const metadata = this.getAssets();
        const existingAsset = metadata[asset.type][asset.id];
        if (!existingAsset) {
            return {
                success: false,
                error: `Asset not found: ${asset.id}`,
            };
        }

        const extras: Record<string, unknown> = { ...(existingAsset.extras ?? {}) };
        for (const [key, value] of Object.entries(patch)) {
            if (value === undefined) {
                delete extras[key];
            } else {
                extras[key] = value;
            }
        }
        existingAsset.extras = extras as AssetExtras;
        this.assetsService.markDirty(asset.type);
        this.assetsService.getEvents().emit("updated", existingAsset);

        return {
            success: true,
            data: void 0,
        };
    }

    public async updateAssetDescription<T extends AssetType>(
        asset: Asset<T, AssetSource>,
        description: string
    ): Promise<RequestStatus<void>> {
        const metadata = this.getAssets();
        const existingAsset = metadata[asset.type][asset.id];
        if (!existingAsset) {
            return {
                success: false,
                error: `Asset not found: ${asset.id}`,
            };
        }

        existingAsset.description = description;
        this.assetsService.markDirty(asset.type);

        // Emit update event so UI can react
        this.assetsService.getEvents().emit("updated", existingAsset);

        return {
            success: true,
            data: void 0,
        };
    }

    public async renameAsset<T extends AssetType>(
        asset: Asset<T, AssetSource>,
        newName: string
    ): Promise<RequestStatus<void>> {
        const metadata = this.getAssets();
        const existingAsset = metadata[asset.type][asset.id];
        if (!existingAsset) {
            return {
                success: false,
                error: `Asset not found: ${asset.id}`,
            };
        }

        existingAsset.name = newName;

        // Update extension if the new name has a different extension
        const nameParts = newName.toLowerCase().split('.');
        const newExtension = nameParts.length > 1 ? nameParts[nameParts.length - 1] : '';
        if (newExtension !== (existingAsset.ext || '')) {
            setAssetExtension(existingAsset, newExtension || undefined);
        }

        this.assetsService.markDirty(asset.type);

        // Emit update event so UI can react
        this.assetsService.getEvents().emit("updated", existingAsset);

        return {
            success: true,
            data: void 0,
        };
    }

    /**
     * Record the digest of freshly replaced bytes on an existing asset record.
     *
     * Deliberately silent: the `updated` broadcast is the last step of
     * {@link AssetsService.replaceAssetContent}, after the thumbnail cache has been dropped. Emitting
     * from here would wake every subscriber while the stale thumbnail PNG is still on disk, and they
     * would redraw the old picture.
     */
    public applyReplacedContent<T extends AssetType>(
        asset: Asset<T, AssetSource>,
        digest: { hash: string; ext?: string },
    ): RequestStatus<Asset<T, AssetSource>> {
        const metadata = this.getAssets();
        const existingAsset = metadata[asset.type][asset.id];
        if (!existingAsset) {
            return {
                success: false,
                error: `Asset not found: ${asset.id}`,
            };
        }

        existingAsset.hash = digest.hash;

        // A png swapped for a jpg keeps its name's base but not its lie about the format; the
        // extension is what the compiler writes into the packaged filename.
        const nextExt = digest.ext || undefined;
        if (nextExt !== existingAsset.ext) {
            setAssetExtension(existingAsset, nextExt);
            existingAsset.name = this.resolveNameForExtension(asset.type, existingAsset.name, existingAsset.id, nextExt);
        }

        this.assetsService.markDirty(asset.type);

        return {
            success: true,
            data: existingAsset,
        };
    }

    /**
     * Record what a refresh learned about a remote asset: always the new provenance, and the new
     * digest only when the bytes actually moved.
     *
     * Splitting those two is the point. A server that answers 304 - or re-serves identical bytes -
     * has told us the snapshot is current, which is worth writing down (`fetchedAt`, and any
     * validators the server has since started sending). Touching `hash` on that path would be a
     * fabricated content change: the version history labels a moved `hash` as "contents replaced",
     * so every no-op refresh would land in the author's change list as edited artwork.
     *
     * Silent, like {@link applyReplacedContent}, and for the same reason.
     */
    public applyRemoteRefresh<T extends AssetType>(
        asset: Asset<T, AssetSource.Remote>,
        meta: AssetResolveMeta<AssetSource.Remote>,
        digest?: { hash: string; ext?: string },
    ): RequestStatus<Asset<T, AssetSource>> {
        const metadata = this.getAssets();
        const existingAsset = metadata[asset.type][asset.id] as Asset<T, AssetSource.Remote> | undefined;
        if (!existingAsset) {
            return { success: false, error: `Asset not found: ${asset.id}` };
        }

        existingAsset.meta = meta;
        if (digest) {
            return this.applyReplacedContent(existingAsset, digest);
        }

        this.assetsService.markDirty(asset.type);
        return { success: true, data: existingAsset };
    }

    /**
     * Swap the extension on a display name, keeping it unique within the type (names are the handle
     * authors use; two `bg.jpg` rows would be indistinguishable).
     */
    private resolveNameForExtension<T extends AssetType>(
        type: T,
        currentName: string,
        assetId: string,
        newExt: string | undefined,
    ): string {
        const extIndex = currentName.lastIndexOf(".");
        const base = extIndex > 0 ? currentName.slice(0, extIndex) : currentName;
        const suffix = newExt ? `.${newExt}` : "";
        const taken = new Set(
            Object.values(this.getAssets()[type])
                .filter(candidate => candidate.id !== assetId)
                .map(candidate => candidate.name),
        );

        const desired = `${base}${suffix}`;
        if (!taken.has(desired)) {
            return desired;
        }

        let counter = 1;
        let candidate = `${base}-${counter}${suffix}`;
        while (taken.has(candidate)) {
            counter += 1;
            candidate = `${base}-${counter}${suffix}`;
        }
        return candidate;
    }

    private async initAssetsMetadata(): Promise<void> {
        const filesystemService = this.getContext().services.get<FileSystemService>(Services.FileSystem);
        const files = Object.values(AssetType).map(type => ({
            type,
            path: this.getContext().project.resolve(ProjectNameConvention.AssetsMetadataShard(type)),
        }));

        const tasks = files.map(file => filesystemService.ensureRegularFile(file.path, JSON.stringify({}), "utf-8"));
        const results = await Promise.all(tasks);
        const failedIndex = results.findIndex(result => !result.ok);
        if (failedIndex >= 0) {
            const failed = results[failedIndex];
            const file = files[failedIndex];
            if (!failed.ok) {
                // Reported before it is thrown, because the throw becomes the workspace's startup
                // error and that screen shows one message: whichever shard failed first. The record
                // keeps the per-file detail that the summary is about to flatten.
                reportWorkspaceAnomaly({
                    source: "assets",
                    operationKey: "workspace.recovery.operations.assetsShardCreate",
                    path: file.path,
                    error: failed.error,
                    severity: "fatal",
                });
                throw new RendererError(
                    `Failed to initialize assets metadata shard (${file.type}): ${file.path}: ${failed.error.code} ${failed.error.message}`
                );
            }
        }
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
            [AssetType.Blueprint]: {},
            [AssetType.Font]: {},
            [AssetType.Model]: {},
            [AssetType.Other]: {},
        };

        for (const type of Object.values(AssetType)) {
            const shardPath = this.getContext().project.resolve(ProjectNameConvention.AssetsMetadataShard(type));
            const shardResult = await filesystemService.readJSON<Record<string, Asset>>(shardPath);
            if (shardResult.ok) {
                this.assignValidAssets(data[type], shardResult.data, type, shardPath);
            } else {
                // readJSON failed (file missing or invalid JSON) – attempt manual recovery
                const rawResult = await filesystemService.read(shardPath, "utf-8");
                let parsed: Record<string, Asset> | null = null;
                // Kept rather than discarded: `readJSON` reports its failure as a flat
                // "Failed to parse JSON from <path>", while this one carries the position and the
                // token - the difference between knowing the file is broken and knowing a write was
                // truncated at byte 41273.
                let parseError: unknown = null;
                if (rawResult.ok) {
                    try {
                        parsed = JSON.parse(rawResult.data);
                    } catch (error) {
                        parsed = null;
                        parseError = error;
                    }
                } else {
                    parseError = rawResult.error;
                }

                if (parsed) {
                    this.assignValidAssets(data[type], parsed, type, shardPath);
                } else {
                    // The one that most needed saying and never did. What happens next is that this
                    // asset type comes back EMPTY and the file behind it is replaced: to the author
                    // every image in the project has vanished, with nothing on screen connecting
                    // that to a JSON file that would not parse. The parse failure - the position in
                    // the file, the unexpected token - is the only thing that says whether this is a
                    // truncated write, a merge left in the file, or something that was never JSON.
                    reportWorkspaceAnomaly({
                        source: "assets",
                        operationKey: "workspace.recovery.operations.assetsShardRead",
                        path: shardPath,
                        error: parseError ?? shardResult.error,
                        severity: "degraded",
                    });
                    console.warn(`AssetsService: metadata shard corrupted, backing up and resetting: ${shardPath}`);
                    const recoveryResult = await filesystemService.recoverCorruptedJsonFile(shardPath, JSON.stringify({}), "utf-8");
                    if (!recoveryResult.ok) {
                        console.warn(`AssetsService: failed to recover corrupted metadata shard: ${shardPath}`, recoveryResult.error);
                    }
                }
            }
        }

        // Migration: ensure all assets have ext field set
        this.migrateAssetExtensions(data);

        return data;
    }

    private assignValidAssets<T extends AssetType>(
        target: Record<string, Asset<T, AssetSource>>,
        source: Record<string, Asset>,
        type: T,
        shardPath: string
    ): void {
        for (const [id, asset] of Object.entries(source)) {
            if (!this.isValidMetadataAsset(id, asset, type)) {
                console.warn(`AssetsService: ignoring invalid asset metadata entry in ${shardPath}: ${id}`);
                continue;
            }

            target[id] = asset;
        }
    }

    private isValidMetadataAsset<T extends AssetType>(
        id: string,
        asset: Asset | undefined,
        type: T
    ): asset is Asset<T, AssetSource> {
        return Boolean(
            asset
            && isValidAssetStorageId(id)
            && asset.id === id
            && isValidAssetStorageId(asset.id)
            && asset.type === type
            && Object.values(AssetSource).includes(asset.source)
        );
    }

    private migrateAssetExtensions(data: AssetsMap): void {
        let hasChanges = false;

        for (const type of Object.values(AssetType)) {
            // A model bundle is a directory: it has no extension, and deriving one from its display
            // name would invent `ext: "2048"` for a folder called `Hiyori.2048` and then mark the
            // shard dirty on every single open trying to re-apply it.
            if (isBundleAssetType(type)) {
                continue;
            }
            for (const asset of Object.values(data[type])) {
                if (asset && asset.ext === undefined) {
                    // Extract extension from filename
                    const nameParts = asset.name.toLowerCase().split('.');
                    const extension = nameParts.length > 1 ? nameParts[nameParts.length - 1] : '';
                    setAssetExtension(asset, extension || undefined);
                    hasChanges = true;
                }
            }
        }

        // Mark all types as dirty if we made changes so they get saved
        if (hasChanges) {
            for (const type of Object.values(AssetType)) {
                this.assetsService.markDirty(type);
            }
        }
    }

    private getContext(): WorkspaceContext {
        return this.context;
    }
}
