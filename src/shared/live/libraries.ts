import { encodeCanonicalJson } from "@shared/documents/canonicalJson";
import type { LocalizationDocument } from "@shared/types/localization";
import { fnv1a64BytesHex } from "@shared/utils/contentHash";
import type { VoiceDocument } from "@shared/types/voice";

/**
 * The fingerprints of the two per-locale libraries a live session carries: translations and voice
 * takes.
 *
 * The same instrument as `sceneDigest` and `cast`, for the same purpose - **disagreement, not change
 * detection**. Every machine in a session applies the same operations in the same order and should
 * therefore hold the same library; one that computes a different digest is wrong, or the host is, and
 * neither can tell which.
 *
 * ## Why the unit here is the whole locale document
 *
 * Everywhere else the digest covers the unit the operation names - a scene, one character record -
 * because a document is far too expensive to encode on every edit (this repository has measured one
 * `JSON.stringify` of a 15.4 MB story document at 133 ms of the renderer's own thread). A locale
 * library is the one shared document where the whole thing is the right unit, and there are two
 * reasons rather than one:
 *
 *  - **A message is capped at 16 KB, and these operations reach across entries freely.** An import
 *    restates hundreds of entries as one gesture, and a paste derives entries into every locale at
 *    once. One digest per entry would put hundreds of fingerprints into an effect that has to fit
 *    beside the operation itself.
 *  - **It is already the small document.** A locale library is one short entry per translatable
 *    line - a target string, a hash, a status - where a story document holds every line's prose, its
 *    structure, its stage directions and its metadata. The encode this pays for is the cheapest
 *    whole-document digest in the project, and it is paid only on the effects that are about a
 *    library: a story edit fingerprints a scene and never touches this.
 *
 * ## Why absence is a value
 *
 * `null` means this machine does not hold that library at all, and it hashes to something rather
 * than to nothing - the reason `characterRecordDigest` does the same for a missing record. A session
 * reads every locale into memory on the way in, so a machine that reaches an operation without one
 * has failed at something; ruling `unproven` there would excuse exactly the case where two copies
 * have already parted company, and the machine goes on writing entries nobody else has.
 *
 * Only the entries are hashed, and that is why these take a `units` map rather than a document. A
 * library file also carries its schema version and its own locale code, and both are properties of
 * the file rather than of what anybody edited - a machine that migrated on load would otherwise be
 * ejected from the room for holding the same translations.
 */

/** The fingerprint of one locale's translations, or of not holding them. */
export function translationsDigest(units: LocalizationDocument["units"] | null): string {
    return hash(units === null ? { absent: true } : { units });
}

/** The fingerprint of one locale's voice takes, or of not holding them. */
export function takesDigest(units: VoiceDocument["units"] | null): string {
    return hash(units === null ? { absent: true } : { units });
}

function hash(content: unknown): string {
    return fnv1a64BytesHex(new TextEncoder().encode(encodeCanonicalJson(content)));
}
