import type { SharedBlueprintAsset } from "@shared/types/blueprint/document";
import type {
    LiveAssetBytePart,
    LiveAssetBytes,
    LiveAssetFolder,
    LiveAssetFolderOp,
    LiveAssetOp,
    LiveAssetRecord,
    LiveDigestScope,
} from "@shared/live/ops";
import type { TeamTransferProblem, TeamTransferState } from "@shared/types/teamTransfer";
import { RequestStatus } from "@shared/types/ipcEvents";
import { FsRequestResult } from "@shared/types/os";
import type { FsTextEncoding } from "@shared/types/textEncoding";
import { RendererError } from "@shared/utils/error";
import { ProjectNameConvention } from "../../project/nameConvention";
import { ASSET_CATEGORY_ORDER, ASSET_CATEGORY_TYPES, AssetCategory, AssetData, AssetType, categoryOfAssetType } from "../assets/assetTypes";
import { AudioService } from "../assets/AudioService";
import { FileFormatValidator } from "../assets/FileFormatValidator";
import { FontService } from "../assets/FontService";
import { ImageService } from "../assets/ImageService";
import { JSONService } from "../assets/JSONService";
import { ModelService } from "../assets/ModelService";
import { BlueprintService } from "../assets/BlueprintService";
import { AssetOrderManager } from "../assets/mgr/AssetOrderManager";
import { AssetsMetadataManager } from "../assets/mgr/AssetsMetadataManager";
import { GroupAssetsManager } from "../assets/mgr/GroupAssetsManager";
import { LocalAssetsManager, type CreateLocalAssetFromBytesOptions, type CreateLocalBundleAssetOptions, type ImportFromPathsOptions } from "../assets/mgr/LocalAssetsManager";
import { RemoteAssetsManager } from "../assets/mgr/RemoteAssetsManager";
import { OtherService } from "../assets/OtherService";
import type { ExpandImportPathsResult } from "../assets/importPathExpansion";
import { Asset, AssetExtras, AssetGroup, AssetsMap, AssetSource } from "../assets/types";
import { VideoService } from "../assets/VideoService";
import { Service } from "../Service";
import { IAssetService, Services, WorkspaceContext } from "../services";
import { EventEmitter } from "../ui/EventEmitter";
import { FileSystemService } from "./FileSystem";
import { UIService } from "./UIService";
import { NotificationType } from "../ui/types";
import { translate } from "@/lib/i18n";
import { MagicTagManager, MagicTagTemplate, MagicTagPreview } from "./MagicTagManager";
import { ProjectService } from "./ProjectService";
import { UuidService } from "./UuidService";
import { AssetLockManager, AssetLockReason } from "../assets/AssetLockManager";
import {
    collectAssetReferences,
    describeBlockedDelete,
    type AssetDeleteOptions,
    type AssetReferenceLookup,
    type AssetReferenceReport,
} from "../assets/assetDeleteGuard";
// Type-only: the reference index scans stories, blueprints, UI documents and characters, several of
// which read assets. A value import here would close that loop; the instance is resolved from the
// service registry at call time instead.
import type { ReferenceService } from "../references/ReferenceService";
import { dirname } from "@shared/utils/path";
import type { TranslationKey } from "@shared/i18n";
import { AssetTrash } from "../assets/AssetTrash";
import { HistoryService } from "../history/HistoryService";
import type { HistoryLabel } from "../history/historyModel";
import { projectHistoryScope } from "../history/historyScopes";

/**
 * What one deleted asset needs to come back: its bytes (in the trash, under `trashToken`), its
 * record, and where it sat in the order file. See `AssetsService.removeAssetForRestore`.
 */
type AssetRestorePlan = {
    record: Asset<AssetType, AssetSource>;
    /** Null for a remote asset, or when the payload was already missing. */
    trashToken: string | null;
    orderIndex: number;
    category: AssetCategory;
    result: RequestStatus<void>;
};

/** The group records of one category as they stood before a cascade, plus their listed order. */
type AssetGroupsRestorePlan = {
    category: AssetCategory;
    groupId: string;
    groups: Record<string, AssetGroup>;
    groupOrder: string[];
};

/**
 * Somewhere an asset record edit can go instead of into the library.
 *
 * **The seam a live session hangs the asset library off, and the reason the asset browser needs no
 * live-session code.** The shape is `StoryOpSink`'s and `LocalizationOpSink`'s, and the bargain is
 * the same: with a sink installed an edit becomes an operation and the shard is not touched; the row
 * moves when the operation comes back as somebody's effect and {@link AssetsService.applyLiveOp}
 * applies it. Nothing is applied optimistically, so nothing ever has to be taken back.
 *
 * ⚠ **An installed sink also means "a session is running", and that is load-bearing rather than
 * incidental.** The gestures that move a file - importing, replacing, duplicating, deleting, and the
 * folder cascade that deletes in bulk - are refused while it is there. They have to be refused here,
 * in the service, rather than left to the write boundary: the boundary leaves the metadata shard
 * writable, so an import whose byte write was silently refused would go on to write a record for a
 * file that does not exist, on one machine, with nothing carrying it to anybody else.
 */
export type AssetOpSink = {
    /**
     * Take one operation, or decline it.
     *
     * True means the sink has it and the library must not be touched. False means this edit is not
     * the sink's business and the caller carries on as usual.
     *
     * ⚠ **No bytes.** An operation that brings a file names it - see `LiveAssetBytePart` - and the
     * file itself is already on its way by the time this is called, because putting it somewhere the
     * room can read it is what produced the length and the fingerprint the operation carries.
     */
    handle(op: LiveAssetOp | LiveAssetFolderOp): boolean;
};

/**
 * The bytes a session has been sent, as the library asks for them.
 *
 * **The other half of the seam, and it is a pull rather than a push.** An applier is synchronous -
 * that is what lets the host apply one operation at a time with no ordering machinery - and writing a
 * file is not. So a record and its file arrive by two different routes: the operation writes the
 * record now, and the file is put down afterwards from whatever this answers. A machine that does not
 * have the bytes yet holds a record with no file, which the library already survives (an unresolved
 * reference is reported, not fatal) and which repairs itself when the slices land.
 */
export type AssetBlobPort = {
    /**
     * Put one file where the room can read it, and say what it turned out to be.
     *
     * ⚠ **Called before the operation naming the file is stated, and answered before the file has
     * gone anywhere.** What it waits for is the server agreeing to hold it, which is the last moment
     * at which "this will not travel" can be something an author is told rather than an import that
     * stops halfway on everybody else's screen. The length and the fingerprint come back because
     * they are measured here - the caller never reads the file.
     */
    offer(
        assetId: string,
        part: LiveAssetBytePart,
        source: string,
    ): Promise<{ ok: true; part: LiveAssetBytePart } | { ok: false; problem: TeamTransferProblem }>;
    /**
     * Start collecting one file into the place it belongs.
     *
     * Does nothing on the machine that is sending it: that one already has the file, and the same
     * question - how far has this got - is answered by its own upload.
     */
    collect(assetId: string, part: LiveAssetBytePart, destination: string): void;
    /** How far one file has got, and whether it has settled. */
    arrived(part: LiveAssetBytePart): { bytes: number; state: TeamTransferState | "unknown" };
    /**
     * Stop carrying one file, and take it off the server.
     *
     * **Both ends, from whichever end asks.** A transfer is cancelled by deleting the record it is
     * for, and that deletion reaches every machine in the room - so the one that is sending learns
     * about it the same way the ones receiving do. It stops partway rather than at the end for two
     * reasons at once: it is told, and the object it was writing into is no longer there.
     */
    abandon(part: LiveAssetBytePart): void;
    /**
     * Every file this window is carrying or collecting, by the record it belongs to.
     *
     * What the browser's bands are drawn from. Includes transfers this window picked up again from
     * an earlier session or an earlier run, which have no queued work behind them and would
     * otherwise arrive with nothing on screen saying so.
     */
    inFlight(): ReadonlyMap<string, { bytes: number; total: number }>;
};

/**
 * One file on its way into this library, as the browser draws it.
 *
 * **Both machines have one of these for the same file**, and neither of them is a fiction: the room
 * relays a message back to whoever said it, so a file being carried in is a file arriving on every
 * machine in the room including its own. What the author sees is therefore the same thing in the
 * same place on both screens - the row the file will be, filling up.
 */
export type AssetTransfer = {
    assetId: string;
    /** Bytes that have moved, of the whole record. Bundles count every file in them. */
    bytes: number;
    /** What the record's files add up to. */
    total: number;
};

/**
 * Put a record back exactly as it was, in place.
 *
 * The cast's `Character.adopt` trick, one document along and for the same reason: an edit is applied
 * to the live record so the sink can be handed the record as it WOULD have been written, and then
 * undone before anything has looked. Object identity is preserved because the asset browser and the
 * inspector hold the record itself, and a replacement would leave them drawing a detached copy.
 *
 * Keys the edit added are removed rather than set to `undefined`: `undefined` and absent read the
 * same in TypeScript and are not the same value to a canonical encoder or to a digest.
 */
function restoreAssetRecord(target: Record<string, unknown>, snapshot: Record<string, unknown>): void {
    for (const key of Object.keys(target)) {
        if (!(key in snapshot)) {
            delete target[key];
        }
    }
    Object.assign(target, cloneRecord(snapshot));
}

/** A detached copy of one record. Structured, because a record is plain JSON by construction. */
function cloneRecord<T>(record: T): T {
    return JSON.parse(JSON.stringify(record)) as T;
}

/**
 * File a record in a folder, or at the section root.
 *
 * `null` deletes the key rather than assigning `undefined`, for the reason `setAssetExtension` gives:
 * the two read the same in TypeScript and are not the same value to a canonical encoder.
 */
function setAssetGroup(record: Asset<AssetType, AssetSource>, groupId: string | null): void {
    if (groupId === null) {
        delete record.groupId;
        return;
    }
    record.groupId = groupId;
}

/**
 * A file that has to be made to match a record that has just arrived.
 *
 * **Four kinds, and only the first of them involves the network.** The split is the whole reason a
 * session can afford to share a library at all: duplicating a two-hundred-megabyte video, deleting it
 * and taking that back are each one small message, because the bytes are already on every machine.
 */
type AssetPayloadWork =
    /** Bytes that came over the wire, or are still coming. */
    | {
        do: "write";
        assetType: AssetType;
        assetId: string;
        /** The files that have not landed yet. Shrinks as they do. */
        parts: readonly LiveAssetBytePart[];
        /** Every file this record is made of. Never shrinks: it is what progress is measured out of. */
        whole: readonly LiveAssetBytePart[];
    }
    /** A copy of a file every machine already holds. */
    | { do: "copy"; assetType: AssetType; assetId: string; fromAssetId: string }
    /** Back out of this machine's own trash, where its own applier put it. */
    | { do: "restore"; assetType: AssetType; assetId: string }
    /** Into this machine's own trash, so undoing costs a message rather than a re-upload. */
    | { do: "trash"; assetType: AssetType; assetId: string };

/**
 * What has to happen to one record's file, given where its bytes are said to come from.
 *
 * The one place the three answers turn into work, so a fourth kind cannot be added without deciding
 * what it means for the disk.
 */
function payloadWorkForBytes(assetType: string, assetId: string, bytes: LiveAssetBytes): AssetPayloadWork[] {
    if (!isAssetType(assetType)) {
        return [];
    }
    switch (bytes.from) {
        case "transfer":
            return [{ do: "write", assetType, assetId, parts: bytes.parts, whole: bytes.parts }];
        case "asset":
            return [{ do: "copy", assetType, assetId, fromAssetId: bytes.assetId }];
        case "trash":
            return [{ do: "restore", assetType, assetId }];
    }
}

/**
 * One folder and, when the author asked for it, every folder below it.
 *
 * ⚠ **The set is the same on every machine or the cascade is not derived at all.** Nesting has no
 * depth bound, so this descends until nothing new appears rather than assuming a shape - the same
 * walk `GroupAssetsManager.collectGroupAssets` does, and it has to stay the same walk.
 */
function collectFolderIds(
    folders: Readonly<Record<string, { parentGroupId?: string }>>,
    folderId: string,
    recursive: boolean,
): ReadonlySet<string> {
    const ids = new Set<string>([folderId]);
    if (!recursive) {
        return ids;
    }
    let grew = true;
    while (grew) {
        grew = false;
        for (const folder of Object.values(folders)) {
            const id = (folder as { id?: unknown }).id;
            if (typeof id === "string" && folder.parentGroupId !== undefined
                && ids.has(folder.parentGroupId) && !ids.has(id)) {
                ids.add(id);
                grew = true;
            }
        }
    }
    return ids;
}

/** Whether a string names a section this build draws. What a message from another Studio needs. */
function isAssetCategory(value: string): value is AssetCategory {
    return (Object.values(AssetCategory) as string[]).includes(value);
}

