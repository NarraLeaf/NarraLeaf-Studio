import { getInterface } from "@/lib/app/bridge";
import { appPrivilegedFacade } from "@/lib/app/privilegedFacade";
import { getProjectWriteFreeze, isProjectWriteReloadHeld } from "@/lib/app/writeFreeze";
import { ProjectNameConvention, isValidAssetStorageId } from "@/lib/workspace/project/nameConvention";
import { RequestStatus } from "@shared/types/ipcEvents";
import type { MediaProbeOutcome } from "@shared/types/mediaProbe";
import type { RemoteAssetBytes, RemoteAssetValidators } from "@shared/types/remoteAsset";
import type { MediaSupportVerdict } from "@shared/utils/mediaSupport";
import { basename, dirname, extname } from "@shared/utils/path";
import { AssetsService } from "../../core/AssetsService";
import { FileSystemService } from "../../core/FileSystem";
import { UuidService } from "../../core/UuidService";
import { Services, WorkspaceContext } from "../../services";
import { ASSET_CATEGORY_TYPES, AssetCategory, AssetExtensions, AssetType, isBundleAssetType } from "../assetTypes";
import { assetTypeMatchesExtension } from "../importPathExpansion";
import { parseSharedBlueprintAssetJson } from "../blueprintAssetSchema";
import { Asset, AssetResolveMeta, AssetSource } from "../types";
import type { AssetContentDigest } from "./LocalAssetsManager";

/**
 * Remote assets: a URL the author pinned, plus the bytes that URL served.
 *
 * The bytes are written to the **ordinary content shard** (`assets/content/<shard>`), exactly where a
 * local asset's live, and they are under version control like any other asset content. That single
 * decision is what the rest of the system rests on: on disk a remote asset is indistinguishable from
 * a local one, so the build, the lint rules, the thumbnail cache and the asset overview need no
 * remote case at all, and a collaborator who clones the project has the bytes rather than a URL and
 * an internet connection.
 *
 * What stays different is provenance ({@link AssetResolveMeta}) and one verb: {@link refresh} asks
 * the server whether the snapshot is still current.
 *
 * This is deliberately *not* runtime fetching. A shipped game has no URL for its assets - the pack
 * manifest carries none - and adding one would put content outside the reach of asset encryption.
 * See docs/plans/2026-08-05-003-plan-remote-asset-pinning.md §1.3.
 */
export class RemoteAssetsManager {
    constructor(
        private readonly assetsService: AssetsService,
        private readonly context: WorkspaceContext,
    ) {}

    async init(): Promise<this> {
        return this;
    }

    /**
     * Import a URL as a new asset in `category`: fetch it, work out what it is, check it, store it,
     * record where it came from.
     *
     * Every step can refuse, and a refusal leaves nothing behind. The previous implementation wrote
     * the record first and fetched later, which meant any typed string became an asset that
     * referenced nothing - it looked imported, listed in the browser, and failed at every use.
     *
     * Takes a category rather than a type for the same reason the local importer does: the author
     * pointed at a sidebar section, and which member type a file belongs to is a question about the
     * file. Here it is answered *after* the fetch, because a URL frequently cannot answer it.
     */
    public async importRemoteAsset(
        category: AssetCategory,
        remoteUrl: string,
        groupId?: string,
    ): Promise<RequestStatus<Asset<AssetType, AssetSource.Remote>>> {
        const frozen = this.refuseWhileFrozen();
        if (frozen) {
            return frozen;
        }

        const trimmed = remoteUrl.trim();
        const fetched = await this.download(trimmed);
        if (!fetched.success) {
            return { success: false, error: fetched.error };
        }
        if (!fetched.data) {
            // An import sends no validators, so a well-behaved server cannot answer 304 here. One
            // that does has told us nothing we can store, and saying so beats an empty error.
            return { success: false, error: "The server answered with no content" };
        }

        const type = this.chooseType(category, trimmed, fetched.data);
        if (isBundleAssetType(type)) {
            // A bundle is a directory whose manifest names siblings by relative path; one URL cannot
            // stand for that tree. Refused rather than half-supported.
            return { success: false, error: "A model bundle cannot be imported from a URL" };
        }

        const id = this.getUuidService().generate();
        const name = this.resolveUniqueName(type, trimmed, fetched.data);

        const written = await this.writeSnapshot(type, id, name, fetched.data.bytes);
        if (!written.success || !written.data) {
            return { success: false, error: written.error };
        }

        const asset: Asset<AssetType, AssetSource.Remote> = {
            id,
            type,
            name,
            ext: written.data.ext,
            hash: written.data.hash,
            source: AssetSource.Remote,
            meta: this.buildMeta(trimmed, fetched.data),
            tags: [],
            description: "",
            ...(groupId ? { groupId } : {}),
        };

        const metadata = this.assetsService.getAssetsMetadataManager().getAssets();
        (metadata[type] as Record<string, Asset<AssetType, AssetSource>>)[id] = asset;
        this.assetsService.markDirty(type);
        this.assetsService.getEvents().emit("updated", asset);

        return { success: true, data: asset };
    }

