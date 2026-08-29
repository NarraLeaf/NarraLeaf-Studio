import { encodeCanonicalJson } from "@shared/documents/canonicalJson";
import { fnv1a64BytesHex } from "@shared/utils/contentHash";

/**
 * The fingerprint of one section's folders.
 *
 * The asset shard's counterpart (`@shared/live/assets`), whole for the same two reasons and one more
 * of its own:
 *
 *  - **A folder deletion reaches across every folder below it**, to any depth, so a per-folder digest
 *    would not cover the operation that most needs covering.
 *  - **A section's folder list is a handful of four-field records**, where a shard of asset metadata
 *    is hundreds and a story document is megabytes. This is the cheapest digest in the project.
 *  - **It is where the cascade's own half shows up.** Deleting a folder empties asset shards too, and
 *    those are fingerprinted separately by the applier; what this covers is the half that would
 *    otherwise have nothing over it - the folders that went with it.
 *
 * ⚠ `createdAt` and `updatedAt` are hashed, and that is a decision rather than an oversight - the
 * same one `castDigest` records for a group's timestamps. They are minted by whichever machine
 * created or renamed the folder and travel inside the operation, so every machine writes the same
 * numbers. The day a folder's timestamp is ever stamped locally, it has to come out of this hash, or
 * every folder edit will eject the room.
 *
 * `undefined` is pruned before encoding for `assetsDigest`'s reason: `parentGroupId: undefined` is
 * what `GroupAssetsManager` writes for a folder at the section root, and an absent key is what lands
 * on disk. The two are one document and must hash alike.
 */
export function assetGroupsDigest(folders: Readonly<Record<string, unknown>> | null): string {
    return hash(folders === null ? { absent: true } : { folders: pruneUndefined(folders) });
}

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