/** Whether a string names an asset type this build has. What a message from another Studio needs. */
function isAssetType(value: string): value is AssetType {
    return (Object.values(AssetType) as string[]).includes(value);
}

interface AssetsEvents {
    deleted: Asset<AssetType, AssetSource>;
    updated: Asset<AssetType, AssetSource>;
    /** A category's folder tree changed. Categories, not types: that is what a folder belongs to. */
    groupsUpdated: { category: AssetCategory; groupId?: string };
    /** Which files are on their way in has changed, or one of them has got further. */
    transfers: readonly AssetTransfer[];
}

const THUMBNAIL_DIMENSION = 160;

/**
 * How often the browser is told a transfer has got further.
 *
 * Slices land as fast as the network delivers them - thousands a second for a large file - and a
 * redraw per slice would spend the whole transfer re-rendering the library. The bar moves in steps
 * of this length instead, which is below what reads as lag and far above the cost of drawing it.
 */
const TRANSFER_NOTICE_MS = 120;

export class AssetsService extends Service<AssetsService> implements IAssetService {
    private assetsMetadataManager: AssetsMetadataManager | null = null;
    private assetOrderManager: AssetOrderManager | null = null;
    private localAssetsManager: LocalAssetsManager | null = null;
    private groupAssetsManager: GroupAssetsManager | null = null;
    private remoteAssetsManager: RemoteAssetsManager | null = null;
    public imageService: ImageService | null = null;
    public audioService: AudioService | null = null;
    public videoService: VideoService | null = null;
    public jsonService: JSONService | null = null;
    public blueprintService: BlueprintService | null = null;
    public fontService: FontService | null = null;
    public modelService: ModelService | null = null;
    public otherService: OtherService | null = null;
    public fileFormatValidator: FileFormatValidator | null = null;
    private readonly thumbnailCache = new Map<string, string>();

    /**
     * Asset lock manager
     */
    private readonly lockManager = new AssetLockManager();

    /** Where record edits go instead of into the shard, when something else owns them. */
    private opSink: AssetOpSink | null = null;
    /** Where the files an operation names come from. Set with the sink and cleared with it. */
    private blobPort: AssetBlobPort | null = null;
    /**
     * Creations waiting to be stated as one operation, while a transaction is open.
     *
     * An import of forty files calls the creation seam forty times, and forty operations is forty
     * things for every other screen in the room to draw and forty presses to take back. The
     * transaction the importer already runs in is the gesture's own boundary, so the batch is
     * collected there and stated once per shard when it closes.
     */
    private pendingCreations: { record: Asset<AssetType, AssetSource>; bytes: LiveAssetBytes }[] | null = null;
    /**
     * Files that still have to be put down to match records that have already been applied.
     *
     * Drained asynchronously and deliberately behind the records: see {@link AssetBlobPort}.
     */
    private readonly payloadQueue: AssetPayloadWork[] = [];
    /**
     * Work that cannot be done yet because its slices have not all arrived.
     *
     * ⚠ **Held apart from the queue rather than pushed back onto it.** A drain that requeued an item
     * it could not do would spin the queue at full speed until the bytes landed - a busy loop for as
     * long as a transfer takes. Nothing here retries on a timer either: {@link resumePayloads} is
     * called when a slice arrives, which is the only moment the answer can have changed.
     */
    private readonly waitingPayloads: AssetPayloadWork[] = [];
    private payloadDraining = false;
    /**
     * The files that are on their way here, by asset id.
     *
     * ⚠ **Kept apart from the queue rather than read off it.** A piece of work is out of both lists
     * while it is being tried, and a browser reading the queue would draw the row losing its bar and
     * getting it back on every slice. Entered when the work is queued and removed when the last of
     * its files is on disk, so what is drawn is the state of the file rather than the state of a list.
     */
    private readonly transferring = new Map<string, AssetPayloadWork & { do: "write" }>();
    /** When the browser was last told about progress. See {@link TRANSFER_NOTICE_MS}. */
    private transfersNotifiedAt = 0;
    /**
     * Where each deleted asset's file went in THIS machine's trash, by asset id.
     *
     * ⚠ **Never on the wire.** The trash lives under `.nlstudio/`, which no repository stores and no
     * session shares, and every machine trashed its own copy of the same file under its own token. An
     * operation that carried one would be telling other machines about a slot they do not have.
     */
    private readonly trashedPayloads = new Map<string, string>();

    /**
     * Event emitter for asset-level changes (added, deleted, updated)
     */
    private readonly events = new EventEmitter<AssetsEvents>();

    /**
     * Transaction batching support
     */
    private batchDepth = 0;
    private dirtyTypes = new Set<AssetType>();
    /** Categories whose `assets.order.<category>.json` is behind the shards it orders. */
    private dirtyOrderCategories = new Set<AssetCategory>();
    private assetsMetadataInitializing = false;
    private assetTrash: AssetTrash | null = null;
    /**
     * Open while a group cascade is running; see `deleteGroupWithHistory`. Non-null means
     * `deleteAsset` hands its restore plan over instead of recording a step of its own.
     */
    private assetDeletionBatch: AssetRestorePlan[] | null = null;

    public getFileFormatValidator(): FileFormatValidator {
        if (!this.fileFormatValidator) {
            throw new RendererError("File format validator not initialized");
        }
        return this.fileFormatValidator;
    }

    /**
     * Get event emitter so UI layer can subscribe
     */
    public getEvents(): EventEmitter<AssetsEvents> {
        return this.events;
    }

    /**
     * Execute a transaction that batches all metadata changes
     */
    public async transaction(
        mutator: (svc: this) => Promise<void> | void,
    ): Promise<void> {
        this.beginBatch();
        try {
            await mutator(this);
        } finally {
            await this.endBatch();
        }
    }

    private beginBatch(): void {
        this.batchDepth += 1;
        if (this.batchDepth === 1 && this.opSink && this.pendingCreations === null) {
            // The gesture's own boundary. An importer that loops over forty files is one thing the
            // author did, and the transaction it already runs in is where that is written down.
            this.pendingCreations = [];
        }
    }

    private async endBatch(): Promise<void> {
        if (--this.batchDepth > 0) return;
        const pending = this.pendingCreations;
        this.pendingCreations = null;
        if (pending && pending.length > 0) {
            await this.stateCreations(pending);
        }
        await this.flushPendingWrites();
    }

    public markDirty(type: AssetType): void {
        this.dirtyTypes.add(type);
        // Adding or removing an asset changes the row order too, and the two live in different files
        // — and the order file is per category, one level above the metadata shard.
        this.dirtyOrderCategories.add(categoryOfAssetType(type));
        if (this.batchDepth === 0 && !this.assetsMetadataInitializing) {
            void this.flushPendingWrites();
        }
    }

    /**
     * Queue the sibling order file without rewriting the metadata shard — what a group mutation
     * needs, since it has already written its own shard and only the order has moved.
     */
    public markOrderDirty(category: AssetCategory): void {
        this.dirtyOrderCategories.add(category);
        if (this.batchDepth === 0 && !this.assetsMetadataInitializing) {
            void this.flushPendingWrites();
        }
    }

    /* ------------------------------------------------------------ the live-session seam */

    /**
     * Send asset edits somewhere else, and say where the files they name come from. Null restores
     * ordinary behaviour.
     *
     * The two travel together because neither is any use alone: a sink with no port would state
     * operations naming files nothing could put down, and a port with no sink would answer questions
     * nobody was asking.
     */
    public setOperationSink(sink: AssetOpSink | null, blobs: AssetBlobPort | null = null): void {
        this.opSink = sink;
        this.blobPort = sink === null ? null : blobs;
        if (sink === null) {
            this.pendingCreations = null;
            // Nothing is going to arrive now: the inbox those slices were coming into is cleared with
            // the session. What is on disk stays; what was still coming is over.
            this.waitingPayloads.length = 0;
            if (this.transferring.size > 0) {
                this.transferring.clear();
                this.notifyTransfers(true);
            }
        }
    }

    /** Whether a live session owns this library's edits right now. */
    public get sharedLive(): boolean {
        return this.opSink !== null;
    }

    /**
     * A record has just been made and its bytes are on this machine's disk. **True means a session
     * took it and the caller must NOT file it.**
     *
     * ⚠ **The one point every creation passes through, and it is deliberately AFTER the bytes are
     * written and BEFORE the record is filed.** That order is what lets every import path in the
     * library reach a session without being rewritten: each of them already writes its file and then
     * registers a record, and this sits in the join. The file it just wrote is not a problem while the
     * operation is in flight - the library is built from the metadata shards rather than by walking
     * directories, so a file no record names is invisible - and when the effect comes back the applier
     * files the record and finds the file already there.
     *
     * The alternative, filing the record first and taking it back if the host refuses, is the
     * optimistic apply this whole design is built to avoid: it would put a row in this window's
     * browser that no other machine has, and the digest would eject the machine for it.
     */
    public async offerCreatedAsset(
        record: Asset<AssetType, AssetSource>,
        bytes: LiveAssetBytes,
    ): Promise<boolean> {
        if (!this.opSink) {
            return false;
        }
        if (this.pendingCreations) {
            // Inside a transaction: the gesture is not over, so neither is the operation.
            this.pendingCreations.push({ record: cloneRecord(record), bytes });
            return true;
        }
        return this.stateCreations([{ record: cloneRecord(record), bytes }]);
    }

    /**
     * State a batch of creations, one operation per shard, carrying whatever files have to travel.
     *
     * ⚠ **Refused before anything is stated when a file will not travel**, rather than after the
     * room has watched half of it arrive. There is no size limit here any more - what can refuse is
     * the server, and only because a project has as much in transit as it may - but the shape of the
     * answer is unchanged, and has to be: the alternative is an import that stops halfway with
     * nothing on any screen saying so.
     *
     * ❗ **One file being refused refuses that file, not the batch.** An import of forty pictures
     * with one video among them used to state nothing at all: the whole gesture was abandoned at the
     * first file over the limit, and because a creation is offered from inside the importer's own
     * transaction, nothing was left to report it either. The author saw a library that had not
     * changed and no reason why.
     */
    private async stateCreations(
        creations: readonly { record: Asset<AssetType, AssetSource>; bytes: LiveAssetBytes }[],
    ): Promise<boolean> {
        const sink = this.opSink;
        if (!sink || creations.length === 0) {
            return false;
        }

        const byType = new Map<AssetType, { record: LiveAssetRecord; bytes: LiveAssetBytes }[]>();
        const refused: { record: Asset<AssetType, AssetSource>; problem: TeamTransferProblem }[] = [];
        for (const creation of creations) {
            const carried = await this.offerBytesToCarry(creation.record, creation.bytes);
            if (!carried.ok) {
                refused.push({ record: creation.record, problem: carried.problem });
                continue;
            }
            const bucket = byType.get(creation.record.type);
            const entry = { record: creation.record as unknown as LiveAssetRecord, bytes: carried.bytes };
            if (bucket) {
                bucket.push(entry);
            } else {
                byType.set(creation.record.type, [entry]);
            }
        }

        for (const [assetType, creates] of byType) {
            sink.handle({ op: "create-assets", assetType, creates });
        }
        if (refused.length > 0) {
            await this.reportRefusedCreations(refused);
        }
        return byType.size > 0;
    }

    /**
     * Say which files a session would not carry, and take back the bytes they left behind.
     *
     * **Both halves matter.** The record was never filed, so the file under it is one nothing in the
     * library names: it does not appear in the browser, no reference report mentions it, and it is
     * still whatever a video weighs. Leaving it is a project that grows by the size of every import
     * an author tried during a session.
     */
    private async reportRefusedCreations(
        refused: readonly { record: Asset<AssetType, AssetSource>; problem: TeamTransferProblem }[],
    ): Promise<void> {
        const filesystem = this.getContext().services.get<FileSystemService>(Services.FileSystem);
        for (const { record } of refused) {
            const path = this.getLocalAssetsManager().getLocalAssetPath(record.id);
            try {
                // A bundle is a directory and everything else is a file; asking which costs one call
                // and guessing wrong leaves the very thing this is here to remove.
                const directory = await filesystem.isDirExists(path);
                await (directory.ok && directory.data ? filesystem.deleteDir(path) : filesystem.deleteFile(path));
            } catch (error) {
                console.warn("[AssetsService] could not sweep the file of a refused import", error);
            }
        }
        // One sentence for the whole batch, and which one depends on why: a project with as much in
        // transit as it may hold is a different thing to do about than a server that is not
        // answering, and the two must not be told as one.
        const quota = refused.every(each => each.problem.kind === "quota");
        const one = refused.length === 1;
        try {
            this.getContext().services.get<UIService>(Services.UI).notifications.show({
                type: NotificationType.Warning,
                message: translate("assets.live.refusedTitle"),
                detail: translate(
                    quota
                        ? (one ? "assets.live.refusedQuotaOne" : "assets.live.refusedQuotaMany")
                        : (one ? "assets.live.refusedOne" : "assets.live.refusedMany"),
                    { name: refused[0].record.name, count: String(refused.length) },
                ),
            });
        } catch (error) {
            console.warn(`[AssetsService] could not report a refused import`, error);
        }
    }