    /**
     * Which member type of `category` these bytes are.
     *
     * Three sources of evidence, weakest last:
     *
     *  1. **The URL's extension**, when a member accepts it. Settles nearly every real import, and it
     *     is the author's own filename, so it wins.
     *  2. **The response's `Content-Type`**, when the URL named nothing usable - a CDN path ending in
     *     a slash, an image API taking its arguments in the query string. This is the only signal
     *     that separates `video/mp4` from `audio/mp4`: both start with the same `ftyp` box, so magic
     *     bytes alone would file every remote mp4 under whichever of the two comes first in the
     *     category.
     *  3. **The bytes**, for a server that declares `application/octet-stream` or nothing at all.
     *
     * Falls back to the section's first member, which is what the format gate then refuses if the
     * bytes are not that. A wrong guess is recoverable (delete the record); refusing to guess is a
     * dead end.
     */
    private chooseType(category: AssetCategory, url: string, fetched: RemoteAssetBytes): AssetType {
        const members = ASSET_CATEGORY_TYPES[category];

        const byExtension = members.filter(type => assetTypeMatchesExtension(type, pathnameOf(url)));
        if (byExtension.length > 0) {
            return byExtension.length === 1 ? byExtension[0] : this.breakTie(byExtension, fetched.bytes);
        }

        const declared = fetched.contentType?.split(";")[0]?.trim().toLowerCase();
        if (declared) {
            const byMime = members.find(type => MIME_PREFIXES[type]?.some(prefix => declared.startsWith(prefix)));
            if (byMime) {
                return byMime;
            }
        }

        const validator = this.assetsService.getFileFormatValidator();
        const bySniff = members.find(type => {
            // `sniffExtension` answers for JSON and Blueprint without looking, so it cannot break the
            // tie inside the data category; only formats with magic bytes count as evidence here.
            const sniffable = type === AssetType.Image || type === AssetType.Audio
                || type === AssetType.Video || type === AssetType.Font;
            return sniffable && validator.sniffExtension(type, fetched.bytes) !== null;
        });

        return bySniff ?? members[0];
    }

    /**
     * Break a tie between member types that all accept this extension, by reading the bytes.
     *
     * Only `.json` is ambiguous, claimed by both JSON and Blueprint, and the rule is the local
     * importer's (`LocalAssetsManager.disambiguateImportType`): try the blueprint parser first,
     * because a successful parse is positive evidence while "it is valid JSON" says nothing either
     * way. Kept in step with that one deliberately - a file imported from a URL and the same file
     * imported from disk must become the same kind of asset.
     */
    private breakTie(candidates: AssetType[], bytes: Uint8Array): AssetType {
        if (candidates.includes(AssetType.Blueprint)) {
            try {
                parseSharedBlueprintAssetJson(new TextDecoder().decode(bytes));
                return AssetType.Blueprint;
            } catch {
                // Valid JSON that is not a shared blueprint, or not JSON at all. Either way the JSON
                // importer is the one that gets to say so.
            }
            const fallback = candidates.find(candidate => candidate !== AssetType.Blueprint);
            if (fallback) {
                return fallback;
            }
        }
        return candidates[0];
    }

