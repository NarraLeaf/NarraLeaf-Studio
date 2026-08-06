import { AssetType } from "../assets/assetTypes";
import type { Asset } from "../assets/types";
import { imageConvertTargetFor, type MediaConvertTarget } from "@shared/types/mediaConvert";
import type { MediaProbeOutcome } from "@shared/types/mediaProbe";

/**
 * Whether an asset **already in the project** will play, and what to do about it if not.
 *
 * The import path asks this question of a file the author is holding (`mediaImportTriage`). This
 * module asks it of the library, which is a different situation with a different answer shape:
 *
 *  - the file has no source path any more, only a content shard addressed by the asset's **id**;
 *  - it may predate the import gate entirely, or have come in through "Import Without Converting";
 *  - nobody is standing in front of a dialog, so the answer has to be storable and cheap to re-read.
 *
 * Everything here is pure: it turns a probe outcome (or a file name, for the image case) into a
 * record, and parses/serializes the cache those records live in. The scanning, the probing and the
 * disk are `MediaSupportService`'s.
 *
 * ## Nothing here re-decides playability
 *
 * The verdict comes from `@shared/utils/mediaSupport` by way of the main process's probe, judged on
 * `(container, codec of every stream)`. **No rule in this file may look at an extension** for a
 * sound or video file - the same `.mp4` plays when it holds H.264 and is a black rectangle when it
 * holds HEVC. The one extension test below is for still images, where there is no codec axis to be
 * wrong about; see {@link imageConvertTargetFor}.
 */

/** What the author has to do about an asset. */
export type MediaAssetSupportState =
    /** Plays as it is. Nothing to show and nothing to offer. */
    | "playable"
    /** Does not play, and there is a conversion that would fix it. */
    | "convertible"
    /** Does not play, and no conversion would produce what the author expected. */
    | "unplayable";

/**
 * One asset's answer.
 *
 * Deliberately much smaller than a {@link import("@shared/utils/mediaSupport").MediaSupportVerdict}:
 * this is written to disk and re-read on every build, and the stream table inside a verdict is
 * diagnostic detail that no caller here reads. Everything kept is something the UI renders or the
 * conversion needs.
 */
export type MediaAssetSupportRecord = {
    state: MediaAssetSupportState;
    /** What to convert into. Non-null exactly when `state` is `convertible`. */
    target: MediaConvertTarget | null;
    /**
     * Source duration in microseconds, or `null` when the file does not say.
     *
     * Carried so a conversion started later can show a percentage without spawning a second probe
     * for a number the first one already printed. `null` is a real answer and must stay `null`.
     */
    durationUs: number | null;
    /**
     * Whether the conversion rebuilds the picture and sound rather than repacking them.
     *
     * The only thing that distinguishes the two sentences the author is shown, so it is worth a
     * field: "the picture and sound stay exactly as they are" is a promise, and making it about a
     * re-encode would be a lie.
     */
    lossy: boolean;
};

/** Which question to ask about an asset, or `null` when there is nothing to ask. */
export type MediaSupportCheckKind =
    /** Sound or video: the answer is inside the bytes, so the main process has to probe them. */
    | "probe"
    /** A still image in a format no browser decodes. Decided by name; no process is spawned. */
    | "image";

/**
 * The name this asset's bytes are written under.
 *
 * `name` normally already carries the extension, so `ext` is appended only when it does not - the
 * same reconciliation `portability`'s `assetFileName` does. Re-stated here rather than imported
 * because pulling a lint rule module into the media path would drag the rule registry along with
 * it, and this is four lines.
 */
function assetFileName(asset: Asset): string {
    const ext = asset.ext?.trim().replace(/^\./, "");
    if (!ext) {
        return asset.name;
    }
    return asset.name.toLowerCase().endsWith(`.${ext.toLowerCase()}`) ? asset.name : `${asset.name}.${ext}`;
}

/**
 * Whether this asset is worth checking, and how.
 *
 * Only three of the seven asset types can hold something a player has to decode. A font, a JSON
 * file or anything under Other is bytes with no playback opinion attached, and probing them would
 * be a process spawn per file to answer a question nobody asked.
 *
 * Images are checked **by name and only for the three undecodable formats**, which costs nothing:
 * a `.tif` is a TIFF, and Chromium has no TIFF decoder. Every other image is passed over rather
 * than probed, because ffprobe would happily describe a PNG and the answer would never be news.
 */
export function mediaSupportCheckKind(asset: Asset): MediaSupportCheckKind | null {
    if (asset.type === AssetType.Audio || asset.type === AssetType.Video) {
        return "probe";
    }
    if (asset.type === AssetType.Image) {
        return imageConvertTargetFor(assetFileName(asset)) ? "image" : null;
    }
    return null;
}

/**
 * The record for an image whose format no browser decodes.
 *
 * `lossy: false` is a statement about this pipeline, not about PNG in general: the image conversion
 * has no quality parameter anywhere on it (see {@link import("@shared/types/mediaConvert").MediaImageTarget}),
 * precisely so this promise stays true.
 */
export function imageSupportRecord(asset: Asset): MediaAssetSupportRecord | null {
    const target = imageConvertTargetFor(assetFileName(asset));
    if (!target) {
        return null;
    }
    return { state: "convertible", target, durationUs: null, lossy: false };
}

/**
 * Read a probe outcome as a record, or `null` when the probe produced no answer.
 *
 * **`null` is not "the file is fine".** It means the question was never answered - no ffprobe on
 * this host, a timeout, output that would not parse - and the difference matters more here than
 * anywhere else in this module, because the build gate refuses builds. A caller that treated an
 * unanswered probe as a verdict would fail builds on a machine that merely lacks a tool.
 */