    /**
     * Put the files a creation brings where the room can read them.
     *
     * Answers the bytes description as it will travel - the length and the fingerprint filled in
     * from what was actually measured - or the reason it will not. Nothing happens for the two kinds
     * that travel nothing, which is most of what a library does.
     *
     * ⚠ **Nothing is read here.** The file is on this disk and the main process streams it from
     * there; what comes back is two numbers about it.
     */
    private async offerBytesToCarry(
        record: Asset<AssetType, AssetSource>,
        bytes: LiveAssetBytes,
    ): Promise<{ ok: true; bytes: LiveAssetBytes } | { ok: false; problem: TeamTransferProblem }> {
        if (bytes.from !== "transfer") {
            return { ok: true, bytes };
        }
        const port = this.blobPort;
        if (!port) {
            return { ok: false, problem: { kind: "unavailable", detail: "no session is carrying files" } };
        }
        const parts: LiveAssetBytePart[] = [];
        for (const part of bytes.parts) {
            const offered = await port.offer(record.id, part, this.payloadPathFor(record.id, part.path));
            if (!offered.ok) {
                return offered;
            }
            parts.push(offered.part);
        }
        return { ok: true, bytes: { from: "transfer", parts } };
    }

    /**
     * State that one record now points at different bytes, or answer null when nothing is listening.
     *
     * ⚠ **The record is worked out by applying the change and then putting it back**, which is the
     * shape `recordChanged` uses and for the same reason: what has to travel is the record as it WOULD
     * have been written, and only the code that writes it knows what that is. Replacing rewrites the
     * hash, and the extension and the display name with it.
     *
     * The bytes are already on this machine - the write that produced them happened before this - so
     * what travels is the file for everybody else.
     */
    private async stateReplacement<T extends AssetType>(
        asset: Asset<T, AssetSource>,
        digest: { hash: string; ext?: string },
    ): Promise<RequestStatus<Asset<T, AssetSource>> | null> {
        if (!this.opSink) {
            return null;
        }
        const live = this.liveRecord(asset.type, asset.id);
        if (!live) {
            return { success: false, error: `Asset not found: ${asset.id}` };
        }
        const previous = cloneRecord(live);
        const applied = this.getAssetsMetadataManager().applyReplacedContent(asset, digest);
        if (!applied.success || !applied.data) {
            return { success: false, error: applied.error };
        }
        const record = cloneRecord(applied.data) as unknown as LiveAssetRecord;
        restoreAssetRecord(
            live as unknown as Record<string, unknown>,
            previous as unknown as Record<string, unknown>,
        );

        const bytes = await this.offerBytesToCarry(live, {
            from: "transfer",
            parts: [{ path: null, transferId: this.mintTransferId(), size: 0, digest: "" }],
        });
        if (!bytes.ok) {
            return {
                success: false,
                error: translate(
                    bytes.problem.kind === "quota"
                        ? "assets.live.replaceRefusedQuota"
                        : "assets.live.replaceRefused",
                ),
            };
        }

        this.opSink.handle({
            op: "replace-asset-content",
            assetType: asset.type,
            assetId: asset.id,
            record,
            bytes: bytes.bytes,
        });
        return { success: true, data: applied.data as Asset<T, AssetSource> };
    }

    /**
     * A transfer id nobody else will mint.
     *
     * `crypto.randomUUID` rather than the workspace's uuid service, because this names something on
     * the wire rather than something in a document: it never reaches a file, and it has to be unique
     * across the room rather than across the project.
     */
    public mintTransferId(): string {
        return crypto.randomUUID();
    }

    /** Where one of an asset's files lives: its own payload, or one file inside a bundle. */
    private payloadPathFor(assetId: string, inBundle: string | null): string {
        const root = this.getLocalAssetsManager().getLocalAssetPath(assetId);
        return inBundle === null ? root : `${root}/${inBundle}`;
    }

    /**
     * One record has been edited in place: hand it over if something else owns it, or save it.
     *
     * **The one point every record edit passes through**, which is what makes the vocabulary's unit
     * honest: `markDirty` names only the type, and the finest thing that can be stated truthfully
     * there is a whole shard - which is the whole-document last-writer-wins the design refuses. Every
     * mutator that knows which record it changed comes here instead, and what it states is one
     * record.
     *
     * ⚠ **The record is edited first and put back if the sink takes it**, which is the cast's
     * `Character.adopt` shape: the sink must be handed the record as it WOULD have been written, not
     * the patch that was asked for, because a patch states an intention that every machine would then
     * resolve against its own copy. Nothing sees the intermediate state - this whole call is
     * synchronous, and the `updated` event that wakes the panels is on the other branch.
     *
     * Answers whether the sink took it, for a caller that has more to do either way.
     */
    public recordChanged(
        record: Asset<AssetType, AssetSource>,
        previous: Asset<AssetType, AssetSource>,
    ): boolean {
        const taken = this.opSink?.handle({
            op: "update-asset",
            assetType: record.type,
            assetId: record.id,
            record: cloneRecord(record) as LiveAssetRecord,
        }) === true;
        if (taken) {
            restoreAssetRecord(record as unknown as Record<string, unknown>, previous as unknown as Record<string, unknown>);
            return true;
        }
        this.markDirty(record.type);
        this.events.emit("updated", record);
        return false;
    }

    /**
     * Every asset type whose shard this window holds.
     *
     * What a session carries and what the write boundary leaves writable - one set, from one call,
     * for the reason `LocalizationService.loadAllDocuments` answers with what it read. Empty before
     * the library is up, which is a window that cannot be in a session either.
     */
    public shardTypes(): readonly string[] {
        return this.assetsMetadataManager ? Object.values(AssetType) : [];
    }

    /**
     * One type's records as they stand, or null when this window does not hold them.
     *
     * What the digest is taken over and what an inverse is read from. A string rather than an
     * {@link AssetType} because it arrives from another Studio, which may name a type this build has
     * never heard of.
     *
     * ⚠ **The one cast between the library's model and the wire's**, and it is here on purpose: the
     * renderer's `Asset` interface and `LiveAssetRecord` are one document read two ways, and an
     * interface carries no index signature for TypeScript to line the two up through. Everything past
     * this point speaks the structural view, which is the one a message from another build arrives in.
     */
    public recordsOf(assetType: string): Readonly<Record<string, LiveAssetRecord>> | null {
        if (!this.assetsMetadataManager || !isAssetType(assetType)) {
            return null;
        }
        return this.assetsMetadataManager.getAssets()[assetType] as unknown as Record<string, LiveAssetRecord>;
    }

    /** One record as it stands, or null when there is none. What the host's `asset-gone` asks. */
    public recordOf(assetType: string, assetId: string): LiveAssetRecord | null {
        return this.recordsOf(assetType)?.[assetId] ?? null;
    }

    /**
     * Apply one operation to the library, **without consulting the sink**.
     *
     * The other side of the seam: what a live session calls when an effect arrives and the browser is
     * finally allowed to move.
     *
     * ⚠ **A record this window does not hold is a no-op rather than a throw**, exactly as an unheld
     * language is in `LocalizationService`. An applier runs inside the host reading a message, and one
     * that threw would take the session down over one row; the divergence guard catches it instead, on
     * this very effect, because the shard's digest is a value rather than a missing answer.
     */
    public applyLiveOp(op: LiveAssetOp | LiveAssetFolderOp): readonly LiveDigestScope[] {
        switch (op.op) {
            case "update-asset": {
                const record = this.liveRecord(op.assetType, op.assetId);
                if (!record) {
                    console.warn(`[AssetsService] no record ${op.assetId} in ${op.assetType}; effect not applied`);
                    return [];
                }
                // In place, so the panel and the inspector holding this record redraw rather than
                // going on drawing a copy nothing writes to any more.
                restoreAssetRecord(
                    record as unknown as Record<string, unknown>,
                    op.record as unknown as Record<string, unknown>,
                );
                this.markDirty(record.type);
                this.events.emit("updated", record);
                return [];
            }
            case "move-assets": {
                const records = this.liveRecords(op.assetType);
                if (!records) {
                    console.warn(`[AssetsService] no shard for ${op.assetType}; effect not applied`);
                    return [];
                }
                const moved: Asset<AssetType, AssetSource>[] = [];
                for (const move of op.moves) {
                    const record = records[move.assetId];
                    if (!record) {
                        console.warn(`[AssetsService] no record ${move.assetId} in ${op.assetType}; row not filed`);
                        continue;
                    }
                    setAssetGroup(record, move.groupId);
                    moved.push(record);
                }
                if (moved.length === 0) {
                    return [];
                }
                // One dirty mark for the whole gesture, then one event per row: the shard is written
                // once, and the browser redraws the rows that actually moved.
                this.markDirty(moved[0].type);
                for (const record of moved) {
                    this.events.emit("updated", record);
                }
                return [];
            }
            case "create-assets": {
                const records = this.liveRecords(op.assetType);
                if (!records) {
                    console.warn(`[AssetsService] no shard for ${op.assetType}; effect not applied`);
                    return [];
                }
                for (const create of op.creates) {
                    const record = create.record as unknown as Asset<AssetType, AssetSource>;
                    if (typeof record.id !== "string" || records[record.id]) {
                        // An id already here is the host's `asset-id-taken` seen from the other side:
                        // whatever produced it, overwriting a record would take a file with it.
                        continue;
                    }
                    // Verbatim, ⚠ including the name. The library resolves a colliding display name
                    // by appending a number, and a machine that re-resolved would pick a different
                    // one - two libraries holding one asset under two names, from one message.
                    records[record.id] = cloneRecord(record);
                    this.queuePayload(payloadWorkForBytes(op.assetType, record.id, create.bytes));
                    this.events.emit("updated", records[record.id]);
                }
                this.markDirty(op.assetType as AssetType);
                return [];
            }
            case "replace-asset-content": {
                const record = this.liveRecord(op.assetType, op.assetId);
                if (!record) {
                    console.warn(`[AssetsService] no record ${op.assetId} in ${op.assetType}; effect not applied`);
                    return [];
                }
                restoreAssetRecord(
                    record as unknown as Record<string, unknown>,
                    op.record as unknown as Record<string, unknown>,
                );
                this.queuePayload(payloadWorkForBytes(op.assetType, op.assetId, op.bytes));
                this.markDirty(record.type);
                // The thumbnail is keyed by asset id and would otherwise survive the swap and keep
                // every grid tile drawing the old picture. Dropped before the panels are woken, which
                // is the ordering `replaceAssetContent` documents as its contract.
                void this.clearThumbnailCache(op.assetId).catch(() => undefined);
                this.events.emit("updated", record);
                return [];
            }
            case "delete-assets": {
                const records = this.liveRecords(op.assetType);
                if (!records) {
                    console.warn(`[AssetsService] no shard for ${op.assetType}; effect not applied`);
                    return [];
                }
                // ⚠ Before the records go, so the sender stops mid-file. A record deleted while its
                // file was still arriving would otherwise leave the machine that had it pushing
                // slices for a row nobody has any more. See `cancelTransfers`.
                this.abandonTransfers(op.assetIds);
                for (const assetId of op.assetIds) {
                    const record = records[assetId];
                    if (!record) {
                        continue;
                    }
                    delete records[assetId];
                    // ⚠ Trashed rather than unlinked, on every machine independently. That is what
                    // makes undoing this cost one message instead of a re-upload, and it is the same
                    // trash the ordinary delete has always used.
                    this.queuePayload([{ do: "trash", assetType: record.type, assetId }]);
                    void this.clearThumbnailCache(assetId).catch(() => undefined);
                    this.events.emit("deleted", record);
                }
                this.markDirty(op.assetType as AssetType);
                return [];
            }
            case "set-asset-folder": {
                const folders = this.liveFolders(op.category);
                if (!folders) {
                    console.warn(`[AssetsService] no folder shard for ${op.category}; effect not applied`);
                    return [];
                }
                folders[op.folderId] = cloneRecord(op.folder) as unknown as AssetGroup;
                void this.getGroupAssetsManager().persistGroups(op.category as AssetCategory);
                this.events.emit("groupsUpdated", { category: op.category as AssetCategory, groupId: op.folderId });
                return [];
            }
            case "delete-asset-folder": {
                return this.applyFolderDeletion(op.category as AssetCategory, op.folderId, op.recursive);
            }
            case "restore-asset-folder": {
                const folders = this.liveFolders(op.category);
                if (!folders) {
                    console.warn(`[AssetsService] no folder shard for ${op.category}; effect not applied`);
                    return [];
                }
                for (const folder of op.folders) {
                    if (typeof folder.id === "string") {
                        folders[folder.id] = cloneRecord(folder) as unknown as AssetGroup;
                    }
                }
                const touched = new Set<AssetType>();
                for (const entry of op.assets) {
                    const records = this.liveRecords(entry.assetType);
                    const record = entry.record as unknown as Asset<AssetType, AssetSource>;
                    if (!records || typeof record.id !== "string" || records[record.id]) {
                        continue;
                    }
                    records[record.id] = cloneRecord(record);
                    // Out of this machine's own trash. Nothing was carried and nothing has to be.
                    this.queuePayload([{ do: "restore", assetType: record.type, assetId: record.id }]);
                    touched.add(record.type);
                    this.events.emit("updated", records[record.id]);
                }
                for (const type of touched) {
                    this.markDirty(type);
                }
                void this.getGroupAssetsManager().persistGroups(op.category as AssetCategory);
                this.events.emit("groupsUpdated", { category: op.category as AssetCategory });
                // The shards this put records back into are not what the operation names, so they
                // would go unfingerprinted unless they are reported here.
                return [...touched].map((assetType): LiveDigestScope => ({ of: "assets", assetType }));
            }
            default: {
                // A verb with no applier would otherwise be a silent no-op: the effect lands on every
                // other machine in the room and not on this one, and nothing says so until a digest
                // disagrees one message later.
                const unapplied: never = op;
                throw new RendererError(`No applier for live asset operation: ${JSON.stringify(unapplied)}`);
            }
        }
    }