    /**
     * Ask the server whether the stored snapshot is still what the URL serves, and take the new bytes
     * if not.
     *
     * Returns the asset either way; `changed` says whether the bytes moved. A record that predates
     * pinning (no snapshot, empty hash, no validators) needs no separate migration — it simply has
     * nothing to send, so this is its first download.
     *
     * Bytes and digest only, as in {@link LocalAssetsManager.writeAssetContentFromPath}: dropping the
     * thumbnail, writing the record and announcing `updated` happen in a fixed order that belongs to
     * {@link AssetsService.refreshRemoteAsset}.
     *
     * Gated exactly as an import is, by {@link writeSnapshot}. That is not symmetry for its own
     * sake: this is the same act, taking bytes off a URL into the project, and a refresh is the one
     * way an asset that was accepted could become one that cannot play. Refusing here leaves the
     * previous snapshot in place and the asset working, which is why the gate probes a scratch copy
     * rather than the shard.
     */
    public async refresh<T extends AssetType>(
        asset: Asset<T, AssetSource.Remote>,
    ): Promise<RequestStatus<{ changed: boolean; digest?: AssetContentDigest; meta: AssetResolveMeta<AssetSource.Remote> }>> {
        const frozen = this.refuseWhileFrozen();
        if (frozen) {
            return frozen;
        }

        const url = asset.meta?.url?.trim();
        if (!url) {
            return { success: false, error: "This asset has no source URL" };
        }

        // Validators are only meaningful alongside the bytes they describe. A record whose snapshot
        // is missing must not send them, or the server answers 304 and the asset stays empty forever.
        const hasSnapshot = await this.snapshotExists(asset.id);
        const fetched = await this.download(url, hasSnapshot ? validatorsOf(asset.meta) : undefined);
        if (!fetched.success) {
            return { success: false, error: fetched.error };
        }

        if (!fetched.data) {
            return {
                success: true,
                data: { changed: false, meta: { ...asset.meta, fetchedAt: new Date().toISOString() } },
            };
        }

        const written = await this.writeSnapshot(asset.type, asset.id, asset.name, fetched.data.bytes);
        if (!written.success || !written.data) {
            return { success: false, error: written.error };
        }

        return {
            success: true,
            data: {
                // The server may re-serve identical bytes without a validator to prove it. Comparing
                // digests is what keeps that from reading as a content change in the version history.
                changed: written.data.hash !== asset.hash || !hasSnapshot,
                digest: written.data,
                meta: this.buildMeta(url, fetched.data),
            },
        };
    }

    /**
     * Whether this asset's snapshot is on disk.
     *
     * Exposed because "pinned but never fetched" is a real state — every record written before
     * pinning is in it — and the UI has to be able to say so without trying to read the bytes.
     */
    public async snapshotExists(assetId: string): Promise<boolean> {
        if (!isValidAssetStorageId(assetId)) {
            return false;
        }
        const fs = this.getFileSystem();
        const exists = await fs.isFileExists(this.getSnapshotPath(assetId));
        return exists.ok && exists.data;
    }

    /**
     * Refuse outright while project writes are frozen, rather than letting the write no-op.
     *
     * `FileSystem.writeRaw` answers `{ok: true}` without writing during a freeze or a working-tree
     * re-read, which for every other caller means "your write is deferred, carry on". Here it would
     * be a lie with consequences: the digest is then taken from a file that was never written, and
     * the record that gets registered describes bytes the project does not have. Refusing before the
     * fetch also spares a pointless download.
     */
    private refuseWhileFrozen(): RequestStatus<never> | null {
        if (getProjectWriteFreeze() || isProjectWriteReloadHeld()) {
            return { success: false, error: "The project is not accepting changes right now" };
        }
        return null;
    }

    /** Fetch through main. Absent `data` on success means the server answered 304. */
    private async download(
        url: string,
        validators?: RemoteAssetValidators,
    ): Promise<RequestStatus<RemoteAssetBytes | null>> {
        const result = await getInterface().assets.fetchRemote(url, validators);
        if (!result.success) {
            return { success: false, error: result.error ?? "Failed to fetch the remote asset" };
        }
        return { success: true, data: result.data.kind === "ok" ? result.data : null };
    }

    /**
     * Write bytes to the asset's content shard and return their digest.
     *
     * Format-gated with the same validator imports pass. It matters more here than for a local
     * import: a URL that has quietly become a login page answers 200 with HTML, and without this the
     * project would gain an "image" that no consumer can decode.
     *
     * Playability-gated too, which the local import path is *not* - see {@link refuseUnplayable}.
     * Both callers go through here, so an import and a refresh answer the question the same way; the
     * comment on {@link refresh} says why they must.
     */
    private async writeSnapshot<T extends AssetType>(
        type: T,
        assetId: string,
        name: string,
        bytes: Uint8Array,
    ): Promise<RequestStatus<AssetContentDigest>> {
        if (!isValidAssetStorageId(assetId)) {
            return { success: false, error: `Invalid asset id: ${assetId}` };
        }
        if (bytes.byteLength === 0) {
            return { success: false, error: "The server returned an empty file" };
        }

        const destPath = this.getSnapshotPath(assetId);
        const validation = await this.assetsService.getFileFormatValidator().validateFileFormat(type, name, bytes);
        if (!validation.success) {
            return { success: false, error: validation.error || "File format validation failed" };
        }

        const unplayable = await this.refuseUnplayable(type, name, bytes);
        if (unplayable) {
            return { success: false, error: unplayable };
        }

        const fs = this.getFileSystem();
        const destDir = dirname(destPath);
        const dirExists = await fs.isDirExists(destDir);
        if (!dirExists.ok) {
            return { success: false, error: `Failed to check destination directory: ${dirExists.error?.message}` };
        }
        if (!dirExists.data) {
            const created = await fs.createDir(destDir);
            if (!created.ok) {
                return { success: false, error: `Failed to create destination directory: ${destDir}. ${created.error?.message}` };
            }
        }

        const written = await fs.writeRaw(destPath, bytes);
        if (!written.ok) {
            return { success: false, error: `Failed to store the remote asset: ${destPath}. ${written.error?.message}` };
        }

        // Recomputed from what actually landed, exactly as every other write path does: the hash is
        // the cache key downstream readers compare against, so one that did not move means they all
        // keep serving the previous snapshot.
        const hashResult = await appPrivilegedFacade.fs.hash(destPath);
        const hash = hashResult.success && hashResult.data.ok ? hashResult.data.data : "";

        return { success: true, data: { hash, ext: extractExtension(name) } };
    }

