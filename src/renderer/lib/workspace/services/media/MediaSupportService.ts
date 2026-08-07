import { Service } from "../Service";
import { IMediaSupportService, Services, WorkspaceContext } from "../services";
import { AssetsService } from "../core/AssetsService";
import { FileSystemService } from "../core/FileSystem";
import { AssetType } from "../assets/assetTypes";
import type { Asset } from "../assets/types";
import { ProjectNameConvention } from "@/lib/workspace/project/nameConvention";
import { getInterface } from "@/lib/app/bridge";
import {
    blocksShipping,
    imageSupportRecord,
    mediaSupportCheckKind,
    mediaSupportRecordFromProbe,
    parseMediaSupportCache,
    pruneMediaSupportCache,
    serializeMediaSupportCache,
    type MediaAssetSupportRecord,
} from "./mediaAssetSupport";

/**
 * Which assets already in the project will not play, kept fresh cheaply enough to ask on every
 * build.
 *
 * The import gate (`mediaImportTriage` + `MediaImportDialog`) covers files arriving from now on.
 * It cannot cover the library, and the library is where the problem actually lives: assets imported
 * before that gate existed, and assets whose author chose "Import Without Converting". This service
 * is the answer for those, and it has exactly two customers - the build gate, which refuses to ship
 * a video that is a black rectangle, and the asset browser, which marks it so the author can act
 * before a build ever runs.
 *
 * ## Probing is expensive and the answer is stable
 *
 * Each probe is a process spawn. A project with two hundred voice takes must not pay two hundred
 * spawns per build, and it does not have to: **the verdict is a property of the bytes**, so it is
 * cached under the content hash and only a file whose hash moved is asked about again. The cache
 * lives at `editor/cache/media/support.json`, which `@shared/vcs/workingSet` excludes from version
 * control (`editor/cache` is one of its root-excluded directories) and which nothing packages into
 * a build. That is the correct place for it and not merely a convenient one: every entry is
 * reproducible by probing the file again, so committing it would put a derived file in the team's
 * history where it can only produce merge conflicts about a fact nobody decided.
 *
 * ## Not knowing is never a verdict
 *
 * ffprobe is absent on some hosts (macOS, today). A probe can time out. Neither is evidence that an
 * author's file is broken, and neither may be spent as one: an unanswered probe leaves the asset
 * with **no record at all**, {@link MediaSupportScan.probeAvailable} goes false, and the build gate
 * lets the build through saying so. The one direction of error this must never make is asserting a
 * file is bad on the strength of a question that was never answered.
 */

export type MediaSupportScan = {
    /**
     * One entry per asset that was checked and answered, keyed by asset id.
     *
     * Keyed by id and rebuilt whole on each scan, deliberately: `AssetsService` mutates asset
     * records in place, so an `Asset` reference lives forever and nothing downstream may key off
     * its identity. A map that is replaced when the answers change is what makes the badge re-render
     * at all.
     */
    records: ReadonlyMap<string, MediaAssetSupportRecord>;
    /**
     * False when this host cannot probe. Every sound and video asset is then unanswered, and no
     * caller may conclude anything about any of them.
     */
    probeAvailable: boolean;
    /** Ids of assets that needed a probe and did not get an answer. */
    unanswered: readonly string[];
    finishedAt: number;
};

const EMPTY_SCAN: MediaSupportScan = {
    records: new Map(),
    probeAvailable: true,
    unanswered: [],
    finishedAt: 0,
};

export class MediaSupportService extends Service<MediaSupportService> implements IMediaSupportService {
    private scanResult: MediaSupportScan = EMPTY_SCAN;
    /** The cache as last read or written. `null` until the first scan reads it off disk. */
    private cache: Map<string, MediaAssetSupportRecord> | null = null;
    /**
     * Whether the cache holds anything the file on disk does not.
     *
     * The asset browser re-scans whenever the library changes, and a re-scan that hit the cache for
     * every file learned nothing - writing the same bytes back on each of those would turn a
     * fifty-file import into fifty rewrites of a file nobody read.
     */
    private cacheDirty = false;
    private inFlight: Promise<MediaSupportScan> | null = null;
    private readonly listeners = new Set<() => void>();

    protected async init(_ctx: WorkspaceContext): Promise<void> {
        // Singletons survive a project switch, so nothing about the previous project may remain.
        this.scanResult = EMPTY_SCAN;
        this.cache = null;
        this.cacheDirty = false;
        this.inFlight = null;
    }

