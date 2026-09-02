import { ProjectNameConvention, isValidAssetStorageId } from "@/lib/workspace/project/nameConvention";
import { RendererError } from "@shared/utils/error";
import { FsRejectErrorCode } from "@shared/types/os";
import { quarantinePathFor } from "@shared/documents/documentIo";
import { DocumentCorruptError } from "@shared/documents/types";
import { reportUnreadableDocument } from "../../autosave/SaveStatusService";
import { FileSystemService } from "../../core/FileSystem";
import { RendererDocumentStorage } from "../../core/DocumentStorage";
import { Services, WorkspaceContext } from "../../services";
import { AssetType, categoryOfAssetType, isBundleAssetType } from "../assetTypes";
import { Asset, AssetExtras, AssetResolveMeta, AssetSource, AssetsMap } from "../types";
import { RequestStatus } from "@shared/types/ipcEvents";
import { AssetsService } from "../../core/AssetsService";
import { reconcileAssetOrder } from "../assetOrder";
import { reportWorkspaceAnomaly } from "@/lib/workspace/recovery/anomalyLog";

/**
 * A metadata shard that is on disk and could not be read.
 *
 * The record the library keeps in place of the shard's contents. Its type comes up with no assets
 * in memory, which is not the same as having none: the file is still there, holding every record
 * this open could not parse, and the one thing that must not happen to it is a write. So the shard
 * is latched read-only for the life of the manager (`AssetsService.writeAssetsMetadata` refuses it,
 * and the section's order file with it), the panel says so in the section it belongs to, and the
 * recovery offer the anomaly raises is the way to look at the file.
 *
 * The same rule the spec-based loaders apply (`loadDocument` in `@shared/documents`): the bytes are
 * copied aside as evidence, the failure is reported, and the file is left exactly as it was found.
 */
export interface UnreadableAssetShard {
    readonly type: AssetType;
    /** The shard, as an absolute path - what the anomaly names and the notice shows the name of. */
    readonly path: string;
    /** The failure in one line: the parse error's own message, position and token included. */
    readonly reason: string;
    /** Where the bytes were copied, project-relative, or `null` when the copy failed as well. */
    readonly quarantinePath: string | null;
}

/**
 * One line naming what went wrong, for the record above and for the notice built from it.
 *
 * `JSON.parse` throws a `SyntaxError` whose message carries the position; the filesystem bridge
 * rejects with `{code, message}`. Both are wanted verbatim, minus the stack the anomaly log keeps.
 */