    /**
     * Empty one folder and everything below it, the way every machine in the room does.
     *
     * ⚠ **Derived rather than carried, and therefore fingerprinted.** Which folders are under this
     * one, and which records are in them, is a question about documents the room already agrees on -
     * sending them would be a second statement of something every receiver can compute. What that
     * costs is the obligation to report every shard this emptied, so a machine that swept differently
     * is caught on this message rather than on some later one.
     */
    private applyFolderDeletion(
        category: AssetCategory,
        folderId: string,
        recursive: boolean,
    ): readonly LiveDigestScope[] {
        const folders = this.liveFolders(category);
        if (!folders) {
            console.warn(`[AssetsService] no folder shard for ${category}; effect not applied`);
            return [];
        }
        const doomed = collectFolderIds(folders, folderId, recursive);
        const touched = new Set<AssetType>();
        for (const type of ASSET_CATEGORY_TYPES[category]) {
            const records = this.liveRecords(type);
            if (!records) {
                continue;
            }
            for (const record of Object.values(records)) {
                if (record.groupId === undefined || !doomed.has(record.groupId)) {
                    continue;
                }
                delete records[record.id];
                this.queuePayload([{ do: "trash", assetType: record.type, assetId: record.id }]);
                void this.clearThumbnailCache(record.id).catch(() => undefined);
                this.events.emit("deleted", record);
                touched.add(type);
            }
        }
        for (const id of doomed) {
            delete folders[id];
        }
        for (const type of touched) {
            this.markDirty(type);
        }
        void this.getGroupAssetsManager().persistGroups(category);
        this.events.emit("groupsUpdated", { category, groupId: folderId });
        return [...touched].map((assetType): LiveDigestScope => ({ of: "assets", assetType }));
    }

    /** One section's folder records as the library holds them, or null when it is not up. */
    private liveFolders(category: string): Record<string, AssetGroup> | null {
        if (!this.groupAssetsManager || !isAssetCategory(category)) {
            return null;
        }
        return this.groupAssetsManager.assetsGroups?.[category] ?? null;
    }

    /** One section's folder records as they travel, or null. What the digest is taken over. */
    public foldersOf(category: string): Readonly<Record<string, LiveAssetFolder>> | null {
        return this.liveFolders(category) as unknown as Record<string, LiveAssetFolder> | null;
    }

    /** Every section the library holds folders for. What the session carries and freezes. */
    public folderCategories(): readonly string[] {
        return this.groupAssetsManager ? [...ASSET_CATEGORY_ORDER] : [];
    }

    /* ------------------------------------------------------- putting the files down */

    /**
     * Queue work that makes the files match records that have already been applied.
     *
     * **Behind the records on purpose.** An applier is synchronous, which is what lets the host apply
     * one operation at a time with no ordering machinery, and writing a file is not. So the record
     * lands now and the file follows; a machine that is still waiting for slices holds a record whose
     * file is missing, which the library already survives and which repairs itself.
     */
    private queuePayload(work: readonly AssetPayloadWork[]): void {
        if (work.length === 0) {
            return;
        }
        for (const item of work) {
            if (item.do === "write") {
                this.transferring.set(item.assetId, item);
            }
        }
        this.payloadQueue.push(...work);
        this.notifyTransfers(true);
        void this.drainPayloadQueue();
    }

    /* ------------------------------------------------------- what is on its way here */

    /**
     * The files arriving right now, in no particular order.
     *
     * Empty outside a session and for every gesture that moves no bytes, which is most of them: a
     * duplicate, a deletion and taking a deletion back are each one small message.
     */
    public transfers(): readonly AssetTransfer[] {
        const out = new Map<string, AssetTransfer>();
        // What the transport is actually doing, which covers the transfers this window picked up
        // again from an earlier session or an earlier run - those have no queued work behind them
        // and would otherwise fill a file in with nothing on screen saying so.
        for (const [assetId, moving] of this.blobPort?.inFlight() ?? []) {
            out.set(assetId, { assetId, bytes: moving.bytes, total: moving.total });
        }
        for (const work of this.transferring.values()) {
            if (out.has(work.assetId)) {
                continue;
            }
            // Queued and not yet started: a row that is about to fill rather than one that is not
            // there. Drawn at nothing rather than left out, because the row is the placeholder.
            let total = 0;
            for (const part of work.whole) {
                total += part.size;
            }
            out.set(work.assetId, { assetId: work.assetId, bytes: this.bytesInHand(work), total });
        }
        return [...out.values()];
    }

    /**
     * How much of one record is here, counting the files already put down as whole.
     *
     * ⚠ **A file that has landed is no longer a transfer the transport reports**, which is right for
     * the transport and wrong for a band: landing is what completes a file, so counting only what is
     * still moving would make a bundle's band fall back every time one of its files finished.
     */
    private bytesInHand(work: AssetPayloadWork & { do: "write" }): number {
        const outstanding = new Set(work.parts.map(part => part.transferId));
        let bytes = 0;
        for (const part of work.whole) {
            bytes += outstanding.has(part.transferId)
                ? Math.min(this.blobPort?.arrived(part).bytes ?? 0, part.size)
                : part.size;
        }
        return bytes;
    }

    /**
     * Tell the browser what is arriving, at most every {@link TRANSFER_NOTICE_MS}.
     *
     * `now` for the two moments the interval must not swallow: a transfer appearing, and the last one
     * finishing. A bar that arrives late reads as a slow start; a bar that never clears reads as a
     * file that never arrived.
     */
    private notifyTransfers(now: boolean): void {
        const at = Date.now();
        if (!now && at - this.transfersNotifiedAt < TRANSFER_NOTICE_MS) {
            return;
        }
        this.transfersNotifiedAt = at;
        this.events.emit("transfers", this.transfers());
    }

    /**
     * Do the queued file work, one item at a time.
     *
     * One at a time rather than in parallel because these are copies and moves of whole files, and a
     * directory import would otherwise start forty of them at once on a disk that has one head.
     * Re-entrant by a flag rather than by a lock: everything here is queued from the applier, which
     * runs on the one thread that would take the lock.
     */
    private async drainPayloadQueue(): Promise<void> {
        if (this.payloadDraining) {
            return;
        }
        this.payloadDraining = true;
        try {
            while (this.payloadQueue.length > 0) {
                const work = this.payloadQueue.shift()!;
                try {
                    await this.runPayloadWork(work);
                } catch (error) {
                    // A file that could not be put down is a record with nothing under it, which the
                    // reference report already tells the author about. It must never take the drain
                    // - or the session - with it.
                    console.warn(`[AssetsService] payload work failed (${work.do} ${work.assetId})`, error);
                    if (work.do === "write") {
                        // Nothing is going to finish this one, so nothing should go on drawing it as
                        // arriving. A bar that never clears is read as a file that never came.
                        this.transferring.delete(work.assetId);
                        this.notifyTransfers(true);
                    }
                }
            }
        } finally {
            this.payloadDraining = false;
        }
    }

    private async runPayloadWork(work: AssetPayloadWork): Promise<void> {
        const local = this.getLocalAssetsManager();
        switch (work.do) {
            case "write": {
                // ⚠ **Nothing is written here.** The file lands where it belongs by itself - the
                // main process streams it off the socket into a name beside its own and moves it
                // into place once every byte of it is there and hashes to what the sender said. So
                // this is a record of what is still outstanding, and the only thing it does is ask
                // for what has not been asked for yet.
                const still: LiveAssetBytePart[] = [];
                for (const part of work.parts) {
                    const where = this.blobPort?.arrived(part) ?? { bytes: 0, state: "unknown" as const };
                    if (where.state === "done") {
                        continue;
                    }
                    if (where.state === "failed") {
                        // It will not arrive. The record stands with no file under it, which the
                        // reference report already says out loud - and which is a state the library
                        // has for assets that arrived by every other route as well.
                        console.warn(`[AssetsService] ${part.transferId} will not arrive`);
                        continue;
                    }
                    if (where.state === "unknown") {
                        this.blobPort?.collect(
                            work.assetId,
                            part,
                            this.payloadPathFor(work.assetId, part.path),
                        );
                    }
                    still.push(part);
                }
                if (still.length > 0) {
                    // The files that did land are on disk; only the rest is waited for, so a bundle
                    // of forty does not start again from the first one every time.
                    const waiting = { ...work, parts: still };
                    this.waitingPayloads.push(waiting);
                    this.transferring.set(work.assetId, waiting);
                    this.notifyTransfers(false);
                    return;
                }
                this.transferring.delete(work.assetId);
                this.notifyTransfers(true);
                await this.clearThumbnailCache(work.assetId);
                this.events.emit("updated", this.liveRecord(work.assetType, work.assetId) as Asset);
                return;
            }
            case "copy": {
                await local.copyPayload(work.fromAssetId, work.assetId, work.assetType);
                return;
            }
            case "restore": {
                await this.restoreTrashedPayload(work.assetType, work.assetId);
                return;
            }
            case "trash": {
                const token = await this.getAssetTrash()
                    .put(work.assetId, work.assetType, local.getLocalAssetPath(work.assetId));
                if (token !== null) {
                    // Remembered by asset id, because the operation that puts it back names the
                    // record and nothing else: the token is this machine's own and never travels.
                    this.trashedPayloads.set(work.assetId, token);
                }
                return;
            }
        }
    }

    /**
     * Try the files that were waiting again.
     *
     * Called when what the transport reports has moved, because that is the only moment the answer
     * can have changed. ⚠ **Nothing here is on a timer of its own**: a transfer that is never going
     * to finish is one the transport gives up on and says so, and a queue that woke itself would go
     * on asking about it for the rest of the session.
     */
    public resumePayloads(): void {
        if (this.waitingPayloads.length === 0) {
            return;
        }
        this.payloadQueue.push(...this.waitingPayloads.splice(0, this.waitingPayloads.length));
        void this.drainPayloadQueue();
    }

    /**
     * Stop the files that are still arriving for these records, and take the records with them.
     *
     * ❗ **Cancelling an arrival is deleting the record**, because on every machine but the sender's
     * the record is all there is: it was applied the moment the operation reached them and the file
     * has been following ever since. Stopping only the bytes would leave a row nothing can open, on
     * every screen in the room, with no way to say what happened to it.
     *
     * So the one gesture states the ordinary deletion, and the deletion is what stops the bytes -
     * on the machine that asked, and on the one that is sending, which finds out the same way
     * everybody else does. It is offered only while a file is arriving, which is also why it does
     * not ask: nothing an author made is being thrown away, and a file that has not arrived is one
     * nothing in the project can be pointing at yet.
     */
    public cancelTransfers(assetIds: readonly string[]): void {
        if (!this.opSink) {
            return;
        }
        const byType = new Map<AssetType, string[]>();
        for (const assetId of assetIds) {
            const work = this.transferring.get(assetId);
            if (!work) {
                // Finished between the menu opening and the row being pressed. Nothing to stop, and
                // deleting it here would turn a cancel into a delete of a file that did arrive.
                continue;
            }
            const bucket = byType.get(work.assetType);
            if (bucket) {
                bucket.push(assetId);
            } else {
                byType.set(work.assetType, [assetId]);
            }
        }
        for (const [assetType, ids] of byType) {
            this.opSink.handle({ op: "delete-assets", assetType, assetIds: ids });
        }
    }

