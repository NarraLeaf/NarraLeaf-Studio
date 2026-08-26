import { encodeCanonicalJson } from "@shared/documents/canonicalJson";
import type { AssetSet } from "@shared/types/assetSet";
import type { ProjectAudioTrack } from "@shared/types/audioTrack";
import type { ProjectDictionaryDocument } from "@shared/types/dictionary";
import { fnv1a64BytesHex } from "@shared/utils/contentHash";
import { pruneUndefined } from "./digestValue";

/**
 * The fingerprints of the three small project tables a live session carries: the dictionary, the
 * mixer and the asset sets.
 *
 * The same instrument as `sceneDigest`, `cast`, `libraries` and `assets`, and for the same
 * purpose - **disagreement, not change detection**. Every machine in a session applies the same
 * operations in the same order and should therefore hold the same table; one that computes a
 * different digest is wrong, or the host is, and neither can tell which.
 *
 * ## Why the unit is the whole document for all three
 *
 * The story fingerprints one scene and the cast one record, because encoding a whole document per
 * edit is measurable work (this repository has measured one `JSON.stringify` of a 15.4 MB story
 * document at 133 ms of the renderer's own thread). These three are on the libraries' side of that
 * line instead, and there are two reasons they share and one apiece:
 *
 *  - **They are the smallest documents in a project.** A dictionary is a list of words the author
 *    writes on purpose; a mixer is a handful of buses; a set is a name, a filter and an axis. All
 *    three together are smaller than one scene of dialogue, and the encode is paid only on the
 *    effects that are about them.
 *  - **Every one of them has a gesture that reaches records the operation does not name.** Deleting
 *    a bus promotes the buses that fed it; deleting a set takes the sets drawn inside it; renaming a
 *    dictionary term is one entry leaving and another arriving. Per-record digests would have to be
 *    reported by the applier for work it derived, and a whole-document digest covers all of it
 *    without anybody having to remember to.
 *
 * The dictionary has a third reason of its own: its entries have no ids. A term is keyed by the
 * author's own spelling, so there is no address that survives a rename to hang a per-entry
 * fingerprint on.
 *
 * ## Why absence is a value
 *
 * `null` means this machine does not hold that table at all, and it hashes to something rather than
 * to nothing - the reason `characterRecordDigest` and `translationsDigest` do the same. All three of
 * these are read as the workspace starts rather than when a panel opens them, so a machine that
 * reaches an operation without one has failed at something; ruling `unproven` there would excuse
 * exactly the case where two copies have already parted company.
 *
 * ## What is left out, and why
 *
 * Only what anybody edited. The mixer's `meta.updatedAt` is stamped on every save and says nothing
 * about content, so a machine that saved a moment later would otherwise be ejected from the room for
 * holding the same tracks. `schemaVersion` is left out for the same reason one document further
 * along: a machine that migrated an older file on load holds the same table as one that did not.
 *
 * `undefined`-valued properties are pruned before encoding, for the reason `digestValue` gives.
 */

/** The fingerprint of the project dictionary, or of not holding it. */
export function dictionaryDigest(document: ProjectDictionaryDocument | null): string {
    return hash(document === null
        ? { absent: true }
        // Both halves, because both travel: the terms and the two checks they drive.
        : { entries: document.entries, options: document.options });
}

/** The fingerprint of the project's mixer, or of not holding it. */
export function audioTracksDigest(tracks: readonly ProjectAudioTrack[] | null): string {
    return hash(tracks === null ? { absent: true } : { tracks });
}

/** The fingerprint of the project's asset sets, or of not holding them. */
export function assetSetsDigest(sets: readonly AssetSet[] | null): string {
    return hash(sets === null ? { absent: true } : { sets });
}

function hash(content: unknown): string {
    return fnv1a64BytesHex(new TextEncoder().encode(encodeCanonicalJson(pruneUndefined(content))));
}
