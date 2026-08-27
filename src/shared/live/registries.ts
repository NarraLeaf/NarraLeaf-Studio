import { encodeCanonicalJson } from "@shared/documents/canonicalJson";
import type { LocalizationKeyDefinition } from "@shared/types/localization";
import { fnv1a64BytesHex } from "@shared/utils/contentHash";
import type { VariableRegistryEntry } from "@shared/types/variables/registry";

/**
 * The fingerprints of the two project-level registries a live session carries: the variable registry
 * (`editor/variables.json`) and the named-string registry (`editor/localization/keys.json`).
 *
 * The same instrument as `sceneDigest`, `cast` and `libraries`, for the same purpose -
 * **disagreement, not change detection**. Every machine in a session applies the same operations in
 * the same order and should therefore hold the same registries; one that computes a different digest
 * is wrong, or the host is, and neither can tell which.
 *
 * ## Why the unit is one entry rather than the document
 *
 * These follow the ordinary rule, and need no exception of the kind a locale library needed. Every
 * operation about either registry names exactly one entry, so nothing reaches across them the way an
 * import restates hundreds of translations at once - which means one fingerprint per effect, and the
 * cheapest possible encode. Both documents are also plain maps with no order of their own (the
 * variables panel sorts by name as it draws), so there is no shape left over that a document-wide
 * scope would have to cover.
 *
 * ## Why absence is a value
 *
 * `null` means the entry is not there, and it hashes to something rather than to nothing - the reason
 * `characterRecordDigest` does the same. Removing a named key is an operation like any other, and the
 * machine that failed to apply it has to be caught: answering nothing would rule `unproven` on
 * exactly the effect that proves two copies have parted company.
 *
 * Both are built on the canonical encoder, for the reason the cast's digests are: two copies of one
 * record may have been assembled by different code paths - one parsed off disk, one adopted from a
 * message - and `JSON.stringify` would call them different over key order alone.
 */

/** The fingerprint of one variable registry entry, or of there being none. */
export function variableEntryDigest(entry: VariableRegistryEntry | null): string {
    return hash(entry === null ? { absent: true } : { entry });
}

/**
 * The fingerprint of one named string, or of there being none.
 *
 * Only the definition is hashed - the source text and the note - because that is the whole of an
 * entry. The document's schema version is a property of the file rather than of anything anybody
 * edited, and a machine that migrated on load would otherwise be ejected from the room for holding
 * the same strings.
 */
export function localizationKeyDigest(definition: LocalizationKeyDefinition | null): string {
    return hash(definition === null ? { absent: true } : { definition });
}

function hash(content: unknown): string {
    return fnv1a64BytesHex(new TextEncoder().encode(encodeCanonicalJson(content)));
}