    /**
     * Forget everything that was still coming for these records.
     *
     * Called from the deletion's own applier, so it runs on every machine including the sender's -
     * see {@link cancelTransfers}. Safe for records with nothing in flight, which is almost all of
     * them.
     */
    private abandonTransfers(assetIds: readonly string[]): void {
        let dropped = false;
        for (const assetId of assetIds) {
            const work = this.transferring.get(assetId);
            if (!work) {
                continue;
            }
            for (const part of work.whole) {
                this.blobPort?.abandon(part);
            }
            this.transferring.delete(assetId);
            dropped = true;
        }
        if (!dropped) {
            return;
        }
        const ids = new Set(assetIds);
        for (let at = this.waitingPayloads.length - 1; at >= 0; at -= 1) {
            const work = this.waitingPayloads[at];
            if (work.do === "write" && ids.has(work.assetId)) {
                this.waitingPayloads.splice(at, 1);
            }
        }
        this.notifyTransfers(true);
    }

    /** Take one asset's file back out of this machine's trash. */
    private async restoreTrashedPayload(assetType: AssetType, assetId: string): Promise<void> {
        const token = this.trashedPayloads.get(assetId);
        if (token === undefined) {
            // Nothing was trashed here - a machine that joined after the deletion, or one whose own
            // trash was swept. The record is back and its file is not, which the reference report
            // says out loud rather than hiding.
            return;
        }
        this.trashedPayloads.delete(assetId);
        await this.getAssetTrash()
            .restore(token, assetType, this.getLocalAssetsManager().getLocalAssetPath(assetId));
    }

    /**
     * One type's records as the library's own model, or null when this window does not hold them.
     *
     * {@link recordsOf}'s twin, and the split is the cast this file is careful to make exactly once:
     * everything facing a live session reads the structural view, and everything writing the library
     * reads the interface it is stored under.
     */
    private liveRecords(assetType: string): Record<string, Asset<AssetType, AssetSource>> | null {
        if (!this.assetsMetadataManager || !isAssetType(assetType)) {
            return null;
        }
        return this.assetsMetadataManager.getAssets()[assetType] as Record<string, Asset<AssetType, AssetSource>>;
    }

    /** The live record behind an address, as the library's own model. The applier's reader. */
    private liveRecord(assetType: string, assetId: string): Asset<AssetType, AssetSource> | null {
        return this.liveRecords(assetType)?.[assetId] ?? null;
    }

    /**
     * Write the metadata shards that changed, and the order files that go with them.
     *
     * Failures used to vanish here: `writeAssetsMetadata` returns an `FsRequestResult` and this
     * dropped it, so a shard that could not be written was still marked clean and the library
     * silently diverged from disk. A rejected shard now stays dirty, so the next mutation retries
     * it, and the failure is reported (SaveStatusService observes the write itself and raises the
     * toast / "Storage" console line).
     */
    private async flushPendingWrites(): Promise<void> {
        if (this.dirtyTypes.size > 0) {
            const types = Array.from(this.dirtyTypes);
            this.dirtyTypes.clear();
            const results = await Promise.all(types.map(async type => ({ type, result: await this.writeAssetsMetadata(type) })));
            for (const { type, result } of results) {
                if (!result.ok) {
                    this.dirtyTypes.add(type);
                    console.warn(`[AssetsService] failed to write ${type} metadata: ${result.error.message}`);
                }
            }
        }

        await this.flushPendingOrderWrites();
    }

    /**
     * An order file names both an asset order and a group order, so it can only be written once both
     * managers are up. Until then the types stay queued rather than being written half-known: an
     * order file claiming a type has no groups would, after the shards are canonicalized, be
     * indistinguishable from one that had recorded their order.
     */
    private async flushPendingOrderWrites(): Promise<void> {
        if (this.dirtyOrderCategories.size === 0 || !this.assetOrderManager || !this.assetsMetadataManager || !this.groupAssetsManager) {
            return;
        }

        const metadataManager = this.assetsMetadataManager;
        const groupManager = this.groupAssetsManager;
        const orderManager = this.assetOrderManager;
        const categories = Array.from(this.dirtyOrderCategories);
        this.dirtyOrderCategories.clear();

        const results = await Promise.all(categories.map(async category => ({
            category,
            // Member types in the order the category lists them, concatenated: one file records the
            // whole section's rows, which is what the section draws.
            result: await orderManager.write(
                category,
                ASSET_CATEGORY_TYPES[category].flatMap(type => metadataManager.listOrdered(type)),
                groupManager.listOrderedGroups(category),
            ),
        })));
        for (const { category, result } of results) {
            if (!result.ok) {
                this.dirtyOrderCategories.add(category);
                console.warn(`[AssetsService] failed to write ${category} asset order: ${result.error.message}`);
            } else if (result.refused === true) {
                // A refusal is not a failure and is not reported as one - the freeze latch has its
                // own notice - but the bytes did not leave either, so the debt is still owed. The
                // first open of a project that predates the order file is exactly when a freeze can
                // be armed (a revision view, an open merge, recovery mode), and that is the one open
                // on which the row order is still recoverable from shard key order.
                this.dirtyOrderCategories.add(category);
            }
        }
    }

    protected async init(ctx: WorkspaceContext, depend: (services: Service[]) => Promise<void>): Promise<void> {
        const filesystemService = ctx.services.get<FileSystemService>(Services.FileSystem);
        const projectService = ctx.services.get<ProjectService>(Services.Project);
        const uuidService = ctx.services.get<UuidService>(Services.Uuid);
        await depend([filesystemService, projectService, uuidService]);

        // Initialize all asset services
        this.imageService = new ImageService(ctx);
        this.audioService = new AudioService(ctx);
        this.videoService = new VideoService(ctx);
        this.jsonService = new JSONService(ctx);
        this.blueprintService = new BlueprintService(ctx);
        this.fontService = new FontService(ctx);
        this.modelService = new ModelService(ctx);
        this.otherService = new OtherService(ctx);

        // Initialize file format validator
        this.fileFormatValidator = new FileFormatValidator();
        
        // Before the shard managers: each of them reads its half of the row order from here, and a
        // project that has no order file yet must fall back to its shards' key order, which is only
        // still the author's order for as long as nothing has rewritten those shards.
        this.assetOrderManager = await new AssetOrderManager(ctx).init();

        const assetsMetadataManager = new AssetsMetadataManager(this, ctx);
        this.assetsMetadataManager = assetsMetadataManager;
        this.assetsMetadataInitializing = true;
        try {
            await assetsMetadataManager.init();
        } catch (error) {
            this.assetsMetadataManager = null;
            this.dirtyTypes.clear();
            this.dirtyOrderCategories.clear();
            throw error;
        } finally {
            this.assetsMetadataInitializing = false;
        }
        await this.flushPendingWrites();

        this.groupAssetsManager = await new GroupAssetsManager(this, ctx).init();

        // Undo history never survives a restart, so every payload still in the trash is from a
        // session that ended and nothing can reach it. Emptying it here is the whole retention
        // policy - see AssetTrash.
        void this.getAssetTrash().sweep();

        // Both halves are known now, so the order recovered from key order can be committed. This is
        // the migration for a project that predates the order file, and it has to happen on this
        // open: once a shard is rewritten with sorted keys there is nothing left to recover from.
        for (const category of this.assetOrderManager.listMissingCategories()) {
            this.dirtyOrderCategories.add(category);
        }
        await this.flushPendingWrites();

        this.localAssetsManager = await new LocalAssetsManager(this, ctx).init();
        await this.ensureThumbnailRoot();
        this.remoteAssetsManager = await new RemoteAssetsManager(this, ctx).init();
    }

    /**
     * Read the asset library back off the disk: the metadata shards, the row order, the groups.
     *
     * A participant of `WorkspaceReloadService`. Deliberately NOT the whole of {@link init}: the
     * per-type reader services, the local/remote managers and the thumbnail root are wiring, not
     * project data, and re-creating them would drop in-flight fetches for no gain. The three managers
     * rebuilt here are the ones holding what the repository stores.
     *
     * Queued shard writes are dropped rather than flushed. They are owed on the library that is being
     * replaced - an asset imported while writes were refused never reached the shards, and paying the
     * debt afterwards is exactly the accident this mechanism exists to prevent. The first-open
     * migrations (missing order files, assets with no `ext`) are dropped with them; they are owed to a
     * project open, and the next one runs them again.
     */
    public async reloadFromDisk(): Promise<void> {
        const ctx = this.getContext();
        this.dirtyTypes.clear();
        this.dirtyOrderCategories.clear();

        // Read into fresh managers and swap only once all three have answered: each one assigns its
        // own state after its read returns, so a rejected read leaves the live library untouched
        // rather than half-replaced.
        const order = await new AssetOrderManager(ctx).init();
        const metadata = new AssetsMetadataManager(this, ctx);
        // The shard reader marks types dirty when it fills in a missing `ext`; the flag suppresses the
        // write it would otherwise fire off mid-reload.
        this.assetsMetadataInitializing = true;
        try {
            await metadata.init();
        } finally {
            this.assetsMetadataInitializing = false;
        }
        const groups = await new GroupAssetsManager(this, ctx).init();

        this.assetOrderManager = order;
        this.assetsMetadataManager = metadata;
        this.groupAssetsManager = groups;
        this.dirtyTypes.clear();
        this.dirtyOrderCategories.clear();
        // Thumbnails are keyed by asset id and cached outside the working set, so a restored asset
        // would otherwise be drawn with the picture of the one that replaced it.
        this.thumbnailCache.clear();

        // `groupsUpdated` is the "this type's tree changed" signal the asset browser already listens
        // to. There is no per-asset event to send: every row may have moved, appeared or gone.
        for (const category of ASSET_CATEGORY_ORDER) {
            this.events.emit("groupsUpdated", { category });
        }
    }

    public getAssetOrderManager(): AssetOrderManager {
        if (!this.assetOrderManager) {
            throw new RendererError("Asset order manager not initialized");
        }
        return this.assetOrderManager;
    }

    public getAssetsMetadataManager(): AssetsMetadataManager {
        if (!this.assetsMetadataManager) {
            throw new RendererError("Assets metadata manager not initialized");
        }
        return this.assetsMetadataManager;
    }

    public getGroupAssetsManager(): GroupAssetsManager {
        if (!this.groupAssetsManager) {
            throw new RendererError("Group assets manager not initialized");
        }
        return this.groupAssetsManager;
    }

    public getRemoteAssetsManager(): RemoteAssetsManager {
        if (!this.remoteAssetsManager) {
            throw new RendererError("Remote assets manager not initialized");
        }
        return this.remoteAssetsManager;
    }

    public getLocalAssetsManager(): LocalAssetsManager {
        if (!this.localAssetsManager) {
            throw new RendererError("Local assets manager not initialized");
        }
        return this.localAssetsManager;
    }

    public getAssets(): AssetsMap {
        return this.getAssetsMetadataManager().getAssets();
    }

    /**
     * Assets of `type` in browser order. Prefer this over `Object.values(getAssets()[type])`, whose
     * key order stops being the author's the moment a shard is written with sorted keys.
     */
    public getOrderedAssets<T extends AssetType>(type: T): Asset<T, AssetSource>[] {
        return this.getAssetsMetadataManager().getOrderedAssets(type);
    }

    public list<T extends AssetType>(type: T): string[] {
        return this.getAssetsMetadataManager().list(type);
    }

    public exists<T extends AssetType>(asset: Asset<T, AssetSource>): boolean {
        return this.getAssetsMetadataManager().exists(asset);
    }

    /**
     * Read an asset's bytes.
     *
     * No source branch, deliberately. A remote asset's snapshot lives at the same content shard as a
     * local asset's file, so "where are the bytes" has one answer and reading them has one path.
     * Everything that separates the two - the URL, the validators, refreshing - is metadata.
     */
    public async fetch<T extends AssetType>(asset: Asset<T, AssetSource>): Promise<RequestStatus<AssetData<T>>> {
        return this.getLocalAssetsManager().fetch(asset as Asset<T, AssetSource.Local>);
    }

    public async importLocalAssets<T extends AssetType>(type: T): Promise<RequestStatus<RequestStatus<Asset<T, AssetSource.Local>>[]>> {
        return this.transactionResult(() => this.getLocalAssetsManager().importLocalAssets(type));
    }

    public async importRemoteAsset(
        category: AssetCategory,
        url: string,
        groupId?: string,
    ): Promise<RequestStatus<Asset<AssetType, AssetSource.Remote>>> {
        return this.getRemoteAssetsManager().importRemoteAsset(category, url, groupId);
    }