    public override dispose(): void {
        this.scanResult = EMPTY_SCAN;
        this.cache = null;
        this.cacheDirty = false;
        this.inFlight = null;
        this.listeners.clear();
    }

    /** Fires when a scan produced answers different from the ones on screen. */
    public onChanged(handler: () => void): () => void {
        this.listeners.add(handler);
        return () => {
            this.listeners.delete(handler);
        };
    }

    /** The last scan, without starting one. Empty before the first scan finishes. */
    public getLastScan(): MediaSupportScan {
        return this.scanResult;
    }

    /** One asset's answer from the last scan, or `null` if it has none. */
    public peek(assetId: string): MediaAssetSupportRecord | null {
        return this.scanResult.records.get(assetId) ?? null;
    }

    /** Every asset the last scan found that will not play, in library order. */
    public listUnplayable(): { asset: Asset; record: MediaAssetSupportRecord }[] {
        const out: { asset: Asset; record: MediaAssetSupportRecord }[] = [];
        for (const asset of this.checkableAssets()) {
            const record = this.scanResult.records.get(asset.id);
            if (record && blocksShipping(record)) {
                out.push({ asset, record });
            }
        }
        return out;
    }

    /**
     * Check every media asset in the project and remember what was found.
     *
     * Concurrent calls share one pass - the build gate and the asset browser routinely ask at the
     * same moment, and two passes would double the spawns to reach the same answer.
     */
    public async scan(options?: { force?: boolean }): Promise<MediaSupportScan> {
        if (this.inFlight && !options?.force) {
            return this.inFlight;
        }
        const task = this.runScan(options?.force === true).finally(() => {
            if (this.inFlight === task) {
                this.inFlight = null;
            }
        });
        this.inFlight = task;
        return task;
    }

    /**
     * Forget what was known about one asset and ask again.
     *
     * Called after the bytes behind an asset are replaced. The hash has moved by then, so the cache
     * would miss anyway; this exists so the badge disappears the moment the conversion lands rather
     * than at whatever later point something else happens to scan.
     */
    public async refresh(assetId: string): Promise<void> {
        const asset = this.findAsset(assetId);
        if (!asset) {
            return;
        }
        // A conversion can land before anything has scanned (a project opened straight into the
        // asset browser), and a cache that was never read cannot be added to.
        await this.loadCache();
        const record = await this.check(asset);
        const records = new Map(this.scanResult.records);
        const unanswered = this.scanResult.unanswered.filter(id => id !== assetId);
        if (record) {
            records.set(assetId, record);
        } else {
            records.delete(assetId);
            unanswered.push(assetId);
        }
        this.scanResult = { ...this.scanResult, records, unanswered, finishedAt: Date.now() };
        await this.writeCache();
        this.notify();
    }

    /* ------------------------------------------------------------------------------------------ */

    private async runScan(force: boolean): Promise<MediaSupportScan> {
        if (force) {
            this.cache = new Map();
        }
        await this.loadCache();

        const records = new Map<string, MediaAssetSupportRecord>();
        const unanswered: string[] = [];
        const liveHashes = new Set<string>();
        let probeAvailable = true;

        for (const asset of this.checkableAssets()) {
            if (asset.hash) {
                liveHashes.add(asset.hash);
            }
            // Once the host has said it has no probe, the remaining files would each answer the
            // same thing at the cost of another spawn. Stop asking; they are unanswered, which is
            // what `probeAvailable: false` already says about all of them.
            if (!probeAvailable && mediaSupportCheckKind(asset) === "probe") {
                unanswered.push(asset.id);
                continue;
            }
            const outcome = await this.checkWithAvailability(asset);
            if (outcome.probeMissing) {
                probeAvailable = false;
            }
            if (outcome.record) {
                records.set(asset.id, outcome.record);
            } else {
                unanswered.push(asset.id);
            }
        }

        if (this.cache) {
            const pruned = pruneMediaSupportCache(this.cache, liveHashes);
            this.cacheDirty ||= pruned.size !== this.cache.size;
            this.cache = pruned;
        }
        await this.writeCache();

        this.scanResult = { records, probeAvailable, unanswered, finishedAt: Date.now() };
        this.notify();
        return this.scanResult;
    }

