import { getInterface } from "@/lib/app/bridge";
import { appPrivilegedFacade } from "@/lib/app/privilegedFacade";
import { RequestStatus } from "@shared/types/ipcEvents";
import { AssetsService } from "../../core/AssetsService";
import { Services, WorkspaceContext } from "../../services";
import { ASSET_CATEGORY_TYPES, AssetCategory, AssetData, AssetExtensions, AssetType, isBundleAssetType } from "../assetTypes";
import { assetTypeMatchesExtension } from "../importPathExpansion";
import { parseSharedBlueprintAssetJson } from "../blueprintAssetSchema";
import { bundleListingFingerprint, detectModelBundleEntry } from "@shared/utils/modelBundle";
import { Asset, AssetSource } from "../types";
import { ProjectNameConvention, isValidAssetStorageId } from "@/lib/workspace/project/nameConvention";
import { FsRequestResult } from "@shared/types/os";
import type { FsTextEncoding } from "@shared/types/textEncoding";
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
        // A bundle is authored as a folder, so it is picked as one. Going through `selectFile` with
        // an extension filter is exactly the behaviour that would import a model as 18 loose assets.
        if (isBundleAssetType(type)) {
            const directories = await getInterface().fs.selectDirectory(true);
            if (!directories.success || !directories.data.ok) {
                return {
                    success: false,
                    error: `Failed to select folders: ${directories.error || (`[${(directories.data as FsRequestResult<string[], false>)?.error.code}] ${(directories.data as FsRequestResult<string[], false>)?.error.message}`)}`,
                };
            }
            return this.importFromPaths(type, directories.data.data);
        }

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
            case AssetType.Model:
                if (!this.assetsService.modelService) {
                    throw new RendererError("Model service not initialized");
                }
                return await this.assetsService.modelService.readLocalModel(asset as Asset<AssetType.Model>) as RequestStatus<AssetData<T>>;
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

        // Delete the payload. A bundle is one asset, so it is one delete: the whole directory goes,
        // never file-by-file - a half-deleted bundle is a model that still lists in the browser and
        // 404s its textures, which is strictly worse than either outcome.
        const assetPath = this.getLocalAssetPath(asset.id);
        const deleteResult = isBundleAssetType(asset.type)
            ? await appPrivilegedFacade.fs.deleteDir(assetPath)
            : await appPrivilegedFacade.fs.deleteFile(assetPath);

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

        if (isBundleAssetType(asset.type)) {
            return this.writeBundleContentFromPath(asset, sourcePath);
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

    /**
     * Overwrite an existing local asset's bytes with `text`, encoded as `encoding`.
     *
     * The text counterpart of {@link writeAssetContentFromPath}, and it exists because until the
     * text editor there was **no** way to create or change an asset's contents without a file
     * already sitting on disk to copy from. Same division of labour: bytes and digest only - the
     * record, the thumbnail cache and the `updated` broadcast belong to
     * {@link AssetsService.writeAssetTextContent}, which has to run them in a fixed order.
     *
     * No format gate, unlike the path-based twin: the bytes are ones Studio itself just produced
     * from a document the author is looking at, so there is nothing to disbelieve. The magic-byte
     * check exists to stop a `.exe` becoming the contents of an image asset, which is a question
     * about a *file the author picked*, not about a save.
     */
    public async writeAssetContentText<T extends AssetType>(
        asset: Asset<T, AssetSource.Local>,
        text: string,
        encoding: FsTextEncoding,
    ): Promise<RequestStatus<AssetContentDigest>> {
        if (!isValidAssetStorageId(asset.id)) {
            return { success: false, error: `Invalid asset id: ${asset.id}` };
        }
        if (isBundleAssetType(asset.type)) {
            return { success: false, error: "A model bundle has no single text payload" };
        }

        const metadata = this.assetsService.getAssetsMetadataManager().getAssets();
        if (!metadata[asset.type][asset.id]) {
            return { success: false, error: `Asset not found: ${asset.id}` };
        }

        const destPath = this.getLocalAssetPath(asset.id);
        const fsService = this.getContext().services.get<FileSystemService>(Services.FileSystem);
        const prepared = await this.ensureAssetShardDir(destPath);
        if (!prepared.success) {
            return prepared as RequestStatus<AssetContentDigest>;
        }

        const written = await fsService.write(destPath, text, encoding);
        if (!written.ok) {
            return { success: false, error: `Failed to write asset text: ${destPath}. ${written.error?.message}` };
        }

        // Recomputed from the destination, exactly as the path-based replace does: the hash is the
        // cache key every downstream reader compares against, and one that did not move means they
        // all keep serving the previous save.
        const hashResult = await appPrivilegedFacade.fs.hash(destPath);
        const fileHash = hashResult.success && hashResult.data.ok ? hashResult.data.data : "";

        return { success: true, data: { hash: fileHash, ext: asset.ext } };
    }

    /**
     * Create a brand-new local asset whose contents are `bytes` rather than a file on disk.
     *
     * Follows {@link importLocalAsset} step for step - uuid, unique display name, write the shard,
     * register the record, announce it - and differs only in where the bytes come from. Empty
     * `bytes` is a legitimate call (a new, empty text file), which is why there is no format gate
     * here: `validateFileFormat` rejects a zero-length file, correctly, for imports.
     */
    public async createLocalAssetFromBytes<T extends AssetType>(
        type: T,
        name: string,
        bytes: Uint8Array,
        groupId?: string,
    ): Promise<RequestStatus<Asset<T, AssetSource.Local>>> {
        if (isBundleAssetType(type)) {
            return { success: false, error: "A model bundle cannot be created from bytes" };
        }

        const id = this.getUuidService().generate();
        const destPath = this.getLocalAssetPath(id);
        const fsService = this.getContext().services.get<FileSystemService>(Services.FileSystem);

        const prepared = await this.ensureAssetShardDir(destPath);
        if (!prepared.success) {
            return prepared as RequestStatus<Asset<T, AssetSource.Local>>;
        }

        const written = await fsService.writeRaw(destPath, bytes);
        if (!written.ok) {
            return { success: false, error: `Failed to write asset contents: ${destPath}. ${written.error?.message}` };
        }

        const hashResult = await appPrivilegedFacade.fs.hash(destPath);
        const fileHash = hashResult.success && hashResult.data.ok ? hashResult.data.data : "";

        const asset: Asset<T, AssetSource.Local> = {
            id,
            type,
            name: this.resolveUniqueAssetName(type, name),
            ext: extname(name).slice(1).toLowerCase(),
            hash: fileHash,
            source: AssetSource.Local,
            meta: {},
            tags: [],
            description: "",
            ...(groupId ? { groupId } : {}),
        };

        const metadata = this.assetsService.getAssetsMetadataManager().getAssets();
        (metadata[type] as Record<string, Asset<T>>)[id] = asset;

        // Unlike `importLocalAsset`, which is always called inside a loop that marks the type dirty
        // once at the end, this is a single-shot creation with no such caller.
        this.assetsService.markDirty(type);
        this.assetsService.getEvents().emit("updated", asset);

        return { success: true, data: asset };
    }

    /** The shard directory for an asset id, created if this is the first asset in that shard. */
    private async ensureAssetShardDir(destPath: string): Promise<RequestStatus<void>> {
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
        return { success: true, data: undefined };
    }

    /**
     * Swap a bundle's whole tree for another folder, keeping the asset id.
     *
     * The old tree is removed first rather than copied over: a merge would leave the previous
     * export's orphaned textures and motions in place, and since the manifest is the only thing that
     * knows which files belong, nothing downstream could ever tell them apart from live ones.
     */
    private async writeBundleContentFromPath<T extends AssetType>(
        asset: Asset<T, AssetSource.Local>,
        sourceDir: string,
    ): Promise<RequestStatus<AssetContentDigest>> {
        const fsService = this.getContext().services.get<FileSystemService>(Services.FileSystem);
        const modelService = this.assetsService.modelService;
        if (!modelService) {
            return { success: false, error: "Model service not initialized" };
        }

        const isDirectory = await fsService.isDirExists(sourceDir);
        if (!isDirectory.ok || !isDirectory.data) {
            return { success: false, error: `A model asset must be replaced with a folder: ${sourceDir}` };
        }

        const destPath = this.getLocalAssetPath(asset.id);
        const existing = await fsService.isDirExists(destPath);
        if (existing.ok && existing.data) {
            const removed = await appPrivilegedFacade.fs.deleteDir(destPath);
            if (!removed.success || !removed.data.ok) {
                return { success: false, error: `Failed to clear the existing bundle: ${destPath}` };
            }
        }

        const copyResult = await appPrivilegedFacade.fs.copyDir(sourceDir, destPath);
        if (!copyResult.success || !copyResult.data.ok) {
            const message = copyResult.error
                || (`[${(copyResult.data as FsRequestResult<void, false>)?.error.code}] ${(copyResult.data as FsRequestResult<void, false>)?.error.message}`);
            return { success: false, error: `Failed to replace model bundle: ${sourceDir} to ${destPath}. ${message}` };
        }

        const listing = await modelService.listBundle(destPath);
        if (!listing.success || !listing.data) {
            return { success: false, error: listing.error ?? "Failed to read the replaced bundle" };
        }

        return { success: true, data: { hash: bundleListingFingerprint(listing.data.files) } };
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
        const isBundle = isBundleAssetType(asset.type);

        const filesystemService = this.getContext().services.get<FileSystemService>(Services.FileSystem);
        // Ensure destination directory exists
        const destDir = dirname(destPath);
        const dirEnsure = await filesystemService.createDir(destDir);
        if (!dirEnsure.ok) {
            return { success: false, error: `Failed to create destination directory: ${dirEnsure.error?.message}` };
        }

        // Check if the source payload exists
        const srcExists = isBundle
            ? await filesystemService.isDirExists(srcPath)
            : await filesystemService.isFileExists(srcPath);
        if (!srcExists.ok || !srcExists.data) {
            return { success: false, error: `Source asset file not found: ${srcPath}` };
        }

        // Copy the payload. `copyDir` for a bundle: the copy has to keep the tree, because the
        // duplicate's manifest still names its siblings by the same relative paths.
        const copyResult = isBundle
            ? await appPrivilegedFacade.fs.copyDir(srcPath, destPath)
            : await appPrivilegedFacade.fs.copyFile(srcPath, destPath);
        if (!copyResult.success || !copyResult.data.ok) {
            const msg = copyResult.error || (copyResult.data as FsRequestResult<void, false>)?.error.message;
            return { success: false, error: `Failed to copy asset file: ${msg}` };
        }

        // Compute hash for the duplicated payload. A bundle has no single-file digest, so it keeps
        // the source record's (see `hashBundle`) rather than inventing one.
        const hashResult = isBundle ? null : await appPrivilegedFacade.fs.hash(destPath);
        const fileHash = hashResult?.success && hashResult.data.ok ? hashResult.data.data : asset.hash;

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

    /**
     * The same expansion, for a whole sidebar category: run once per member type and union the
     * results in member order.
     *
     * A dropped folder under "Media" holds mp3s and mp4s and the author means both, so filtering it
     * by a single type is what would silently import half of it.
     */
    public async expandCategoryImportPaths(
        category: AssetCategory,
        paths: string[]
    ): Promise<ExpandImportPathsResult> {
        const files: string[] = [];
        const seen = new Set<string>();
        let expandedDirectory = false;

        for (const type of ASSET_CATEGORY_TYPES[category]) {
            const expansion = await this.expandImportPaths(type, paths);
            expandedDirectory = expandedDirectory || expansion.expandedDirectory;
            for (const file of expansion.files) {
                if (!seen.has(file)) {
                    seen.add(file);
                    files.push(file);
                }
            }
        }

        return { files, expandedDirectory };
    }

    /**
     * Decide which {@link AssetType} each file in a category import is, and group the paths by it.
     *
     * The category is what the author pointed at; the type is still what the importer, the format
     * validator and the metadata shard need, so the decision has to be made per file and it has to
     * be made here, where the bytes can be read.
     *
     * Extension settles it everywhere but one place: `.json` is claimed by both JSON and Blueprint.
     * The rule there is to try the blueprint parser first and fall back to JSON — a shared blueprint
     * is a *specific* JSON document, so a successful parse is positive evidence, while "it is valid
     * JSON" says nothing either way. `.nlbp` is a blueprint by extension alone.
     *
     * Paths matching no member type are dropped rather than forced into the first one; that is only
     * reachable by dropping files onto a category that does not accept them.
     */
    public async bucketPathsByAssetType(
        category: AssetCategory,
        paths: string[]
    ): Promise<{ type: AssetType; paths: string[] }[]> {
        const memberTypes = ASSET_CATEGORY_TYPES[category];
        const buckets = new Map<AssetType, string[]>(memberTypes.map(type => [type, []]));

        for (const path of paths) {
            const candidates = memberTypes.filter(type => assetTypeMatchesExtension(type, path));
            if (candidates.length === 0) {
                continue;
            }
            const type = candidates.length === 1
                ? candidates[0]
                : await this.disambiguateImportType(candidates, path);
            buckets.get(type)!.push(path);
        }

        return memberTypes
            .map(type => ({ type, paths: buckets.get(type)! }))
            .filter(bucket => bucket.paths.length > 0);
    }

    /**
     * Break a tie between member types that all accept this extension, by reading the file.
     *
     * Only `data`'s JSON/Blueprint pair is ambiguous today. A read failure falls through to the last
     * candidate (the more permissive one), so an unreadable file is refused by the importer with its
     * own error rather than here with a guess.
     */
    private async disambiguateImportType(candidates: AssetType[], path: string): Promise<AssetType> {
        if (candidates.includes(AssetType.Blueprint)) {
            const fsService = this.getContext().services.get<FileSystemService>(Services.FileSystem);
            const read = await fsService.read(path, "utf-8");
            if (read.ok) {
                try {
                    parseSharedBlueprintAssetJson(read.data.replace(/^\uFEFF/, ""));
                    return AssetType.Blueprint;
                } catch {
                    // Valid JSON that is not a shared blueprint, or not JSON at all. Either way the
                    // JSON importer is the one that gets to say so.
                }
            }
            const fallback = candidates.find(candidate => candidate !== AssetType.Blueprint);
            if (fallback) {
                return fallback;
            }
        }
        return candidates[0];
    }

    /**
     * Import one authored folder as one model-bundle asset.
     *
     * The tree is copied verbatim - `copyDir`, no filter, no flattening, no renaming. That is the
     * whole requirement: a model's manifest names its siblings by relative path
     * (`Hiyori.2048/texture_00.png`), so anything that moves, renames or drops a file breaks a
     * reference Studio cannot see and would have to parse the format to repair.
     *
     * Note also that the root listing does not imply the file set - Hiyori's `TapBody` motion is
     * named only inside the manifest - so "copy what looks relevant" is not a thing that can be done
     * correctly here. Everything comes.
     */
    private async importModelBundle<T extends AssetType>(type: T, sourceDir: string): Promise<RequestStatus<Asset<T, AssetSource.Local>>> {
        const fsService = this.getContext().services.get<FileSystemService>(Services.FileSystem);

        const isDirectory = await fsService.isDirExists(sourceDir);
        if (!isDirectory.ok || !isDirectory.data) {
            return { success: false, error: `A model asset must be imported from a folder: ${sourceDir}` };
        }

        const modelService = this.assetsService.modelService;
        if (!modelService) {
            return { success: false, error: "Model service not initialized" };
        }

        // Read the source tree before copying anything, so a folder that is empty or unreadable is
        // refused rather than landing as an asset with no files.
        const sourceListing = await modelService.listBundle(sourceDir);
        if (!sourceListing.success || !sourceListing.data) {
            return { success: false, error: sourceListing.error ?? `Failed to read folder: ${sourceDir}` };
        }
        if (sourceListing.data.files.length === 0) {
            return { success: false, error: `Folder contains no files: ${sourceDir}` };
        }

        const id = this.getUuidService().generate();
        const destPath = this.getLocalAssetPath(id);
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

        const copyResult = await appPrivilegedFacade.fs.copyDir(sourceDir, destPath);
        if (!copyResult.success || !copyResult.data.ok) {
            const message = copyResult.error
                || (`[${(copyResult.data as FsRequestResult<void, false>)?.error.code}] ${(copyResult.data as FsRequestResult<void, false>)?.error.message}`);
            return { success: false, error: `Failed to copy model bundle: ${sourceDir} to ${destPath}. ${message}` };
        }

        // Re-list the copy rather than trusting the source listing: what is on disk under the asset
        // id is what every later read sees, and a copy that silently dropped a file must show up now
        // and not at mount time.
        const listing = await modelService.listBundle(destPath);
        if (!listing.success || !listing.data) {
            return { success: false, error: listing.error ?? "Failed to read the imported bundle" };
        }

        const detection = detectModelBundleEntry(listing.data.files);
        const asset: Asset<T, AssetSource.Local> = {
            id,
            type,
            name: this.resolveUniqueAssetName(type, basename(sourceDir)),
            // No `ext`: the payload is a directory. Deliberately absent rather than empty - see
            // `setAssetExtension`, and the extension migration skips bundle types for the same reason.
            hash: bundleListingFingerprint(listing.data.files),
            source: AssetSource.Local,
            meta: {},
            tags: [],
            description: "",
            // The detected entry is written down at import even though it could be re-derived, so
            // that a later Studio which ranks candidates differently cannot silently re-point an
            // asset the author has already wired into a character. Detection stays the fallback for
            // records that predate this, and for records whose entry file has since been renamed.
            ...(detection.entry ? { extras: { modelEntry: detection.entry } } : {}),
        };

        const metadata = this.assetsService.getAssetsMetadataManager().getAssets();
        (metadata[type] as Record<string, Asset<T>>)[id] = asset;

        this.assetsService.getEvents().emit("updated", asset);

        return { success: true, data: asset };
    }

    private async importLocalAsset<T extends AssetType>(type: T, path: string): Promise<RequestStatus<Asset<T, AssetSource.Local>>> {
        if (isBundleAssetType(type)) {
            return this.importModelBundle(type, path);
        }

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