    /**
     * Ask a remote asset's server whether its stored snapshot is still current, and take the new
     * bytes if not.
     *
     * Runs the *same four steps in the same order* as {@link replaceAssetContent} once bytes have
     * moved - that ordering is the contract, not an implementation detail. It is skipped entirely
     * when nothing moved, so a no-op refresh does not invalidate a thumbnail or announce an update
     * the version history would then show as a change.
     */
    public async refreshRemoteAsset<T extends AssetType>(
        asset: Asset<T, AssetSource.Remote>,
    ): Promise<RequestStatus<{ asset: Asset<T, AssetSource>; changed: boolean }>> {
        const refreshed = await this.getRemoteAssetsManager().refresh(asset);
        if (!refreshed.success || !refreshed.data) {
            return { success: false, error: refreshed.error };
        }

        const { changed, digest, meta } = refreshed.data;
        if (changed && digest) {
            try {
                await this.clearThumbnailCache(asset.id);
            } catch (error) {
                console.warn(`Failed to clear thumbnail cache for asset: ${asset.id}`, error);
            }
        }

        const applied = this.getAssetsMetadataManager().applyRemoteRefresh(asset, meta, changed ? digest : undefined);
        if (!applied.success || !applied.data) {
            return { success: false, error: applied.error };
        }

        this.getEvents().emit("updated", applied.data);
        return { success: true, data: { asset: applied.data, changed } };
    }

    /** Whether a remote asset's snapshot is on disk. False for every record written before pinning. */
    public async hasRemoteSnapshot(assetId: string): Promise<boolean> {
        return this.getRemoteAssetsManager().snapshotExists(assetId);
    }

    public async getThumbnailPath(asset: Asset): Promise<RequestStatus<string>> {
        if (asset.type !== AssetType.Image) {
            return { success: false, error: "Thumbnails are only supported for image assets" };
        }

        const cachePath = this.getThumbnailCachePath(asset.id);
        const fs = this.getContext().services.get<FileSystemService>(Services.FileSystem);
        const existing = await fs.isFileExists(cachePath);
        if (existing.ok && existing.data) {
            this.thumbnailCache.set(asset.id, cachePath);
            return { success: true, data: cachePath };
        }

        if (!this.imageService) {
            return { success: false, error: "Image service is not initialized" };
        }

        const imageResult = await this.imageService.readLocalImage(asset as Asset<AssetType.Image>);
        if (!imageResult.success || !imageResult.data) {
            return { success: false, error: imageResult.error ?? "Failed to read source image" };
        }

        const thumbnailBuffer = await this.createThumbnailBuffer(imageResult.data.data);
        await this.ensureThumbnailDir(cachePath);
        const writeResult = await fs.writeRaw(cachePath, thumbnailBuffer);
        if (!writeResult.ok) {
            return { success: false, error: writeResult.error?.message };
        }

        this.thumbnailCache.set(asset.id, cachePath);
        return { success: true, data: cachePath };
    }

    public async clearThumbnailCache(assetId?: string): Promise<void> {
        const fs = this.getContext().services.get<FileSystemService>(Services.FileSystem);
        if (assetId) {
            this.thumbnailCache.delete(assetId);
            const cachePath = this.getThumbnailCachePath(assetId);
            const exists = await fs.isFileExists(cachePath);
            if (exists.ok && exists.data) {
                await fs.deleteFile(cachePath);
            }
            return;
        }

        this.thumbnailCache.clear();
        const root = this.getThumbnailCacheRoot();
        const exists = await fs.isDirExists(root);
        if (exists.ok && exists.data) {
            await fs.deleteDir(root);
        }
    }

    private getThumbnailCacheRoot(): string {
        return this.getContext().project.resolve(ProjectNameConvention.EditorThumbnailCache);
    }

    private getThumbnailCachePath(assetId: string): string {
        return this.getContext().project.resolve(ProjectNameConvention.EditorThumbnailCacheShard(assetId));
    }

    private async ensureThumbnailRoot(): Promise<void> {
        const root = this.getThumbnailCacheRoot();
        const fs = this.getContext().services.get<FileSystemService>(Services.FileSystem);
        const exists = await fs.isDirExists(root);
        if (!exists.ok) {
            throw new RendererError(exists.error?.message || "Failed to access thumbnail cache root");
        }
        if (!exists.data) {
            const created = await fs.createDir(root);
            if (!created.ok) {
                throw new RendererError(created.error?.message || "Failed to create thumbnail cache root");
            }
        }
    }

    private async ensureThumbnailDir(path: string): Promise<void> {
        const dir = dirname(path);
        const fs = this.getContext().services.get<FileSystemService>(Services.FileSystem);
        const exists = await fs.isDirExists(dir);
        if (!exists.ok) {
            throw new RendererError(exists.error?.message || "Failed to access thumbnail cache directory");
        }
        if (!exists.data) {
            const created = await fs.createDir(dir);
            if (!created.ok) {
                throw new RendererError(created.error?.message || "Failed to create thumbnail cache directory");
            }
        }
    }

    private async createThumbnailBuffer(buffer: Uint8Array): Promise<Uint8Array> {
        if (typeof document === "undefined" && typeof OffscreenCanvas === "undefined") {
            throw new RendererError("Thumbnail generation requires a document or OffscreenCanvas context");
        }

        const bufferSource = buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength) as ArrayBuffer;
        const blob = new Blob([bufferSource]);
        const bitmap = await createImageBitmap(blob);
        const canvas = this.createCanvas();
        const context = canvas.getContext("2d");
        if (!context) {
            bitmap.close();
            throw new RendererError("Failed to acquire canvas context for thumbnail rendering");
        }

        const width = bitmap.width;
        const height = bitmap.height;
        const ratio = Math.min(THUMBNAIL_DIMENSION / width, THUMBNAIL_DIMENSION / height, 1);
        const drawWidth = width * ratio;
        const drawHeight = height * ratio;
        const offsetX = (THUMBNAIL_DIMENSION - drawWidth) / 2;
        const offsetY = (THUMBNAIL_DIMENSION - drawHeight) / 2;

        context.clearRect(0, 0, THUMBNAIL_DIMENSION, THUMBNAIL_DIMENSION);
        context.drawImage(bitmap, offsetX, offsetY, drawWidth, drawHeight);
        bitmap.close();