    /**
     * Refuse sound or video that will not play, before any of it becomes an asset.
     *
     * The reason this is here and **not** on the local import path is that the two have different
     * ways out. A local file that needs converting is offered a conversion (`MediaImportDialog`), and
     * an asset already in the library can be converted in place, keeping its id so every story row
     * and blueprint pin that points at it keeps working. A remote asset can do neither:
     * `AssetsService.replaceAssetContent` refuses a remote source, because converted bytes are not
     * what the URL serves and the record would go on claiming they were. So the "needs converting"
     * mark on a remote asset is a dead end with no button behind it — and the answer is not to build
     * the button, it is not to let the asset in. A pinned URL is a reference to bytes somewhere else;
     * bytes we would have to rewrite before they were usable were never a reference to begin with.
     *
     * The extension-level refusals (`.avi`, `.tif`) are already `validateFileFormat`'s. What is left
     * for this is the judgement no file name can make: an `.mp4` holding HEVC passes every name and
     * magic-byte check ever written and is still a black rectangle. That answer lives in the bytes,
     * so it costs a probe.
     *
     * The bytes are probed from a scratch copy under `.nlstudio/`, not from the shard. Writing them
     * to the shard first would mean a refused **refresh** had already destroyed the working snapshot
     * it was refusing to replace.
     *
     * **A probe that did not answer is not a refusal.** No ffprobe on this host, a timeout, output
     * that would not parse — none of those is evidence about the file, and spending them as one
     * would make importing a URL impossible on a machine that merely lacks a tool. This is the same
     * rule `MediaSupportService` states at length; the import goes through, and the library scan
     * marks it later if it turns out badly.
     *
     * @returns the sentence to refuse with, or `null` to let the bytes through.
     */
    private async refuseUnplayable<T extends AssetType>(
        type: T,
        name: string,
        bytes: Uint8Array,
    ): Promise<string | null> {
        if (type !== AssetType.Audio && type !== AssetType.Video) {
            return null;
        }

        const scratchId = this.getUuidService().generate();
        const scratchDir = this.context.project.resolve(ProjectNameConvention.MediaConvertScratchDir(scratchId));
        // The probe reads the container out of the bytes and never looks at the name, but keeping
        // the author's own one makes the file recognisable if a crash ever leaves one behind.
        const scratchPath = this.context.project.resolve(
            ProjectNameConvention.MediaConvertScratchDir(scratchId),
            name,
        );
        const fs = this.getFileSystem();

        let outcome: MediaProbeOutcome | null = null;
        try {
            const created = await fs.createDir(scratchDir);
            if (!created.ok) {
                return null;
            }
            const written = await fs.writeRaw(scratchPath, bytes);
            if (!written.ok) {
                return null;
            }
            const probed = await getInterface().probeMedia(scratchPath);
            outcome = probed.success ? probed.data.outcome : null;
        } catch {
            // Every failure above is a question that went unanswered, which is the one thing this
            // may not turn into a verdict.
            outcome = null;
        } finally {
            await fs.deleteDir(scratchDir).catch(() => undefined);
        }

        if (!outcome || outcome.status !== "probed" || outcome.verdict.tier === "accept") {
            return null;
        }
        return `NarraLeaf cannot play what this URL serves: ${describeVerdict(outcome.verdict)}. `
            + "Convert the file and import that instead - bytes pinned to a URL cannot be converted "
            + "in place.";
    }