    /** Every asset worth checking, in library order so a report reads the way the browser looks. */
    private checkableAssets(): Asset[] {
        const assets = this.tryGetAssets();
        if (!assets) {
            return [];
        }
        const out: Asset[] = [];
        for (const type of [AssetType.Image, AssetType.Audio, AssetType.Video]) {
            for (const asset of assets.getOrderedAssets(type)) {
                if (mediaSupportCheckKind(asset)) {
                    out.push(asset);
                }
            }
        }
        return out;
    }

    private findAsset(assetId: string): Asset | null {
        return this.checkableAssets().find(asset => asset.id === assetId) ?? null;
    }

    private async check(asset: Asset): Promise<MediaAssetSupportRecord | null> {
        return (await this.checkWithAvailability(asset)).record;
    }

    /**
     * One asset's answer, from the cache when the hash still matches and from a probe when it does
     * not.
     *
     * `probeMissing` is reported separately from a `null` record because the two mean different
     * things to the caller: a probe that failed on this one file is a gap, while a host with no
     * probe at all is a reason to stop asking and to say so.
     */
    private async checkWithAvailability(
        asset: Asset,
    ): Promise<{ record: MediaAssetSupportRecord | null; probeMissing: boolean }> {
        const kind = mediaSupportCheckKind(asset);
        if (kind === null) {
            return { record: null, probeMissing: false };
        }
        if (kind === "image") {
            // Decided from the name. Not cached: there is no process to save, and an entry keyed by
            // content hash would answer a question that was never about the content.
            return { record: imageSupportRecord(asset), probeMissing: false };
        }

        // An asset with no hash is one whose digest could not be computed at import. It is still
        // probed; it just cannot be remembered, because there is nothing to key the answer to.
        const cached = asset.hash ? this.cache?.get(asset.hash) : undefined;
        if (cached) {
            return { record: cached, probeMissing: false };
        }

        const outcome = await this.probe(asset);
        const record = mediaSupportRecordFromProbe(outcome);
        if (record && asset.hash) {
            this.cache?.set(asset.hash, record);
            this.cacheDirty = true;
        }
        return { record, probeMissing: outcome?.status === "unavailable" };
    }

    private async probe(asset: Asset) {
        const context = this.getContext();
        // The content shard is addressed by the asset **id**, not by `hash`. Building this path from
        // the hash - which is the field one reaches for when thinking about content - produces a
        // path that does not exist, and the probe answers "failed" about a perfectly good file.
        const path = context.project.resolve(ProjectNameConvention.AssetsDataShard(asset.id));
        try {
            const result = await getInterface().probeMedia(path);
            return result.success ? result.data.outcome : null;
        } catch {
            return null;
        }
    }

    private async loadCache(): Promise<void> {
        if (this.cache) {
            return;
        }
        const filesystem = this.tryGetFileSystem();
        if (!filesystem) {
            this.cache = new Map();
            return;
        }
        const read = await filesystem.readJSON<unknown>(this.cachePath()).catch(() => null);
        this.cache = read?.ok ? parseMediaSupportCache(read.data) : new Map();
    }

    private async writeCache(): Promise<void> {
        const filesystem = this.tryGetFileSystem();
        if (!filesystem || !this.cache || !this.cacheDirty) {
            return;
        }
        this.cacheDirty = false;
        try {
            await filesystem.createDir(
                this.getContext().project.resolve(ProjectNameConvention.EditorMediaSupportCache),
            );
            await filesystem.write(
                this.cachePath(),
                JSON.stringify(serializeMediaSupportCache(this.cache)),
                "utf-8",
            );
        } catch {
            // A cache that cannot be written costs re-probes next time and nothing else. It is not
            // project data, so there is nobody to tell.
        }
    }

    private cachePath(): string {
        return this.getContext().project.resolve(ProjectNameConvention.EditorMediaSupportCacheFile);
    }

    private tryGetAssets(): AssetsService | null {
        try {
            return this.getContext().services.get<AssetsService>(Services.Assets);
        } catch {
            return null;
        }
    }

    private tryGetFileSystem(): FileSystemService | null {
        try {
            return this.getContext().services.get<FileSystemService>(Services.FileSystem);
        } catch {
            return null;
        }
    }

    private notify(): void {
        for (const listener of [...this.listeners]) {
            try {
                listener();
            } catch {
                // A subscriber's own failure is not this service's to propagate.
            }
        }
    }
}