        return this.canvasToUint8Array(canvas);
    }

    private createCanvas(): HTMLCanvasElement | OffscreenCanvas {
        if (typeof OffscreenCanvas !== "undefined") {
            return new OffscreenCanvas(THUMBNAIL_DIMENSION, THUMBNAIL_DIMENSION);
        }

        const canvas = document.createElement("canvas");
        canvas.width = THUMBNAIL_DIMENSION;
        canvas.height = THUMBNAIL_DIMENSION;
        return canvas;
    }

    private async canvasToUint8Array(canvas: HTMLCanvasElement | OffscreenCanvas): Promise<Uint8Array> {
        if (typeof OffscreenCanvas !== "undefined" && canvas instanceof OffscreenCanvas) {
            const blob = await canvas.convertToBlob({ type: "image/png" });
            const buffer = await blob.arrayBuffer();
            return new Uint8Array(buffer);
        }

        return await new Promise<Uint8Array>((resolve, reject) => {
            const domCanvas = canvas as HTMLCanvasElement;
            domCanvas.toBlob(async (blob) => {
                if (!blob) {
                    reject(new RendererError("Failed to encode thumbnail"));
                    return;
                }
                const buffer = await blob.arrayBuffer();
                resolve(new Uint8Array(buffer));
            }, "image/png");
        });
    }

    private async writeAssetsMetadata(type: AssetType): Promise<FsRequestResult<void>> {
        const metadata = this.getAssetsMetadataManager().getAssets();

        const filesystemService = this.getContext().services.get<FileSystemService>(Services.FileSystem);
        const data = JSON.stringify(metadata[type]);

        return await filesystemService.writeFileNoFollow(this.getContext().project.resolve(ProjectNameConvention.AssetsMetadataShard(type)), data, "utf-8");
    }

    public async createGroup(
        category: AssetCategory,
        name: string,
        parentGroupId?: string
    ): Promise<RequestStatus<AssetGroup>> {
        if (this.opSink) {
            // Minted here rather than by the applier, for `create-assets`' reason: the id and the
            // timestamps have to be the same on every machine, and the only way to be sure of that
            // is for one machine to decide them.
            const folder: AssetGroup = {
                id: `group_${Date.now()}_${Math.random().toString(36).slice(2, 11)}`,
                name,
                category,
                parentGroupId,
                createdAt: Date.now(),
                updatedAt: Date.now(),
            };
            this.opSink.handle({
                op: "set-asset-folder",
                category,
                folderId: folder.id,
                folder: folder as unknown as LiveAssetFolder,
            });
            return { success: true, data: folder };
        }
        return this.getGroupAssetsManager().createGroup(category, name, parentGroupId);
    }

    /**
     * State a change to one folder record, or answer null when there is no session to state it to.
     *
     * The one path the three folder edits share, so `set-asset-folder` cannot come to mean three
     * slightly different things.
     */
    private stateFolderChange(
        category: AssetCategory,
        folderId: string,
        edit: (folder: AssetGroup) => AssetGroup,
    ): RequestStatus<AssetGroup> | null {
        if (!this.opSink) {
            return null;
        }
        const held = this.liveFolders(category)?.[folderId];
        if (!held) {
            return { success: false, error: `Group not found: ${folderId}` };
        }
        const folder = edit({ ...held });
        this.opSink.handle({
            op: "set-asset-folder",
            category,
            folderId,
            folder: folder as unknown as LiveAssetFolder,
        });
        return { success: true, data: folder };
    }

    /**
     * Delete a group and everything it contains.
     *
     * The reference check happens here, at the enumeration stage, over every asset the cascade would
     * remove — including the contents of nested groups. Checking per asset inside the cascade would
     * be too late: by the time the third file was refused the first two would already be gone.
     */
    public async deleteGroup(
        category: AssetCategory,
        groupId: string,
        recursive: boolean = false,
        options?: AssetDeleteOptions,
    ): Promise<RequestStatus<void>> {
        const groupManager = this.getGroupAssetsManager();
        const blocked = await this.findDeleteBlocker(groupManager.collectGroupAssets(category, groupId, recursive), options);
        if (blocked) {
            return { success: false, error: blocked };
        }

        if (this.opSink) {
            // One operation for the whole cascade. Which folders are below this one and which files
            // are in them is a question every machine can answer from documents the room agrees on,
            // so none of that is carried - see `LiveAssetFolderOp`.
            this.opSink.handle({ op: "delete-asset-folder", category, folderId: groupId, recursive });
            return { success: true, data: void 0 };
        }

        // Cleared as a set above; the per-asset guard inside the cascade would only re-ask the same
        // question once per file.
        return this.deleteGroupWithHistory(category, groupId, recursive);
    }

    public async renameGroup(
        category: AssetCategory,
        groupId: string,
        newName: string
    ): Promise<RequestStatus<AssetGroup>> {
        return this.stateFolderChange(category, groupId, folder => ({
            ...folder,
            name: newName,
            updatedAt: Date.now(),
        })) ?? this.getGroupAssetsManager().renameGroup(category, groupId, newName);
    }

    public async moveGroupToParent(
        category: AssetCategory,
        groupId: string,
        newParentGroupId?: string
    ): Promise<RequestStatus<AssetGroup>> {
        return this.stateFolderChange(category, groupId, folder => ({
            ...folder,
            parentGroupId: newParentGroupId,
            updatedAt: Date.now(),
        })) ?? this.getGroupAssetsManager().moveGroupToParent(category, groupId, newParentGroupId);
    }

    public async moveAssetToGroup<T extends AssetType>(
        asset: Asset<T>,
        groupId?: string
    ): Promise<RequestStatus<void>> {
        return this.moveAssetsToGroup([asset as Asset<AssetType, AssetSource>], groupId);
    }

    /**
     * File any number of assets in one folder, as ONE gesture.
     *
     * **The batch is the point, and it exists for the story's `move-blocks` reason.** Dragging a
     * multi-selection into a folder is one thing the author did; sent as one operation per row it
     * would draw a half-filed library on every other screen in a session and cost a press per row to
     * take back. The loop that used to live in three call sites is here instead, so every one of them
     * states the gesture the same way.
     *
     * ⚠ **One operation per asset TYPE, because a message names one document.** A selection under
     * Media may hold audio and video, whose records live in two shards; each shard's share is stated
     * whole. Outside a session the split is invisible - both shards are written either way.
     *
     * Whole or not at all: every target is checked before a single record moves, so a drag onto a
     * folder that has just been deleted leaves the selection where it was rather than half-filed.
     */
    public async moveAssetsToGroup(
        assets: readonly Asset<AssetType, AssetSource>[],
        groupId?: string
    ): Promise<RequestStatus<void>> {
        const manager = this.getGroupAssetsManager();
        for (const asset of assets) {
            const rejected = manager.checkMoveTarget(asset, groupId);
            if (rejected) {
                return { success: false, error: rejected };
            }
        }

        const byType = new Map<AssetType, Asset<AssetType, AssetSource>[]>();
        for (const asset of assets) {
            const bucket = byType.get(asset.type);
            if (bucket) {
                bucket.push(asset);
            } else {
                byType.set(asset.type, [asset]);
            }
        }

        for (const [type, bucket] of byType) {
            const moves = bucket.map(asset => ({ assetId: asset.id, groupId: groupId ?? null }));
            if (this.opSink?.handle({ op: "move-assets", assetType: type, moves })) {
                continue;
            }
            const records = this.liveRecords(type);
            if (!records) {
                return { success: false, error: `Assets metadata not initialized: ${type}` };
            }
            for (const move of moves) {
                const record = records[move.assetId];
                if (!record) {
                    return { success: false, error: `Asset not found: ${move.assetId}` };
                }
                setAssetGroup(record, move.groupId);
            }
            this.markDirty(type);
            for (const move of moves) {
                const record = records[move.assetId];
                if (record) {
                    this.events.emit("updated", record);
                }
            }
        }

        return { success: true, data: void 0 };
    }

    public async duplicateGroup(
        category: AssetCategory,
        groupId: string,
        newParentGroupId?: string
    ): Promise<RequestStatus<AssetGroup>> {
        // ⚠ Left as the compound it is: it makes a folder and then duplicates every file into it,
        // and inside a session each of those states its own operation. So this is the one gesture in
        // the panel that is more than one step on the undo stack - a folder and its copies, rather
        // than one press. Making it one would need a verb that is about two documents at once.
        return this.getGroupAssetsManager().duplicateGroup(category, groupId, newParentGroupId);
    }

    // Metadata management APIs
    public async updateAssetTags<T extends AssetType>(
        asset: Asset<T>,
        tags: string[]
    ): Promise<RequestStatus<void>> {
        return this.getAssetsMetadataManager().updateAssetTags(asset, tags);
    }

    public async updateAssetDescription<T extends AssetType>(
        asset: Asset<T>,
        description: string
    ): Promise<RequestStatus<void>> {
        return this.getAssetsMetadataManager().updateAssetDescription(asset, description);
    }

    /** Merge editor-authored extras (cue points…) into the asset record. */
    public async patchAssetExtras<T extends AssetType>(
        asset: Asset<T>,
        patch: Partial<AssetExtras>,
    ): Promise<RequestStatus<void>> {
        return this.getAssetsMetadataManager().patchAssetExtras(asset, patch);
    }

    public async renameAsset<T extends AssetType>(
        asset: Asset<T>,
        newName: string
    ): Promise<RequestStatus<void>> {
        return this.getAssetsMetadataManager().renameAsset(asset, newName);
    }

    /**
     * The reverse lookup behind the delete guard, exposed so the panel can draw its warning from the
     * same reading the guard enforces — two independent lookups would eventually disagree, and the
     * one the author sees is not the one that decides.
     */
    public async findAssetReferences(
        assetIds: readonly string[],
        /** Types of the same assets, so coverage is judged against the question being asked. */
        assetTypes: readonly AssetType[] = [],
    ): Promise<AssetReferenceReport> {
        return collectAssetReferences(this.getReferenceLookup(), assetIds, assetTypes);
    }

    /**
     * The reference index, or null when it is not registered in this workspace. Resolved at call
     * time rather than at init: the index scans stories, blueprints, UI documents and characters,
     * several of which read assets, so depending on it here would be a cycle.
     */
    private getReferenceLookup(): AssetReferenceLookup | null {
        try {
            return this.getContext().services.get<ReferenceService>(Services.Reference) ?? null;
        } catch {
            return null;
        }
    }

    /**
     * The guard itself: the single point every delete passes through.
     *
     * It used to live in `useAssetActions`, which meant a group cascade — and any programmatic
     * delete — walked straight past it. Semantics per the ruling: block by default, and let a caller
     * that has actually asked the author come through with `allowReferenced`. The service never
     * shows UI; it only refuses.
     *
     * Returns the reason to refuse, or null to proceed.
     */
    private async findDeleteBlocker(
        assets: readonly Asset<AssetType, AssetSource>[],
        options?: AssetDeleteOptions,
    ): Promise<string | null> {
        if (options?.allowReferenced || assets.length === 0) {
            return null;
        }

        const report = await this.findAssetReferences(
            assets.map(asset => asset.id),
            assets.map(asset => asset.type),
        );
        if (report.checked && report.references.size === 0) {
            return null;
        }
        return describeBlockedDelete(report, new Map(assets.map(asset => [asset.id, asset.name])));
    }

    // Asset operations
    public async deleteAsset<T extends AssetType>(
        asset: Asset<T, AssetSource>,
        options?: AssetDeleteOptions,
    ): Promise<RequestStatus<void>> {
        const blocked = await this.findDeleteBlocker([asset], options);
        if (blocked) {
            return { success: false, error: blocked };
        }

        if (this.opSink) {
            // ⚠ Stated rather than done, and nothing local happens first. Every machine in the room
            // - this one included - trashes its own copy when the effect arrives, which is what makes
            // taking the deletion back cost one message instead of a re-upload.
            this.opSink.handle({ op: "delete-assets", assetType: asset.type, assetIds: [asset.id] });
            return { success: true, data: void 0 };
        }

        const plan = await this.removeAssetForRestore(asset);
        if (!plan.result.success) {
            // The delete did not happen, so anything set aside for it is unreachable.
            this.purgeAssetRestorePlan(plan);
            return plan.result;
        }
        if (this.assetDeletionBatch) {
            // Inside a group cascade: the batch becomes one undo step, not one per file.
            this.assetDeletionBatch.push(plan);
            return plan.result;
        }
        this.recordAssetDeletion([plan], {
            key: "assets.history.deleteAsset" as TranslationKey,
            params: { name: asset.name },
        });
        return plan.result;
    }

    /**
     * Delete one asset and keep everything needed to bring it back.
     *
     * Shared by {@link deleteAsset} and the group cascade so the two cannot drift: whatever a
     * single delete can restore, a cascaded one restores too.
     *
     * Three things go into the plan and each is here for a reason the others do not cover:
     *
     *  - **the payload**, moved to the trash rather than unlinked (see {@link AssetTrash}). Remote
     *    assets included: their snapshot is a file at the ordinary content shard like any other, and
     *    restoring only the record would put back an asset with no bytes - reachable again solely by
     *    going back to the network, which is the state pinning exists to make impossible.
     *  - **the record**, verbatim - it carries `groupId`, so restoring it also puts the asset back
     *    in the group it was in.
     *  - **its index in the order file**, because the order is reconciled against the records on
     *    every write: once a flush has dropped the id, a restored record sorts to the end of the
     *    section rather than back where the author had put it.
     */
    private async removeAssetForRestore<T extends AssetType>(
        asset: Asset<T, AssetSource>,
    ): Promise<AssetRestorePlan> {
        const category = categoryOfAssetType(asset.type);
        // Both of these degrade to "this part will not come back" rather than refusing the delete.
        // A deletion the author asked for must not fail because undo could not be prepared.
        const orderIndex = this.readAssetOrderIndex(category, asset.id);
        const record = JSON.parse(JSON.stringify(asset)) as Asset<AssetType, AssetSource>;

        // No source branch: a remote asset's snapshot lives at the same content shard as a local
        // asset's file, so it is trashed and restored the same way.
        const trashToken = await this.trashAssetPayload(asset);
        const result = await this.getLocalAssetsManager().deleteAsset(
            asset as Asset<T, AssetSource.Local>,
            { keepPayload: trashToken !== null },
        );

        if (result.success) {
            try {
                await this.clearThumbnailCache(asset.id);
            } catch (error) {
                console.warn(`Failed to clear thumbnail cache for asset: ${asset.id}`, error);
            }
        }

        return { record, trashToken, orderIndex, category, result };
    }

    /** Put one asset back: its bytes, its record, and its row in the order file. */
    private async restoreAssetFromPlan(plan: AssetRestorePlan): Promise<void> {
        if (plan.trashToken) {
            await this.getAssetTrash().restore(
                plan.trashToken,
                plan.record.type,
                this.getLocalAssetsManager().getLocalAssetPath(plan.record.id),
            );
        }
        const metadata = this.getAssetsMetadataManager().getAssets();
        metadata[plan.record.type][plan.record.id] = JSON.parse(JSON.stringify(plan.record)) as never;
        this.markDirty(plan.record.type);

        if (plan.orderIndex >= 0) {
            try {
                const orderManager = this.getAssetOrderManager();
                const current = [...orderManager.getAssetIds(plan.category)];
                if (!current.includes(plan.record.id)) {
                    current.splice(Math.min(plan.orderIndex, current.length), 0, plan.record.id);
                    await orderManager.write(plan.category, current, orderManager.getGroupIds(plan.category));
                }
            } catch (error) {
                console.warn(`[AssetsService] restored ${plan.record.id} but not its row order`, error);
            }
        }
        this.getEvents().emit("updated", plan.record);
    }

    /** The asset's row in the order file, or -1 when the order is not readable yet. */
    private readAssetOrderIndex(category: AssetCategory, assetId: string): number {
        try {
            return this.getAssetOrderManager().getAssetIds(category).indexOf(assetId);
        } catch {
            return -1;
        }
    }

    /** Move an asset's bytes to the trash. Null means undo will not be able to bring them back. */
    private async trashAssetPayload(asset: Asset<AssetType, AssetSource>): Promise<string | null> {
        try {
            return await this.getAssetTrash().put(
                asset.id,
                asset.type,
                this.getLocalAssetsManager().getLocalAssetPath(asset.id),
            );
        } catch (error) {
            console.warn(`[AssetsService] could not set aside ${asset.id} for undo`, error);
            return null;
        }
    }

    private purgeAssetRestorePlan(plan: AssetRestorePlan): void {
        if (plan.trashToken) {
            this.getAssetTrash().purge(plan.trashToken, plan.record.type);
        }
    }

    /**
     * Record one or more asset deletions as a single undo step.
     *
     * Restored in reverse so a group's own record lands after the assets that name it, and so a
     * nested cascade unwinds from the inside out.
     */
    private recordAssetDeletion(
        plans: AssetRestorePlan[],
        label: HistoryLabel,
        groups?: AssetGroupsRestorePlan,
    ): void {
        const restorable = plans.filter(plan => plan.result.success);
        if (restorable.length === 0 && !groups) {
            return;
        }
        const history = this.getContext().services.get<HistoryService>(Services.History);
        history.pushCommand(projectHistoryScope(), {
            label,
            undo: async () => {
                // Reverse order so a nested cascade unwinds from the inside out.
                for (const plan of [...restorable].reverse()) {
                    await this.restoreAssetFromPlan(plan);
                }
                if (groups) {
                    await this.restoreGroupRecords(groups);
                }
            },
            // Re-runs the deletion rather than replaying a snapshot: everything is live again after
            // an undo, so making the same call the author made is the honest way to remove it.
            redo: async () => {
                if (groups) {
                    await this.deleteGroup(groups.category, groups.groupId, true, { allowReferenced: true });
                    return;
                }
                for (const plan of restorable) {
                    const live = this.getAssetsMetadataManager().getAssets()[plan.record.type][plan.record.id];
                    if (live) {
                        plan.trashToken = (await this.removeAssetForRestore(live)).trashToken;
                    }
                }
            },
            dispose: () => {
                restorable.forEach(plan => this.purgeAssetRestorePlan(plan));
            },
        });
    }

    /** Put back every group record the cascade removed, and the order they were listed in. */
    private async restoreGroupRecords(plan: AssetGroupsRestorePlan): Promise<void> {
        const groupManager = this.getGroupAssetsManager();
        if (!groupManager.assetsGroups) {
            return;
        }
        groupManager.assetsGroups[plan.category] = JSON.parse(JSON.stringify(plan.groups));
        await groupManager.persistGroups(plan.category);
        try {
            const orderManager = this.getAssetOrderManager();
            await orderManager.write(plan.category, orderManager.getAssetIds(plan.category), plan.groupOrder);
        } catch (error) {
            console.warn("[AssetsService] restored the groups but not their order", error);
        }
        this.getEvents().emit("groupsUpdated", { category: plan.category, groupId: plan.groupId });
    }

    /**
     * Delete a group and everything under it as ONE undo step.
     *
     * The cascade calls back into {@link deleteAsset} once per file, and each of those would
     * otherwise record its own step - so deleting a folder of forty images would take forty presses
     * to take back. Opening a batch tells `deleteAsset` to hand its restore plan over instead.
     *
     * The batch is also what makes a *failed* cascade recoverable. It can abort halfway with files
     * already gone (a per-asset failure stops the loop), and the batch then holds exactly the ones
     * that went - so the undo step describes the partial state truthfully rather than claiming the
     * whole group is coming back.
     */
    private async deleteGroupWithHistory(
        category: AssetCategory,
        groupId: string,
        recursive: boolean,
    ): Promise<RequestStatus<void>> {
        const groupManager = this.getGroupAssetsManager();
        // Read straight off the record: `getGroups` sorts through the order file, which is more
        // than a label needs and is not always up.
        const name = groupManager.assetsGroups?.[category]?.[groupId]?.name ?? "";
        const groupsBefore = JSON.parse(JSON.stringify(groupManager.assetsGroups?.[category] ?? {}));
        let groupOrderBefore: string[] = [];
        try {
            groupOrderBefore = [...this.getAssetOrderManager().getGroupIds(category)];
        } catch {
            // The order file is not up yet; the records still come back, just not their listed order.
            groupOrderBefore = [];
        }

        const outer = this.assetDeletionBatch;
        const batch: AssetRestorePlan[] = [];
        this.assetDeletionBatch = batch;
        let result: RequestStatus<void>;
        try {
            result = await groupManager.deleteGroup(category, groupId, recursive, { allowReferenced: true });
        } finally {
            this.assetDeletionBatch = outer;
        }

        this.recordAssetDeletion(
            batch,
            { key: "assets.history.deleteGroup" as TranslationKey, params: { name } },
            { category, groupId, groups: groupsBefore, groupOrder: groupOrderBefore },
        );
        return result;
    }

    private getAssetTrash(): AssetTrash {
        if (!this.assetTrash) {
            this.assetTrash = new AssetTrash(this.getContext().project);
        }
        return this.assetTrash;
    }

    /**
     * Swap the bytes behind an existing asset, keeping its id.
     *
     * References store the asset id, never a path, so every place that pointed at this asset follows
     * automatically — that is the whole point of replacing rather than importing-and-relinking.
     *
     * The four steps below have to happen in this order, and three of them had no caller at all
     * before this method existed:
     *
     *  1. write the new bytes (`LocalAssetsManager.writeAssetContentFromPath`);
     *  2. recompute `hash` — it used to be written once at import and never again, while several
     *     readers use it as the cache key deciding whether to re-read the file;
     *  3. drop the cached thumbnail PNG, which is keyed by asset id and would otherwise survive the
     *     swap and keep every grid tile showing the old picture;
     *  4. write the record, then announce `updated` — last, so nobody wakes up and re-reads a stale
     *     thumbnail that step 3 was about to delete.
     *
     * There is no asset-level history: this cannot be undone. The UI expresses that with the button
     * hierarchy on the confirm, not with a sentence.
     */
    public async replaceAssetContent<T extends AssetType>(
        asset: Asset<T, AssetSource>,
        sourcePath: string,
    ): Promise<RequestStatus<Asset<T, AssetSource>>> {
        if (asset.source !== AssetSource.Local) {
            return { success: false, error: "Replacing the contents of a remote asset is not supported" };
        }

        const written = await this.getLocalAssetsManager()
            .writeAssetContentFromPath(asset as Asset<T, AssetSource.Local>, sourcePath);
        if (!written.success || !written.data) {
            return { success: false, error: written.error };
        }

        try {
            await this.clearThumbnailCache(asset.id);
        } catch (error) {
            console.warn(`Failed to clear thumbnail cache for asset: ${asset.id}`, error);
        }

        const stated = await this.stateReplacement(asset, written.data);
        if (stated) {
            return stated;
        }

        const applied = this.getAssetsMetadataManager().applyReplacedContent(asset, written.data);
        if (!applied.success || !applied.data) {
            return { success: false, error: applied.error };
        }

        this.getEvents().emit("updated", applied.data);

        return { success: true, data: applied.data };
    }

    /**
     * Save an asset's contents as text, in `encoding`.
     *
     * The text twin of {@link replaceAssetContent}, and it runs the *same four steps in the same
     * order* - that ordering is the contract, not an implementation detail, so read the doc block on
     * `replaceAssetContent` before changing anything here:
     *
     *  1. write the encoded bytes (`LocalAssetsManager.writeAssetContentText`);
     *  2. recompute `hash`, because it is the cache key several readers use to decide whether to
     *     re-read the file - a save that leaves it alone is a save nothing downstream notices;
     *  3. drop the cached thumbnail, which is keyed by asset id and would otherwise survive;
     *  4. write the record, then announce `updated` - last, so nobody re-reads a thumbnail that
     *     step 3 was about to delete.
     *
     * Step 3 is a no-op for the text assets this has today (thumbnails are images only), and is
     * still here rather than skipped: the caller decides what it is saving, and the day a text-ish
     * type grows a preview the ordering must already be right.
     */
    public async writeAssetTextContent<T extends AssetType>(
        asset: Asset<T, AssetSource>,
        text: string,
        encoding: FsTextEncoding,
    ): Promise<RequestStatus<Asset<T, AssetSource>>> {
        if (asset.source !== AssetSource.Local) {
            return { success: false, error: "Editing the contents of a remote asset is not supported" };
        }

        const written = await this.getLocalAssetsManager()
            .writeAssetContentText(asset as Asset<T, AssetSource.Local>, text, encoding);
        if (!written.success || !written.data) {
            return { success: false, error: written.error };
        }

        try {
            await this.clearThumbnailCache(asset.id);
        } catch (error) {
            console.warn(`Failed to clear thumbnail cache for asset: ${asset.id}`, error);
        }

        const stated = await this.stateReplacement(asset, written.data);
        if (stated) {
            return stated;
        }

        const applied = this.getAssetsMetadataManager().applyReplacedContent(asset, written.data);
        if (!applied.success || !applied.data) {
            return { success: false, error: applied.error };
        }

        this.getEvents().emit("updated", applied.data);

        return { success: true, data: applied.data };
    }

    /**
     * Create an asset whose contents are bytes Studio produced, with no source file on disk.
     *
     * Every other creation path starts from a file the author picked; this is the one that does
     * not, which is what makes "New Text File" possible at all. `options.id` additionally lets the
     * bytes be filed under an id the caller already holds, for content that arrives named by a
     * document rather than by the library - see {@link LocalAssetsManager.createLocalAssetFromBytes}
     * for what is refused and how.
     */
    public async createLocalAssetFromBytes<T extends AssetType>(
        type: T,
        name: string,
        bytes: Uint8Array,
        groupId?: string,
        options?: CreateLocalAssetFromBytesOptions,
    ): Promise<RequestStatus<Asset<T, AssetSource.Local>>> {
        return this.getLocalAssetsManager().createLocalAssetFromBytes(type, name, bytes, groupId, options);
    }

    /**
     * Create a bundle asset by copying a directory Studio was pointed at rather than one the author
     * picked - the directory-backed counterpart of {@link createLocalAssetFromBytes}.
     *
     * See {@link LocalAssetsManager.createLocalBundleAssetFromDirectory} for what a caller-chosen id
     * is refused for, and for why a tree that arrives incomplete lands as nothing at all.
     */
    public async createLocalBundleAssetFromDirectory<T extends AssetType>(
        type: T,
        sourceDir: string,
        options?: CreateLocalBundleAssetOptions,
    ): Promise<RequestStatus<Asset<T, AssetSource.Local>>> {
        return this.getLocalAssetsManager().createLocalBundleAssetFromDirectory(type, sourceDir, options);
    }

    /**
     * Duplicate an existing asset, returning the new asset metadata.
     */
    public async duplicateAsset<T extends AssetType>(asset: Asset<T, AssetSource>): Promise<RequestStatus<Asset<T, AssetSource.Local>>> {
        if (asset.source !== AssetSource.Local) {
            return { success: false, error: "Duplicating remote assets is not supported" };
        }
        return this.getLocalAssetsManager().duplicateAsset(asset as Asset<T, AssetSource.Local>);
    }

    public async importFromPaths<T extends AssetType>(
        type: T,
        paths: string[],
        options?: ImportFromPathsOptions,
    ): Promise<RequestStatus<RequestStatus<Asset<T, AssetSource.Local>>[]>> {
        // ⚠ Inside a transaction so that a directory of forty files is ONE operation. The importer
        // loops, and forty operations would be forty things for every other screen in the room to
        // draw and forty presses to take back.
        return this.transactionResult(() => this.getLocalAssetsManager().importFromPaths(type, paths, options));
    }

    /**
     * Run something inside a transaction and answer what it answered.
     *
     * {@link transaction} is a `void` for callers that only need the batching; this is for the ones
     * whose answer is the whole point, and it exists so a caller cannot accidentally batch a
     * creation and then drop what it created.
     */
    private async transactionResult<T>(run: () => Promise<T>): Promise<T> {
        let answer!: T;
        await this.transaction(async () => {
            answer = await run();
        });
        return answer;
    }

    /**
     * Expand dropped paths (files and/or directories) into the concrete files to import for the
     * given asset type. Directories are walked recursively and filtered by extension; plain files
     * pass through unchanged. See {@link LocalAssetsManager.expandImportPaths}.
     */
    public async expandImportPaths<T extends AssetType>(
        type: T,
        paths: string[]
    ): Promise<ExpandImportPathsResult> {
        return this.getLocalAssetsManager().expandImportPaths(type, paths);
    }

    /**
     * The same expansion for a whole sidebar category — the union of its member types' matches.
     * See {@link LocalAssetsManager.expandCategoryImportPaths}.
     */
    public async expandCategoryImportPaths(
        category: AssetCategory,
        paths: string[]
    ): Promise<ExpandImportPathsResult> {
        return this.getLocalAssetsManager().expandCategoryImportPaths(category, paths);
    }

    /**
     * Which concrete {@link AssetType} each file of a category import is, grouped so each bucket can
     * be handed to one {@link importFromPaths}. See {@link LocalAssetsManager.bucketPathsByAssetType}.
     */
    public async bucketPathsByAssetType(
        category: AssetCategory,
        paths: string[]
    ): Promise<{ type: AssetType; paths: string[] }[]> {
        return this.getLocalAssetsManager().bucketPathsByAssetType(category, paths);
    }

    // Magic Tag functionality
    /**
     * Analyze filenames and generate a magic tag template (auto-detect mode)
     * @param filenames Array of filenames to analyze
     * @returns Magic tag template with detected delimiters
     */
    public analyzeMagicTags(filenames: string[]): MagicTagTemplate {
        return MagicTagManager.analyzeFilenames(filenames);
    }

    /**
     * Analyze filenames using a regular expression (regex mode)
     * @param filenames Array of filenames to analyze
     * @param regexPattern Regular expression with named capture groups
     * @returns Magic tag template with regex pattern
     */
    public analyzeMagicTagsWithRegex(
        filenames: string[],
        regexPattern: string
    ): MagicTagTemplate {
        return MagicTagManager.analyzeWithRegex(filenames, regexPattern);
    }

    /**
     * Generate tag preview based on user's category mapping
     * @param template Magic tag template
     * @param categoryMapping Map from segment index to category name
     * @returns Array of previews for each file
     */
    public generateMagicTagPreview(
        template: MagicTagTemplate,
        categoryMapping: Record<number, string>
    ): MagicTagPreview[] {
        return MagicTagManager.generatePreview(template, categoryMapping);
    }

    // Asset Lock Management APIs

    /**
     * Lock an asset with a specific reason
     */
    public lockAsset(assetId: string, reason: AssetLockReason, metadata?: Record<string, any>): void {
        this.lockManager.lock(assetId, reason, metadata);
    }

    /**
     * Unlock an asset for a specific reason
     */
    public unlockAsset(assetId: string, reason: AssetLockReason, metadata?: Record<string, any>): void {
        this.lockManager.unlock(assetId, reason, metadata);
    }

    /**
     * Check if an asset is locked
     */
    public isAssetLocked(assetId: string): boolean {
        return this.lockManager.isLocked(assetId);
    }

    /**
     * Get all locks on an asset
     */
    public getAssetLocks(assetId: string): string[] {
        return this.lockManager.getLockReasons(assetId);
    }

    /**
     * Get a formatted lock message for an asset
     */
    public getAssetLockMessage(assetId: string): string | null {
        return this.lockManager.getLockMessage(assetId);
    }

    /**
     * Get the lock manager instance (for internal service use)
     */
    public getLockManager(): AssetLockManager {
        return this.lockManager;
    }

    /**
     * Every shared blueprint asset this project holds, parsed.
     *
     * The renderer's blind spot until now. A blueprint asset is a file, and the checks that walk
     * graphs walk `UIGraphService`'s document - so a `.nlbp` was judged by nothing on this side, and
     * the build's variant refusal only reached it when the main process folded the pack and threw.
     * That is a refusal after the author has committed to a build, phrased in the packer's terms.
     *
     * Reads on demand, without a cache. This has one caller, a build gate, and a project's shared
     * blueprints are a handful of small JSON files; a cache here would buy a few milliseconds once
     * per build in exchange for a staleness question every author-side edit would have to answer.
     *
     * Skips what it cannot read rather than throwing. An unreadable asset is still folded (and still
     * refused) in the main process, so nothing ships unjudged; a gate that failed the build over a
     * file it merely could not open would be refusing on a question it never asked.
     */
    public async listSharedBlueprints(): Promise<SharedBlueprintAsset[]> {
        const assets = this.getOrderedAssets(AssetType.Blueprint);
        const parsed: SharedBlueprintAsset[] = [];
        for (const asset of assets) {
            const result = await this.fetch(asset);
            if (!result.success) {
                continue;
            }
            parsed.push(result.data.data);
        }
        return parsed;
    }
}