    private buildMeta(url: string, fetched: RemoteAssetBytes): AssetResolveMeta<AssetSource.Remote> {
        return {
            url,
            fetchedAt: new Date().toISOString(),
            ...(fetched.etag ? { etag: fetched.etag } : {}),
            ...(fetched.lastModified ? { lastModified: fetched.lastModified } : {}),
            ...(fetched.contentType ? { contentType: fetched.contentType } : {}),
        };
    }

    /**
     * A display name for the import: the URL's own filename, else its host, with an extension that
     * the asset type actually accepts.
     *
     * A URL that names no usable file is ordinary — a CDN path ending in a slash, a query-string
     * image API, a host like `example.com` whose "extension" would read as `com`. Where the URL does
     * not settle it, the bytes do (`sniffExtension`), because an extension-less record is not a
     * cosmetic problem: `ext` is what the pack's MIME lookup, the portability lint and the format
     * gate below all read.
     */
    private resolveUniqueName<T extends AssetType>(type: T, url: string, fetched: RemoteAssetBytes): string {
        let candidate = "remote-asset";
        try {
            const parsed = new URL(url);
            candidate = basename(parsed.pathname) || parsed.hostname || candidate;
        } catch {
            // The URL already parsed in main for the fetch to have happened at all; this is only
            // reachable if that stops being true, and a fixed name is a better outcome than a throw.
        }

        const allowed = AssetExtensions[type];
        const urlExtension = extractExtension(candidate);
        const usable = !!urlExtension && (allowed.includes("*") || allowed.includes(urlExtension));
        if (!usable) {
            const sniffed = this.assetsService.getFileFormatValidator().sniffExtension(type, fetched.bytes);
            if (sniffed) {
                candidate = `${candidate}.${sniffed}`;
            }
        }

        const metadata = this.assetsService.getAssetsMetadataManager().getAssets();
        const existing = new Set(Object.values(metadata[type]).map(asset => asset.name));

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

    private getSnapshotPath(assetId: string): string {
        return this.context.project.resolve(ProjectNameConvention.AssetsDataShard(assetId));
    }

    private getFileSystem(): FileSystemService {
        return this.context.services.get<FileSystemService>(Services.FileSystem);
    }

    private getUuidService(): UuidService {
        return this.context.services.get<UuidService>(Services.Uuid);
    }
}

function extractExtension(name: string): string | undefined {
    return extname(name).replace(".", "").toLowerCase() || undefined;
}

/** The URL's path, for extension matching. The whole string when it will not parse. */
function pathnameOf(url: string): string {
    try {
        return new URL(url).pathname;
    } catch {
        return url;
    }
}

/**
 * Media-type prefixes that identify an asset type, for {@link RemoteAssetsManager.chooseType}.
 *
 * Only the types a server actually declares usefully. `Blueprint` is a NarraLeaf document served as
 * `application/json` like any other, so a MIME type cannot tell it from `JSON` - that pair is
 * separated by parsing, which is the local importer's `disambiguateImportType` rule, and `Other`
 * exists precisely for bytes Studio has no opinion about.
 */
const MIME_PREFIXES: Partial<Record<AssetType, string[]>> = {
    [AssetType.Image]: ["image/"],
    [AssetType.Audio]: ["audio/"],
    [AssetType.Video]: ["video/"],
    [AssetType.Font]: ["font/", "application/font", "application/x-font"],
    [AssetType.JSON]: ["application/json", "text/json"],
};

/**
 * Why these bytes will not play, in a clause that fits inside a sentence.
 *
 * Names the codec or the container rather than the tier, because "reencode" is this pipeline's
 * vocabulary and the author never asked for a conversion. The one thing they can act on is knowing
 * *which* part of the file the player cannot read.
 */
function describeVerdict(verdict: MediaSupportVerdict): string {
    if (verdict.unsupportedCodecs.length > 0) {
        const codecs = verdict.unsupportedCodecs.join(", ");
        return `nothing here decodes ${codecs}`;
    }
    if (!verdict.container.demuxable) {
        const container = verdict.container.names[0];
        return container
            ? `nothing here opens a ${container} container`
            : "its container cannot be opened";
    }
    // `no-streams`, and whatever a future tier turns out to be. Vague on purpose: a wrong specific
    // reason is worse than an honest general one.
    return "it holds no sound or picture that can be played";
}

function validatorsOf(meta: AssetResolveMeta<AssetSource.Remote>): RemoteAssetValidators {
    return {
        ...(meta.etag ? { etag: meta.etag } : {}),
        ...(meta.lastModified ? { lastModified: meta.lastModified } : {}),
    };
}