export function mediaSupportRecordFromProbe(outcome: MediaProbeOutcome | null): MediaAssetSupportRecord | null {
    if (!outcome || outcome.status !== "probed") {
        return null;
    }
    const { verdict, durationUs } = outcome;
    switch (verdict.tier) {
        case "accept":
            return { state: "playable", target: null, durationUs, lossy: false };
        case "refuse":
            return { state: "unplayable", target: null, durationUs: null, lossy: false };
        case "remux":
        case "reencode":
            // The classifier never returns those two tiers without a target; the guard is for a
            // record that was hand-edited or written by a future version, not for a real branch.
            return verdict.target
                ? {
                    state: "convertible",
                    target: verdict.target,
                    durationUs,
                    lossy: verdict.tier === "reencode",
                }
                : { state: "unplayable", target: null, durationUs: null, lossy: false };
    }
}

/** Whether this record describes an asset that will not play, whatever can be done about it. */
export function blocksShipping(record: MediaAssetSupportRecord): boolean {
    return record.state !== "playable";
}

/* -------------------------------------------------------------------------------------------- */
/* The cache                                                                                      */
/* -------------------------------------------------------------------------------------------- */

/**
 * Bumped whenever a stored record would be read wrongly by this version.
 *
 * A mismatch empties the cache rather than migrating it. There is nothing to preserve: every entry
 * is reproducible by probing the file again, and a migration would be code written to avoid a few
 * seconds of work once.
 */
export const MEDIA_SUPPORT_CACHE_VERSION = 1;

/**
 * The cache document, **keyed by content hash rather than by asset id**.
 *
 * The verdict is a property of the bytes, not of the record that points at them: the same file
 * imported twice gets one entry, and an asset whose bytes were replaced misses rather than reading
 * a stale answer. This is the `sourceHash` treatment the localization library uses on its
 * translation units - a stored answer carries the fingerprint of what it was an answer *to*, and a
 * fingerprint that no longer matches is a miss, never something to repair.
 *
 * The alternative - keying by asset id and storing the hash inside - was rejected because it
 * answers the same question with one more moving part, and because "which asset does this belong
 * to" is a question nothing here asks.
 */
export type MediaSupportCacheDocument = {
    version: number;
    entries: Record<string, MediaAssetSupportRecord>;
};

const SUPPORT_STATES: ReadonlySet<string> = new Set<MediaAssetSupportState>([
    "playable",
    "convertible",
    "unplayable",
]);

/**
 * Read a cache file into a map, dropping anything that does not read cleanly.
 *
 * Total and forgiving on purpose: every rejection costs one re-probe and nothing else, so there is
 * no failure here worth reporting to anybody. A wrong `version`, a truncated write, a hand-edited
 * file - all of them come back as an empty map and the scan simply does its work.
 */
export function parseMediaSupportCache(raw: unknown): Map<string, MediaAssetSupportRecord> {
    const out = new Map<string, MediaAssetSupportRecord>();
    if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
        return out;
    }
    const document = raw as Partial<MediaSupportCacheDocument>;
    if (document.version !== MEDIA_SUPPORT_CACHE_VERSION) {
        return out;
    }
    const entries = document.entries;
    if (typeof entries !== "object" || entries === null || Array.isArray(entries)) {
        return out;
    }
    for (const [hash, value] of Object.entries(entries)) {
        const record = parseRecord(value);
        if (hash && record) {
            out.set(hash, record);
        }
    }
    return out;
}

function parseRecord(value: unknown): MediaAssetSupportRecord | null {
    if (typeof value !== "object" || value === null || Array.isArray(value)) {
        return null;
    }
    const candidate = value as Partial<MediaAssetSupportRecord>;
    if (typeof candidate.state !== "string" || !SUPPORT_STATES.has(candidate.state)) {
        return null;
    }
    const target = candidate.target;
    const hasTarget = typeof target === "object" && target !== null && typeof (target as { kind?: unknown }).kind === "string";
    // A `convertible` with no target is not a state this code can render or act on: the badge would
    // offer a conversion the dialog could not start. Refuse the entry and re-probe.
    if (candidate.state === "convertible" && !hasTarget) {
        return null;
    }
    return {
        state: candidate.state,
        target: hasTarget ? (target as MediaConvertTarget) : null,
        durationUs: typeof candidate.durationUs === "number" && Number.isFinite(candidate.durationUs)
            ? candidate.durationUs
            : null,
        lossy: candidate.lossy === true,
    };
}

/** The document to write for these entries. */
export function serializeMediaSupportCache(
    entries: ReadonlyMap<string, MediaAssetSupportRecord>,
): MediaSupportCacheDocument {
    return {
        version: MEDIA_SUPPORT_CACHE_VERSION,
        entries: Object.fromEntries(entries),
    };
}

/**
 * Drop entries for hashes the library no longer holds.
 *
 * Without this the file grows once per byte-swap forever, and a project that has re-encoded its way
 * through a hundred takes carries ninety-nine dead answers. Pruning is safe precisely because a
 * dropped entry costs one probe: this is a cache, and forgetting is always allowed.
 */
export function pruneMediaSupportCache(
    entries: ReadonlyMap<string, MediaAssetSupportRecord>,
    liveHashes: ReadonlySet<string>,
): Map<string, MediaAssetSupportRecord> {
    const out = new Map<string, MediaAssetSupportRecord>();
    for (const [hash, record] of entries) {
        if (liveHashes.has(hash)) {
            out.set(hash, record);
        }
    }
    return out;
}