function describeShardFailure(error: unknown): string {
    if (error instanceof Error) {
        return `${error.name}: ${error.message}`;
    }
    if (error && typeof error === "object" && typeof (error as { message?: unknown }).message === "string") {
        const record = error as { code?: unknown; message: string };
        return typeof record.code === "string" ? `${record.code}: ${record.message}` : record.message;
    }
    return String(error);
}

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
    /**
     * The shards this open found on disk and could not read, by type. See
     * {@link UnreadableAssetShard} for what being in here means; filled once, by {@link init}.
     */
    private readonly unreadableShards = new Map<AssetType, UnreadableAssetShard>();

    constructor(private assetsService: AssetsService, private context: WorkspaceContext) {
    }

    public getAssets(): AssetsMap {
        if (!this.assetsMetadata) {
            throw new RendererError("Assets metadata not initialized");
        }
        return this.assetsMetadata;
    }

    /** Every shard that is on disk and could not be read. Empty for a healthy library. */
    public getUnreadableShards(): ReadonlyMap<AssetType, UnreadableAssetShard> {
        return this.unreadableShards;
    }

    /**
     * Whether `type`'s shard is latched read-only because it could not be read.
     *
     * The question every writer of the shard has to ask first: the in-memory record for such a
     * type is empty, and writing it would replace the author's file with `{}`.
     */
    public isShardUnreadable(type: AssetType): boolean {
        return this.unreadableShards.has(type);
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

    /**
     * Edit one record, and let the service decide where it goes.
     *
     * **The one shape every record mutator below has**, and it is not merely tidiness: the edit is
     * applied to the live record so that `AssetsService.recordChanged` can be handed the record as it
     * WOULD have been written rather than the patch that was asked for, and put back untouched if
     * something else has taken it. A mutator that wrote the shard itself would be an edit a live
     * session never hears about, landing on one machine and nowhere else.
     */
    private editRecord<T extends AssetType>(
        asset: Asset<T, AssetSource>,
        edit: (record: Asset<AssetType, AssetSource>) => void,
    ): RequestStatus<void> {
        const existingAsset = this.getAssets()[asset.type][asset.id] as Asset<AssetType, AssetSource> | undefined;
        if (!existingAsset) {
            return {
                success: false,
                error: `Asset not found: ${asset.id}`,
            };
        }

        const previous = JSON.parse(JSON.stringify(existingAsset)) as Asset<AssetType, AssetSource>;
        edit(existingAsset);
        // Marks the shard dirty and announces `updated` on the branch where the edit stays here; on
        // the other the record has already been put back and the row moves when the effect arrives.
        this.assetsService.recordChanged(existingAsset, previous);

        return {
            success: true,
            data: void 0,
        };
    }

    public async updateAssetTags<T extends AssetType>(
        asset: Asset<T, AssetSource>,
        tags: string[]
    ): Promise<RequestStatus<void>> {
        return this.editRecord(asset, record => {
            record.tags = tags;
        });
    }

    /**
     * Merge editor-authored extras into the asset record (see {@link AssetExtras}).
     * A key set to `undefined` is removed. Persisted with the asset and broadcast as `updated`.
     */
    public async patchAssetExtras<T extends AssetType>(
        asset: Asset<T, AssetSource>,
        patch: Partial<AssetExtras>,
    ): Promise<RequestStatus<void>> {
        return this.editRecord(asset, record => {
            const extras: Record<string, unknown> = { ...(record.extras ?? {}) };
            for (const [key, value] of Object.entries(patch)) {
                if (value === undefined) {
                    delete extras[key];
                } else {
                    extras[key] = value;
                }
            }
            record.extras = extras as AssetExtras;
        });
    }

    public async updateAssetDescription<T extends AssetType>(
        asset: Asset<T, AssetSource>,
        description: string
    ): Promise<RequestStatus<void>> {
        return this.editRecord(asset, record => {
            record.description = description;
        });
    }

    public async renameAsset<T extends AssetType>(
        asset: Asset<T, AssetSource>,
        newName: string
    ): Promise<RequestStatus<void>> {
        return this.editRecord(asset, record => {
            record.name = newName;

            // Update extension if the new name has a different extension
            const nameParts = newName.toLowerCase().split('.');
            const newExtension = nameParts.length > 1 ? nameParts[nameParts.length - 1] : '';
            if (newExtension !== (record.ext || '')) {
                setAssetExtension(record, newExtension || undefined);
            }
        });
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
                } else if (rawResult.ok) {
                    await this.setAsideUnreadableShard(type, shardPath, rawResult.data, parseError ?? shardResult.error);
                } else if (rawResult.error.code === FsRejectErrorCode.NOT_FOUND) {
                    // No file at all, which is not the same as a file that will not parse.
                    // `initAssetsMetadata` creates a missing shard as `{}` before this loop runs, so
                    // the only way to be here is that creation having been refused - a frozen
                    // workspace, or a revision being shown. Recorded, because the library still
                    // comes up short of what the project holds, but not latched read-only: there
                    // are no bytes for a later write to destroy.
                    reportWorkspaceAnomaly({
                        source: "assets",
                        operationKey: "workspace.recovery.operations.assetsShardRead",
                        path: shardPath,
                        error: rawResult.error,
                        severity: "degraded",
                    });
                } else {
                    // The file is there and could not be read at all: no permission, a bad sector,
                    // a directory where a file should be. Latched like a parse failure, because the
                    // reason to refuse a write is the same - the record is empty and the file is
                    // not - but nothing is set aside: there are no bytes to set aside, and an I/O
                    // failure is not corruption.
                    await this.setAsideUnreadableShard(type, shardPath, null, parseError ?? shardResult.error);
                }
            }
        }

        // Migration: ensure all assets have ext field set
        this.migrateAssetExtensions(data);

        return data;
    }

    /**
     * A shard is on disk and does not parse: keep the evidence, say so, and touch nothing.
     *
     * This used to back the file up and write `{}` over it. To the author that was every image in
     * the project vanishing on open with nothing on screen to connect it to a JSON file that would
     * not parse - and the open itself had already destroyed the file the error was about. So the
     * file now stays exactly as it was found, the type comes up empty and read-only (see
     * {@link UnreadableAssetShard}), and the anomaly is what raises the recovery offer.
     *
     * The bytes are copied to `.nlstudio/quarantine/<stamp>/assets/...`, the same place and the
     * same layout the spec-based loaders use, and the copy is byte-for-byte for the reason
     * `DocumentStorage.copy` gives: a truncated write can cut a multi-byte sequence in half, and a
     * copy that went through a string would not be the file. A copy that fails is reported and is
     * not a reason to stop: the file is still on disk, and the report is still true.
     *
     * `text` is what was read, and `null` when nothing could be. Only the first kind is corruption:
     * a file that could not be read at all is latched all the same, but there is nothing to
     * quarantine and nothing for the author to be shown the contents of.
     *
     * The parse failure - the position in the file, the unexpected token - is the only thing that
     * says whether this is a truncated write, a merge left in the file, or something that was never
     * JSON, which is why the anomaly carries it rather than `readJSON`'s flat summary.
     */
    private async setAsideUnreadableShard(
        type: AssetType,
        shardPath: string,
        text: string | null,
        error: unknown,
    ): Promise<void> {
        reportWorkspaceAnomaly({
            source: "assets",
            operationKey: "workspace.recovery.operations.assetsShardRead",
            path: shardPath,
            error,
            severity: "degraded",
        });

        const relativePath = ProjectNameConvention.AssetsMetadataShard(type).join("/");
        const reason = describeShardFailure(error);
        let quarantinePath: string | null = null;
        if (text !== null) {
            try {
                const target = quarantinePathFor(relativePath, new Date());
                await this.documentStorage().copy(relativePath, target);
                quarantinePath = target;
            } catch (failure) {
                console.warn(`AssetsService: could not set aside a copy of the unreadable metadata shard ${shardPath}:`, failure);
            }
        }

        this.unreadableShards.set(type, {
            type,
            path: shardPath,
            reason,
            quarantinePath,
        });

        // The same channel a story or a character that will not parse goes out on: a line in the
        // workspace's Storage console and one sticky notice naming the file, saying that it is
        // unchanged and where the copy is. An asset shard is not loaded through `loadDocument` -
        // it predates the document port - but what the author needs to be told about it is
        // identical, and two vocabularies for one fact is how they come to disagree.
        if (text !== null) {
            reportUnreadableDocument(this.getContext(), {
                error: new DocumentCorruptError({ kind: "assets-metadata", path: relativePath, reason, text, cause: error }),
                quarantinePath,
            });
        }

        console.warn(
            `AssetsService: metadata shard could not be read and is left as found: ${shardPath}`
            + (quarantinePath ? ` (copy at ${quarantinePath})` : ""),
        );
    }

    /**
     * The project's documents as the quarantine copy needs them: project-relative paths, parent
     * directories created on demand, and a refusal to copy while a revision is being shown -
     * the bytes that failed to parse were the revision's then, not the file's.
     */
    private documentStorage(): RendererDocumentStorage {
        return new RendererDocumentStorage(
            this.getContext().services.get<FileSystemService>(Services.FileSystem),
            this.getContext().project.getConfig().projectPath,
        );
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
        const changedTypes = new Set<AssetType>();

        for (const type of Object.values(AssetType)) {
            // A model bundle is a directory: it has no extension, and deriving one from its display
            // name would invent `ext: "2048"` for a folder called `Hiyori.2048` and then mark the
            // shard dirty on every single open trying to re-apply it.
            if (isBundleAssetType(type)) {
                continue;
            }
            for (const asset of Object.values(data[type])) {
                if (!asset || asset.ext !== undefined) {
                    continue;
                }
                // The extension the display name carries, when it carries one. A name with no dot
                // in it - which is what a shipped template's assets have - leaves the field absent
                // and the record untouched: writing `undefined` over `undefined` changed nothing
                // but marked every asset shard dirty, so a project full of such assets rewrote its
                // whole library on every open.
                const nameParts = asset.name.toLowerCase().split('.');
                const extension = nameParts.length > 1 ? nameParts[nameParts.length - 1] : '';
                if (!extension) {
                    continue;
                }
                setAssetExtension(asset, extension);
                changedTypes.add(type);
            }
        }

        // Only the shards that changed. This used to mark every type on any change, which was
        // harmless while every shard was writable and is not now: a shard that could not be read
        // would be queued for a write it is going to refuse, and the author told their edit was
        // not saved when they had made none.
        for (const type of changedTypes) {
            this.assetsService.markDirty(type);
        }
    }

    private getContext(): WorkspaceContext {
        return this.context;
    }
}
