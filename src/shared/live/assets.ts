import { encodeCanonicalJson } from "@shared/documents/canonicalJson";
import type { AssetMetadataEntry } from "@shared/documents/specs/assetsMetadata";
import { fnv1a64BytesHex } from "@shared/utils/contentHash";

/**
 * The fingerprint of one asset metadata shard - the library's records for one asset type.
 *
 * The same instrument as `sceneDigest`, `cast` and `libraries`, for the same purpose -
 * **disagreement, not change detection**. Every machine in a session applies the same operations in
 * the same order and should therefore hold the same records; one that computes a different digest is
 * wrong, or the host is, and neither can tell which.
 *
 * ## Why the unit here is the whole shard
 *
 * This is the second document to answer that way, and it answers it for `libraries`' two reasons
 * rather than for one of its own:
 *
 *  - **A message is capped at 16 KB, and these operations reach across records freely.** Filing a
 *    multi-selection in a folder is one gesture over any number of assets, and one fingerprint per
 *    record would put hundreds of them into an effect that has to fit beside the operation itself.
 *  - **It is a small document.** A shard is one short record per file - a name, a digest, some tags,
 *    a description - where a story document holds every line's prose, its structure and its
 *    metadata. This repository has measured one `JSON.stringify` of a 15.4 MB story document at
 *    133 ms of the renderer's own thread; a shard of several hundred records is tens of kilobytes,
 *    and the encode is paid only on the effects that are about the library. A story edit
 *    fingerprints a scene and never touches this.
 *
 * The cast went the other way - a digest per character record - and the difference is what a record
 * can grow into rather than how many there are. A layered character carries a PSD fingerprint, a
 * layer table and a snapshot map and is bounded by nothing; an asset record is metadata *about* a
 * file and is bounded by its author's description.
 *
 * ## Why absence is a value
 *
 * `null` means this machine does not hold that shard at all, and it hashes to something rather than
 * to nothing - the reason `characterRecordDigest` and the library digests do the same. A workspace
 * creates every shard as it starts, so a machine that reaches an operation without one has failed at
 * something; ruling `unproven` there would excuse exactly the case where two copies have already
 * parted company.
 *
 * ## Why `undefined` is pruned first
 *
 * The canonical encoder rejects an `undefined` property by name, and the asset services still
 * produce them: a record spread through `{ ...asset, ext: undefined }` holds a key whose value is
 * `undefined` where a record parsed off disk simply has no key. Those two are the same document -
 * `JSON.stringify` writes neither, and that is what is on disk - so hashing them differently would
 * eject a machine from the room over a difference no file can hold. Pruning also keeps this from
 * being the one digest that can throw, which inside an applier would take the session down.
 */

/** One type's records as they stand, or the fact that this machine does not hold them. */
export function assetsDigest(records: Readonly<Record<string, AssetMetadataEntry>> | null): string {
    return hash(records === null ? { absent: true } : { records: pruneUndefined(records) });
}

/**
 * The same value with every `undefined`-valued property dropped, at any depth.
 *
 * A copy rather than an edit: the input is the live record map the asset panel is drawing, and this
 * runs while an effect is being applied.
 */
function pruneUndefined(value: unknown): unknown {
    if (Array.isArray(value)) {
        return value.map(pruneUndefined);
    }
    if (value === null || typeof value !== "object") {
        return value;
    }
    const out: Record<string, unknown> = {};
    for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
        if (entry !== undefined) {
            out[key] = pruneUndefined(entry);
        }
    }
    return out;
}

function hash(content: unknown): string {
    return fnv1a64BytesHex(new TextEncoder().encode(encodeCanonicalJson(content)));
}
